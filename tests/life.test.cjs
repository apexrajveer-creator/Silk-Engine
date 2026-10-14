// Cell Garden: the pattern library is checked against an independent reference implementation of Life, and the scene's
// planting, symmetry and gardening logic is run with a stand-in for the GL context.
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path'), { pathToFileURL } = require('node:url');
const root = path.join(__dirname, '..');
const load = () => import(pathToFileURL(path.join(root, 'src/renderer/scenes/life.js')).href);

// ---- reference Life on an infinite plane (sparse: only live cells are stored)
const OFF = 32768, key = (x, y) => (x + OFF) * 65536 + (y + OFF), unkey = k => [Math.floor(k / 65536) - OFF, (k % 65536) - OFF];
const world = list => new Set(list.map(([x, y]) => key(x, y)));
function advance(cellsSet, birth = [3], survive = [2, 3]) {
  const counts = new Map();
  for (const k of cellsSet) { const [x, y] = unkey(k); for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (dx || dy) { const n = key(x + dx, y + dy); counts.set(n, (counts.get(n) || 0) + 1); } }
  const next = new Set();
  for (const [k, n] of counts) if (cellsSet.has(k) ? survive.includes(n) : birth.includes(n)) next.add(k);
  return next;
}
const run = (w, gens, rule) => { for (let i = 0; i < gens; i++) w = advance(w, rule?.b, rule?.s); return w; };
const shifted = (set, dx, dy) => new Set([...set].map(k => { const [x, y] = unkey(k); return key(x + dx, y + dy); }));
const same = (a, b) => a.size === b.size && [...a].every(k => b.has(k));

test('every glider heading really travels the way its table entry says', async () => {
  const { PATTERNS, GLIDERS, cells } = await load();
  assert.equal(GLIDERS.length, 4);
  for (const g of GLIDERS) {
    const start = world(cells(PATTERNS.glider, g.fx, g.fy));
    const after = run(start, 40);                       // ten periods: one cell diagonally per period
    assert.ok(same(after, shifted(start, 10 * g.dx, 10 * g.dy)), `heading ${g.dx},${g.dy}`);
  }
});

test('the famous patterns behave exactly as published', async () => {
  const { PATTERNS, cells } = await load();
  const rp = world(cells(PATTERNS.rpentomino));
  assert.equal(run(rp, 1102).size === 116, false, 'still evolving one generation early');
  assert.equal(run(rp, 1103).size, 116, 'R-pentomino settles at 116 cells after 1103 generations');
  assert.equal(run(world(cells(PATTERNS.diehard)), 130).size, 0, 'diehard vanishes after 130 generations');
  const ac = world(cells(PATTERNS.acorn));
  assert.equal(run(ac, 5206).size, 633, 'acorn settles at 633 cells after 5206 generations');
  const sh = world(cells(PATTERNS.lwss));
  const moved = run(sh, 4);
  assert.ok(same(moved, shifted(sh, 2, 0)) || same(moved, shifted(sh, -2, 0)), 'the lightweight spaceship moves two cells every four generations');
});

test('the Gosper gun fires one glider every thirty generations', async () => {
  const { PATTERNS, cells } = await load();
  const gun = world(cells(PATTERNS.gun));
  assert.equal(gun.size, 36);
  let w = gun;
  for (let k = 1; k <= 8; k++) { w = run(w, 30); assert.equal(w.size, 36 + 5 * k, `after ${k} periods`); }
});

test('rules are the ones their names promise', async () => {
  const { RULES } = await load();
  assert.deepEqual(RULES.life, { b: [3], s: [2, 3] });
  assert.deepEqual(RULES.highlife, { b: [3, 6], s: [2, 3] });
  assert.deepEqual(RULES.daynight, { b: [3, 6, 7, 8], s: [3, 4, 6, 7, 8] });
  assert.deepEqual(RULES.seeds, { b: [2], s: [] });
  assert.deepEqual(RULES.coral, { b: [3], s: [4, 5, 6, 7, 8] });
  assert.equal(RULES.brain.brain, true);
  for (const r of Object.values(RULES)) for (const n of [...r.b, ...r.s]) assert.ok(n >= 0 && n <= 8);
  // what sets HighLife apart: a dead cell with exactly six live neighbours is born (it is not under Life)
  const six = world([[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1]]);
  assert.ok(advance(six, RULES.highlife.b, RULES.highlife.s).has(key(0, 0)), 'HighLife: born with six neighbours');
  assert.ok(!advance(six, RULES.life.b, RULES.life.s).has(key(0, 0)), 'Life: not born with six neighbours');
  // and Seeds: nothing ever survives, so a lone pair spawns its neighbours and itself vanishes
  const pair = world([[0, 0], [1, 0]]);
  const sd = advance(pair, RULES.seeds.b, RULES.seeds.s);
  assert.ok(!sd.has(key(0, 0)) && !sd.has(key(1, 0)), 'Seeds: every cell lives exactly one generation');
  assert.ok(sd.size > 0, 'Seeds: and the pair gave birth to others');
});

