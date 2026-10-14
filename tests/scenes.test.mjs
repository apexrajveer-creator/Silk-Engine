// Every built-in scene is exercised through a stand-in GL context that records each GPU allocation: hostile audio, hostile
// time steps, hostile pointer input, wild resizes, every option of every setting, and a leak check (everything a scene
// allocates must be released on dispose, even after repeated resizes). Rendering itself needs a GPU and is covered by the
// browser and stress tests; this is the scene LOGIC.
import test from 'node:test';
import assert from 'node:assert/strict';

const { SCENES, defaults, resolved } = await import('../src/shared/catalog.js');
const { fitArea, fitLong, rand } = await import('../src/renderer/scenes/util.js');
const classes = {};
for (const id of Object.keys(SCENES)) classes[id] = (await import(`../src/renderer/scenes/${id === 'lissajous' ? 'lissajous' : id}.js`)).default;

const noop = () => {};
const glStub = () => new Proxy({}, { get: (_, k) => (typeof k === 'string' && /^[A-Z0-9_]+$/.test(k) ? 1 : noop) });
/** A GL helper that tracks every texture / framebuffer handed out, like the real one tracks bytes. */
function makeG() {
  const live = new Set();
  const mk = (w, h) => { const t = { w, h, tex: {}, fb: {}, size: 1 }; live.add(t); return t; };
  return {
    live, gl: glStub(), float: true, p3: false, emptyVao: {}, vao: {}, black: { w: 1, h: 1, tex: {}, fb: {}, size: 1 },
    program: () => ({ u: {} }), target: mk, texture: mk, use: noop, bindTarget: noop, draw: noop, mip: noop,
    pingpong: (w, h) => ({ read: mk(w, h), write: mk(w, h), w, h, swap() { const t = this.read; this.read = this.write; this.write = t; } }),
    free(t) { if (!t) return; if (t.read) { live.delete(t.read); live.delete(t.write); return; } live.delete(t); },
  };
}
const audio = (over = {}) => ({ level: .4, bass: .3, mid: .2, treble: .2, beat: false, bands: Array(32).fill(.3), t: performance.now(), ...over });
const input = (a = audio(), pointer = {}, motion = true) => ({ motion, audio: a, pointer: { active: false, x: .5, y: .5, down: false, clicked: false, ...pointer }, oled: false });
const run = (scene, inp, frames = 4, dt = .03) => { for (let i = 0; i < frames; i++) { scene.update(dt, inp); scene.render(inp); } };
const make = (id, settings = {}, size = [1280, 720]) => {
  const g = makeG(), scene = new classes[id](g, resolved(SCENES[id].settings, settings));
  scene.resize(size[0], size[1], 'high', false);
  return { g, scene };
};

// ---------------------------------------------------------------- utilities
test('fitArea: never enlarges, keeps the aspect ratio and respects the pixel budget', () => {
  assert.deepEqual(fitArea(1000, 500, 1e9), [1000, 500]);
  const [w, h] = fitArea(3840, 2160, 2.1e6);
  assert.ok(w * h <= 2.1e6 * 1.01 && Math.abs(w / h - 16 / 9) < .01, `${w}x${h}`);
});
test('fitArea: never returns less than 8 pixels, whatever it is given', () => {
  for (const [w, h, mp] of [[0, 0, 1e6], [1, 1, 1e6], [5000, 5000, 1], [-5, -5, 1e6], [1e7, 1e7, 1e6]]) {
    const [a, b] = fitArea(w, h, mp); assert.ok(a >= 8 && b >= 8 && Number.isFinite(a) && Number.isFinite(b), `${w}x${h} -> ${a}x${b}`);
  }
});
test('fitLong: caps the long side, never enlarges, keeps a minimum', () => {
  assert.deepEqual(fitLong(4000, 2000, 1000), [1000, 500]);
  assert.deepEqual(fitLong(500, 400, 1000), [500, 400]);
  const [a, b] = fitLong(0, 0, 100); assert.ok(a >= 8 && b >= 8);
});
test('rand: stays within its range', () => {
  for (let i = 0; i < 2000; i++) { const v = rand(5, 7); assert.ok(v >= 5 && v < 7); }
  for (let i = 0; i < 200; i++) { const v = rand(); assert.ok(v >= 0 && v < 1); }
});

