import { describe, expect, it } from 'vitest';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';

import { CATEGORIES, TIME_RATE } from '@/config/domain-config';
import { SUMMARY_MAX_LENGTH, TITLE_MAX_LENGTH } from '@/modules/campaigns/campaign-content';
import type { CampaignRunStatus } from '@/modules/campaigns/campaign-run';

import { campaign, campaignCategory, campaignRun, campaignRunStatus } from './campaign-schema';
import { user } from './auth-schema';

/**
 * Structural tests for the campaign schema.
 *
 * These read Drizzle's table metadata, so they run without Neon, without a
 * migration and without a connection. They assert the approved structural
 * intent — enum values, key shapes, delete rules, the partial unique index and
 * the absence of deferred columns — rather than Drizzle's internal wiring.
 */

const dialect = new PgDialect();
const campaignConfig = getTableConfig(campaign);
const runConfig = getTableConfig(campaignRun);

const columnsOf = (config: typeof runConfig) =>
  new Map(config.columns.map((column) => [column.name, column]));

const campaignColumns = columnsOf(campaignConfig);
const runColumns = columnsOf(runConfig);

const checkSql = (config: typeof runConfig, name: string): string => {
  const found = config.checks.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`Missing CHECK constraint: ${name}`);
  return dialect.sqlToQuery(found.value).sql;
};

describe('enums', () => {
  it('campaign_category matches the approved category slugs exactly, in order', () => {
    expect(campaignCategory.enumValues).toEqual([...CATEGORIES]);
  });

  it('campaign_category has all twelve approved categories', () => {
    expect(campaignCategory.enumValues).toHaveLength(12);
    expect(new Set(campaignCategory.enumValues).size).toBe(12);
  });

  it('campaign_run_status is exactly DRAFT, ACTIVE, EXHAUSTED', () => {
    expect(campaignRunStatus.enumValues).toEqual(['DRAFT', 'ACTIVE', 'EXHAUSTED']);
  });

  it('matches the status values the domain layer builds runs with', () => {
    const domainStatuses: CampaignRunStatus[] = ['DRAFT', 'ACTIVE', 'EXHAUSTED'];
    expect([...campaignRunStatus.enumValues].sort()).toEqual([...domainStatuses].sort());
  });

  it('carries no lifecycle state that was not approved', () => {
    for (const forbidden of ['PAUSED', 'CANCELLED', 'APPROVED', 'REJECTED', 'ARCHIVED']) {
      expect(campaignRunStatus.enumValues).not.toContain(forbidden);
    }
  });
});

describe('campaign table', () => {
  it('has exactly the approved columns', () => {
    expect([...campaignColumns.keys()].sort()).toEqual(
      [
        'category',
        'created_at',
        'destination_url',
        'id',
        'owner_user_id',
        'subtype',
        'summary',
        'title',
        'updated_at',
      ].sort(),
    );
  });

  it('owns a uuid primary key', () => {
    const id = campaignColumns.get('id');
    expect(id?.getSQLType()).toBe('uuid');
    expect(id?.primary).toBe(true);
  });

  it('references Better Auth user.id with ON DELETE RESTRICT', () => {
    const [fk, ...rest] = campaignConfig.foreignKeys;
    expect(rest).toHaveLength(0);
    expect(fk).toBeDefined();

    const reference = fk?.reference();
    expect(reference?.columns.map((column) => column.name)).toEqual(['owner_user_id']);
    expect(reference?.foreignColumns.map((column) => column.name)).toEqual(['id']);
    expect(getTableConfig(user).name).toBe('user');
    expect(fk?.onDelete).toBe('restrict');
  });

  it('stores owner_user_id as text so it matches the Better Auth id type', () => {
    expect(campaignColumns.get('owner_user_id')?.getSQLType()).toBe('text');
    expect(getTableConfig(user).columns.find((c) => c.name === 'id')?.getSQLType()).toBe('text');
  });

  it('requires a subtype and refuses a blank one', () => {
    expect(campaignColumns.get('subtype')?.notNull).toBe(true);
    expect(checkSql(campaignConfig, 'campaign_subtype_not_blank')).toContain('btrim');
  });

  it('indexes the owner for the "my campaigns" lookup', () => {
    const idx = campaignConfig.indexes.find((i) => i.config.name === 'campaign_owner_user_id_idx');
    expect(idx?.config.unique).toBe(false);
    expect(idx?.config.columns.map((c) => ('name' in c ? c.name : ''))).toEqual(['owner_user_id']);
  });

  it('stores both timestamps with a time zone', () => {
    for (const name of ['created_at', 'updated_at']) {
      expect(campaignColumns.get(name)?.getSQLType()).toBe('timestamp with time zone');
      expect(campaignColumns.get(name)?.notNull).toBe(true);
    }
  });
});

