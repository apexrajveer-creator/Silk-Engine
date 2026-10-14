// Theme sync colour picking (src/shared/accent.js).
const test = require('node:test'), assert = require('node:assert/strict');
const load = () => import('../src/shared/accent.js');
const image = (pixels) => { const out = new Uint8ClampedArray(pixels.length * 4); pixels.forEach(([r, g, b], i) => out.set([r, g, b, 255], i * 4)); return out; };
const fill = (n, c) => Array.from({ length: n }, () => c);
const parts = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

test('the dominant colourful area wins over a few vivid pixels', async () => {
  const { accentFrom } = await load();
  const [r, g, b] = parts(accentFrom(image([...fill(900, [20, 50, 160]), ...fill(40, [255, 0, 0])])));
  assert.ok(b > r && b > g, `expected blue, got ${r},${g},${b}`);
});

test('black and grey areas do not vote', async () => {
  const { accentFrom } = await load();
  const [r, g, b] = parts(accentFrom(image([...fill(950, [8, 8, 8]), ...fill(200, [120, 120, 120]), ...fill(60, [200, 90, 20])])));
  assert.ok(r > g && r > b, `expected orange, got ${r},${g},${b}`);
});

test('greyscale wallpapers get a neutral slate, not a random hue', async () => {
  const { accentFrom } = await load();
  const [r, g, b] = parts(accentFrom(image(fill(1000, [90, 90, 90]))));
  assert.ok(Math.max(r, g, b) - Math.min(r, g, b) < 40, 'low saturation');
});

test('result is always legible: never neon, never near-black', async () => {
  const { accentFrom } = await load();
  for (const c of [[255, 0, 0], [0, 255, 0], [10, 0, 30], [255, 255, 0], [0, 0, 255]]) {
    const p = parts(accentFrom(image(fill(500, c)))), mx = Math.max(...p) / 255, mn = Math.min(...p) / 255;
    assert.ok(mx >= 0.49 && mx <= 0.87, `brightness in range for ${c}: ${p}`);
    assert.ok((mx - mn) / mx <= 0.91, `saturation capped for ${c}: ${p}`);
  }
});

test('handles empty and malformed input', async () => {
  const { accentFrom } = await load();
  assert.match(accentFrom(new Uint8ClampedArray(0)), /^#[0-9a-f]{6}$/);
  assert.match(accentFrom(new Uint8ClampedArray(7)), /^#[0-9a-f]{6}$/);
});

// ---- RGB colour modes pin the taskbar to a dark neutral
test('the RGB-mode accent is a dark, near-neutral grey', async () => {
  const { RGB_MODE_ACCENT } = await load();
  assert.match(RGB_MODE_ACCENT, /^#[0-9a-f]{6}$/);
  const [r, g, b] = parts(RGB_MODE_ACCENT);
  assert.ok(Math.max(r, g, b) <= 0x30, `dark enough to read as black / dark grey: ${RGB_MODE_ACCENT}`);
  assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 6, 'no visible tint');
});

test('only scenes in an RGB palette count as RGB mode', async () => {
  const { isRgbMode } = await load();
  const scene = { kind: 'scene', scene: 'life' };
  assert.equal(isRgbMode(scene, { palette: 'rgb' }), true);
  for (const p of ['phosphor', 'blue', 'white', 'custom', undefined]) assert.equal(isRgbMode(scene, { palette: p }), false, String(p));
  assert.equal(isRgbMode(scene, undefined), false);
  assert.equal(isRgbMode({ kind: 'video' }, { palette: 'rgb' }), false, 'a video has no palette to cycle');
  assert.equal(isRgbMode({ kind: 'web' }, { palette: 'rgb' }), false);
  assert.equal(isRgbMode(undefined, { palette: 'rgb' }), false);
});

test('accentFor: RGB mode is constant whatever the picture does, and never reads pixels; other modes follow the picture', async () => {
  const { accentFor, accentFrom, RGB_MODE_ACCENT } = await load();
  const rgb = { kind: 'scene', scene: 'terrain' }, set = { palette: 'rgb' };
  let reads = 0;
  const colours = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 200, 0]];
  const seen = new Set(colours.map(c => accentFor(rgb, set, () => { reads++; return image(fill(100, c)); })));
  assert.deepEqual([...seen], [RGB_MODE_ACCENT], 'the rainbow never reaches the taskbar');
  assert.equal(reads, 0, 'RGB mode does not even read the picture');
  const blue = image(fill(100, [20, 50, 160]));
  assert.equal(accentFor(rgb, { palette: 'blue' }, () => blue), accentFrom(blue), 'a normal palette follows the picture');
  assert.equal(accentFor({ kind: 'video' }, {}, () => blue), accentFrom(blue));
});

test('every scene that offers an RGB palette is covered, and none defaults to it', async () => {
  const { SCENES } = await import('../src/shared/catalog.js');
  const { isRgbMode } = await load();
  const withRgb = Object.entries(SCENES).filter(([, s]) => s.settings.some(x => x.key === 'palette' && x.options?.some(([v]) => v === 'rgb')));
  assert.deepEqual(withRgb.map(([id]) => id).sort(), ['life', 'lissajous', 'terrain'], 'a new RGB mode needs a decision: does it want the dark taskbar too?');
  for (const [id, s] of withRgb) {
    assert.equal(isRgbMode({ kind: 'scene', scene: id }, { palette: 'rgb' }), true, id);
    assert.notEqual(s.settings.find(x => x.key === 'palette').value, 'rgb', `${id} must not default to RGB`);
  }
});
