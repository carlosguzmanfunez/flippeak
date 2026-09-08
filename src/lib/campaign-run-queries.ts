import { and, desc, eq } from 'drizzle-orm';

import { campaign, campaignRun } from '@/db/campaign-schema';
import { db } from '@/db/client';
import type { AuthenticatedPrincipal } from '@/modules/auth/principal';
import type {
  CampaignRunInsert,
  OwnedCampaign,
  PreviousRunReference,
} from '@/modules/campaigns/campaign-run';
import type { PreviousRunWithCampaign } from '@/modules/campaigns/create-campaign-run';

/**
 * Owner-scoped CampaignRun reads and the run insert.
 *
 * Every read filters on `campaign.owner_user_id`, and that value always comes
 * from the resolved principal — never from the request. Callers pass an
 * `AuthenticatedPrincipal`, which names the requirement but is not itself the
 * security boundary; the boundary is `getAuthenticatedPrincipal()` running on
 * the server, and these functions are only reachable from code that used it.
 *
 * The projections, filters and ordering are exported so tests can assert the
 * generated SQL against the same expressions the queries use.
 */

/** The campaign content a new run snapshots. */
export const OWNED_CAMPAIGN_PROJECTION = {
  id: campaign.id,
  title: campaign.title,
  summary: campaign.summary,
  destinationUrl: campaign.destinationUrl,
  category: campaign.category,
  subtype: campaign.subtype,
};

/** Only what Run Again may consider about a previous run: no content, no rate. */
export const PREVIOUS_RUN_PROJECTION = {
  id: campaignRun.id,
  campaignId: campaignRun.campaignId,
  status: campaignRun.status,
};

export const RUN_LIST_PROJECTION = {
  id: campaignRun.id,
  status: campaignRun.status,
  timeRateCentsPerHour: campaignRun.timeRateCentsPerHour,
  previousRunId: campaignRun.previousRunId,
  createdAt: campaignRun.createdAt,
};

export const campaignOwnedBy = (principal: AuthenticatedPrincipal) =>
  eq(campaign.ownerUserId, principal.userId);

export const runsNewestFirst = () => [desc(campaignRun.createdAt), desc(campaignRun.id)];

type CampaignRow = {
  id: string;
  title: string;
  summary: string;
  destinationUrl: string;
  category: OwnedCampaign['content']['category'];
  subtype: string;
};

const toOwnedCampaign = (row: CampaignRow): OwnedCampaign => ({
  id: row.id,
  content: {
    title: row.title,
    summary: row.summary,
    destinationUrl: row.destinationUrl,
    category: row.category,
    subtype: row.subtype,
  },
});

export async function loadOwnedCampaign(
  principal: AuthenticatedPrincipal,
  campaignId: string,
): Promise<OwnedCampaign | null> {
  const rows = await db()
    .select(OWNED_CAMPAIGN_PROJECTION)
    .from(campaign)
    .where(and(eq(campaign.id, campaignId), campaignOwnedBy(principal)))
    .limit(1);

  const row = rows[0];
  return row === undefined ? null : toOwnedCampaign(row);
}

/**
 * Loads a previous run together with its campaign's CURRENT content.
 *
 * The join is what enforces ownership: a run is only reachable through the
 * campaign that owns it, and that campaign must belong to the principal. The
 * campaign content returned here is today's, which is what the new run
 * snapshots — the previous run's own snapshot is never selected.
 */
export async function loadOwnedPreviousRun(
  principal: AuthenticatedPrincipal,
  previousRunId: string,
): Promise<PreviousRunWithCampaign | null> {
  const rows = await db()
    .select({ ...PREVIOUS_RUN_PROJECTION, campaign: OWNED_CAMPAIGN_PROJECTION })
    .from(campaignRun)
    .innerJoin(campaign, eq(campaignRun.campaignId, campaign.id))
    .where(and(eq(campaignRun.id, previousRunId), campaignOwnedBy(principal)))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  const previousRun: PreviousRunReference = {
    id: row.id,
    campaignId: row.campaignId,
    status: row.status,
  };

  return { previousRun, campaign: toOwnedCampaign(row.campaign) };
}

/** Inserts one run. A single INSERT is atomic on its own, so no transaction. */
export async function insertCampaignRun(row: CampaignRunInsert): Promise<string> {
  const inserted = await db().insert(campaignRun).values(row).returning({ id: campaignRun.id });

  const created = inserted[0];
  if (created === undefined) throw new Error('Insert returned no row');
  return created.id;
}

/** Runs of one owned campaign, newest first. Used by the Phase 3F-3 surface. */
export async function listOwnCampaignRuns(
  principal: AuthenticatedPrincipal,
  campaignId: string,
): Promise<
  {
    id: string;
    status: PreviousRunReference['status'];
    timeRateCentsPerHour: number;
    previousRunId: string | null;
    createdAt: Date;
  }[]
> {
  return db()
    .select(RUN_LIST_PROJECTION)
    .from(campaignRun)
    .innerJoin(campaign, eq(campaignRun.campaignId, campaign.id))
    .where(and(eq(campaignRun.campaignId, campaignId), campaignOwnedBy(principal)))
    .orderBy(...runsNewestFirst());
}
