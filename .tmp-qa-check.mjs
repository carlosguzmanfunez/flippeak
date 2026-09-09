import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (match && process.env[match[1]] === undefined) {
    process.env[match[1]] = match[2].trim().replace(/^"([\s\S]*)"$/, '$1').replace(/^'([\s\S]*)'$/, '$1');
  }
}
const u = process.env.DATABASE_URL;
try {
  const p = new URL(u);
  console.log('parse-ok', p.protocol, p.hostname.length);
} catch (err) {
  console.log('parse-fail', err.message);
}
const sql = neon(u);
const rows = await sql`
  select c.title, r.status, r.time_rate_cents_per_hour as rate, r.credited_cents, r.created_at
  from campaign_run r join campaign c on c.id = r.campaign_id
  where c.title in ('Lumen Live Radio','Pixel Gauntlet','Atlas Desk','Summit Week','Backstage Live')
  order by rate desc`;
console.log(JSON.stringify(rows, (k, v) => (typeof v === 'bigint' ? v.toString() : v)));
process.exit(0);
