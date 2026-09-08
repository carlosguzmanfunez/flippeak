import { describe, expect, it, vi } from 'vitest';

import { captureCheckoutOrder, createCheckoutOrder } from './order-service';
import type { CheckoutDependencies } from './order-service';
import type { AuthenticatedPrincipal } from '@/modules/auth/principal';
import { MAX_FUND_AMOUNT_CENTS } from '@/db/payment-schema';

const OWNER: AuthenticatedPrincipal = { userId: 'owner-1', role: 'ADVERTISER' };
const runId = '11111111-2222-3333-4444-555555555555';
const paymentOrderId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const provider = {
  providerOrderId: 'P-ORDER-1',
  approvalLink: 'https://sandbox.paypal.com/checkoutnow?token=P-ORDER-1',
};

const makeDeps = (overrides: Partial<CheckoutDependencies> = {}): CheckoutDependencies => ({
  resolvePrincipal: vi.fn().mockResolvedValue(OWNER),
  loadOwnedRun: vi.fn().mockResolvedValue({ id: runId, status: 'DRAFT' }),
  insertOrder: vi.fn().mockResolvedValue(paymentOrderId),
  createProviderOrder: vi.fn().mockResolvedValue(provider),
  attachProviderOrder: vi.fn().mockResolvedValue(undefined),
  loadOwnedPayment: vi.fn().mockResolvedValue({
    id: paymentOrderId,
    state: 'PENDING',
    providerOrderId: 'P-ORDER-1',
  }),
  captureProviderOrder: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

describe('createCheckoutOrder', () => {
  it('refuses an unauthenticated caller', async () => {
    const deps = makeDeps({ resolvePrincipal: vi.fn().mockResolvedValue(null) });
    expect(await createCheckoutOrder(deps, { runId, amountCents: 10_000 })).toEqual({
      ok: false,
      reason: 'UNAUTHENTICATED',
    });
  });

  it('collapses absent and not-owned runs', async () => {
    const deps = makeDeps({ loadOwnedRun: vi.fn().mockResolvedValue(null) });
    expect(await createCheckoutOrder(deps, { runId: 'nope', amountCents: 10_000 })).toEqual({
      ok: false,
      reason: 'RUN_NOT_FOUND',
    });
    expect(await createCheckoutOrder(deps, { runId, amountCents: 10_000 })).toEqual({
      ok: false,
      reason: 'RUN_NOT_FOUND',
    });
  });

  it('only a DRAFT run can receive a checkout order', async () => {
    const deps = makeDeps({ loadOwnedRun: vi.fn().mockResolvedValue({ id: runId, status: 'ACTIVE' }) });
    expect(await createCheckoutOrder(deps, { runId, amountCents: 10_000 })).toEqual({
      ok: false,
      reason: 'RUN_NOT_DRAFT',
    });
  });

  it('validates amounts technically only: positive, whole cents, exact domain', async () => {
    const deps = makeDeps();
    for (const amount of [0, -5_000, 10_001.5, MAX_FUND_AMOUNT_CENTS + 1, '10_000' as never]) {
      expect(await createCheckoutOrder(deps, { runId, amountCents: amount })).toEqual({
        ok: false,
        reason: 'INVALID_AMOUNT',
      });
    }
    expect(deps.insertOrder).not.toHaveBeenCalled();
  });

  it('enforces the decoupled COMMERCIAL_BUDGET_POLICY ($5–$5,000, $1 steps)', async () => {
    const deps = makeDeps();
    for (const amount of [499, 500_001, 10_050]) {
      expect(await createCheckoutOrder(deps, { runId, amountCents: amount })).toEqual({
        ok: false,
        reason: 'OUTSIDE_FUNDING_POLICY',
      });
    }
    for (const amount of [500, 10_000, 500_000]) {
      const result = await createCheckoutOrder(deps, { runId, amountCents: amount });
      expect(result.ok).toBe(true);
    }
    expect(deps.insertOrder).toHaveBeenCalledTimes(3);
  });

  it('accepts the sandbox test amount ($10.00) as a technical amount, without inventing policy', async () => {
    const deps = makeDeps();
    expect(await createCheckoutOrder(deps, { runId, amountCents: 10_000 })).toEqual({
      ok: true,
      paymentOrderId,
      providerOrderId: 'P-ORDER-1',
      approvalLink: provider.approvalLink,
    });
    expect(deps.createProviderOrder).toHaveBeenCalledWith({ orderId: paymentOrderId, amountCents: 10_000 });
  });

  it('maps a missing provider configuration cleanly', async () => {
    const deps = makeDeps({
      createProviderOrder: vi.fn().mockRejectedValue(new Error('provider not configured')),
    });
    expect(await createCheckoutOrder(deps, { runId, amountCents: 10_000 })).toEqual({
      ok: false,
      reason: 'PROVIDER_NOT_CONFIGURED',
    });
  });
});

describe('captureCheckoutOrder — server side, but never the credit authority', () => {
  it('captures at PayPal and reports state, with no financial path at all', async () => {
    // Point 3 of the review: "PayPal reported a capture" != "FlipPeak
    // recognized and credited it". The only dependencies this path can touch
    // are the owner load and the provider SDK call — there is no funding,
    // ledger, credit or activation operation in the Capture API path. The
    // internal CAPTURED order state is written exclusively inside the
    // verified webhook transaction (paypal-provider-deps.creditAndActivate).
    const deps = makeDeps();
    expect(await captureCheckoutOrder(deps, { paymentOrderId })).toEqual({
      ok: true,
      captured: true,
      paymentOrderState: 'CAPTURED',
    });
    expect(deps.captureProviderOrder).toHaveBeenCalledWith({ providerOrderId: 'P-ORDER-1' });
    expect(deps.insertOrder).not.toHaveBeenCalled();
    expect(deps.createProviderOrder).not.toHaveBeenCalled();
  });

  it('refuses an already captured order', async () => {
    const deps = makeDeps({
      loadOwnedPayment: vi.fn().mockResolvedValue({
        id: paymentOrderId,
        state: 'CAPTURED',
        providerOrderId: 'P-ORDER-1',
      }),
    });
    expect(await captureCheckoutOrder(deps, { paymentOrderId })).toEqual({
      ok: false,
      reason: 'ORDER_ALREADY_CAPTURED',
    });
    expect(deps.captureProviderOrder).not.toHaveBeenCalled();
  });

  it('collapses absent and not-owned payments into ORDER_NOT_FOUND', async () => {
    const deps = makeDeps({ loadOwnedPayment: vi.fn().mockResolvedValue(null) });
    expect(await captureCheckoutOrder(deps, { paymentOrderId })).toEqual({
      ok: false,
      reason: 'ORDER_NOT_FOUND',
    });
  });
});
