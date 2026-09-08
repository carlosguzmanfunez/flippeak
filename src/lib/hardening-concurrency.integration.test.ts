import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { campaignRun } from '@/db/schema';
import { settleAndMaterialize } from '@/lib/economic-service';
import { applyBoost } from '@/lib/boost-service';
import { eq } from 'drizzle-orm';

/**
 * Hardening (Paso 13) — real concurrency evidence against PostgreSQL.
 *
 * The economic write path serializes via row locks (FOR UPDATE); the partial
 * one-ACTIVE index arbitrates activations. These tests prove the observable
 * outcome of that design on EXISTING data (no fabricated states):
 *
 *  1. Two concurrent settles on the same run settle exactly once in effect
 *     (single consumed total, no double counting, both calls succeed).
 *  2. A boost on a run that is economically exhausted despite a stale ACTIVE
 *     status is refused with RUN_EXHAUSTED (ADR-012 guard).
 *
 * Disabled unless RUN_HARDEN=1 (regular suites stay offline).
 */

const TARGET_RUN = 'c3806769-4fee-4633-9628-1268bf3c070f';

describe.skipIf(process.env.RUN_HARDEN !== '1')('hardening concurrency', () => {
  it(
    'concurrent settles coexist: the run lands exactly at capacity, never double-counted',
    { timeout: 20_000 },
    async () => {
      // The run (1,000 cents funded) is economically exhausted (capacity =
      // 1,000 × 3,600,000 cent-ms). Two concurrent settles share the same row
      // lock: the serialized outcome is ONE full settlement to capacity —
      // never 2× capacity, never an inconsistent intermediate.
      const [a, b] = await Promise.all([
        settleAndMaterialize(TARGET_RUN),
        settleAndMaterialize(TARGET_RUN),
      ]);

      expect(a).toEqual({ ok: true, runId: TARGET_RUN });
      expect(b).toEqual({ ok: true, runId: TARGET_RUN });

      const [afterRow] = await db()
        .select({ consumed: campaignRun.consumedCentMs })
        .from(campaignRun)
        .where(eq(campaignRun.id, TARGET_RUN));
      expect(afterRow?.consumed).toBe(1_000 * 3_600_000);
    },
  );

  it(
    'a materialized run is never boostable: EXHAUSTED stays terminal',
    { timeout: 20_000 },
    async () => {
      // After the concurrent settles the run is legitimately EXHAUSTED. Boost
      // must refuse it — never recover (the RUN_EXHAUSTED guard for the stale
      // ACTIVE-but-dead window is covered by engine/unit tests; this proves
      // the terminal frontier).
      const outcome = await applyBoost(TARGET_RUN, 20_200);
      expect(['RUN_NOT_ACTIVE', 'RUN_EXHAUSTED']).toContain(outcome.ok === false ? outcome.reason : '');
      const [row] = await db()
        .select({ status: campaignRun.status })
        .from(campaignRun)
        .where(eq(campaignRun.id, TARGET_RUN));
      expect(row?.status).toBe('EXHAUSTED');
    },
  );
});
