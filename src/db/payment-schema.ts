import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { campaignRun } from './campaign-schema';

/**
 * PayPal funding layer (phase 9/10, ADR-014; B2 financial correctness).
 *
 * Three levels of idempotency, three tables:
 *
 *  - payment_order: one checkout intent (1 run : N orders). `state` is a
 *    NORMALISED FINANCIAL state derived from provider facts — it is not a copy
 *    of PayPal's Order status, and no consumer may treat it as one. `CAPTURED`
 *    means PayPal really took the money; `application_state` then answers the
 *    separate question of whether FlipPeak applied it to the run.
 *  - payment_event: one row per verified provider delivery, keyed by
 *    (provider, provider_event_id), plus the verdict and the payload for audit.
 *  - payment_refund: money returned to the buyer. Refunds never rewrite
 *    run_funding; they are subtracted from capacity through this table only.
 *
 * The exactness ceiling below is a REPRESENTATION limit (ADR-014). The
 * commercial $5–$5 000 policy is deliberately NOT in the schema: it is
 * configurable product policy enforced at the boundaries (see FUNDING_POLICY).
 */

export const paymentOrderState = pgEnum('payment_order_state', [
  // The first five values keep the EXACT order migration 0006 created. Reordering
  // them would make drizzle recreate the type (DROP TYPE + rewrite the column)
  // instead of emitting `ALTER TYPE ... ADD VALUE`, and a type that already
  // exists in a database cannot be reordered there anyway. New values are
  // appended, never inserted.
  'PENDING',
  'APPROVED',
  'CAPTURED',
  'ABANDONED',
  'REFUNDED',
  /**
   * PayPal reversed or charged back the capture outside FlipPeak's refund flow.
   * Deliberately NOT `REFUNDED`: a reversal is not a merchant refund and must
   * not be run through the refund arithmetic. It blocks new checkouts for the
   * run until an approved reconciliation resolves it.
   */
  'REVERSED',
]);

/** Whether FlipPeak applied a real capture to its run. */
export const paymentApplicationState = pgEnum('payment_application_state', [
  /** The capture was applied: ledger row written and credited_cents increased. */
  'APPLIED',
  /** PayPal captured, but no capacity was added to the run. */
  'UNAPPLIED',
]);

export const paymentEventState = pgEnum('payment_event_state', [
  'PENDING_RETRY',
  'PROCESSED',
  'DUPLICATE_CAPTURE',
  'ORPHAN_CAPTURE',
  'NO_ACTIVATION',
  'REJECTED',
  /**
   * A verified capture whose credit could not be applied to its run (the run is
   * EXHAUSTED, or economically dead). PayPal already took real money, so the
   * capture is recorded and reconciled by hand — never dropped, never credited
   * as if it had been applied, and the run never revives.
   */
  'CAPTURED_UNAPPLIED',
  'CAPTURE_PENDING',
  'CAPTURE_DENIED',
  'APPROVAL_REVERSED',
  'REFUND_PENDING',
  'REFUND_FAILED',
  'REFUND_RECORDED',
  'CAPTURE_REVERSED',
  /**
   * A signature-verified delivery of a type with no financial or lifecycle
   * consequence. Persisted so nothing verified is ever silently dropped; it is
   * NOT the destination for the events enumerated in the handler matrix.
   */
  'UNSUPPORTED',
]);

export const paymentRefundState = pgEnum('payment_refund_state', [
  'REQUESTED',
  'PENDING',
  'COMPLETED',
  'FAILED',
]);

export const paymentRefundCause = pgEnum('payment_refund_cause', [
  /** The capture was never applied, so nothing is released and nothing is lost. */
  'NEVER_APPLIED',
  /** Capacity was already consumed: the unreleased part is a real loss. */
  'SERVED_EXPOSURE',
]);

/** Exact-number domain (ADR-014): floor((2^53 - 1) / 3_600_000). */
export const MAX_FUND_AMOUNT_CENTS = 2_501_999_792;

