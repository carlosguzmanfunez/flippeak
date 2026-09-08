import { describe, expect, it } from 'vitest';
import { QueryBuilder } from 'drizzle-orm/pg-core';
import { and, eq } from 'drizzle-orm';

import { campaign, campaignRun } from '@/db/campaign-schema';
import type { AuthenticatedPrincipal } from '@/modules/auth/principal';

import {
  OWNED_CAMPAIGN_PROJECTION,
  PREVIOUS_RUN_PROJECTION,
  RUN_LIST_PROJECTION,
  campaignOwnedBy,
  runsNewestFirst,
} from './campaign-run-queries';

/**
 * These build the statements with the same exported projections, filters and
 * ordering the queries use, then inspect the SQL. No database is involved.
 *
 * What this proves: the generated statement filters on the owner, binds the
 * principal as a parameter, and selects only the approved columns.
 * What it does not prove: that PostgreSQL returns the expected rows. That
 * remains runtime verification.
 */

const principal: AuthenticatedPrincipal = { userId: 'usr_owner', role: 'ADVERTISER' };
const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';

const qb = () => new QueryBuilder();

const ownedCampaignSql = () =>
  qb()
    .select(OWNED_CAMPAIGN_PROJECTION)
    .from(campaign)
    .where(and(eq(campaign.id, CAMPAIGN_ID), campaignOwnedBy(principal)))
    .limit(1)
    .toSQL();

const previousRunSql = () =>
  qb()
    .select({ ...PREVIOUS_RUN_PROJECTION, campaign: OWNED_CAMPAIGN_PROJECTION })
    .from(campaignRun)
    .innerJoin(campaign, eq(campaignRun.campaignId, campaign.id))
    .where(and(eq(campaignRun.id, RUN_ID), campaignOwnedBy(principal)))
    .limit(1)
    .toSQL();

const runListSql = () =>
  qb()
    .select(RUN_LIST_PROJECTION)
    .from(campaignRun)
    .innerJoin(campaign, eq(campaignRun.campaignId, campaign.id))
    .where(and(eq(campaignRun.campaignId, CAMPAIGN_ID), campaignOwnedBy(principal)))
    .orderBy(...runsNewestFirst())
    .toSQL();

describe('owner scoping', () => {
  it.each([
    { name: 'owned campaign', build: ownedCampaignSql },
    { name: 'previous run', build: previousRunSql },
    { name: 'run list', build: runListSql },
  ])('the $name query filters on owner_user_id', ({ build }) => {
    expect(build().sql).toContain('"campaign"."owner_user_id" =');
  });

  it.each([
    { name: 'owned campaign', build: ownedCampaignSql, other: CAMPAIGN_ID },
    { name: 'previous run', build: previousRunSql, other: RUN_ID },
  ])('the $name query binds the principal rather than inlining it', ({ build, other }) => {
    const { sql, params } = build();
    // The trailing parameter is the LIMIT.
    expect(params.slice(0, 2)).toEqual([other, 'usr_owner']);
    expect(sql).not.toContain('usr_owner');
  });

  it('reaches a run only through the campaign that owns it', () => {
    const { sql } = previousRunSql();
    expect(sql).toContain('inner join "campaign"');
    expect(sql).toContain('"campaign_run"."campaign_id" = "campaign"."id"');
  });
});

describe('previous run projection', () => {
  it('selects only identity, owning campaign and status', () => {
    expect(Object.keys(PREVIOUS_RUN_PROJECTION).sort()).toEqual(
      ['campaignId', 'id', 'status'].sort(),
    );
  });

  it('never selects the previous run snapshot or its Time Rate', () => {
    const { sql } = previousRunSql();
    const selectList = sql.slice(0, sql.indexOf(' from '));
    expect(selectList).not.toContain('"campaign_run"."title"');
    expect(selectList).not.toContain('"campaign_run"."summary"');
    expect(selectList).not.toContain('"campaign_run"."destination_url"');
    expect(selectList).not.toContain('time_rate_cents_per_hour');
  });

  it('does select the campaign content, which is what a new run snapshots', () => {
    const selectList = previousRunSql().sql;
    expect(selectList).toContain('"campaign"."title"');
    expect(selectList).toContain('"campaign"."destination_url"');
  });
});

describe('campaign projection', () => {
  it('returns exactly the id plus the five snapshot fields', () => {
    expect(Object.keys(OWNED_CAMPAIGN_PROJECTION).sort()).toEqual(
      ['category', 'destinationUrl', 'id', 'subtype', 'summary', 'title'].sort(),
    );
  });

  it('never exposes owner_user_id in the result', () => {
    const { sql } = ownedCampaignSql();
    const selectList = sql.slice(0, sql.indexOf(' from '));
    expect(selectList).not.toContain('owner_user_id');
  });
});

describe('run list', () => {
  it('exposes no snapshot content or financial column', () => {
    expect(Object.keys(RUN_LIST_PROJECTION).sort()).toEqual(
      ['createdAt', 'id', 'previousRunId', 'status', 'timeRateCentsPerHour'].sort(),
    );
    const selectList = runListSql().sql;
    expect(selectList).not.toMatch(/credited|consumed|balance|settled|budget/i);
  });

  it('orders newest first with the id as a tiebreaker', () => {
    const { sql } = runListSql();
    expect(sql).toContain('order by "campaign_run"."created_at" desc');
    expect(sql).toContain('"campaign_run"."id" desc');
  });

  it('binds both the campaign and the owner', () => {
    expect(runListSql().params).toEqual([CAMPAIGN_ID, 'usr_owner']);
  });
});
