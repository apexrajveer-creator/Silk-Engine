// Reproducible Studio UI benchmark.
//
//   npm run bench:ui                     # 1x and 2x display scaling
//   SILK_BROWSER_PATH=... npm run bench:ui
//
// Measures, per display scale:
//   idleFps        frames the page can present per second while idle (background animating)
//   scroll         frame-interval percentiles (ms) during a scripted wheel scroll
//   tabSwitchMs    click on a dock tab -> destination page visible and painted
//   longTasks      main-thread tasks > 50 ms during the run
//   layouts/styles layout and style recalculations during the scroll
//   heapMB, nodes  JS heap and DOM size after the run
//
// This runs in headless Chromium. Without a GPU, Chromium rasterises and composites in
// software, so absolute numbers are a pessimistic proxy for a weak integrated GPU, not a
// measurement of any real Windows machine. Compare runs only on the same machine/config.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const PORT = 5173, URL = `http://127.0.0.1:${PORT}/index.html`;
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))].toFixed(1); };

const server = spawn(process.execPath, ['scripts/preview-server.mjs'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));
const browser = await chromium.launch({ executablePath: process.env.SILK_BROWSER_PATH || undefined, args: ['--enable-unsafe-swiftshader'] });
const results = [];
try {
  for (const scale of (process.env.SILK_BENCH_SCALES || '1,2').split(',').map(Number)) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: scale });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    await page.addInitScript(() => {
      window.__long = 0;
      new PerformanceObserver(l => { window.__long += l.getEntries().length; }).observe({ type: 'longtask', buffered: true });
    });
    await page.goto(URL);
    await page.waitForFunction(() => window.silkReady === true, null, { timeout: 30000 });
    await page.waitForTimeout(1500);

    const idleFps = await page.evaluate(() => new Promise(r => { let n = 0; const s = performance.now(); const f = () => { n++; if (performance.now() - s < 2000) requestAnimationFrame(f); else r(+(n / 2).toFixed(1)); }; requestAnimationFrame(f); }));

    const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    const before = await metric();
    await page.mouse.move(640, 500);
    const frames = page.evaluate(() => new Promise(r => { const out = []; let last = performance.now(); const s = last; const f = t => { out.push(t - last); last = t; if (t - s < 2200) requestAnimationFrame(f); else r(out.slice(1)); }; requestAnimationFrame(f); }));
    for (let i = 0; i < 24; i++) { await page.mouse.wheel(0, i < 12 ? 120 : -120); await page.waitForTimeout(16); }
    const intervals = await frames;
    const after = await metric();

    // tab switch: click -> destination visible -> one painted frame
    const tabSwitchMs = [];
    for (const tab of ['display', 'library', 'widgets', 'library']) {
      const t0 = await page.evaluate(() => performance.now());
      await page.evaluate(t => document.querySelector(`[data-tab="${t}"]`).click(), tab);
      const done = await page.evaluate(t => new Promise(r => { const check = () => { const p = document.getElementById(t); if (p && !p.hidden && getComputedStyle(p).visibility !== 'hidden') requestAnimationFrame(() => r(performance.now())); else requestAnimationFrame(check); }; check(); }), tab);
      tabSwitchMs.push(+(done - t0).toFixed(1));
    }

    const end = await metric();
    results.push({
      scale, idleFps,
      scroll: { frames: intervals.length, p50: pct(intervals, 50), p95: pct(intervals, 95), p99: pct(intervals, 99), over33ms: intervals.filter(x => x > 33.4).length },
      tabSwitchMs, tabSwitchMedian: pct(tabSwitchMs, 50),
      longTasks: await page.evaluate(() => window.__long),
      layouts: after.LayoutCount - before.LayoutCount, styles: after.RecalcStyleCount - before.RecalcStyleCount,
      heapMB: +(end.JSHeapUsedSize / 1048576).toFixed(1), nodes: end.Nodes,
    });
    await page.close();
  }
} finally { await browser.close(); server.kill(); }
console.log(JSON.stringify({ chromium: browser.version(), note: 'software-rendered headless proxy; not a real-hardware measurement', results }, null, 2));
