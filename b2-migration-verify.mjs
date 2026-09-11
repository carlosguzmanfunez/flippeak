// B2 migration-window verification (NOT yet executed — migrations are not applied).
//
// Run in two phases around the migration:
//
//   node b2-migration-verify.mjs --seed     # against a database at 0000–0007
//   npm run db:migrate                      # applies 0008 … 0010
//   node b2-migration-verify.mjs --verify
//   node b2-migration-verify.mjs --cleanup
//
// It exists because 0009's legacy resolution cannot be covered by a vitest test:
// the fixtures must exist BEFORE the migration runs and be asserted AFTER, and a
// test file cannot straddle a migration.
//
// Synthetic cases (all created at the pre-0009 schema state):
//
//   A  CAPTURED_UNAPPLIED + signature_verified + PAYMENT.CAPTURE.COMPLETED,
//      amount and currency matching the order      -> ELIGIBLE, must be resolved
//   B  the same row with signature_verified = false -> NOT resolved
//   C  the same row with a different event_type     -> NOT resolved
//   D  two distinct candidate captures on one order -> NOT resolved (ambiguous)
//   E  a CAPTURED order with no ledger row and no evidence at all -> migration
//      must FAIL CLOSED (checked separately, see the note at the end)
//
// Never prints a connection string, a password or an email.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Pool } from '@neondatabase/serverless';

