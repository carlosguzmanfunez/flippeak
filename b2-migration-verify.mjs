// B2 migration-window verification. NOT yet executed end to end — migrations are
// deliberately unapplied until the behaviour layer that writes application_state
// exists.
//
// Sequence, in two phases that straddle the migration:
//
//   node b2-migration-verify.mjs --seed        # db at 0000–0007: cases A–D
//   npm run db:migrate                         # applies 0008 … 0009
//   node b2-migration-verify.mjs --verify      # asserts A–D, exits non-zero on any failure
//   node b2-migration-verify.mjs --seed-e      # db at 0000–0007: the fail-closed case
//   npm run db:migrate                         # must ABORT (0009 refuses)
//   node b2-migration-verify.mjs --verify-e    # asserts the abort happened
//   node b2-migration-verify.mjs --cleanup     # idempotent
//
// Cases:
//   A  CAPTURED_UNAPPLIED + signature_verified + PAYMENT.CAPTURE.COMPLETED,
//      amount/currency matching the order  -> exactly CAPTURED/UNAPPLIED, the
//      right capture id, and payment_id linked exactly once
//   B  the same structure with signature_verified = false -> NOT resolved
//   C  ONE capture, verified, different event_type        -> NOT resolved
//      (isolates the event-type gate; no ambiguity involved)
//   D  two distinct valid capture ids on one order        -> ambiguous, NOT resolved
//   E  a CAPTURED order with a capture id and no ledger row and no positive
//      UNAPPLIED evidence -> 0009 must FAIL CLOSED
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

const failures = [];
const check = (condition, message) => {
  if (condition) console.log(`  PASS  ${message}`);
  else {
    console.log(`  FAIL  ${message}`);
    failures.push(message);
  }
};

const migrationCount = async () => (await one(`select count(*)::int as n from drizzle.__drizzle_migrations`)).n;

async function insertOwnerAndCampaign() {
  const userId = `${MARKER}-user-${randomUUID()}`;
  const campaignId = randomUUID();
  await pool.query(`insert into "user" (id, name, email) values ($1, 'B2 migration fixture', $2)`, [
    userId,
    `${userId}@flippeak.invalid`,
  ]);
  await pool.query(
    `insert into "campaign" (id, owner_user_id, title, summary, destination_url, category, subtype)
     values ($1, $2, 'B2 migration fixture', 'Synthetic legacy row.', 'https://example.invalid/b2mv', 'creators', 'Video Creator')`,
    [campaignId, userId],
  );
  return campaignId;
}

async function insertRun(campaignId, { status = 'DRAFT', creditedCents = 0 } = {}) {
  const runId = randomUUID();
  // The schema ties the anchor to the status: DRAFT has none, anything else has
  // one. EXHAUSTED is needed by case E.
  const anchor = status === 'DRAFT' ? null : new Date().toISOString();
  await pool.query(
    `insert into "campaign_run" (id, campaign_id, status, time_rate_cents_per_hour, credited_cents, consumed_cent_ms,
                                 rate_anchor_at, title, summary, destination_url, category, subtype)
     values ($1, $2, $3, 10000, $4, 0, $5, 'B2 migration fixture', 'Synthetic legacy row.', 'https://example.invalid/b2mv', 'creators', 'Video Creator')`,
    [runId, campaignId, status, creditedCents, anchor],
  );
  return runId;
}

async function insertOrder({ runId, state = 'APPROVED', providerOrderId, providerCaptureId = null, createdAt }) {
  const orderId = randomUUID();
  await pool.query(
    `insert into "payment_order" (id, run_id, state, amount_cents, currency, provider, provider_order_id,
                                  provider_capture_id, created_at, updated_at)
     values ($1, $2, $3, 5000, 'USD', 'paypal', $4, $5, $6, $6)`,
    [orderId, runId, state, providerOrderId, providerCaptureId, createdAt],
  );
  return orderId;
}

