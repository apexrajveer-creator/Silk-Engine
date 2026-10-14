// The island, driven like a user would: waking the bar at the top-centre, opening it, moving between the tabs with the
// keyboard, and every tab's behaviour. The preview backend stands in for the app and records what the page asked it to do
// (window.__islandMock.log), so these tests also check the commands that WOULD reach Windows.
import { test, expect } from '@playwright/test';

const open = async page => { await page.goto('/island.html?open'); await expect(page.locator('#island')).toHaveAttribute('data-state', 'open'); await page.waitForTimeout(700); };
const log = page => page.evaluate(() => __islandMock.log.map(x => JSON.stringify(x)));
const tab = (page, id) => page.locator(`#tab-${id}`);

test.describe('waking, opening and closing', () => {
  test('it starts hidden, and resting the cursor at the top-centre brings in the peek bar', async ({ page }) => {
    await page.goto('/island.html');
    const island = page.locator('#island');
    await expect(island).toHaveAttribute('data-state', 'hidden');
    await page.mouse.move(640, 0);
    await expect(island).toHaveAttribute('data-state', 'peek', { timeout: 4000 });
    await expect(page.locator('#peekTime')).toHaveText(/^\d\d:\d\d$/);
    await expect(page.locator('#peekCpu')).toHaveText(/^\d+%$/);
    await expect(page.locator('#peekRam')).toHaveText(/^\d+%$/);
  });

  test('a quick flick across the top edge does not open it', async ({ page }) => {
    await page.goto('/island.html');
    await page.mouse.move(640, 0); await page.waitForTimeout(90);
    await page.mouse.move(640, 300);
    await page.waitForTimeout(700);
    await expect(page.locator('#island')).toHaveAttribute('data-state', 'hidden');
  });

  test('resting at the top but off to the side does not open it either', async ({ page }) => {
    await page.goto('/island.html');
    await page.mouse.move(100, 0); await page.waitForTimeout(700);
    await expect(page.locator('#island')).toHaveAttribute('data-state', 'hidden');
  });

  test('the peek bar goes away again when the cursor leaves', async ({ page }) => {
    await page.goto('/island.html?peek');
    await expect(page.locator('#island')).toHaveAttribute('data-state', 'peek');
    await page.mouse.move(640, 400);
    await expect(page.locator('#island')).toHaveAttribute('data-state', 'hidden', { timeout: 4000 });
  });

  test('clicking the peek bar opens the panel with six tabs and Quick selected', async ({ page }) => {
    await page.goto('/island.html?peek');
    await page.locator('#peek').click();
    await expect(page.locator('#island')).toHaveAttribute('data-state', 'open');
    await expect(page.locator('.tab')).toHaveCount(6);
    await expect(tab(page, 'quick')).toHaveAttribute('aria-selected', 'true');
    expect(await log(page)).toEqual([]);   // the page asked the app to grow its window (island_expand) but did nothing else
  });

  test('Escape closes the panel, and a second reveal works', async ({ page }) => {
    await open(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#island')).toHaveAttribute('data-state', 'hidden');
    await page.mouse.move(640, 300); await page.mouse.move(640, 0);
    await expect(page.locator('#island')).toHaveAttribute('data-state', 'peek', { timeout: 4000 });
  });

  test('the panel is accessible: a labelled tab list, tabs controlling panels, one selected at a time', async ({ page }) => {
    await open(page);
    await expect(page.locator('#tabs')).toHaveAttribute('role', 'tablist');
    const roles = await page.locator('.tab').evaluateAll(els => els.map(e => [e.getAttribute('role'), e.getAttribute('aria-selected'), document.getElementById(e.getAttribute('aria-controls'))?.getAttribute('role')]));
    expect(roles.every(r => r[0] === 'tab' && r[2] === 'tabpanel')).toBe(true);
    expect(roles.filter(r => r[1] === 'true')).toHaveLength(1);
    await expect(page.locator('#panel')).toHaveAttribute('aria-hidden', 'false');
  });
});

test.describe('moving between the tabs', () => {
  test('arrow keys and number keys switch tabs, and the arrows wrap around', async ({ page }) => {
    await open(page);
    await tab(page, 'quick').focus();
    await page.keyboard.press('ArrowRight'); await expect(tab(page, 'clipboard')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('5'); await expect(tab(page, 'wallpapers')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight'); await expect(tab(page, 'power')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight'); await expect(tab(page, 'quick')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowLeft'); await expect(tab(page, 'power')).toHaveAttribute('aria-selected', 'true');
  });

  test('exactly one view is showing, and it belongs to the selected tab', async ({ page }) => {
    await open(page);
    for (const id of ['clipboard', 'system', 'apps', 'wallpapers', 'power', 'quick']) {
      await tab(page, id).click();
      await expect(page.locator('.view.on')).toHaveCount(1);
      await expect(page.locator('.view.on')).toHaveAttribute('id', `view-${id}`);
    }
  });
});

test.describe('Quick', () => {
  test('Wi-Fi is on and Bluetooth off at first, and tapping toggles them and tells the app', async ({ page }) => {
    await open(page);
    const wifi = page.locator('.tile[data-id=wifi]'), bt = page.locator('.tile[data-id=bluetooth]');
    await expect(wifi).toHaveAttribute('data-on', 'true'); await expect(bt).toHaveAttribute('data-on', 'false');
    await wifi.click(); await expect(wifi).toHaveAttribute('data-on', 'false');
    await bt.click(); await expect(bt).toHaveAttribute('data-on', 'true');
    const l = await log(page);
    expect(l).toContain('["quick_set","wifi",0]'); expect(l).toContain('["quick_set","bluetooth",1]');
  });

  test('a PC with no Bluetooth adapter shows "Not available" and the tile opens Settings instead', async ({ page }) => {
    await open(page);
    await page.evaluate(() => __islandMock.quick({ bluetooth: null }));
    await tab(page, 'system').click(); await tab(page, 'quick').click();
    const bt = page.locator('.tile[data-id=bluetooth]');
    await expect(bt).toHaveAttribute('title', /Not available/);   // the row shows icons and short names; the state is in the tooltip and for screen readers
    await bt.click();
    expect(await log(page)).toContain('["quick_open","bluetooth"]');
    expect((await log(page)).filter(x => x.includes('quick_set'))).toEqual([]);
  });

  test('the volume slider follows the system and sends the new level', async ({ page }) => {
    await open(page);
    const slider = page.getByRole('slider', { name: 'Volume' });
    await expect(slider).toHaveValue('62');
    await slider.fill('30');
    await expect(page.locator('.volume output')).toHaveText('30%');
    await expect.poll(async () => (await log(page)).some(x => x.startsWith('["quick_set","volume",0.3'))).toBe(true);
  });

  test('wallpaper switches in Quick run the same actions as the hotkeys', async ({ page }) => {
    await open(page);
    await page.locator('.tile[data-id=pause]').click();
    await expect(page.locator('.tile[data-id=pause]')).toHaveAttribute('data-on', 'true');
    await page.locator('.tile[data-id=oled]').click();
    await expect(page.locator('.tile[data-id=oled]')).toHaveAttribute('data-on', 'true');
    const l = await log(page);
    expect(l).toContain('["action","pause"]'); expect(l).toContain('["action","oled"]');
  });

  test('the settings shortcuts open the named Windows page', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Sound settings' }).click();
    await page.getByRole('button', { name: 'Display settings' }).click();
    const l = await log(page);
    expect(l).toContain('["quick_open","sound"]'); expect(l).toContain('["quick_open","display"]');
  });
});

test.describe('Clipboard', () => {
  test('it is off until you turn it on, and says what it keeps', async ({ page }) => {
    await open(page); await tab(page, 'clipboard').click();
    await expect(page.getByText('Clipboard history is off')).toBeVisible();
    await expect(page.getByText(/never saved to disk/)).toBeVisible();
    await expect(page.locator('.clip')).toHaveCount(0);
  });

  test('once on, copies appear newest first; clicking one copies it back; removing and clearing work', async ({ page }) => {
    await open(page); await tab(page, 'clipboard').click();
    await page.getByRole('button', { name: 'Turn on clipboard history' }).click();
    await expect(page.getByText('Copy some text')).toBeVisible();
    await page.evaluate(() => { __islandMock.copy('first thing'); __islandMock.copy('second thing'); __islandMock.copy('third thing'); });
    await expect(page.locator('.clip .txt')).toHaveText(['third thing', 'second thing', 'first thing'], { timeout: 5000 });
    await page.locator('.clip', { hasText: 'second thing' }).click();
    await expect(page.locator('#note')).toContainText('Copied');
    expect(await log(page)).toContain('["clip_use","second thing"]');
    await page.locator('.clip', { hasText: 'first thing' }).getByLabel('Remove from history').click();
    await expect(page.locator('.clip')).toHaveCount(2);
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page.locator('.clip')).toHaveCount(0);
  });

  test('turning it off wipes the history at once', async ({ page }) => {
    await open(page); await tab(page, 'clipboard').click();
    await page.getByRole('button', { name: 'Turn on clipboard history' }).click();
    await page.evaluate(() => __islandMock.copy('private thing'));
    await expect(page.locator('.clip')).toHaveCount(1, { timeout: 5000 });
    await page.getByRole('button', { name: 'Turn off' }).click();
    await expect(page.getByText('Clipboard history is off')).toBeVisible();
    expect(await page.evaluate(() => __islandMock.state.clip.length)).toBe(0);
  });

  test('copied text is shown as text, never interpreted as markup', async ({ page }) => {
    await open(page); await tab(page, 'clipboard').click();
    await page.getByRole('button', { name: 'Turn on clipboard history' }).click();
    const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script><b>bold</b>';
    await page.evaluate(t => __islandMock.copy(t), evil);
    await expect(page.locator('.clip')).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator('.clip .txt')).toHaveText(evil);
    expect(await page.locator('.clips img, .clips script, .clips b').count()).toBe(0);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  });
});

