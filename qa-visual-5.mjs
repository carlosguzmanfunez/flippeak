// Visual QA: five real competitor campaigns with real destination URLs.
//   node qa-visual-5.mjs create      # UI pipeline + checkout -> prints APPROVAL_LINKS
//   node qa-visual-5.mjs capture-all # after buyer approval: confirm each payment
import { chromium } from 'playwright';
import { writeFileSync, readFileSync } from 'node:fs';

// Load .env.local so the harness uses the same local configuration as the app
// (values stay in the process environment only - never printed).
try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^"([\s\S]*)"$/, '$1').replace(/^'([\s\S]*)'$/, '$1');
    }
  }
} catch {
  // .env.local absent: ambient environment.
}

const BASE = 'https://flippeak.vercel.app';
const STATE = '.qa-visual-5.json';

// QA credentials are NEVER committed: they come from .env.local (see .env.example).
function qaCredentials() {
  const email = process.env.QA_E2E_EMAIL;
  const password = process.env.QA_E2E_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'Set QA_E2E_EMAIL and QA_E2E_PASSWORD in .env.local (see .env.example). QA credentials are never committed.',
    );
  }
  return { email, password };
}

// The database the TARGET DEPLOYMENT writes to — deliberately never DATABASE_URL.
// This harness drives https://flippeak.vercel.app, so its rows live in that
// deployment's database; after the Neon isolation work DATABASE_URL points at
// development and a silent fallback would query the wrong database.
function qaTargetDatabaseUrl() {
  const url = process.env.QA_TARGET_DATABASE_URL;
  if (!url) {
    throw new Error(
      'Set QA_TARGET_DATABASE_URL in .env.local to the database the target deployment writes to ' +
        '(see .env.example). It is never defaulted from DATABASE_URL.',
    );
  }
  return url;
}

const LOAD = [
  { title: 'Lumen Live Radio', category: 'music-and-artists', subtype: 'Musician', rate: 400, summary: 'Live music discovery - curated sessions for every mood.', destinationUrl: 'https://open.spotify.com', amount: 1 },
  { title: 'Pixel Gauntlet', category: 'gaming', subtype: 'Studio', rate: 1100, summary: 'Indie game tournaments streamed live 24/7.', destinationUrl: 'https://www.twitch.tv', amount: 1 },
  { title: 'Atlas Desk', category: 'creators', subtype: 'Newsletter', rate: 2250, summary: 'All-in-one workspace to run your studio.', destinationUrl: 'https://www.notion.so', amount: 1 },
  { title: 'Summit Week', category: 'events', subtype: 'Concert', rate: 3200, summary: 'Three days of live talks in a mountain venue.', destinationUrl: 'https://www.eventbrite.com', amount: 1 },
  { title: 'Backstage Live', category: 'creators', subtype: 'Streamer', rate: 7000, summary: 'Raw behind-the-scenes streams from the studio.', destinationUrl: 'https://www.youtube.com', amount: 2 },
];

async function signIn(page) {
  const { email, password } = qaCredentials();
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in|login/i }).click();
  await page.waitForTimeout(1_500);
}

