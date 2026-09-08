import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { user } from './auth-schema';

/**
 * Campaign domain schema.
 *
 * A Campaign is reusable advertising identity. A CampaignRun is one competitive
 * and financial execution of it. "Run Again" creates a new run and never revives
 * an exhausted one.
 *
 * The five content columns on `campaign_run` are a snapshot taken at creation,
 * not a join. Editing a campaign therefore cannot change what an existing run
 * displays or where it points, past runs stay historically true, and the Live
 * Market query later reads one table.
 *
 * ENUM VALUES ARE WRITTEN OUT, NOT DERIVED.
 * `pgEnum` accepts the `CATEGORIES` tuple from domain-config directly — that was
 * verified, not assumed — but deriving it was rejected on purpose. A database
 * enum is a historical artifact: once a migration ships, its values exist in
 * PostgreSQL forever, and enum values cannot be reordered or dropped. Reading
 * them from live product configuration would let an edit to domain-config
 * silently change the schema and produce a surprise ALTER TYPE. Written out
 * here, the same edit instead fails `campaign-schema.test.ts` loudly, which
 * turns a hazard into a decision. Drift is prevented by that test.
 *
 * The same reasoning applies to the Time Rate bounds in the CHECK below.
 * Interpolating `TIME_RATE.minCentsPerHour` into the `sql` template would emit a
 * bind parameter rather than a literal, which is not what a CHECK constraint can
 * carry; the literals are pinned to the constants by the same test.
 */

export const campaignCategory = pgEnum('campaign_category', [
  'creators',
  'music-and-artists',
  'events',
  'gaming',
  'apps',
  'ai',
  'tech',
  'startups',
  'ecommerce',
  'entertainment',
  'education',
  'other',
]);

export const campaignRunStatus = pgEnum('campaign_run_status', ['DRAFT', 'ACTIVE', 'EXHAUSTED']);

export const campaign = pgTable(
  'campaign',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // text, because it must match Better Auth's user.id type. RESTRICT, not
    // cascade: sessions and accounts are disposable, campaigns are not, and
    // deleting a user must never silently erase advertising history.
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    destinationUrl: text('destination_url').notNull(),
    category: campaignCategory('category').notNull(),
    // NOT NULL: a campaign selects exactly one category and one subtype. Not an
    // enum, because the valid set depends on the category.
    subtype: text('subtype').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('campaign_owner_user_id_idx').on(table.ownerUserId),
    check('campaign_subtype_not_blank', sql`length(btrim(${table.subtype})) > 0`),
    // Approved copy invariants, enforced by the engine so a direct SQL write
    // cannot bypass them. `length()` on text counts characters, not bytes.
    // The line-break test runs on the stored value, which the application has
    // already trimmed, so it catches breaks inside the copy.
    check(
      'campaign_title_valid',
      sql`length(btrim(${table.title})) BETWEEN 1 AND 50
        AND strpos(${table.title}, chr(10)) = 0
        AND strpos(${table.title}, chr(13)) = 0`,
    ),
    check(
      'campaign_summary_valid',
      sql`length(btrim(${table.summary})) BETWEEN 1 AND 140
        AND strpos(${table.summary}, chr(10)) = 0
        AND strpos(${table.summary}, chr(13)) = 0`,
    ),
  ],
);

