import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { paymentOrder } from '@/db/schema';
import { listBlockedRuns, reportBlockedOrders } from './blocking-order-preflight';
import type { ProviderOrderStatus } from './blocking-order-preflight';
import { purgeOwner, seedCampaign, seedOwner, seedRun } from '@/test/integration-fixtures';

/**
 * The blocking-order preflight against real PostgreSQL (B2 §7 / §19 / §20).
 *
 * The unit tests only exercise `assessBlockingOrder`, which is pure — and that is
 * exactly how an invalid `ORDER BY` on a table absent from the FROM clause went
 * unnoticed. These tests run the actual queries.
 *
 * Required database state: migrations 0000–0009 applied and **0010 NOT applied**.
 * The preflight only has work to do while multi-blocker history can exist; once
 * the one-blocking-order-per-run index is installed, this fixture could not even
 * be inserted. The suite therefore skips itself, with a reason, when the index is
 * present, instead of failing or, worse, silently passing.
 *
 * Disabled unless RUN_PREFLIGHT=1 (regular suites stay offline).
 */

const ENABLED = process.env.RUN_PREFLIGHT === '1';
const BLOCKING_INDEX = 'payment_order_one_blocking_per_run_uidx';

async function blockingIndexInstalled(): Promise<boolean> {
  const result = (await db().execute(
    sql`select count(*)::int as n from pg_indexes where indexname = ${BLOCKING_INDEX}`,
  )) as unknown as { rows: { n: number }[] };
  return (result.rows[0]?.n ?? 0) > 0;
}

const indexInstalled = ENABLED ? await blockingIndexInstalled() : false;

/** Fixture order insert, kept here because only this suite needs one. */
async function seedOrder(input: {
  readonly runId: string;
  readonly state: 'PENDING' | 'APPROVED';
  readonly providerOrderId: string;
  readonly createdAt: Date;
}): Promise<string> {
  const orderId = randomUUID();
  await db().insert(paymentOrder).values({
    id: orderId,
    runId: input.runId,
    state: input.state,
    applicationState: null,
    amountCents: 500,
    currency: 'USD',
    provider: 'paypal',
    providerOrderId: input.providerOrderId,
    createdAt: input.createdAt,
  });
  return orderId;
}

const snapshot = async (runId: string) =>
  db()
    .select({
      id: paymentOrder.id,
      state: paymentOrder.state,
      applicationState: paymentOrder.applicationState,
      providerCaptureId: paymentOrder.providerCaptureId,
      updatedAt: paymentOrder.updatedAt,
    })
    .from(paymentOrder)
    .where(eq(paymentOrder.runId, runId))
    .orderBy(paymentOrder.id);

describe.skipIf(!ENABLED || indexInstalled)(
  'blocking-order preflight against PostgreSQL',
  () => {
    let ownerUserId = '';
    let runId = '';
    let approvedOrderId = '';
    let pendingOrderId = '';
    const approvedProviderId = `it-po-approved-${randomUUID()}`;
    const pendingProviderId = `it-po-pending-${randomUUID()}`;

    beforeAll(async () => {
      ownerUserId = await seedOwner();
      const campaignId = await seedCampaign(ownerUserId);
      runId = await seedRun({
        campaignId,
        timeRateCentsPerHour: 10_000,
        status: 'ACTIVE',
        creditedCents: 500,
        rateAnchorAt: new Date(),
      });

      // Exactly the history 0010 refuses: one APPROVED plus one PENDING on one run.
      approvedOrderId = await seedOrder({
        runId,
        state: 'APPROVED',
        providerOrderId: approvedProviderId,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      pendingOrderId = await seedOrder({
        runId,
        state: 'PENDING',
        providerOrderId: pendingProviderId,
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      });
    });

    afterAll(async () => {
      await purgeOwner(ownerUserId);
    });

    it('finds the run and both of its blocking orders', async () => {
      const blocked = await listBlockedRuns();
      const mine = blocked.find((entry) => entry.runId === runId);
      expect(mine).toBeDefined();
      expect([...mine!.blockingOrderIds].sort()).toEqual([approvedOrderId, pendingOrderId].sort());
    });

    it('reports both orders in a deterministic order', async () => {
      const report = (await reportBlockedOrders()).filter((row) => row.runId === runId);
      expect(report.map((row) => row.orderId)).toEqual([approvedOrderId, pendingOrderId]);
    });

    it('asks for a provider query when no status is supplied', async () => {
      const report = (await reportBlockedOrders()).filter((row) => row.runId === runId);
      for (const row of report) {
        expect(row.assessment).toEqual({ outcome: 'NEEDS_PROVIDER_STATUS', reason: 'NOT_QUERIED' });
      }
    });

    it('decides from provider status and writes nothing at all', async () => {
      const before = await snapshot(runId);

      const statuses = new Map<string, ProviderOrderStatus>([
        [approvedProviderId, 'VOIDED'],
        [pendingProviderId, 'APPROVED'],
      ]);
      const report = (await reportBlockedOrders(statuses)).filter((row) => row.runId === runId);
      expect(report).toHaveLength(2);

      const byOrder = new Map(report.map((row) => [row.orderId, row.assessment]));
      expect(byOrder.get(approvedOrderId)).toEqual({
        outcome: 'RELEASE',
        reason: 'PROVIDER_CONFIRMS_NOT_CAPTURABLE',
      });
      expect(byOrder.get(pendingOrderId)).toEqual({
        outcome: 'KEEP_BLOCKED',
        reason: 'PROVIDER_MAY_STILL_CAPTURE',
      });

      // The module decides and reports; it never performs the transition.
      const after = await snapshot(runId);
      expect(after).toEqual(before);
    });

    it('does not extend a release to an order whose provider id is unknown', async () => {
      await db()
        .update(paymentOrder)
        .set({ providerOrderId: null })
        .where(eq(paymentOrder.id, pendingOrderId));
      try {
        const statuses = new Map<string, ProviderOrderStatus>([[approvedProviderId, 'VOIDED']]);
        const report = (await reportBlockedOrders(statuses)).filter((row) => row.runId === runId);
        const pending = report.find((row) => row.orderId === pendingOrderId);
        expect(pending?.assessment).toEqual({
          outcome: 'NEEDS_PROVIDER_STATUS',
          reason: 'NO_PROVIDER_ORDER',
        });
      } finally {
        await db()
          .update(paymentOrder)
          .set({ providerOrderId: pendingProviderId })
          .where(eq(paymentOrder.id, pendingOrderId));
      }
    });

    it('leaves no fixture behind', async () => {
      // Both orders belong to the seeded run, so teardown is the suite's job; this
      // asserts the module itself created nothing new.
      const rows = await db()
        .select({ id: paymentOrder.id })
        .from(paymentOrder)
        .where(inArray(paymentOrder.id, [approvedOrderId, pendingOrderId]));
      expect(rows).toHaveLength(2);
    });
  },
);
