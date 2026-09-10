import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { campaignRun } from '@/db/schema';
import { settleAndMaterialize } from '@/lib/economic-service';
import { applyBoost } from '@/lib/boost-service';
import { purgeOwner, seedCampaign, seedOwner, seedRun } from '@/test/integration-fixtures';

/**
 * Hardening (Paso 13) — real concurrency evidence against PostgreSQL.
 *
 * The economic write path serializes via row locks (FOR UPDATE); the partial
 * one-ACTIVE index arbitrates activations. These tests prove the observable
 * outcome of that design:
 *
 *  1. Two concurrent settles on the same run settle exactly once in effect
 *     (single consumed total, no double counting, both calls succeed).
 *  2. A boost on a run that is economically exhausted is refused (ADR-012).
 *
 * Patch A3: the run is now SEEDED here instead of being a hardcoded production
 * id. The assertions are unchanged; what changed is that they no longer assert
 * anything about rows that happen to exist in the production database.
 *
 * Disabled unless RUN_HARDEN=1 (regular suites stay offline).
 */

const RATE = 100; // $1/hour, the minimum selectable Time Rate
const CREDITED_CENTS = 1_000;
const CAPACITY_CENT_MS = CREDITED_CENTS * 3_600_000;
// Capacity / rate = 3 600 000 000 / 100 = 36 000 000 ms = 10 h of consumption.
// Eleven hours guarantee that a single settle lands exactly on the cap.
const ANCHOR_MS_AGO = 11 * 3_600_000;

let ownerUserId = '';
let runId = '';

describe.skipIf(process.env.RUN_HARDEN !== '1')('hardening concurrency', () => {
  beforeAll(async () => {
    ownerUserId = await seedOwner();
    const campaignId = await seedCampaign(ownerUserId);
    runId = await seedRun({
      campaignId,
      timeRateCentsPerHour: RATE,
      status: 'ACTIVE',
      creditedCents: CREDITED_CENTS,
      consumedCentMs: 0,
      rateAnchorAt: new Date(Date.now() - ANCHOR_MS_AGO),
    });
  });

  afterAll(async () => {
    await purgeOwner(ownerUserId);
  });

  it(
    'concurrent settles coexist: the run lands exactly at capacity, never double-counted',
    { timeout: 20_000 },
    async () => {
      // The run (1 000 cents funded) is economically exhausted (capacity =
      // 1 000 × 3 600 000 cent-ms). Two concurrent settles share the same row
      // lock: the serialized outcome is ONE full settlement to capacity —
      // never 2× capacity, never an inconsistent intermediate.
      const [a, b] = await Promise.all([
        settleAndMaterialize(runId),
        settleAndMaterialize(runId),
      ]);

      expect(a).toEqual({ ok: true, runId });
      expect(b).toEqual({ ok: true, runId });

      const [afterRow] = await db()
        .select({ consumed: campaignRun.consumedCentMs })
        .from(campaignRun)
        .where(eq(campaignRun.id, runId));
      expect(afterRow?.consumed).toBe(CAPACITY_CENT_MS);
    },
  );

  it(
    'a materialized run is never boostable: EXHAUSTED stays terminal',
    { timeout: 20_000 },
    async () => {
      // After the concurrent settles the run is legitimately EXHAUSTED. Boost
      // must refuse it — never revive it.
      const outcome = await applyBoost(runId, 20_200);
      expect(['RUN_NOT_ACTIVE', 'RUN_EXHAUSTED']).toContain(outcome.ok === false ? outcome.reason : '');
      const [row] = await db()
        .select({ status: campaignRun.status })
        .from(campaignRun)
        .where(eq(campaignRun.id, runId));
      expect(row?.status).toBe('EXHAUSTED');
    },
  );
});