describe('campaign_run table', () => {
  it('has exactly the approved columns', () => {
    expect([...runColumns.keys()].sort()).toEqual(
      [
        'campaign_id',
        'category',
        'consumed_cent_ms',
        'created_at',
        'credited_cents',
        'destination_url',
        'id',
        'previous_run_id',
        'rate_anchor_at',
        'status',
        'subtype',
        'summary',
        'time_rate_cents_per_hour',
        'title',
        'updated_at',
      ].sort(),
    );
  });

  it('carries the five approved snapshot columns', () => {
    for (const name of ['title', 'summary', 'destination_url', 'category', 'subtype']) {
      expect(runColumns.get(name)?.notNull).toBe(true);
    }
  });

  it('defaults a new run to DRAFT', () => {
    expect(runColumns.get('status')?.default).toBe('DRAFT');
    expect(runColumns.get('status')?.notNull).toBe(true);
  });

  it('allows previous_run_id to be null for a first run', () => {
    expect(runColumns.get('previous_run_id')?.notNull).toBe(false);
  });

  it('stores every temporal column with a time zone', () => {
    for (const name of ['created_at', 'updated_at']) {
      expect(runColumns.get(name)?.getSQLType()).toBe('timestamp with time zone');
    }
  });
});

describe('Time Rate is represented once', () => {
  it('bounds the column with the canonical band from domain-config', () => {
    const constraint = checkSql(runConfig, 'campaign_run_time_rate_band');
    expect(constraint).toContain(`BETWEEN ${TIME_RATE.minCentsPerHour} AND ${TIME_RATE.maxCentsPerHour}`);
  });

  it('stores the rate as integer cents per hour', () => {
    expect(runColumns.get('time_rate_cents_per_hour')?.getSQLType()).toBe('integer');
    expect(runColumns.get('time_rate_cents_per_hour')?.notNull).toBe(true);
  });

  it('rules out a zero rate through the lower bound', () => {
    expect(TIME_RATE.minCentsPerHour).toBeGreaterThan(0);
  });

  it('requires whole-dollar rates in the database as well as in the domain', () => {
    const constraint = checkSql(runConfig, 'campaign_run_time_rate_whole_dollars');
    expect(constraint).toContain('% 100 = 0');
    expect(constraint).toContain('time_rate_cents_per_hour');
    expect(TIME_RATE.standardStepCentsPerHour).toBe(100);
  });

  it('keeps the whole-dollar rule separate from the band rule', () => {
    expect(checkSql(runConfig, 'campaign_run_time_rate_band')).not.toContain('%');
  });
});

