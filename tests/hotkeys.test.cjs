// Hotkeys: the shared helpers, the browser mock, and parity with the Rust source of truth.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { pathToFileURL } = require('node:url');
const root = path.join(__dirname, '..');
const load = () => import(pathToFileURL(path.join(root, 'src/shared/hotkeys.js')).href);
const rust = fs.readFileSync(path.join(root, 'src-tauri/src/hotkeys.rs'), 'utf8');

// the actions table as written in Rust: a("id", "Group", "Label", "Hint", "Default"),
const rustActions = [...rust.matchAll(/^\s*a\("([^"]+)", "([^"]+)", "([^"]+)", "([^"]+)", "([^"]*)"\),/gm)]
  .map(m => ({ id: m[1], group: m[2], label: m[3], hint: m[4], default: m[5] }));

test('the Studio mirror lists exactly the actions, order, labels and defaults that Rust has', async () => {
  const { ACTIONS } = await load();
  assert.ok(rustActions.length >= 15, 'could not read the Rust action table');
  assert.deepEqual(ACTIONS, rustActions);
});

test('every Rust action has something to do in lib.rs', () => {
  const lib = fs.readFileSync(path.join(root, 'src-tauri/src/lib.rs'), 'utf8');
  for (const a of rustActions.filter(a => !a.id.startsWith('profile'))) assert.ok(lib.includes(`"${a.id}"`), `lib.rs has no handler for "${a.id}"`);
  assert.ok(lib.includes('strip_prefix("profile")'), 'profile actions are not handled');
});

test('the key names and the safety rules are the same in Rust and in JavaScript', async () => {
  const { KEY_NAMES } = await load();
  for (const name of rust.match(/\("[A-Za-z]+", 0x[0-9A-F]+\)/g).map(s => s.match(/"([A-Za-z]+)"/)[1])) assert.ok(KEY_NAMES.includes(name), `JS is missing key ${name}`);
  for (const rule of ['0x7C..=0x87', 'c.ctrl && c.alt && c.vk == 0x2E', 'c.alt && c.vk == 0x09', 'c.win && c.vk == 0x4C']) assert.ok(rust.includes(rule), `rule changed in Rust: ${rule}`);
});

test('parsing accepts any order, case and aliases, and canonicalises', async () => {
  const { parseAccel, canonicalAccel } = await load();
  assert.equal(canonicalAccel(parseAccel('shift + alt + CONTROL + arrowright')), 'Ctrl+Alt+Shift+Right');
  assert.equal(canonicalAccel(parseAccel('win+alt+arrowup')), 'Alt+Win+Up');
  assert.equal(canonicalAccel(parseAccel('ctrl+win+f13')), 'Ctrl+Win+F13');
  for (const bad of ['', 'Ctrl+', 'Ctrl+Alt', 'Ctrl+Ctrl+A', 'Ctrl+A+B', 'Ctrl+Alt+Nope', '+A']) assert.throws(() => parseAccel(bad), undefined, bad);
});

test('the safety policy protects everyday typing and Windows itself', async () => {
  const { parseAccel, checkPolicy } = await load();
  for (const bad of ['Ctrl+C', 'Shift+A', 'Alt+F4', 'A', 'Ctrl+Alt+Delete', 'Ctrl+Alt+Tab', 'Win+Shift+L'])
    assert.throws(() => checkPolicy(parseAccel(bad)), undefined, `${bad} must be refused`);
  for (const good of ['Ctrl+Alt+S', 'Ctrl+Shift+F9', 'Alt+Shift+Left', 'Ctrl+Win+Z', 'F13', 'F24', 'Ctrl+F20']) checkPolicy(parseAccel(good));
});

test('every default is valid, canonical and unique', async () => {
  const { ACTIONS, defaultBindings, resolve, parseAccel, canonicalAccel } = await load();
  const r = resolve(defaultBindings());
  for (const a of ACTIONS) {
    if (!a.default) { assert.equal(r[a.id], null); continue; }
    assert.ok(r[a.id]?.combo, `${a.id}: ${r[a.id]?.error}`);
    assert.equal(canonicalAccel(parseAccel(a.default)), a.default);
  }
  assert.equal(new Set(ACTIONS.map(a => a.id)).size, ACTIONS.length);
});

test('stored bindings override defaults, empty means unbound, duplicates are named', async () => {
  const { effectiveBindings, resolve, resolveStrict, defaultBindings } = await load();
  const eff = effectiveBindings({ next: 'alt+ctrl+shift+n', prev: '' });
  assert.equal(eff.next, 'Ctrl+Alt+Shift+N'); assert.equal(eff.prev, ''); assert.equal(eff.pause, 'Ctrl+Alt+Shift+Space');
  const dup = { ...defaultBindings(), prev: 'Ctrl+Alt+Shift+Right' };
  assert.match(resolve(dup).prev.error, /Next wallpaper/);
  assert.throws(() => resolveStrict(dup), /Previous wallpaper/);
});

test('recording from keyboard events: modifiers alone wait, keys map by position not layout', async () => {
  const { comboFromEvent, keyCaps } = await load();
  const ev = (code, mods = {}) => ({ code, ctrlKey: !!mods.c, altKey: !!mods.a, shiftKey: !!mods.s, metaKey: !!mods.w });
  assert.equal(comboFromEvent(ev('ShiftLeft', { s: 1 })), null);
  assert.equal(comboFromEvent(ev('ControlRight', { c: 1 })), null);
  assert.equal(comboFromEvent(ev('KeyN', { c: 1, a: 1, s: 1 })), 'Ctrl+Alt+Shift+N');
  assert.equal(comboFromEvent(ev('ArrowRight', { c: 1, a: 1, s: 1 })), 'Ctrl+Alt+Shift+Right');
  assert.equal(comboFromEvent(ev('Digit5', { c: 1, a: 1 })), 'Ctrl+Alt+5');
  assert.equal(comboFromEvent(ev('F9', { c: 1, s: 1 })), 'Ctrl+Shift+F9');
  assert.equal(comboFromEvent(ev('Numpad3', { c: 1, a: 1 })), 'Ctrl+Alt+Numpad3');
  assert.equal(comboFromEvent(ev('MediaPlayPause', { c: 1, a: 1 })), null, 'unsupported keys are ignored');
  assert.deepEqual(keyCaps('Ctrl+Alt+Shift+Right'), ['Ctrl', 'Alt', 'Shift', '→']);
});

test('the browser mock validates, saves, reports statuses and survives bad input', async () => {
  const store = {};
  global.window = { __TAURI__: undefined };
  global.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  global.navigator = { userAgent: 'node' }; global.location = { search: '' }; global.innerWidth = 1920; global.innerHeight = 1080; global.devicePixelRatio = 1;
  global.BroadcastChannel = undefined; global.document = undefined; global.indexedDB = undefined;
  const { bridge } = await import(pathToFileURL(path.join(root, 'src/shared/bridge.js')).href + '?hk');
  const dto = await bridge.invoke('get_hotkeys');
  assert.equal(dto.enabled, true); assert.equal(dto.actions.length, rustActions.length); assert.equal(dto.status.next, 'active'); assert.equal(dto.status.profile1, 'off');
  const saved = await bridge.invoke('set_hotkeys', { enabled: true, bindings: { ...dto.bindings, random: 'ctrl+alt+shift+f12' } });
  assert.equal(saved.bindings.random, 'Ctrl+Alt+Shift+F12'); assert.equal(saved.status.random, 'inUse', 'the preview pretends another app owns F12');
  await assert.rejects(bridge.invoke('set_hotkeys', { enabled: true, bindings: { ...saved.bindings, oled: 'Ctrl+C' } }), /Toggle OLED mode/);
  await assert.rejects(bridge.invoke('set_hotkeys', { enabled: true, bindings: { nope: 'Ctrl+Alt+S' } }), /Unknown hotkey action/);
  assert.equal((await bridge.invoke('get_hotkeys')).bindings.oled, 'Ctrl+Alt+Shift+O', 'a refused save changes nothing');
  assert.equal((await bridge.invoke('set_hotkeys', { enabled: false, bindings: saved.bindings })).status.next, 'disabled');
});

// ---- Spectral Terrain: the row generator, with a stand-in for the GL context
test('Spectral Terrain builds full stacks of distinct rows and reacts to the music', async () => {
  const { default: Terrain } = await import(pathToFileURL(path.join(root, 'src/renderer/scenes/terrain.js')).href);
  const noop = () => {};
  const gl = new Proxy({}, { get: (_, k) => (typeof k === 'string' && /^[A-Z0-9_]+$/.test(k) ? 1 : noop) });
  const g = { gl, program: () => ({}), free: noop, target: () => ({ w: 8, h: 8 }), use: noop, bindTarget: noop, emptyVao: {} };
  const s = { layout: 'pulsar', height: 50, react: 80, speed: 100, roughness: 40, rows: 70 };
  const t = new Terrain(g, s);
  const P = 208, RMAX = 130, row = j => t.hist.slice(j * P, (j + 1) * P), peak = r => Math.max(...r);
  assert.equal(t.hist.length, P * RMAX);
  assert.ok(t.hist.every(v => v >= 0 && v < 2.5 && Number.isFinite(v)), 'heights stay in range');
  assert.notDeepEqual(Array.from(row(0)), Array.from(row(1)), 'neighbouring rows are different');
  assert.ok(peak(row(5)) > .15, 'a seeded stack already has mountains');
  const edge = r => Math.max(...r.slice(0, 12), ...r.slice(-12));
  assert.ok(edge(row(3)) < .1, 'the edges stay flat');
  // silence keeps producing rows
  const before = Array.from(row(0));
  t.update(1, { motion: true, audio: { level: 0, t: -1e9 } });
  assert.notDeepEqual(Array.from(row(1)), before.map(() => 0));
  assert.ok(t.update(.1, { motion: true, audio: { level: 0, t: -1e9 } }), 'keeps animating in silence');
  assert.equal(t.update(.1, { motion: false, audio: { level: 0 } }), false, 'sleeps when paused or hidden');
  // loud bass builds a bigger mountain in the middle than quiet music does
  const loud = Array.from({ length: 32 }, (_, i) => Math.exp(-i / 6)), quiet = loud.map(v => v * .03);
  global.performance = { now: () => 1000 };
  const mid = r => Math.max(...r.slice(P / 2 - 20, P / 2 + 20));
  let big = 0, small = 0;
  for (let n = 0; n < 40; n++) { t.agc = 1; big += mid(t.liveRow(loud, .8, .4)); t.agc = 1; small += mid(t.liveRow(quiet, .05, .4)); }
  assert.ok(big > small * 3, `loud ${big.toFixed(2)} should dwarf quiet ${small.toFixed(2)}`);
  const m = t.liveRow(loud, .8, .4), centre = mid(m), side = Math.max(...m.slice(10, 40));
  assert.ok(centre > side, 'lows sit in the middle in the pulsar layout');
  // history is newest-first: pushing shifts rows back by one
  const marker = new Float32Array(P).fill(.77); t.push(marker);
  assert.equal(row(0)[10], new Float32Array([.77])[0]); assert.equal(row(1).length, P);
});
