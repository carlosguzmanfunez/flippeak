import { describe, expect, it } from 'vitest';
import {
  assertValidTimeRate,
  isHighRate,
  isPermittedBoost,
  isStandardSliderValue,
  isValidTimeRate,
} from './time-rate';

describe('Time Rate limits', () => {
  it('accepts the approved band and rejects everything outside it', () => {
    expect(isValidTimeRate(100)).toBe(true);
    expect(isValidTimeRate(100_000)).toBe(true);
    expect(isValidTimeRate(99)).toBe(false);
    expect(isValidTimeRate(0)).toBe(false);
    expect(isValidTimeRate(-100)).toBe(false);
    expect(isValidTimeRate(100_001)).toBe(false);
    expect(isValidTimeRate(2500.5)).toBe(false);
  });

  it('separates the standard band from High Rate', () => {
    expect(isHighRate(10_000)).toBe(false);
    expect(isHighRate(10_100)).toBe(true);
    expect(isHighRate(100_000)).toBe(true);
    expect(isHighRate(100_001)).toBe(false);
  });

  it('identifies values the standard slider can produce', () => {
    expect(isStandardSliderValue(100)).toBe(true);
    expect(isStandardSliderValue(2500)).toBe(true);
    expect(isStandardSliderValue(10_000)).toBe(true);
    // Still false, but now because the step is a domain rule rather than a
    // slider rule: 2550 is not a selectable Time Rate at all.
    expect(isStandardSliderValue(2550)).toBe(false);
    expect(isValidTimeRate(2550)).toBe(false);
    // Above the standard band, so the High Rate control owns it.
    expect(isStandardSliderValue(10_100)).toBe(false);
    expect(isValidTimeRate(10_100)).toBe(true);
  });

  it('throws with a usable message on an invalid rate', () => {
    expect(() => assertValidTimeRate(50)).toThrow(RangeError);
    expect(assertValidTimeRate(2500)).toBe(2500);
  });
});

describe('whole-dollar granularity is a domain invariant', () => {
  const accepted = [100, 200, 4_700, 10_000, 10_100, 100_000];
  const rejected = [150, 4_750, 10_001, 99_999];

  it.each(accepted.map((centsPerHour) => ({ centsPerHour })))(
    'accepts $centsPerHour cents per hour',
    ({ centsPerHour }) => {
      expect(isValidTimeRate(centsPerHour)).toBe(true);
      expect(assertValidTimeRate(centsPerHour)).toBe(centsPerHour);
    },
  );

  it.each(rejected.map((centsPerHour) => ({ centsPerHour })))(
    'rejects $centsPerHour cents per hour, because it is not a whole dollar',
    ({ centsPerHour }) => {
      expect(isValidTimeRate(centsPerHour)).toBe(false);
      expect(() => assertValidTimeRate(centsPerHour)).toThrow(RangeError);
    },
  );

  it('rejects the boundaries themselves when they are not whole dollars', () => {
    expect(isValidTimeRate(99)).toBe(false);
    expect(isValidTimeRate(100_001)).toBe(false);
  });

  it('closes the fractional-dollar path for High Rate too', () => {
    expect(isHighRate(50_050)).toBe(false);
    expect(isHighRate(50_000)).toBe(true);
  });

  it('closes it for boosts as well', () => {
    expect(isPermittedBoost(10_000, 10_050)).toBe(false);
    expect(isPermittedBoost(10_000, 10_100)).toBe(true);
  });

  it('says whole dollars in the failure message', () => {
    expect(() => assertValidTimeRate(4_750)).toThrow(/whole number of dollars/);
  });
});

describe('active run rate direction', () => {
  it('permits an increase', () => {
    expect(isPermittedBoost(1000, 2000)).toBe(true);
  });

  it('refuses a decrease', () => {
    expect(isPermittedBoost(2000, 1000)).toBe(false);
  });

  it('refuses an unchanged rate, because a boost is a strict increase', () => {
    expect(isPermittedBoost(2000, 2000)).toBe(false);
  });

  it('refuses an increase beyond the absolute maximum', () => {
    expect(isPermittedBoost(99_900, 100_100)).toBe(false);
  });
});
