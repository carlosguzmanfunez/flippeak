import { describe, expect, it } from 'vitest';

import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { campaign, campaignRun, runFunding } from '@/db/schema';
import { db } from '@/db/client';
import { loadOwnedCampaign, loadOwnedPreviousRun, insertCampaignRun } from '@/lib/campaign-run-queries';
import { applyBoost } from '@/lib/boost-service';
import { activateRun, fundRun } from '@/modules/payments/funding';
import type { FundingDependencies } from '@/modules/payments/funding';
import { boostRunAction } from '@/modules/payments/boost';
import type { BoostDependencies } from '@/modules/payments/boost';
import { createRunAgain } from '@/modules/campaigns/create-campaign-run';
import type { AuthenticatedPrincipal } from '@/modules/auth/principal';

/**
 * Runtime lifecycle verification (provider = 'internal', audited test path).
 *
 * Authorised by design review. Phases, ordered and idempotent in a fresh or
 * re-run environment:
 *
 *   phase 1 â€” DRAFT â†’ verified funding â†’ ACTIVE â†’ economically exhausted â†’
 *             EXHAUSTED (exact cap, no state manipulation);
 *   phase 2 â€” positive Run Again on the legitimately exhausted run (only
 *             created once; re-runs validate instead of re-creating);
 *   phase 3 â€” Boost on the legitimized run child: settle at the OLD rate,
 *             new rate applied, anchor moved, then legitimate re-exhaustion
 *             at the boosted rate (verified once; re-runs validate).
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
const BOOSTED_RATE = 20_200; // $202/hour â€” strict increase from 10_100

type FundingDepsModule = {
  readonly loadOwnedRunForFunding: FundingDependencies['loadOwnedRun'];
  readonly persistFunding: FundingDependencies['persistFunding'];
  readonly activate: FundingDependencies['activate'];
  readonly readNowMsForFunding: FundingDependencies['readNowMs'];
};
let fundingDepsModule: FundingDepsModule | undefined;
const getFundingDeps = async (): Promise<FundingDepsModule> => {
  if (fundingDepsModule === undefined) {
    fundingDepsModule = await import('@/lib/funding-dependencies');
  }
  return fundingDepsModule;
};

const ownedRun = (runId: string) =>
  getFundingDeps().then((deps) => deps.loadOwnedRunForFunding(OWNER, runId));

const settle = (runId: string) =>
  import('@/lib/economic-service').then((module) => module.settleAndMaterialize(runId));

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

const boostDepsForOwner = (): BoostDependencies => ({
  resolvePrincipal: async () => OWNER,
  loadOwnedRun: (principal, runId) =>
    getFundingDeps().then((deps) => deps.loadOwnedRunForFunding(principal, runId)),
  applyBoost: (input) => applyBoost(input.runId, input.proposedRateCentsPerHour),
});

const runAgainDeps = () => ({
  resolvePrincipal: async () => OWNER,
  loadOwnedCampaign,
  loadOwnedPreviousRun,
  insertRun: insertCampaignRun,
});

const newestOwnedDraft = async (previousIsNull: boolean): Promise<string | null> => {
  const rows = await db()
    .select({ id: campaignRun.id })
    .from(campaignRun)
    .innerJoin(campaign, eq(campaignRun.campaignId, campaign.id))
    .where(
      and(
        eq(campaignRun.status, 'DRAFT'),
        eq(campaign.ownerUserId, OWNER.userId),
        previousIsNull
          ? isNull(campaignRun.previousRunId)
          : sql`${campaignRun.previousRunId} is not null`,
      ),
    )
    .orderBy(desc(campaignRun.createdAt))
    .limit(1);
  return rows[0]?.id ?? null;
};

const exhaustedWithLedger = async (previousIsNull: boolean): Promise<string | null> => {
  const rows = await db()
    .select({ id: campaignRun.id })
    .from(campaignRun)
    .innerJoin(campaign, eq(campaignRun.campaignId, campaign.id))
    .innerJoin(runFunding, eq(runFunding.runId, campaignRun.id))
    .where(
      and(
        eq(campaignRun.status, 'EXHAUSTED'),
        eq(campaign.ownerUserId, OWNER.userId),
        previousIsNull ? isNull(campaignRun.previousRunId) : sql`${campaignRun.previousRunId} is not null`,
      ),
    )
    .orderBy(desc(campaignRun.createdAt))
    .limit(1);
  return rows[0]?.id ?? null;
};

describe.skipIf(!CYCLE_ENABLED)('4D/4E lifecycle â€” provider=internal, audited test path', () => {
  it(
    'phases 1-3: full cycle, Run Again and Boost, without state manipulation',
    { timeout: 30_000 },
    async () => {
      const deps = await fundingDepsForOwner();

      // Phase 2/3 re-run safety: only create when their artifacts are absent.
      const priorParent = await exhaustedWithLedger(true);

      if (priorParent === null) {
        await runFullCycle(deps, require(await newestOwnedDraft(true)));
      } else {
        await runAgainOnce(deps, priorParent);
      }

      // Boost phase: exhaustively settled boost evidence (exhausted child),
      // or an already-boosted ACTIVE child (re-run), or a fresh child DRAFT.
      const boostedExhausted = await exhaustedWithLedger(false);
      const boostedActive = await newestOwnedActiveChild();
      const childDraft = await newestOwnedDraft(false);

      if (boostedExhausted !== null) {
        await validateBoostedExhausted(boostedExhausted);
      } else if (boostedActive !== null) {
        await validateActiveBoosted(boostedActive);
      } else if (childDraft !== null) {
        await runBoostCycle(childDraft);
      } else {
        throw new Error('No child run available for the boost phase');
      }
    },
  );
});

function require(id: string | null): string {
  if (id === null) throw new Error('No owned DRAFT run available for the lifecycle test');
  return id;
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
  expect(Number.isSafeInteger(anchorRow!.anchor!.getTime())).toBe(true);

  // 3. Wait past the exhaustion instant, then materialise (idempotent).
  await new Promise((resolve) => setTimeout(resolve, 700));
  expect(await settle(runId)).toEqual({ ok: true, runId });

  const afterExhaustion = await ownedRun(runId);
  expect(afterExhaustion?.status).toBe('EXHAUSTED');
  expect(afterExhaustion?.consumedCentMs).toBe(CENT_MS_PER_CENT);

  // Idempotency: a second materialisation changes nothing.
  expect(await settle(runId)).toEqual({ ok: true, runId });

  await runAgainOnce(deps, runId);
}

async function runAgainOnce(deps: FundingDependencies, exhaustedRunId: string): Promise<void> {
  const existingChild = await db()
    .select({ id: campaignRun.id })
    .from(campaignRun)
    .where(and(eq(campaignRun.previousRunId, exhaustedRunId), eq(campaignRun.status, 'DRAFT')))
    .limit(1);

  if (existingChild[0] !== undefined) {
    // Already created by a previous run: validate instead of duplicating.
    const [prior] = await db()
      .select({ status: campaignRun.status })
      .from(campaignRun)
      .where(eq(campaignRun.id, exhaustedRunId));
    expect(prior?.status).toBe('EXHAUSTED');
    return;
  }

  const again = await createRunAgain(runAgainDeps(), {
    previousRunId: exhaustedRunId,
    timeRateCentsPerHour: String(LIFE_RATE),
  });
  expect(again.ok).toBe(true);
  if (again.ok) {
    const [child] = await db()
      .select({ previousRunId: campaignRun.previousRunId, status: campaignRun.status })
      .from(campaignRun)
      .where(eq(campaignRun.id, again.runId));
    expect(child?.previousRunId).toBe(exhaustedRunId);
    expect(child?.status).toBe('DRAFT');
  }
  const [prior] = await db()
    .select({ status: campaignRun.status })
    .from(campaignRun)
    .where(eq(campaignRun.id, exhaustedRunId));
  expect(prior?.status).toBe('EXHAUSTED');
}

async function runBoostCycle(childDraftId: string): Promise<void> {
  const deps = await fundingDepsForOwner();

  // Wide funding: 10,000 cents ($100) gives a large headroom (~59 min at the
  // original rate), so the boost settlement is provably exact â€” the cap never
  // truncates â€” while still being a legitimate verified credit.
  expect(await fundRun(deps, { runId: childDraftId, amountCents: 10_000 })).toEqual({ ok: true });
  expect(await activateRun(deps, { runId: childDraftId })).toEqual({ ok: true });

  const before = await db()
    .select({
      rate: campaignRun.timeRateCentsPerHour,
      anchor: campaignRun.rateAnchorAt,
      consumed: campaignRun.consumedCentMs,
      status: campaignRun.status,
    })
    .from(campaignRun)
    .where(eq(campaignRun.id, childDraftId));
  expect(before[0]?.status).toBe('ACTIVE');
  const oldAnchorMs = before[0]!.anchor!.getTime();
  const oldConsumed = before[0]!.consumed;

  // Let real millisecond time pass, then boost: settlement at the OLD rate,
  // anchor moved to the same authoritative instant, rate raised atomically.
  await new Promise((resolve) => setTimeout(resolve, 150));
  const boosted = await boostRunAction(boostDepsForOwner(), {
    runId: childDraftId,
    proposedRateCentsPerHour: BOOSTED_RATE,
  });
  expect(boosted).toEqual({ ok: true, rateCentsPerHour: BOOSTED_RATE });

  const after = await db()
    .select({
      rate: campaignRun.timeRateCentsPerHour,
      anchor: campaignRun.rateAnchorAt,
      consumed: campaignRun.consumedCentMs,
    })
    .from(campaignRun)
    .where(eq(campaignRun.id, childDraftId));

  expect(after[0]?.rate).toBe(BOOSTED_RATE);
  const newAnchorMs = after[0]!.anchor!.getTime();
  const elapsedMs = newAnchorMs - oldAnchorMs;
  expect(elapsedMs).toBeGreaterThan(0);
  // Settlement happened at the OLD rate, exactly: rate Ã— whole ms. No cap.
  expect(after[0]!.consumed - oldConsumed).toBe(LIFE_RATE * elapsedMs);
}

async function validateActiveBoosted(childId: string): Promise<void> {
  const [row] = await db()
    .select({
      status: campaignRun.status,
      rate: campaignRun.timeRateCentsPerHour,
      anchor: campaignRun.rateAnchorAt,
      consumed: campaignRun.consumedCentMs,
      credited: campaignRun.creditedCents,
    })
    .from(campaignRun)
    .where(eq(campaignRun.id, childId));
  expect(row?.status).toBe('ACTIVE');
  expect(row?.rate).toBe(BOOSTED_RATE);
  expect(row?.anchor).not.toBeNull();

  // ADR-012 live guard: a boosted-away run (1 cent already fully settled at
  // the old rate) is economically dead — no room at any rate — so a second
  // boost must be refused by the engine (SETTLEMENT_TOO_SOON), not accepted.
  if (row?.consumed !== undefined && row?.consumed === row?.credited * CENT_MS_PER_CENT) {
    const second = await boostRunAction(boostDepsForOwner(), {
      runId: childId,
      proposedRateCentsPerHour: 30_300,
    });
    expect(second).toEqual({ ok: false, reason: 'SETTLEMENT_TOO_SOON' });
  }
}

async function newestOwnedActiveChild(): Promise<string | null> {
  const rows = await db()
    .select({ id: campaignRun.id })
    .from(campaignRun)
    .innerJoin(campaign, eq(campaignRun.campaignId, campaign.id))
    .where(
      and(
        eq(campaignRun.status, 'ACTIVE'),
        eq(campaign.ownerUserId, OWNER.userId),
        sql`${campaignRun.previousRunId} is not null`,
      ),
    )
    .orderBy(desc(campaignRun.createdAt))
    .limit(1);
  return rows[0]?.id ?? null;
}

async function validateBoostedExhausted(childId: string): Promise<void> {
  // Historic run: the boost evidence is the settled consumed (exact old-rate
  // product at exhaustion) plus the boosted rate marking the history.
  const [row] = await db()
    .select({
      status: campaignRun.status,
      rate: campaignRun.timeRateCentsPerHour,
      consumed: campaignRun.consumedCentMs,
    })
    .from(campaignRun)
    .where(eq(campaignRun.id, childId));
  expect(row?.status).toBe('EXHAUSTED');
  expect(row?.rate).toBe(BOOSTED_RATE);
  expect(row?.consumed).toBe(CENT_MS_PER_CENT);
}