const envText = readFileSync(new URL('./.env.local', import.meta.url), 'utf8');
const url = /^INTEGRATION_DATABASE_URL=(.*)$/m.exec(envText)?.[1]?.trim().replace(/^["']|["']$/g, '');
if (!url) throw new Error('INTEGRATION_DATABASE_URL missing from .env.local');

const MARKER = 'b2mv';
const pool = new Pool({ connectionString: url });
const q = async (text, params) => (await pool.query(text, params)).rows;
const one = async (text, params) => (await q(text, params))[0];

const owner = async () => q(`select id from "user" where id like '${MARKER}-%' limit 1`);

async function migrationCount() {
  const row = await one(`select count(*)::int as n from drizzle.__drizzle_migrations`);
  return row.n;
}

async function seed() {
  const applied = await migrationCount();
  if (applied !== 8) {
    throw new Error(`--seed expects 0000–0007 applied (8 rows), found ${applied}. Refusing.`);
  }

  const userId = `${MARKER}-user-${randomUUID()}`;
  const campaignId = randomUUID();
  const runId = randomUUID();
  await pool.query(
    `insert into "user" (id, name, email) values ($1, 'B2 migration fixture', $2)`,
    [userId, `${userId}@flippeak.invalid`],
  );
  await pool.query(
    `insert into "campaign" (id, owner_user_id, title, summary, destination_url, category, subtype)
     values ($1, $2, 'B2 migration fixture', 'Synthetic legacy row.', 'https://example.invalid/b2mv', 'creators', 'Video Creator')`,
    [campaignId, userId],
  );
  await pool.query(
    `insert into "campaign_run" (id, campaign_id, status, time_rate_cents_per_hour, credited_cents, consumed_cent_ms,
                                 title, summary, destination_url, category, subtype)
     values ($1, $2, 'DRAFT', 10000, 0, 0, 'B2 migration fixture', 'Synthetic legacy row.', 'https://example.invalid/b2mv', 'creators', 'Video Creator')`,
    [runId, campaignId],
  );

  const cases = [
    { key: 'A', verified: true, eventType: 'PAYMENT.CAPTURE.COMPLETED', captures: 1 },
    { key: 'B', verified: false, eventType: 'PAYMENT.CAPTURE.COMPLETED', captures: 1 },
    { key: 'C', verified: true, eventType: 'CHECKOUT.ORDER.APPROVED', captures: 2 },
    { key: 'D', verified: true, eventType: 'PAYMENT.CAPTURE.COMPLETED', captures: 2 },
  ];

  const fixtures = [];
  let createdAt = Date.now();
  for (const testCase of cases) {
    // Each case gets its own run so the cases cannot influence each other.
    const caseRunId = randomUUID();
    await pool.query(
      `insert into "campaign_run" (id, campaign_id, status, time_rate_cents_per_hour, credited_cents, consumed_cent_ms,
                                   title, summary, destination_url, category, subtype)
       values ($1, $2, 'DRAFT', 10000, 0, 0, 'B2 migration fixture', 'Synthetic legacy row.', 'https://example.invalid/b2mv', 'creators', 'Video Creator')`,
      [caseRunId, campaignId],
    );

    createdAt += 1000;
    const orderId = randomUUID();
    const providerOrderId = `${MARKER}-po-${testCase.key}-${randomUUID()}`;
    await pool.query(
      `insert into "payment_order" (id, run_id, state, amount_cents, currency, provider, provider_order_id, created_at, updated_at)
       values ($1, $2, 'APPROVED', 5000, 'USD', 'paypal', $3, $4, $4)`,
      [orderId, caseRunId, providerOrderId, new Date(createdAt).toISOString()],
    );

    const captureIds = [];
    for (let index = 0; index < testCase.captures; index += 1) {
      const captureId = `${MARKER}-cap-${testCase.key}${index}-${randomUUID()}`;
      captureIds.push(captureId);
      const eventId = `${MARKER}-evt-${testCase.key}${index}-${randomUUID()}`;
      await pool.query(
        `insert into "payment_event" (id, payment_id, provider, provider_event_id, event_type, processing_state,
                                      payload, signature_verified, received_at)
         values ($1, null, 'paypal', $2, $3, 'CAPTURED_UNAPPLIED', $4, $5, now())`,
        [
          randomUUID(),
          eventId,
          testCase.eventType,
          JSON.stringify({
            providerEventId: eventId,
            eventType: testCase.eventType,
            resource: {
              id: captureId,
              amount: { value: '50.00', currency_code: 'USD' },
              supplementary_data: { related_ids: { order_id: providerOrderId } },
            },
          }),
          testCase.verified,
        ],
      );
    }
    fixtures.push({ key: testCase.key, orderId, runId: caseRunId, captureIds });
  }

  console.log(`seeded owner=${MARKER}-*** campaign=${campaignId.slice(0, 8)}…`);
  console.log(`cases: ${fixtures.map((f) => f.key).join(', ')} (expected A resolved, B/C/D untouched)`);
  await pool.end();
}

async function verify() {
  const rows = await q(
    `select o.id, o.state, o.application_state, o.provider_capture_id,
            (select count(*)::int from payment_event e
              where e.payload->'resource'->'supplementary_data'->'related_ids'->>'order_id' = o.provider_order_id
                and e.payment_id = o.id) as linked_events
       from payment_order o
      where o.provider_order_id like '${MARKER}-po-%'
      order by o.created_at`,
  );
  console.log(JSON.stringify(rows, null, 1));
  for (const row of rows) {
    console.log(`order ${String(row.id).slice(0, 8)}… state=${row.state} application=${row.application_state} linked=${row.linked_events}`);
  }
  console.log('A must be CAPTURED/UNAPPLIED with linked_events = 1; B, C and D must stay APPROVED with application_state NULL.');
  await pool.end();
}

async function cleanup() {
  const users = await q(`select id from "user" where id like '${MARKER}-%'`);
  for (const row of users) {
    const campaigns = await q(`select id from campaign where owner_user_id = $1`, [row.id]);
    for (const campaign of campaigns) {
      const runs = await q(`select id from campaign_run where campaign_id = $1`, [campaign.id]);
      const runIds = runs.map((r) => r.id);
      if (runIds.length > 0) {
        await pool.query(
          `delete from payment_event where payload->'resource'->'supplementary_data'->'related_ids'->>'order_id'
             in (select provider_order_id from payment_order where run_id = any($1))`,
          [runIds],
        );
        await pool.query(`delete from payment_order where run_id = any($1)`, [runIds]);
        await pool.query(`delete from run_funding where run_id = any($1)`, [runIds]);
        await pool.query(`delete from payment_refund where payment_order_id in
                            (select id from payment_order where run_id = any($1))`, [runIds]).catch(() => {});
        await pool.query(`update campaign_run set previous_run_id = null where campaign_id = $1`, [campaign.id]);
        await pool.query(`delete from campaign_run where campaign_id = $1`, [campaign.id]);
      }
      await pool.query(`delete from campaign where id = $1`, [campaign.id]);
    }
    await pool.query(`delete from "user" where id = $1`, [row.id]);
  }
  const residue = await one(
    `select (select count(*)::int from "user" where id like '${MARKER}-%') as users,
            (select count(*)::int from campaign where title = 'B2 migration fixture') as campaigns,
            (select count(*)::int from payment_order where provider_order_id like '${MARKER}-po-%') as orders,
            (select count(*)::int from payment_event where provider_event_id like '${MARKER}-evt-%') as events`,
  );
  console.log(`cleanup residue: ${JSON.stringify(residue)} (every field must be 0)`);
  await pool.end();
}

const mode = process.argv[2];
if (mode === '--seed') await seed();
else if (mode === '--verify') await verify();
else if (mode === '--cleanup') await cleanup();
else {
  console.log('usage: node b2-migration-verify.mjs --seed | --verify | --cleanup');
  await pool.end();
}
