import {
  activationAllowed,
  parseProviderEvent,
  planProcessing,
} from '@/modules/payments/paypal/order-state';
import type { ParsedEvent, ProcessingPlan } from '@/modules/payments/paypal/order-state';

/**
 * Verified webhook processing flow (Phase 10, ADR-014).
 *
 * Order of operations — authority first, idempotency second, money third:
 *
 *   0. the caller (route) has ALREADY verified the signature server-to-server;
 *   1. parse (pure);
 *   2. level-1: event UNIQUE(provider, provider_event_id) — replay is a skip;
 *   3. load the local order by capture id (level-2 key) or by order id;
 *   4. pure decision (planProcessing) — capture sovereignty encoded;
 *   5. execute the decision via injected transactional deps.
 *
 * Every injected function is atomic in itself. The DB deps definition lives in
 * `paypal-provider-deps.ts`; unit tests here use fakes for the full decision
 * matrix without any I/O.
 */

export type WebhookInput = {
  readonly providerEventId: string;
  readonly eventType: string;
  readonly resource: unknown;
};

export type ProcessOutcome =
  | { readonly ok: true; readonly action: ProcessingPlan['action'] }
  | { readonly ok: false; readonly reason: 'UNPARSEABLE' | 'REJECTED' | 'CAPTURED_UNAPPLIED' };

export type WebhookFlowDeps = {
  /**
   * Level 1 insert. Resolves true if the row was inserted, false if the same
   * (provider, provider_event_id) already exists.
   */
  readonly insertEventIfAbsent: (input: WebhookInput) => Promise<boolean>;
  /** Current processing state of an existing event (null when absent). */
  readonly loadEventState: (eventId: string) => Promise<
    | 'PENDING_RETRY'
    | 'PROCESSED'
    | 'DUPLICATE_CAPTURE'
    | 'ORPHAN_CAPTURE'
    | 'NO_ACTIVATION'
    | 'REJECTED'
    | 'CAPTURED_UNAPPLIED'
    | null
  >;
  /**
   * Local order by capture id first, then by order id (ADR-014).
   * Receives the ALREADY PARSED event so the normalized ids are the single
   * form of truth across the flow (never re-parse raw shapes in the deps).
   */
  readonly loadOrder: (event: ParsedEvent) => Promise<{
    readonly id: string;
    readonly state: 'PENDING' | 'APPROVED' | 'CAPTURED' | 'ABANDONED' | 'REFUNDED';
    readonly amountCents: number;
    readonly currency: string;
    readonly providerCaptureId: string | null;
    readonly providerOrderId: string | null;
    readonly runId: string;
    readonly runStatus: 'DRAFT' | 'ACTIVE' | 'EXHAUSTED';
  } | null>;
  readonly markApproved: (orderId: string) => Promise<void>;
  /**
   * The money transaction: credits the run (ledger + credited_cents) and, when
   * the run is DRAFT and no ACTIVE sibling exists, activates it. Credit is
   * never lost on activation failure (NO_ACTIVATION state, ADR-014 §6).
   * Resolves 'CAPTURE_EXISTS' when a duplicate capture id is detected inside
   * the transaction (level-2 hard guard — another order already owns it).
   * Resolves 'CAPTURED_UNAPPLIED' when the credit cannot be applied at all (the
   * run is EXHAUSTED): the unit of work is rolled back so nothing is written as
   * if the credit had landed, and the verified capture is recorded for explicit
   * reconciliation instead.
   */
  readonly creditAndActivate: (input: {
    readonly orderId: string;
    readonly captureId: string;
    readonly amountCents: number;
  }) => Promise<'CREDITED' | 'NO_ACTIVATION' | 'CAPTURE_EXISTS' | 'CAPTURED_UNAPPLIED'>;
  readonly recordOrphan: (eventId: string, detail: string) => Promise<void>;
  readonly recordVerdict: (
    eventId: string,
    verdict: 'PROCESSED' | 'DUPLICATE_CAPTURE' | 'REJECTED' | 'RECORD_REFUND' | 'CAPTURED_UNAPPLIED',
    detail?: string,
  ) => Promise<void>;
};

/**
 * A verdict is terminal when it cannot change (already credited/duplicated or
 * a rejecting fact). Non-terminal verdicts (a transient out-of-order or an
 * orphan capture that later becomes reconciliable) stay RE-ELIGIBLE: a
 * provider resend of the SAME event id re-enters the flow instead of being
 * skipped, and the idempotency levels keep the money safe.
 */
