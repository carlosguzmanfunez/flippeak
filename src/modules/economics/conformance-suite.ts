/**
 * Conformance oracle for any FlipPeak economic engine.
 *
 * This file deliberately shares no code with any engine. It restates ADR-011 in
 * exact BigInt arithmetic so that an implementation can be checked against the
 * specification rather than against itself. Two implementations agreeing with
 * each other proves consistency; agreeing with this proves correctness.
 *
 * It is not a test file. `runConformanceSuite(adapter)` is called from one, so
 * the same suite can be pointed at competing implementations and the outcome
 * used as an objective criterion for choosing between them.
 */

import { describe, expect, it } from 'vitest';

/** ADR-011: a Time Rate is per hour, and an hour is 3,600,000 ms. */
const CENT_MS_PER_CENT = 3_600_000n;

export type EngineState = {
  readonly timeRateCentsPerHour: number;
  readonly creditedCents: number;
  readonly consumedCentMs: number;
  readonly rateAnchorAtMs: number;
};

export type EngineProjection = {
  readonly elapsedMs: number;
  readonly consumedCentMs: number;
  readonly remainingCentMs: number;
  readonly isExhausted: boolean;
  readonly exhaustsAtMs: number;
};

export type EngineSettlement = {
  readonly consumedCentMs: number;
  readonly rateAnchorAtMs: number;
};

/**
 * What an engine must expose to be checked.
 *
 * `wholeMillisecondsBetween` is the boundary rule: PostgreSQL timestamps carry
 * microseconds, so something must reduce a fractional duration to whole
 * milliseconds. ADR-011 line 153 says that reduction is a floor. An engine that
 * performs the reduction in SQL should expose the same expression here.
 */
export type ConformanceAdapter = {
  readonly name: string;
  readonly project: (state: EngineState, atMs: number) => EngineProjection;
  readonly settle: (state: EngineState, atMs: number) => EngineSettlement;
  readonly wholeMillisecondsBetween: (anchorMs: number, nowMs: number) => number;
};

/** Exact ceiling division on BigInt. No floating point anywhere. */
function ceilDiv(a: bigint, b: bigint): bigint {
  return a <= 0n ? 0n : (a + b - 1n) / b;
}

type Oracle = {
  elapsedMs: bigint;
  consumedCentMs: bigint;
  remainingCentMs: bigint;
  isExhausted: boolean;
  exhaustsAtMs: bigint;
  settledConsumedCentMs: bigint;
  settledAnchorMs: bigint;
};

/**
 * The specification, in exact integer arithmetic.
 *
 * Every line here maps to a sentence of ADR-011:
 *   capacity   = credited x 3,600,000
 *   elapsed    = floor(ms between anchor and now), never negative
 *   projected  = consumed + rate x elapsed, capped at capacity
 *   remaining  = capacity - projected
 *   exhaustsAt = anchor + ceil((capacity - consumed) / rate)
 */
export function oracle(state: EngineState, atMs: number): Oracle {
  const rate = BigInt(state.timeRateCentsPerHour);
  const capacity = BigInt(state.creditedCents) * CENT_MS_PER_CENT;
  const consumed = BigInt(state.consumedCentMs);
  const anchor = BigInt(state.rateAnchorAtMs);
  const now = BigInt(atMs);

  const rawElapsed = now - anchor;
  const elapsedMs = rawElapsed < 0n ? 0n : rawElapsed;

  const deficit = capacity - consumed;
  const msToExhaust = ceilDiv(deficit, rate);
  const chargeableMs = elapsedMs < msToExhaust ? elapsedMs : msToExhaust;

  const raw = consumed + rate * chargeableMs;
  const projected = raw < capacity ? raw : capacity;

  return {
    elapsedMs,
    consumedCentMs: projected,
    remainingCentMs: capacity - projected,
    isExhausted: projected >= capacity,
    exhaustsAtMs: anchor + msToExhaust,
    settledConsumedCentMs: projected,
    settledAnchorMs: anchor + chargeableMs,
  };
}

