import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (match && process.env[match[1]] === undefined) {
    process.env[match[1]] = match[2].trim().replace(/^"([\s\S]*)"$/, '$1').replace(/^'([\s\S]*)'$/, '$1');
  }
}
const sql = neon(process.env.DATABASE_URL);
const rows = await sql`
  select c.title, c.category, c.destination_url, c.subtype
  from campaign c
  where c.title in ('Lumen Live Radio','Pixel Gauntlet','Atlas Desk','Summit Week','Backstage Live')
  order by c.created_at desc`;
console.log(JSON.stringify(rows));
process.exit(0);
