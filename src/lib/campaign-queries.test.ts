import { describe, expect, it } from 'vitest';
import { QueryBuilder } from 'drizzle-orm/pg-core';

import { campaign } from '@/db/campaign-schema';
import type { AuthenticatedPrincipal } from '@/modules/auth/principal';

import { OWN_CAMPAIGN_PROJECTION, newestFirst, ownedBy } from './campaign-queries';

/**
 * These build the query with the same exported projection, filter and ordering
 * that `listOwnCampaigns` uses, then inspect the SQL. No database is involved,
 * and the assertions are about the statement rather than Drizzle's internals.
 */

const advertiser: AuthenticatedPrincipal = { userId: 'usr_advertiser', role: 'ADVERTISER' };

const build = (principal: AuthenticatedPrincipal) =>
  new QueryBuilder()
    .select(OWN_CAMPAIGN_PROJECTION)
    .from(campaign)
    .where(ownedBy(principal))
    .orderBy(...newestFirst())
    .toSQL();

describe('owner scoping', () => {
  it('filters on owner_user_id', () => {
    expect(build(advertiser).sql).toContain('"campaign"."owner_user_id" =');
  });

  it('binds the principal userId as a parameter rather than inlining it', () => {
    const { sql, params } = build(advertiser);
    expect(params).toEqual(['usr_advertiser']);
    expect(sql).not.toContain('usr_advertiser');
  });

  it('changes the bound value with the principal, and nothing else', () => {
    const other = build({ userId: 'usr_other', role: 'ADMIN' });
    expect(other.params).toEqual(['usr_other']);
    expect(other.sql).toBe(build(advertiser).sql);
  });

  it('never filters on anything but the owner', () => {
    expect(build(advertiser).params).toHaveLength(1);
  });
});

describe('ordering', () => {
  it('returns newest first', () => {
    expect(build(advertiser).sql).toContain('order by "campaign"."created_at" desc');
  });

  it('breaks ties on id so equal timestamps still order deterministically', () => {
    expect(build(advertiser).sql).toContain('"campaign"."id" desc');
  });
});

describe('projection', () => {
  it('selects exactly the six approved columns', () => {
    expect(Object.keys(OWN_CAMPAIGN_PROJECTION).sort()).toEqual(
      ['category', 'createdAt', 'id', 'subtype', 'summary', 'title'].sort(),
    );
  });

  it('never selects owner_user_id, updated_at or destination_url', () => {
    const { sql } = build(advertiser);
    const selectList = sql.slice(0, sql.indexOf(' from '));
    for (const column of ['owner_user_id', 'updated_at', 'destination_url']) {
      expect(selectList).not.toContain(column);
    }
  });

  it('does not select the whole row', () => {
    expect(build(advertiser).sql).not.toContain('select *');
  });
});

describe('scope', () => {
  it('reads only the campaign table', () => {
    const { sql } = build(advertiser);
    expect(sql).toContain('from "campaign"');
    expect(sql).not.toContain('campaign_run');
    expect(sql).not.toContain('join');
  });
});