async function insertEvent({ providerOrderId, captureId, eventType, verified, processingState = 'CAPTURED_UNAPPLIED' }) {
  const eventId = `${MARKER}-evt-${randomUUID()}`;
  await pool.query(
    `insert into "payment_event" (id, payment_id, provider, provider_event_id, event_type, processing_state,
                                  payload, signature_verified, received_at)
     values ($1, null, 'paypal', $2, $3, $4, $5, $6, now())`,
    [
      randomUUID(),
      eventId,
      eventType,
      processingState,
      JSON.stringify({
        providerEventId: eventId,
        eventType,
        resource: {
          id: captureId,
          amount: { value: '50.00', currency_code: 'USD' },
          supplementary_data: { related_ids: { order_id: providerOrderId } },
        },
      }),
      verified,
    ],
  );
  return eventId;
}

const CAPTURE_COMPLETED = 'PAYMENT.CAPTURE.COMPLETED';
const OTHER_EVENT = 'CHECKOUT.ORDER.APPROVED';

async function seed() {
  const applied = await migrationCount();
  if (applied !== 8) throw new Error(`--seed expects 0000–0007 applied (8 rows), found ${applied}.`);

  const campaignId = await insertOwnerAndCampaign();
  const cases = [
    { key: 'A', verified: true, eventType: CAPTURE_COMPLETED, captures: 1 },
    { key: 'B', verified: false, eventType: CAPTURE_COMPLETED, captures: 1 },
    { key: 'C', verified: true, eventType: OTHER_EVENT, captures: 1 },
    { key: 'D', verified: true, eventType: CAPTURE_COMPLETED, captures: 2 },
  ];

  let createdAt = Date.now();
  for (const testCase of cases) {
    const runId = await insertRun(campaignId);
    createdAt += 1000;
    const providerOrderId = `${MARKER}-${testCase.key}-po-${randomUUID()}`;
    await insertOrder({ runId, providerOrderId, createdAt: new Date(createdAt).toISOString() });
    for (let index = 0; index < testCase.captures; index += 1) {
      await insertEvent({
        providerOrderId,
        captureId: `${MARKER}-${testCase.key}-${index}-cap-${randomUUID()}`,
        eventType: testCase.eventType,
        verified: testCase.verified,
      });
    }
  }
  console.log('seeded cases A–D (A resolves; B, C, D must not)');
  await pool.end();
}

/** Case E: a CAPTURED order with a capture id, no ledger row and no evidence. */
async function seedE() {
  const applied = await migrationCount();
  if (applied !== 8) throw new Error(`--seed-e expects 0000–0007 applied (8 rows), found ${applied}.`);

  const campaignId = await insertOwnerAndCampaign();
  const runId = await insertRun(campaignId, { status: 'EXHAUSTED', creditedCents: 5000 });
  const providerOrderId = `${MARKER}-E-po-${randomUUID()}`;
  await insertOrder({
    runId,
    state: 'CAPTURED',
    providerOrderId,
    providerCaptureId: `${MARKER}-E-cap-${randomUUID()}`,
    createdAt: new Date().toISOString(),
  });
  console.log('seeded case E (0009 must fail closed: CAPTURED with no ledger and no UNAPPLIED evidence)');
  await pool.end();
}

async function verifiedOutcome(key) {
  return one(
    `select o.id, o.state, o.application_state, o.provider_capture_id, o.amount_cents, o.currency,
            (select count(*)::int from payment_event e where e.payment_id = o.id) as linked_events,
            (select count(*)::int from payment_event e
              where e.provider_event_id like $2
                and e.payload->'resource'->'supplementary_data'->'related_ids'->>'order_id' = o.provider_order_id) as candidate_events,
            (select count(*)::int from run_funding f where f.run_id = o.run_id) as ledger_rows
       from payment_order o
      where o.provider_order_id like $1`,
    [`${MARKER}-${key}-po-%`, `${MARKER}-evt-%`],
  );
}

