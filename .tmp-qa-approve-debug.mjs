import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (match && process.env[match[1]] === undefined) {
    process.env[match[1]] = match[2].trim().replace(/^"([\s\S]*)"$/, '$1').replace(/^'([\s\S]*)'$/, '$1');
  }
}
const email = process.env.PAYPAL_SANDBOX_BUYER_EMAIL;
const password = process.env.PAYPAL_SANDBOX_BUYER_PASSWORD;
const TOKENS = [
  '8M9159130U394131F',
  '64L73233PY605081U',
  '68P10136M3451071S',
  '1HA48671AA7892247',
  '1RT98863CE474094J',
];
const url = `https://www.sandbox.paypal.com/checkoutnow?token=${TOKENS[0]}`;

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto(url);
await page.waitForLoadState('networkidle').catch(() => {});
console.log('URL1:', page.url().slice(0, 90));
await page.screenshot({ path: 'shots/debug-pp-1.png' });
const emailField = page.locator('input#email, input[name="email"], input[type="email"]').first();
console.log('email count:', await emailField.count());
if (await emailField.count()) {
  await emailField.fill(email);
  await page.screenshot({ path: 'shots/debug-pp-2.png' });
  const btn = page.locator('button:visible').filter({ hasText: /siguiente|next/i }).first();
  console.log('next btn count:', await btn.count(), 'text:', (await btn.textContent().catch(() => '')));
  await btn.click();
  await page.waitForTimeout(3_000);
  await page.screenshot({ path: 'shots/debug-pp-3.png' });
  console.log('URL2:', page.url().slice(0, 90));
}
const passField = page.locator('input#password, input[name="password"], input[type="password"]').first();
console.log('pass count:', await passField.count());
if (await passField.count()) {
  await passField.fill(password);
  await page.screenshot({ path: 'shots/debug-pp-4.png' });
  const login = page.locator('button:visible').filter({ hasText: /^log ?in$|^entrar$|iniciar|continue/i }).first();
  console.log('login btn count:', await login.count(), 'text:', (await login.textContent().catch(() => '')));
  await login.click();
  await page.waitForTimeout(3_000);
  await page.screenshot({ path: 'shots/debug-pp-5.png' });
  console.log('URL3:', page.url().slice(0, 120));
}
const body = await page.locator('body').innerText().catch(() => '');
console.log('BODY HEAD:', body.slice(0, 300).replace(/\n+/g, ' /n '));
await page.screenshot({ path: 'shots/debug-pp-6.png' });
await browser.close();