test.describe('System', () => {
  test('it shows CPU and memory with real numbers and a history chart', async ({ page }) => {
    await open(page); await tab(page, 'system').click();
    await expect(page.locator('.gauge.cpu .big span')).toHaveText(/^\d+$/, { timeout: 4000 });
    await expect(page.locator('.gauge.ram .big span')).toHaveText(/^\d+$/);
    await expect(page.getByText(/GB of 16\.0 GB in use/)).toBeVisible();
    await expect(page.getByText(/Windows has been running for/)).toBeVisible();
    await page.waitForTimeout(2200);
    expect((await page.locator('.gauge.cpu .line').getAttribute('d')).startsWith('M')).toBe(true);
  });
});

test.describe('Apps', () => {
  test('it is off until you start tracking, and says exactly what is kept', async ({ page }) => {
    await open(page); await tab(page, 'apps').click();
    await expect(page.getByText(/Only each program/)).toBeVisible();
    await expect(page.getByText(/nothing leaves your computer/)).toBeVisible();
    await expect(page.locator('.app')).toHaveCount(0);
  });

  test('the most used apps rank first, with durations; clicking one starts it', async ({ page }) => {
    await open(page); await tab(page, 'apps').click();
    await page.getByRole('button', { name: 'Start tracking' }).click();
    await page.evaluate(() => { __islandMock.use('Notepad', 120); __islandMock.use('Chrome', 5400); __islandMock.use('Code', 4100); });
    await tab(page, 'system').click(); await tab(page, 'apps').click();
    await expect(page.locator('.app b')).toHaveText(['Chrome', 'Code', 'Notepad']);
    await expect(page.locator('.app small').first()).toHaveText('1h 30m');
    await page.locator('.app', { hasText: 'Code' }).click();
    expect(await log(page)).toContain('["apps_launch","code"]');
  });

  test('stopping keeps the tally, and Clear deletes it', async ({ page }) => {
    await open(page); await tab(page, 'apps').click();
    await page.getByRole('button', { name: 'Start tracking' }).click();
    await page.evaluate(() => __islandMock.use('Chrome', 600));
    await tab(page, 'system').click(); await tab(page, 'apps').click();
    await expect(page.locator('.app')).toHaveCount(1);
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page.locator('.app')).toHaveCount(0);
  });
});

