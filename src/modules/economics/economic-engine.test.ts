import { describe, expect, it } from 'vitest';
import { CENT_MS_PER_CENT, MILLISECONDS_PER_HOUR } from '@/config/domain-config';
import {
  MAX_EXACT_CREDITED_CENTS,
  ceilToWholeMs,
  consume,
  isEconomicallyEligible,
  runtimeRemainingMs,
  validateBoost,
} from './economic-engine';

const RATE_1 = 100; // $1/hour
const RATE_100 = 10_000; // $100/hour
const RATE_101 = 10_100; // $101/hour
const RATE_1000 = 100_000; // $1,000/hour

function run(creditedCents: number, consumedCentMs: number, rate: number, elapsedMs: number) {
  return consume({ creditedCents, consumedCentMs, rateCentsPerHour: rate, elapsedMsCeiled: elapsedMs });
}

describe('Arithmetic (ADR-011 exact integer model)', () => {
  it('zero elapsed produces zero delta and a live run', () => {
    expect(run(100, 0, RATE_1, 0)).toEqual({
      consumedCentMs: 0,
      deltaCentMs: 0,
      remainingCentMs: 100 * CENT_MS_PER_CENT,
      exhausted: false,
    });
  });

  it('one ms consumes exactly rate cent-ms', () => {
    const r = run(100, 0, RATE_1, 1);
    expect(r.deltaCentMs).toBe(RATE_1);
    expect(r.remainingCentMs).toBe(100 * CENT_MS_PER_CENT - RATE_1);
  });

  it('an exact hour at $1/h consumes the whole credit (100 cents → 360,000,000)', () => {
    const r = run(100, 0, RATE_1, MILLISECONDS_PER_HOUR);
    expect(r.deltaCentMs).toBe(100 * CENT_MS_PER_CENT);
    expect(r.consumedCentMs).toBe(100 * CENT_MS_PER_CENT);
    expect(r.exhausted).toBe(true);
    expect(r.remainingCentMs).toBe(0);
  });

  it('partial hour is an exact product with no fractional cents', () => {
    const r = run(100, 0, RATE_1, 1_800_000);
    expect(r.deltaCentMs).toBe(180_000_000);
    expect(r.remainingCentMs).toBe(180_000_000);
  });

  it('$1/h, $100/h, $101/h and $1,000/h each burn exact products per ms', () => {
    for (const rate of [RATE_1, RATE_100, RATE_101, RATE_1000]) {
      const r = run(100, 0, rate, 1);
      expect(r.deltaCentMs).toBe(rate);
      expect(r.consumedCentMs).toBe(rate);
      expect(r.exhausted).toBe(false);
    }
  });

  it('near exhaustion reports a tiny but nonzero remaining', () => {
    // 100 cents at $100/h: capacity 360,000,000 cent-ms, T_exh = 36,000 ms
    const r = run(100, 0, RATE_100, 35_999);
    expect(r.consumedCentMs).toBe(35_999 * RATE_100);
    expect(r.remainingCentMs).toBe(100 * CENT_MS_PER_CENT - 35_999 * RATE_100);
    expect(r.exhausted).toBe(false);
  });

  it('exact exhaustion is exactly zero and never negative', () => {
    const r = run(1, 0, RATE_1000, 36);
    expect(r.deltaCentMs).toBe(CENT_MS_PER_CENT);
    expect(r.remainingCentMs).toBe(0);
    expect(r.exhausted).toBe(true);
  });

  it('elapsed beyond exhaustion is capped at capacity exactly', () => {
    const r = run(1, 0, RATE_1000, 36 + 5_000);
    expect(r.consumedCentMs).toBe(CENT_MS_PER_CENT);
    expect(r.remainingCentMs).toBe(0);
    expect(r.exhausted).toBe(true);
  });

  it('an unfunded run (credited = 0) is never eligible', () => {
    const r = run(0, 0, RATE_1000, 36);
    expect(r.consumedCentMs).toBe(0);
    expect(r.exhausted).toBe(true);
  });
});

