import { test, expect } from '@playwright/test';
import { ACTIONS } from '../../src/shared/hotkeys.js';
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
  await expect(page.locator('#diagnosticsText')).toHaveValue(/"version": "1.5.0"/);
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

test('Hotkeys: record, refuse unsafe and duplicate shortcuts, flag one another app owns, clear, switch off and reset', async ({ page }) => {
  await page.goto('/index.html'); await page.waitForFunction(() => window.silkReady === true);
  await page.locator('[data-tab="system"]').click();
  await expect(page.locator('#system')).toBeVisible();   // tab changes fade out and swap, so wait for the page itself
  const row = id => page.locator(`.hk-row[data-id="${id}"]`);
  const press = async (mods, key) => { for (const m of mods) await page.keyboard.down(m); await page.keyboard.press(key); for (const m of [...mods].reverse()) await page.keyboard.up(m); };
  await expect(page.locator('.hk-row')).toHaveCount(ACTIONS.length);   // one row per action in the shared table, however many there are
  await expect(row('next').locator('kbd')).toHaveText(['Ctrl', 'Alt', 'Shift', '→']);
  await expect(row('profile1').locator('.hk-none')).toBeVisible();

  // record a shortcut; the preview pretends another app already owns Ctrl+Alt+Shift+F12
  await row('next').getByRole('button', { name: 'Change shortcut for Next wallpaper' }).click();
  await expect(row('next')).toHaveClass(/capturing/);
  await press(['Control', 'Alt', 'Shift'], 'F12');
  await expect(row('next').locator('kbd')).toHaveText(['Ctrl', 'Alt', 'Shift', 'F12']);
  await expect(row('next')).toHaveAttribute('data-status', 'inUse');
  await expect(page.locator('#hotkeysNote')).toContainText('in use by another app');

  // one modifier is refused and recording carries on; a duplicate names the other action
  await row('prev').getByRole('button', { name: 'Change shortcut for Previous wallpaper' }).click();
  await press(['Control'], 'KeyC');
  await expect(row('prev').locator('small')).toContainText('at least two');
  await expect(row('prev')).toHaveClass(/capturing/);
  await press(['Control', 'Alt', 'Shift'], 'KeyN');
  await expect(row('prev').locator('small')).toContainText('Random wallpaper');
  await page.keyboard.press('Escape');                   // cancel keeps the old shortcut
  await expect(row('prev')).not.toHaveClass(/capturing/);
  await expect(row('prev').locator('kbd')).toHaveText(['Ctrl', 'Alt', 'Shift', '←']);

  // clear, switch everything off, then reset
  await row('prev').getByRole('button', { name: 'Clear shortcut for Previous wallpaper' }).click();
  await expect(row('prev').locator('.hk-none')).toBeVisible();
  await page.locator('#hotkeysEnabled').click();
  await expect(row('pause')).toHaveAttribute('data-status', 'disabled');
  await page.locator('#hotkeysEnabled').click();
  await page.locator('#hotkeysReset').click();
  await expect(row('prev').locator('kbd')).toHaveText(['Ctrl', 'Alt', 'Shift', '←']);
  await expect(row('next').locator('kbd')).toHaveText(['Ctrl', 'Alt', 'Shift', '→']);
  await expect(row('next')).toHaveAttribute('data-status', 'active');
});

test('The six built-in wallpapers share one row, with Spectral Terrain and Cell Garden playable', async ({ page }) => {
  await page.goto('/index.html'); await page.waitForFunction(() => window.silkReady === true);
  const cards = page.locator('#scenes .wcard');
  await expect(cards).toHaveCount(6);
  await expect(cards.nth(4)).toContainText('Spectral Terrain');
  await expect(cards.nth(5)).toContainText('Cell Garden');
  // offsetTop is layout position: the cards' entrance animation moves them on screen for a moment, which would not mean a second row
  const tops = await cards.evaluateAll(els => els.map(e => e.offsetTop));
  expect(new Set(tops).size, 'all six cards on one row').toBe(1);
  // no built-in name is cut off (long names wrap onto a second line instead)
  expect(await page.locator('#scenes .wcard .meta b').evaluateAll(els => els.filter(b => b.scrollHeight > b.clientHeight + 1).length)).toBe(0);
  await cards.nth(5).click();
  await expect(page.locator('#heroName')).toHaveText('Cell Garden');
  await expect(page.locator('#heroSub')).toContainText('Rendered live');
  await page.locator('#heroPrev').click();
  await expect(page.locator('#heroName')).toHaveText('Spectral Terrain');
  await page.locator('#heroPrev').click();
  await expect(page.locator('#heroName')).toHaveText('Flow Field');
});

// ---- crash handling: safe mode and the crash notice (the preview backend simulates what the app reports)
const seedOnce = (page, key) => page.addInitScript(k => { if (!sessionStorage.getItem('seeded-' + k)) { localStorage.setItem(k, '1'); sessionStorage.setItem('seeded-' + k, '1'); } }, key);

test('Normally there is no safe-mode banner and no crash notice', async ({ page }) => {
  await page.goto('/index.html'); await page.waitForFunction(() => window.silkReady === true);
  await page.waitForTimeout(600);
  await expect(page.locator('#safeBanner')).toBeHidden();
  await expect(page.locator('#toast')).toBeHidden();
});

test('Safe mode: the banner explains itself, "Restore my settings" dismisses it for good', async ({ page }) => {
  await seedOnce(page, 'silk-engine-mock-safe');
  await page.goto('/index.html'); await page.waitForFunction(() => window.silkReady === true);
  const banner = page.locator('#safeBanner');
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute('role', 'alert');
  await expect(banner).toContainText('Safe mode');
  await expect(banner).toContainText('not lost');
  await banner.getByRole('button', { name: 'Restore my settings' }).click();
  await expect(banner).toBeHidden();
  await expect(page.locator('#toast')).toContainText('Your settings are back');
  expect(await page.evaluate(() => localStorage.getItem('silk-engine-mock-safe'))).toBeNull();
  await page.reload(); await page.waitForFunction(() => window.silkReady === true); await page.waitForTimeout(500);
  await expect(banner).toBeHidden();   // and it stays gone
});

test('Safe mode: "Keep safe settings" also dismisses it', async ({ page }) => {
  await seedOnce(page, 'silk-engine-mock-safe');
  await page.goto('/index.html'); await page.waitForFunction(() => window.silkReady === true);
  await page.locator('#safeBanner').getByRole('button', { name: 'Keep safe settings' }).click();
  await expect(page.locator('#safeBanner')).toBeHidden();
  await expect(page.locator('#toast')).toContainText('Keeping the safe settings');
});

test('After a real crash the Studio says so once, not on every launch', async ({ page }) => {
  await seedOnce(page, 'silk-engine-mock-crash');
  await page.goto('/index.html'); await page.waitForFunction(() => window.silkReady === true);
  await expect(page.locator('#toast')).toContainText('unexpected problem');
  await expect(page.locator('#safeBanner')).toBeHidden();
  await page.reload(); await page.waitForFunction(() => window.silkReady === true); await page.waitForTimeout(800);
  await expect(page.locator('#toast')).toBeHidden();
});
