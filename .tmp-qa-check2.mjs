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
  select po.id, po.state, po.amount_cents, po.provider_order_id, po.created_at
  from payment_order po
  order by po.created_at desc limit 15`;
console.log('ORDERS', JSON.stringify(orders));
const events = await sql`
  select pe.event_type, pe.processing_state, pe.received_at
  from payment_event pe order by pe.received_at desc limit 8`;
console.log('EVENTS', JSON.stringify(events));
const fundings = await sql`
  select rf.run_id, rf.funding_cents, rf.verified, rf.provider_event_id
  from run_funding rf order by rf.created_at desc limit 8`;
console.log('FUNDINGS', JSON.stringify(fundings));
process.exit(0);
