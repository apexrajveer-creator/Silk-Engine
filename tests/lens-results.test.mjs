import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { harness, flush } from './helpers/island-harness.mjs';
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
test('Open Studio in Quick uses the native allowlisted Studio action', async t => {
  const h = harness(); t.after(() => h.cleanup()); h.open(); await h.advance(100);
  h.node('view-quick').querySelector('.studio-chip').click(); await flush();
  assert.ok(h.calls.some(c => c.name === 'island_action' && c.args.id === 'studio'));
  assert.match(read('src-tauri/src/island_host.rs'), /"circleSearch", "studio"\]\.contains/);
});
test('only the trusted local results frame gets capabilities; remote content has none', () => {
  const cap = JSON.parse(read('src-tauri/capabilities/lens-results.json'));
  assert.deepEqual(cap.webviews, ['lens-results']); assert.equal(cap.windows, undefined); assert.equal(cap.remote, undefined);
  assert.deepEqual(cap.permissions, ['core:default']);
  const rust = read('src-tauri/src/circle_search.rs');
  assert.match(rust, /webview.label\(\) != RESULTS/);
  assert.match(rust, /!host.ends_with\("\.localhost"\)/);
  assert.match(rust, /NewWindowResponse::Deny/);
  assert.ok(!rust.includes('Command::new("explorer.exe")'));
});
test('results controls invoke only fixed navigation actions and coalesce duplicate clicks', async () => {
  const calls = [], events = {}, buttons = ['back', 'forward', 'reload', 'close'].map(action => ({ dataset: { action }, addEventListener: (_, f) => events[action] = f }));
  let release; const waiting = new Promise(r => release = r);
  const error = {}, title = { addEventListener() {} };
  const scope = { bridge: { invoke: async (name, args) => { calls.push([name, args]); await waiting; } }, bindSurfaceTheme: () => () => {},
    document: { body: {}, documentElement: { style: {} }, getElementById: id => id === 'error' ? error : title, querySelectorAll: () => buttons, addEventListener() {} }, window: { addEventListener() {} }, setTimeout() {}, clearTimeout() {}, requestAnimationFrame() {} };
  vm.createContext(scope); vm.runInContext(read('src/search/lens.js').replace(/^import .*;\n/gm, ''), scope);
  events.back(); events.back(); assert.equal(calls.length, 1); assert.equal(buttons[0].disabled, true);
  assert.equal(calls[0][0], 'lens_control'); assert.equal(calls[0][1].action, 'back'); release(); await flush(); assert.equal(buttons[0].disabled, false);
});
test('multi-webview frame commands avoid the single-webview command extractor', () => {
  const rust = read('src-tauri/src/circle_search.rs'), lib = read('src-tauri/src/lib.rs');
  assert.match(rust, /fn lens_control\(app: AppHandle, webview: tauri::Webview, action: String\)/);
  assert.match(rust, /let window = webview.window\(\)/);
  assert.match(lib, /fn get_surface_accent\(webview: tauri::Webview\)/);
});
test('Studio waits for painted layout, reveals once, and keeps the failure screen recoverable', async () => {
  const frames = [], calls = [], classes = new Set(), nodes = { startupFailure: {}, startupMessage: {}, startupRetry: {} }, timers = [];
  const scope = { window: { __TAURI__: { core: { invoke: async name => calls.push(name) } } },
    document: { body: { classList: { add: c => classes.add(c), remove: c => classes.delete(c) } }, getElementById: id => nodes[id] },
    requestAnimationFrame: f => frames.push(f), setTimeout: f => timers.push(f), clearTimeout() {}, location: { reload() {} }, console };
  vm.createContext(scope); vm.runInContext(read('src/startup.js'), scope);
  const pending = scope.window.silkRevealStudio(); scope.window.silkRevealStudio();
  assert.equal(calls.length, 0); assert.ok(classes.has('studio-opening')); assert.equal(frames.length, 1);
  frames.shift()(); assert.equal(calls.length, 0); frames.shift()(); await pending;
  assert.deepEqual(calls, ['studio_ready']); frames.shift()(); assert.ok(!classes.has('studio-opening'));
  scope.window.silkStartupFailed('A recoverable failure'); assert.equal(nodes.startupFailure.hidden, false); assert.equal(nodes.startupMessage.textContent, 'A recoverable failure');
  const lib = read('src-tauri/src/lib.rs'); assert.match(lib, /\.shadow\(true\)\.visible\(false\)\.focused\(false\)/);
  assert.match(lib, /webview.label\(\) != "studio"/);
});
test('Studio completion leaves the Island through its existing animated dismissal', async t => {
  const h = harness(); t.after(() => h.cleanup()); h.open(); await h.advance(100);
  h.emit('studio-opened'); await flush(); assert.equal(h.S.state, 'hidden');
});
test('a hidden Studio still reveals when animation frames are suspended', async () => {
  const timers = [], calls = [], nodes = { startupFailure: {}, startupMessage: {}, startupRetry: {} };
  const scope = { window: { __TAURI__: { core: { invoke: async name => calls.push(name) } } },
    document: { body: { classList: { add() {}, remove() {} } }, getElementById: id => nodes[id] },
    requestAnimationFrame() {}, setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout() {}, location: { reload() {} }, console };
  vm.createContext(scope); vm.runInContext(read('src/startup.js'), scope);
  const pending = scope.window.silkRevealStudio(); assert.equal(calls.length, 0);
  timers.find(t => t.ms === 50).f(); await pending; assert.deepEqual(calls, ['studio_ready']);
});
