import { test, expect } from '@playwright/test';
test('Studio boots styled, tabs work, widgets persist and diagnostics open', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/index.html');
  await page.waitForFunction(() => window.silkReady === true);
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await expect(page.locator('#bg')).toHaveCSS('position', 'fixed');
  expect(await page.locator('.navbar .mark').evaluate(e => e.getBoundingClientRect().width)).toBeLessThan(80);
  await page.locator('[data-tab="widgets"]').click();
  await expect(page.locator('#widgetScreen')).toBeVisible();
  await page.locator('#widgetPalette button').first().click();
  await expect(page.locator('#widgetSaveState')).toHaveText('Saved');
  const dimensions = await page.locator('#widgetCanvas').evaluate(e => ({ width: e.width, css: e.getBoundingClientRect().width }));
  expect(dimensions.width).toBeGreaterThan(dimensions.css);
  const count = await page.evaluate(() => JSON.parse(localStorage.getItem('silk-engine-mock')).widgets.items.length);
  expect(count).toBe(1);
  await page.reload(); await page.waitForFunction(() => window.silkReady === true);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('silk-engine-mock')).widgets.items.length)).toBe(count);
  await page.locator('[data-tab="system"]').click();
  await page.locator('#showDiagnostics').click();
  await expect(page.locator('#diagnosticsText')).toHaveValue(/"version": "1.0.0"/);
  for (const tab of ['display', 'about', 'library']) { await page.locator(`[data-tab="${tab}"]`).click(); await expect(page.locator('#' + tab)).toBeVisible(); }
  await expect(page.locator('#startupFailure')).toBeHidden();
  expect(errors).toEqual([]);
});
test('UI text cannot be selected by dragging', async ({ page }) => {
  await page.goto('/index.html'); await page.waitForFunction(() => window.silkReady === true);
  const box = await page.locator('#heroName').boundingBox();
  await page.mouse.move(box.x + 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 10 }); await page.mouse.up();
  expect(await page.evaluate(() => getSelection().toString())).toBe('');
});
test('Desktop profile round trip preserves settings, favourites and playlists', async ({page})=>{
  await page.goto('/index.html');await page.waitForFunction(()=>window.silkReady===true);
  await expect(page.locator('.favorite-button')).toHaveCount(0);
  await page.locator('.wcard .gear').first().click();
  await page.locator('#sFavorite').click();
  await expect(page.locator('#sFavorite')).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('Escape');
  await expect(page.locator('#sheet')).toBeHidden();
  await page.locator('[data-tab="desktops"]').click();
  await page.locator('#profileName').fill('Evening desk');await page.locator('#profileSave').click();
  await expect(page.locator('#profileList')).toContainText('Evening desk');
  await page.locator('#playlistItems input').nth(0).check();await page.locator('#playlistItems input').nth(1).check();
  await page.locator('#playlistEnabled').check();await page.locator('#playlistSave').click();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('silk-engine-mock')).playlist.enabled)).toBe(true);
  await page.locator('#profileList button').filter({hasText:/^Apply$/}).click();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('silk-engine-mock')).playlist.enabled)).toBe(false);
  await page.reload();await page.waitForFunction(()=>window.silkReady===true);
  await page.locator('[data-tab="desktops"]').click();await expect(page.locator('#profileList')).toContainText('Evening desk');
});

test('Widget shortcuts work after layer selection and protect text fields',async({page})=>{
 await page.goto('/index.html');await page.waitForFunction(()=>window.silkReady===true);
 await page.keyboard.press('Alt+3');await page.locator('#widgetPalette button').first().click();
 await page.locator('.widget-layer-name').first().click();await page.keyboard.press('Control+d');
 await expect(page.locator('.widget-layer-name')).toHaveCount(2);
 await page.locator('#widgetInspector input[aria-label="Name"]').focus();await page.keyboard.press('Delete');
 await expect(page.locator('.widget-layer-name')).toHaveCount(2);
 await page.locator('.widget-layer-name').first().click();await page.keyboard.press('Delete');
 await expect(page.locator('.widget-layer-name')).toHaveCount(1);await page.keyboard.press('Control+z');
 await expect(page.locator('.widget-layer-name')).toHaveCount(2);
});
test('About has creator attribution, keyboard bird interaction and no glass panels',async({page})=>{
 await page.goto('/index.html');await page.waitForFunction(()=>window.silkReady===true);
 await page.locator('[data-tab="about"]').click();
 // Tab changes fade out and swap pages ~140 ms later; the bird only wakes up once About is the
 // visible page. Wait for that, or on a fast machine focus() hits a still-hidden page and the Enter
 // key goes nowhere (this was the flaky CI failure).
 await expect(page.locator('#about')).toBeVisible();
 await expect(page.locator('.about-creator')).toContainText('Rajveer');
 await expect(page.locator('#about .glass')).toHaveCount(0);
 await page.locator('#aboutBird').focus();await page.keyboard.press('Enter');
 await expect(page.locator('#aboutBird')).toHaveClass(/is-flying/);
 await page.locator('[data-tab="library"]').click();await expect(page.locator('#aboutBird')).not.toHaveClass(/is-flying/);
});



