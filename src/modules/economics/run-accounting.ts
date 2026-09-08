import { isValidTimeRate } from './time-rate';

/**
 * The canonical FlipPeak consumption engine (ADR-008, ADR-011, ADR-012).
 *
 * Pure and deterministic. No clock, no database, no session, no environment and
 * no mutable state: every input arrives as an argument and every answer is a
 * returned value. The authoritative instant is supplied by the caller, which in
 * production means PostgreSQL — a browser timer is never financial authority.
 *
 * UNITS. Two are in play and they are never mixed:
 *
 *   cents          integer money, the unit a payment provider uses
 *   cent-ms        integer consumption, where 1 cent = 3,600,000 cent-ms
 *
 * The conversion exists because a Time Rate is per hour and an hour is
 * 3,600,000 ms, so `rate × elapsed_ms` is an exact integer product. There is no
 * division in the consumption path and therefore no rounding: every millisecond
 * is charged once, at exactly the rate in force.
 *
 * `CentMilliseconds` is branded for the same reason `Cents` is (ADR-010): a
 * plain number in a cent-ms position becomes a compile-time error rather than a
 * silent factor of 3,600,000.
 */

declare const centMillisecondsBrand: unique symbol;

/** An exact quantity of consumption. Always a safe, non-negative integer. */
export type CentMilliseconds = number & { readonly [centMillisecondsBrand]: 'CentMilliseconds' };

/** Milliseconds in one hour, and therefore cent-ms in one cent. */
export const CENT_MS_PER_CENT = 3_600_000;

