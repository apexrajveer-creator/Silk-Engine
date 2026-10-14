// The settings catalog drives the Studio's controls AND what each scene is allowed to receive, so a mistake here shows up
// everywhere. Every schema in the app is checked for structural validity, and `resolved()` (the gate between saved
// settings and the renderer) is attacked with hostile values.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { DISPLAY, SYSTEM, SCENES, MEDIA, schemaFor, defaults, resolved, visible, hexRGB, hsv, paletteColor, PALETTES } = await import('../src/shared/catalog.js');

const schemas = [
  ['display', DISPLAY], ['system', SYSTEM],
  ...Object.entries(MEDIA).map(([k, s]) => [`media:${k}`, s]),
  ...Object.entries(SCENES).map(([k, v]) => [`scene:${k}`, v.settings]),
];
const KNOWN_TYPES = new Set(['slider', 'bool', 'combo', 'color']);

// ---------------------------------------------------------------- structure, one block of tests per schema
for (const [name, schema] of schemas) {
  test(`${name}: every setting has a unique key and a readable label`, () => {
    const keys = schema.map(s => s.key);
    assert.ok(keys.length > 0, 'a schema with no settings');
    assert.equal(new Set(keys).size, keys.length, `duplicate keys: ${keys.filter((k, i) => keys.indexOf(k) !== i)}`);
    for (const s of schema) {
      assert.match(s.key, /^[a-zA-Z][a-zA-Z0-9]*$/, `key ${s.key}`);
      assert.ok(KNOWN_TYPES.has(s.type), `${s.key}: unknown type ${s.type}`);
      assert.ok(typeof s.label === 'string' && s.label.trim().length > 1, `${s.key}: no label`);
    }
  });

  test(`${name}: ranges, options and defaults are consistent`, () => {
    for (const s of schema) {
      if (s.type === 'slider') {
        assert.ok(Number.isFinite(s.min) && Number.isFinite(s.max) && s.min < s.max, `${s.key}: bad range ${s.min}..${s.max}`);
        assert.ok(Number.isFinite(s.value) && s.value >= s.min && s.value <= s.max, `${s.key}: default ${s.value} outside ${s.min}..${s.max}`);
      } else if (s.type === 'combo') {
        assert.ok(Array.isArray(s.options) && s.options.length >= 2, `${s.key}: a choice needs options`);
        const values = s.options.map(o => o[0]);
        assert.equal(new Set(values).size, values.length, `${s.key}: duplicate option values`);
        assert.ok(s.options.every(o => Array.isArray(o) && o.length === 2 && typeof o[1] === 'string' && o[1].length), `${s.key}: option labels`);
        assert.ok(values.includes(s.value), `${s.key}: default ${s.value} is not one of ${values}`);
      } else if (s.type === 'bool') {
        assert.equal(typeof s.value, 'boolean', `${s.key}: default must be true or false`);
      } else if (s.type === 'color') {
        assert.match(s.value, /^#[0-9a-f]{6}$/i, `${s.key}: default colour`);
      }
    }
  });

  test(`${name}: "only show when" rules point at real settings and real values`, () => {
    const byKey = Object.fromEntries(schema.map(s => [s.key, s]));
    for (const s of schema.filter(x => x.when)) {
      assert.ok(Array.isArray(s.when) && s.when.length === 2, `${s.key}: malformed when`);
      const dep = byKey[s.when[0]];
      assert.ok(dep, `${s.key} depends on "${s.when[0]}", which does not exist`);
      assert.notEqual(dep.key, s.key, `${s.key} depends on itself`);
      if (dep.type === 'combo') assert.ok(dep.options.some(o => o[0] === s.when[1]), `${s.key}: "${s.when[1]}" is not an option of ${dep.key}`);
      if (dep.type === 'bool') assert.equal(typeof s.when[1], 'boolean');
    }
  });

  test(`${name}: resolving nothing gives exactly the defaults`, () => {
    assert.deepEqual(resolved(schema, {}), defaults(schema));
    assert.deepEqual(resolved(schema, undefined), defaults(schema));
    assert.deepEqual(resolved(schema, null), defaults(schema));
  });
}

// ---------------------------------------------------------------- each built-in scene is complete
for (const [id, scene] of Object.entries(SCENES)) {
  test(`scene ${id}: has a name, a description, a type tag and a bundled thumbnail`, () => {
    assert.ok(scene.name?.length > 2, 'name');
    assert.ok(scene.desc?.length > 20, 'description');
    assert.ok(scene.tag?.length > 2, 'tag');
    assert.ok(scene.thumb, 'thumb path');
    assert.ok(fs.existsSync(path.join(root, 'src', scene.thumb)), `${scene.thumb} is missing`);
    assert.ok(fs.statSync(path.join(root, 'src', scene.thumb)).size > 2_000, 'the thumbnail looks empty');
    assert.ok(Array.isArray(scene.settings) && scene.settings.length > 3, 'settings');
  });
}

test('every built-in scene id the app creates exists in the catalog, and vice versa', () => {
  const rust = fs.readFileSync(path.join(root, 'src-tauri/src/config.rs'), 'utf8');
  const builtins = [...rust.matchAll(/\("(\w+)", "([^"]+)"\),/g)].map(m => m[1]).filter(id => id in SCENES || ['silk', 'fluid', 'lissajous', 'particles', 'terrain', 'life'].includes(id));
  assert.deepEqual([...new Set(builtins)].sort(), Object.keys(SCENES).sort());
});

// ---------------------------------------------------------------- resolved(): the gate between saved settings and the renderer
const slider = { key: 's', type: 'slider', min: 10, max: 90, value: 50 };
const combo = { key: 'c', type: 'combo', value: 'a', options: [['a', 'A'], ['b', 'B']] };
const bool = { key: 'b', type: 'bool', value: false };
const color = { key: 'k', type: 'color', value: '#112233' };
const small = [slider, combo, bool, color];

test('resolved: sliders are clamped to their range on both sides', () => {
  assert.equal(resolved(small, { s: 1e9 }).s, 90);
  assert.equal(resolved(small, { s: -1e9 }).s, 10);
  assert.equal(resolved(small, { s: 10 }).s, 10);
  assert.equal(resolved(small, { s: 90 }).s, 90);
  assert.equal(resolved(small, { s: 33.5 }).s, 33.5);
});
test('resolved: a slider ignores anything that is not a finite number', () => {
  for (const bad of [NaN, Infinity, -Infinity, '40', '', null, undefined, {}, [], true, () => 1]) assert.equal(resolved(small, { s: bad }).s, 50, String(bad));
});
test('resolved: a switch only accepts true or false', () => {
  assert.equal(resolved(small, { b: true }).b, true);
  for (const bad of ['true', 1, 0, null, {}, 'on']) assert.equal(resolved(small, { b: bad }).b, false, String(bad));
});
test('resolved: a choice only accepts one of its options', () => {
  assert.equal(resolved(small, { c: 'b' }).c, 'b');
  for (const bad of ['z', '', 'B', null, 1, {}, ['b']]) assert.equal(resolved(small, { c: bad }).c, 'a', String(bad));
});
test('resolved: a colour must be a full #rrggbb value', () => {
  assert.equal(resolved(small, { k: '#ABCDEF' }).k, '#ABCDEF');
  for (const bad of ['#abc', 'abcdef', '#abcdeg', '#abcdef00', 'red', '', null, 7, 'url(x)', '#12345']) assert.equal(resolved(small, { k: bad }).k, '#112233', String(bad));
});
test('resolved: unknown keys are dropped and the result has exactly the schema keys', () => {
  const r = resolved(small, { s: 20, extra: 1, __proto__: { evil: 1 }, constructor: 'x' });
  assert.deepEqual(Object.keys(r).sort(), ['b', 'c', 'k', 's']);
  assert.equal(r.evil, undefined);
});
test('resolved: odd containers do not throw', () => {
  for (const v of [[], 'string', 42, true, Object.create(null), new Proxy({}, {}), [1, 2, 3]]) assert.doesNotThrow(() => resolved(small, v));
});
test('resolved: a schema with no settings resolves to nothing', () => {
  assert.deepEqual(resolved([], { a: 1 }), {});
});

// a deterministic fuzz over every real schema: whatever is thrown at it, the result is valid and stable
const pool = [NaN, Infinity, -Infinity, 0, -0, 1, -1, 50, 1e308, -1e308, 5e-324, '', 'x', '#fff', '#ABCDEF', '#00ff00', 'true', null, undefined, {}, [], true, false, 'cover', 'rgb', 'phosphor'];
let seed = 12345;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const pickv = () => pool[Math.floor(rnd() * pool.length)];
for (const [name, schema] of schemas) {
  test(`fuzz: ${name} survives 300 random settings objects and stays valid and idempotent`, () => {
    for (let i = 0; i < 300; i++) {
      const input = Object.fromEntries(schema.map(s => [s.key, pickv()]).filter(() => rnd() > .2));
      const r = resolved(schema, input);
      assert.deepEqual(Object.keys(r).sort(), schema.map(s => s.key).sort());
      for (const s of schema) {
        const v = r[s.key];
        if (s.type === 'slider') assert.ok(Number.isFinite(v) && v >= s.min && v <= s.max, `${s.key}=${v}`);
        if (s.type === 'bool') assert.equal(typeof v, 'boolean');
        if (s.type === 'combo') assert.ok(s.options.some(o => o[0] === v), `${s.key}=${v}`);
        if (s.type === 'color') assert.match(v, /^#[0-9a-f]{6}$/i);
      }
      assert.deepEqual(resolved(schema, r), r, 'resolving twice must change nothing');
    }
  });
}

// ---------------------------------------------------------------- visible / schemaFor / defaults
test('visible: always true without a rule, and follows the rule\'s value with one', () => {
  assert.equal(visible({ key: 'a' }, {}), true);
  const s = { key: 'a', when: ['mode', 'x'] };
  assert.equal(visible(s, { mode: 'x' }), true);
  assert.equal(visible(s, { mode: 'y' }), false);
  assert.equal(visible(s, {}), false);
});
test('schemaFor: scenes and media kinds map to their schema, everything else to none', () => {
  assert.equal(schemaFor({ kind: 'scene', scene: 'life' }), SCENES.life.settings);
  assert.equal(schemaFor({ kind: 'video' }), MEDIA.video);
  assert.equal(schemaFor({ kind: 'image' }), MEDIA.image);
  assert.equal(schemaFor({ kind: 'web' }), MEDIA.web);
  for (const bad of [null, undefined, {}, { kind: 'scene', scene: 'nope' }, { kind: 'skin' }, { kind: 'scene' }, { kind: 'constructor' }]) assert.deepEqual(schemaFor(bad), [], JSON.stringify(bad));
});
test('defaults: one value per setting, taken from the schema', () => {
  assert.deepEqual(defaults(small), { s: 50, c: 'a', b: false, k: '#112233' });
  assert.deepEqual(defaults([]), {});
});

// ---------------------------------------------------------------- colour helpers
test('hexRGB: reads #rrggbb with or without the #, in any case', () => {
  assert.deepEqual(hexRGB('#ff0000'), [1, 0, 0]);
  assert.deepEqual(hexRGB('00FF00'), [0, 1, 0]);
  assert.deepEqual(hexRGB('#0000ff'), [0, 0, 1]);
  const [r, g, b] = hexRGB('#336699'); assert.ok(Math.abs(r - .2) < 1e-9 && Math.abs(g - .4) < 1e-9 && Math.abs(b - .6) < 1e-9);
});
test('hexRGB: anything else becomes white instead of throwing or producing NaN', () => {
  for (const bad of ['', '#fff', '#12345', '#1234567', 'blue', null, undefined, 42, {}, '#gggggg']) assert.deepEqual(hexRGB(bad), [1, 1, 1], String(bad));
});
test('hsv: the primary hues, greys and wrap-around', () => {
  const near = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 1e-9);
  assert.ok(near(hsv(0, 1, 1), [1, 0, 0]));
  assert.ok(near(hsv(1 / 3, 1, 1), [0, 1, 0]));
  assert.ok(near(hsv(2 / 3, 1, 1), [0, 0, 1]));
  assert.ok(near(hsv(.5, 0, .4), [.4, .4, .4]), 'no saturation is a grey');
  assert.ok(near(hsv(1, 1, 1), hsv(0, 1, 1)), 'a full turn is the same hue');
  assert.ok(near(hsv(.3, 1, 0), [0, 0, 0]), 'no value is black');
});
test('paletteColor: mono follows the custom colour and never exceeds white', () => {
  for (const t of [0, .5, 1]) assert.ok(paletteColor('mono', '#ffffff', t).every(x => x >= 0 && x <= 1), `t=${t}`);
  const dim = paletteColor('mono', '#808080', 0), bright = paletteColor('mono', '#808080', 1);
  assert.ok(bright[0] > dim[0], 'a larger t is brighter');
});
test('paletteColor: named palettes return one of their colours; unknown names get a spectrum hue', () => {
  const allowed = PALETTES.cobalt.map(h => hexRGB(h).join());
  for (const t of [0, .26, .51, .99]) assert.ok(allowed.includes(paletteColor('cobalt', '#fff', t).join()));
  const h = paletteColor('does-not-exist', '#fff', .5); assert.equal(h.length, 3); assert.ok(h.every(Number.isFinite));
});
test('paletteColor: odd values of t still give a usable colour (shaders must never receive NaN)', () => {
  for (const name of ['mono', 'cobalt', 'spectrum', 'ember', 'nope']) for (const t of [NaN, -1, -.3, 1.7, 100, Infinity, undefined]) {
    const c = paletteColor(name, '#336699', t);
    assert.ok(c.length === 3 && c.every(x => Number.isFinite(x) && x >= 0 && x <= 1), `${name} t=${t} -> ${c}`);
  }
});
