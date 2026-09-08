import { describe, expect, it } from 'vitest';
import { estimateRuntimeMs, formatRuntimeEstimate } from './runtime-estimate';

describe('runtime estimator (UX, exact integer math)', () => {
  it('$10 at $5/hour lasts 2 hours', () => {
    expect(estimateRuntimeMs(1_000, 500)).toBe(2 * 3_600_000);
    expect(formatRuntimeEstimate(estimateRuntimeMs(1_000, 500))).toBe('2 hours');
  });

  it('$10 at $100/hour lasts 6 minutes', () => {
    expect(estimateRuntimeMs(1_000, 10_000)).toBe(6 * 60_000);
    expect(formatRuntimeEstimate(estimateRuntimeMs(1_000, 10_000))).toBe('6 minutes');
  });

  it('$10 at $1,000/hour lasts 36 seconds', () => {
    expect(estimateRuntimeMs(1_000, 100_000)).toBe(36_000);
    expect(formatRuntimeEstimate(estimateRuntimeMs(1_000, 100_000))).toBe('36 seconds');
  });

  it('rejects zero/negative inputs without crashing', () => {
    expect(estimateRuntimeMs(0, 500)).toBe(0);
    expect(estimateRuntimeMs(1_000, 0)).toBe(0);
    expect(estimateRuntimeMs(-5, 500)).toBe(0);
  });
});
