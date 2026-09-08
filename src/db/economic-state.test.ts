import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { CENT_MS_PER_CENT } from '@/config/domain-config';
import {
  ECONOMIC_CAPACITY_CENT_MS,
  ECONOMIC_ELAPSED_CEILED_MS,
  ECONOMIC_NOW_MS_CEILED,
  ECONOMIC_REMAINING_CENT_MS,
  economicallyEligibleWhere,
} from './economic-state';
import { consume } from '@/modules/economics/economic-engine';

/**
 * Structural contract tests for the SQL economic state.
 *
 * The SQL mirror and the JS engine must stay in perfect agreement because
 * eligibility queries (Live Market, ADR-012) cannot run the JS engine per row.
 * No database is touched here: these tests pin the generated SQL text, and a
 * read-only runtime check against real PostgreSQL covers execution semantics.
 */

function sqlText(value: Parameters<PgDialect['sqlToQuery']>[0]): string {
  return new PgDialect().sqlToQuery(value).sql;
}

describe('ECONOMIC_CAPACITY_CENT_MS', () => {
  it('is credited_cents times the exact cent-ms constant', () => {
    const sql = sqlText(ECONOMIC_CAPACITY_CENT_MS);
    expect(sql).toContain('credited_cents');
    expect(sql).toContain('3600000');
    expect(sql).not.toContain('3600000000');
  });
});

describe('ECONOMIC_ELAPSED_CEILED_MS', () => {
  it('returns 0 when no anchor exists (DRAFT never consumes)', () => {
    const sql = sqlText(ECONOMIC_ELAPSED_CEILED_MS);
    expect(sql).toContain('rate_anchor_at');
    expect(sql).toContain('null');
  });

  it('ceils the epoch-scaled interval to whole milliseconds', () => {
    const sql = sqlText(ECONOMIC_ELAPSED_CEILED_MS);
    expect(sql).toContain('ceil(');
    expect(sql).toContain('extract(epoch from');
    expect(sql).toContain('1000');
  });
});

describe('ECONOMIC_REMAINING_CENT_MS', () => {
  it('clamps negative projections to zero (never below capacity)', () => {
    const sql = sqlText(ECONOMIC_REMAINING_CENT_MS);
    expect(sql).toContain('greatest(');
    expect(sql).toContain('0');
    expect(sql).toContain('consumed_cent_ms');
    expect(sql).toContain('time_rate_cents_per_hour');
  });
});

describe('ECONOMIC_NOW_MS_CEILED', () => {
  it('derives authoritative now from PostgreSQL, ceiled to whole ms', () => {
    const sql = sqlText(ECONOMIC_NOW_MS_CEILED);
    expect(sql).toContain('now()');
    expect(sql).toContain('ceil(');
  });
});

describe('economicallyEligibleWhere()', () => {
  it('requires an anchor AND strictly positive remaining (economic truth)', () => {
    const sql = sqlText(economicallyEligibleWhere());
    expect(sql).toContain('is not null');
    expect(sql).toContain('> 0');
    expect(sql).toContain('greatest(');
  });
});

describe('JS engine x SQL mirror parity (no drift contract)', () => {
  /** Independent literal re-implementation of the SQL formula in JS. */
  const sqlSimulate = (credited: number, consumed: number, rate: number, elapsedExactMs: number, anchored: boolean) => {
    const capacity = credited * CENT_MS_PER_CENT;
    const elapsed = anchored ? Math.ceil(elapsedExactMs) : 0;
    return Math.max(0, capacity - consumed - rate * elapsed);
  };

  it('agrees with the engine across the alignment cases (audit finding #2)', () => {
    const cases: [number, number, number, number, boolean][] = [
      [100, 0, 10_100, 35_643.0, true], // before the boundary: 5,700 remains
      [100, 0, 10_100, 35_643.564356, true], // inside the boundary ms: ceiled → 0
      [100, 0, 10_100, 35_644.0, true],
      [1, 0, 100_000, 36.4, true],
      [1, 0, 100_000, 40, true],
      [100, 0, 100, 3_600_000, true],
      [100, 359_990_000, 10_000, 35_999, true],
      [100, 0, 10_100, 0, false], // DRAFT: no anchor, no consumption
      [0, 0, 100_000, 5, true], // unfunded: never eligible
    ];
    for (const [credited, consumed, rate, elapsed, anchored] of cases) {
      const fromSql = sqlSimulate(credited, consumed, rate, elapsed, anchored);
      const fromEngine = consume({
        creditedCents: credited,
        consumedCentMs: consumed,
        rateCentsPerHour: rate,
        elapsedMsCeiled: anchored ? Math.ceil(elapsed) : 0,
      });
      expect(fromEngine.remainingCentMs).toBe(fromSql);
      if (anchored) expect(fromEngine.exhausted).toBe(fromSql === 0);
    }
  });
});
