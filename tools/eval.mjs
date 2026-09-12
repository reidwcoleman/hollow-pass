// node tools/eval.mjs "js" — evaluate in the loaded game and print the result
import puppeteer from 'puppeteer-core';
const script = process.argv[2];
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', protocolTimeout: 600000,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1440,860', '--autoplay-policy=no-user-gesture-required'], defaultViewport: { width: 1440, height: 860 } });
const page = await browser.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !/404/.test(t)) logs.push('[error] ' + t); });
await page.goto('http://localhost:5190/', { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 180000 });
await page.evaluate(() => window.__game.start());
const out = await page.evaluate(async (script) => { try { return String(await eval(script)); } catch (e) { return 'EVAL ERROR: ' + e.message + '\n' + e.stack; } }, script);
console.log(out); console.log(logs.join('\n'));
await browser.close();
