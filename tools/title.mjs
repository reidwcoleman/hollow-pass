import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1440,860'], defaultViewport: { width: 1440, height: 860 } });
const page = await browser.newPage();
await page.goto('http://localhost:5190/', { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 180000 });
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: 'shots/title.jpg', type: 'jpeg', quality: 88 });
await browser.close();
