import { CENT_MS_PER_CENT } from '@/config/domain-config';
import { isPermittedBoost, isValidTimeRate } from './time-rate';

/**
 * The pure economic engine for FlipPeak run accounting (Phase 4C).
 *
 * Everything here is deterministic and I/O-free: no ids, no clock, no
 * database. The precise integer model (ADR-011) is expressed in cent-ms:
 *
 *   capacity(credited_cents) = credited_cents * 3_600_000   cent-ms
 *   projected consumption     = consumed_cent_ms + rate * elapsed_ms
 *   remaining                 = capacity - effective consumed
 *
 * Invariants (each covered by a test in economic-engine.test.ts):
 *
 *  1. Capacity is an exact integer multiple of CENT_MS_PER_CENT.
 *  2. Effective consumption is capped at capacity; it never exceeds it.
 *  3. Repetitive derivation at the same elapsed ms is idempotent.
 *  4. remaining >= 0 everywhere; it is exactly 0 when the run is exhausted.
 *  5. Ceiled elapsed is used consistently so eligibility and the EXHAUSTED
 *     materialisation boundary coincide (ADR-012); the under-count is bounded
 *     by one millisecond of rate (<= 0.0278 cents at the max rate).
 *  6. Rate * elapsed is never evaluated beyond capacity (safe for JS number
 *     within the CHECK-bounded credit domain; see the capacity guard below).
 *  7. Zero-consumption states (DRAFT, elapsed = 0) never report exhausted.
 *  8. All outputs are exact safe integers; no floating point enters.
 *
 * The authoritative millisecond value must be CEILED to a whole millisecond
 * by the caller (see `ceilToWholeMs`): timestamps carry microseconds, and
 * flooring a fractional ms would leave the derived remaining nonzero at the
 * exact moment the run must materialise as EXHAUSTED (audit finding #2).
 */

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/** Largest credit the exact-number model can hold (capacity <= 2^53 - 1). */
export const MAX_EXACT_CREDITED_CENTS = Math.floor(MAX_SAFE / CENT_MS_PER_CENT);

