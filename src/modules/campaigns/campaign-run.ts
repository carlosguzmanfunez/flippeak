import { isValidTimeRate } from '@/modules/economics/time-rate';

import { snapshotCampaignContent } from './campaign-content';
import type { CampaignContent } from './campaign-content';

/**
 * CampaignRun construction.
 *
 * Pure and deterministic: no id, no timestamp and no clock is touched here. The
 * builders return the payload a run should be created from, and the persistence
 * boundary supplies `id`, `created_at` and `updated_at` from the database.
 *
 * A run always snapshots the CURRENT Campaign, including Run Again. That rule is
 * enforced structurally rather than by discipline: `PreviousRunReference` carries
 * no content fields at all, so there is nothing to copy from the previous run
 * even by mistake. Past runs are never read for content and never mutated.
 */

export type CampaignRunStatus = 'DRAFT' | 'ACTIVE' | 'EXHAUSTED';

/** A Campaign the caller has already loaded and confirmed ownership of. */
export type OwnedCampaign = {
  readonly id: string;
  readonly content: CampaignContent;
};

/**
 * The previous run, reduced to what Run Again is allowed to consider.
 *
 * Identity, owning campaign and lifecycle state — no title, summary, URL,
 * category, subtype or Time Rate. The previous rate is deliberately absent too:
 * Run Again is a new execution and is not subject to the monotonic Boost rule.
 */
export type PreviousRunReference = {
  readonly id: string;
  readonly campaignId: string;
  readonly status: CampaignRunStatus;
};

/** The exact columns a new run is created from. */
export type CampaignRunInsert = {
  readonly campaignId: string;
  readonly previousRunId: string | null;
  readonly status: CampaignRunStatus;
  readonly timeRateCentsPerHour: number;
  readonly title: string;
  readonly summary: string;
  readonly destinationUrl: string;
  readonly category: CampaignContent['category'];
  readonly subtype: string;
};

export const CAMPAIGN_RUN_INSERT_FIELDS = [
  'campaignId',
  'previousRunId',
  'status',
  'timeRateCentsPerHour',
  'title',
  'summary',
  'destinationUrl',
  'category',
  'subtype',
] as const satisfies readonly (keyof CampaignRunInsert)[];

export type CampaignRunBuildFailure =
  | 'INVALID_TIME_RATE'
  | 'PREVIOUS_RUN_NOT_EXHAUSTED'
  | 'PREVIOUS_RUN_OTHER_CAMPAIGN';

export type CampaignRunBuildResult =
  | { readonly ok: true; readonly value: CampaignRunInsert }
  | { readonly ok: false; readonly reason: CampaignRunBuildFailure };

/** Every new run starts unfunded. Activation belongs to the financial phases. */
const INITIAL_STATUS: CampaignRunStatus = 'DRAFT';

const DECIMAL_INTEGER = /^\d+$/;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parses a Time Rate arriving as form input.
 *
 * Only plain decimal digits are accepted. `Number('0x64')` would otherwise
 * evaluate to 100 and `Number(' 47 ')` to 47, so a strict shape check keeps the
 * accepted encodings to one. Range and whole-dollar validity are still decided
 * by `isValidTimeRate`; this only turns text into a number.
 */
export function parseTimeRateCentsPerHour(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string' || !DECIMAL_INTEGER.test(value.trim())) return null;

  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * True when a value has the shape of a database identifier.
 *
 * An input guard, not an authorization check: it lets an obviously forged id be
 * answered as "not found" instead of reaching PostgreSQL and failing as a uuid
 * cast error, which would surface as an unexplained server fault.
 */
export function isUuidLike(value: unknown): value is string {
  return typeof value === 'string' && UUID_SHAPE.test(value);
}

function buildInsert(
  campaign: OwnedCampaign,
  previousRunId: string | null,
  timeRateCentsPerHour: number,
): CampaignRunInsert {
  const snapshot = snapshotCampaignContent(campaign.content);

  return {
    campaignId: campaign.id,
    previousRunId,
    status: INITIAL_STATUS,
    timeRateCentsPerHour,
    title: snapshot.title,
    summary: snapshot.summary,
    destinationUrl: snapshot.destinationUrl,
    category: snapshot.category,
    subtype: snapshot.subtype,
  };
}

/**
 * The first run of a Campaign.
 *
 * `previousRunId` is null because nothing precedes it.
 */
export function buildFirstRunInsert(
  campaign: OwnedCampaign,
  timeRateCentsPerHour: unknown,
): CampaignRunBuildResult {
  if (typeof timeRateCentsPerHour !== 'number' || !isValidTimeRate(timeRateCentsPerHour)) {
    return { ok: false, reason: 'INVALID_TIME_RATE' };
  }

  return { ok: true, value: buildInsert(campaign, null, timeRateCentsPerHour) };
}

/**
 * Run Again: a new execution that continues from an exhausted one.
 *
 * The previous run must be EXHAUSTED and must belong to this Campaign. It is
 * only referenced, never revived and never modified. The new rate may be lower,
 * equal or higher than the previous one; the monotonic rule applies to boosting
 * an active run, not to starting a new one.
 */
export function buildRunAgainInsert(
  campaign: OwnedCampaign,
  previousRun: PreviousRunReference,
  timeRateCentsPerHour: unknown,
): CampaignRunBuildResult {
  if (previousRun.campaignId !== campaign.id) {
    return { ok: false, reason: 'PREVIOUS_RUN_OTHER_CAMPAIGN' };
  }

  if (previousRun.status !== 'EXHAUSTED') {
    return { ok: false, reason: 'PREVIOUS_RUN_NOT_EXHAUSTED' };
  }

  if (typeof timeRateCentsPerHour !== 'number' || !isValidTimeRate(timeRateCentsPerHour)) {
    return { ok: false, reason: 'INVALID_TIME_RATE' };
  }

  return { ok: true, value: buildInsert(campaign, previousRun.id, timeRateCentsPerHour) };
}
