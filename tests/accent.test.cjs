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
