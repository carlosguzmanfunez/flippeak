import { neon } from '@neondatabase/serverless';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (match && process.env[match[1]] === undefined) {
    process.env[match[1]] = match[2].trim().replace(/^"([\s\S]*)"$/, '$1').replace(/^'([\s\S]*)'$/, '$1');
  }
}
const sql = neon(process.env.DATABASE_URL);
const rows = await sql`
  select c.id as cid, c.title
  from campaign c join "user" u on u.id = c.owner_user_id
  where u.email = 'qa15-1788911108995@flippeak.dev'
    and c.title in ('Lumen Live Radio','Pixel Gauntlet','Atlas Desk','Summit Week','Backstage Live')`;
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto('https://flippeak.vercel.app/login');
await page.getByLabel(/email/i).fill('qa15-1788911108995@flippeak.dev');
await page.getByLabel(/password/i).fill('FlipPeakQA15!');
await page.getByRole('button', { name: /sign in|login/i }).click();
await page.waitForTimeout(1_500);
for (const r of rows) {
  await page.goto(`https://flippeak.vercel.app/campaigns/${r.cid}/runs`);
  await page.waitForLoadState('networkidle');
  const checks = page.getByRole('button', { name: /check payment status/i });
  const n = await checks.count();
  console.log(r.title, '| runs page | check buttons:', n);
  for (let i = 0; i < n; i++) {
    await checks.nth(i).click();
    await page.waitForTimeout(2_500);
    const msg = await page.locator('p, div').filter({ hasText: /captur|falló|error|executed|no puede/i }).first().innerText().catch(() => '');
    console.log('   clicked', i + 1, '|', msg.slice(0, 120));
  }
}
await browser.close();
