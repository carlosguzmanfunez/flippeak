'use server';

import { getAuthenticatedPrincipal } from '@/lib/auth-guards';
import { checkoutDependencies } from '@/lib/paypal-checkout-service';
import { captureCheckoutOrder, createCheckoutOrder } from '@/modules/payments/paypal/order-service';

/**
 * Checkout Server Actions (Phase 14) — thin adapters only; the wiring lives
 * in paypal-checkout-service.ts. Authorization lives in the call path (owner
 * scope), FormData is read by name, and the client never credits: the verified
 * webhook remains the single financial authority (ADR-014).
 */

export async function createCheckoutOrderAction(formData: FormData) {
  // FormData delivers strings: convert only digit-safe amounts; anything else
  // reaches the orchestration unparsed and is rejected (INVALID_AMOUNT).
  const rawAmount = formData.get('amountCents');
  const amountCents =
    typeof rawAmount === 'string' && /^\d+$/.test(rawAmount) ? Number(rawAmount) : rawAmount;
  return createCheckoutOrder(checkoutDependencies, {
    runId: formData.get('runId'),
    amountCents,
  });
}

export async function captureCheckoutOrderAction(formData: FormData) {
  return captureCheckoutOrder(checkoutDependencies, {
    paymentOrderId: formData.get('paymentOrderId'),
  });
}

export async function checkpointOrderAction(formData: FormData) {
  // Browser-return UX read. Capture is SERVER-side on the approved order
  // (intent — the verified webhook remains the only credit authority). Never
  // credits from any client path.
  const principal = await getAuthenticatedPrincipal();
  const paymentOrderId = formData.get('paymentOrderId');
  if (principal === null || typeof paymentOrderId !== 'string') {
    return { ok: false as const };
  }
  const payment = await checkoutDependencies.loadOwnedPayment(principal, paymentOrderId);
  if (payment === null || payment.providerOrderId === null) {
    return { ok: false as const };
  }
  if (payment.state === 'PENDING') {
    try {
      await checkoutDependencies.captureProviderOrder({ providerOrderId: payment.providerOrderId });
      return { ok: true as const, state: 'CAPTURED' as const };
    } catch {
      // Not approved yet or provider unavailable: report the local truth.
      return { ok: true as const, state: payment.state };
    }
  }
  return { ok: true as const, state: payment.state };
}
