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

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
for (const token of TOKENS) {
  await page.goto(`https://www.sandbox.paypal.com/checkoutnow?token=${token}`);
  await page.waitForLoadState('networkidle').catch(() => {});
  const emailField = page.locator('input#email, input[name="email"], input[type="email"], input[name="login_email"]').first();
  if (await emailField.count()) {
    await emailField.fill(email);
    const passField = page.locator('input#password, input[name="password"], input[type="password"], input[name="login_password"]').first();
    if (await passField.count()) await passField.fill(password);
    const login = page.locator('button:visible').filter({ hasText: /iniciar sesi|log ?in|^entrar$/i }).first();
    await login.click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2_000);
  }
  const pay = page.locator('button:visible').filter({ hasText: /pagar ahora|pay now|agreed|de acuerdo|continuar/i }).first();
  if (await pay.count()) {
    await pay.click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2_000);
  }
  const body = await page.locator('body').innerText().catch(() => '');
  console.log(token, '|', page.url().slice(0, 100).replace('https://www.sandbox.paypal.com', 'PP'), '|', body.slice(0, 80).replace(/\n+/g, ' /n '));
}
await browser.close();
