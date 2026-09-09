// Runtime timer evidence: sample the projected runtime cell over 25 seconds.
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto('https://flippeak.vercel.app/');
await page.waitForLoadState('networkidle');

const first = page.locator('[data-runtime-projected]').first();
if ((await first.count()) === 0) {
  console.log('NO_RUNTIME_ROWS (market empty at this instant)');
} else {
  const s1 = await first.innerText();
  console.log('T0     :', s1);
  await new Promise((r) => setTimeout(r, 10_000));
  const s2 = await first.innerText();
  console.log('T+10s  :', s2);
  await new Promise((r) => setTimeout(r, 10_000));
  const s3 = await first.innerText();
  console.log('T+20s  :', s3);
}
// Also confirm the Time Rate render (must be 'X.00/h', never /hour/h)
const rateText = await page.locator('.fp-figure.font-bold.text-navy').first().innerText().catch(() => '');
console.log('RATE   :', rateText);
await browser.close();
