import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto('https://flippeak.vercel.app/');
await page.waitForLoadState('networkidle');
const marketText = await page.locator('[data-surface="market"]').innerText();
const m = marketText.match(/â€|â€™|â€œ|â€˜|Ã|�/);
console.log('MOJIBAKE IN RENDER:', m ? 'FOUND! idx ' + m.index + ' ctx [' + marketText.slice(Math.max(0, m.index - 30), m.index + 30).replace(/\n/g, ' /n') + ']' : 'NONE');
const sample = await page.locator('[data-runtime-projected]').first().innerText().catch(() => '(no runtime)');
console.log('FIRST ROW RUNTIME:', sample);
// find any visible row text
const row = await page.locator('ol li').first().innerText().catch(() => '(no row)');
console.log('FIRST ROW TEXT:', JSON.stringify(row.slice(0, 160)));
await page.screenshot({ path: 'shots/desktop-_.png', fullPage: true });
console.log('SCREENSHOT: shots/desktop-_.png');
await browser.close();
