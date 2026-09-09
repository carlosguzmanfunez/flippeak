import { describe, expect, it } from 'vitest';
import {
  addCents,
  centsFromMajorUnits,
  formatCents,
  formatTimeRate,
  formatTimeRateCompact,
  isCents,
  parseCents,
  subtractCents,
  toCents,
} from './money';

describe('exact money', () => {
  it('accepts only safe integers', () => {
    expect(isCents(1234)).toBe(true);
    expect(isCents(0)).toBe(true);
    expect(isCents(-500)).toBe(true);
    expect(isCents(12.34)).toBe(false);
    expect(isCents(Number.NaN)).toBe(false);
    expect(isCents(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isCents(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
  });

  it('rejects fractional cents at the boundary', () => {
    expect(() => toCents(12.5)).toThrow(TypeError);
  });

  it('parses decimal input without floating point drift', () => {
    expect(parseCents('12.34')).toBe(1234);
    expect(parseCents('0.07')).toBe(7);
    expect(parseCents('0.1')).toBe(10);
    expect(parseCents('1')).toBe(100);
    expect(parseCents('1000.00')).toBe(100_000);
    expect(parseCents(' 25.50 ')).toBe(2550);
    expect(parseCents('-3.05')).toBe(-305);
  });

  it('rejects input it cannot represent exactly', () => {
    expect(() => parseCents('12.345')).toThrow(TypeError);
    expect(() => parseCents('abc')).toThrow(TypeError);
    expect(() => parseCents('')).toThrow(TypeError);
    expect(() => parseCents('1e3')).toThrow(TypeError);
    expect(() => parseCents('.5')).toThrow(TypeError);
  });

  it('agrees with major-unit conversion on values prone to binary drift', () => {
    expect(centsFromMajorUnits(12.34)).toBe(parseCents('12.34'));
    expect(centsFromMajorUnits(0.07)).toBe(parseCents('0.07'));
    expect(centsFromMajorUnits(29.99)).toBe(parseCents('29.99'));
  });

  it('canonical compact Time Rate: "$25.00/h", "$45.00/h", "$1.00/h", "$1,000.00/h"', () => {
    expect(formatTimeRateCompact(toCents(2_500))).toBe('$25.00/h');
    expect(formatTimeRateCompact(toCents(4_500))).toBe('$45.00/h');
    expect(formatTimeRateCompact(toCents(100))).toBe('$1.00/h');
    expect(formatTimeRateCompact(toCents(100_000))).toBe('$1,000.00/h');
  });

  it('keeps arithmetic exact', () => {
    const total = addCents(parseCents('0.1'), parseCents('0.2'));
    expect(total).toBe(30);
    expect(subtractCents(toCents(10_000), toCents(2_575))).toBe(7_425);
  });

  it('refuses arithmetic that leaves the safe integer range', () => {
    expect(() => addCents(toCents(Number.MAX_SAFE_INTEGER), toCents(1))).toThrow(TypeError);
  });

  it('formats amounts for display', () => {
    expect(formatCents(toCents(1234))).toBe('$12.34');
    expect(formatCents(toCents(100))).toBe('$1.00');
    expect(formatCents(toCents(100), { trimWholeUnits: true })).toBe('$1');
    expect(formatCents(toCents(123_456))).toBe('$1,234.56');
    expect(formatCents(toCents(-250))).toBe('-$2.50');
  });

  it('formats Time Rates the way the product speaks about them', () => {
    expect(formatTimeRate(toCents(2500))).toBe('$25/hour');
    expect(formatTimeRate(toCents(2450))).toBe('$24.50/hour');
    expect(formatTimeRate(toCents(100_000))).toBe('$1,000/hour');
  });
});