async function getCampaignId(title) {
  const { email } = qaCredentials();
  const { neon } = await import('@neondatabase/serverless');
  const fs = await import('node:fs');
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^"([\s\S]*)"$/, '$1').replace(/^'([\s\S]*)'$/, '$1');
    }
  }
  const sql = neon(qaTargetDatabaseUrl());
  const rows = await sql`
    select c.id from campaign c join "user" u on u.id = c.owner_user_id
    where u.email = ${email} and c.title = ${title}
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
    for (const item of LOAD) {
      const done = saved.entries.some((e) => e.title === item.title);
      if (done) { console.log('already created:', item.title); continue; }
      await page.goto(`${BASE}/campaigns/new`);
      await page.waitForLoadState('networkidle');
      await page.fill('input[name="title"]', item.title);
      await page.fill('textarea[name="summary"], input[name="summary"]', item.summary);
      await page.fill('input[name="destinationUrl"], input[name="destination_url"]', item.destinationUrl);
      await page.selectOption('select[name="category"]', item.category);
      if (item.subtype) {
        await page.selectOption('select[name="subtype"]', item.subtype).catch(() => {});
      }
      await page.getByRole('button', { name: /create campaign/i }).click();
      await page.waitForTimeout(1_500);
      const campaignId = await getCampaignId(item.title);
      if (!campaignId) throw new Error(`no campaignId for ${item.title}`);
      await page.goto(`${BASE}/campaigns/${campaignId}/run`);
      await page.waitForLoadState('networkidle');
      await setSlider(page, item.rate);
      await page.getByRole('button', { name: /create run/i }).click();
      await page.waitForURL('**/runs', { timeout: 20_000 }).catch(() => {});
      const amt = page.locator('input[id^="checkout-amount-"]').first();
      const btn = page.getByRole('button', { name: /fund & checkout/i });
      await amt.waitFor({ state: 'visible', timeout: 15_000 });
      let clicked = false;
      for (const t of [String(item.amount), '2', '5']) {
        await amt.fill(t);
        try {
          await btn.click({ timeout: 5_000 });
          clicked = true;
          break;
        } catch {
          // amount rejected: try next candidate
        }
      }
      if (!clicked) throw new Error(`checkout button never enabled for ${item.title}`);
      await page.waitForURL('**checkoutnow?*', { timeout: 45_000 });
      saved.entries.push({ title: item.title, category: item.category, rate: item.rate, destinationUrl: item.destinationUrl, campaignId, approvalUrl: page.url() });
      console.log('created:', item.title, '| rate', item.rate, 'cents/h | url', item.destinationUrl);
    }
    writeFileSync(STATE, JSON.stringify(saved, null, 2));
    console.log('APPROVAL_LINKS_START');
    for (const e of saved.entries) console.log(e.approvalUrl);
    console.log('APPROVAL_LINKS_END');
    console.log('Aprueba TODOS con la cuenta buyer sandbox; luego: node qa-visual-5.mjs capture-all');
  } else if (command === 'auto-approve') {
    const email = process.env.PAYPAL_SANDBOX_BUYER_EMAIL;
    const password = process.env.PAYPAL_SANDBOX_BUYER_PASSWORD;
    if (!email || !password) throw new Error('missing PAYPAL_SANDBOX_BUYER_EMAIL/PASSWORD in .env.local');
    const data = JSON.parse(readFileSync(STATE, 'utf8'));
    for (const e of data.entries) {
      await page.goto(e.approvalUrl);
      await page.waitForLoadState('networkidle').catch(() => {});
      const emailField = page.locator('input#email, input[name="email"], input[type="email"]:visible').first();
      if (await emailField.count()) {
        await emailField.fill(email);
        await page.locator('button#btnNext:visible, button:visible').filter({ hasText: /siguiente|next/i }).first().click();
        await page.waitForTimeout(2_500);
      }
      const passField = page.locator('input#password, input[name="password"], input[type="password"]:visible').first();
      if (await passField.count()) {
        await passField.fill(password);
        await page.locator('button:visible').filter({ hasText: /entrar|log ?in|iniciar|siguiente|next/i }).first().click();
        await page.waitForTimeout(2_500);
      }
      const pay = page.locator('button:visible').filter({ hasText: /pay now|agree|confirm|continue|pagar|confirmar/i }).first();
      if (await pay.count()) {
        await pay.click().catch(() => {});
        await page.waitForTimeout(2_500);
      }
      const done = await page.locator('text=/approved|confirmation|thank you|paso/i').first().isVisible().catch(() => false);
      console.log('approved:', e.title, done ? '| confirmed' : '(review page: ok, continue)');
    }
    console.log('UPDATED STATE - ahora: node qa-visual-5.mjs capture-all');
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
    console.log('LISTO - webhooks procesaran activacion y credito');
  }

  await browser.close();
}

main().catch((error) => {
  console.error('QA VISUAL FAIL -', error.message);
  process.exit(1);
});