describe('State semantics (economic truth, ADR-012)', () => {
  it('a run with credit but zero elapsed and zero consumed is NOT exhausted (DRAFT shape)', () => {
    expect(isEconomicallyEligible({ creditedCents: 100, consumedCentMs: 0, rateCentsPerHour: RATE_101, elapsedMsCeiled: 0 })).toBe(true);
    expect(runtimeRemainingMs({ creditedCents: 100, consumedCentMs: 0, rateCentsPerHour: RATE_101, elapsedMsCeiled: 0 }).exhausted).toBe(false);
  });

  it('a fully consumed run never resumes, even with more elapsed (EXHAUSTED shape)', () => {
    const capacity = 100 * CENT_MS_PER_CENT;
    const r1 = run(100, capacity, RATE_101, 100);
    const r2 = run(100, capacity, RATE_101, 50_000);
    expect(r1.exhausted).toBe(true);
    expect(r2.exhausted).toBe(true);
    expect(r2.consumedCentMs).toBe(capacity);
    expect(isEconomicallyEligible({ creditedCents: 100, consumedCentMs: capacity, rateCentsPerHour: RATE_101, elapsedMsCeiled: 50_000 })).toBe(false);
  });

  it('exhausted eligibility ignores persisted status: stale ACTIVE with zero remaining is out', () => {
    const capacity = 100 * CENT_MS_PER_CENT;
    expect(isEconomicallyEligible({ creditedCents: 100, consumedCentMs: capacity, rateCentsPerHour: RATE_1000, elapsedMsCeiled: 0 })).toBe(false);
  });

  it('elapsed values below T_exh keep the run eligible across the whole ms', () => {
    // 100 cents at $101/h: T_exh ≈ 35,643.56 ms
    expect(isEconomicallyEligible({ creditedCents: 100, consumedCentMs: 0, rateCentsPerHour: RATE_101, elapsedMsCeiled: 35_643 })).toBe(true);
    expect(isEconomicallyEligible({ creditedCents: 100, consumedCentMs: 0, rateCentsPerHour: RATE_101, elapsedMsCeiled: 35_644 })).toBe(false);
  });

  it('rejects negative and non-integer inputs (invalid timestamps/amounts handled)', () => {
    expect(() => run(-1, 0, RATE_101, 10)).toThrow(RangeError);
    expect(() => run(100, -1, RATE_101, 10)).toThrow(RangeError);
    expect(() => run(100, 0, RATE_101, -1)).toThrow(RangeError);
    expect(() => run(100.5, 0, RATE_101, 10)).toThrow(RangeError);
    expect(() => run(100, 0, 101.5, 10)).toThrow(RangeError);
    expect(() => ceilToWholeMs(NaN)).toThrow(RangeError);
  });
});

describe('Ceiled elapsed — exhaustion alignment (audit finding #2)', () => {
  it('floor-style elapsed leaves a nonzero remaining (the bug the fix removes)', () => {
    // 100 cents at $101/h. T_exh = 360,000,000 / 10,100 = 35,643.56... ms.
    const floored = run(100, 0, RATE_101, 35_643);
    expect(floored.remainingCentMs).toBeGreaterThan(0);
    expect(floored.exhausted).toBe(false);
  });

  it('ceiled elapsed gives exactly zero at the same instant', () => {
    const ceiled = run(100, 0, RATE_101, 35_644);
    expect(ceiled.remainingCentMs).toBe(0);
    expect(ceiled.exhausted).toBe(true);
    expect(ceiled.consumedCentMs).toBe(100 * CENT_MS_PER_CENT);
  });

  it('fractional exact elapsed (35,643.56 ms) ceils to 35,644 → aligned', () => {
    expect(ceilToWholeMs(35_643.564356)).toBe(35_644);
    expect(run(100, 0, RATE_101, ceilToWholeMs(35_643.564356)).exhausted).toBe(true);
  });

  it('whole-ms elapsed is unchanged by ceil', () => {
    expect(ceilToWholeMs(36_000)).toBe(36_000);
  });
});

