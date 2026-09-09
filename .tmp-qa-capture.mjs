import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (match && process.env[match[1]] === undefined) {
    process.env[match[1]] = match[2].trim().replace(/^"([\s\S]*)"$/, '$1').replace(/^'([\s\S]*)'$/, '$1');
  }
}
const sql = neon(process.env.DATABASE_URL);
const orders = await sql`
  select po.provider_order_id, po.id, po.state, po.amount_cents
  from payment_order po
  where po.state = 'PENDING' and po.provider_order_id is not null
  order by po.created_at desc limit 6`;
const sdk = await import('@paypal/checkout-server-sdk');
const paypal = sdk.default ?? sdk;
const env =
  process.env.PAYPAL_ENVIRONMENT === 'production'
    ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
    : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET);
const client = new paypal.core.PayPalHttpClient(env);

for (const o of orders) {
  try {
    const getReq = new paypal.orders.OrdersGetRequest(o.provider_order_id);
    const gotten = await client.execute(getReq);
    console.log('GET', o.provider_order_id, gotten.result.status, JSON.stringify(gotten.result.purchase_units[0]?.payments));
    if (gotten.result.status === 'APPROVED') {
      const captureReq = new paypal.orders.OrdersCaptureRequest(o.provider_order_id);
      const captured = await client.execute(captureReq);
      console.log('CAPTURE', o.provider_order_id, captured.result.status);
    }
  } catch (err) {
    console.log('SKIP', o.provider_order_id, '-', err.message);
  }
}
process.exit(0);
