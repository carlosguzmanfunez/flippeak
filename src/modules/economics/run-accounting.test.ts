import { describe, expect, it } from 'vitest';

import {
  CENT_MS_PER_CENT,
  boostRun,
  centsToCentMilliseconds,
  projectRun,
  settleRun,
  toCentMilliseconds,
} from './run-accounting';
import type { RunAccountingState } from './run-accounting';

const ANCHOR = 1_700_000_000_000; // an arbitrary but fixed epoch instant
const HOUR_MS = 3_600_000;

/** $47/hour, $50 credited, nothing consumed, anchored at ANCHOR. */
const funded = (overrides: Partial<RunAccountingState> = {}): RunAccountingState => ({
  timeRateCentsPerHour: 4_700,
  creditedCents: 5_000,
  consumedCentMs: 0,
  rateAnchorAtMs: ANCHOR,
  ...overrides,
});

const project = (state: RunAccountingState, atMs: number) => {
  const result = projectRun(state, atMs);
  if (!result.ok) throw new Error(`unexpected failure: ${result.reason}`);
  return result.value;
};

const settle = (state: RunAccountingState, atMs: number) => {
  const result = settleRun(state, atMs);
  if (!result.ok) throw new Error(`unexpected failure: ${result.reason}`);
  return result.value;
};

describe('units', () => {
  it('defines one cent as the milliseconds in an hour', () => {
    expect(CENT_MS_PER_CENT).toBe(3_600_000);
    expect(CENT_MS_PER_CENT).toBe(HOUR_MS);
  });

  it('converts cents to cent-ms by multiplication only', () => {
    expect(centsToCentMilliseconds(0)).toBe(0);
    expect(centsToCentMilliseconds(1)).toBe(3_600_000);
    expect(centsToCentMilliseconds(5_000)).toBe(18_000_000_000);
  });

  it('refuses a non-integer or negative quantity', () => {
    expect(() => toCentMilliseconds(1.5)).toThrow(TypeError);
    expect(() => toCentMilliseconds(-1)).toThrow(TypeError);
    expect(() => toCentMilliseconds(Number.NaN)).toThrow(TypeError);
    expect(() => toCentMilliseconds(Number.MAX_SAFE_INTEGER + 1)).toThrow(TypeError);
  });
});

describe('nominal projection', () => {
  it('charges exactly rate × elapsed milliseconds', () => {
    const p = project(funded(), ANCHOR + 1_000);
    expect(p.elapsedMs).toBe(1_000);
    expect(p.consumedCentMs).toBe(4_700 * 1_000);
  });

  it('charges one hour at $47/hour as exactly 4700 cents', () => {
    const p = project(funded(), ANCHOR + HOUR_MS);
    expect(p.consumedCentMs / CENT_MS_PER_CENT).toBe(4_700);
    expect(p.remainingCentMs / CENT_MS_PER_CENT).toBe(5_000 - 4_700);
  });

  it('charges one second at $1/hour without rounding to a whole cent', () => {
    // 100 cents/hour for 1000 ms = 100_000 cent-ms = 0.0277… cents. A model
    // rounding to cents would record 0 here and lose the second entirely.
    const p = project(funded({ timeRateCentsPerHour: 100 }), ANCHOR + 1_000);
    expect(p.consumedCentMs).toBe(100_000);
    expect(p.consumedCentMs / CENT_MS_PER_CENT).toBeCloseTo(100 / 3_600, 10);
  });

  it('charges a single millisecond exactly', () => {
    expect(project(funded(), ANCHOR + 1).consumedCentMs).toBe(4_700);
  });
});

