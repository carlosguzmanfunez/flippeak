import { decideUserAccess } from '@/modules/auth/access';
import type { AuthenticatedPrincipal } from '@/modules/auth/principal';

import {
  buildFirstRunInsert,
  buildRunAgainInsert,
  isUuidLike,
  parseTimeRateCentsPerHour,
} from './campaign-run';
import type { CampaignRunInsert, OwnedCampaign, PreviousRunReference } from './campaign-run';

/**
 * CampaignRun creation orchestration.
 *
 * Framework-free and database-free: session resolution, the owner-scoped loads
 * and the insert are all injected, so this composition is unit-testable and the
 * Server Actions stay thin adapters over it. Same shape as
 * `create-campaign.ts`, which was approved in Phase 3E-1.
 *
 * Authentication is checked before anything else, so an unauthenticated caller
 * learns nothing about which campaign or run ids exist.
 */

export type CreateCampaignRunResult =
  | { readonly ok: true; readonly runId: string }
  | { readonly ok: false; readonly reason: 'UNAUTHENTICATED' }
  | { readonly ok: false; readonly reason: 'CAMPAIGN_NOT_FOUND' }
  | { readonly ok: false; readonly reason: 'PREVIOUS_RUN_NOT_FOUND' }
  | { readonly ok: false; readonly reason: 'PREVIOUS_RUN_NOT_ELIGIBLE' }
  | { readonly ok: false; readonly reason: 'INVALID_TIME_RATE' }
  | { readonly ok: false; readonly reason: 'UNEXPECTED' };

/** What an owner-scoped load returns for a previous run, plus its campaign. */
export type PreviousRunWithCampaign = {
  readonly previousRun: PreviousRunReference;
  readonly campaign: OwnedCampaign;
};

export type CreateCampaignRunDependencies = {
  readonly resolvePrincipal: () => Promise<AuthenticatedPrincipal | null>;
  /** Must filter on the principal. Returns null when absent or not owned. */
  readonly loadOwnedCampaign: (
    principal: AuthenticatedPrincipal,
    campaignId: string,
  ) => Promise<OwnedCampaign | null>;
  /** Must filter on the principal. Returns the run and its current campaign. */
  readonly loadOwnedPreviousRun: (
    principal: AuthenticatedPrincipal,
    previousRunId: string,
  ) => Promise<PreviousRunWithCampaign | null>;
  readonly insertRun: (row: CampaignRunInsert) => Promise<string>;
};

export type FirstRunInput = {
  readonly campaignId: unknown;
  readonly timeRateCentsPerHour: unknown;
};

export type RunAgainInput = {
  readonly previousRunId: unknown;
  readonly timeRateCentsPerHour: unknown;
};

async function authenticate(
  dependencies: CreateCampaignRunDependencies,
): Promise<AuthenticatedPrincipal | null> {
  const access = decideUserAccess(await dependencies.resolvePrincipal());
  return access.outcome === 'ALLOW' ? access.principal : null;
}

async function persist(
  dependencies: CreateCampaignRunDependencies,
  row: CampaignRunInsert,
): Promise<CreateCampaignRunResult> {
  try {
    return { ok: true, runId: await dependencies.insertRun(row) };
  } catch {
    // Constraint names, SQL fragments and stack traces stay on the server.
    return { ok: false, reason: 'UNEXPECTED' };
  }
}

export async function createFirstRun(
  dependencies: CreateCampaignRunDependencies,
  input: FirstRunInput,
): Promise<CreateCampaignRunResult> {
  const principal = await authenticate(dependencies);
  if (principal === null) return { ok: false, reason: 'UNAUTHENTICATED' };

  if (!isUuidLike(input.campaignId)) return { ok: false, reason: 'CAMPAIGN_NOT_FOUND' };

  const campaign = await dependencies.loadOwnedCampaign(principal, input.campaignId);
  // Absent and not-owned are the same answer, so the endpoint cannot be used to
  // discover which campaign ids exist.
  if (campaign === null) return { ok: false, reason: 'CAMPAIGN_NOT_FOUND' };

  const built = buildFirstRunInsert(campaign, parseTimeRateCentsPerHour(input.timeRateCentsPerHour));
  if (!built.ok) return { ok: false, reason: 'INVALID_TIME_RATE' };

  return persist(dependencies, built.value);
}

export async function createRunAgain(
  dependencies: CreateCampaignRunDependencies,
  input: RunAgainInput,
): Promise<CreateCampaignRunResult> {
  const principal = await authenticate(dependencies);
  if (principal === null) return { ok: false, reason: 'UNAUTHENTICATED' };

  if (!isUuidLike(input.previousRunId)) return { ok: false, reason: 'PREVIOUS_RUN_NOT_FOUND' };

  const loaded = await dependencies.loadOwnedPreviousRun(principal, input.previousRunId);
  if (loaded === null) return { ok: false, reason: 'PREVIOUS_RUN_NOT_FOUND' };

  const built = buildRunAgainInsert(
    loaded.campaign,
    loaded.previousRun,
    parseTimeRateCentsPerHour(input.timeRateCentsPerHour),
  );

  if (!built.ok) {
    // The two lineage failures collapse into one outcome: the caller only needs
    // to know the run cannot be continued, not which rule refused it.
    return built.reason === 'INVALID_TIME_RATE'
      ? { ok: false, reason: 'INVALID_TIME_RATE' }
      : { ok: false, reason: 'PREVIOUS_RUN_NOT_ELIGIBLE' };
  }

  return persist(dependencies, built.value);
}
