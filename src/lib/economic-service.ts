import { eq } from 'drizzle-orm';

import { campaignRun } from '@/db/campaign-schema';
import { db } from '@/db/client';
import { ECONOMIC_NOW_MS } from '@/db/economic-state';
import { isUuidLike } from '@/modules/campaigns/campaign-run';
import type { CampaignRunStatus } from '@/modules/campaigns/campaign-run';
import { CENT_MS_PER_CENT, settleRun } from '@/modules/economics/run-accounting';

/**
 * Transactional economic writes (Phase 4C, master prompt section 28-30).
 *
 * The canonical engine decides; the database is the only clock. `now()` is
 * PostgreSQL statement/transaction time — never the JS clock, never the
 * browser. Every settlement:
 *
 *  1. locks the run row (`FOR UPDATE`), so two concurrent settlements or a
 *     settlement racing a boost serialize;
 *  2. reads the authoritative now from the SAME statement that locks the row,
 *     so the anchor and the elapsed always agree;
 *  3. runs `settleRun` of the canonical engine over the locked snapshot
 *     (whole milliseconds, floored at the boundary — ADR-013);
 *  4. writes the settled `consumed`, moves `rate_anchor_at` to exactly the
 *     milliseconds charged, and materialises EXHAUSTED (idempotent) in the
 *     same unit of work.
 *
 * Repeated settlements cannot double-count: after a settle the anchor points
 * at the settled instant, and a re-settle at the same instant sees zero
 * elapsed (engine invariant: settling twice adds nothing).
 */

export type AccountingSettleResult =
  | { readonly ok: true; readonly runId: string }
  | { readonly ok: false; readonly reason: 'RUN_NOT_FOUND' };

type LockedRunRow = {
  readonly id: string;
  readonly status: CampaignRunStatus;
  readonly timeRateCentsPerHour: number;
  /** bigint column mapped with mode:'number' by Drizzle: already a number. */
  readonly creditedCents: number;
  readonly consumedCentMs: number;
  /** timestamptz column returned by the driver as a Date. */
  readonly rateAnchorAt: Date | null;
  /** raw SQL bigint: the driver delivers a string. Decoded below. */
  readonly nowMs: number;
};

const LOCKED_RUN_PROJECTION = {
  id: campaignRun.id,
  status: campaignRun.status,
  timeRateCentsPerHour: campaignRun.timeRateCentsPerHour,
  creditedCents: campaignRun.creditedCents,
  consumedCentMs: campaignRun.consumedCentMs,
  rateAnchorAt: campaignRun.rateAnchorAt,
  nowMs: ECONOMIC_NOW_MS,
};

/**
 * Decodes a run row locked for update.
 *
 * Drizzle converts `bigint` columns mapped with `mode: 'number'`, but any
 * SQL-wrapped bigint expression (`nowMs` here) still arrives through the wire
 * as a string. The conversion to number is explicit and happens right here at
 * the transport boundary — after this point the pure engine only ever sees
 * safe integers (plan step 5; `typeof` of every raw bigint kept as a number).
 */
const decodeLockedRun = (row: Omit<LockedRunRow, 'nowMs'> & { nowMs: number | string }): LockedRunRow => ({
  ...row,
  nowMs: Number(row.nowMs),
});

/**
 * Settles one run up to `now()` and materialises EXHAUSTED when the derived
 * remaining is exactly zero. Safe to call repeatedly: idempotent.
 *
 * Intentionally has no consumer yet: activation (4D) and boost (4E) build on
 * top of this layer.
 */
export async function settleAndMaterialize(runId: string): Promise<AccountingSettleResult> {
  if (!isUuidLike(runId)) return { ok: false, reason: 'RUN_NOT_FOUND' };

  return db().transaction(async (tx) => {
    const rows = await tx
      .select(LOCKED_RUN_PROJECTION)
      .from(campaignRun)
      .where(eq(campaignRun.id, runId))
      .for('update')
      .limit(1);

    const raw = rows[0];
    if (raw === undefined) return { ok: false, reason: 'RUN_NOT_FOUND' };
    const run = decodeLockedRun(raw);

    // A DRAFT has no anchor: nothing is charged until it is funded and
    // activated, so there is no settlement to perform.
    if (run.rateAnchorAt === null) return { ok: true, runId: run.id };

    // The engine requires whole milliseconds. The anchor's sub-millisecond
    // remainder is the caller's responsibility: anchors written by this
    // service are always exact whole ms (we store `new Date(settled anchor)`),
    // and any other writer must follow the same floor rule (ADR-013).
    const settled = settleRun(
      {
        timeRateCentsPerHour: run.timeRateCentsPerHour,
        creditedCents: run.creditedCents,
        consumedCentMs: run.consumedCentMs,
        rateAnchorAtMs: run.rateAnchorAt.valueOf(),
      },
      run.nowMs,
    );

    if (!settled.ok) {
      // Domain error without leaking the internal reason.
      throw new Error('Run accounting state is inconsistent; refusing to settle.');
    }

    const value = settled.value;
    const materialize = value.consumedCentMs >= run.creditedCents * CENT_MS_PER_CENT && run.status !== 'EXHAUSTED';

    if (value.settledMs > 0 || materialize) {
      await tx
        .update(campaignRun)
        .set({
          consumedCentMs: value.consumedCentMs,
          rateAnchorAt: new Date(value.rateAnchorAtMs),
          ...(materialize ? { status: 'EXHAUSTED' as const } : {}),
        })
        .where(eq(campaignRun.id, run.id));
    }

    return { ok: true, runId: run.id };
  });
}
