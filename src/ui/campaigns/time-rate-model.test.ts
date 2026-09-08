import { describe, expect, it } from 'vitest';

import { TIME_RATE } from '@/config/domain-config';
import { isValidTimeRate } from '@/modules/economics/time-rate';
import type { CreateCampaignRunResult } from '@/modules/campaigns/create-campaign-run';

import {
  DEFAULT_RATE,
  HIGH_MAX,
  HIGH_MIN,
  INVALID_RATE_MESSAGE,
  LOGIN_REDIRECT,
  NOT_ELIGIBLE_MESSAGE,
  NOT_FOUND_MESSAGE,
  STANDARD_MAX,
  STANDARD_MIN,
  STEP,
  SUCCESS_REDIRECT,
  UNEXPECTED_MESSAGE,
  clampToMode,
  isSubmittableRate,
  modeForRate,
  parseHighRateDollars,
  resolveRunSubmitOutcome,
  submitLabel,
} from './time-rate-model';

const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';

describe('the two bands come from the approved configuration', () => {
  it('does not restate the range', () => {
    expect(STANDARD_MIN).toBe(TIME_RATE.minCentsPerHour);
    expect(STANDARD_MAX).toBe(TIME_RATE.maxStandardCentsPerHour);
    expect(HIGH_MAX).toBe(TIME_RATE.maxCentsPerHour);
    expect(STEP).toBe(TIME_RATE.standardStepCentsPerHour);
  });

  it('starts High Rate one whole dollar above the standard ceiling', () => {
    expect(HIGH_MIN).toBe(10_100);
    expect(HIGH_MIN - STANDARD_MAX).toBe(STEP);
  });

  it('leaves no gap or overlap between the bands', () => {
    expect(modeForRate(STANDARD_MAX)).toBe('STANDARD');
    expect(modeForRate(HIGH_MIN)).toBe('HIGH');
  });

  it('offers a default inside the standard band', () => {
    expect(isValidTimeRate(DEFAULT_RATE)).toBe(true);
    expect(modeForRate(DEFAULT_RATE)).toBe('STANDARD');
  });
});

describe('switching bands', () => {
  it('clamps down to $100 when leaving High Rate', () => {
    expect(clampToMode(50_000, 'STANDARD')).toBe(STANDARD_MAX);
  });

  it('clamps up to $101 when entering High Rate from a low value', () => {
    expect(clampToMode(1_000, 'HIGH')).toBe(HIGH_MIN);
  });

  it('leaves a value already inside the band alone', () => {
    expect(clampToMode(4_700, 'STANDARD')).toBe(4_700);
    expect(clampToMode(50_000, 'HIGH')).toBe(50_000);
  });

  it('always produces a valid rate', () => {
    for (const rate of [0, 1, 99, 4_700, 10_000, 10_100, 100_000, 999_999]) {
      expect(isValidTimeRate(clampToMode(rate, 'STANDARD'))).toBe(true);
      expect(isValidTimeRate(clampToMode(rate, 'HIGH'))).toBe(true);
    }
  });
});

describe('High Rate entry is in whole dollars', () => {
  it('accepts the band ends', () => {
    expect(parseHighRateDollars('101')).toBe(10_100);
    expect(parseHighRateDollars('1000')).toBe(100_000);
    expect(parseHighRateDollars('  500  ')).toBe(50_000);
  });

  const rejected = ['100', '1001', '0', '', '47.5', '100.5', 'abc', '0x64', '-101', '1e3', '١٠١'];

  it.each(rejected.map((text) => ({ text })))('rejects %j', ({ text }) => {
    expect(parseHighRateDollars(text)).toBeNull();
  });

  it('never yields a fractional-dollar rate', () => {
    for (const text of ['101', '250', '999', '1000']) {
      const parsed = parseHighRateDollars(text);
      expect(parsed).not.toBeNull();
      if (parsed !== null) expect(parsed % STEP).toBe(0);
    }
  });
});

describe('submittability', () => {
  it('accepts a standard value in standard mode', () => {
    expect(isSubmittableRate(STANDARD_MIN, 'STANDARD')).toBe(true);
    expect(isSubmittableRate(STANDARD_MAX, 'STANDARD')).toBe(true);
  });

  it('accepts a High Rate value in high mode', () => {
    expect(isSubmittableRate(HIGH_MIN, 'HIGH')).toBe(true);
    expect(isSubmittableRate(HIGH_MAX, 'HIGH')).toBe(true);
  });

  it('refuses a value that belongs to the other band', () => {
    expect(isSubmittableRate(50_000, 'STANDARD')).toBe(false);
    expect(isSubmittableRate(1_000, 'HIGH')).toBe(false);
  });

  it('refuses fractional dollars and out-of-range values in both modes', () => {
    for (const rate of [150, 4_750, 99, 100_001, 0, -100]) {
      expect(isSubmittableRate(rate, 'STANDARD')).toBe(false);
      expect(isSubmittableRate(rate, 'HIGH')).toBe(false);
    }
  });
});

describe('submit outcome', () => {
  it('redirects to the campaign runs list on success', () => {
    const result: CreateCampaignRunResult = { ok: true, runId: 'run_1' };
    expect(resolveRunSubmitOutcome(result, CAMPAIGN_ID)).toEqual({
      kind: 'REDIRECT',
      to: `/campaigns/${CAMPAIGN_ID}/runs`,
    });
    expect(SUCCESS_REDIRECT(CAMPAIGN_ID)).toContain('/runs');
  });

  it('sends an unauthenticated caller to login', () => {
    expect(
      resolveRunSubmitOutcome({ ok: false, reason: 'UNAUTHENTICATED' }, CAMPAIGN_ID),
    ).toEqual({ kind: 'REDIRECT', to: LOGIN_REDIRECT });
  });

  const failures = [
    { reason: 'INVALID_TIME_RATE' as const, message: INVALID_RATE_MESSAGE },
    { reason: 'CAMPAIGN_NOT_FOUND' as const, message: NOT_FOUND_MESSAGE },
    { reason: 'PREVIOUS_RUN_NOT_FOUND' as const, message: NOT_FOUND_MESSAGE },
    { reason: 'PREVIOUS_RUN_NOT_ELIGIBLE' as const, message: NOT_ELIGIBLE_MESSAGE },
    { reason: 'UNEXPECTED' as const, message: UNEXPECTED_MESSAGE },
  ];

  it.each(failures)('maps $reason to a fixed sentence', ({ reason, message }) => {
    expect(resolveRunSubmitOutcome({ ok: false, reason }, CAMPAIGN_ID)).toEqual({
      kind: 'FORM_ERROR',
      message,
    });
  });

  it('leaks no backend detail in any outcome', () => {
    const all = failures.map(({ reason }) =>
      resolveRunSubmitOutcome({ ok: false, reason }, CAMPAIGN_ID),
    );
    expect(JSON.stringify(all)).not.toMatch(/constraint|pkey|stack|select |insert |postgres/i);
  });

  it('mentions no budget, payment or funding anywhere', () => {
    const messages = [
      INVALID_RATE_MESSAGE,
      NOT_FOUND_MESSAGE,
      NOT_ELIGIBLE_MESSAGE,
      UNEXPECTED_MESSAGE,
    ].join(' ');
    expect(messages).not.toMatch(/budget|payment|paypal|fund|balance|charge/i);
  });
});

describe('pending state', () => {
  it('changes the submit label while the action runs', () => {
    expect(submitLabel(false)).toBe('Create run');
    expect(submitLabel(true)).toBe('Creating…');
  });
});
