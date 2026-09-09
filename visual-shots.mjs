// Baseline visual shots (390/768/1440): public surfaces of the deployed app.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'https://flippeak.vercel.app';
mkdirSync('shots', { recursive: true });
const browser = await chromium.launch();

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

for (const vp of VIEWPORTS) {
  const page = await (await browser.newContext({ viewport: { width: vp.width, height: vp.height } })).newPage();
  for (const path of ['/', '/login', '/register']) {
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `shots/${vp.name}-${path.replace(/\//g, '_')}.png`, fullPage: true });
  }
  await (await page.context()).close();
}

console.log('BASELINE SHOTS DONE');
await browser.close();
