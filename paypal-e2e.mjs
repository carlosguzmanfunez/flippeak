// ============================================================
// FlipPeak — PayPal Sandbox E2E (Phase 10-B)
//
// Uso:
//   node paypal-e2e.mjs create      # crea la orden (deja el approval link)
//   node paypal-e2e.mjs capture     # captura server-side (webhook llega al deploy)
//   node paypal-e2e.mjs verify      # verifica DB: funding exacto, CAPTURED, activación
//
// REQUISITOS (en .env.local) — NUNCA en el chat:
//   PAYPAL_ENVIRONMENT=sandbox  PAYPAL_CLIENT_ID=...  PAYPAL_CLIENT_SECRET=...
//   DATABASE_URL=postgresql://...  (la misma de flippeak-dev, al alcance local)
//
// El webhook REAL solo se procesa si la URL del webhook de la app sandbox apunta
// al deploy (https://flippeak.vercel.app/api/paypal/webhook) y Vercel tiene las
// mismas credenciales + PAYPAL_WEBHOOK_ID. El crédito lo hace el webhook, no
// este script: capture() no acredita (ADR-014 §6).
//
// Aprobación: el comprador sandbox debe abrir el approval link y aprobar
// (login con cuenta de buyer sandbox). Ese paso no es automatizable.
// ============================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { neon } from '@neondatabase/serverless';

const STATE_FILE = '.paypal-e2e-state.json';
const TEST_AMOUNT_CENTS = 10_000; // $10.00 — importe de prueba válido en Sandbox
// (NO es una política comercial de FlipPeak: es un valor de prueba deliberado.)

const sql = neon(process.env.DATABASE_URL);
const state = { orderId: null, run: null, paymentOrderId: null };
if (existsState()) Object.assign(state, JSON.parse(readFileSync(STATE_FILE, 'utf8')));

function existsState() {
  try {
    readFileSync(STATE_FILE, 'utf8');
    return true;
  } catch {
    return false;
  }
}

