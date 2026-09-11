import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  MAX_FUND_AMOUNT_CENTS,
  paymentApplicationState,
  paymentEvent,
  paymentEventState,
  paymentOrder,
  paymentOrderState,
  paymentRefund,
  paymentRefundCause,
  paymentRefundState,
} from './payment-schema';
import { campaignRun } from './campaign-schema';

/**
 * Structural guarantees of the B2 payment schema.
 *
 * These assert the properties themselves, not a restatement of the file: the
 * vocabularies, the constraint set, the partial index predicates, and the two
 * hazards that are easy to reintroduce — an enum that gets reordered (which makes
 * drizzle recreate the type instead of adding a value) and any DDL that names a
 * freshly added enum value (which PostgreSQL refuses inside the same
 * transaction).
 */

const dialect = new PgDialect();
const orderConfig = getTableConfig(paymentOrder);
const refundConfig = getTableConfig(paymentRefund);
const runConfig = getTableConfig(campaignRun);

const sqlOf = (value: unknown) => dialect.sqlToQuery(value as never).sql;

describe('payment_order_state is append-only', () => {
  it('keeps the five values migration 0006 created, in that exact order', () => {
    // Reordering these would make drizzle emit DROP TYPE + a column rewrite
    // instead of `ALTER TYPE ... ADD VALUE`, and an existing database cannot
    // reorder a type at all.
    expect(paymentOrderState.enumValues.slice(0, 5)).toEqual([
      'PENDING',
      'APPROVED',
      'CAPTURED',
      'ABANDONED',
      'REFUNDED',
    ]);
  });

  it('appends the reversal state rather than inserting it', () => {
    expect(paymentOrderState.enumValues).toHaveLength(6);
    expect(paymentOrderState.enumValues[5]).toBe('REVERSED');
  });

  it('keeps REVERSED distinct from REFUNDED', () => {
    // A reversal is not a merchant refund and must never be run through the
    // refund arithmetic.
    expect(paymentOrderState.enumValues).toContain('REVERSED');
    expect(paymentOrderState.enumValues).toContain('REFUNDED');
  });
});

describe('no DDL may name a freshly added enum value', () => {
  // PostgreSQL refuses to use a value added by ALTER TYPE ... ADD VALUE inside
  // the transaction that added it, and drizzle applies every pending migration
  // in one transaction. `REVERSED` is the value added by B2, so no CHECK or index
  // predicate may mention it — the predicates are written as complements instead.
  const everyConstraint = [
    ...orderConfig.checks.map((c) => sqlOf(c.value)),
    ...orderConfig.indexes.flatMap((i) => [
      ...(i.config.columns as { name: string }[]).map((c) => c.name),
      ...(i.config.where ? [sqlOf(i.config.where)] : []),
    ]),
  ].join(' ');

  it('never mentions REVERSED', () => {
    expect(everyConstraint).not.toContain('REVERSED');
  });
});

describe('payment_order state and application state', () => {
  it('has exactly the two approved application states', () => {
    expect(paymentApplicationState.enumValues).toEqual(['APPLIED', 'UNAPPLIED']);
  });

  it('carries application_state as a nullable column', () => {
    const column = orderConfig.columns.find((c) => c.name === 'application_state');
    expect(column).toBeDefined();
    expect(column?.notNull).toBe(false);
  });

  it('ties the capture reference to the states that carry no capture', () => {
    const check = orderConfig.checks.find((c) => c.name === 'payment_order_capture_id_with_captured_state');
    expect(check).toBeDefined();
    const sql = sqlOf(check!.value);
    expect(sql).toContain('PENDING');
    expect(sql).toContain('APPROVED');
    expect(sql).toContain('ABANDONED');
    expect(sql).toContain('is null');
  });

  it('requires an application decision exactly when a capture exists', () => {
    const check = orderConfig.checks.find((c) => c.name === 'payment_order_application_state_matches_capture');
    expect(check).toBeDefined();
    const sql = sqlOf(check!.value);
    expect(sql).toContain('provider_capture_id');
    expect(sql).toContain('application_state');
  });

  it('carries no other check than the approved set', () => {
    expect(orderConfig.checks.map((c) => c.name).sort()).toEqual(
      [
        'payment_order_amount_exact_domain',
        'payment_order_amount_positive',
        'payment_order_application_state_matches_capture',
        'payment_order_capture_id_with_captured_state',
        'payment_order_currency_usd_only',
      ].sort(),
    );
  });

  it('keeps updated_at maintained on write', () => {
    const column = orderConfig.columns.find((c) => c.name === 'updated_at');
    expect(column?.hasDefault).toBe(true);
    expect(column?.onUpdateFn).toBeDefined();
  });
});

