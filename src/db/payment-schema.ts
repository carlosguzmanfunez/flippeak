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
 * PayPal funding layer (phase 9/10, ADR-014).
 *
 * Two levels of idempotency, two tables:
 *
 *  - payment_order: one per checkout intent (1 run : N orders). CAPTURED is the
 *    only state that implies money; provider_capture_id is the financial key
 *    and is UNIQUE, so no second row can ever reference the same capture.
 *  - payment_event: one row per provider delivery (event id UNIQUE), plus the
 *    processing verdict and the raw payload for audit.
 *
 * The exactness ceiling below is a representation limit only (ADR-014); the
 * commercial budget minimum/maximum remains deliberately undecided.
 */

export const paymentOrderState = pgEnum('payment_order_state', [
  'PENDING',
  'APPROVED',
  'CAPTURED',
  'ABANDONED',
  'REFUNDED',
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
   * EXHAUSTED). PayPal already took real money, so the capture must be recorded
   * and reconciled by hand — it is never dropped and never credited as if it had
   * been applied, and the run must not revive (ADR-014 §6). Terminal: a
   * redelivery of the same event id is absorbed, so the event does not sit in
   * PENDING_RETRY forever while a human decides.
   */
  'CAPTURED_UNAPPLIED',
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
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('USD'),
    provider: text('provider').notNull().default('paypal'),
    providerOrderId: text('provider_order_id'),
    providerCaptureId: text('provider_capture_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('payment_order_amount_positive', sql`${table.amountCents} > 0`),
    check(
      'payment_order_amount_exact_domain',
      sql`${table.amountCents} <= ${sql.raw(String(MAX_FUND_AMOUNT_CENTS))}`,
    ),
    check('payment_order_currency_usd_only', sql`${table.currency} = 'USD'`),
    // Money implies a capture reference; any other state has none.
    check(
      'payment_order_capture_id_with_captured_state',
      sql`((${table.state} = 'CAPTURED') or (${table.state} = 'REFUNDED')) = (${table.providerCaptureId} is not null)`,
    ),
    uniqueIndex('payment_order_provider_order_uidx').on(table.provider, table.providerOrderId),
    uniqueIndex('payment_order_provider_capture_uidx').on(table.provider, table.providerCaptureId),
    index('payment_order_run_idx').on(table.runId),
  ],
);

export const paymentEvent = pgTable(
  'payment_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Nullable for orphan captures (capture sovereignty: money must never be
    // discarded because the local order row is unknown — ADR-014).
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
    uniqueIndex('payment_event_provider_event_uidx').on(table.provider, table.providerEventId),
    index('payment_event_payment_idx').on(table.paymentId),
  ],
);