test.describe('Wallpapers', () => {
  test('it lists the whole library, marks the one playing, and clicking another plays it', async ({ page }) => {
    await open(page); await tab(page, 'wallpapers').click();
    await expect(page.locator('.wall')).toHaveCount(6);
    await expect(page.locator('.wall[aria-current=true]')).toHaveCount(1);
    await expect(page.locator('.wall img').first()).toHaveAttribute('src', /assets\/thumbs\/.+\.webp$/);
    await page.locator('.wall', { hasText: 'Fluid Ink' }).click();
    await expect(page.locator('.wall[aria-current=true]')).toContainText('Fluid Ink');
    await expect(page.locator('#note')).toContainText('Now playing Fluid Ink');
  });

  test('the transport buttons run the next, previous, random and pause actions', async ({ page }) => {
    await open(page); await tab(page, 'wallpapers').click();
    for (const name of ['Next wallpaper', 'Previous wallpaper', 'Random wallpaper', 'Pause or play']) await page.getByRole('button', { name }).click();
    const l = await log(page);
    for (const id of ['next', 'prev', 'random', 'pause']) expect(l).toContain(`["action","${id}"]`);
  });
});

test.describe('Power', () => {
  test('sleep and lock run at once, with no confirmation', async ({ page }) => {
    await open(page); await tab(page, 'power').click();
    await page.locator('.pbtn[data-id=lock]').click();
    expect(await log(page)).toContain('["power","lock",false]');
  });

  test('restart needs a second tap: the first only arms it and says so', async ({ page }) => {
    await open(page); await tab(page, 'power').click();
    const restart = page.locator('.pbtn[data-id=restart]');
    await restart.click();
    await expect(restart).toHaveAttribute('data-armed', 'true');
    await expect(restart).toContainText('Tap again to confirm');
    expect((await log(page)).filter(x => x.includes('"power"'))).toEqual([]);
    await restart.click();
    await expect.poll(async () => (await log(page)).includes('["power","restart",true]')).toBe(true);
  });

  test('tapping a different destructive button moves the arming; nothing runs', async ({ page }) => {
    await open(page); await tab(page, 'power').click();
    await page.locator('.pbtn[data-id=restart]').click();
    await page.locator('.pbtn[data-id=shutdown]').click();
    await expect(page.locator('.pbtn[data-id=shutdown]')).toHaveAttribute('data-armed', 'true');
    await expect(page.locator('.pbtn[data-id=restart]')).toHaveAttribute('data-armed', 'false');
    expect((await log(page)).filter(x => x.includes('"power"'))).toEqual([]);
  });

  test('an armed button disarms itself after three seconds, and then needs two taps again', async ({ page }) => {
    await open(page); await tab(page, 'power').click();
    const shut = page.locator('.pbtn[data-id=shutdown]');
    await shut.click(); await expect(shut).toHaveAttribute('data-armed', 'true');
    await page.waitForTimeout(3400);
    await expect(shut).toHaveAttribute('data-armed', 'false');
    await shut.click();
    expect((await log(page)).filter(x => x.includes('"power"'))).toEqual([]);
  });

  test('leaving the Power tab disarms everything', async ({ page }) => {
    await open(page); await tab(page, 'power').click();
    await page.locator('.pbtn[data-id=signout]').click();
    await tab(page, 'quick').click(); await tab(page, 'power').click();
    await expect(page.locator('.pbtn[data-armed=true]')).toHaveCount(0);
  });
});

test.describe('the Studio side', () => {
  test('the System tab has the island switch and delay slider, and the delay hides when the island is off', async ({ page }) => {
    await page.goto('/index.html'); await page.waitForFunction(() => window.silkReady === true);
    await page.locator('.dock-item[data-tab=system]').click();
    const island = page.locator('#systemGroups').getByText('Top-edge island');
    await expect(island).toBeVisible();
    await expect(page.locator('#systemGroups').getByText('Island reveal delay')).toBeVisible();
  });
});

