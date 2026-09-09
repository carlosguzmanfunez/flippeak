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
  select po.provider_order_id, po.state, po.amount_cents, po.created_at
  from payment_order po
  where po.provider_order_id in ('8M9159130U394131F','64L73233PY605081U','68P10136M3451071S','1HA48671AA7892247','1RT98863CE474094J')
  order by po.created_at desc`;
console.log('ORDERS5', JSON.stringify(orders));
const events = await sql`
  select pe.event_type, pe.processing_state, pe.received_at
  from payment_event pe order by pe.received_at desc limit 6`;
console.log('EVENTS', JSON.stringify(events));
process.exit(0);
