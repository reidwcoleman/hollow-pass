// Headless screenshot harness: node tools/shot.mjs name1 "js1" name2 "js2" ...
import puppeteer from 'puppeteer-core';
const args = process.argv.slice(2);
const pairs = []; for (let i = 0; i < args.length; i += 2) pairs.push([args[i], args[i + 1] || '']);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1440,860', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'],
  defaultViewport: { width: 1440, height: 860, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => { const t = m.text(); if (!/nominal range/.test(t)) logs.push(`[${m.type()}] ${t}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto('http://localhost:5190/', { waitUntil: 'load' });
try { await page.waitForFunction('window.__ready === true', { timeout: 180000 }); } catch (e) { logs.push('[harness] not ready in time'); }
console.log('ready in ms:', Date.now() - t0);
await page.evaluate(() => window.__game.start());
for (const [name, script] of pairs) {
  const t1 = Date.now();
  const out = await page.evaluate(async (script) => { try { return String(await eval(script)); } catch (e) { return 'EVAL ERROR: ' + e.message + '\n' + e.stack; } }, script);
  await page.evaluate(() => window.__pump(2));
  await page.screenshot({ path: `shots/${name}.jpg`, type: 'jpeg', quality: 88 });
  console.log(`${name}: ${out} (${Date.now() - t1} ms)`);
}
const stats = await page.evaluate(() => { const g = window.__game; const t0 = performance.now(); window.__pump(30); return { msPerFrame: ((performance.now() - t0) / 30).toFixed(1), calls: g.fx.renderer.info.render.calls, tris: g.fx.renderer.info.render.triangles, trees: g.world.treeCount, sections: g.world.sections.map((s) => `${s.name}@${Math.round(s.s)}`).join(', '), len: Math.round(g.world.road.length), feat: JSON.stringify(g.world.terrain.features) }; });
console.log(JSON.stringify(stats));
console.log(logs.slice(0, 30).join('\n'));
await browser.close();