describe('zero and boundary instants', () => {
  it('charges nothing when no time has elapsed', () => {
    const p = project(funded(), ANCHOR);
    expect(p.elapsedMs).toBe(0);
    expect(p.consumedCentMs).toBe(0);
    expect(p.remainingCentMs).toBe(centsToCentMilliseconds(5_000));
    expect(p.isExhausted).toBe(false);
  });

  it('treats an inverted instant as zero elapsed and flags it', () => {
    const p = project(funded(), ANCHOR - 60_000);
    expect(p.elapsedMs).toBe(0);
    expect(p.consumedCentMs).toBe(0);
    expect(p.clockInverted).toBe(true);
  });

  it('never returns negative consumption or negative remaining', () => {
    for (const at of [ANCHOR - 1, ANCHOR, ANCHOR + 1, ANCHOR + 10 * HOUR_MS]) {
      const p = project(funded(), at);
      expect(p.consumedCentMs).toBeGreaterThanOrEqual(0);
      expect(p.remainingCentMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('reports a run with no credit as immediately exhausted', () => {
    const p = project(funded({ creditedCents: 0 }), ANCHOR);
    expect(p.remainingCentMs).toBe(0);
    expect(p.isExhausted).toBe(true);
  });
});

describe('exhaustion', () => {
  it('caps consumption at the credit and never overspends', () => {
    const p = project(funded(), ANCHOR + 100 * HOUR_MS);
    expect(p.consumedCentMs).toBe(centsToCentMilliseconds(5_000));
    expect(p.remainingCentMs).toBe(0);
    expect(p.isExhausted).toBe(true);
  });

  it('computes the exhaustion instant in closed form', () => {
    // $50 at $47/hour lasts 50/47 hours.
    const expected = ANCHOR + Math.ceil((5_000 * CENT_MS_PER_CENT) / 4_700);
    expect(project(funded(), ANCHOR).exhaustsAtMs).toBe(expected);
    expect((expected - ANCHOR) / HOUR_MS).toBeCloseTo(50 / 47, 6);
  });

  it('gives the same exhaustion instant whenever it is asked', () => {
    const state = funded();
    const instants = [ANCHOR, ANCHOR + 1, ANCHOR + HOUR_MS, ANCHOR + 100 * HOUR_MS];
    const answers = new Set(instants.map((at) => project(state, at).exhaustsAtMs));
    expect(answers.size).toBe(1);
  });

  it('is not exhausted one millisecond before, and is exhausted at the instant', () => {
    const at = project(funded(), ANCHOR).exhaustsAtMs;
    expect(project(funded(), at - 1).isExhausted).toBe(false);
    expect(project(funded(), at).isExhausted).toBe(true);
  });

  it('exhausts exactly on the hour when the credit divides evenly', () => {
    const state = funded({ timeRateCentsPerHour: 10_000, creditedCents: 10_000 });
    expect(project(state, ANCHOR).exhaustsAtMs).toBe(ANCHOR + HOUR_MS);
  });
});

describe('settlement', () => {
  it('advances consumption and the anchor by the same elapsed time', () => {
    const s = settle(funded(), ANCHOR + 1_234);
    expect(s.settledMs).toBe(1_234);
    expect(s.settledCentMs).toBe(4_700 * 1_234);
    expect(s.rateAnchorAtMs).toBe(ANCHOR + 1_234);
    expect(s.consumedCentMs).toBe(4_700 * 1_234);
  });

  it('keeps consumption equal to rate times anchor movement', () => {
    for (const elapsed of [1, 999, 1_000, 123_456, HOUR_MS]) {
      const s = settle(funded(), ANCHOR + elapsed);
      expect(s.consumedCentMs).toBe(4_700 * (s.rateAnchorAtMs - ANCHOR));
    }
  });

  it('is a no-op when nothing has elapsed, so retrying is safe', () => {
    const s = settle(funded(), ANCHOR);
    expect(s.settledMs).toBe(0);
    expect(s.settledCentMs).toBe(0);
    expect(s.rateAnchorAtMs).toBe(ANCHOR);
  });

  it('is idempotent: settling twice at the same instant changes nothing further', () => {
    const at = ANCHOR + 5_000;
    const first = settle(funded(), at);
    const second = settle(
      funded({ consumedCentMs: first.consumedCentMs, rateAnchorAtMs: first.rateAnchorAtMs }),
      at,
    );
    expect(second.settledCentMs).toBe(0);
    expect(second.consumedCentMs).toBe(first.consumedCentMs);
    expect(second.rateAnchorAtMs).toBe(first.rateAnchorAtMs);
  });

  it('splitting a settlement in two charges exactly the same total', () => {
    const whole = settle(funded(), ANCHOR + 10_000);
    const partA = settle(funded(), ANCHOR + 3_777);
    const partB = settle(
      funded({ consumedCentMs: partA.consumedCentMs, rateAnchorAtMs: partA.rateAnchorAtMs }),
      ANCHOR + 10_000,
    );
    expect(partB.consumedCentMs).toBe(whole.consumedCentMs);
    expect(partB.rateAnchorAtMs).toBe(whole.rateAnchorAtMs);
  });

  it('leaves the exhaustion instant unchanged, because settling only moves the anchor forward', () => {
    const state = funded();
    const before = project(state, ANCHOR).exhaustsAtMs;
    const s = settle(state, ANCHOR + 987_654);
    const after = project(
      funded({ consumedCentMs: s.consumedCentMs, rateAnchorAtMs: s.rateAnchorAtMs }),
      s.rateAnchorAtMs,
    ).exhaustsAtMs;
    expect(after).toBe(before);
  });

  it('stops the anchor at exhaustion rather than beyond it', () => {
    const exhaustsAt = project(funded(), ANCHOR).exhaustsAtMs;
    const s = settle(funded(), ANCHOR + 500 * HOUR_MS);
    expect(s.rateAnchorAtMs).toBe(exhaustsAt);
    expect(s.consumedCentMs).toBe(centsToCentMilliseconds(5_000));
  });

  it('never settles past the credit even across many settlements', () => {
    let state = funded();
    for (let i = 1; i <= 50; i += 1) {
      const s = settle(state, ANCHOR + i * 200_000);
      state = funded({ consumedCentMs: s.consumedCentMs, rateAnchorAtMs: s.rateAnchorAtMs });
      expect(s.consumedCentMs).toBeLessThanOrEqual(centsToCentMilliseconds(5_000));
    }
    expect(state.consumedCentMs).toBe(centsToCentMilliseconds(5_000));
  });

  it('does not settle on an inverted clock', () => {
    const s = settle(funded(), ANCHOR - 1);
    expect(s.settledMs).toBe(0);
    expect(s.clockInverted).toBe(true);
    expect(s.rateAnchorAtMs).toBe(ANCHOR);
  });
});

describe('exact accumulation against independent arithmetic', () => {
  it('matches BigInt over a chain of settlements at changing rates', () => {
    const legs: { rate: number; ms: number }[] = [
      { rate: 4_700, ms: 1_234_567 },
      { rate: 50_000, ms: 890_123 },
      { rate: 100, ms: 4_567 },
    ];

    let exact = 0n;
    let state = funded({
      timeRateCentsPerHour: legs[0]?.rate ?? 0,
      creditedCents: 10_000_000,
      consumedCentMs: 0,
      rateAnchorAtMs: ANCHOR,
    });

    for (const leg of legs) {
      state = { ...state, timeRateCentsPerHour: leg.rate };
      const s = settle(state, state.rateAnchorAtMs + leg.ms);
      exact += BigInt(leg.rate) * BigInt(leg.ms);
      state = { ...state, consumedCentMs: s.consumedCentMs, rateAnchorAtMs: s.rateAnchorAtMs };
    }

    expect(BigInt(state.consumedCentMs)).toBe(exact);
    expect(state.consumedCentMs).toBe(50_309_071_600);
  });

  it('loses nothing across a thousand sub-second settlements', () => {
    // Every leg is 37 ms, a duration that is not a whole second and would be
    // erased by any model rounding to whole cents.
    const legs = 1_000;
    const stepMs = 37;
    let state = funded({ timeRateCentsPerHour: 100, creditedCents: 10_000 });

    for (let i = 0; i < legs; i += 1) {
      const s = settle(state, state.rateAnchorAtMs + stepMs);
      state = funded({
        timeRateCentsPerHour: 100,
        creditedCents: 10_000,
        consumedCentMs: s.consumedCentMs,
        rateAnchorAtMs: s.rateAnchorAtMs,
      });
    }

    expect(state.consumedCentMs).toBe(100 * stepMs * legs);
    expect(state.rateAnchorAtMs).toBe(ANCHOR + stepMs * legs);
  });
});

describe('large magnitudes and overflow', () => {
  it('stays exact for a very large credit', () => {
    // $25,000,000 is roughly the ceiling at which cent-ms remain safe integers.
    const credited = 2_500_000_000;
    const state = funded({ creditedCents: credited, timeRateCentsPerHour: 100_000 });
    const p = project(state, ANCHOR + HOUR_MS);
    expect(Number.isSafeInteger(p.consumedCentMs)).toBe(true);
    expect(p.consumedCentMs).toBe(100_000 * HOUR_MS);
  });

  it('does not overflow when a run is left unsettled for an implausible time', () => {
    // rate × elapsed would exceed MAX_SAFE_INTEGER if computed directly; the
    // engine bounds by the credit before multiplying.
    const elapsed = 1_000_000_000_000;
    expect(100_000 * elapsed).toBeGreaterThan(Number.MAX_SAFE_INTEGER);

    const p = project(funded({ timeRateCentsPerHour: 100_000 }), ANCHOR + elapsed);
    expect(Number.isSafeInteger(p.consumedCentMs)).toBe(true);
    expect(p.consumedCentMs).toBe(centsToCentMilliseconds(5_000));
    expect(p.remainingCentMs).toBe(0);
  });

  it('keeps every returned quantity a safe integer', () => {
    for (const rate of [100, 4_700, 100_000]) {
      for (const elapsed of [0, 1, HOUR_MS, 1e12]) {
        const p = project(funded({ timeRateCentsPerHour: rate }), ANCHOR + elapsed);
        expect(Number.isSafeInteger(p.consumedCentMs)).toBe(true);
        expect(Number.isSafeInteger(p.remainingCentMs)).toBe(true);
        expect(Number.isSafeInteger(p.exhaustsAtMs)).toBe(true);
      }
    }
  });
});

describe('ceiling division is exact', () => {
  it('agrees with BigInt ceiling division across awkward values', () => {
    const cases: [number, number][] = [
      [1, 1], [1, 100], [100, 100], [101, 100], [199, 100], [200, 100],
      [18_000_000_000, 4_700], [18_000_000_000, 100], [9_007_199_254_740_990, 100_000],
      [50_309_071_600, 4_700], [3, 100_000],
    ];

    for (const [deficit, rate] of cases) {
      const expected = Number((BigInt(deficit) + BigInt(rate) - 1n) / BigInt(rate));
      // exhaustsAtMs is anchor + ceilDiv(deficit, rate), which exposes ceilDiv.
      const credited = deficit / CENT_MS_PER_CENT;
      if (!Number.isSafeInteger(credited)) continue;
      const p = project(funded({ creditedCents: credited, timeRateCentsPerHour: rate }), ANCHOR);
      expect(p.exhaustsAtMs - ANCHOR).toBe(expected);
    }
  });

  it('reaches exactly zero remaining at the computed instant, for many rates', () => {
    for (const rate of [100, 300, 4_700, 33_300, 99_900, 100_000]) {
      for (const credited of [1, 7, 5_000, 99_999]) {
        const state = funded({ timeRateCentsPerHour: rate, creditedCents: credited });
        const at = project(state, ANCHOR).exhaustsAtMs;
        expect(project(state, at).remainingCentMs).toBe(0);
        expect(project(state, at - 1).remainingCentMs).toBeGreaterThan(0);
      }
    }
  });
});

describe('invalid input is refused, not absorbed', () => {
  const cases = [
    { label: 'fractional Time Rate', state: funded({ timeRateCentsPerHour: 4_750 }), reason: 'INVALID_TIME_RATE' },
    { label: 'Time Rate below the band', state: funded({ timeRateCentsPerHour: 99 }), reason: 'INVALID_TIME_RATE' },
    { label: 'Time Rate above the band', state: funded({ timeRateCentsPerHour: 100_001 }), reason: 'INVALID_TIME_RATE' },
    { label: 'negative credit', state: funded({ creditedCents: -1 }), reason: 'INVALID_CREDIT' },
    { label: 'non-integer credit', state: funded({ creditedCents: 1.5 }), reason: 'INVALID_CREDIT' },
    { label: 'negative consumption', state: funded({ consumedCentMs: -1 }), reason: 'INVALID_CONSUMPTION' },
    { label: 'non-integer consumption', state: funded({ consumedCentMs: 0.5 }), reason: 'INVALID_CONSUMPTION' },
    { label: 'unsafe integer consumption', state: funded({ consumedCentMs: Number.MAX_SAFE_INTEGER + 2 }), reason: 'INVALID_CONSUMPTION' },
    { label: 'non-integer anchor', state: funded({ rateAnchorAtMs: ANCHOR + 0.5 }), reason: 'INVALID_INSTANT' },
    { label: 'consumption beyond credit', state: funded({ consumedCentMs: 18_000_000_001 }), reason: 'CONSUMPTION_EXCEEDS_CREDIT' },
  ] as const;

  it.each(cases)('refuses $label', ({ state, reason }) => {
    expect(projectRun(state, ANCHOR + 1_000)).toEqual({ ok: false, reason });
    expect(settleRun(state, ANCHOR + 1_000)).toEqual({ ok: false, reason });
  });

  it('refuses a non-integer instant', () => {
    expect(projectRun(funded(), ANCHOR + 0.5)).toEqual({ ok: false, reason: 'INVALID_INSTANT' });
    expect(projectRun(funded(), Number.NaN)).toEqual({ ok: false, reason: 'INVALID_INSTANT' });
  });
});

describe('boost', () => {
  const at = ANCHOR + 60_000;

  it('settles at the old rate before applying the new one', () => {
    const result = boostRun(funded(), at, 10_000);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // 60 seconds charged at the OLD $47/hour, not at the new $100/hour.
      expect(result.value.settledCentMs).toBe(4_700 * 60_000);
      expect(result.value.timeRateCentsPerHour).toBe(10_000);
      expect(result.value.rateAnchorAtMs).toBe(at);
    }
  });

  it('never recomputes past consumption at the new rate', () => {
    const low = boostRun(funded(), at, 4_700);
    const high = boostRun(funded(), at, 100_000);
    expect(low.ok && high.ok).toBe(true);
    if (low.ok && high.ok) {
      expect(low.value.consumedCentMs).toBe(high.value.consumedCentMs);
    }
  });

  it('accepts an unchanged rate', () => {
    expect(boostRun(funded(), at, 4_700).ok).toBe(true);
  });

  it('refuses a decrease', () => {
    expect(boostRun(funded(), at, 4_600)).toEqual({ ok: false, reason: 'RATE_DECREASED' });
    expect(boostRun(funded(), at, 100)).toEqual({ ok: false, reason: 'RATE_DECREASED' });
  });

  it('refuses an invalid new rate before anything else', () => {
    for (const rate of [4_750, 99, 100_001, 0, -100]) {
      expect(boostRun(funded(), at, rate)).toEqual({ ok: false, reason: 'INVALID_TIME_RATE' });
    }
  });

  it('refuses a boost that would advance the anchor by zero milliseconds', () => {
    // Otherwise the fraction of a millisecond already elapsed at the old rate
    // would be charged at the new one (ADR-011).
    expect(boostRun(funded(), ANCHOR, 10_000)).toEqual({
      ok: false,
      reason: 'SETTLEMENT_TOO_SOON',
    });
    expect(boostRun(funded(), ANCHOR - 5, 10_000)).toEqual({
      ok: false,
      reason: 'SETTLEMENT_TOO_SOON',
    });
  });

  it('shortens the remaining life when the rate rises', () => {
    const before = project(funded(), ANCHOR).exhaustsAtMs;
    const boosted = boostRun(funded(), at, 100_000);
    expect(boosted.ok).toBe(true);
    if (boosted.ok) {
      const after = project(
        funded({
          timeRateCentsPerHour: boosted.value.timeRateCentsPerHour,
          consumedCentMs: boosted.value.consumedCentMs,
          rateAnchorAtMs: boosted.value.rateAnchorAtMs,
        }),
        boosted.value.rateAnchorAtMs,
      ).exhaustsAtMs;
      expect(after).toBeLessThan(before);
    }
  });

  it('propagates an invalid state rather than boosting it', () => {
    expect(boostRun(funded({ creditedCents: -1 }), at, 10_000)).toEqual({
      ok: false,
      reason: 'INVALID_CREDIT',
    });
  });
});

describe('determinism and purity', () => {
  it('returns identical answers for identical arguments', () => {
    const a = projectRun(funded(), ANCHOR + 12_345);
    const b = projectRun(funded(), ANCHOR + 12_345);
    expect(a).toEqual(b);
    expect(settleRun(funded(), ANCHOR + 12_345)).toEqual(settleRun(funded(), ANCHOR + 12_345));
  });

  it('does not mutate the state it is given', () => {
    const state = funded();
    const snapshot = structuredClone(state);
    projectRun(state, ANCHOR + 1_000);
    settleRun(state, ANCHOR + 1_000);
    boostRun(state, ANCHOR + 1_000, 100_000);
    expect(state).toEqual(snapshot);
  });

  it('gives the same answer regardless of the absolute epoch used', () => {
    const shifted = funded({ rateAnchorAtMs: 0 });
    expect(project(shifted, 60_000).consumedCentMs).toBe(
      project(funded(), ANCHOR + 60_000).consumedCentMs,
    );
  });
});