describe('previous run integrity', () => {
  it('models the relationship as a composite self-reference, not a simple key', () => {
    const fk = runConfig.foreignKeys.find((entry) => entry.getName() === 'campaign_run_previous_run_fk');
    const reference = fk?.reference();

    expect(reference?.columns.map((column) => column.name)).toEqual([
      'previous_run_id',
      'campaign_id',
    ]);
    expect(reference?.foreignColumns.map((column) => column.name)).toEqual(['id', 'campaign_id']);
    expect(fk?.onDelete).toBe('restrict');
  });

  it('has no second simple foreign key on previous_run_id alone', () => {
    const simple = runConfig.foreignKeys.filter((entry) => {
      const columns = entry.reference().columns.map((column) => column.name);
      return columns.length === 1 && columns[0] === 'previous_run_id';
    });
    expect(simple).toHaveLength(0);
  });

  it('backs the composite key with an inline UNIQUE constraint, not a unique index', () => {
    // The ordering matters: a UNIQUE constraint is emitted inside CREATE TABLE,
    // before the ALTER TABLE that adds the foreign key. A unique index would be
    // emitted afterwards and PostgreSQL would reject the key.
    const unique = runConfig.uniqueConstraints.find(
      (entry) => entry.name === 'campaign_run_id_campaign_id_uk',
    );
    expect(unique?.columns.map((column) => column.name)).toEqual(['id', 'campaign_id']);

    const asIndex = runConfig.indexes.find(
      (i) => i.config.name === 'campaign_run_id_campaign_id_uidx',
    );
    expect(asIndex).toBeUndefined();
  });

  it('forbids a run from referencing itself', () => {
    expect(checkSql(runConfig, 'campaign_run_no_self_reference')).toContain('IS NULL OR');
  });

  it('points campaign_id at campaign with ON DELETE RESTRICT', () => {
    const fk = runConfig.foreignKeys.find((entry) => {
      const columns = entry.reference().columns.map((column) => column.name);
      return columns.length === 1 && columns[0] === 'campaign_id';
    });
    expect(fk?.reference().foreignColumns.map((column) => column.name)).toEqual(['id']);
    expect(fk?.onDelete).toBe('restrict');
  });
});

describe('one ACTIVE run per campaign', () => {
  it('declares a partial unique index on campaign_id', () => {
    const idx = runConfig.indexes.find(
      (i) => i.config.name === 'campaign_run_one_active_per_campaign_uidx',
    );
    expect(idx?.config.unique).toBe(true);
    expect(idx?.config.columns.map((c) => ('name' in c ? c.name : ''))).toEqual(['campaign_id']);
    expect(idx?.config.where).toBeDefined();
  });

  it('restricts the index to ACTIVE rows so history stays unconstrained', () => {
    const idx = runConfig.indexes.find(
      (i) => i.config.name === 'campaign_run_one_active_per_campaign_uidx',
    );
    const predicate = idx?.config.where === undefined ? '' : dialect.sqlToQuery(idx.config.where).sql;
    expect(predicate).toContain("'ACTIVE'");
    expect(predicate).not.toContain('DRAFT');
    expect(predicate).not.toContain('EXHAUSTED');
  });
});

describe('copy limits are enforced by the database too', () => {
  it.each([
    { table: 'campaign', config: () => campaignConfig, name: 'campaign_title_valid', max: 50 },
    { table: 'campaign', config: () => campaignConfig, name: 'campaign_summary_valid', max: 140 },
    { table: 'campaign_run', config: () => runConfig, name: 'campaign_run_title_valid', max: 50 },
    { table: 'campaign_run', config: () => runConfig, name: 'campaign_run_summary_valid', max: 140 },
  ])('$name bounds the column and forbids line breaks', ({ config, name, max }) => {
    const constraint = checkSql(config(), name);
    expect(constraint).toContain(`BETWEEN 1 AND ${max}`);
    expect(constraint).toContain('btrim');
    expect(constraint).toContain('chr(10)');
    expect(constraint).toContain('chr(13)');
  });

  it('uses the same limits the domain layer applies', () => {
    expect(checkSql(campaignConfig, 'campaign_title_valid')).toContain(
      `BETWEEN 1 AND ${TITLE_MAX_LENGTH}`,
    );
    expect(checkSql(campaignConfig, 'campaign_summary_valid')).toContain(
      `BETWEEN 1 AND ${SUMMARY_MAX_LENGTH}`,
    );
  });

  it('keeps the columns as text rather than switching to varchar', () => {
    for (const columns of [campaignColumns, runColumns]) {
      expect(columns.get('title')?.getSQLType()).toBe('text');
      expect(columns.get('summary')?.getSQLType()).toBe('text');
    }
  });
});