// ---------------------------------------------------------------- every scene
for (const id of Object.keys(SCENES)) {
  test(`${id}: starts, draws, and exposes an output`, () => {
    const { scene } = make(id); run(scene, input(), 3);
    assert.ok(scene.output, 'no output target');
  });

  test(`${id}: survives hostile audio (NaN, Infinity, negatives, huge, wrong-length and missing bands)`, () => {
    const { scene } = make(id);
    const nasty = [NaN, Infinity, -Infinity, -1, 1e9, undefined, null, '0.5'];
    for (const v of nasty) run(scene, input(audio({ level: v, bass: v, mid: v, treble: v })), 2);
    for (const bands of [[], undefined, null, Array(1).fill(.5), Array(200).fill(.5), Array(32).fill(NaN), Array(32).fill(-5), Array(32).fill(1e9), Array(32).fill('x')]) run(scene, input(audio({ bands })), 2);
    for (const t of [undefined, NaN, -1, 1e15, 0]) run(scene, input(audio({ t, beat: true })), 2);
    run(scene, input(undefined), 2);
  });

  test(`${id}: survives hostile time steps (zero, negative, NaN, a minute-long hitch)`, () => {
    const { scene } = make(id);
    for (const dt of [0, -1, NaN, 60, 1e9, 1e-9, Infinity]) run(scene, input(), 2, dt);
  });

  test(`${id}: survives hostile pointer input`, () => {
    const { scene } = make(id);
    for (const p of [{ active: true, x: -5, y: 1e9 }, { active: true, x: NaN, y: NaN }, { active: true, x: .5, y: .5, down: true, clicked: true }, { active: true, x: 1, y: 1 }, { active: true, x: 0, y: 0, down: true }, {}, { active: true }]) run(scene, input(audio(), p), 3);
  });

  test(`${id}: survives wild resizes, including tiny and huge`, () => {
    const { scene } = make(id);
    for (const [w, h] of [[1920, 1080], [8, 8], [1, 1], [0, 0], [3840, 2160], [100, 100000], [100000, 100], [640, 360], [7680, 4320]]) { scene.resize(w, h, 'high', false); run(scene, input(), 1); }
    for (const q of ['eco', 'balanced', 'high', 'ultra', 'auto', 'preview', 'nonsense', undefined]) { scene.resize(1280, 720, q, false); run(scene, input(), 1); }
    scene.resize(1280, 720, 'high', true); run(scene, input(), 1);
  });

  test(`${id}: every option of every setting works (sliders at both ends, every choice, switches both ways)`, () => {
    const schema = SCENES[id].settings, { scene } = make(id);
    let tried = 0;
    for (const s of schema) {
      const values = s.type === 'slider' ? [s.min, s.max, (s.min + s.max) / 2] : s.type === 'combo' ? s.options.map(o => o[0]) : s.type === 'bool' ? [true, false] : ['#000000', '#ffffff', '#336699'];
      for (const v of values) { scene.setSettings(resolved(schema, { [s.key]: v })); scene.resize(1280, 720, 'high', false); run(scene, input(), 2); tried++; }
    }
    assert.ok(tried >= schema.length * 2, `only tried ${tried}`);
  });

  test(`${id}: once it has drawn what it owes, a paused scene (no motion) does no work and says it is asleep`, () => {
    const { scene } = make(id);
    run(scene, input(), 2);   // a new scene may still owe its opening frame (fluid's first ink burst); draw it first
    assert.equal(scene.update(.03, input(audio(), {}, false)), false);
  });

  test(`${id}: releases every GPU resource it allocated, even after resizing, and disposing twice is harmless`, () => {
    const { g, scene } = make(id); run(scene, input(), 3);
    for (const [w, h] of [[640, 360], [1920, 1080], [800, 600], [1280, 720]]) { scene.resize(w, h, 'high', false); run(scene, input(), 1); }
    scene.dispose();
    assert.equal(g.live.size, 0, `${g.live.size} GPU allocations leaked`);
    assert.doesNotThrow(() => scene.dispose());
    assert.equal(g.live.size, 0);
  });
}

// ---------------------------------------------------------------- Cell Garden: the full rules x symmetry x wrap matrix
for (const rule of ['life', 'highlife', 'daynight', 'seeds', 'coral', 'brain']) {
  test(`life: rule ${rule} runs under every symmetry and edge mode and keeps the garden alive`, () => {
    for (const symmetry of ['off', 'mirror', 'quad']) for (const wrap of [true, false]) {
      const { scene } = make('life', { rule, symmetry, wrap });
      run(scene, input(audio({ beat: true, level: .7 }), { active: true, x: .4, y: .6, down: true }), 12, .05);
      assert.ok(Number.isFinite(scene.gen) && Number.isFinite(scene.phase) && scene.phase >= 0 && scene.phase <= 1, `${rule}/${symmetry}/${wrap}`);
      assert.ok(scene.seedBuf.length === scene.gw * scene.gh * 4);
    }
  });
}
test('life: extreme cell sizes keep the grid in a sane range', () => {
  for (const cell of [3, 16]) for (const [w, h] of [[1920, 1080], [3840, 2160], [640, 360]]) {
    const { scene } = make('life', { cell }, [w, h]);
    assert.ok(scene.gw >= 24 && scene.gh >= 24 && scene.gw * scene.gh <= 2_000_000, `cell ${cell} at ${w}x${h}: ${scene.gw}x${scene.gh}`);
  }
});

// ---------------------------------------------------------------- Spectral Terrain
test('terrain: heights stay finite and bounded under any audio', () => {
  const { scene } = make('terrain');
  const P = 208;
  for (const bands of [Array(32).fill(1e9), Array(32).fill(NaN), Array(32).fill(-1), Array(32).fill(0), [], undefined]) run(scene, input(audio({ bands, level: .9, beat: true })), 6, .3);
  assert.ok(scene.hist.every(v => Number.isFinite(v) && v >= 0 && v < 5), 'a height left the plausible range');
  assert.equal(scene.hist.length, P * 130);
});
test('terrain: every row count and layout produces a full stack', () => {
  for (const rows of [30, 70, 110]) for (const layout of ['pulsar', 'spectrum']) { const { scene } = make('terrain', { rows, layout }); run(scene, input(), 3); assert.ok(scene.output); }
});
