// Renderer lifecycle stress test: rapid wallpaper switching, hibernate/wake and display-setting
// churn. Fails (exit 1) if GPU allocations, animation loops or DOM decoders accumulate.
//   SILK_BROWSER_PATH=... node scripts/stress-renderer.mjs
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const server = spawn(process.execPath, ['scripts/preview-server.mjs'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));
const browser = await chromium.launch({ executablePath: process.env.SILK_BROWSER_PATH || undefined, args: ['--enable-unsafe-swiftshader'] });
let failed = false;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failed = true; };
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:5173/renderer.html');
  await page.waitForFunction(() => window.__echelon && window.__echelon.groups.size > 0, null, { timeout: 20000 });
  await page.waitForTimeout(800);
  const snap = () => page.evaluate(() => ({ gpu: window.__echelon.gpuBytes, groups: window.__echelon.groups.size, videos: document.querySelectorAll('video').length, frames: document.querySelectorAll('iframe').length }));
  const loops = () => page.evaluate(() => new Promise(r => { let n = 0; const orig = window.requestAnimationFrame; let calls = 0; window.requestAnimationFrame = f => { calls++; return orig(f); }; setTimeout(() => { window.requestAnimationFrame = orig; r(calls); }, 1000); }));
  const base = await snap();
  const baseLoops = await loops();
  const scenes = ['builtin-silk', 'builtin-fluid', 'builtin-lissajous', 'builtin-particles', 'builtin-terrain', 'builtin-life'];
  await page.evaluate(async list => {
    const { bridge } = await import('/shared/bridge.js');
    for (let i = 0; i < 48; i++) { await bridge.invoke('assign', { monitor: '*', itemId: list[i % list.length] }); await new Promise(r => setTimeout(r, 40)); }
    await bridge.invoke('assign', { monitor: '*', itemId: list[0] });
    for (let i = 0; i < 30; i++) { await bridge.invoke('set_display', { patch: { oled: i % 2 === 0, brightness: 60 + i } }); }
    await bridge.invoke('set_display', { patch: { oled: false, brightness: 100 } });
  }, scenes);
  await page.waitForTimeout(1500);
  const afterSwitch = await snap();
  check(afterSwitch.groups === base.groups, `scene instances after 48 switches: ${afterSwitch.groups} (baseline ${base.groups})`);
  check(afterSwitch.gpu <= base.gpu * 1.05 + 1024, `GPU allocations after switching: ${(afterSwitch.gpu / 1048576).toFixed(2)} MB (baseline ${(base.gpu / 1048576).toFixed(2)} MB)`);
  check(afterSwitch.videos === 0 && afterSwitch.frames === 0, `no orphaned decoders/iframes (${afterSwitch.videos} video, ${afterSwitch.frames} iframe)`);
  const afterLoops = await loops();
  check(afterLoops <= Math.max(baseLoops, 1) * 1.5 + 2, `animation-frame requests per second: ${afterLoops} (baseline ${baseLoops}) — no duplicate loops`);
  // hibernate / wake cycles
  for (let i = 0; i < 6; i++) {
    await page.evaluate(async on => { const { bridge } = await import('/shared/bridge.js'); const ch = new BroadcastChannel('silk-engine'); ch.postMessage({ evt: 'visibility', payload: { covered: on ? ['mock1'] : [], onBattery: false, hibernating: on } }); }, i % 2 === 0);
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(800);
  const afterWake = await snap();
  check(afterWake.groups === base.groups && afterWake.gpu <= base.gpu * 1.05 + 1024, `after 3 hibernate/wake cycles: ${afterWake.groups} scenes, ${(afterWake.gpu / 1048576).toFixed(2)} MB`);
  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
} finally { await browser.close(); server.kill(); }
process.exit(failed ? 1 : 0);
