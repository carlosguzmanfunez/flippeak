import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { CENT_MS_PER_CENT } from '@/modules/economics/run-accounting';
import {
  ECONOMIC_CAPACITY_CENT_MS,
  ECONOMIC_CONSUMED_CENT_MS,
  ECONOMIC_ELAPSED_MS,
  ECONOMIC_NOW_MS,
  ECONOMIC_REMAINING_CENT_MS,
  economicallyEligibleWhere,
} from './economic-state';

/**
 * Structural contract tests for the SQL economic state.
 *
 * The SQL mirror and the canonical engine must stay in perfect agreement
 * because eligibility queries (Live Market, ADR-012) cannot run the JS engine
 * per row. No database is touched here: these tests pin the generated SQL
 * text; the read-only runtime check against real PostgreSQL covers execution
 * semantics (document 04 acceptance query).
 */

function sqlText(value: Parameters<PgDialect['sqlToQuery']>[0]): string {
  return new PgDialect().sqlToQuery(value).sql;
}

describe('ECONOMIC_CAPACITY_CENT_MS', () => {
  it('is credited_cents times the exact cent-ms constant from the engine', () => {
    const sql = sqlText(ECONOMIC_CAPACITY_CENT_MS);
    expect(sql).toContain('credited_cents');
    expect(sql).toContain(String(CENT_MS_PER_CENT));
  });
});

describe('ECONOMIC_ELAPSED_MS', () => {
  it('is floored, not ceiled (ADR-013: partial milliseconds are not charged)', () => {
    const sql = sqlText(ECONOMIC_ELAPSED_MS);
    expect(sql).toContain('floor(');
    expect(sql).not.toContain('ceil(');
    expect(sql).toContain('extract(epoch from');
    expect(sql).toContain('1000');
  });

  it('is clamped at zero (an anchor ahead of now is zero, not negative)', () => {
    const sql = sqlText(ECONOMIC_ELAPSED_MS);
    expect(sql).toContain('greatest(0');
  });

  it('returns 0 when no anchor exists (DRAFT never consumes)', () => {
    const sql = sqlText(ECONOMIC_ELAPSED_MS);
    expect(sql).toContain('rate_anchor_at');
    expect(sql).toContain('null');
  });
});

describe('ECONOMIC_NOW_MS', () => {
  it('reduces authoritative now to a floored whole millisecond', () => {
    const sql = sqlText(ECONOMIC_NOW_MS);
    expect(sql).toContain('now()');
    expect(sql).toContain('floor(');
    expect(sql).not.toContain('ceil(');
  });
});

describe('ECONOMIC_CONSUMED_CENT_MS', () => {
  it('clamps projected consumption at capacity with least (non-negotiable)', () => {
    const sql = sqlText(ECONOMIC_CONSUMED_CENT_MS);
    expect(sql).toContain('least(');
    expect(sql).toContain('consumed_cent_ms');
    expect(sql).toContain('time_rate_cents_per_hour');
  });
});

describe('ECONOMIC_REMAINING_CENT_MS', () => {
  it('is capacity minus the clamped consumption, never negative', () => {
    const sql = sqlText(ECONOMIC_REMAINING_CENT_MS);
    expect(sql).toContain('least(');
    // The only clamp on remaining is the one inside the elapsed fragment; no
    // greatest is applied directly to the consumed amount or the difference.
    expect(sql).not.toContain('greatest(0, "campaign_run"."consumed_cent_ms"');
  });
});

describe('economicallyEligibleWhere()', () => {
  it('requires an anchor AND strictly positive remaining (economic truth)', () => {
    const sql = sqlText(economicallyEligibleWhere());
    expect(sql).toContain('is not null');
    expect(sql).toContain('> 0');
    expect(sql).toContain('least(');
  });
});
