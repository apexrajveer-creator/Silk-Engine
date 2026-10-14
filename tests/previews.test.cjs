// Regression tests for 0.9.4: simulation previews starved the GPU at startup and every Display
// slider movement re-ran every simulation. These pin the policy that prevents both.
const test = require('node:test'), assert = require('node:assert/strict');
const load = name => import('../src/' + name);

test('built-in scenes at default settings use the bundled render (no GPU work)', async () => {
  const { usesBundledRender } = await load('shared/preview-policy.js');
  for (const scene of ['silk', 'fluid', 'lissajous', 'particles', 'terrain', 'life']) assert.equal(usesBundledRender({ kind: 'scene', scene, settings: {} }), true, scene);
});

test('a changed preset setting requires a real render; bird overlay settings do not', async () => {
  const { usesBundledRender } = await load('shared/preview-policy.js');
  assert.equal(usesBundledRender({ kind: 'scene', scene: 'silk', settings: { color: '#7a2cff' } }), false);
  assert.equal(usesBundledRender({ kind: 'scene', scene: 'silk', settings: { emblem: false, emblemSize: 50 } }), true);
});

test('preview cache key ignores the display look and the bird overlay', async () => {
  const { previewKey } = await load('shared/preview-policy.js');
  const a = previewKey({ scene: 'fluid', settings: { swirl: 70 } }, 640);
  const b = previewKey({ scene: 'fluid', settings: { swirl: 70, emblem: true, emblemPos: 'lower-left' } }, 640);
  assert.equal(a, b);
  assert.notEqual(a, previewKey({ scene: 'fluid', settings: { swirl: 71 } }, 640));
});

test('preview renders are capped at thumbnail size on HiDPI screens', async () => {
  const { previewKey, PREVIEW_MAX_WIDTH } = await load('shared/preview-policy.js');
  assert.equal(previewKey({ scene: 'silk', settings: {} }, 2560), previewKey({ scene: 'silk', settings: {} }, PREVIEW_MAX_WIDTH));
});

test('display look maps to a cheap CSS filter, neutral when untouched', async () => {
  const { lookFilter } = await load('shared/preview-policy.js');
  assert.equal(lookFilter({ brightness: 100, contrast: 100, saturation: 100, warmth: 0, oled: false }), 'none');
  assert.equal(lookFilter({}), 'none');
  assert.match(lookFilter({ brightness: 120 }), /^brightness\(1\.200\)$/);
  assert.match(lookFilter({ oled: true, oledStrength: 100 }), /contrast\(1\.280\)/);
  assert.match(lookFilter({ warmth: 40 }), /sepia/);
  assert.match(lookFilter({ warmth: -40 }), /hue-rotate/);
  assert.equal(lookFilter({ brightness: 'bogus' }), 'none');
});

test('preview pipeline encodes asynchronously and never with toDataURL', async () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/studio/previews.js'), 'utf8');
  assert.ok(!/toDataURL/.test(src), 'toDataURL blocks the main thread for the whole encode');
  assert.ok(/toBlob/.test(src));
  assert.ok(/indexedDB/.test(src), 'rendered presets must persist across launches');
});