function saveState() {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function sdk() {
  const sdk = await import('@paypal/checkout-server-sdk');
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('provider not configured');
  const Environment =
    process.env.PAYPAL_ENVIRONMENT === 'production'
      ? sdk.core.LiveEnvironment
      : sdk.core.SandboxEnvironment;
  return { client: new sdk.core.PayPalHttpClient(new Environment(clientId, clientSecret)), orders: sdk.orders };
}

async function findRun() {
  const rows = await sql`
    select cr.id, c.org_id as _x, c.title, c.owner_user_id
    from campaign_run cr join campaign c on c.id = cr.campaign_id
    where cr.status = 'DRAFT' and c.title = 'FlipPeak Test Campaign' and c.owner_user_id = '0UYjthBgrItKQcbxEt2TvKWEsow02W5t'
    order by cr.created_at desc limit 1`;
  return rows[0] ?? null;
}

async function create() {
  const { client, orders } = await sdk();
  const run = await findRun();
  if (!run) throw new Error('No DRAFT run found for the e2e');

  const inserted = await sql`
    insert into payment_order (run_id, amount_cents, currency, provider)
    values (${run.id}, ${TEST_AMOUNT_CENTS}, 'USD', 'paypal') returning id`;
  const paymentOrderId = inserted[0].id;

  const request = new orders.OrdersCreateRequest();
  request.prefer('return=representation');
  request.requestBody({
    intent: 'CAPTURE',
    purchase_units: [{ reference_id: paymentOrderId, amount: { currency_code: 'USD', value: '10.00' } }],
  });
  const response = await client.execute(request);
  const result = response.result;
  const approval = result?.links?.find((l) => l.rel === 'approve')?.href ?? '';

  await sql`update payment_order set provider_order_id = ${result.id} where id = ${paymentOrderId}`;

  state.orderId = result.id;
  state.paymentOrderId = paymentOrderId;
  state.run = run.id;
  saveState();
  console.log('ORDER CREATED', JSON.stringify({ paymentOrderId, providerOrderId: result.id, run: run.id }));
  console.log('APPROVAL LINK (abre en navegador con cuenta compradora sandbox y aprueba):');
  console.log(approval);
  console.log('Después ejecuta: node paypal-e2e.mjs capture');
}

async function snapshot() {
  const [credit] = await sql`select credited_cents from campaign_run where id = ${state.run}`;
  const fundingCount = await sql`select count(*) as n from run_funding where run_id = ${state.run} and provider = 'paypal'`;
  const [order] = await sql`select state, provider_capture_id from payment_order where id = ${state.paymentOrderId}`;
  const [run] = await sql`select status from campaign_run where id = ${state.run}`;
  return {
    creditedCents: Number(credit?.credited_cents ?? 0),
    paypalFundingRows: Number(fundingCount[0]?.n ?? 0),
    orderState: order?.state ?? null,
    captureId: order?.provider_capture_id ?? null,
    runStatus: run?.status ?? null,
  };
}

async function capture() {
  if (!state.orderId) throw new Error('run create first');
  const { client, orders } = await sdk();
  const request = new orders.OrdersCaptureRequest(state.orderId);
  const response = await client.execute(request);
  console.log('CAPTURE RESPONSE', JSON.stringify(response.result?.status));

  // Point 5: evidence the Capture API itself is NOT financial recognition.
  // Snapshot immediately: the state must show that FlipPeak has not credited
  // anything yet (webhook still pending). "PayPal reported" != "FlipPeak
  // credited" — the internal payment_order CAPTURED state only happens inside
  // the verified webhook transaction.
  const pre = await snapshot();
  console.log('PRE-WEBHOOK STATE (no recognized credit expected):', JSON.stringify(pre));
  console.log('CHECK pre: no paypal funding rows:', pre.paypalFundingRows === 0);
  console.log('CHECK pre: order NOT internally CAPTURED:', pre.orderState !== 'CAPTURED');
  console.log('CHECK pre: run not active by capture:', pre.runStatus !== 'ACTIVE');
  console.log('Esperando webhook real… ejecuta: node paypal-e2e.mjs verify');
}

async function capture() {
  if (!state.orderId) throw new Error('run create first');
  const { client, orders } = await sdk();
  const request = new orders.OrdersCaptureRequest(state.orderId);
  const response = await client.execute(request);
  console.log('CAPTURE RESPONSE', JSON.stringify(response.result?.status));
  console.log('El webhook PAYMENT.CAPTURE.COMPLETED llega al deploy. Espera unos segundos y ejecuta: node paypal-e2e.mjs verify');
}

async function verify() {
  // Point 4: tolerate the asynchronous webhook — poll with a deadline instead
  // of a single immediate query. No arbitrary sleeps as a fix.
  const DEADLINE_MS = 30_000;
  const INTERVAL_MS = 1_500;
  const startedAt = Date.now();

  let last = await snapshot();
  console.log('POLLING', `(hasta ${DEADLINE_MS} ms, cada ${INTERVAL_MS} ms)`);
  while (Date.now() - startedAt < DEADLINE_MS) {
    last = await snapshot();
    const fundingExact = last.paypalFundingRows === 1;
    const orderCaptured = last.orderState === 'CAPTURED' && last.captureId !== null;
    const runActivated = last.runStatus === 'ACTIVE';
    if (fundingExact && orderCaptured && runActivated) {
      console.log('WEBHOOK RECONOCIDO — estado final:', JSON.stringify(last));
      await printEvidence();
      console.log('E2E RESULT: PASSO — Create→approval→capture→webhook verificado→run_funding→crédito→activación');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }

  console.log('E2E TIMEOUT — el webhook no fue procesado en', DEADLINE_MS, 'ms. Último estado:', JSON.stringify(last));
  console.log('Posibles causas: webhook no configurado en la app, deploy sin creds, o eventos no suscritos.');
  await printEvidence();
  process.exit(2);
}

async function printEvidence() {
  const before = await sql`select credited_cents from campaign_run where id = ${state.run}`;
  const fundings = await sql`
    select funding_cents, provider, provider_event_id, verified from run_funding where run_id = ${state.run} and provider = 'paypal' order by created_at desc limit 5`;
  const orders = await sql`
    select state, provider_capture_id, provider_order_id from payment_order where id = ${state.paymentOrderId}`;
  const events = await sql`
    select event_type, processing_state, signature_verified from payment_event where payment_id = ${state.paymentOrderId} order by received_at desc limit 6`;
  const run = await sql`
    select status, credited_cents, rate_anchor_at from campaign_run where id = ${state.run}`;
  console.log('EVIDENCE', JSON.stringify({ funding: fundings, order: orders, events, run, creditBefore: before[0]?.credited_cents }, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
}

async function main() {
  const command = process.argv[2];
  if (command === 'create') return create();
  if (command === 'capture') return capture();
  if (command === 'verify') return verify();
  throw new Error(`unknown command: ${command}`);
}

main().catch((error) => {
  console.error('E2E FAIL -', error.message);
  process.exit(1);
});
