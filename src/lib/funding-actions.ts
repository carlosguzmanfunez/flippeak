'use server';

import { and, eq, sql } from 'drizzle-orm';

import { campaign, campaignRun, runFunding } from '@/db/schema';
import { db } from '@/db/client';
import { ECONOMIC_NOW_MS, ECONOMIC_REMAINING_CENT_MS } from '@/db/economic-state';
import { getAuthenticatedPrincipal } from '@/lib/auth-guards';
import { activateRun, fundRun } from '@/modules/payments/funding';
import type { FundingDependencies, OwnedRunAccounting } from '@/modules/payments/funding';
import { settleAndMaterialize } from './economic-service';

/**
 * Server Actions for Phase 4D: verified funding and activation.
 *
 * These are reachable POST endpoints, not private functions, so every
 * authorization decision lives inside this call path — as it does in
 * `campaign-actions.ts`. Fields are read from FormData by name; there is no
 * spread. The ledger transaction is the only writer of `credited_cents`
 * (master prompt 34, 36): the lock makes credit, activation and settlement
 * serialize, and the partial one-ACTIVE index makes the activation race
 * atomic.
 */

const runProjection = {
  id: campaignRun.id,
  status: campaignRun.status,
  campaignId: campaignRun.campaignId,
  timeRateCentsPerHour: campaignRun.timeRateCentsPerHour,
  creditedCents: campaignRun.creditedCents,
  consumedCentMs: campaignRun.consumedCentMs,
};

const loadOwnedRun: FundingDependencies['loadOwnedRun'] = async (principal, runId) => {
  const rows = await db()
    .select(runProjection)
    .from(campaignRun)
    .innerJoin(campaign, eq(campaignRun.campaignId, campaign.id))
    .where(and(eq(campaignRun.id, runId), eq(campaign.ownerUserId, principal.userId)))
    .limit(1);

  const run = rows[0];
  if (run === undefined) return null;

  // raw SQL bigint arrives as a string; decode at the transport boundary.
  const totals = await db()
    .select({ total: sql<string>`coalesce(sum(${runFunding.fundingCents}), 0)::bigint` })
    .from(runFunding)
    .where(and(eq(runFunding.runId, runId), eq(runFunding.verified, true)));

  return {
    id: run.id,
    status: run.status,
    campaignId: run.campaignId,
    timeRateCentsPerHour: run.timeRateCentsPerHour,
    creditedCents: run.creditedCents,
    consumedCentMs: run.consumedCentMs,
    verifiedFundingCents: Number(totals[0]?.total ?? 0),
  } satisfies OwnedRunAccounting;
};

const persistFunding: FundingDependencies['persistFunding'] = async ({ runId, cents, provider, providerEventId }) => {
  await db().transaction(async (tx) => {
    await tx
      .select({ id: campaignRun.id })
      .from(campaignRun)
      .where(eq(campaignRun.id, runId))
      .for('update')
      .limit(1);

    await tx.insert(runFunding).values({
      runId,
      fundingCents: cents,
      provider,
      providerEventId,
      verified: true,
      // The financial record keeps PostgreSQL time, like every other stamp.
      verifiedAt: sql`now()`,
    });
    await tx
      .update(campaignRun)
      .set({ creditedCents: sql`${campaignRun.creditedCents} + ${cents}` })
      .where(eq(campaignRun.id, runId));
  });
};

const activate: FundingDependencies['activate'] = async ({ runId, anchorAtMs }) => {
  try {
    await db().transaction(async (tx) => {
      await tx
        .update(campaignRun)
        .set({ status: 'ACTIVE', rateAnchorAt: new Date(anchorAtMs) })
        .where(and(eq(campaignRun.id, runId), eq(campaignRun.status, 'DRAFT')));
    });
    return 'OK';
  } catch (error) {
    // One ACTIVE per Campaign is enforced by the partial unique index; the
    // race resolves here, cleanly, without exposing the constraint.
    if (isUniqueViolation(error)) return 'ACTIVE_RUN_EXISTS';
    throw error;
  }
};

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === '23505';

const readNowMs: FundingDependencies['readNowMs'] = async () => {
  const rows = await db().select({ nowMs: ECONOMIC_NOW_MS }).from(campaignRun).limit(1);
  return Number(rows[0]?.nowMs ?? 0);
};

const dependencies: FundingDependencies = {
  resolvePrincipal: getAuthenticatedPrincipal,
  loadOwnedRun,
  persistFunding,
  activate,
  readNowMs,
};

export async function fundRunAction(formData: FormData) {
  return fundRun(dependencies, {
    runId: formData.get('runId'),
    amountCents: formData.get('amountCents'),
  });
}

export async function activateRunAction(formData: FormData) {
  return activateRun(dependencies, {
    runId: formData.get('runId'),
  });
}

/**
 * Materialises economically exhausted runs (ADR-012, master prompt 30).
 *
 * No consumer-facing surface yet: a Vercel Cron is the intended caller after
 * the phase II rollout. Cron reconciles and records; it is never the economic
 * authority — the derived condition decides, this only writes the history.
 */
export async function materializeExhaustedRunsAction(): Promise<{ ok: true; runCount: number }> {
  const principal = await getAuthenticatedPrincipal();
  if (principal === null || principal.role !== 'ADMIN') {
    throw new Error('Not authorized');
  }

  const rows = await db()
    .select({ id: campaignRun.id })
    .from(campaignRun)
    .where(
      and(
        eq(campaignRun.status, 'ACTIVE'),
        sql`${campaignRun.rateAnchorAt} is not null`,
        sql`${ECONOMIC_REMAINING_CENT_MS} <= 0`,
      ),
    )
    .limit(50);

  let runCount = 0;
  for (const { id } of rows) {
    const result = await settleAndMaterialize(id);
    if (result.ok) runCount += 1;
  }
  return { ok: true, runCount };
}