export const paymentOrder = pgTable(
  'payment_order',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => campaignRun.id, { onDelete: 'restrict' }),
    state: paymentOrderState('state').notNull().default('PENDING'),
    /**
     * NULL until a capture exists. Set in the same transaction as the capture:
     * APPLIED when the credit landed, UNAPPLIED when the economic gate refused
     * it. Preserved through REFUNDED and REVERSED.
     */
    applicationState: paymentApplicationState('application_state'),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('USD'),
    provider: text('provider').notNull().default('paypal'),
    providerOrderId: text('provider_order_id'),
    providerCaptureId: text('provider_capture_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    check('payment_order_amount_positive', sql`${table.amountCents} > 0`),
    check(
      'payment_order_amount_exact_domain',
      sql`${table.amountCents} <= ${sql.raw(String(MAX_FUND_AMOUNT_CENTS))}`,
    ),
    check('payment_order_currency_usd_only', sql`${table.currency} = 'USD'`),
    // A capture reference exists exactly for the states that carry a capture.
    //
    // NOTE ON FORMULATION: this enumerates the states WITHOUT a capture instead
    // of the ones with it, and never names `REVERSED`. PostgreSQL refuses to use
    // an enum value added by `ALTER TYPE ... ADD VALUE` inside the transaction
    // that added it, and drizzle applies every pending migration in one
    // transaction — so no DDL statement here may name the new value. The
    // complement is equivalent while the enum has exactly these five members,
    // and payment-schema.test.ts pins that.
    check(
      'payment_order_capture_id_with_captured_state',
      sql`(${table.state} in ('PENDING', 'APPROVED', 'ABANDONED')) = (${table.providerCaptureId} is null)`,
    ),
    // The application decision is born with the capture and survives refunds and
    // reversals; a state without a capture must not pretend to have one. Added by
    // migration 0009, AFTER the backfill: it is false for every legacy CAPTURED
    // row until application_state has been populated.
    check(
      'payment_order_application_state_matches_capture',
      sql`(${table.providerCaptureId} is not null) = (${table.applicationState} is not null)`,
    ),
    uniqueIndex('payment_order_provider_order_uidx').on(table.provider, table.providerOrderId),
    uniqueIndex('payment_order_provider_capture_uidx').on(table.provider, table.providerCaptureId),
    index('payment_order_run_idx').on(table.runId),
    /**
     * At most one BLOCKING order per run — the structural guarantee that two
     * concurrent checkouts cannot both succeed, and the reason a checkout does
     * not rely on a prior SELECT.
     *
     * OPEN (a checkout that can still take money: PENDING, APPROVED) and
     * BLOCKING (a condition that must prevent a new checkout: an unapplied
     * capture, an unresolved reversal) are different things; this index enforces
     * one of either.
     *
     * `REVERSED` is deliberately not named: PostgreSQL refuses to use an enum
     * value added by `ALTER TYPE ... ADD VALUE` inside the transaction that added
     * it, and drizzle applies every pending migration in one transaction.
     * "Neither terminally abandoned nor fully refunded, and not a capture that
     * was already applied" covers PENDING, APPROVED, REVERSED and
     * CAPTURED+UNAPPLIED exactly.
     *
     * Created by migration 0010 behind a fail-closed preflight: real history can
     * hold several blocking orders on one run, and that is resolved by asking the
     * provider, never by inventing ABANDONED from a timer.
     */
    uniqueIndex('payment_order_one_blocking_per_run_uidx')
      .on(table.runId)
      .where(
        sql`${table.state} <> 'ABANDONED'
            and ${table.state} <> 'REFUNDED'
            and (${table.state} <> 'CAPTURED' or ${table.applicationState} = 'UNAPPLIED')`,
      ),
  ],
);

