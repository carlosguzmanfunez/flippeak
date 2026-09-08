import { describe, expect, it } from 'vitest';
import { compareStable, stableHash } from './stable-hash';

describe('stable hash', () => {
  it('is deterministic across calls', () => {
    expect(stableHash('run_abc')).toBe(stableHash('run_abc'));
  });

  it('produces an unsigned 32-bit integer', () => {
    for (const value of ['', 'a', 'run_abc', 'a much longer identifier value']) {
      const hash = stableHash(value);
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('separates similar identifiers', () => {
    expect(stableHash('run_1')).not.toBe(stableHash('run_2'));
  });

  it('gives a total order that does not depend on input order', () => {
    const ids = ['run_c', 'run_a', 'run_d', 'run_b'];
    const sortedOnce = [...ids].sort(compareStable);
    const sortedFromReversed = [...ids].reverse().sort(compareStable);

    expect(sortedFromReversed).toEqual(sortedOnce);
    expect(compareStable('run_a', 'run_a')).toBe(0);
  });
});
