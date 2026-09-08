import { and, eq } from 'drizzle-orm';

import { campaign, campaignRun, paymentOrder } from '@/db/schema';
import { db } from '@/db/client';
import { getAuthenticatedPrincipal } from '@/lib/auth-guards';
import type { CheckoutDependencies } from '@/modules/payments/paypal/order-service';
import { captureCheckoutOrder, createCheckoutOrder } from '@/modules/payments/paypal/order-service';

/**
 * Server Actions for the checkout surface (Phase 10-B, ADR-014).
 *
 * These are reachable POST endpoints: authorization lives in the call path,
 * FormData is read by name, no spread. The provider SDK itself is lazily
 * loaded inside paypal-sdk.ts; if credentials are absent the SDK wrapper
 * throws `provider not configured`, which the orchestration maps cleanly.
 */

const dependencies: CheckoutDependencies = {
  resolvePrincipal: getAuthenticatedPrincipal,
  loadOwnedRun: async (principal, runId) => {
    const rows = await db()
      .select({ id: campaignRun.id, status: campaignRun.status })
      .from(campaignRun)
      .innerJoin(campaign, eq(campaignRun.campaignId, campaign.id))
      .where(and(eq(campaignRun.id, runId), eq(campaign.ownerUserId, principal.userId)))
      .limit(1);
    return rows[0] ?? null;
  },
  insertOrder: async ({ runId, amountCents }) => {
    const inserted = await db()
      .insert(paymentOrder)
      .values({ runId, amountCents, currency: 'USD', provider: 'paypal' })
      .returning({ id: paymentOrder.id });
    return inserted[0]!.id;
  },
  createProviderOrder: async ({ orderId, amountCents }) => {
    const sdk = await paypalSdkClient();
    const request = new sdk.orders.OrdersCreateRequest();
    request.prefer('return=representation');
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: orderId,
          amount: { currency_code: 'USD', value: (amountCents / 100).toFixed(2) },
        },
      ],
    });
    const response = await sdk.client.execute(request);
    const result = response.result as { id: string; links: { rel: string; href: string }[] };
    const approval = result.links.find((link) => link.rel === 'approve');
    const approvalLink = approval?.href ?? '';
    return { providerOrderId: result.id, approvalLink };
  },
  attachProviderOrder: async (paymentOrderId, providerOrderId) => {
    await db()
      .update(paymentOrder)
      .set({ providerOrderId })
      .where(eq(paymentOrder.id, paymentOrderId));
  },
  loadOwnedPayment: async (principal, paymentOrderId) => {
    const rows = await db()
      .select({
        id: paymentOrder.id,
        state: paymentOrder.state,
        providerOrderId: paymentOrder.providerOrderId,
      })
      .from(paymentOrder)
      .innerJoin(campaignRun, eq(paymentOrder.runId, campaignRun.id))
      .innerJoin(campaign, eq(campaignRun.campaignId, campaign.id))
      .where(and(eq(paymentOrder.id, paymentOrderId), eq(campaign.ownerUserId, principal.userId)))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    if (row.state !== 'PENDING' && row.state !== 'APPROVED' && row.state !== 'CAPTURED') {
      return null;
    }
    return { id: row.id, state: row.state, providerOrderId: row.providerOrderId };
  },
  captureProviderOrder: async ({ providerOrderId }) => {
    const sdk = await paypalSdkClient();
    const request = new sdk.orders.OrdersCaptureRequest(providerOrderId);
    await sdk.client.execute(request);
  },
};

async function paypalSdkClient() {
  const sdk = await import('@paypal/checkout-server-sdk');
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('provider not configured');
  const Environment =
    process.env.PAYPAL_ENVIRONMENT === 'production'
      ? sdk.core.LiveEnvironment
      : sdk.core.SandboxEnvironment;
  return { client: new sdk.core.PayPalHttpClient(new Environment(clientId, clientSecret)), orders: sdk.orders };
}

export async function createCheckoutOrderAction(formData: FormData) {
  return createCheckoutOrder(dependencies, {
    runId: formData.get('runId'),
    amountCents: formData.get('amountCents'),
  });
}

export async function captureCheckoutOrderAction(formData: FormData) {
  return captureCheckoutOrder(dependencies, {
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
  const payment = await dependencies.loadOwnedPayment(principal, paymentOrderId);
  return payment === null ? { ok: false as const } : { ok: true as const, state: payment.state };
}