test('every pattern the gardener can plant exists and is well formed', async () => {
  const { PATTERNS, cells } = await load();
  for (const name of ['glider', 'rpentomino', 'acorn', 'diehard', 'lwss', 'gun']) {
    const rows = PATTERNS[name]; assert.ok(rows?.length, name);
    assert.ok(rows.every(r => r.length === rows[0].length && /^[.X]+$/.test(r)), `${name} rows`);
    assert.ok(cells(rows).length >= 5, name);
  }
});

// ---- the scene, with a stand-in for GL
const noop = () => {};
const fakeGL = () => new Proxy({}, { get: (_, k) => (typeof k === 'string' && /^[A-Z0-9_]+$/.test(k) ? 1 : noop) });
const tex = (w, h) => ({ w, h, tex: {}, fb: {} });
const fakeG = () => ({ gl: fakeGL(), program: () => ({}), free: noop, target: tex, texture: tex, use: noop, bindTarget: noop, draw: noop, emptyVao: {},
  pingpong: (w, h) => ({ read: tex(w, h), write: tex(w, h), w, h, swap() { const t = this.read; this.read = this.write; this.write = t; } }) });
async function scene(over = {}, size = [1920, 1080]) {
  const { default: Life } = await load();
  const { SCENES, defaults } = await import(pathToFileURL(path.join(root, 'src/shared/catalog.js')).href);
  const s = { ...defaults(SCENES.life.settings), ...over };
  const life = new Life(fakeG(), s); life.resize(size[0], size[1], 'high', false);
  return life;
}
const planted = life => { const out = []; for (let i = 0; i < life.gw * life.gh; i++) if (life.seedBuf[i * 4]) out.push([i % life.gw, Math.floor(i / life.gw)]); return out; };

test('the grid is sized from the cell size, with a little overscan for the camera', async () => {
  const life = await scene({ cell: 6 });
  assert.equal(life.cellPx, 6);
  assert.equal(life.gw, Math.ceil(1920 / 6 * 1.12)); assert.equal(life.gh, Math.ceil(1080 / 6 * 1.12));
  const big = await scene({ cell: 12 }); assert.ok(big.gw < life.gw / 1.9, 'bigger cells, fewer of them');
  const small = await scene({ cell: 6 }, [960, 540]); assert.equal(small.cellPx, 3, 'cells scale with the resolution so the picture keeps its proportions');
});

test('mirror and four-fold symmetry plant exact mirror images, so the garden stays a mandala', async () => {
  for (const [sym, count] of [['off', 1], ['mirror', 2], ['quad', 4]]) {
    const life = await scene({ symmetry: sym }); life.seedBuf.fill(0);
    life.plot(10, 5);
    const got = planted(life).map(String).sort(), W = life.gw, H = life.gh;
    const want = [[10, 5], [W - 1 - 10, 5], [10, H - 1 - 5], [W - 1 - 10, H - 1 - 5]].slice(0, sym === 'off' ? 1 : sym === 'mirror' ? 2 : 4).map(String).sort();
    assert.equal(got.length, count, sym); assert.deepEqual(got, want, sym);
  }
  const life = await scene({ symmetry: 'quad' }); life.seedBuf.fill(0);
  life.put('acorn', 40, 30); life.volley(3); life.sparks(4); life.paint(60, 50, 3, .6);
  const set = new Set(planted(life).map(String));
  for (const [x, y] of planted(life)) for (const m of [[life.gw - 1 - x, y], [x, life.gh - 1 - y], [life.gw - 1 - x, life.gh - 1 - y]]) assert.ok(set.has(String(m)), `${x},${y} has no mirror`);
});

test('wrapping and edges: wrap folds a plot onto the other side, no-wrap drops it', async () => {
  const a = await scene({ wrap: true }); a.seedBuf.fill(0); a.plot(-1, 0);
  assert.deepEqual(planted(a), [[a.gw - 1, 0]]);
  const b = await scene({ wrap: false }); b.seedBuf.fill(0); b.plot(-1, 0); b.plot(b.gw, 3);
  assert.deepEqual(planted(b), []);
});

test('planting tools put the right number of cells in range', async () => {
  const life = await scene({ symmetry: 'off', wrap: false }); life.seedBuf.fill(0);
  life.put('rpentomino', 50, 50); assert.equal(planted(life).length, 5);
  life.seedBuf.fill(0); life.volley(3); assert.equal(planted(life).length, 15, 'three five-cell gliders');
  assert.ok(planted(life).every(([x, y]) => x >= 0 && y >= 0 && x < life.gw && y < life.gh));
  life.seedBuf.fill(0); life.paint(60, 60, 2, 1); assert.equal(planted(life).length, 13, 'a radius-2 disc');
});

