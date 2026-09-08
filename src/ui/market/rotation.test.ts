import { describe, expect, it } from 'vitest';
import { msUntilNextRotation, rotationSlot, spotlightIndex } from './rotation';

const INTERVAL = 20_000;

describe('spotlight rotation', () => {
  it('derives the slot from authoritative time, not from page load', () => {
    expect(rotationSlot(0)).toBe(0);
    expect(rotationSlot(19_999)).toBe(0);
    expect(rotationSlot(20_000)).toBe(1);
    expect(rotationSlot(60_000)).toBe(3);
  });

  it('gives every member of a stable tier an equal turn', () => {
    const indexes = [0, 1, 2, 3, 4, 5].map((slot) => spotlightIndex(slot * INTERVAL, 3));
    expect(indexes).toEqual([0, 1, 2, 0, 1, 2]);
  });

  it('produces the same spotlight for two visitors at the same instant', () => {
    const instant = 1_764_000_037_512;
    expect(spotlightIndex(instant, 4)).toBe(spotlightIndex(instant, 4));
  });

  it('holds the spotlight for the whole interval', () => {
    expect(spotlightIndex(20_000, 3)).toBe(1);
    expect(spotlightIndex(39_999, 3)).toBe(1);
    expect(spotlightIndex(40_000, 3)).toBe(2);
  });

  it('always points at the only member of a single-campaign tier', () => {
    expect(spotlightIndex(123_456_789, 1)).toBe(0);
  });

  it('refuses an empty tier rather than returning a meaningless index', () => {
    expect(() => spotlightIndex(0, 0)).toThrow(RangeError);
    expect(() => spotlightIndex(0, -1)).toThrow(RangeError);
  });

  it('reports the time left in the current slot', () => {
    expect(msUntilNextRotation(0)).toBe(20_000);
    expect(msUntilNextRotation(5_000)).toBe(15_000);
    expect(msUntilNextRotation(19_999)).toBe(1);
  });
});