export function toCentMilliseconds(value: number): CentMilliseconds {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Consumption must be a safe non-negative integer of cent-ms. Received: ${value}`);
  }
  return value as CentMilliseconds;
}

/** Converts credited money into the consumption unit. Exact: a multiplication. */
export function centsToCentMilliseconds(cents: number): CentMilliseconds {
  return toCentMilliseconds(cents * CENT_MS_PER_CENT);
}

/**
 * A funded run's accounting state at rest, as stored.
 *
 * `rateAnchorAtMs` and the instant passed to these functions are epoch
 * milliseconds. Both come from the caller; nothing here reads a clock.
 */
export type RunAccountingState = {
  readonly timeRateCentsPerHour: number;
  readonly creditedCents: number;
  readonly consumedCentMs: number;
  readonly rateAnchorAtMs: number;
};

export type AccountingFailure =
  | 'INVALID_TIME_RATE'
  | 'INVALID_CREDIT'
  | 'INVALID_CONSUMPTION'
  | 'CONSUMPTION_EXCEEDS_CREDIT'
  | 'INVALID_INSTANT';

export type AccountingResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: AccountingFailure };

export type RunProjection = {
  /** Whole milliseconds charged since the anchor. Never negative. */
  readonly elapsedMs: number;
  /** Total consumption at the instant asked about, capped at the credit. */
  readonly consumedCentMs: CentMilliseconds;
  /** Credit not yet consumed. Never negative. */
  readonly remainingCentMs: CentMilliseconds;
  /** True when the run has no economic room left and must stop competing. */
  readonly isExhausted: boolean;
  /**
   * The instant the run runs out, in epoch ms.
   *
   * Computed from the stored anchor rather than from the instant asked about,
   * so it is the same answer whenever it is asked. May be in the past.
   */
  readonly exhaustsAtMs: number;
  /**
   * True when the supplied instant precedes the anchor.
   *
   * Elapsed time is then treated as zero rather than as negative, because a
   * negative elapsed would hand back consumption the run already used. The flag
   * is surfaced so a reconciliation job can notice; ranking can ignore it.
   */
  readonly clockInverted: boolean;
};

/**
 * Exact integer ceiling division.
 *
 * `Math.ceil(a / b)` can land one off when the quotient is not representable, so
 * the result is corrected against integer multiplication. `q * b` stays close to
 * `a` and therefore cannot overflow where `a` itself is safe.
 */
function ceilDiv(a: number, b: number): number {
  let q = Math.ceil(a / b);
  if ((q - 1) * b >= a) q -= 1;
  if (q * b < a) q += 1;
  return q;
}

function validate(state: RunAccountingState, atMs: number): AccountingFailure | null {
  if (!isValidTimeRate(state.timeRateCentsPerHour)) return 'INVALID_TIME_RATE';
  if (!Number.isSafeInteger(state.creditedCents) || state.creditedCents < 0) return 'INVALID_CREDIT';
  if (!Number.isSafeInteger(state.consumedCentMs) || state.consumedCentMs < 0) {
    return 'INVALID_CONSUMPTION';
  }
  if (!Number.isSafeInteger(state.rateAnchorAtMs) || !Number.isSafeInteger(atMs)) {
    return 'INVALID_INSTANT';
  }
  // Mirrors the campaign_run_consumed_within_credit database constraint.
  if (state.consumedCentMs > state.creditedCents * CENT_MS_PER_CENT) {
    return 'CONSUMPTION_EXCEEDS_CREDIT';
  }
  return null;
}

/**
 * Consumption and remaining balance at a given instant.
 *
 * Reads nothing and changes nothing. Ranking and eligibility use this rather
 * than a stored status, because a run stops competing the moment its balance
 * reaches zero and not when a job gets round to recording it (ADR-012).
 */
export function projectRun(
  state: RunAccountingState,
  atMs: number,
): AccountingResult<RunProjection> {
  const failure = validate(state, atMs);
  if (failure !== null) return { ok: false, reason: failure };

  const rate = state.timeRateCentsPerHour;
  const creditedCentMs = state.creditedCents * CENT_MS_PER_CENT;
  const deficit = creditedCentMs - state.consumedCentMs;

  const rawElapsed = atMs - state.rateAnchorAtMs;
  const clockInverted = rawElapsed < 0;
  const elapsedMs = clockInverted ? 0 : rawElapsed;

  // The run cannot consume past its credit, so time beyond exhaustion is not
  // charged. Bounding first also keeps `rate * ms` away from the safe-integer
  // ceiling however long the run has been left unsettled.
  const msToExhaust = ceilDiv(deficit, rate);
  const chargeableMs = Math.min(elapsedMs, msToExhaust);
  const consumed = Math.min(state.consumedCentMs + rate * chargeableMs, creditedCentMs);

  return {
    ok: true,
    value: {
      elapsedMs,
      consumedCentMs: toCentMilliseconds(consumed),
      remainingCentMs: toCentMilliseconds(creditedCentMs - consumed),
      isExhausted: consumed >= creditedCentMs,
      exhaustsAtMs: state.rateAnchorAtMs + msToExhaust,
      clockInverted,
    },
  };
}

export type Settlement = {
  /** Consumption to store. Monotonically increasing. */
  readonly consumedCentMs: CentMilliseconds;
  /** Anchor to store, advanced by exactly the milliseconds charged. */
  readonly rateAnchorAtMs: number;
  /** How much this settlement added. Zero when nothing had elapsed. */
  readonly settledCentMs: CentMilliseconds;
  /** Whole milliseconds this settlement charged for. */
  readonly settledMs: number;
  readonly clockInverted: boolean;
};

/**
 * Charges the time elapsed at the current rate and moves the anchor forward.
 *
 * The anchor advances by exactly the whole milliseconds charged, so the
 * sub-millisecond remainder stays in the gap between the new anchor and the
 * instant, to be counted next time rather than discarded. Consumption therefore
 * equals rate times anchor movement, except at the final millisecond of a run,
 * where it is capped at the credit and the unused fraction of that millisecond
 * is simply not charged.
 *
 * Settling again at the same instant is a no-op, which makes the operation safe
 * to retry.
 */
export function settleRun(
  state: RunAccountingState,
  atMs: number,
): AccountingResult<Settlement> {
  const projected = projectRun(state, atMs);
  if (!projected.ok) return projected;

  const rate = state.timeRateCentsPerHour;
  const creditedCentMs = state.creditedCents * CENT_MS_PER_CENT;
  const deficit = creditedCentMs - state.consumedCentMs;

  const msToExhaust = ceilDiv(deficit, rate);
  const settledMs = Math.min(projected.value.elapsedMs, msToExhaust);
  const consumed = Math.min(state.consumedCentMs + rate * settledMs, creditedCentMs);

  return {
    ok: true,
    value: {
      consumedCentMs: toCentMilliseconds(consumed),
      rateAnchorAtMs: state.rateAnchorAtMs + settledMs,
      settledCentMs: toCentMilliseconds(consumed - state.consumedCentMs),
      settledMs,
      clockInverted: projected.value.clockInverted,
    },
  };
}

export type BoostFailure = AccountingFailure | 'RATE_DECREASED' | 'SETTLEMENT_TOO_SOON' | 'RUN_EXHAUSTED';

export type BoostResult =
  | { readonly ok: true; readonly value: BoostedRun }
  | { readonly ok: false; readonly reason: BoostFailure };

export type BoostedRun = {
  readonly timeRateCentsPerHour: number;
  readonly consumedCentMs: CentMilliseconds;
  readonly rateAnchorAtMs: number;
  readonly settledCentMs: CentMilliseconds;
};

/**
 * Raises the Time Rate of a funded run.
 *
 * Order matters and is not negotiable: the elapsed time is settled at the OLD
 * rate first, and only then does the new rate take effect. Past consumption is
 * never recomputed, so raising the rate can never change what the run has
 * already spent.
 *
 * The rate may stay equal or increase. It may never decrease: an active funded
 * run has already been ranked at its rate, and lowering it would let a campaign
 * take a position and then pay less to hold it.
 *
 * A boost that would advance the anchor by zero milliseconds is refused —
 * the anchor has nothing to charge — but ONLY when the run still has room to
 * live. If the run is already economically exhausted, the reason is
 * RUN_EXHAUSTED, not SETTLEMENT_TOO_SOON: the latter means "less than one
 * whole millisecond has passed", not "the run is out of money" (ADR-012).
 *
 * If the settlement performed as part of the boost consumes the last of the
 * credit, the boost is refused with RUN_EXHAUSTED: at the authoritative instant
 * the run has no economic future left, so applying the new rate would attach a
 * live rate to a dead run. Materialisation is the settle path's job — boost
 * never writes status.
 */
export function boostRun(
  state: RunAccountingState,
  atMs: number,
  newTimeRateCentsPerHour: number,
): BoostResult {
  if (!isValidTimeRate(newTimeRateCentsPerHour)) {
    return { ok: false, reason: 'INVALID_TIME_RATE' };
  }
  if (newTimeRateCentsPerHour < state.timeRateCentsPerHour) {
    return { ok: false, reason: 'RATE_DECREASED' };
  }

  const settled = settleRun(state, atMs);
  if (!settled.ok) return settled;

  const capacity = state.creditedCents * CENT_MS_PER_CENT;
  const exhaustedNow = settled.value.consumedCentMs >= capacity;

  if (settled.value.settledMs === 0) {
    return exhaustedNow
      ? { ok: false, reason: 'RUN_EXHAUSTED' }
      : { ok: false, reason: 'SETTLEMENT_TOO_SOON' };
  }

  if (exhaustedNow) {
    return { ok: false, reason: 'RUN_EXHAUSTED' };
  }

  return {
    ok: true,
    value: {
      timeRateCentsPerHour: newTimeRateCentsPerHour,
      consumedCentMs: settled.value.consumedCentMs,
      rateAnchorAtMs: settled.value.rateAnchorAtMs,
      settledCentMs: settled.value.settledCentMs,
    },
  };
}
