import { describe, expect, it } from 'vitest';

import { and, desc, eq, isNull } from 'drizzle-orm';

import { campaign, campaignRun, runFunding } from '@/db/schema';
import { db } from '@/db/client';
import { loadOwnedCampaign, loadOwnedPreviousRun, insertCampaignRun } from '@/lib/campaign-run-queries';
import { activateRun, fundRun } from '@/modules/payments/funding';
import type { FundingDependencies } from '@/modules/payments/funding';
import { createRunAgain } from '@/modules/campaigns/create-campaign-run';
import type { AuthenticatedPrincipal } from '@/modules/auth/principal';
import type * as FundingDepsModule from '@/lib/funding-dependencies';

/**
 * The funding dependency bundle pulls in auth (betterAuth construction touches
 * db()); loaded lazily so the offline suite never requires DATABASE_URL.
 */
let fundingDepsModule: FundingDepsModule | undefined;
const getFundingDeps = async (): Promise<FundingDepsModule> => {
  if (fundingDepsModule === undefined) {
    fundingDepsModule = await import('@/lib/funding-dependencies');
  }
  return fundingDepsModule;
};

/**
 * Runtime lifecycle verification (provider = 'internal', audited test path).
 *
 * Authorised by design review as the one way to close Phase 4D with runtime
 * evidence: DRAFT -> ACTIVE -> economically exhausted -> EXHAUSTED -> Run
 * Again, all through the real server layers and the real database, never
 * manipulating a state byte. The `internal` provider is a test mechanism only;
 * product actions are ADMIN-gated and PayPal framing is still to come.
 *
 * Two phases, so the test is idempotent:
 *   phase 1 â€” finds the newest owned DRAFT and runs the full cycle on it;
 *   phase 2 â€” (when the phase-1 run is already EXHAUSTED, e.g. on re-run)
 *             verifies the exhaust was legitimate and executes the first-ever
 *             positive Run Again against it.
 *
 * Disabled unless RUN_LF_CYCLE=1 so the regular suite stays offline.
 */

const CYCLE_ENABLED = process.env.RUN_LF_CYCLE === '1';

const OWNER: AuthenticatedPrincipal = {
  // Exact as stored: verified against the campaign row before running.
  userId: '0UYjthBgrItKQcbxEt2TvKWEsow02W5t',
  role: 'ADVERTISER',
};

const CENT_MS_PER_CENT = 3_600_000;
const LIFE_RATE = 10_100; // $101/hour, the audited runtime campaign rate

async function fundingDepsForOwner(): Promise<FundingDependencies> {
  const deps = await getFundingDeps();
  return {
    resolvePrincipal: async () => OWNER,
    loadOwnedRun: deps.loadOwnedRunForFunding,
    persistFunding: deps.persistFunding,
    activate: deps.activate,
    readNowMs: deps.readNowMsForFunding,
  };
}

/** Lazy owner-scoped load; the funding module only loads when the cycle runs. */
const ownedRun = (runId: string) =>
  getFundingDeps().then((deps) => deps.loadOwnedRunForFunding(OWNER, runId));

/** Lazy settle; the economic service module only loads when the cycle runs. */
const settle = (runId: string) =>
  import('@/lib/economic-service').then((module) => module.settleAndMaterialize(runId));

const runAgainDeps = () => ({
  resolvePrincipal: async () => OWNER,
  loadOwnedCampaign,
  loadOwnedPreviousRun,
  insertRun: insertCampaignRun,
});

const newestOwnedDraft = async (): Promise<string | null> => {
  const rows = await db()
    .select({ id: campaignRun.id })
    .from(campaignRun)
    .innerJoin(campaign, eq(campaignRun.campaignId, campaign.id))
    .where(and(eq(campaignRun.status, 'DRAFT'), eq(campaign.ownerUserId, OWNER.userId)))
    .orderBy(desc(campaignRun.createdAt))
    .limit(1);
  return rows[0]?.id ?? null;
};

const newestOwnedExhaustedWithLedger = async (): Promise<string | null> => {
  const rows = await db()
    .select({ id: campaignRun.id })
    .from(campaignRun)
    .innerJoin(campaign, eq(campaignRun.campaignId, campaign.id))
    .innerJoin(runFunding, eq(runFunding.runId, campaignRun.id))
    .where(
      and(
        eq(campaignRun.status, 'EXHAUSTED'),
        eq(campaign.ownerUserId, OWNER.userId),
        isNull(campaignRun.previousRunId),
        eq(runFunding.provider, 'internal'),
      ),
    )
    .orderBy(desc(campaignRun.createdAt))
    .limit(1);
  return rows[0]?.id ?? null;
};