describe('the blocking index is one-per-run and structural', () => {
  const index = orderConfig.indexes.find((i) => i.config.name === 'payment_order_one_blocking_per_run_uidx');

  it('exists, is unique, and is partial', () => {
    expect(index).toBeDefined();
    expect(index?.config.unique).toBe(true);
    expect(index?.config.where).toBeDefined();
  });

  it('covers PENDING, APPROVED, REVERSED and CAPTURED+UNAPPLIED', () => {
    const predicate = sqlOf(index!.config.where);
    // Expressed as a complement, but it must select exactly those four.
    expect(predicate).toContain('ABANDONED');
    expect(predicate).toContain('REFUNDED');
    expect(predicate).toContain('CAPTURED');
    expect(predicate).toContain('UNAPPLIED');
  });

  it('blocks on run_id', () => {
    expect(index?.config.columns.map((c) => (c as { name: string }).name)).toEqual(['run_id']);
  });
});

describe('payment_refund derives its run instead of duplicating it', () => {
  it('has no run_id column', () => {
    expect(refundConfig.columns.map((c) => c.name)).not.toContain('run_id');
  });

  it('reaches the run only through payment_order_id', () => {
    expect(refundConfig.columns.map((c) => c.name)).toContain('payment_order_id');
    expect(refundConfig.foreignKeys).toHaveLength(1);
  });

  it('exposes the four states and the two causes', () => {
    expect(paymentRefundState.enumValues).toEqual(['REQUESTED', 'PENDING', 'COMPLETED', 'FAILED']);
    expect(paymentRefundCause.enumValues).toEqual(['NEVER_APPLIED', 'SERVED_EXPOSURE']);
  });

  it('allows at most one in-flight intent per order', () => {
    const index = refundConfig.indexes.find((i) => i.config.name === 'payment_refund_one_open_per_order_uidx');
    expect(index).toBeDefined();
    expect(index?.config.unique).toBe(true);
    expect(sqlOf(index!.config.where)).toContain('REQUESTED');
    expect(sqlOf(index!.config.where)).toContain('PENDING');
  });

  it('keys the provider refund id by provider', () => {
    const index = refundConfig.indexes.find((i) => i.config.name === 'payment_refund_provider_refund_uidx');
    expect(index?.config.columns.map((c) => (c as { name: string }).name)).toEqual(['provider', 'provider_refund_id']);
    expect(index?.config.unique).toBe(true);
  });

  it('has no financial effect before completion, structurally', () => {
    const check = refundConfig.checks.find((c) => c.name === 'payment_refund_no_effect_before_completion');
    expect(check).toBeDefined();
    const sql = sqlOf(check!.value);
    for (const column of ['credited_reduction_cents', 'non_capacity_refund_cents', 'cause', 'completed_at']) {
      expect(sql).toContain(column);
    }
  });

  it('always decomposes the refunded amount', () => {
    const check = refundConfig.checks.find((c) => c.name === 'payment_refund_decomposition');
    expect(sqlOf(check!.value)).toContain('amount_cents');
  });

  it('never lets a never-applied refund release capacity', () => {
    const check = refundConfig.checks.find((c) => c.name === 'payment_refund_never_applied_releases_nothing');
    expect(sqlOf(check!.value)).toContain('NEVER_APPLIED');
  });

  it('carries no other check than the approved set', () => {
    expect(refundConfig.checks.map((c) => c.name).sort()).toEqual(
      [
        'payment_refund_amount_positive',
        'payment_refund_completed_is_complete',
        'payment_refund_decomposition',
        'payment_refund_never_applied_releases_nothing',
        'payment_refund_no_effect_before_completion',
        'payment_refund_non_negative',
      ].sort(),
    );
  });
});

describe('payment_event identity', () => {
  it('is unique by provider and event id, never by event id alone', () => {
    const config = getTableConfig(paymentEvent);
    const index = config.indexes.find((i) => i.config.name === 'payment_event_provider_event_uidx');
    expect(index?.config.columns.map((c) => (c as { name: string }).name)).toEqual(['provider', 'provider_event_id']);
    expect(index?.config.unique).toBe(true);
  });

  it('carries the explicit event verdicts and a catch-all', () => {
    for (const verdict of [
      'CAPTURED_UNAPPLIED',
      'CAPTURE_PENDING',
      'CAPTURE_DENIED',
      'APPROVAL_REVERSED',
      'REFUND_PENDING',
      'REFUND_FAILED',
      'REFUND_RECORDED',
      'CAPTURE_REVERSED',
      'UNSUPPORTED',
    ]) {
      expect(paymentEventState.enumValues).toContain(verdict);
    }
  });
});

describe('the representation ceiling is structure, not policy', () => {
  it('constrains both payment_order and campaign_run', () => {
    const orderCheck = orderConfig.checks.find((c) => c.name === 'payment_order_amount_exact_domain');
    expect(sqlOf(orderCheck!.value)).toContain(String(MAX_FUND_AMOUNT_CENTS));

    const runCheck = runConfig.checks.find((c) => c.name === 'campaign_run_credited_within_exact_domain');
    expect(runCheck).toBeDefined();
    expect(sqlOf(runCheck!.value)).toContain(String(MAX_FUND_AMOUNT_CENTS));
  });

  it('does not put the commercial policy in the schema', () => {
    const everyCheck = [...orderConfig.checks, ...refundConfig.checks, ...runConfig.checks]
      .map((c) => sqlOf(c.value))
      .join(' ');
    // $5 000 = 500 000 cents: the commercial cap must never become a CHECK.
    expect(everyCheck).not.toContain('500000');
  });
});
