import { eq } from 'drizzle-orm';

import { campaignRun } from '@/db/campaign-schema';
import { db } from '@/db/client';
import { ECONOMIC_ELAPSED_CEILED_MS, ECONOMIC_NOW_MS_CEILED } from '@/db/economic-state';
import { isUuidLike } from '@/modules/campaigns/campaign-run';
import type { CampaignRunStatus } from '@/modules/campaigns/campaign-run';
import { consume } from '@/modules/economics/economic-engine';

/**
 * Transactional economic writes (Phase 4C, master prompt section 28-30).
 *
 * The pure engine decides; the database is the only clock. `now()` is
 * PostgreSQL statement/transaction time — never the JS clock, never the
 * browser. Every settlement:
 *
 *  1. locks the run row (`FOR UPDATE`), so two concurrent settlements or a
 *     settlement racing a boost serialize;
 *  2. derives the ceiled elapsed from the SAME statement that reads the row,
 *     so the anchor and the elapsed always agree;
 *  3. runs the exact engine over the locked snapshot;
 *  4. writes the settled `consumed`, moves `rate_anchor_at` to the same
 *     authoritative instant, and materialises EXHAUSTED (idempotent) in the
 *     same unit of work.
 *
 * Repeated settlements cannot double-count: after a settle the anchor points
 * at the settled instant, and a re-settle sees zero elapsed (ADR-012, audit
 * finding #2 semantics).
 */

export type AccountingSettleResult =
  | { readonly ok: true; readonly runId: string }
  | { readonly ok: false; readonly reason: 'RUN_NOT_FOUND' };

type LockedRunRow = {
  readonly id: string;
  readonly status: CampaignRunStatus;
  readonly creditedCents: number;
  readonly consumedCentMs: number;
  readonly timeRateCentsPerHour: number;
  readonly elapsedMsCeiled: number;
  readonly nowMsCeiled: number;
};

const LOCKED_RUN_PROJECTION = {
  id: campaignRun.id,
  status: campaignRun.status,
  creditedCents: campaignRun.creditedCents,
  consumedCentMs: campaignRun.consumedCentMs,
  timeRateCentsPerHour: campaignRun.timeRateCentsPerHour,
  elapsedMsCeiled: ECONOMIC_ELAPSED_CEILED_MS,
  nowMsCeiled: ECONOMIC_NOW_MS_CEILED,
};

/**
 * Settles one run up to `now()` and materialises EXHAUSTED when the derived
 * remaining is exactly zero. Safe to call repeatedly: idempotent.
 */
export async function settleAndMaterialize(runId: string): Promise<AccountingSettleResult> {
  if (!isUuidLike(runId)) return { ok: false, reason: 'RUN_NOT_FOUND' };

  return db().transaction(async (tx) => {
    const rows = await tx.select(LOCKED_RUN_PROJECTION).from(campaignRun).where(eq(campaignRun.id, runId)).for('update').limit(1);

    const run = rows[0] as LockedRunRow | undefined;
    if (run === undefined) return { ok: false, reason: 'RUN_NOT_FOUND' };

    const result = consume({
      creditedCents: run.creditedCents,
      consumedCentMs: run.consumedCentMs,
      rateCentsPerHour: run.timeRateCentsPerHour,
      elapsedMsCeiled: run.elapsedMsCeiled,
    });

    const settledAnything = result.consumedCentMs !== run.consumedCentMs;
    const materialize = result.exhausted && run.status !== 'EXHAUSTED';

    if (settledAnything || materialize) {
      await tx
        .update(campaignRun)
        .set({
          consumedCentMs: result.consumedCentMs,
          rateAnchorAt: new Date(run.nowMsCeiled),
          ...(materialize ? { status: 'EXHAUSTED' as const } : {}),
        })
        .where(eq(campaignRun.id, run.id));
    }

    return { ok: true, runId: run.id };
  });
}