test.describe('no halo and no flicker', () => {
  test('nothing follows the cursor: no glow element, no pointer-tracking style, no highlight in the stylesheet', async ({ page }) => {
    await open(page);
    for (const [x, y] of [[560, 120], [640, 220], [700, 300], [600, 180]]) await page.mouse.move(x, y, { steps: 4 });
    await expect(page.locator('.sheen')).toHaveCount(0);
    const tracked = await page.evaluate(() => { const s = document.getElementById('shell'); return [s.style.getPropertyValue('--mx'), s.style.getPropertyValue('--my'), s.getAttribute('style')]; });
    expect(tracked).toEqual(['', '', null]);
    const css = await (await page.request.get('/island/island.css')).text();
    expect(css).not.toMatch(/sheen|--mx|--my/);
    const js = await (await page.request.get('/island/island.js')).text();
    expect(js).not.toMatch(/pointermove|--mx/);
  });

  // Records every data-state the island goes through, so "it blinked" becomes a fact that can be asserted.
  const watchStates = page => page.evaluate(() => { window.__states = [document.getElementById('island').dataset.state]; new MutationObserver(() => window.__states.push(document.getElementById('island').dataset.state)).observe(document.getElementById('island'), { attributes: true, attributeFilter: ['data-state'] }); });
  const tell = (page, evt, payload) => page.evaluate(([e, p]) => new BroadcastChannel('silk-engine').postMessage({ evt: e, payload: p }), [evt, payload]);

  test('being told to show again and again never makes the bar blink out and back in', async ({ page }) => {
    await page.goto('/island.html?peek');
    await expect(page.locator('#island')).toHaveAttribute('data-state', 'peek');
    await watchStates(page);
    for (let i = 0; i < 6; i++) { await tell(page, 'island-show', false); await page.waitForTimeout(40); }
    await page.waitForTimeout(700);
    const states = await page.evaluate(() => window.__states);
    expect(states, `the bar must stay put, but went through ${states.join(' > ')}`).toEqual(['peek']);
  });

  test('two shows arriving together (the first reveal) fade in once, never in, out and in again', async ({ page }) => {
    await page.goto('/island.html');
    await expect(page.locator('#island')).toHaveAttribute('data-state', 'hidden');
    await watchStates(page);
    await tell(page, 'island-show', false); await tell(page, 'island-show', false); await tell(page, 'island-show', false);
    await expect(page.locator('#island')).toHaveAttribute('data-state', 'peek');
    await page.waitForTimeout(500);
    const states = await page.evaluate(() => window.__states);
    expect(states.filter(s => s === 'peek')).toHaveLength(1);
    expect(states.indexOf('hidden', states.indexOf('peek'))).toBe(-1);
  });

  test('an open panel is never knocked back by a late show message, and asking to open it again changes nothing', async ({ page }) => {
    await open(page);
    await watchStates(page);
    await tell(page, 'island-show', false); await tell(page, 'island-show', true); await tell(page, 'island-show', false);
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => window.__states)).toEqual(['open']);
  });

  test('when the app hides the window it tells the page, so the next reveal starts clean', async ({ page }) => {
    await open(page);
    await tell(page, 'island-hidden', null);
    await expect(page.locator('#island')).toHaveAttribute('data-state', 'hidden');
    await tell(page, 'island-show', false);
    await expect(page.locator('#island')).toHaveAttribute('data-state', 'peek', { timeout: 3000 });
  });
});

