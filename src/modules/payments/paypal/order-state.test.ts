import { describe, expect, it } from 'vitest';

import { activationAllowed, parseProviderEvent, planProcessing } from './order-state';
import type { LocalOrderSnapshot, ParsedEvent } from './order-state';

const order = (overrides: Partial<LocalOrderSnapshot> = {}): LocalOrderSnapshot => ({
  state: 'APPROVED',
  amountCents: 10_000,
  currency: 'USD',
  providerCaptureId: null,
  ...overrides,
});

const completed = (overrides: Partial<ParsedEvent> = {}): ParsedEvent => ({
  kind: 'CAPTURE_COMPLETED',
  providerEventId: 'evt-1',
  providerOrderId: 'order-1',
  providerCaptureId: 'cap-1',
  amountCents: 10_000,
  currency: 'USD',
  ...overrides,
});

const approve = (overrides: Partial<ParsedEvent> = {}): ParsedEvent => ({
  kind: 'ORDER_APPROVED',
  providerEventId: 'evt-a',
  providerOrderId: 'order-1',
  providerCaptureId: null,
  amountCents: null,
  currency: null,
  ...overrides,
});

describe('parseProviderEvent', () => {
  it('normalizes an approved order', () => {
    const parsed = parseProviderEvent('CHECKOUT.ORDER.APPROVED', { id: 'order-1' });
    expect(parsed).toMatchObject({ kind: 'ORDER_APPROVED', providerOrderId: 'order-1' });
  });

  it('normalizes a completed capture and parses the amount exactly', () => {
    const parsed = parseProviderEvent('PAYMENT.CAPTURE.COMPLETED', {
      id: 'cap-1',
      amount: { value: '47.25', currency_code: 'USD' },
    });
    expect(parsed).toMatchObject({ kind: 'CAPTURE_COMPLETED', providerCaptureId: 'cap-1', amountCents: 4_725, currency: 'USD' });
  });

  it('refuses an amount that is not exactly two decimals (no float parsing)', () => {
    const parsed = parseProviderEvent('PAYMENT.CAPTURE.COMPLETED', {
      id: 'cap-2',
      amount: { value: '47.251', currency_code: 'USD' },
    });
    expect(parsed).toMatchObject({ amountCents: null });
  });

  it('maps unknown events to IGNORED and malformed ones to a failure', () => {
    expect(parseProviderEvent('SOMETHING.ELSE', {})).toBe('UNKNOWN_EVENT');
    expect(parseProviderEvent('PAYMENT.CAPTURE.COMPLETED', {})).toBe('MISSING_EVENT_ID');
  });
});

describe('planProcessing — capture sovereignty (ADR-014)', () => {
  it('credits a capture on a PENDING local order (out-of-order delivery tolerated)', () => {
    expect(planProcessing({ event: completed(), localOrder: order({ state: 'PENDING' }), eventAlreadyProcessed: false })).toEqual({
      action: 'CREDIT_AND_CAPTURE',
    });
  });

  it('upgrades a locally ABANDONED order on a verified capture — money is authority', () => {
    expect(
      planProcessing({ event: completed(), localOrder: order({ state: 'ABANDONED' }), eventAlreadyProcessed: false }),
    ).toEqual({ action: 'CREDIT_AND_CAPTURE' });
  });

  it('never discards an unknown capture: ORPHAN_CAPTURE for reconciliation', () => {
    expect(planProcessing({ event: completed(), localOrder: null, eventAlreadyProcessed: false })).toEqual({
      action: 'ORPHAN_CAPTURE',
    });
  });

  it('detects level-2 duplication: another event, same capture, already credited', () => {
    expect(
      planProcessing({
        event: completed({ providerEventId: 'evt-2' }),
        localOrder: order({ providerCaptureId: 'cap-1' }),
        eventAlreadyProcessed: false,
      }),
    ).toEqual({ action: 'CAPTURE_DUPLICATE' });
  });

  it('rejects an amount mismatch instead of crediting', () => {
    expect(planProcessing({ event: completed({ amountCents: 9_999 }), localOrder: order(), eventAlreadyProcessed: false })).toEqual({
      action: 'REJECTED',
      reason: 'AMOUNT_MISMATCH',
    });
  });

  it('rejects a currency mismatch', () => {
    expect(planProcessing({ event: completed({ currency: 'EUR' }), localOrder: order(), eventAlreadyProcessed: false })).toEqual({
      action: 'REJECTED',
      reason: 'CURRENCY_MISMATCH',
    });
  });

  it('is idempotent at level 1: already processed events are skipped first', () => {
    expect(planProcessing({ event: completed(), localOrder: order(), eventAlreadyProcessed: true })).toEqual({
      action: 'EVENT_ALREADY_PROCESSED',
    });
  });
});

describe('planProcessing — approve/refund/unknown', () => {
  it('marks an order approved from the approved event', () => {
    expect(planProcessing({ event: approve(), localOrder: order({ state: 'PENDING' }), eventAlreadyProcessed: false })).toEqual({
      action: 'MARK_APPROVED',
    });
  });

  it('records refunds (model only) and ignores unknown kinds', () => {
    expect(planProcessing({ event: { ...completed(), kind: 'REFUNDED' }, localOrder: order(), eventAlreadyProcessed: false })).toEqual({
      action: 'RECORD_REFUND',
    });
    expect(planProcessing({ event: { ...completed(), kind: 'IGNORED' }, localOrder: order(), eventAlreadyProcessed: false })).toEqual({
      action: 'IGNORED',
    });
  });
});

describe('activationAllowed', () => {
  it('only a DRAFT run can be activated by the capture', () => {
    expect(activationAllowed('DRAFT')).toBe(true);
    expect(activationAllowed('ACTIVE')).toBe(false);
    expect(activationAllowed('EXHAUSTED')).toBe(false);
  });
});
