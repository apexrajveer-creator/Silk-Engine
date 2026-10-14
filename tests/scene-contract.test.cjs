// The renderer calls a handful of methods on whatever scene is playing (some only inside the real app, where the browser
// preview and its tests never run, e.g. the heartbeat's `scene?.health?.()`). `?.()` protects against a method that is
// MISSING, not against a field of the same name that is not a function, which throws on every call. So: no scene may
// give an instance field the name of a method the renderer calls.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { pathToFileURL } = require('node:url');
const root = path.join(__dirname, '..'), dir = path.join(root, 'src/renderer/scenes');
const main = fs.readFileSync(path.join(root, 'src/renderer/main.js'), 'utf8');
const called = [...new Set([...main.matchAll(/scene\??\.(\w+)\??\.?\(/g)].map(m => m[1]))];
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'util.js');

test('the list of methods the renderer calls on a scene is what this test thinks it is', () => {
  for (const m of ['update', 'render', 'resize', 'setSettings', 'dispose', 'health']) assert.ok(called.includes(m), `main.js no longer calls ${m}: update this test`);
});

test('no scene shadows a method the renderer calls with a field of the same name', () => {
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const name of called) {
      const assigned = new RegExp(`this\\.${name}\\s*=[^=]`).test(src), defined = new RegExp(`^\\s*${name}\\s*\\(`, 'm').test(src);
      assert.ok(!assigned || defined, `${f} assigns this.${name} but main.js calls ${name}() on scenes: rename the field`);
    }
  }
});

test('at runtime, every optional method the renderer calls is either absent or a function (Cell Garden, Spectral Terrain)', async () => {
  const noop = () => {};
  const gl = new Proxy({}, { get: (_, k) => (typeof k === 'string' && /^[A-Z0-9_]+$/.test(k) ? 1 : noop) });
  const tex = (w, h) => ({ w, h, tex: {}, fb: {} });
  const g = { gl, program: () => ({}), free: noop, target: tex, texture: tex, use: noop, bindTarget: noop, draw: noop, emptyVao: {},
    pingpong: (w, h) => ({ read: tex(w, h), write: tex(w, h), w, h, swap() { const t = this.read; this.read = this.write; this.write = t; } }) };
  const { SCENES, defaults } = await import(pathToFileURL(path.join(root, 'src/shared/catalog.js')).href);
  for (const [file, id] of [['life.js', 'life'], ['terrain.js', 'terrain']]) {
    const { default: Scene } = await import(pathToFileURL(path.join(dir, file)).href);
    const scene = new Scene(g, defaults(SCENES[id].settings)); scene.resize(1920, 1080, 'high', false);
    for (const name of called) assert.ok(scene[name] === undefined || typeof scene[name] === 'function', `${id}.${name} is a ${typeof scene[name]}, but the renderer calls it`);
    // and exercise the heartbeat exactly as main.js does, over a few frames of life
    for (let i = 0; i < 5; i++) { scene.update(.05, { motion: true, audio: { level: 0 }, pointer: { active: false } }); scene.render({}); scene?.health?.(); }
  }
});