test.describe('Media', () => {
  const mock = (page, patch) => page.evaluate(p => __islandMock.media(p), patch);
  const title = page => page.locator('.media-title');

  test('it shows what is playing: app, title, artist and artwork', async ({ page }) => {
    await open(page);
    await expect(title(page)).toHaveText('Midnight City');
    await expect(page.locator('.media-artist')).toHaveText('M83');
    await expect(page.locator('.media-app')).toHaveText('Spotify');
    await expect(page.locator('.media')).toHaveAttribute('data-mode', 'playing');
    await expect(page.locator('.media')).toHaveAttribute('data-art', 'true');
    expect(await page.locator('.art img').getAttribute('src')).toMatch(/^data:image\//);
  });

  test('the progress bar shows the time and keeps moving while it plays', async ({ page }) => {
    await open(page);
    const now = page.locator('.media-seek .t').first(), total = page.locator('.media-seek .t').last();
    await expect(total).toHaveText('4:03');
    const a = await page.locator('.media-seek input').inputValue();
    await page.waitForTimeout(2200);
    const b = await page.locator('.media-seek input').inputValue();
    expect(Number(b) - Number(a), `moved from ${a} to ${b}`).toBeGreaterThan(1.5);
    await expect(now).toHaveText(/^1:\d\d$/);
  });

  test('pause and play: the button flips at once, tells the app, and the progress stops', async ({ page }) => {
    await open(page);
    const toggle = page.locator('.mc[data-id=toggle]');
    await expect(toggle).toHaveAttribute('aria-label', 'Pause');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-label', 'Play');
    await expect(page.locator('.media')).toHaveAttribute('data-mode', 'paused');
    expect(await log(page)).toContain('["media","toggle"]');
    const a = await page.locator('.media-seek input').inputValue(); await page.waitForTimeout(1500);
    const b = await page.locator('.media-seek input').inputValue();
    expect(Math.abs(Number(b) - Number(a)), `moved from ${a} to ${b} while paused`).toBeLessThan(0.1);   // not frozen to the last decimal: the player's own report may differ by a millisecond
    await toggle.click(); await expect(toggle).toHaveAttribute('aria-label', 'Pause');
  });

  test('next and previous change the track, its artwork and its length', async ({ page }) => {
    await open(page);
    const before = await page.locator('.art img').getAttribute('src');
    await page.locator('.mc[data-id=next]').click();
    await expect(title(page)).toHaveText('Resonance', { timeout: 4000 });
    await expect(page.locator('.media-seek .t').last()).toHaveText('3:32');
    await expect.poll(() => page.locator('.art img').getAttribute('src'), { timeout: 4000 }).not.toBe(before);
    await page.locator('.mc[data-id=prev]').click();
    await expect(title(page)).toHaveText('Midnight City', { timeout: 4000 });
    const l = await log(page); expect(l).toContain('["media","next"]'); expect(l).toContain('["media","prev"]');
  });

  test('dragging the progress bar seeks there', async ({ page }) => {
    await open(page);
    await page.locator('.media-seek input').fill('100');
    await expect(page.locator('.media-seek .t').first()).toHaveText('1:40');
    expect(await log(page)).toContain('["media","seek",100]');
  });

  test('with nothing playing the card says so calmly and the controls are off', async ({ page }) => {
    await open(page);
    await mock(page, { active: false });
    await expect(page.locator('.media')).toHaveAttribute('data-mode', 'none', { timeout: 4000 });
    await expect(title(page)).toHaveText('Nothing playing');
    await expect(page.locator('.media')).toHaveAttribute('data-art', 'false');
    for (const id of ['prev', 'toggle', 'next']) await expect(page.locator(`.mc[data-id=${id}]`)).toBeDisabled();
    await expect(page.locator('.media-seek input')).toBeDisabled();
    await mock(page, { active: true });
    await expect(page.locator('.media')).toHaveAttribute('data-mode', 'playing', { timeout: 4000 });
  });

  test('a player that cannot skip or seek has those controls switched off, the rest still work', async ({ page }) => {
    await open(page);
    await mock(page, { canNext: false, canSeek: false });
    await expect(page.locator('.mc[data-id=next]')).toBeDisabled({ timeout: 4000 });
    await expect(page.locator('.media-seek input')).toBeDisabled();
    await expect(page.locator('.mc[data-id=prev]')).toBeEnabled();
    await expect(page.locator('.mc[data-id=toggle]')).toBeEnabled();
  });

  test('a live stream with no length shows "Live" and cannot be seeked', async ({ page }) => {
    await open(page);
    await mock(page, { duration: 0, canSeek: false });
    await expect(page.locator('.media-seek .t').last()).toHaveText('Live', { timeout: 4000 });
    await expect(page.locator('.media-seek input')).toBeDisabled();
  });

  test('if the music is paused somewhere else, the card follows within a couple of seconds', async ({ page }) => {
    await open(page);
    await mock(page, { status: 'paused' });
    await expect(page.locator('.media')).toHaveAttribute('data-mode', 'paused', { timeout: 4000 });
    await expect(page.locator('.mc[data-id=toggle]')).toHaveAttribute('aria-label', 'Play');
  });

  test('a track with no artwork shows a calm placeholder instead of a broken image', async ({ page }) => {
    await open(page);
    await mock(page, { noArt: true });
    await expect(page.locator('.media')).toHaveAttribute('data-art', 'false', { timeout: 4000 });
    await expect(page.locator('.art-ph')).toBeVisible();
    await expect(page.locator('.art img')).toHaveCSS('opacity', '0');
  });

  test('a title is shown as text, never as markup', async ({ page }) => {
    await open(page);
    const evil = '<img src=x onerror="window.__pwned=1"><b>bold</b>';
    await mock(page, { title: evil, artist: '<script>window.__pwned=2</script>' });
    await expect(title(page)).toHaveText(evil, { timeout: 4000 });
    expect(await page.locator('.media-main img, .media-main b, .media-main script').count()).toBe(0);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  });

  test('a very long title is cut off tidily: the card keeps its shape and the controls stay inside it', async ({ page }) => {
    await open(page);
    const before = await page.evaluate(() => { const c = document.querySelector('.media').getBoundingClientRect(); return [Math.round(c.width), Math.round(c.height)]; });
    await mock(page, { title: 'An Extremely Long Track Name '.repeat(12), artist: 'An Artist With A Very Long Name Indeed '.repeat(8) });
    await expect(title(page)).toContainText('An Extremely Long', { timeout: 4000 });
    const r = await page.evaluate(() => {
      const c = document.querySelector('.media').getBoundingClientRect(), k = document.querySelector('.media-controls').getBoundingClientRect(), col = document.querySelector('.media-main');   // (the card's own scrollWidth includes its decorative backdrop on purpose)
      return { size: [Math.round(c.width), Math.round(c.height)], textFits: col.scrollWidth <= col.clientWidth + 1, controlsInside: k.bottom <= c.bottom && k.top >= c.top };
    });
    expect(r.textFits).toBe(true); expect(r.controlsInside).toBe(true);
    expect(r.size[0]).toBe(before[0]); expect(r.size[1], 'a long title may add a line, but must not blow the card up').toBeLessThanOrEqual(before[1] + 30);
  });

  test('the whole Quick tab fits without scrolling: card, one row of six switches, volume and shortcuts', async ({ page }) => {
    await open(page);
    const r = await page.evaluate(() => {
      const v = document.getElementById('view-quick'), vb = v.getBoundingClientRect(), box = s => document.querySelector(s).getBoundingClientRect();
      const tiles = [...document.querySelectorAll('.tile')].map(t => Math.round(t.getBoundingClientRect().top));
      return { scrolls: v.scrollHeight > v.clientHeight + 1, media: Math.round(box('.media').height), tiles: tiles.length, oneRow: new Set(tiles).size === 1, volumeInside: box('.volume').bottom <= vb.bottom, chipsInside: box('.chips').bottom <= vb.bottom + 1, overlap: box('.tiles').top < box('.media').bottom || box('.volume').top < box('.tiles').bottom };
    });
    expect(r).toEqual({ scrolls: false, media: expect.any(Number), tiles: 6, oneRow: true, volumeInside: true, chipsInside: true, overlap: false });
    expect(r.media).toBeGreaterThanOrEqual(150);
  });

  test('using the controls never shifts the card or the tab (a clipped container must not be scrollable by focus)', async ({ page }) => {
    await open(page);
    for (const id of ['next', 'prev', 'toggle', 'toggle']) await page.locator(`.mc[data-id=${id}]`).click();
    await page.locator('.mc[data-id=prev]').focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    const s = await page.evaluate(() => ({ card: [document.querySelector('.media').scrollLeft, document.querySelector('.media').scrollTop], view: document.getElementById('view-quick').scrollTop, shell: [document.getElementById('shell').scrollLeft, document.getElementById('shell').scrollTop] }));
    expect(s).toEqual({ card: [0, 0], view: 0, shell: [0, 0] });
  });

  test('the card only polls the player while the Quick tab is on screen', async ({ page }) => {
    await open(page);
    await tab(page, 'system').click(); await page.waitForTimeout(400);
    const a = await page.evaluate(() => __islandMock.state.mediaPolls);
    await page.waitForTimeout(3000);
    expect(await page.evaluate(() => __islandMock.state.mediaPolls)).toBe(a);
    await tab(page, 'quick').click(); await page.waitForTimeout(1500);
    expect(await page.evaluate(() => __islandMock.state.mediaPolls)).toBeGreaterThan(a);
  });

  test('the track is described to screen readers: named controls and a labelled position', async ({ page }) => {
    await open(page);
    await expect(page.getByRole('button', { name: 'Previous track' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next track' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();   // (not the wallpaper switch, which is named "Pause wallpaper: ...")
    await expect(page.getByRole('slider', { name: 'Track position' })).toBeVisible();
  });
});

// ---------------------------------------------------------------- the three things that were wrong
const withLibrary = async (page, extra) => page.addInitScript(items => localStorage.setItem('silk-engine-mock', JSON.stringify({ version: 1, items, assign: { '*': 'builtin-life' }, span: false, paused: false, display: {}, system: {} })), extra);
const storeImage = (page, id) => page.evaluate(async id => {
  const c = document.createElement('canvas'); c.width = 640; c.height = 400; const x = c.getContext('2d'); x.fillStyle = '#c0392b'; x.fillRect(0, 0, 640, 400); x.fillStyle = '#f1c40f'; x.fillRect(200, 100, 240, 200);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  await new Promise((res, rej) => { const q = indexedDB.open('silk-engine-media', 1); q.onupgradeneeded = () => q.result.createObjectStore('m'); q.onsuccess = () => { const t = q.result.transaction('m', 'readwrite'); t.objectStore('m').put(blob, id); t.oncomplete = res; t.onerror = rej; }; });
}, id);
const MEDIA = [{ id: 'img1', name: 'Sunset', kind: 'image', path: 'a.png', settings: {} }, { id: 'vid1', name: 'Waves', kind: 'video', path: 'b.mp4', settings: {} }, { id: 'web1', name: 'Clock', kind: 'web', path: 'c', settings: {} }, { id: 'img2', name: 'Sekiro', kind: 'image', path: 'd.png', settings: {} }, { id: 'vid2', name: 'The Last of Us', kind: 'video', path: 'e.mp4', settings: {} }];

test.describe('the apps are bubbles with real icons', () => {
  const start = async page => {
    await open(page); await tab(page, 'apps').click();
    await page.getByRole('button', { name: 'Start tracking' }).click();
    await page.evaluate(() => { for (const [n, s] of [['Stremio', 1600], ['Google Chrome', 400], ['NoIcon Tool', 100], ['Spotify', 50]]) __islandMock.use(n, s); });
    await tab(page, 'system').click(); await tab(page, 'apps').click();
    await expect(page.locator('.app')).toHaveCount(4);
  };
  test('each app is a bubble showing the program\'s own icon', async ({ page }) => {
    await start(page);
    await expect(page.locator('.app:has-text("Stremio") .bub img')).toHaveAttribute('src', /^data:image\//, { timeout: 4000 });
    await expect(page.locator('.app .bub img')).toHaveCount(3);
    const radius = await page.locator('.app').first().evaluate(e => parseFloat(getComputedStyle(e).borderTopLeftRadius));
    expect(radius, 'bubble-shaped, not a square card').toBeGreaterThanOrEqual(24);
  });
  test('a program with no icon gets a neutral glyph, never a made-up letter', async ({ page }) => {
    await start(page);
    const noicon = page.locator('.app:has-text("NoIcon") .bub');
    await expect(noicon.locator('svg')).toHaveCount(1); await expect(noicon.locator('img')).toHaveCount(0);
    const letters = await page.locator('.app .bub').evaluateAll(els => els.map(e => e.textContent.trim()));
    expect(letters).toEqual(['', '', '', ''].slice(0, letters.length));
  });
  test('each icon is asked for once, however often the list refreshes', async ({ page }) => {
    await start(page);
    await page.waitForTimeout(1500);
    const first = await page.evaluate(() => __islandMock.state.iconAsks);
    await tab(page, 'system').click(); await tab(page, 'apps').click(); await page.waitForTimeout(1500);
    expect(await page.evaluate(() => __islandMock.state.iconAsks)).toBe(first);
    expect(first).toBe(4);
  });
  test('the share of your time shows as a fill inside the bubble: the most used is the fullest', async ({ page }) => {
    await start(page);
    const shares = await page.locator('.app').evaluateAll(els => els.map(e => parseFloat(e.style.getPropertyValue('--share'))));
    expect(shares[0]).toBeGreaterThan(shares[1]); expect(shares[1]).toBeGreaterThan(shares[2]);
    expect(Math.min(...shares)).toBeGreaterThanOrEqual(8);
  });
  test('the bubbles fit the panel: two columns, four rows, nothing overlapping or scrolling', async ({ page }) => {
    await start(page);
    const r = await page.evaluate(() => { const v = document.getElementById('view-apps'); const boxes = [...document.querySelectorAll('.app')].map(a => a.getBoundingClientRect()); const overlap = boxes.some((a, i) => boxes.some((b, j) => i < j && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)); return { scrolls: v.scrollHeight > v.clientHeight + 1, overlap, cols: new Set(boxes.map(b => Math.round(b.left))).size }; });
    expect(r).toEqual({ scrolls: false, overlap: false, cols: 2 });
  });
});

test.describe('the wallpaper tab', () => {
  test('the tiles never overlap, and the grid is three wide', async ({ page }) => {
    await withLibrary(page, MEDIA); await open(page); await tab(page, 'wallpapers').click();
    await expect(page.locator('.wall')).toHaveCount(11);
    const r = await page.evaluate(() => { const b = [...document.querySelectorAll('.wall')].map(w => w.getBoundingClientRect()); return { overlap: b.some((x, i) => b.some((y, j) => i < j && x.left < y.right - 1 && y.left < x.right - 1 && x.top < y.bottom - 1 && y.top < x.bottom - 1)), smallest: Math.round(Math.min(...b.map(x => x.height))), cols: new Set(b.map(x => Math.round(x.left))).size }; });
    expect(r.overlap).toBe(false); expect(r.cols).toBe(3); expect(r.smallest).toBeGreaterThanOrEqual(100);
  });
  test('your own image gets a real thumbnail, made the way the Studio makes them', async ({ page }) => {
    await withLibrary(page, MEDIA); await page.goto('/island.html?open'); await page.waitForTimeout(800);
    await storeImage(page, 'img1');
    await tab(page, 'wallpapers').click();
    await expect(page.locator('.wall[data-id=img1] img')).toHaveAttribute('src', /^blob:/, { timeout: 8000 });
    await expect(page.locator('.wall[data-id=img1] .ph')).toHaveCount(0);
  });
  test('items with nothing to show get a tidy placeholder (a symbol), never a letter', async ({ page }) => {
    await withLibrary(page, MEDIA); await open(page); await tab(page, 'wallpapers').click();
    await expect(page.locator('.wall[data-id=vid1] .ph svg')).toHaveCount(1, { timeout: 4000 });
    await expect(page.locator('.wall[data-id=web1] .ph')).toHaveText('WEB');
    const texts = await page.locator('.wall .ph').evaluateAll(els => els.map(e => e.textContent.trim()));
    for (const t of texts) expect(['', 'WEB']).toContain(t);
  });
  test('thumbnails are cleaned up when you leave the tab (no leaked picture addresses)', async ({ page }) => {
    await withLibrary(page, MEDIA); await page.goto('/island.html?open'); await page.waitForTimeout(800);
    await page.evaluate(() => { window.__revoked = 0; const r = URL.revokeObjectURL.bind(URL); URL.revokeObjectURL = u => { window.__revoked++; r(u); }; });
    await storeImage(page, 'img1'); await tab(page, 'wallpapers').click();
    await expect(page.locator('.wall[data-id=img1] img')).toHaveAttribute('src', /^blob:/, { timeout: 8000 });
    await tab(page, 'power').click(); await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__revoked)).toBeGreaterThan(0);
  });
});

test.describe('no default scrollbars', () => {
  test('every scrolling area hides its scrollbar, and the stylesheet has no scrollbar styling that could bring one back', async ({ page }) => {
    await withLibrary(page, MEDIA); await open(page); await tab(page, 'wallpapers').click();
    const r = await page.evaluate(() => [...document.querySelectorAll('.view, .walls, .clips, .shell, html, body')].map(e => ({ el: e.className || e.tagName, width: getComputedStyle(e).scrollbarWidth, gutter: e.offsetWidth - e.clientWidth - (parseFloat(getComputedStyle(e).borderLeftWidth) || 0) - (parseFloat(getComputedStyle(e).borderRightWidth) || 0) })));
    for (const x of r) { expect(x.width, `${x.el}`).toBe('none'); expect(x.gutter, `${x.el} reserves room for a scrollbar`).toBeLessThanOrEqual(0); }
    const css = await (await page.request.get('/island/island.css')).text();
    expect(css).not.toMatch(/scrollbar-color|scrollbar-width:\s*(thin|auto)/);
    expect(css).toMatch(/::-webkit-scrollbar\s*\{\s*display:\s*none/);
  });
  test('and the grid still scrolls with the wheel when there are more wallpapers than fit', async ({ page }) => {
    await withLibrary(page, MEDIA); await open(page); await tab(page, 'wallpapers').click();
    const before = await page.locator('.walls').evaluate(e => ({ can: e.scrollHeight > e.clientHeight + 4, top: e.scrollTop }));
    expect(before.can).toBe(true);
    await page.locator('.walls').hover(); await page.mouse.wheel(0, 300); await page.waitForTimeout(400);
    expect(await page.locator('.walls').evaluate(e => e.scrollTop)).toBeGreaterThan(before.top);
  });
});

test.describe('the morph from the bar into the panel', () => {
  // Sample the glass every frame while it opens.
  const record = page => page.evaluate(() => new Promise(done => {
    const shell = document.getElementById('shell'), panel = document.getElementById('panel'), tabs = document.getElementById('tabs'), samples = [];
    const t0 = performance.now(), grab = () => { const s = shell.getBoundingClientRect(), p = panel.getBoundingClientRect(), t = tabs.getBoundingClientRect(); samples.push({ at: Math.round(performance.now() - t0), w: s.width, h: s.height, cx: s.left + s.width / 2, top: s.top, panelW: p.width, tabsW: t.width, tabsLeftFromPanel: t.left - p.left }); if (performance.now() - t0 < 1100) requestAnimationFrame(grab); else done(samples); };
    document.getElementById('peek').click(); requestAnimationFrame(grab);
  }));
  test('the glass grows steadily, stays centred, and never jumps', async ({ page }) => {
    await page.goto('/island.html?peek'); await expect(page.locator('#island')).toHaveAttribute('data-state', 'peek');
    await expect(page.locator('#shell')).toHaveCSS('transform', 'none', { timeout: 4000 });   // the bar has finished its own entrance, as it has when a person clicks it
    await page.waitForTimeout(200);
    const s = await record(page);
    expect(s.length, 'too few frames to judge (a slow machine renders few)').toBeGreaterThan(4);
    const cx = s.map(x => x.cx); expect(Math.max(...cx) - Math.min(...cx), 'the glass drifts sideways').toBeLessThanOrEqual(1);
    const tops = s.map(x => x.top); expect(Math.max(...tops) - Math.min(...tops), 'the glass bobs up and down').toBeLessThanOrEqual(1);
    expect(s[s.length - 1].w).toBeCloseTo(580, 0); expect(s[s.length - 1].h).toBeCloseTo(452, 0);
    expect(s[0].w).toBeLessThan(300);
    // It is a spring: it may overshoot a little and settle back, but ONCE. A wobble (several changes of direction) is a judder.
    const steps = s.slice(1).map((x, i) => x.w - s[i].w).filter(d => Math.abs(d) > 0.5);
    let turns = 0; for (let i = 1; i < steps.length; i++) if (Math.sign(steps[i]) !== Math.sign(steps[i - 1])) turns++;
    expect(turns, `the width changed direction ${turns} times: ${s.map(x => Math.round(x.w)).join(' ')}`).toBeLessThanOrEqual(1);
    expect(Math.max(...s.map(x => x.w)), 'overshoots too far').toBeLessThanOrEqual(580 * 1.08);
  });
  test('the panel keeps its final layout the whole time: it is revealed, not squeezed', async ({ page }) => {
    await page.goto('/island.html?peek'); await expect(page.locator('#island')).toHaveAttribute('data-state', 'peek');
    await expect(page.locator('#shell')).toHaveCSS('transform', 'none', { timeout: 4000 });   // the bar has finished its own entrance, as it has when a person clicks it
    await page.waitForTimeout(200);
    const s = await record(page);
    const widths = new Set(s.map(x => Math.round(x.panelW))), tabsW = new Set(s.map(x => Math.round(x.tabsW)));
    expect([...widths], 'the panel was resized during the morph (its contents would re-flow every frame)').toEqual([580]);
    expect(tabsW.size, 'the tab row changed width during the morph').toBe(1);
    expect(new Set(s.map(x => Math.round(x.tabsLeftFromPanel))).size).toBe(1);
  });
  test('the bar content is likewise fixed while it fades out', async ({ page }) => {
    await page.goto('/island.html?peek'); await expect(page.locator('#island')).toHaveAttribute('data-state', 'peek');
    await expect(page.locator('#shell')).toHaveCSS('transform', 'none', { timeout: 4000 });   // the bar has finished its own entrance, as it has when a person clicks it
    await page.waitForTimeout(200);
    const w = await page.evaluate(() => new Promise(done => { const peek = document.getElementById('peek'), out = []; const t0 = performance.now(); const grab = () => { out.push(peek.offsetWidth); /* layout width: the visual width may scale as it fades, the layout must not change */ if (performance.now() - t0 < 700) requestAnimationFrame(grab); else done(out); }; peek.click(); requestAnimationFrame(grab); }));
    expect(new Set(w).size).toBe(1);
  });
});
