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
  return createCheckoutOrder(checkoutDependencies, {
    runId: formData.get('runId'),
    amountCents: formData.get('amountCents'),
  });
}

export async function captureCheckoutOrderAction(formData: FormData) {
  return captureCheckoutOrder(checkoutDependencies, {
    paymentOrderId: formData.get('paymentOrderId'),
  });
}

export async function checkpointOrderAction(formData: FormData) {
  // Informative state read for the browser-return UX; never credits.
  const principal = await getAuthenticatedPrincipal();
  const paymentOrderId = formData.get('paymentOrderId');
  if (principal === null || typeof paymentOrderId !== 'string') {
    return { ok: false as const };
  }
  const payment = await checkoutDependencies.loadOwnedPayment(principal, paymentOrderId);
  return payment === null ? { ok: false as const } : { ok: true as const, state: payment.state };
}
