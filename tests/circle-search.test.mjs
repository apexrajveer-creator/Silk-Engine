import test from 'node:test';
import assert from 'node:assert/strict';
import { appendPoint, selectionBounds, scaledSelection, tracePath, MAX_POINTS } from '../src/search/model.js';
import { surfacePalette, applySurfaceTheme, bindSurfaceTheme } from '../src/shared/surface-theme.js';
import { batteryDisplay, visualizerLevels } from '../src/island/compact.js';
import { deferred, flush, harness } from './helpers/island-harness.mjs';
const triangle = [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 10, y: 90 }];

test('a freeform selection keeps the actual irregular cursor points', () => {
  const p = []; for (const point of triangle) appendPoint(p, point, 100, 100);
  assert.deepEqual(p, triangle); assert.deepEqual(selectionBounds(p, 100, 100), { x: 10, y: 10, width: 80, height: 80 });
});
test('short clicks and straight cursor lines cannot accidentally search a rectangular screenshot', () => {
  assert.equal(selectionBounds([{ x: 1, y: 1 }], 100, 100), null);
  assert.equal(selectionBounds([{ x: 10, y: 10 }, { x: 40, y: 40 }, { x: 90, y: 90 }], 100, 100), null);
});
test('points are bounded, invalid input is ignored and tiny motion is deduplicated', () => {
  const p = []; appendPoint(p, { x: NaN, y: 1 }, 100, 100); assert.equal(p.length, 0);
  appendPoint(p, { x: -5, y: 200 }, 100, 100); appendPoint(p, { x: 1, y: 100 }, 100, 100); assert.deepEqual(p, [{ x: 0, y: 100 }]);
  const full = Array.from({ length: MAX_POINTS }, () => ({ x: 0, y: 0 })); appendPoint(full, { x: 50, y: 50 }, 100, 100); assert.equal(full.length, MAX_POINTS);
});
test('mixed-DPI captures map both axes independently to screenshot pixels', () => {
  const s = scaledSelection(triangle, 100, 100, 200, 150);
  assert.deepEqual(s.points, [{ x: 20, y: 15 }, { x: 180, y: 15 }, { x: 20, y: 135 }]);
  assert.deepEqual(s.bounds, { x: 20, y: 15, width: 160, height: 120 });
  assert.equal(scaledSelection(triangle, 0, 100, 200, 150), null);
});
test('figure-eight outlines remain valid even when signed areas cancel', () => {
  assert.ok(selectionBounds([{x:10,y:10},{x:90,y:90},{x:90,y:10},{x:10,y:90}],100,100));
});
test('the crop mask follows the traced polygon rather than an ellipse or bounding rectangle', () => {
  const calls = []; const c = { beginPath: () => calls.push('begin'), moveTo: (...args) => calls.push(['move', ...args]), lineTo: (...args) => calls.push(['line', ...args]), closePath: () => calls.push('close') };
  tracePath(c, triangle, 10, 10);
  assert.deepEqual(calls, ['begin', ['move', 0, 0], ['line', 80, 0], ['line', 0, 80], 'close']);
});
test('surface palettes preserve the applied hue and remain readable for bright and neutral accents', () => {
  for (const color of ['#ff0000', '#0044ff', '#ffffff', '#000000', '#1b1b1d']) {
    const p = surfacePalette(color); assert.equal(p.base, color);
    assert.ok(p.top.split(',').every(x => Number(x) <= 83));
    assert.match(p.bright, /^#[0-9a-f]{6}$/);
  }
  assert.equal(surfacePalette('url(evil)').base, surfacePalette(null).base);
});
test('late initial accent reads cannot overwrite newer taskbar-accent events', async () => {
  const initial = deferred(), props = new Map(); let listener;
  const bridge = { invoke: () => initial.promise, listen: (_, cb) => { listener = cb; return () => {}; } };
  const stop = bindSurfaceTheme(bridge, { setProperty: (key, value) => props.set(key, value) });
  listener('#bb2244'); initial.resolve('#1122bb'); await flush(); assert.equal(props.get('--accent'), '#bb2244');
  stop(); listener('#ffffff'); assert.equal(props.get('--accent'), '#bb2244');
});
test('battery display distinguishes charging, low charge, unavailable and desktop power', () => {
  assert.equal(batteryDisplay({ battery: 83, hasBattery: true }).text, '83%');
  assert.equal(batteryDisplay({ battery: 10, charging: true }).low, false);
  assert.equal(batteryDisplay({ battery: 10 }).low, true);
  assert.equal(batteryDisplay({ battery: 255 }).text, '—');
  assert.equal(batteryDisplay({ battery: 99, hasBattery: false }).text, 'AC');
});
test('visualizer bars use audio levels and rest flat for silence or corrupt samples', () => {
  assert.deepEqual(visualizerLevels(null), Array(8).fill(.12));
  const bands = visualizerLevels({ bands: [1, NaN, Infinity, -3, .5, 0, 0, 0] });
  assert.equal(bands[0], .94); assert.equal(bands[1], .12); assert.ok(bands.every(v => Number.isFinite(v) && v >= .12 && v <= .94));
});
test('compact Island responds to battery and accent updates without adding an idle visualizer loop', async t => {
  const h = harness(); t.after(() => h.cleanup()); h.answer('widget_metrics', { cpu: 1, ram: 2, battery: 72, hasBattery: true, charging: true }); h.showPeek(); await h.advance(80);
  assert.equal(h.node('batteryPercent').textContent, '72%'); assert.equal(h.node('peekBattery').dataset.charging, 'true');
  h.emit('accent-applied', '#993344'); assert.equal(h.document.documentElement.style.getPropertyValue('--accent'), '#993344');
  h.emit('audio', { bands: Array(32).fill(.5) }); assert.equal(h.node('peekWave').dataset.playing, 'true');
  await h.advance(1100); assert.equal(h.node('peekWave').dataset.playing, 'false');
});

test('Circle to Search is available in Quick and dispatches the same checked action as its hotkey', async t => {
  const h = harness(); t.after(() => h.cleanup()); h.open(); await h.advance(100);
  const button = h.node('view-quick').querySelector('.search-chip'); button.click(); button.click(); await flush();
  assert.equal(h.S.state, 'hidden'); assert.equal(button.disabled, true);
  assert.ok(!h.calls.some(call => call.name === 'island_action' && call.args.id === 'circleSearch'));
  await h.advance(279); assert.ok(!h.calls.some(call => call.name === 'island_action' && call.args.id === 'circleSearch'));
  await h.advance(2); await flush();
  assert.equal(h.calls.filter(call => call.name === 'island_action' && call.args.id === 'circleSearch').length, 1);
  assert.equal(button.disabled, false);
});
