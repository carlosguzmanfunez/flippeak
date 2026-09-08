import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { campaignRun } from './campaign-schema';

/**
 * Verifiable funding ledger for campaign runs (Phase 4D, master prompt 34-35).
 *
 * Every credit to `campaign_run.credited_cents` has exactly one verified row
 * here. The ledger is the transport-neutral record: today the only provider is
 * `internal` (the provider-free proof path), and PayPal integration later adds
 * rows with `provider = 'paypal'` driven by verified server-side events.
 *
 * Idempotency is structural: `UNIQUE(provider, provider_event_id)` means a
 * replayed provider event can never credit the same order twice. The internal
 * source emits one fresh provider_event_id per request, so retries are safe by
 * the same constraint that will later protect webhook replays (master prompt
 * section 35).
 *
 * No product limit is invented here. Budget minimum, maximum and funding
 * granularity remain open decisions (master prompt section 48); the only rule
 * below is integrity: a credit row holds a strictly positive amount.
 */

export const runFunding = pgTable(
  'run_funding',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => campaignRun.id, { onDelete: 'restrict' }),
    fundingCents: bigint('funding_cents', { mode: 'number' }).notNull(),
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    verified: boolean('verified').notNull().default(false),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('run_funding_amount_positive', sql`${table.fundingCents} > 0`),
    uniqueIndex('run_funding_provider_event_uidx').on(table.provider, table.providerEventId),
    index('run_funding_run_idx').on(table.runId),
  ],
);
