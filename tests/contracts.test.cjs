// The browser preview pretends every command exists and every window may do anything, so it can never notice a mismatch between
// the page and the real app. These tests read the actual Rust and the actual page and check they agree:
//   * every window the app creates is granted permissions (a window with none opens fine and then cannot listen for events),
//   * every event the Rust emits to the island is one the page listens for, and the other way round,
//   * every command the island calls is really registered, and every registered island command is used.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..'), read = p => fs.readFileSync(path.join(root, p), 'utf8');
const rustFiles = fs.readdirSync(path.join(root, 'src-tauri/src')).filter(f => f.endsWith('.rs')).map(f => [f, read(`src-tauri/src/${f}`)]);

/** Labels of every window the Rust code creates (a literal, or a constant defined in the same file). */
function createdLabels() {
  const labels = new Set();
  for (const [, src] of rustFiles) for (const m of src.matchAll(/WebviewWindowBuilder::new\(\s*[^,]+,\s*("([^"]+)"|[A-Za-z_]+)\s*,/g)) {
    if (m[2]) labels.add(m[2]);
    else { const c = new RegExp(`const ${m[1]}\\s*:\\s*&str\\s*=\\s*"([^"]+)"`).exec(src); assert.ok(c, `cannot resolve window label ${m[1]}`); labels.add(c[1]); }
  }
  return labels;
}
const capabilities = fs.readdirSync(path.join(root, 'src-tauri/capabilities')).filter(f => f.endsWith('.json')).map(f => ({ file: f, ...JSON.parse(read(`src-tauri/capabilities/${f}`)) }));

test('the app creates the windows we expect (so this test cannot silently see none)', () => {
  assert.deepEqual([...createdLabels()].sort(), ['circle-search', 'island', 'lens-results', 'studio', 'wallpaper']);
});
test('every window the app creates is granted permissions by a capability', () => {
  const granted = new Set(capabilities.flatMap(c => [...(c.windows || []), ...(c.webviews || [])]));
  for (const label of createdLabels()) assert.ok(granted.has(label), `window "${label}" has no capability: its page could load but would be denied the event system and show nothing`);
});
test('no capability names a window that does not exist (a typo grants nothing)', () => {
  const created = createdLabels();
  for (const c of capabilities) for (const w of [...(c.windows || []), ...(c.webviews || [])]) assert.ok(created.has(w), `${c.file} grants permissions to "${w}", which the app never creates`);
});
test('every window that listens for events is allowed to', () => {
  for (const label of createdLabels()) {
    const perms = capabilities.filter(c => (c.windows || c.webviews || []).includes(label)).flatMap(c => c.permissions);
    assert.ok(perms.includes('core:default'), `"${label}" lacks core:default (events)`);
  }
});
test('the island has only the permissions it needs: no dialogs, no window control', () => {
  const island = capabilities.filter(c => (c.windows || []).includes('island')).flatMap(c => c.permissions);
  assert.deepEqual(island, ['core:default']);
});
test('third-party web wallpapers are never granted anything', () => {
  for (const c of capabilities) assert.ok(!(c.windows || c.webviews || []).some(w => /wp|web|remote/i.test(w)), c.file);
  assert.ok(capabilities.every(c => !c.remote), 'no capability may reach remote origins');
});

// ---- events between the app and the island page
const host = read('src-tauri/src/island_host.rs'), page = read('src/island/island.js');
const forOtherWindows = new Set(['app-error']);   // sent to the Studio (it shows a toast), not to the island page
test('every event the app emits to the island is one the page listens for', () => {
  const emitted = new Set([...host.matchAll(/\.emit\("([^"]+)"/g)].map(m => m[1]).filter(e => !forOtherWindows.has(e)));
  const listened = new Set([...page.matchAll(/(?:bridge\.)?listen\('([^']+)'/g)].map(m => m[1]));
  assert.ok(emitted.size >= 3, 'expected the island events');
  for (const e of emitted) assert.ok(listened.has(e), `the app emits "${e}" but island.js never listens for it`);
});
test('the page does not wait for an island event the app never sends', () => {
  const emitted = new Set([...host.matchAll(/\.emit\("([^"]+)"/g)].map(m => m[1]).filter(e => !forOtherWindows.has(e)));
  const own = new Set(['state', 'audio', 'accent-applied', 'studio-opened']);   // events other parts of the app send
  for (const m of page.matchAll(/(?:bridge\.)?listen\('([^']+)'/g)) assert.ok(emitted.has(m[1]) || own.has(m[1]), `island.js listens for "${m[1]}", which nothing emits`);
});

// ---- commands between the page and the app
const lib = read('src-tauri/src/lib.rs');
const registered = new Set([...lib.slice(lib.indexOf('generate_handler!')).matchAll(/^\s+(?:(?:island_host|circle_search)::)?([a-z_]+),?\s*$/gm)].map(m => m[1]));
test('the registered command list was found', () => {
  for (const c of ['assign', 'get_state', 'widget_metrics', 'island_expand', 'quick_state', 'power_do']) assert.ok(registered.has(c), c);
});
test('every command the island page calls is registered in the app', () => {
  const called = new Set([...page.matchAll(/(?:call|attempt|invoke|runAction)\('([a-z_]+)'/g)].map(m => m[1]));
  assert.ok(called.size >= 15, `only found ${called.size} calls`);
  for (const c of called) assert.ok(registered.has(c), `island.js calls "${c}", which the app does not register: it would fail silently`);
});
test('every command the island host defines is registered and called by the page', () => {
  const defined = [...host.matchAll(/#\[tauri::command\]\s*pub (?:async )?fn ([a-z_]+)/g)].map(m => m[1]);
  assert.ok(defined.length >= 14);
  for (const c of defined) { assert.ok(registered.has(c), `${c} is defined but not registered`); assert.ok(page.includes(`'${c}'`), `${c} is registered but the page never calls it`); }
});
test('every island command checks which window is calling it', () => {
  const bodies = host.split('#[tauri::command]').slice(1);
  for (const b of bodies) { const name = /fn ([a-z_]+)/.exec(b)[1]; assert.match(b, /from_island\(&window\)\?/, `${name} does not check its caller`); }
});

// ---- every window must be built the same way where WebView2 insists on it
test('every window shares the same browser arguments (WebView2 refuses to create one that differs from the rest)', () => {
  let found = 0;
  for (const [file, src] of rustFiles) {
    for (const m of src.matchAll(/WebviewWindowBuilder::new\(/g)) {
      const chain = src.slice(m.index, src.indexOf('.build()', m.index));
      found++;
      assert.match(chain, /\.additional_browser_args\((crate::)?BROWSER_ARGS\)/, `${file}: a window is built without the shared BROWSER_ARGS, so Windows will fail to create it`);
    }
  }
  assert.equal(found, 5, 'expected the wallpaper, studio, island screen-search and Lens results windows');
});
test('a window that cannot be created is reported on screen, not just swallowed', () => {
  const create = host.slice(host.indexOf('match ensure_window'), host.indexOf('state.generation.fetch_add', host.indexOf('match ensure_window')));
  assert.match(create, /maintenance::record/); assert.match(create, /app-error/);
});

// ---- the island window is never resized while it is visible (that is what made the morph stretch and judder)
test('the island window keeps one size while it is visible; only its click-through clip changes', () => {
  const expandBody = host.slice(host.indexOf('pub async fn island_expand'), host.indexOf('#[tauri::command]', host.indexOf('pub async fn island_expand')));
  assert.match(expandBody, /set_clip\(/);
  assert.ok((expandBody.match(/\bplace\(/g) || []).length <= 1, 'island_expand may resize the window only as the fallback');
  assert.match(expandBody, /if !ok \|\| st\.0\.clip_failed[^{]*\{\s*(?:st\.0\.clip_failed\.store\([^;]+;\s*)?(?:if !set_clip\(&w, None\) \{[^}]*\}\s*)?place\(/, 'and only when the clip is unavailable');
  const show = host.slice(host.indexOf('pub fn show('), host.indexOf('pub fn leave'));
  assert.match(show, /place\(&w, island::window_rect\(mon, scale, true\)\)/, 'the window is always panel-sized');
  assert.match(show, /island::peek_region\(mon, scale\)/);
});
test('an app icon is only ever read for a program that is in the tally and is a plain .exe', () => {
  const body = host.slice(host.indexOf('pub async fn apps_icon'), host.indexOf('pub fn apps_launch'));
  assert.match(body, /path_of\(&key\)/); assert.match(body, /usage::launchable\(&path\)/);
});
