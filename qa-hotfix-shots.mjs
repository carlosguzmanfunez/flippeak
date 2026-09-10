// Visual QA hotfix evidence: Live Market at the three verification resolutions.
//   node qa-hotfix-shots.mjs before|after
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const token = process.argv[2] === 'after' ? 'after' : 'before';
const VIEWPORTS = [
  [1440, 900],
  [1366, 768],
  [1024, 768],
];

mkdirSync('shots/hotfix', { recursive: true });
const browser = await chromium.launch();
for (const [w, h] of VIEWPORTS) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
  await page.goto('https://flippeak.vercel.app/');
  await page.waitForLoadState('networkidle');
  await page.locator('[data-surface="market"]').screenshot({ path: `shots/hotfix/${token}-${w}x${h}.png` });
  const rows = await page.locator('[data-tier-rank]').count();
  console.log(token, `${w}x${h}`, 'rows:', rows);
  await page.close();
}
await browser.close();
