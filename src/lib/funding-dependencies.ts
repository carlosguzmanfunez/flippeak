import { and, eq, sql } from 'drizzle-orm';

import { campaign, campaignRun, runFunding } from '@/db/schema';
import { db } from '@/db/client';
import { ECONOMIC_NOW_MS } from '@/db/economic-state';
import { getAuthenticatedPrincipal } from '@/lib/auth-guards';
import type { FundingDependencies, OwnedRunAccounting } from '@/modules/payments/funding';

/**
 * Real database dependencies for the Phase 4D orchestration.
 *
 * Kept in a plain (non-server-action) module so the lifecycle can be exercised
 * by the integration test with an explicit principal, while the Server Actions
 * stay thin wrappers. The ledger transaction is the only writer of
 * `credited_cents`; the lock makes credit, activation and settlement serialize,
 * and the partial one-ACTIVE index makes the activation race atomic.
 */

const runProjection = {
  id: campaignRun.id,
  status: campaignRun.status,
  campaignId: campaignRun.campaignId,
  timeRateCentsPerHour: campaignRun.timeRateCentsPerHour,
  creditedCents: campaignRun.creditedCents,
  consumedCentMs: campaignRun.consumedCentMs,
};

export const loadOwnedRunForFunding: FundingDependencies['loadOwnedRun'] = async (principal, runId) => {
  const rows = await db()
    .select(runProjection)
    .from(campaignRun)
    .innerJoin(campaign, eq(campaignRun.campaignId, campaign.id))
    .where(and(eq(campaignRun.id, runId), eq(campaign.ownerUserId, principal.userId)))
    .limit(1);

  const run = rows[0];
  if (run === undefined) return null;

  // Raw SQL bigint arrives as a string; decode at the transport boundary.
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

export const persistFunding: FundingDependencies['persistFunding'] = async ({
  runId,
  cents,
  provider,
  providerEventId,
}) => {
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

export const activate: FundingDependencies['activate'] = async ({ runId, anchorAtMs }) => {
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

export const readNowMsForFunding: FundingDependencies['readNowMs'] = async () => {
  const rows = await db().select({ nowMs: ECONOMIC_NOW_MS }).from(campaignRun).limit(1);
  return Number(rows[0]?.nowMs ?? 0);
};

/** The injected-by-session dependency bundle used by production actions. */
export const fundingDependencies: FundingDependencies = {
  resolvePrincipal: getAuthenticatedPrincipal,
  loadOwnedRun: loadOwnedRunForFunding,
  persistFunding,
  activate,
  readNowMs: readNowMsForFunding,
};