describe('Settlement discipline', () => {
  it('is idempotent: the same state re-derived at the same elapsed yields identical values', () => {
    const state = { creditedCents: 100, consumedCentMs: 0, rateCentsPerHour: RATE_100, elapsedMsCeiled: 12_345 };
    expect(consume(state)).toEqual(consume(state));
  });

  it('after an anchor move (settled state + elapsed 0) no double counting occurs', () => {
    const first = run(100, 0, RATE_100, 12_345);
    const movedAnchor = run(100, first.consumedCentMs, RATE_100, 0);
    expect(movedAnchor.deltaCentMs).toBe(0);
    expect(movedAnchor.consumedCentMs).toBe(first.consumedCentMs);
  });

  it('settlement is correct from any valid intermediate consumed state', () => {
    const halfway = run(100, 0, RATE_100, 6_000);
    const settledAgain = run(100, halfway.consumedCentMs, RATE_100, 6_000);
    expect(settledAgain.consumedCentMs).toBe(12_000 * RATE_100);
  });

  it('consumption never passes funded capacity (hallucination-proof cap)', () => {
    const beyond = run(1, 0, RATE_1000, 999_999_999);
    expect(beyond.consumedCentMs).toBe(CENT_MS_PER_CENT);
  });

  it('a persist mismatch (consumed > capacity) is refused loudly', () => {
    expect(() => run(1, CENT_MS_PER_CENT + 1, RATE_101, 10)).toThrow(RangeError);
  });
});

describe('Boost approval (monotonic rule; Run Again is exempt by design)', () => {
  it('higher rate is allowed', () => {
    expect(validateBoost(RATE_1, RATE_101)).toEqual({ ok: true, reason: 'VALID' });
  });

  it('lower rate is rejected', () => {
    expect(validateBoost(RATE_101, RATE_1)).toEqual({ ok: false, reason: 'NOT_STRICT_INCREASE' });
  });

  it('equal rate is rejected under strict boost semantics (UI exposure is a separate open decision)', () => {
    expect(validateBoost(RATE_100, RATE_100)).toEqual({ ok: false, reason: 'NOT_STRICT_INCREASE' });
  });

  it('fractional and out-of-band rates are rejected', () => {
    expect(validateBoost(RATE_100, 10_150)).toEqual({ ok: false, reason: 'INVALID_RATE' });
    expect(validateBoost(RATE_100, 100_001)).toEqual({ ok: false, reason: 'INVALID_RATE' });
    expect(validateBoost(RATE_100, 99)).toEqual({ ok: false, reason: 'INVALID_RATE' });
  });
});

describe('Numeric safety (audit finding #1: exact number domain, no BigInt needed)', () => {
  it('the exact-credit bound is reachable and exact', () => {
    const r = run(MAX_EXACT_CREDITED_CENTS, 0, RATE_1000, 1);
    expect(r.consumedCentMs).toBe(RATE_1000);
    expect(r.remainingCentMs).toBe(MAX_EXACT_CREDITED_CENTS * CENT_MS_PER_CENT - RATE_1000);
    expect(Number.isSafeInteger(r.remainingCentMs)).toBe(true);
  });

  it('credit one cent above the bound is refused loudly', () => {
    expect(() => run(MAX_EXACT_CREDITED_CENTS + 1, 0, RATE_1000, 1)).toThrow(RangeError);
  });

  it('a 31-year elapsed and $1 of credit stays exact (cap-before-multiply)', () => {
    const elapsed31YearsMs = 31 * 365.25 * 24 * 3_600_000;
    const r = run(1, 0, RATE_1000, elapsed31YearsMs);
    expect(r.consumedCentMs).toBe(CENT_MS_PER_CENT);
    expect(r.remainingCentMs).toBe(0);
    expect(r.exhausted).toBe(true);
  });

  it('a 31-year elapsed with $1,000/h and $100 credit cannot exceed 2^53 in any intermediate', () => {
    const elapsed31YearsMs = 31 * 365.25 * 24 * 3_600_000;
    const r = run(100, 0, RATE_1000, elapsed31YearsMs);
    expect(Number.isSafeInteger(r.consumedCentMs)).toBe(true);
    expect(r.consumedCentMs).toBe(100 * CENT_MS_PER_CENT);
  });

  it('the model ceiling equals the DB CHECK bound: credited ≤ MAX_SAFE / 3_600_000', () => {
    expect(MAX_EXACT_CREDITED_CENTS).toBe(Math.floor(Number.MAX_SAFE_INTEGER / CENT_MS_PER_CENT));
  });

  it('overflow would need credit above the funding ceiling (≈ $25.02M), proven unreachable', () => {
    const overflowCredit = 2_519_999_999; // one cent above MAX_EXACT_CREDITED_CENTS
    expect(() => run(overflowCredit, 0, RATE_1000, 1)).toThrow(RangeError);
  });
});