/** Deterministic pseudo-random generator, so a failure is always reproducible. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

const RATES = [100, 200, 300, 4_700, 10_000, 10_100, 33_300, 57_00, 99_900, 100_000] as const;

function randomCases(count: number): { state: EngineState; atMs: number }[] {
  const random = seeded(20_260_907);
  const cases: { state: EngineState; atMs: number }[] = [];
  const anchor = 1_700_000_000_000;

  for (let i = 0; i < count; i += 1) {
    const rate = RATES[Math.floor(random() * RATES.length)] ?? 100;
    const creditedCents = 1 + Math.floor(random() * 500_000);
    const capacity = creditedCents * 3_600_000;
    const consumedCentMs = Math.floor(random() * capacity);
    // Instants spread across before the anchor, inside the run and far past it.
    const span = Math.floor(random() * (capacity / rate) * 2.5);
    const atMs = anchor + span - (random() < 0.1 ? Math.floor(random() * 5_000) : 0);

    cases.push({
      state: { timeRateCentsPerHour: rate, creditedCents, consumedCentMs, rateAnchorAtMs: anchor },
      atMs,
    });
  }
  return cases;
}

/**
 * The suite. Any engine that passes is conformant with ADR-011 and ADR-012.
 *
 * Section A checks the mathematics against the oracle. Section B checks the
 * boundary rule that decides how a fractional duration becomes whole
 * milliseconds — the point where a floor and a ceiling disagree.
 */