export const campaignRun = pgTable(
  'campaign_run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaign.id, { onDelete: 'restrict' }),
    previousRunId: uuid('previous_run_id'),
    status: campaignRunStatus('status').default('DRAFT').notNull(),
    // The only competitive field. Integer cents per hour; the $1–$1,000/hour
    // band is enforced by the CHECK below.
    timeRateCentsPerHour: integer('time_rate_cents_per_hour').notNull(),

    // Accounting state (ADR-011). Consumption is measured in cent-milliseconds,
    // where 1 cent = 3,600,000 units, because a rate is per hour and an hour is
    // 3,600,000 ms. `rate × ms` is then an exact integer product and no
    // settlement ever rounds. bigint is required: credited_cents × 3_600_000
    // exceeds a 32-bit integer.
    creditedCents: bigint('credited_cents', { mode: 'number' }).default(0).notNull(),
    consumedCentMs: bigint('consumed_cent_ms', { mode: 'number' }).default(0).notNull(),
    // The instant from which the current Time Rate applies. Null until the run
    // is funded and activated; money never accrues against a DRAFT.
    rateAnchorAt: timestamp('rate_anchor_at', { withTimezone: true }),

    // Snapshot of the campaign at creation. Immutable for the life of the run.
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    destinationUrl: text('destination_url').notNull(),
    category: campaignCategory('category').notNull(),
    subtype: text('subtype').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // Declared with `unique()` rather than `uniqueIndex()` on purpose. A UNIQUE
    // constraint is emitted inline inside CREATE TABLE, so it exists before the
    // ALTER TABLE that adds the composite foreign key below. A unique index is
    // emitted after that ALTER TABLE, and PostgreSQL would reject the key with
    // "there is no unique constraint matching given keys for referenced table".
    unique('campaign_run_id_campaign_id_uk').on(table.id, table.campaignId),

    // Composite self-reference. Carrying campaign_id into the key is what makes
    // PostgreSQL guarantee a previous run belongs to the same campaign; a plain
    // FK on previous_run_id alone could point anywhere. There is deliberately no
    // second simple FK on that column.
    //
    // The default MATCH SIMPLE is what allows a first run: when any column of
    // the key is NULL the constraint is not checked, so previous_run_id IS NULL
    // passes. MATCH FULL would have rejected it.
    foreignKey({
      name: 'campaign_run_previous_run_fk',
      columns: [table.previousRunId, table.campaignId],
      foreignColumns: [table.id, table.campaignId],
    }).onDelete('restrict'),

    index('campaign_run_campaign_id_idx').on(table.campaignId),

    // At most one ACTIVE run per campaign. Partial, so DRAFT and EXHAUSTED runs
    // accumulate freely and history is never restricted.
    uniqueIndex('campaign_run_one_active_per_campaign_uidx')
      .on(table.campaignId)
      .where(sql`${table.status} = 'ACTIVE'`),

    check('campaign_run_subtype_not_blank', sql`length(btrim(${table.subtype})) > 0`),
    check(
      'campaign_run_time_rate_band',
      sql`${table.timeRateCentsPerHour} BETWEEN 100 AND 100000`,
    ),
    // Whole-dollar granularity, kept as its own constraint so the approved band
    // check above stays byte-identical. Mirrors `isValidTimeRate`: a forged
    // $47.50 rate is refused by the engine as well as by the domain.
    check('campaign_run_time_rate_whole_dollars', sql`${table.timeRateCentsPerHour} % 100 = 0`),

    // Accounting invariants (ADR-011, ADR-012).
    check('campaign_run_credited_non_negative', sql`${table.creditedCents} >= 0`),
    check('campaign_run_consumed_non_negative', sql`${table.consumedCentMs} >= 0`),
    // Settled consumption can never exceed what was credited, so a run at rest
    // never holds a negative balance.
    check(
      'campaign_run_consumed_within_credit',
      sql`${table.consumedCentMs} <= ${table.creditedCents} * 3600000`,
    ),
    // A DRAFT has no rate anchor and any other state must have one: money only
    // accrues from the moment a funded run starts competing.
    check(
      'campaign_run_anchor_matches_status',
      sql`(${table.status} = 'DRAFT') = (${table.rateAnchorAt} IS NULL)`,
    ),
    check(
      'campaign_run_no_self_reference',
      sql`${table.previousRunId} IS NULL OR ${table.previousRunId} <> ${table.id}`,
    ),
    // The snapshot must satisfy the same copy invariants as the campaign it was
    // taken from, so a run can never display copy the campaign could not hold.
    check(
      'campaign_run_title_valid',
      sql`length(btrim(${table.title})) BETWEEN 1 AND 50
        AND strpos(${table.title}, chr(10)) = 0
        AND strpos(${table.title}, chr(13)) = 0`,
    ),
    check(
      'campaign_run_summary_valid',
      sql`length(btrim(${table.summary})) BETWEEN 1 AND 140
        AND strpos(${table.summary}, chr(10)) = 0
        AND strpos(${table.summary}, chr(13)) = 0`,
    ),
  ],
);
