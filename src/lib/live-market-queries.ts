import { desc } from 'drizzle-orm';

import { campaignRun } from '@/db/campaign-schema';
import { db } from '@/db/client';
import { ECONOMIC_REMAINING_CENT_MS, economicallyEligibleWhere } from '@/db/economic-state';

/**
 * Live Market query (Phase 11, master prompt 31-33, 38; ADR-005/012).
 *
 * The query expresses ECONOMIC TRUTH, not persisted status: only runs whose
 * anchor is set AND whose derived remaining is still positive appear. A stale
 * ACTIVE with zero balance never competes (ADR-012). The query feeds the pure
 * `buildTiers` (dense rank on Time Rate only) — budget, balance and clicks are
 * never even selected.
 */

export type LiveMarketRun = {
  readonly id: string;
  readonly timeRateCentsPerHour: number;
  readonly title: string;
  readonly summary: string;
  readonly category: string;
  readonly subtype: string;
  /** Derived economic remaining (cent-ms, bigint wire string). */
  readonly remainingCentMs: number;
};

export const MARKET_PROJECTION = {
  id: campaignRun.id,
  timeRateCentsPerHour: campaignRun.timeRateCentsPerHour,
  title: campaignRun.title,
  summary: campaignRun.summary,
  category: campaignRun.category,
  subtype: campaignRun.subtype,
  remainingCentMs: ECONOMIC_REMAINING_CENT_MS,
};

export async function listLiveMarketRuns(limit = 100): Promise<LiveMarketRun[]> {
  return db()
    .select(MARKET_PROJECTION)
    .from(campaignRun)
    .where(economicallyEligibleWhere())
    .orderBy(desc(campaignRun.timeRateCentsPerHour))
    .limit(limit);
}
