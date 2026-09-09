import { describe, expect, it } from 'vitest';
import { MARKET_PROJECTION } from '@/lib/live-market-queries';

/**
 * Structural tests for the Live Market query source.
 *
 * The market projection must never expose budget or balance — ranking is a
 * pure function of Time Rate (ADR-005); the economic WHERE is independently
 * pinned by economic-state.test (anchor + remaining > 0, ADR-012).
 */
describe('listLiveMarketRuns projection', () => {
  it('selects only public market fields plus server-derived presentation values', () => {
    expect(Object.keys(MARKET_PROJECTION).sort()).toEqual(
      ['category', 'destinationUrl', 'id', 'initialRuntimeMs', 'remainingCentMs', 'subtype', 'summary', 'timeRateCentsPerHour', 'title'].sort(),
    );
  });

  it('never selects financial or ownership fields', () => {
    const keys = Object.keys(MARKET_PROJECTION);
    for (const forbidden of ['creditedCents', 'consumedCentMs', 'ownerUserId', 'runId', 'status', 'rateAnchorAt']) {
      expect(keys).not.toContain(forbidden);
    }
  });
});
