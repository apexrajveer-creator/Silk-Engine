import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, deferred, flush } from './helpers/island-harness.mjs';

async function opened(t) { const h = harness(); t.after(() => h.cleanup()); h.open(); await h.advance(100); assert.equal(h.S.state, 'open'); return h; }

test('Escape/dismiss while native expansion is pending cannot reopen the panel', async t => {
  const h = harness(); t.after(() => h.cleanup()); const reply = deferred(); h.answer('island_expand', reply.promise);
  h.showPeek(); await h.advance(50); h.open(); await flush(); h.dismiss(); reply.resolve(3); await h.advance(500);
  assert.equal(h.S.state, 'hidden'); const hides = h.calls.filter(x => x.name === 'island_hide'); assert.equal(hides.length, 1); assert.equal(hides[0].args.expectedGeneration, 3);
});
test('an older delayed dismissal cannot hide a new reveal', async t => {
  const h = await opened(t); h.dismiss(); await h.advance(50); h.emit('island-show', { open: false, generation: 4 }); await h.advance(400);
  assert.equal(h.S.state, 'peek'); assert.equal(h.calls.filter(x => x.name === 'island_hide').length, 0);
});
test('native events from older window generations are ignored', async t => {
  const h = await opened(t); h.emit('island-show', { open: false, generation: 10 }); h.emit('island-hidden', 9); await h.advance(50); assert.equal(h.S.state, 'open');
});
test('repeated clicks on the selected tab keep its timer and media request count stable', async t => {
  const h = await opened(t), count = h.calls.filter(x => x.name === 'media_state').length;
  for (let i = 0; i < 20; i++) h.selectTab('quick'); await h.advance(100);
  assert.equal(h.calls.filter(x => x.name === 'media_state').length, count);
});
test('late media reads after changing tabs cannot restart media polling', async t => {
  const h = await opened(t), reply = deferred(); h.answer('media_state', reply.promise); await h.advance(1100);
  h.selectTab('system'); reply.resolve({ active: false }); await h.advance(100);
  const count = h.calls.filter(x => x.name === 'media_state').length; await h.advance(4000); assert.equal(h.calls.filter(x => x.name === 'media_state').length, count);
});
test('an unavailable wallpaper produces an error instead of a false Now playing message', async t => {
  const h = await opened(t); h.selectTab('wallpapers'); await h.advance(50); h.answer('assign', () => Promise.reject(Error('File missing')));
  h.node('view-wallpapers').querySelector('.wall').click(); await flush(); assert.equal(h.node('note').textContent, 'File missing');
});
test('external volume updates synchronize even while the idle slider retains focus', async t => {
  const h = await opened(t), slider = h.node('view-quick').querySelector('.volume input'); slider.focus();
  h.answer('quick_state', { volume: .9, muted: false, wifi: true, bluetooth: false }); await h.advance(4200); assert.equal(Number(slider.value), 90);
});
test('pending media commands reject duplicate clicks', async t => {
  const h = await opened(t), reply = deferred(); h.answer('media_control', reply.promise); const b = h.node('view-quick').querySelector('.mc.big'); b.click(); b.click(); await flush();
  assert.equal(h.calls.filter(x => x.name === 'media_control').length, 1); reply.resolve(); await h.advance(300); assert.equal(b.disabled, false);
});
test('hidden panels are inert and stop background metrics reads', async t => {
  const h = await opened(t); h.dismiss(); await h.advance(500); assert.equal(h.node('panel').inert, true);
  const count = h.calls.filter(x => x.name === 'widget_metrics').length; await h.advance(5000); assert.equal(h.calls.filter(x => x.name === 'widget_metrics').length, count);
});
test('keyboard activation of a nested clipboard remove button does not also copy its entry', async t => {
  const h = await opened(t); h.answer('clip_state', { enabled: true, items: [{ id: 1, preview: 'hello', ageSecs: 1 }] }); h.selectTab('clipboard'); await h.advance(50);
  const row = h.node('view-clipboard').querySelector('.clip'), x = row.querySelector('.x'); row.dispatch('keydown', { key: 'Enter', target: x }); await flush(); assert.equal(h.calls.filter(x => x.name === 'clip_use').length, 0);
});

test('new clipboard entries preserve the focused existing entry and list scroll', async t => {
  const h = await opened(t);
  const one = { id: 1, preview: 'one', ageSecs: 1 };
  h.answer('clip_state', { enabled: true, items: [one] }); h.selectTab('clipboard'); await h.advance(50);
  h.node('view-clipboard').querySelector('.clip').focus(); h.node('view-clipboard').querySelector('.clips').scrollTop = 75;
  h.answer('clip_state', { enabled: true, items: [{ id: 2, preview: 'two', ageSecs: 0 }, one] }); await h.advance(1900);
  assert.equal(h.document.activeElement.dataset.id, 1); assert.equal(h.node('view-clipboard').querySelector('.clips').scrollTop, 75);
});
test('an earlier power action cannot close a reopened panel', async t => {
  const h = await opened(t), reply = deferred(); h.selectTab('power'); h.answer('power_do', reply.promise);
  h.node('view-power').querySelector('.pbtn').click(); await flush(); h.dismiss(); await h.advance(400); h.open(); await h.advance(100);
  assert.equal(h.S.state, 'open'); reply.resolve(); await h.advance(500); assert.equal(h.S.state, 'open');
});
test('suspending and resuming visibility stops reads and restarts the selected view once', async t => {
  const h = await opened(t); h.setHidden(true); const count = h.calls.length; await h.advance(5000); assert.equal(h.calls.length, count);
  h.setHidden(false); await h.advance(50); assert.equal(h.calls.filter(x => x.name === 'media_state').length, 2);
});
test('late artwork from the previous tab session cannot repaint the hidden media card', async t => {
  const h = await opened(t), reply = deferred();
  h.answer('media_state', { active: true, title: 'new', status: 'playing', thumbId: 'track', duration: 100 }); h.answer('media_thumb', reply.promise);
  await h.advance(1100); h.selectTab('system'); reply.resolve('data:image/png,a'); await h.advance(50);
  assert.equal(h.node('view-quick').querySelector('.media').dataset.art, 'false');
});
test('failed system reads retain a valid reading and retry later', async t => {
  const h = await opened(t); h.answer('widget_metrics', () => Promise.reject(Error('temporary'))); await h.advance(1200);
  assert.equal(h.node('peekCpu').textContent, '12%');
  h.answer('widget_metrics', { cpu: 55, ram: 30 }); await h.advance(1200); assert.equal(h.node('peekCpu').textContent, '55%');
});

test('a rejected play/pause command rolls back the optimistic icon even when the next read fails', async t => {
  const h = await opened(t); h.answer('media_control', () => Promise.reject(Error('player rejected'))); h.answer('media_state', () => Promise.reject(Error('temporarily unavailable')));
  const button = h.node('view-quick').querySelector('.mc.big'); button.click(); await h.advance(300);
  assert.equal(button.getAttribute('aria-label'), 'Pause'); assert.equal(button.disabled, false);
});
test('a failed volume write restores the last confirmed level without waiting for a good read', async t => {
  const h = await opened(t); h.answer('quick_set', () => Promise.reject(Error('device gone'))); h.answer('quick_state', () => Promise.reject(Error('device gone')));
  const slider = h.node('view-quick').querySelector('.volume input'); slider.value = 90; slider.dispatch('input'); await h.advance(100);
  assert.equal(Number(slider.value), 50);
});
