// Audio goes from the capture thread into every scene. This is the one place that makes it safe.
import test from 'node:test';
import assert from 'node:assert/strict';
const { sanitizeAudio, BANDS } = await import('../src/shared/audio-input.js');

test('good input passes through unchanged', () => {
  const bands = Array.from({ length: 32 }, (_, i) => i / 31), wave = Array.from({ length: 128 }, (_, i) => Math.sin(i / 9));
  const out = sanitizeAudio({ bass: .3, mid: .5, treble: .7, bands, wave });
  assert.equal(out.bass, .3); assert.equal(out.mid, .5); assert.equal(out.treble, .7);
  assert.deepEqual(out.bands, bands); assert.deepEqual(out.wave, wave);
});
test('bass, mid and treble are always between 0 and 1', () => {
  const out = sanitizeAudio({ bass: 5, mid: -3, treble: 1e300 });
  assert.deepEqual([out.bass, out.mid, out.treble], [1, 0, 1]);
});
test('NaN, Infinity and non-numbers become 0, so nothing downstream can be poisoned', () => {
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, '0.5', {}, [], true, () => 1]) {
    const out = sanitizeAudio({ bass: bad, mid: bad, treble: bad });
    assert.deepEqual([out.bass, out.mid, out.treble], [0, 0, 0], String(bad));
  }
});
test('the bands are always exactly 32 numbers between 0 and 1', () => {
  for (const bands of [[], [.5], Array(200).fill(.5), Array(32).fill(NaN), Array(32).fill(-9), Array(32).fill(1e9), Array(32).fill('x'), [.2, null, undefined, Infinity]]) {
    const out = sanitizeAudio({ bands }).bands;
    assert.equal(out.length, BANDS);
    assert.ok(out.every(v => Number.isFinite(v) && v >= 0 && v <= 1), JSON.stringify(bands).slice(0, 40));
  }
});
test('short bands are padded with silence, long ones are cut', () => {
  assert.deepEqual(sanitizeAudio({ bands: [1, .5] }).bands.slice(0, 3), [1, .5, 0]);
  assert.equal(sanitizeAudio({ bands: Array(500).fill(1) }).bands.length, 32);
});
test('no bands sent means null, not a made-up spectrum', () => {
  for (const raw of [{}, { bands: null }, { bands: 'abc' }, { bands: {} }, { bands: 5 }]) assert.equal(sanitizeAudio(raw).bands, null);
});
test('a waveform is kept only if it has at least 64 samples, and is cut to 4096', () => {
  assert.equal(sanitizeAudio({ wave: Array(63).fill(.1) }).wave, null);
  assert.equal(sanitizeAudio({ wave: Array(64).fill(.1) }).wave.length, 64);
  assert.equal(sanitizeAudio({ wave: Array(100_000).fill(.1) }).wave.length, 4096);
});
test('waveform samples are finite and bounded, but ordinary loudness is untouched', () => {
  const wave = sanitizeAudio({ wave: [NaN, Infinity, -Infinity, 1e30, -1e30, 'x', null, .25, -.75, ...Array(60).fill(0)] }).wave;
  assert.ok(wave.every(v => Number.isFinite(v) && Math.abs(v) <= 16));
  assert.equal(wave[7], .25); assert.equal(wave[8], -.75);
});
test('garbage in place of the whole message is survived', () => {
  for (const raw of [undefined, null, 0, 'text', [], true, () => 1, NaN]) {
    const out = sanitizeAudio(raw);
    assert.deepEqual([out.bass, out.mid, out.treble, out.bands, out.wave], [0, 0, 0, null, null], String(raw));
  }
});
test('a message with hostile accessors cannot make it throw into the render loop', () => {
  const tricky = { get bass() { return 0.5; }, mid: .1, treble: .2, bands: new Proxy([], {}) };
  assert.doesNotThrow(() => sanitizeAudio(tricky));
});
test('sanitising is idempotent', () => {
  const once = sanitizeAudio({ bass: 9, mid: NaN, treble: .4, bands: Array(40).fill(7), wave: Array(80).fill(99) });
  assert.deepEqual(sanitizeAudio(once), once);
});
test('it does not modify what it was given', () => {
  const raw = { bass: 9, bands: [9, 9], wave: Array(70).fill(99) }; sanitizeAudio(raw);
  assert.equal(raw.bass, 9); assert.deepEqual(raw.bands, [9, 9]); assert.equal(raw.wave[0], 99);
});
test('main.js really runs audio through the sanitiser before any scene sees it', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/renderer/main.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ sanitizeAudio \}/);
  assert.match(src, /function onAudio\(raw\) \{\s*const b = sanitizeAudio\(raw\)/);
  assert.doesNotMatch(src.slice(src.indexOf('function onAudio'), src.indexOf('function onCursor')), /\bb\.(bass|mid|treble)\b[^;]*\braw\b/, 'onAudio must not read the raw values');
});