test('changing the rules, the symmetry or the edges starts a fresh garden; other settings do not', async () => {
  const life = await scene();
  life.needsReset = false;
  life.setSettings({ ...life.s, palette: 'amber', glow: 10 }); assert.equal(life.needsReset, false);
  life.setSettings({ ...life.s, rule: 'seeds' }); assert.equal(life.needsReset, true); life.needsReset = false;
  life.setSettings({ ...life.s, symmetry: 'quad' }); assert.equal(life.needsReset, true); life.needsReset = false;
  life.setSettings({ ...life.s, wrap: false }); assert.equal(life.needsReset, true);
});

test('the gardener: beats launch volleys, silence still plants, an empty garden is replanted, paused means asleep', async () => {
  const life = await scene(); const calls = { volley: 0, plant: 0, step: 0 };
  for (const [k, c] of [['volley', 'volley'], ['plantSomething', 'plant'], ['step', 'step']]) { const o = life[k].bind(life); life[k] = (...a) => { calls[c]++; return o(...a); }; }
  const inp = (audio, extra = {}) => ({ motion: true, audio, pointer: { active: false }, ...extra });
  assert.equal(life.update(.05, inp({ level: 0 }, { motion: false })), false, 'paused: asleep');
  calls.volley = 0;
  const live = { level: .6, beat: true, treble: 0, t: performance.now() };
  life.update(.05, inp(live)); assert.ok(calls.volley >= 1, 'a beat launches a volley');
  const before = calls.plant; life.garden = 0; life.update(.05, inp({ level: 0, t: -1e9 })); assert.ok(calls.plant > before, 'in silence the gardener still plants');
  life.pop = 0; const p0 = calls.plant; life.checkHealth(); assert.ok(calls.plant > p0, 'a dead garden (nothing alive) is replanted');
  const s0 = calls.step; life.update(.1, inp({ level: 0, t: -1e9 })); assert.ok(calls.step > s0, 'time advances in whole generations');
  assert.equal(life.update(.05, inp({ level: 0 })), true, 'keeps animating');
});

test('a hitch does not make it race: at most four generations per frame', async () => {
  const life = await scene(); let steps = 0; const o = life.step.bind(life); life.step = () => { steps++; return o(); };
  life.tick = 50;                                          // pretend we fell very far behind
  life.update(.016, { motion: true, audio: { level: 0, t: -1e9 }, pointer: { active: false } });
  assert.ok(steps <= 4, `ran ${steps} generations in one frame`);
  assert.ok(life.tick < 1, 'the backlog is dropped');
});

test('a volley is a tidy formation: exactly five cells per glider, all on one shared line, in range', async () => {
  const life = await scene({ symmetry: 'off', wrap: false });
  for (let round = 0; round < 120; round++) for (let n = 1; n <= 5; n++) {
    life.seedBuf.fill(0); life.volley(n);
    const cellsPlanted = planted(life);
    assert.equal(cellsPlanted.length, 5 * n, `volley of ${n}`);
    assert.ok(cellsPlanted.every(([x, y]) => x >= 0 && y >= 0 && x < life.gw && y < life.gh), 'inside the grid');
    // they enter from one edge, so along the edge direction the gliders are 7 cells apart
    const xs = [...new Set(cellsPlanted.map(c => Math.floor(c[0] / 7)))], ys = [...new Set(cellsPlanted.map(c => Math.floor(c[1] / 7)))];
    assert.ok(Math.min(xs.length, ys.length) <= 2, 'all gliders share one edge position');
  }
});

test('absurd loudness can never turn into a runaway loop: volleys and sparks are bounded', async () => {
  const life = await scene({ symmetry: 'off', wrap: false });
  for (const n of [Infinity, 1e9, NaN, -5, 3e9]) {
    life.seedBuf.fill(0);
    const t0 = Date.now(); life.volley(n); life.sparks(n);
    assert.ok(Date.now() - t0 < 500, `volley/sparks(${n}) took too long`);
    assert.ok(planted(life).length <= 8 * 5 + 8 * 5, `${n} planted ${planted(life).length} cells`);
  }
});
test('the garden keeps its frame rate when the music reports nonsense', async () => {
  const life = await scene();
  const t0 = Date.now();
  for (const v of [Infinity, 1e9, NaN, -1, 5]) for (let i = 0; i < 20; i++) life.update(.05, { motion: true, audio: { level: v, treble: v, bass: v, beat: true, t: performance.now() }, pointer: { active: false } });
  assert.ok(Date.now() - t0 < 4000, `took ${Date.now() - t0} ms`);
  assert.ok(Number.isFinite(life.prevLevel) && Number.isFinite(life.punch) && Number.isFinite(life.gen));
});
