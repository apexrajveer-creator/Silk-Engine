const test = require('node:test');
const assert = require('node:assert/strict');
const queueModule = import('../src/shared/save-queue.js');

test('save queue retains failed edits and newest values win on retry', async () => {
  const { saveQueue } = await queueModule;
  const calls = []; let fail = true;
  const q = saveQueue(async (key, patch) => { calls.push([key, patch]); if (fail) throw Error('disk full'); }, () => {}, 60000);
  q.push('scene', { color: '#111111', speed: 40 });
  await assert.rejects(q.flush(), /disk full/);
  assert.equal(q.dirty, true);
  q.push('scene', { speed: 80 }); fail = false;
  await q.flush();
  assert.deepEqual(calls[1], ['scene', { color: '#111111', speed: 80 }]);
  assert.equal(q.dirty, false);
});
test('flush waits for in-flight writes and edits arriving during a save', async () => {
  const { saveQueue } = await queueModule;
  let release; const calls = [];
  const q = saveQueue(async (key, patch) => { calls.push(patch); if (calls.length === 1) await new Promise(r => release = r); }, () => {}, 60000);
  q.push('display', { brightness: 80 });
  const flush = q.flush();
  assert.equal(q.dirty, true);
  q.push('display', { brightness: 100 });
  assert.deepEqual(q.patches().get('display'), { brightness: 100 });
  release(); await flush; await q.flush();
  assert.deepEqual(calls, [{ brightness: 80 }, { brightness: 100 }]);
  assert.equal(q.dirty, false);
});
test('invalid render settings fall back safely and numeric settings are bounded', async () => {
  const { resolved, DISPLAY, SCENES } = await import('../src/shared/catalog.js');
  const result = resolved(DISPLAY, { fps: '0', quality: 'broken', brightness: 1e20, contrast: NaN, oled: 'false' });
  assert.equal(result.fps, '30'); assert.equal(result.quality, 'auto');
  assert.equal(result.brightness, 150); assert.equal(result.contrast, 100); assert.equal(result.oled, false);
  assert.equal(resolved(SCENES.silk.settings, { color: 'url(evil)' }).color, '#17479e');
});
test('widgets follow lock, hibernation, manual pause and battery policies', async () => {
  const { widgetPolicy } = await import('../src/shared/widget-policy.js');
  const cfg = { system: { battery: 'pause' } };
  assert.equal(widgetPolicy(cfg, { onBattery: true }).paused, true);
  assert.equal(widgetPolicy(cfg, { onBattery: false }).paused, false);
  assert.equal(widgetPolicy({ ...cfg, paused: true }, {}).paused, true);
  assert.equal(widgetPolicy(cfg, { locked: true }).hidden, true);
  assert.equal(widgetPolicy(cfg, { hibernating: true }).hidden, true);
  assert.equal(widgetPolicy(cfg, { onBattery: true }).fps, 15);
});