export function runConformanceSuite(adapter: ConformanceAdapter): void {
  const cases = randomCases(400);

  describe(`A. ${adapter.name} agrees with the ADR-011 oracle`, () => {
    it('matches projected consumption on every generated case', () => {
      for (const { state, atMs } of cases) {
        const expected = oracle(state, atMs);
        const actual = adapter.project(state, atMs);
        expect(BigInt(actual.consumedCentMs)).toBe(expected.consumedCentMs);
      }
    });

    it('matches remaining balance on every generated case', () => {
      for (const { state, atMs } of cases) {
        expect(BigInt(adapter.project(state, atMs).remainingCentMs)).toBe(
          oracle(state, atMs).remainingCentMs,
        );
      }
    });

    it('matches the exhaustion verdict on every generated case', () => {
      for (const { state, atMs } of cases) {
        expect(adapter.project(state, atMs).isExhausted).toBe(oracle(state, atMs).isExhausted);
      }
    });

    it('matches the exhaustion instant on every generated case', () => {
      for (const { state, atMs } of cases) {
        expect(BigInt(adapter.project(state, atMs).exhaustsAtMs)).toBe(
          oracle(state, atMs).exhaustsAtMs,
        );
      }
    });

    it('matches settlement on every generated case', () => {
      for (const { state, atMs } of cases) {
        const expected = oracle(state, atMs);
        const actual = adapter.settle(state, atMs);
        expect(BigInt(actual.consumedCentMs)).toBe(expected.settledConsumedCentMs);
        expect(BigInt(actual.rateAnchorAtMs)).toBe(expected.settledAnchorMs);
      }
    });
  });

  describe(`A2. ${adapter.name} upholds the structural invariants`, () => {
    it('never lets consumption exceed capacity', () => {
      for (const { state, atMs } of cases) {
        const capacity = BigInt(state.creditedCents) * CENT_MS_PER_CENT;
        expect(BigInt(adapter.project(state, atMs).consumedCentMs)).toBeLessThanOrEqual(capacity);
      }
    });

    it('never reports a negative remaining balance', () => {
      for (const { state, atMs } of cases) {
        expect(adapter.project(state, atMs).remainingCentMs).toBeGreaterThanOrEqual(0);
      }
    });

    it('never moves the anchor backwards', () => {
      for (const { state, atMs } of cases) {
        expect(adapter.settle(state, atMs).rateAnchorAtMs).toBeGreaterThanOrEqual(
          state.rateAnchorAtMs,
        );
      }
    });

    it('never moves the anchor past the instant it settled to', () => {
      // An anchor ahead of the instant makes the next settlement see negative
      // elapsed time — a clock inversion the system inflicted on itself.
      for (const { state, atMs } of cases) {
        if (atMs < state.rateAnchorAtMs) continue;
        expect(adapter.settle(state, atMs).rateAnchorAtMs).toBeLessThanOrEqual(atMs);
      }
    });

    it('never decreases consumption', () => {
      for (const { state, atMs } of cases) {
        expect(adapter.settle(state, atMs).consumedCentMs).toBeGreaterThanOrEqual(
          state.consumedCentMs,
        );
      }
    });

    it('settles idempotently: settling again at the same instant adds nothing', () => {
      for (const { state, atMs } of cases.slice(0, 120)) {
        const first = adapter.settle(state, atMs);
        const second = adapter.settle(
          { ...state, consumedCentMs: first.consumedCentMs, rateAnchorAtMs: first.rateAnchorAtMs },
          atMs,
        );
        expect(second.consumedCentMs).toBe(first.consumedCentMs);
        expect(second.rateAnchorAtMs).toBe(first.rateAnchorAtMs);
      }
    });

    it('charges the same total whether a period is settled once or in two parts', () => {
      for (const { state, atMs } of cases.slice(0, 120)) {
        if (atMs <= state.rateAnchorAtMs) continue;
        const midpoint = state.rateAnchorAtMs + Math.floor((atMs - state.rateAnchorAtMs) / 2);

        const whole = adapter.settle(state, atMs);
        const partA = adapter.settle(state, midpoint);
        const partB = adapter.settle(
          { ...state, consumedCentMs: partA.consumedCentMs, rateAnchorAtMs: partA.rateAnchorAtMs },
          atMs,
        );
        expect(partB.consumedCentMs).toBe(whole.consumedCentMs);
        expect(partB.rateAnchorAtMs).toBe(whole.rateAnchorAtMs);
      }
    });

    it('leaves the exhaustion instant unchanged when settling', () => {
      for (const { state, atMs } of cases.slice(0, 120)) {
        const before = adapter.project(state, state.rateAnchorAtMs).exhaustsAtMs;
        const settled = adapter.settle(state, atMs);
        const after = adapter.project(
          {
            ...state,
            consumedCentMs: settled.consumedCentMs,
            rateAnchorAtMs: settled.rateAnchorAtMs,
          },
          settled.rateAnchorAtMs,
        ).exhaustsAtMs;
        expect(after).toBe(before);
      }
    });

    it('places the exhaustion instant at the first millisecond with zero remaining', () => {
      for (const rate of RATES) {
        for (const creditedCents of [1, 7, 5_000, 99_999]) {
          const state: EngineState = {
            timeRateCentsPerHour: rate,
            creditedCents,
            consumedCentMs: 0,
            rateAnchorAtMs: 1_700_000_000_000,
          };
          const at = adapter.project(state, state.rateAnchorAtMs).exhaustsAtMs;
          expect(adapter.project(state, at).remainingCentMs).toBe(0);
          expect(adapter.project(state, at - 1).remainingCentMs).toBeGreaterThan(0);
        }
      }
    });
  });

  describe(`B. ${adapter.name} reduces fractional durations by flooring`, () => {
    // ADR-011 line 153: elapsed_ms = floor(ms between rate_anchor_at and now()).
    // A ceiling charges for a millisecond that has not finished elapsing and
    // pushes the anchor past the instant, which is the discriminating case
    // between a conformant engine and one that merely agrees with itself.
    const anchor = 1_700_000_000_000;

    const fractional = [
      { elapsed: 35_643.564, floored: 35_643 },
      { elapsed: 0.999, floored: 0 },
      { elapsed: 1.000_001, floored: 1 },
      { elapsed: 999.5, floored: 999 },
      { elapsed: 1_000.000_1, floored: 1_000 },
    ] as const;

    it.each(fractional)('reduces $elapsed ms to $floored', ({ elapsed, floored }) => {
      expect(adapter.wholeMillisecondsBetween(anchor, anchor + elapsed)).toBe(floored);
    });

    it('never returns more whole milliseconds than have actually elapsed', () => {
      for (const { elapsed } of fractional) {
        expect(adapter.wholeMillisecondsBetween(anchor, anchor + elapsed)).toBeLessThanOrEqual(
          elapsed,
        );
      }
    });

    it('treats an instant before the anchor as zero elapsed, not as negative', () => {
      for (const back of [0.1, 1, 5_000]) {
        expect(adapter.wholeMillisecondsBetween(anchor, anchor - back)).toBe(0);
      }
    });
  });
}
