import { test, expect } from '@playwright/test';
async function start(page) {
  await page.addInitScript(() => {
    window.__searchCalls = []; window.__searchEvents = new Map();
    window.__TAURI__ = {
      event: { listen: async (event, cb) => { __searchEvents.set(event, cb); return () => __searchEvents.delete(event); } },
      core: { invoke: async (name, args) => {
        __searchCalls.push({ name, args });
        if (name === 'get_surface_accent') return '#883344';
        if (name === 'circle_search_ready') return { session: 42 };
        if (name === 'circle_search_frame') {
          const c = document.createElement('canvas'); c.width = 1200; c.height = 800;
          const x = c.getContext('2d'); x.fillStyle = '#f00000'; x.fillRect(0, 0, 1200, 800);
          return (await new Promise(r => c.toBlob(r, 'image/png'))).arrayBuffer();
        }
      } },
    };
  });
  await page.goto('/search.html'); await expect(page.locator('body')).toHaveAttribute('data-state', 'ready');
}
async function draw(page) {
  await page.mouse.move(200, 220); await page.mouse.down();
  await page.mouse.move(450, 220, { steps: 10 }); await page.mouse.move(200, 470, { steps: 10 });
  await page.mouse.move(200, 220, { steps: 10 }); await page.mouse.up();
}
test('tracing does not upload until Search, and the polygon excludes pixels outside the outline', async ({ page }) => {
  await start(page); await draw(page);
  expect(await page.evaluate(() => __searchCalls.filter(x => x.name === 'circle_search_submit').length)).toBe(0);
  await page.locator('#search').click();
  await expect.poll(() => page.evaluate(() => __searchCalls.filter(x => x.name === 'circle_search_submit').length)).toBe(1);
  const result = await page.evaluate(async () => {
    const call = __searchCalls.find(x => x.name === 'circle_search_submit'); const img = new Image(); img.src = `data:image/png;base64,${call.args.png}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const inside = [...x.getImageData(15, 15, 1, 1).data]; const outside = [...x.getImageData(c.width - 15, c.height - 15, 1, 1).data];
    return { session: call.args.session, inside, outside, width: c.width, height: c.height };
  });
  expect(result.session).toBe(42); expect(result.inside[3]).toBe(255); expect(result.outside[3]).toBe(0); expect(result.width).toBeLessThan(1200); expect(result.height).toBeLessThan(800);
});
test('Esc cancels without uploading and a tiny stroke cannot be searched', async ({ page }) => {
  await start(page); await page.mouse.move(200, 230); await page.mouse.click(200, 230);
  await expect(page.locator('#search')).toBeDisabled(); await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => __searchCalls.some(x => x.name === 'circle_search_cancel'))).toBe(true);
  expect(await page.evaluate(() => __searchCalls.some(x => x.name === 'circle_search_submit'))).toBe(false);
});
test('the overlay follows the applied taskbar accent and still provides Redraw', async ({ page }) => {
  await start(page); await draw(page); await expect(page.locator('#redraw')).toBeVisible();
  await page.evaluate(() => __searchEvents.get('accent-applied')({ payload: '#226644' }));
  await expect(page.locator('html')).toHaveCSS('--accent', '#226644');
  await page.locator('#redraw').click(); await expect(page.locator('#search')).toBeDisabled();
});

test('capture toolbar keeps both pills and the Esc hint centered', async ({ page }) => {
  await start(page);
  const geometry = await page.locator('#toolbar').evaluate(el => {
    const panel = el.getBoundingClientRect(), buttons = [...el.querySelectorAll('button')].map(b => b.getBoundingClientRect());
    return { middle: panel.left + panel.width/2, viewport: innerWidth, panelWidth: panel.width, heights: buttons.map(b => b.height), within: buttons.every(b => b.left >= panel.left && b.right <= panel.right) };
  });
  expect(Math.abs(geometry.middle - geometry.viewport/2)).toBeLessThan(1);
  expect(geometry.panelWidth).toBeLessThanOrEqual(300); expect(geometry.heights).toEqual([40,40]); expect(geometry.within).toBe(true);
});