describe.skipIf(!CYCLE_ENABLED)('4D lifecycle â€” provider=internal, audited test path', () => {
  it(
    'phase 1: DRAFT â†’ ACTIVE â†’ exhausted â†’ EXHAUSTED, or phase 2: verified EXHAUSTED â†’ Run Again',
    { timeout: 20_000 },
    async () => {
      const deps = await fundingDepsForOwner();
      const priorExhausted = await newestOwnedExhaustedWithLedger();

      if (priorExhausted !== null) {
        await verifyAndRunAgain(deps, priorExhausted);
        return;
      }

      await runFullCycle(deps, await requireDraft());
    },
  );
});

async function requireDraft(): Promise<string> {
  const draft = await newestOwnedDraft();
  if (draft === null) throw new Error('No owned DRAFT run available for the lifecycle test');
  return draft;
}

async function runFullCycle(deps: FundingDependencies, runId: string): Promise<void> {
  // 1. Verified funding: 1 cent is enough to demonstrate a legitimate
  //    exhaustion in the test window (1 cent @ $101/h â‰ˆ 356 ms).
  expect(await fundRun(deps, { runId, amountCents: 1 })).toEqual({ ok: true });

  const afterFunding = await ownedRun(runId);
  expect(afterFunding?.creditedCents).toBe(1);
  expect(afterFunding?.verifiedFundingCents).toBe(1);

  // 2. Activation: DRAFT â†’ ACTIVE with an authoritative whole-ms anchor.
  expect(await activateRun(deps, { runId })).toEqual({ ok: true });

  const afterActivation = await ownedRun(runId);
  expect(afterActivation?.status).toBe('ACTIVE');

  const [anchorRow] = await db()
    .select({ anchor: campaignRun.rateAnchorAt })
    .from(campaignRun)
    .where(eq(campaignRun.id, runId));
  expect(anchorRow?.anchor).not.toBeNull();
  const anchorMs = anchorRow!.anchor!.getTime();
  expect(Number.isSafeInteger(anchorMs)).toBe(true);

  // 3. Wait past the exhaustion instant, then materialise (idempotent).
  await new Promise((resolve) => setTimeout(resolve, 700));
  expect(await settle(runId)).toEqual({ ok: true, runId });

  const afterExhaustion = await ownedRun(runId);
  expect(afterExhaustion?.status).toBe('EXHAUSTED');
  expect(afterExhaustion?.consumedCentMs).toBe(CENT_MS_PER_CENT);

  // Idempotency: a second materialisation changes nothing.
  expect(await settle(runId)).toEqual({ ok: true, runId });

  await verifyAndRunAgain(deps, runId);
}

async function verifyAndRunAgain(deps: FundingDependencies, runId: string): Promise<void> {
  const state = await ownedRun(runId);
  expect(state?.status).toBe('EXHAUSTED');
  expect(state?.consumedCentMs).toBe(CENT_MS_PER_CENT);

  const [anchorRow] = await db()
    .select({ anchor: campaignRun.rateAnchorAt, status: campaignRun.status })
    .from(campaignRun)
    .where(eq(campaignRun.id, runId));
  expect(anchorRow?.status).toBe('EXHAUSTED');
  expect(anchorRow?.anchor).not.toBeNull();

  // 4. First-ever positive Run Again on a legitimately exhausted run.
  const again = await createRunAgain(runAgainDeps(), {
    previousRunId: runId,
    timeRateCentsPerHour: String(LIFE_RATE),
  });
  expect(again.ok).toBe(true);
  if (again.ok) {
    const [child] = await db()
      .select({ previousRunId: campaignRun.previousRunId, status: campaignRun.status })
      .from(campaignRun)
      .where(eq(campaignRun.id, again.runId));
    expect(child?.previousRunId).toBe(runId);
    expect(child?.status).toBe('DRAFT');
  }

  const [prior] = await db()
    .select({ status: campaignRun.status })
    .from(campaignRun)
    .where(eq(campaignRun.id, runId));
  expect(prior?.status).toBe('EXHAUSTED');
}
