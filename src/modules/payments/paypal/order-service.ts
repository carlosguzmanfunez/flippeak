import { decideUserAccess } from '@/modules/auth/access';
import type { AuthenticatedPrincipal } from '@/modules/auth/principal';
import { isUuidLike } from '@/modules/campaigns/campaign-run';
import { MAX_FUND_AMOUNT_CENTS } from '@/db/payment-schema';

/**
 * Checkout orchestration (Phase 10-B, ADR-014).
 *
 * The create/capture/status surface is ownered and server-driven; the browser
 * return alone never touches money (ADR-014 §6): capturing through the API
 * (server-side, owner-authorized) only advances the PayPal state; the verified
 * webhook remains the only crediting path.
 *
 * Amount rule is purely technical here: a whole number of cents, strictly
 * positive, inside the exact-representation domain. The commercial budget
 * policy stays explicitly undecided.
 */

export type CheckoutOrderResult =
  | { readonly ok: true; readonly paymentOrderId: string; readonly providerOrderId: string; readonly approvalLink: string }
  | { readonly ok: false; readonly reason: 'UNAUTHENTICATED' }
  | { readonly ok: false; readonly reason: 'RUN_NOT_FOUND' }
  | { readonly ok: false; readonly reason: 'RUN_NOT_DRAFT' }
  | { readonly ok: false; readonly reason: 'INVALID_AMOUNT' }
  | { readonly ok: false; readonly reason: 'PROVIDER_NOT_CONFIGURED' }
  | { readonly ok: false; readonly reason: 'UNEXPECTED' };

export type CaptureCheckoutResult =
  | { readonly ok: true; readonly captured: boolean; readonly paymentOrderState: 'PENDING' | 'APPROVED' | 'CAPTURED' }
  | { readonly ok: false; readonly reason: 'UNAUTHENTICATED' | 'ORDER_NOT_FOUND' | 'ORDER_ALREADY_CAPTURED' | 'PROVIDER_NOT_CONFIGURED' | 'UNEXPECTED' };

export type CheckoutDependencies = {
  readonly resolvePrincipal: () => Promise<AuthenticatedPrincipal | null>;
  /** Owner-scoped; null when absent or not owned. */
  readonly loadOwnedRun: (
    principal: AuthenticatedPrincipal,
    runId: string,
  ) => Promise<{ readonly id: string; readonly status: 'DRAFT' | 'ACTIVE' | 'EXHAUSTED' } | null>;
  readonly insertOrder: (input: { readonly runId: string; readonly amountCents: number }) => Promise<string>;
  /**
   * Provider call (SDK, lazily configured). Throws PROVIDER_NOT_CONFIGURED
   * when credentials are absent. Returns the provider order id and the
   * approval link for the payer.
   */
  readonly createProviderOrder: (input: { readonly orderId: string; readonly amountCents: number }) => Promise<{
    readonly providerOrderId: string;
    readonly approvalLink: string;
  }>;
  readonly attachProviderOrder: (paymentOrderId: string, providerOrderId: string) => Promise<void>;
  /** Owner-scoped payment load; null when absent/not owned/not found. */
  readonly loadOwnedPayment: (
    principal: AuthenticatedPrincipal,
    paymentOrderId: string,
  ) => Promise<{ readonly id: string; readonly state: 'PENDING' | 'APPROVED' | 'CAPTURED'; readonly providerOrderId: string | null } | null>;
  readonly captureProviderOrder: (input: { readonly providerOrderId: string }) => Promise<void>;
};

async function authenticate(deps: CheckoutDependencies): Promise<AuthenticatedPrincipal | null> {
  const access = decideUserAccess(await deps.resolvePrincipal());
  return access.outcome === 'ALLOW' ? access.principal : null;
}

function isFundableCheckoutAmount(cents: unknown): cents is number {
  return (
    Number.isSafeInteger(cents) &&
    (cents as number) > 0 &&
    (cents as number) <= MAX_FUND_AMOUNT_CENTS
  );
}

export async function createCheckoutOrder(
  deps: CheckoutDependencies,
  input: { readonly runId: unknown; readonly amountCents: unknown },
): Promise<CheckoutOrderResult> {
  const principal = await authenticate(deps);
  if (principal === null) return { ok: false, reason: 'UNAUTHENTICATED' };

  if (!isUuidLike(input.runId)) return { ok: false, reason: 'RUN_NOT_FOUND' };
  if (!isFundableCheckoutAmount(input.amountCents)) return { ok: false, reason: 'INVALID_AMOUNT' };

  const run = await deps.loadOwnedRun(principal, input.runId);
  if (run === null) return { ok: false, reason: 'RUN_NOT_FOUND' };
  if (run.status !== 'DRAFT') return { ok: false, reason: 'RUN_NOT_DRAFT' };

  try {
    const paymentOrderId = await deps.insertOrder({ runId: run.id, amountCents: input.amountCents });
    const provider = await deps.createProviderOrder({
      orderId: paymentOrderId,
      amountCents: input.amountCents,
    });
    await deps.attachProviderOrder(paymentOrderId, provider.providerOrderId);
    return {
      ok: true,
      paymentOrderId,
      providerOrderId: provider.providerOrderId,
      approvalLink: provider.approvalLink,
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'provider not configured') {
      return { ok: false, reason: 'PROVIDER_NOT_CONFIGURED' };
    }
    return { ok: false, reason: 'UNEXPECTED' };
  }
}

export async function captureCheckoutOrder(
  deps: CheckoutDependencies,
  input: { readonly paymentOrderId: unknown },
): Promise<CaptureCheckoutResult> {
  const principal = await authenticate(deps);
  if (principal === null) return { ok: false, reason: 'UNAUTHENTICATED' };

  if (!isUuidLike(input.paymentOrderId)) return { ok: false, reason: 'ORDER_NOT_FOUND' };

  const payment = await deps.loadOwnedPayment(principal, input.paymentOrderId);
  if (payment === null) return { ok: false, reason: 'ORDER_NOT_FOUND' };
  if (payment.state === 'CAPTURED' || payment.providerOrderId === null) {
    return { ok: false, reason: 'ORDER_ALREADY_CAPTURED' };
  }

  try {
    await deps.captureProviderOrder({ providerOrderId: payment.providerOrderId });
    // No credit here: the verified webhook is the financial authority.
    return { ok: true, captured: true, paymentOrderState: 'CAPTURED' };
  } catch (error) {
    if (error instanceof Error && error.message === 'provider not configured') {
      return { ok: false, reason: 'PROVIDER_NOT_CONFIGURED' };
    }
    return { ok: false, reason: 'UNEXPECTED' };
  }
}
