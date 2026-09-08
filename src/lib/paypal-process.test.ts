import { describe, expect, it, vi } from 'vitest';

import { processVerifiedEvent } from './paypal-process';
import type { WebhookFlowDeps, WebhookInput } from './paypal-process';

const captureCompleted: WebhookInput = {
  providerEventId: 'evt-cap-1',
  eventType: 'PAYMENT.CAPTURE.COMPLETED',
  resource: { id: 'cap-1', amount: { value: '100.00', currency_code: 'USD' } },
};

const orderApproved: WebhookInput = {
  providerEventId: 'evt-appr-1',
  eventType: 'CHECKOUT.ORDER.APPROVED',
  resource: { id: 'order-1' },
};

const localOrder = (overrides: Partial<Awaited<ReturnType<WebhookFlowDeps['loadOrder']>> & object> = {}) => ({
  id: 'order-1',
  state: 'APPROVED',
  amountCents: 10_000,
  currency: 'USD',
  providerCaptureId: null,
  providerOrderId: 'order-1',
  runId: 'run-1',
  runStatus: 'DRAFT',
  ...overrides,
});

const makeDeps = (overrides: Partial<WebhookFlowDeps> = {}, orderValue: unknown = localOrder()): WebhookFlowDeps => ({
  insertEventIfAbsent: vi.fn().mockResolvedValue(true),
  loadOrder: vi.fn().mockResolvedValue(orderValue),
  markApproved: vi.fn().mockResolvedValue(undefined),
  creditAndActivate: vi.fn().mockResolvedValue('CREDITED'),
  recordOrphan: vi.fn().mockResolvedValue(undefined),
  recordVerdict: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

describe('processVerifiedEvent — level-1 idempotency', () => {
  it('skips an already processed event without touching money', async () => {
    const deps = makeDeps({ insertEventIfAbsent: vi.fn().mockResolvedValue(false) });
    expect(await processVerifiedEvent(deps, captureCompleted)).toEqual({
      ok: true,
      action: 'EVENT_ALREADY_PROCESSED',
    });
    expect(deps.creditAndActivate).not.toHaveBeenCalled();
  });

  it('rejects unparseable events before any write', async () => {
    const deps = makeDeps();
    expect(await processVerifiedEvent(deps, { ...captureCompleted, eventType: '' })).toEqual({
      ok: false,
      reason: 'UNPARSEABLE',
    });
    expect(deps.insertEventIfAbsent).not.toHaveBeenCalled();
  });
});

describe('processVerifiedEvent — capture sovereignty', () => {
  it('records an orphan capture with no local order (money never disappears)', async () => {
    const deps = makeDeps({}, null);
    expect(await processVerifiedEvent(deps, captureCompleted)).toEqual({ ok: true, action: 'ORPHAN_CAPTURE' });
    expect(deps.recordOrphan).toHaveBeenCalledWith('evt-cap-1', expect.any(String));
    expect(deps.creditAndActivate).not.toHaveBeenCalled();
  });

  it('credits a capture arriving on an ABANDONED local order (intent != money)', async () => {
    const deps = makeDeps({}, localOrder({ state: 'ABANDONED' }));
    expect(await processVerifiedEvent(deps, captureCompleted)).toEqual({ ok: true, action: 'CREDIT_AND_CAPTURE' });
    expect(deps.creditAndActivate).toHaveBeenCalledWith({ orderId: 'order-1', captureId: 'cap-1', amountCents: 10_000 });
  });

  it('maps a level-2 capture conflict to DUPLICATE_CAPTURE', async () => {
    const deps = makeDeps({ creditAndActivate: vi.fn().mockResolvedValue('CAPTURE_EXISTS') });
    expect(await processVerifiedEvent(deps, captureCompleted)).toEqual({ ok: true, action: 'CAPTURE_DUPLICATE' });
    expect(deps.recordVerdict).toHaveBeenCalledWith('evt-cap-1', 'DUPLICATE_CAPTURE');
  });

  it('rejects an amount mismatch and persists the verdict', async () => {
    const deps = makeDeps();
    const event = { ...captureCompleted, resource: { id: 'cap-1', amount: { value: '99.99', currency_code: 'USD' } } };
    expect(await processVerifiedEvent(deps, event)).toEqual({ ok: false, reason: 'REJECTED' });
    expect(deps.recordVerdict).toHaveBeenCalledWith('evt-cap-1', 'REJECTED', 'AMOUNT_MISMATCH');
    expect(deps.creditAndActivate).not.toHaveBeenCalled();
  });
});

describe('processVerifiedEvent — approval and verdicts', () => {
  it('marks an order approved', async () => {
    const deps = makeDeps({}, localOrder({ state: 'PENDING' }));
    expect(await processVerifiedEvent(deps, orderApproved)).toEqual({ ok: true, action: 'MARK_APPROVED' });
    expect(deps.markApproved).toHaveBeenCalledWith('order-1');
  });

  it('persists a PROCEESSED verdict after a successful credit+activation', async () => {
    const deps = makeDeps();
    expect(await processVerifiedEvent(deps, captureCompleted)).toEqual({ ok: true, action: 'CREDIT_AND_CAPTURE' });
    expect(deps.recordVerdict).toHaveBeenCalledWith('evt-cap-1', 'PROCESSED');
  });

  it('keeps the credit when activation cannot proceed (NO_ACTIVATION verdict path)', async () => {
    const deps = makeDeps({ creditAndActivate: vi.fn().mockResolvedValue('NO_ACTIVATION') }, localOrder({ runStatus: 'ACTIVE' }));
    expect(await processVerifiedEvent(deps, captureCompleted)).toEqual({ ok: true, action: 'CREDIT_AND_CAPTURE' });
    expect(deps.creditAndActivate).toHaveBeenCalledTimes(1);
  });
});
