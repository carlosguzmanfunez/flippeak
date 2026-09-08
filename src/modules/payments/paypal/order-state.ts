/**
 * Pure PayPal event semantics (Phase 10, ADR-014).
 *
 * Framework-free, clock-free, database-free: given a parsed provider event and
 * a snapshot of the local order (or its absence), this module decides what a
 * verified webhook delivery implies. The service layer owns the transaction,
 * the SDK, the signature check and the writes; this module owns the truth of
 * "what does this event mean".
 *
 * Two rules from the review are encoded here:
 *  - Capture sovereignty: a local checkout state never invalidates a genuine
 *    COMPLETED capture. Even an ABANDONED local order is upgraded by a
 *    verified capture; an unknown capture becomes an ORPHAN for
 *    reconciliation — money never disappears.
 *  - Bit-accurate amount/currency: mismatch is a REJECTION, not a credit.
 *
 * Idempotent: the same decision function returns the same verdict for the
 * same inputs; duplicates are detected by the caller against the two UNIQUE
 * levels (event id, capture id).
 */

export type ProviderEventKind = 'CAPTURE_COMPLETED' | 'ORDER_APPROVED' | 'REFUNDED' | 'IGNORED';

export type ParsedEvent = {
  readonly kind: ProviderEventKind;
  readonly providerEventId: string | null;
  readonly providerOrderId: string | null;
  readonly providerCaptureId: string | null;
  readonly amountCents: number | null;
  readonly currency: string | null;
};

export type ParseFailure = 'UNKNOWN_EVENT' | 'MISSING_EVENT_ID';

export function parseProviderEvent(eventType: unknown, resource: unknown): ParsedEvent | ParseFailure {
  if (typeof eventType !== 'string' || eventType.length === 0) return 'MISSING_EVENT_ID';

  switch (eventType) {
    case 'CHECKOUT.ORDER.APPROVED': {
      const { id } = asResource(resource);
      return id === null
        ? 'MISSING_EVENT_ID'
        : {
            kind: 'ORDER_APPROVED',
            providerEventId: null, // filled by the caller (event envelope id)
            providerOrderId: id,
            providerCaptureId: null,
            amountCents: null,
            currency: null,
          };
    }
    case 'PAYMENT.CAPTURE.COMPLETED': {
      const { id, amount, currencyCode } = asResource(resource);
      if (id === null) return 'MISSING_EVENT_ID';
      return {
        kind: 'CAPTURE_COMPLETED',
        providerEventId: null,
        providerOrderId: null,
        providerCaptureId: id,
        amountCents: Number.isSafeInteger(amount) ? amount : null,
        currency: typeof currencyCode === 'string' ? currencyCode : null,
      };
    }
    case 'PAYMENT.CAPTURE.REFUNDED':
      return {
        kind: 'REFUNDED',
        providerEventId: null,
        providerOrderId: null,
        providerCaptureId: null,
        amountCents: null,
        currency: null,
      };
    default:
      return 'UNKNOWN_EVENT';
  }
}

function asResource(value: unknown): { id: string | null; amount: number | null; currencyCode: string | null } {
  if (typeof value !== 'object' || value === null) {
    return { id: null, amount: null, currencyCode: null };
  }
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : null;
  const amountInfo = record.amount;
  let amount: number | null = null;
  let currencyCode: string | null = null;
  if (typeof amountInfo === 'object' && amountInfo !== null) {
    const a = amountInfo as Record<string, unknown>;
    amount = typeof a.value === 'string' ? parseAmountCents(a.value) : null;
    currencyCode = typeof a.currency_code === 'string' ? a.currency_code : null;
  }
  return { id, amount, currencyCode };
}

/** Parses "47.00" or "0.01" into exact cents without floating point. */
function parseAmountCents(value: string): number | null {
  const match = /^(\d+)\.(\d{2})$/.exec(value);
  if (match === null) return null;
  const cents = Number(match[1]) * 100 + Number(match[2]);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

export type LocalOrderSnapshot = {
  readonly state: 'PENDING' | 'APPROVED' | 'CAPTURED' | 'ABANDONED' | 'REFUNDED';
  readonly amountCents: number;
  readonly currency: string;
  readonly providerCaptureId: string | null;
};

export type ProcessingPlan =
  | { readonly action: 'EVENT_ALREADY_PROCESSED' }
  | { readonly action: 'MARK_APPROVED' }
  | { readonly action: 'CREDIT_AND_CAPTURE' }
  | { readonly action: 'CAPTURE_DUPLICATE' }
  | { readonly action: 'ORPHAN_CAPTURE' }
  | { readonly action: 'RECORD_REFUND' }
  | { readonly action: 'IGNORED' }
  | { readonly action: 'REJECTED'; readonly reason: 'AMOUNT_MISMATCH' | 'CURRENCY_MISMATCH' };

/**
 * The decision function. `verifiedAmount`/`currency` come from the event
 * (after the SDK signature check, on the caller side); `localOrder` is null
 * when no order row references this capture/order id yet.
 */
export function planProcessing(input: {
  readonly event: ParsedEvent;
  readonly localOrder: LocalOrderSnapshot | null;
  readonly eventAlreadyProcessed: boolean;
}): ProcessingPlan {
  const { event, localOrder, eventAlreadyProcessed } = input;
  if (eventAlreadyProcessed) return { action: 'EVENT_ALREADY_PROCESSED' };

  switch (event.kind) {
    case 'ORDER_APPROVED':
      // Approving an already CAPTURED local order is a no-op; approving a
      // later-denied lifecycle is still the local record of intent.
      return { action: 'MARK_APPROVED' };

    case 'REFUNDED':
      return { action: 'RECORD_REFUND' };

    case 'CAPTURE_COMPLETED': {
      if (localOrder === null) {
        // Capture sovereignty (ADR-014): never discard, persist for
        // reconciliation.
        return { action: 'ORPHAN_CAPTURE' };
      }
      if (localOrder.providerCaptureId === event.providerCaptureId) {
        // The capture is already credited under this order (another event
        // delivery with a different event id): level 2 idempotency.
        return { action: 'CAPTURE_DUPLICATE' };
      }
      if (event.amountCents === null || event.amountCents !== localOrder.amountCents) {
        return { action: 'REJECTED', reason: 'AMOUNT_MISMATCH' };
      }
      if (event.currency !== localOrder.currency) {
        return { action: 'REJECTED', reason: 'CURRENCY_MISMATCH' };
      }
      // ABANDONED, APPROVED, PENDING: a verified capture is authority —
      // the local checkout state is intent, not money.
      return { action: 'CREDIT_AND_CAPTURE' };
    }

    default:
      return { action: 'IGNORED' };
  }
}

/** Whether activation may proceed for the run behind the order. */
export function activationAllowed(runStatus: 'DRAFT' | 'ACTIVE' | 'EXHAUSTED'): boolean {
  return runStatus === 'DRAFT';
}