const TERMINAL_VERDICTS = new Set([
  'PROCESSED',
  'DUPLICATE_CAPTURE',
  'REJECTED',
  'NO_ACTIVATION',
  // A capture we cannot apply is terminal on purpose: the money is already
  // taken, so it is recorded once for a human to reconcile rather than left
  // re-entering the flow (or sitting in PENDING_RETRY) forever.
  'CAPTURED_UNAPPLIED',
]);

export async function processVerifiedEvent(
  deps: WebhookFlowDeps,
  input: WebhookInput,
): Promise<ProcessOutcome> {
  const parsed = parseProviderEvent(input.eventType, input.resource);
  if (parsed === 'UNKNOWN_EVENT') return { ok: false, reason: 'UNPARSEABLE' };
  if (parsed === 'MISSING_EVENT_ID') return { ok: false, reason: 'UNPARSEABLE' };

  const inserted = await deps.insertEventIfAbsent(input);
  if (!inserted) {
    const existing = await deps.loadEventState(input.providerEventId);
    // Terminal verdicts absorb repeats; non-terminal (PENDING_RETRY / ORPHAN)
    // re-enter the exact same deterministic pipeline — the level-2 guards make
    // an accidental re-credit impossible by construction.
    if (existing !== null && TERMINAL_VERDICTS.has(existing)) {
      return { ok: true, action: 'EVENT_ALREADY_PROCESSED' };
    }
  }

  const order = await deps.loadOrder(parsed);
  if (order === null) {
    if (parsed.kind === 'CAPTURE_COMPLETED') {
      await deps.recordOrphan(input.providerEventId, 'CAPTURE_COMPLETED without local order');
      return { ok: true, action: 'ORPHAN_CAPTURE' };
    }
    await deps.recordVerdict(input.providerEventId, 'PROCESSED');
    return { ok: true, action: 'IGNORED' };
  }

  const plan = planProcessing({
    event: {
      kind: parsed.kind,
      providerEventId: input.providerEventId,
      providerOrderId: parsed.providerOrderId,
      providerCaptureId: parsed.providerCaptureId,
      amountCents: parsed.amountCents,
      currency: parsed.currency,
    },
    localOrder: {
      state: order.state,
      amountCents: order.amountCents,
      currency: order.currency,
      providerCaptureId: order.providerCaptureId,
    },
    eventAlreadyProcessed: false,
  });

  switch (plan.action) {
    case 'MARK_APPROVED':
      await deps.markApproved(order.id);
      await deps.recordVerdict(input.providerEventId, 'PROCESSED');
      return { ok: true, action: plan.action };

    case 'CREDIT_AND_CAPTURE': {
      const captureId = parsed.providerCaptureId!;
      const amount = parsed.amountCents!;
      const outcome = await deps.creditAndActivate({
        orderId: order.id,
        captureId,
        amountCents: amount,
      });
      if (outcome === 'CAPTURE_EXISTS') {
        await deps.recordVerdict(input.providerEventId, 'DUPLICATE_CAPTURE');
        return { ok: true, action: 'CAPTURE_DUPLICATE' };
      }
      if (outcome === 'CAPTURED_UNAPPLIED') {
        // Verified money the run cannot accept (EXHAUSTED). The credit unit of
        // work was rolled back, so nothing was written as if it had landed. The
        // capture is recorded — with everything a reconciliation needs — under a
        // verdict that is never PROCESSED, and the run does not revive.
        await deps.recordVerdict(
          input.providerEventId,
          'CAPTURED_UNAPPLIED',
          `capture=${captureId} amountCents=${amount} order=${order.id} run=${order.runStatus}`,
        );
        return { ok: false, reason: 'CAPTURED_UNAPPLIED' };
      }
      await deps.recordVerdict(input.providerEventId, 'PROCESSED');
      void activationAllowed(order.runStatus);
      return { ok: true, action: plan.action };
    }

    case 'CAPTURE_DUPLICATE':
      await deps.recordVerdict(input.providerEventId, 'DUPLICATE_CAPTURE');
      return { ok: true, action: plan.action };

    case 'REJECTED':
      await deps.recordVerdict(input.providerEventId, 'REJECTED', plan.reason);
      return { ok: false, reason: 'REJECTED' };

    case 'RECORD_REFUND':
      await deps.recordVerdict(input.providerEventId, 'RECORD_REFUND');
      return { ok: true, action: plan.action };

    default:
      await deps.recordVerdict(input.providerEventId, 'PROCESSED');
      return { ok: true, action: plan.action };
  }
}
