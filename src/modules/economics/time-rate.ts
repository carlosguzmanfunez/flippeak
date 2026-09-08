import { TIME_RATE } from '@/config/domain-config';
import { type Cents, toCents } from './money';

/**
 * Time Rate validity rules.
 *
 * These are pure predicates. They are the vocabulary the transactional Boost
 * service uses, but they are not the enforcement point: the authoritative check
 * happens inside the locked transaction that settles the run, because only that
 * transaction can compare the stored current rate against the proposed one
 * (ADR-003).
 */

/** A Time Rate expressed in cents per hour. */
export type TimeRateCentsPerHour = Cents;

/**
 * True when the rate is a selectable Time Rate.
 *
 * Three conditions, all of them domain rules:
 *  - a safe integer number of cents
 *  - inside the approved $1–$1,000/hour band
 *  - a whole number of dollars
 *
 * The whole-dollar step is enforced here rather than only in the slider. If the
 * domain accepted $47.50, an API caller could buy competitive precision that the
 * interface never offers a normal advertiser — position would then partly depend
 * on how someone submitted their rate rather than on how much they committed.
 *
 * Canonical storage stays in integer cents; this only constrains which cent
 * values are selectable.
 */
export function isValidTimeRate(centsPerHour: number): boolean {
  return (
    Number.isSafeInteger(centsPerHour) &&
    centsPerHour >= TIME_RATE.minCentsPerHour &&
    centsPerHour <= TIME_RATE.maxCentsPerHour &&
    centsPerHour % TIME_RATE.standardStepCentsPerHour === 0
  );
}

export function assertValidTimeRate(centsPerHour: number): TimeRateCentsPerHour {
  if (!isValidTimeRate(centsPerHour)) {
    throw new RangeError(
      `Time Rate must be a whole number of dollars between ${TIME_RATE.minCentsPerHour} and ${TIME_RATE.maxCentsPerHour} cents per hour. Received: ${centsPerHour}`,
    );
  }
  return toCents(centsPerHour);
}

/** True when the rate belongs to the High Rate band ($101–$1,000/hour). */
export function isHighRate(centsPerHour: number): boolean {
  return isValidTimeRate(centsPerHour) && centsPerHour > TIME_RATE.maxStandardCentsPerHour;
}

/**
 * True when the rate is a value the standard slider can produce.
 *
 * The step check that used to live here moved into `isValidTimeRate`, where it
 * now applies to every rate rather than only to slider values. What remains is
 * the band: the standard control covers $1–$100/hour, and anything above it
 * belongs to the separate High Rate control.
 */
export function isStandardSliderValue(centsPerHour: number): boolean {
  return isValidTimeRate(centsPerHour) && centsPerHour <= TIME_RATE.maxStandardCentsPerHour;
}

/**
 * True when an active run may move from `current` to `proposed`.
 *
 * An active run's Time Rate may stay the same or increase, never decrease
 * (invariant 5). A boost specifically requires a strict increase.
 */
export function isPermittedBoost(current: number, proposed: number): boolean {
  return isValidTimeRate(proposed) && proposed > current;
}
