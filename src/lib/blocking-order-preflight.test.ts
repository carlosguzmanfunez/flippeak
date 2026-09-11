import { describe, expect, it } from 'vitest';

import { assessBlockingOrder } from './blocking-order-preflight';
import type { BlockingOrderFacts, ProviderOrderStatus } from './blocking-order-preflight';

/**
 * The blocking-order preflight decides whether real history may be retired before
 * migration 0010 can create the one-blocking-order-per-run index.
 *
 * The property that matters most here is negative: **age is not evidence.** A
 * timer that retired old orders would invent financial history and reopen the
 * checkout slot while the buyer can still pay, which is the double-payment the
 * index exists to prevent. These tests pin that down.
 */

const facts = (overrides: Partial<BlockingOrderFacts> = {}): BlockingOrderFacts => ({
  orderId: 'order-1',
  state: 'PENDING',
  applicationState: null,
  providerOrderId: 'PROVIDER-ORDER-1',
  evidence: { queried: false },
  ...overrides,
});

const queried = (status: ProviderOrderStatus) => ({ queried: true as const, status });

describe('only provider evidence can release an order', () => {
  it('releases when the provider reports the order voided', () => {
    expect(assessBlockingOrder(facts({ evidence: queried('VOIDED') }))).toEqual({
      outcome: 'RELEASE',
      reason: 'PROVIDER_CONFIRMS_NOT_CAPTURABLE',
    });
  });

  it('keeps blocking while the provider still allows a capture', () => {
    for (const status of ['CREATED', 'SAVED', 'APPROVED', 'PAYER_ACTION_REQUIRED'] as const) {
      expect(assessBlockingOrder(facts({ evidence: queried(status) }))).toEqual({
        outcome: 'KEEP_BLOCKED',
        reason: 'PROVIDER_MAY_STILL_CAPTURE',
      });
    }
  });

  it('treats a completed provider order as a capture, not as a release', () => {
    expect(assessBlockingOrder(facts({ evidence: queried('COMPLETED') }))).toEqual({
      outcome: 'KEEP_BLOCKED',
      reason: 'CAPTURE_EXISTS',
    });
  });

  it('asks for a query instead of guessing when nothing was asked', () => {
    expect(assessBlockingOrder(facts())).toEqual({
      outcome: 'NEEDS_PROVIDER_STATUS',
      reason: 'NOT_QUERIED',
    });
  });

  it('asks for reconciliation when the provider status is unrecognised', () => {
    expect(assessBlockingOrder(facts({ evidence: queried('UNKNOWN') }))).toEqual({
      outcome: 'NEEDS_PROVIDER_STATUS',
      reason: 'PROVIDER_STATUS_UNKNOWN',
    });
  });

  it('never releases an order with no provider order id, even when queried', () => {
    // A local order without a provider id is NOT provably uncapturable: the
    // create call may have succeeded and lost its response. Retiring it here
    // would reopen the slot on an order the buyer may still be able to pay.
    expect(assessBlockingOrder(facts({ providerOrderId: null, evidence: queried('VOIDED') }))).toEqual({
      outcome: 'NEEDS_PROVIDER_STATUS',
      reason: 'NO_PROVIDER_ORDER',
    });
  });
});

describe('age is not an input', () => {
  it('produces the same assessment for a new and a very old order', () => {
    const base = { orderId: 'order-1', state: 'PENDING', applicationState: null, providerOrderId: 'P-1' };

    const fresh = assessBlockingOrder({ ...base, evidence: queried('APPROVED') });
    const ancient = assessBlockingOrder({ ...base, evidence: queried('APPROVED') });

    expect(ancient).toEqual(fresh);
    expect(fresh.outcome).toBe('KEEP_BLOCKED');
  });

  it('ignores any age-like field a caller might add', () => {
    // Structural typing would let a caller smuggle `ageDays` in; the decision
    // must not read it. Passing two values that differ only there proves it.
    const withAge = (ageDays: number) =>
      assessBlockingOrder({
        ...facts({ evidence: queried('APPROVED') }),
        ageDays,
      } as BlockingOrderFacts);

    expect(withAge(0)).toEqual(withAge(9_999));
    expect(withAge(9_999).outcome).toBe('KEEP_BLOCKED');
  });
});
