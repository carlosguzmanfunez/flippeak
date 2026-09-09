// Visual QA shots — public + authed pages, 5 viewports.
import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';

const BASE = 'https://flippeak.vercel.app';
mkdirSync('shots', { recursive: true });
const browser = await chromium.launch();

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1366, height: 768 },
  { name: 'tablet-l', width: 1024, height: 768 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];

function contextWith(viewports) {
  return browser.newContext({ viewport: { width: viewports.width, height: viewports.height } });
}

// Public
for (const vp of VIEWPORTS) {
  const ctx = await contextWith(vp);
  const page = await ctx.newPage();
  for (const path of ['/', '/login', '/register']) {
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `shots/${vp.name}-${path.replace(/\//g, '_')}.png`, fullPage: true });
  }
  await ctx.close();
}

// Authed (QA session saved by ui-e2e)
const storagePath = '.ui-e2e-storage.json';
if (existsSync(storagePath)) {
  const saved = JSON.parse(await (await import('node:fs')).promises.readFile(storagePath, 'utf8'));
  for (const vp of [VIEWPORTS[0], VIEWPORTS[4]]) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      storageState: saved,
    });
    const page = await ctx.newPage();
    for (const path of ['/my-campaigns', '/account', '/campaigns/new']) {
      await page.goto(`${BASE}${path}`);
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `shots/authed-${vp.name}-${path.replace(/\//g, '_')}.png`, fullPage: true });
    }
    await ctx.close();
  }
} else {
  console.log('no saved session; authed shots skipped');
}

console.log('VISUAL SHOTS DONE');
await browser.close();
