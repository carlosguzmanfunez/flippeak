import { describe, expect, it } from 'vitest';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';

import { runFunding } from './funding-schema';

/**
 * Structural tests for the funding ledger (Phase 4D, master prompt 34-35).
 *
 * Same style as campaign-schema.test.ts: read Drizzle metadata only — no
 * database, no migration, no connection.
 */

const config = getTableConfig(runFunding);
const columns = new Map(config.columns.map((column) => [column.name, column]));
const dialect = new PgDialect();

const checkSql = (name: string): string => {
  const found = config.checks.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`Missing CHECK constraint: ${name}`);
  return dialect.sqlToQuery(found.value).sql;
};

describe('run_funding table', () => {
  it('has exactly the approved columns', () => {
    expect([...columns.keys()].sort()).toEqual(
      ['created_at', 'funding_cents', 'id', 'provider', 'provider_event_id', 'run_id', 'verified', 'verified_at'].sort(),
    );
  });

  it('amounts are bigint integers in minor units', () => {
    expect(columns.get('funding_cents')?.getSQLType()).toBe('bigint');
    expect(columns.get('funding_cents')?.notNull).toBe(true);
  });

  it('is linked to its run with on-delete restrict', () => {
    const fk = config.foreignKeys.find((entry) => entry.getName() === 'run_funding_run_id_campaign_run_id_fk');
    expect(fk?.onDelete).toBe('restrict');
    expect(fk?.reference().columns.map((column) => column.name)).toEqual(['run_id']);
  });

  it('idempotency is structural: one row per provider event', () => {
    const unique = config.indexes.find((entry) => entry.config.name === 'run_funding_provider_event_uidx');
    expect(unique?.config.unique).toBe(true);
    expect(unique?.config.columns.map((column) => ('name' in column ? column.name : ''))).toEqual([
      'provider',
      'provider_event_id',
    ]);
  });

  it('a funding row carries a strictly positive amount (integrity, not policy)', () => {
    const sql = checkSql('run_funding_amount_positive');
    expect(sql).toContain('funding_cents');
    expect(sql).toContain('> 0');
  });

  it('verification is an explicit opt-in, never assumed', () => {
    expect(columns.get('verified')?.default).toBe(false);
    expect(columns.get('verified_at')?.notNull).toBe(false);
  });

  it('stores the temporal columns with a time zone', () => {
    for (const name of ['created_at', 'verified_at']) {
      expect(columns.get(name)?.getSQLType()).toBe('timestamp with time zone');
    }
  });
});
