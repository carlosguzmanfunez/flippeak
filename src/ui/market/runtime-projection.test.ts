import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatRuntimeWithSeconds, projectRemaining } from './runtime-projection';

describe('runtime projection (QA corrective — timer)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('server snapshot with 17m 05s remaining stays exact at zero elapsed', () => {
    expect(projectRemaining(1_025_000, 0)).toBe(1_025_000);
  });

  it('client projection after 10 seconds subtracts exactly 10s', () => {
    expect(projectRemaining(1_025_000, 10_000)).toBe(1_015_000);
  });

  it('transition 17m 01s -> 16m 59s (minutes field decrements through seconds)', () => {
    expect(formatRuntimeWithSeconds(projectRemaining(1_021_000, 0))).toBe('17m 1s');
    expect(formatRuntimeWithSeconds(projectRemaining(1_021_000, 2_000))).toBe('16m 59s');
  });

  it('seconds decrement: 16m 42s -> 16m 41s', () => {
    expect(formatRuntimeWithSeconds(projectRemaining(1_002_000, 0))).toBe('16m 42s');
    expect(formatRuntimeWithSeconds(projectRemaining(1_002_000, 1_000))).toBe('16m 41s');
  });

  it('never moves locally upward: monotonic over elapsed time', () => {
    const initial = 17 * 60_000 + 5_000;
    for (let ms = 0; ms < 30_000; ms += 1_000) {
      const now = projectRemaining(initial, ms);
      expect(now).toBeLessThanOrEqual(projectRemaining(initial, Math.max(0, ms - 1_000)));
    }
  });

  it('projection is a pure delta: hydration clock offset is irrelevant', () => {
    // The component uses only (Date.now() - renderStart); absolute clocks never
    // appear, so a skewed device clock cannot bias the projection.
    const initial = 1_002_000;
    expect(projectRemaining(initial, 10_000)).toBe(initial - 10_000);
    expect(projectRemaining(initial, 50_000)).toBe(initial - 50_000);
  });

  it('zero boundary clamps and stays 0 (never negative)', () => {
    for (const elapsed of [1_002_000, 5_000_000]) {
      expect(projectRemaining(1_002_000, elapsed)).toBe(0);
    }
  });

  it('already-dead entries project to 0 and the market excludes them server-side', () => {
    expect(projectRemaining(0, 0)).toBe(0);
    expect(projectRemaining(-1, 100)).toBe(0);
    // Backend exclusion is the economic layer (ADR-012) — this layer only
    // refuses to invent positive time for a dead entry.
    expect(formatRuntimeWithSeconds(projectRemaining(-1, 100))).toBe('0m');
  });

  it('display precision: <1h shows seconds, >=1h stays compact, <1m shows seconds only', () => {
    expect(formatRuntimeWithSeconds(60 * 60_000 + 56 * 60_000)).toBe('1h 56m');
    expect(formatRuntimeWithSeconds(16 * 60_000 + 42_000)).toBe('16m 42s');
    expect(formatRuntimeWithSeconds(42_000)).toBe('42s');
    expect(formatRuntimeWithSeconds(0)).toBe('0m');
  });
});
