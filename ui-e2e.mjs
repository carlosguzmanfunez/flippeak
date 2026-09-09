// FlipPeak UI E2E — Phase 15B (real deployment, real browser).
//   node ui-e2e.mjs flow     # register -> campaign -> run -> checkout (prints APPROVAL_URL)
//   node ui-e2e.mjs resume   # reuses the saved session; runs payment status check
import { chromium } from 'playwright';
import { writeFileSync, readFileSync } from 'node:fs';

const BASE = 'https://flippeak.vercel.app';
const STATE = '.ui-e2e-state.json';

const state = () => {
  try { return JSON.parse(readFileSync(STATE, 'utf8')); } catch { return {}; }
};
const save = (data) => writeFileSync(STATE, JSON.stringify(data, null, 2));

async function resolveCampaignId(email) {
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
    where u.email = ${email} and c.title = 'Live QA Campaign' order by c.created_at desc limit 1`;
  return rows[0]?.id;
}

async function step(page, label, fn) {
  try {
    await fn();
    console.log(`OK  [${label}] ${page.url()}`);
  } catch (error) {
    console.log(`WARN [${label}] ${page.url()} :: ${String(error).slice(0, 160)}`);
    await page.screenshot({ path: `ui-e2e-${label.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.png` });
    throw error;
  }
}

async function main() {
  const command = process.argv[2];
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();

  if (command !== 'flow') {
    // Reuse the saved session (same browser context storage) and drive the
    // REAL UI: runs page -> Check payment status -> capture -> reflect state.
    const saved = JSON.parse(readFileSync('.ui-e2e-storage.json', 'utf8'));
    await browser.close();
    const browser2 = await chromium.launch();
    const context2 = await browser2.newContext({ storageState: saved });
    const page2 = await context2.newPage();
    const st = loadState();
    await page2.goto(`${BASE}/campaigns/${st.campaignId}/runs`);
    await page2.waitForLoadState('networkidle');
    const hasCheck = await page2.getByRole('button', { name: /check payment status/i }).count();
    console.log('UI has payment status control:', hasCheck > 0);
    if (hasCheck > 0) {
      await page2.getByRole('button', { name: /check payment status/i }).first().click();
      await page2.waitForTimeout(3_500);
      const surface = await page2.locator('[data-payment-state]').innerText().catch(() => '(none)');
      console.log('UI PAYMENT STATE:', JSON.stringify(surface));
      await page2.screenshot({ path: 'ui-e2e-resume.png' });
    }
    await page2.goto(`${BASE}/`);
    await page2.waitForLoadState('networkidle');
    const marketText = await page2.locator('main').innerText();
    console.log('MARKET TEXTS SNIPPET:', JSON.stringify(marketText.slice(0, 250)));
    await context2.close();
    await browser2.close();
    return;
  }

  const email = `qa15-${Date.now()}@flippeak.dev`;
  await step(page, 'register', async () => {
    await page.goto(`${BASE}/register`);
    await page.getByLabel(/name/i).fill('QA Driver');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill('FlipPeakQA15!');
    await page.getByRole('button', { name: /create account|sign up/i }).click();
    await page.waitForURL('**/login**', { timeout: 20_000 }).catch(() => {});
    if (!page.url().includes('/login')) {
      await page.screenshot({ path: 'ui-e2e-register-fail.png' });
      throw new Error(`register did not reach login: ${page.url()}`);
    }
  });

  await step(page, 'login-after-register', async () => {
    await page.goto(`${BASE}/login`);
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill('FlipPeakQA15!');
    await page.getByRole('button', { name: /sign in|login/i }).click();
    await page.waitForTimeout(1_500);
    if (page.url().includes('/login')) {
      await page.screenshot({ path: 'ui-e2e-login-fail.png' });
      throw new Error(`login did not complete: ${page.url()}`);
    }
  });

  await step(page, 'campaign-new', async () => {
    await page.goto(`${BASE}/my-campaigns`);
    await page.getByRole('link', { name: /new campaign/i }).first().click();
    await page.waitForLoadState('networkidle');
    await page.fill('input[name="title"]', 'Live QA Campaign');
    await page.fill('textarea[name="summary"], input[name="summary"]', 'End-to-end visual QA campaign');
    await page.fill('input[name="destinationUrl"], input[name="destination_url"]', 'https://example.com');
    await page.selectOption('select[name="category"]', 'gaming');
    await page.selectOption('select[name="subtype"]', 'Indie Game');
    await page.getByRole('button', { name: /create campaign/i }).click();
    await page.waitForTimeout(2_500);
    if (!page.url().includes('/my-campaigns')) {
      await page.screenshot({ path: 'ui-e2e-campaign-form-error.png' });
      const errorText = await page.locator('[role="alert"]').allTextContents().catch(() => ['<no alert>']);
      throw new Error(`campaign create failed; alert: ${errorText.join(' | ')}`);
    }
  });

  // Campaign id resolved from the same database the UI writes: the page
  // revalidation on the client router may lag; the data is authoritative.
  const campaignId = await resolveCampaignId(email);
  await step(page, 'run-new', async () => {
    await page.goto(`${BASE}/campaigns/${campaignId}/run`);
    await page.getByText('Go above $100/hour').click();
    await page.locator('input[inputmode="numeric"]').fill('25');
    await page.getByRole('button', { name: /create run/i }).click();
    await page.waitForURL('**/runs', { timeout: 20_000 }).catch(() => {});
  });

  await step(page, 'checkout', async () => {
    const amount = page.locator('input[id^="checkout-amount-"]').first();
    await amount.fill('10');
    await page.getByRole('button', { name: /fund & checkout/i }).click();
    await page.waitForURL('**checkoutnow?*', { timeout: 45_000 });
  });

  const approvalUrl = page.url();
  await page.context().storageState({ path: '.ui-e2e-storage.json' });
  save({ email, campaignId, approvalUrl, createdAt: new Date().toISOString() });
  console.log('REGISTERED:', email);
  console.log('APPROVAL_URL:', approvalUrl);
  console.log('(Humano: abre con la cuenta buyer sandbox y aprueba; luego: node ui-e2e.mjs resume)');
  await browser.close();
  process.exit(0);
}

main().catch((error) => {
  console.error('UI E2E FAIL -', error.message);
  process.exit(1);
});