function assertSafeAmount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer. Received: ${value}`);
  }
}

function assertCreditWithinExactDomain(creditedCents: number): void {
  if (creditedCents > MAX_EXACT_CREDITED_CENTS) {
    throw new RangeError(
      `creditedCents exceeds the exact-model domain (${MAX_EXACT_CREDITED_CENTS} cents). ` +
        'The funding model must cap credit below this bound (audit finding #1/#6).',
    );
  }
}

function assertElapsedNonNegative(elapsedMsCeiled: number): void {
  if (!Number.isSafeInteger(elapsedMsCeiled) || elapsedMsCeiled < 0) {
    throw new RangeError(`elapsedMsCeiled must be a non-negative integer number of ms. Received: ${elapsedMsCeiled}`);
  }
}

/** Rounds an exact (possibly fractional with sub-ms precision) elapsed ms up. */
export function ceilToWholeMs(elapsedExactMs: number): number {
  if (!Number.isFinite(elapsedExactMs) || elapsedExactMs < 0) {
    throw new RangeError(`elapsedExactMs must be a finite non-negative number. Received: ${elapsedExactMs}`);
  }
  return Math.ceil(elapsedExactMs);
}

export type ConsumeState = {
  readonly creditedCents: number;
  readonly consumedCentMs: number;
  readonly rateCentsPerHour: number;
  readonly elapsedMsCeiled: number;
};

export type ConsumeResult = {
  readonly consumedCentMs: number;
  readonly deltaCentMs: number;
  readonly remainingCentMs: number;
  readonly exhausted: boolean;
};

/**
 * Projects the run accounting forward by `elapsedMsCeiled` milliseconds.
 *
 * The returned consumed/remaining values are the exact integer state after
 * applying the capped projection. Nothing is persisted here: persistence is
 * the caller's transactional concern (audit finding #4 / client.ts pool).
 */
export function consume(state: ConsumeState): ConsumeResult {
  const { creditedCents, consumedCentMs, rateCentsPerHour, elapsedMsCeiled } = state;
  assertSafeAmount(creditedCents, 'creditedCents');
  assertSafeAmount(consumedCentMs, 'consumedCentMs');
  assertCreditWithinExactDomain(creditedCents);
  assertElapsedNonNegative(elapsedMsCeiled);
  if (!isValidTimeRate(rateCentsPerHour)) {
    throw new RangeError(`rateCentsPerHour is not a valid Time Rate. Received: ${rateCentsPerHour}`);
  }

  const capacity = creditedCents * CENT_MS_PER_CENT;
  if (consumedCentMs > capacity) {
    throw new RangeError(
      `consumedCentMs (${consumedCentMs}) exceeds capacity (${capacity}) — inconsistent accounting state`,
    );
  }

  // Exact exhaustion boundary in ceiled-millisecond semantics (audit finding
  // #2): at `elapsedMsCeiled >= exhaustBoundMs` the run is economically dead.
  // The comparison happens before any multiplication, so a huge elapsed can
  // never produce a rate * elapsed intermediate above 2^53 - 1.
  const remainingSpace = capacity - consumedCentMs;
  const exhaustBoundMs = Math.ceil(remainingSpace / rateCentsPerHour);

  if (remainingSpace === 0 || elapsedMsCeiled >= exhaustBoundMs) {
    // Consumed lands exactly on the capacity: aligned with EXHAUSTED
    // materialisation, never above the CHECK bound (ADR-011, $21).
    const consumedFinal = capacity;
    return {
      consumedCentMs: consumedFinal,
      deltaCentMs: consumedFinal - consumedCentMs,
      remainingCentMs: 0,
      exhausted: true,
    };
  }

  // elapsedMsCeiled < exhaustBoundMs implies rate * elapsed < remainingSpace
  // (for integer or fractional s/R the ceiling-minus-one bound holds), so the
  // product is an exact integer strictly inside the safe domain.
  const deltaCentMs = rateCentsPerHour * elapsedMsCeiled;
  const consumedFinal = consumedCentMs + deltaCentMs;
  const remainingCentMs = capacity - consumedFinal;

  return {
    consumedCentMs: consumedFinal,
    deltaCentMs,
    remainingCentMs,
    exhausted: false,
  };
}

/**
 * True exactly when the run is still competing at `elapsedMsCeiled`.
 *
 * Economic truth, not persisted status (ADR-012): a run whose status column
 * still says ACTIVE but has zero effective remaining is NOT eligible.
 */
export function isEconomicallyEligible(state: ConsumeState): boolean {
  return !consume(state).exhausted;
}

export type RuntimeRemaining = {
  /** Whole milliseconds until exhaustion under the elapsing rate. */
  readonly wholeMsLeft: number;
  readonly exhausted: boolean;
};

/**
 * How much runtime remains before the credit runs out.
 *
 * Reported in whole ms. A live run with 0 whole ms left is still eligible
 * this ms — `exhausted` is the authoritative flag, derived exactly.
 */
export function runtimeRemainingMs(state: ConsumeState): RuntimeRemaining {
  const result = consume(state);
  if (result.exhausted) {
    return { wholeMsLeft: 0, exhausted: true };
  }
  return {
    wholeMsLeft: Math.floor(result.remainingCentMs / state.rateCentsPerHour),
    exhausted: false,
  };
}

export type BoostDecision = { readonly ok: boolean; readonly reason: 'VALID' | 'NOT_STRICT_INCREASE' | 'INVALID_RATE' };

/**
 * Pure Boost approval (audit finding: settlement-with-old-rate must be the
 * transaction's first step; this decides only the rate rule).
 *
 * A boost must strictly increase the rate (invariant 5 / ADR-003): the
 * monotonic rule does NOT apply to Run Again, only to a live funded run.
 */
export function validateBoost(currentRateCentsPerHour: number, proposedRateCentsPerHour: number): BoostDecision {
  if (!isValidTimeRate(proposedRateCentsPerHour)) {
    return { ok: false, reason: 'INVALID_RATE' };
  }
  if (!isPermittedBoost(currentRateCentsPerHour, proposedRateCentsPerHour)) {
    return { ok: false, reason: 'NOT_STRICT_INCREASE' };
  }
  return { ok: true, reason: 'VALID' };
}