describe('accounting state follows ADR-011', () => {
  it('stores credit in cents and consumption in cent-milliseconds', () => {
    expect(runColumns.get('credited_cents')?.getSQLType()).toBe('bigint');
    expect(runColumns.get('consumed_cent_ms')?.getSQLType()).toBe('bigint');
    expect(runColumns.get('credited_cents')?.notNull).toBe(true);
    expect(runColumns.get('consumed_cent_ms')?.notNull).toBe(true);
  });

  it('uses bigint because cent-milliseconds overflow a 32-bit integer', () => {
    // credited_cents * 3_600_000 for a $1,000 run already exceeds int32.
    expect(100_000 * 3_600_000).toBeGreaterThan(2_147_483_647);
  });

  it('starts every run at zero credit and zero consumption', () => {
    expect(runColumns.get('credited_cents')?.default).toBe(0);
    expect(runColumns.get('consumed_cent_ms')?.default).toBe(0);
  });

  it('keeps the rate anchor as timestamptz and nullable', () => {
    expect(runColumns.get('rate_anchor_at')?.getSQLType()).toBe('timestamp with time zone');
    expect(runColumns.get('rate_anchor_at')?.notNull).toBe(false);
  });

  it('forbids settled consumption beyond the credited amount', () => {
    expect(checkSql(runConfig, 'campaign_run_consumed_within_credit')).toContain('3600000');
  });

  it('ties the rate anchor to the lifecycle: a DRAFT has none, others must', () => {
    const constraint = checkSql(runConfig, 'campaign_run_anchor_matches_status');
    expect(constraint).toContain("'DRAFT'");
    expect(constraint).toContain('IS NULL');
  });

  it('introduces no balance column: remaining is always derived', () => {
    for (const forbidden of ['remaining_balance_cents', 'remaining_cents', 'balance_cents']) {
      expect([...runColumns.keys()]).not.toContain(forbidden);
    }
  });

  it('introduces no payment or provider column yet', () => {
    for (const column of runColumns.keys()) {
      expect(column).not.toMatch(/paypal|order|capture|provider|invoice/i);
    }
  });
});

describe('deferred concerns are absent from the schema', () => {
  const allColumns = [...campaignColumns.keys(), ...runColumns.keys()];

  it('has no financial column beyond the three approved in ADR-011', () => {
    for (const forbidden of [
      'consumed_cents',
      'remaining_balance_cents',
      'original_budget_cents',
      'budget_cents',
      'settled_at',
      'activated_at',
      'exhausted_at',
    ]) {
      expect(allColumns).not.toContain(forbidden);
    }
  });

  it('has no rank or position column', () => {
    for (const column of allColumns) {
      expect(column).not.toMatch(/rank|position|tier|spotlight/i);
    }
  });

  it('has no analytics, moderation or payment column', () => {
    for (const column of allColumns) {
      expect(column).not.toMatch(/click|impression|view|moderat|review|paypal|payment|order/i);
    }
  });

  it('has no advertiser alias anywhere', () => {
    for (const column of allColumns) {
      expect(column).not.toMatch(/advertiser/i);
    }
  });

  it('gives campaign no lifecycle status column', () => {
    expect([...campaignColumns.keys()]).not.toContain('status');
  });

  it('adds no check beyond the approved set', () => {
    expect(campaignConfig.checks.map((c) => c.name).sort()).toEqual(
      ['campaign_subtype_not_blank', 'campaign_summary_valid', 'campaign_title_valid'].sort(),
    );
    expect(runConfig.checks.map((c) => c.name).sort()).toEqual(
      [
        'campaign_run_no_self_reference',
        'campaign_run_subtype_not_blank',
        'campaign_run_summary_valid',
        'campaign_run_time_rate_band',
        'campaign_run_time_rate_whole_dollars',
        'campaign_run_title_valid',
        'campaign_run_credited_non_negative',
        'campaign_run_consumed_non_negative',
        'campaign_run_consumed_within_credit',
        'campaign_run_anchor_matches_status',
      ].sort(),
    );
  });

  it('places no LIKE constraint on destination_url', () => {
    const everyCheck = [...campaignConfig.checks, ...runConfig.checks]
      .map((c) => dialect.sqlToQuery(c.value).sql)
      .join(' ');
    expect(everyCheck).not.toMatch(/LIKE/i);
    expect(everyCheck).not.toContain('https');
  });
});