async function verify() {
  const applied = await migrationCount();
  check(applied >= 9, `migrations applied >= 9 (found ${applied})`);

  const a = await verifiedOutcome('A');
  check(a !== undefined, 'case A: order found');
  if (a !== undefined) {
    check(a.state === 'CAPTURED', `case A: state CAPTURED (found ${a.state})`);
    check(a.application_state === 'UNAPPLIED', `case A: application_state UNAPPLIED (found ${a.application_state})`);
    check(
      typeof a.provider_capture_id === 'string' && a.provider_capture_id.startsWith(`${MARKER}-A-`),
      'case A: provider_capture_id is the candidate capture id',
    );
    check(a.linked_events === 1, `case A: payment_id linked exactly once (found ${a.linked_events})`);
    check(a.ledger_rows === 0, `case A: no run_funding row was created (found ${a.ledger_rows})`);
  }

  for (const key of ['B', 'C', 'D']) {
    const row = await verifiedOutcome(key);
    check(row !== undefined, `case ${key}: order found`);
    if (row === undefined) continue;
    check(row.state === 'APPROVED', `case ${key}: state unchanged APPROVED (found ${row.state})`);
    check(row.application_state === null, `case ${key}: application_state still NULL (found ${row.application_state})`);
    check(row.provider_capture_id === null, `case ${key}: no capture adopted (found ${row.provider_capture_id})`);
    check(row.linked_events === 0, `case ${key}: no event linked (found ${row.linked_events})`);
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} assertion(s) FAILED`);
    process.exitCode = 1;
  } else {
    console.log('\nall assertions passed');
  }
  await pool.end();
}

/** The fail-closed proof: 0009 must have aborted, so the count stays below 9. */
async function verifyE() {
  const applied = await migrationCount();
  check(applied < 9, `case E: 0009 did NOT complete, so the fail-closed guard fired (migrations applied = ${applied})`);

  const rows = await q(
    `select count(*)::int as n from payment_order
      where provider_order_id like '${MARKER}-E-po-%' and state = 'CAPTURED'`,
  );
  check(rows[0].n === 1, 'case E: the offending CAPTURED order is still there, untouched');

  if (failures.length > 0) {
    console.error(`\n${failures.length} assertion(s) FAILED`);
    process.exitCode = 1;
  } else {
    console.log('\ncase E verified: the migration refused instead of inventing a state');
  }
  await pool.end();
}

async function tableExists(name) {
  const rows = await q(`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name = $1`, [name]);
  return rows[0].n > 0;
}

async function cleanup() {
  const users = await q(`select id from "user" where id like '${MARKER}-%'`);
  for (const user of users) {
    const campaigns = await q(`select id from campaign where owner_user_id = $1`, [user.id]);
    for (const campaign of campaigns) {
      const runIds = (await q(`select id from campaign_run where campaign_id = $1`, [campaign.id])).map((r) => r.id);
      if (runIds.length > 0) {
        await pool.query(
          `delete from payment_event
            where payload->'resource'->'supplementary_data'->'related_ids'->>'order_id'
                  in (select provider_order_id from payment_order where run_id = any($1))`,
          [runIds],
        );
        // payment_refund references payment_order with ON DELETE RESTRICT, so it
        // must go first — and only if the B2 schema is present.
        if (await tableExists('payment_refund')) {
          await pool.query(
            `delete from payment_refund where payment_order_id in (select id from payment_order where run_id = any($1))`,
            [runIds],
          );
        }
        await pool.query(`delete from payment_order where run_id = any($1)`, [runIds]);
        await pool.query(`delete from run_funding where run_id = any($1)`, [runIds]);
        await pool.query(`update campaign_run set previous_run_id = null where campaign_id = $1`, [campaign.id]);
        await pool.query(`delete from campaign_run where campaign_id = $1`, [campaign.id]);
      }
      await pool.query(`delete from campaign where id = $1`, [campaign.id]);
    }
    await pool.query(`delete from "user" where id = $1`, [user.id]);
  }

  const residue = await one(
    `select (select count(*)::int from "user" where id like '${MARKER}-%') as users,
            (select count(*)::int from campaign where title = 'B2 migration fixture') as campaigns,
            (select count(*)::int from payment_order where provider_order_id like '${MARKER}-%') as orders,
            (select count(*)::int from payment_event where provider_event_id like '${MARKER}-%') as events`,
  );
  console.log(`cleanup residue: ${JSON.stringify(residue)}`);
  const clean = Object.values(residue).every((value) => value === 0);
  check(clean, 'cleanup left zero residue');
  if (!clean) process.exitCode = 1;
  await pool.end();
}

const mode = process.argv[2];
if (mode === '--seed') await seed();
else if (mode === '--seed-e') await seedE();
else if (mode === '--verify') await verify();
else if (mode === '--verify-e') await verifyE();
else if (mode === '--cleanup') await cleanup();
else {
  console.log('usage: node b2-migration-verify.mjs --seed | --seed-e | --verify | --verify-e | --cleanup');
  await pool.end();
}
