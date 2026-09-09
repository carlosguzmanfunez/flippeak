// QA ladder: six real campaigns/runs with full marketplace structure.
//   node qa-ladder.mjs create      # 6 campaigns + runs + checkout -> prints APPROVAL_LINKS
//   node qa-ladder.mjs capture-all # after approvals: click check payment status on each
import { chromium } from 'playwright';
import { writeFileSync, readFileSync } from 'node:fs';

const BASE = 'https://flippeak.vercel.app';
const STATE = '.qa-ladder.json';

const LOAD = [
  ['Alpha Peak', 'gaming', 'Indie Game', 4_500],
  ['Bravo Studio', 'creators', 'Video Creator', 1_800],
  ['Charlie Fest', 'events', 'Concert', 8_000],
  ['Delta Waves', 'music-and-artists', 'Musician', 1_200],
  ['Echo Arena', 'gaming', 'Studio', 3_000],
  ['Foxtrot Forge', 'gaming', 'Studio', 4_500], // same rate as Alpha: tie #1
];

async function signIn(page) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/email/i).fill('qa15-1788911108995@flippeak.dev');
  await page.getByLabel(/password/i).fill('FlipPeakQA15!');
  await page.getByRole('button', { name: /sign in|login/i }).click();
  await page.waitForTimeout(1_500);
}

async function getCampaignId(title) {
  const { neon } = await import('@neondatabase/serverless');
  const fs = await import('node:fs');
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^"([\s\S]*)"$/, '$1').replace(/^'([\s\S]*)'$/, '$1');
    }
  }
  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql`
    select c.id from campaign c join "user" u on u.id = c.owner_user_id
    where u.email = 'qa15-1788911108995@flippeak.dev' and c.title = ${title}
    order by c.created_at desc limit 1`;
  return rows[0]?.id;
}

async function setSlider(page, cents) {
  await page.locator('input[type="range"]').first().evaluate((el, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, cents);
}

async function main() {
  const command = process.argv[2];
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await signIn(page);
  let current = [];
  try {
    current = JSON.parse(readFileSync(STATE, 'utf8')).entries ?? [];
  } catch {
    current = [];
  }
  const saved = { entries: current };

  if (command === 'create') {
    for (const [title, category, subtype, rate] of LOAD) {
      await page.goto(`${BASE}/campaigns/new`);
      await page.waitForLoadState('networkidle');
      await page.fill('input[name="title"]', title);
      await page.fill('textarea[name="summary"], input[name="summary"]', `Ladder QA - ${title}`);
      await page.fill('input[name="destinationUrl"], input[name="destination_url"]', 'https://example.com');
      await page.selectOption('select[name="category"]', category);
      await page.selectOption('select[name="subtype"]', subtype);
      await page.getByRole('button', { name: /create campaign/i }).click();
      await page.waitForTimeout(1_500);
      const campaignId = await getCampaignId(title);
      if (!campaignId) throw new Error(`no campaignId for ${title}`);
      await page.goto(`${BASE}/campaigns/${campaignId}/run`);
      await page.waitForLoadState('networkidle');
      await setSlider(page, rate);
      await page.getByRole('button', { name: /create run/i }).click();
      await page.waitForURL('**/runs', { timeout: 20_000 }).catch(() => {});
      const amt = page.locator('input[id^="checkout-amount-"]').first();
      await amt.fill('5');
      await page.getByRole('button', { name: /fund & checkout/i }).click();
      await page.waitForURL('**checkoutnow?*', { timeout: 45_000 });
      saved.entries.push({ title, campaignId, rate, approvalUrl: page.url() });
      console.log('created:', title, '|', rate, 'cents/h');
    }
    writeFileSync(STATE, JSON.stringify(saved, null, 2));
    console.log('APPROVAL_LINKS_START');
    for (const e of saved.entries) console.log(e.approvalUrl);
    console.log('APPROVAL_LINKS_END');
    console.log('Aprueba TODOS con la cuenta buyer sandbox; luego: node qa-ladder.mjs capture-all');
  } else if (command === 'capture-all') {
    const data = JSON.parse(readFileSync(STATE, 'utf8'));
    await writeFileSync(STATE, '');
    for (const e of data.entries) {
      await page.goto(`${BASE}/campaigns/${e.campaignId}/runs`);
      await page.waitForLoadState('networkidle');
      const check = page.getByRole('button', { name: /check payment status/i }).first();
      if ((await check.count()) === 0) { console.log('no payment for', e.title); continue; }
      await check.click();
      await page.waitForTimeout(2_500);
      console.log('captured:', e.title);
    }
    console.log('LISTO — esperar webhooks y verificar mercado');
  }

  await browser.close();
}

main().catch((error) => {
  console.error('QA LADDER FAIL -', error.message);
  process.exit(1);
});