test('Tab changes animate, survive rapid clicking, and are instant with reduced motion',async({page})=>{
 await page.goto('/index.html');await page.waitForFunction(()=>window.silkReady===true);
 await page.evaluate(()=>document.querySelector('[data-tab="display"]').click());
 await expect(page.locator('#display')).toBeVisible();
 for(const t of ['library','widgets','system','about','display','library','system','widgets','about','system'])await page.evaluate(t=>document.querySelector(`[data-tab="${t}"]`).click(),t);
 await page.waitForTimeout(900);
 expect(await page.evaluate(()=>[...document.querySelectorAll('.page')].filter(p=>!p.hidden).map(p=>p.id))).toEqual(['system']);
 await expect(page.locator('.dock-item.active')).toHaveAttribute('data-tab','system');
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.evaluate(()=>document.querySelector('[data-tab="library"]').click());
 expect(await page.evaluate(()=>document.getElementById('system').hidden)).toBe(true);
});

test('Theme sync samples the wallpaper, shows the applied accent, and clears it when turned off',async({page})=>{
 // Motion has its own test; here a live renderer shares one software CPU, so animations would crawl.
 await page.emulateMedia({reducedMotion:'reduce'});
 const renderer=await page.context().newPage();await renderer.goto('/renderer.html');
 await page.goto('/index.html');await page.waitForFunction(()=>window.silkReady===true);
 await page.locator('[data-tab="system"]').click();
 await page.locator('#systemGroups .row[data-key="themeSync"] input').click();
 await expect(page.locator('.accent-chip')).toContainText(/Current accent #[0-9A-F]{6}/,{timeout:8000});
 expect(await page.evaluate(()=>localStorage.getItem('silk-engine-accent'))).toMatch(/^#[0-9a-f]{6}$/);
 // Turning sync off doesn't involve the renderer; close it so two software-rendered pages don't share one CPU.
 await renderer.close();
 await page.locator('#systemGroups .row[data-key="themeSync"] input').click();
 await expect(page.locator('.accent-chip')).toHaveCount(0);
});

test('Cinematic hero: clean title card, transport controls, single-screen layout, stable controls',async({page})=>{
 await page.goto('/index.html');await page.waitForFunction(()=>window.silkReady===true);
 await expect(page.locator('#heroName')).toHaveText('Living Silk');
 await expect(page.locator('#heroTarget')).toContainText(/Now playing/i);
 await expect(page.locator('#heroSub')).toContainText('Rendered live');
 expect(await page.evaluate(()=>document.getElementById('displaysBlock').hidden)).toBe(true); // one screen: no duplicate preview
 await page.locator('#heroNext').click();
 await expect(page.locator('#heroName')).not.toHaveText('Living Silk');
 await page.locator('#heroPrev').click();
 await expect(page.locator('#heroName')).toHaveText('Living Silk');
 await page.locator('#heroPause').click();
 await expect(page.locator('#heroPause')).toHaveAttribute('aria-label','Resume wallpaper');
 await expect(page.locator('#heroTarget')).toContainText(/Paused/i);
 await page.locator('#heroPause').click();
 // the dissolve mask must cover only the picture, never the title or controls
 expect(await page.evaluate(()=>{const m=e=>getComputedStyle(e).maskImage||getComputedStyle(e).webkitMaskImage;return [m(document.getElementById('hero')),m(document.querySelector('.cine-copy'))];})).toEqual(['none','none']);
 expect(await page.evaluate(()=>getComputedStyle(document.querySelector('.cine-media')).webkitMaskImage)).toContain('gradient');
 // the eagle toggle is confined to the bird's area, not the whole frame
 const [hero,toggle,title]=await Promise.all(['#hero','#heroToggle','#heroName'].map(s=>page.locator(s).boundingBox()));
 expect(toggle.width).toBeLessThan(hero.width*0.5);
 expect(toggle.x).toBeGreaterThan(title.x+title.width*0.5);
});

test('Cinematic hero shows the Displays block only with more than one screen',async({page})=>{
 await page.goto('/index.html?monitors=2');await page.waitForFunction(()=>window.silkReady===true);
 expect(await page.evaluate(()=>document.getElementById('displaysBlock').hidden)).toBe(false);
 await expect(page.locator('#map .mon')).toHaveCount(2);
});
