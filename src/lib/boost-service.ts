import { eq } from 'drizzle-orm';

import { campaignRun } from '@/db/schema';
import { db } from '@/db/client';
import { ECONOMIC_NOW_MS } from '@/db/economic-state';
import { boostRun } from '@/modules/economics/run-accounting';

/**
 * Transactional Boost (Phase 4E, master prompt 29, process 1-7).
 *
 * The locked row is the single source: the engine runs against the snapshot
 * read under `FOR UPDATE` with the authoritative `now()` from the same
 * statement, so a concurrent settlement cannot be overwritten (it either
 * serializes before us, or runs after, seeing our moved anchor).
 *
 * Steps in one transaction:
 *   1. lock the run row;
 *   2. read authoritative now (statement time, floored whole-ms) in the same
 *      query;
 *   3. settle the elapsed time at the OLD rate (engine boostRun does settle
 *      before applying);
 *   4. write settled consumption, the new rate and the moved anchor — atomic;
 *   5. any failure rolls back, so past consumption is never recomputed.
 */

type LockedBoostRow = {
  readonly id: string;
  readonly status: 'DRAFT' | 'ACTIVE' | 'EXHAUSTED';
  readonly timeRateCentsPerHour: number;
  readonly creditedCents: number;
  readonly consumedCentMs: number;
  readonly rateAnchorAt: Date | null;
};

const LOCKED_BOOST_PROJECTION = {
  id: campaignRun.id,
  status: campaignRun.status,
  timeRateCentsPerHour: campaignRun.timeRateCentsPerHour,
  creditedCents: campaignRun.creditedCents,
  consumedCentMs: campaignRun.consumedCentMs,
  rateAnchorAt: campaignRun.rateAnchorAt,
  nowMs: ECONOMIC_NOW_MS,
};

export type ApplyBoostOutcome =
  | { readonly ok: true; readonly appliedRateCentsPerHour: number }
  | { readonly ok: false; readonly reason: 'RATE_DECREASED' | 'INVALID_TIME_RATE' | 'SETTLEMENT_TOO_SOON' | 'RUN_NOT_ACTIVE' | 'INCONSISTENT' };

export async function applyBoost(
  runId: string,
  proposedRateCentsPerHour: number,
): Promise<ApplyBoostOutcome> {
  return db().transaction(async (tx) => {
    const rows = await tx
      .select(LOCKED_BOOST_PROJECTION)
      .from(campaignRun)
      .where(eq(campaignRun.id, runId))
      .for('update')
      .limit(1);

    const raw = rows[0];
    if (raw === undefined) return { ok: false, reason: 'INCONSISTENT' };

    const run: LockedBoostRow & { nowMs: number } = {
      id: raw.id,
      status: raw.status,
      timeRateCentsPerHour: raw.timeRateCentsPerHour,
      creditedCents: raw.creditedCents,
      consumedCentMs: raw.consumedCentMs,
      rateAnchorAt: raw.rateAnchorAt,
      nowMs: Number((raw as { nowMs: string | number }).nowMs),
    };

    if (run.status !== 'ACTIVE' || run.rateAnchorAt === null) {
      return { ok: false, reason: 'RUN_NOT_ACTIVE' };
    }

    const result = boostRun(
      {
        timeRateCentsPerHour: run.timeRateCentsPerHour,
        creditedCents: run.creditedCents,
        consumedCentMs: run.consumedCentMs,
        rateAnchorAtMs: run.rateAnchorAt.valueOf(),
      },
      run.nowMs,
      proposedRateCentsPerHour,
    );

    if (!result.ok) {
      // INVALID_CREDIT / INVALID_CONSUMPTION / CONSUMPTION_EXCEEDS_CREDIT /
      // INVALID_INSTANT all mean the stored row is not a valid accounting
      // state — the caller gets a clean refusal, never the underlying detail.
      if (
        result.reason === 'INVALID_TIME_RATE' ||
        result.reason === 'RATE_DECREASED' ||
        result.reason === 'SETTLEMENT_TOO_SOON'
      ) {
        return { ok: false, reason: result.reason };
      }
      return { ok: false, reason: 'INCONSISTENT' };
    }

    const value = result.value;
    await tx
      .update(campaignRun)
      .set({
        timeRateCentsPerHour: value.timeRateCentsPerHour,
        consumedCentMs: value.consumedCentMs,
        rateAnchorAt: new Date(value.rateAnchorAtMs),
      })
      .where(eq(campaignRun.id, runId));

    return { ok: true, appliedRateCentsPerHour: value.timeRateCentsPerHour };
  });
}