export const paymentEvent = pgTable(
  'payment_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Nullable for orphan captures (capture sovereignty: money must never be
    // discarded because the local order row is unknown — ADR-014). Written
    // WRITE-ONCE once the order is resolved: NULL → order id is allowed, the
    // same order id is idempotent, a different order id is a conflict.
    paymentId: uuid('payment_id').references(() => paymentOrder.id, { onDelete: 'restrict' }),
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    eventType: text('event_type').notNull(),
    processingState: paymentEventState('processing_state').notNull().default('PENDING_RETRY'),
    failureDetail: text('failure_detail'),
    payload: jsonb('payload').notNull(),
    signatureVerified: boolean('signature_verified').notNull().default(false),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [
    // The event's identity is the pair, never the event id alone.
    uniqueIndex('payment_event_provider_event_uidx').on(table.provider, table.providerEventId),
    index('payment_event_payment_idx').on(table.paymentId),
  ],
);

export const paymentRefund = pgTable(
  'payment_refund',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paymentOrderId: uuid('payment_order_id')
      .notNull()
      .references(() => paymentOrder.id, { onDelete: 'restrict' }),
    /**
     * The run is DERIVED through payment_order, never duplicated here. A
     * denormalised copy would be a second source of truth for the same fact with
     * no structural guarantee that the two agree, and the per-run net ledger
     * equation (credited = Σ applied captures − Σ completed reductions) would
     * silently break if any code path ever inserted a mismatching pair. The join
     * is cheap and the consistency is free.
     */
    provider: text('provider').notNull().default('paypal'),
    providerRefundId: text('provider_refund_id'),
    state: paymentRefundState('state').notNull().default('REQUESTED'),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    /**
     * NULL until COMPLETED, and that is structural rather than procedural: no
     * aggregate can pick up the effect of a requested, pending or failed refund.
     */
    creditedReductionCents: bigint('credited_reduction_cents', { mode: 'number' }),
    nonCapacityRefundCents: bigint('non_capacity_refund_cents', { mode: 'number' }),
    cause: paymentRefundCause('cause'),
    /** Admin principal that requested it; NULL for provider-originated refunds. */
    requestedBy: text('requested_by'),
    detail: text('detail'),
    failureDetail: text('failure_detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    check('payment_refund_amount_positive', sql`${table.amountCents} > 0`),
    check(
      'payment_refund_non_negative',
      sql`(${table.creditedReductionCents} is null or ${table.creditedReductionCents} >= 0)
          and (${table.nonCapacityRefundCents} is null or ${table.nonCapacityRefundCents} >= 0)`,
    ),
    // No financial effect before COMPLETED.
    check(
      'payment_refund_no_effect_before_completion',
      sql`${table.state} = 'COMPLETED'
          or (${table.creditedReductionCents} is null
              and ${table.nonCapacityRefundCents} is null
              and ${table.cause} is null
              and ${table.completedAt} is null)`,
    ),
    check(
      'payment_refund_completed_is_complete',
      sql`${table.state} <> 'COMPLETED'
          or (${table.creditedReductionCents} is not null
              and ${table.nonCapacityRefundCents} is not null
              and ${table.cause} is not null
              and ${table.completedAt} is not null)`,
    ),
    // The two parts always explain the whole refunded amount.
    check(
      'payment_refund_decomposition',
      sql`${table.creditedReductionCents} is null
          or ${table.creditedReductionCents} + ${table.nonCapacityRefundCents} = ${table.amountCents}`,
    ),
    // A never-applied refund releases no capacity by definition.
    check(
      'payment_refund_never_applied_releases_nothing',
      sql`${table.cause} is distinct from 'NEVER_APPLIED' or ${table.creditedReductionCents} = 0`,
    ),
    uniqueIndex('payment_refund_provider_refund_uidx').on(table.provider, table.providerRefundId),
    /** One in-flight refund intent per order: two concurrent refunds cannot both exist. */
    uniqueIndex('payment_refund_one_open_per_order_uidx')
      .on(table.paymentOrderId)
      .where(sql`${table.state} in ('REQUESTED', 'PENDING')`),
    index('payment_refund_order_idx').on(table.paymentOrderId),
  ],
);
