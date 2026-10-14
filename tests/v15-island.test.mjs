import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './helpers/island-harness.mjs';
const track = (title, thumbId='') => ({ active:true,title,artist:'Artist',source:'Player',status:'playing',thumbId,position:0,duration:120,canToggle:true,canNext:true,canPrev:true,canSeek:true });
test('song crossfade retains the live control node and focus; heartbeat updates do not restart it', async t => {
  const h=harness();t.after(()=>h.cleanup());h.answer('media_state',track('First'));h.open();await h.advance(100);
  const view=h.node('view-quick'),control=view.querySelector('[data-id=toggle]');control.focus();
  h.answer('media_state',track('Second'));await h.advance(1000);
  assert.equal(view.querySelector('.media-title').textContent,'Second');assert.equal(view.querySelector('.song-out .media-title').textContent,'First');
  assert.equal(view.querySelector('[data-id=toggle]'),control);assert.equal(h.document.activeElement,control);
  await h.advance(240);assert.equal(view.querySelector('.song-out'),null);assert.equal(view.querySelector('.song-in'),null);
  await h.advance(1000);assert.equal(view.querySelector('.song-out'),null);
});
test('leaving Quick cancels every outgoing song layer', async t => {
  const h=harness();t.after(()=>h.cleanup());h.answer('media_state',track('First'));h.open();await h.advance(100);
  h.answer('media_state',track('Second'));await h.advance(1000);assert.ok(h.node('view-quick').querySelector('.song-out'));
  h.selectTab('system');assert.equal(h.node('view-quick').querySelector('.song-out'),null);await h.advance(500);
  assert.equal(h.node('view-quick').querySelector('.song-out'),null);
});
test('reopening the same track preserves decoded artwork instead of flashing a placeholder', async t => {
  const h=harness();t.after(()=>h.cleanup());h.answer('media_state',track('First','art'));h.answer('media_thumb','data:image/png,one');h.open();await h.advance(100);
  const media=h.node('view-quick').querySelector('.media');assert.equal(media.dataset.art,'true');
  h.selectTab('system');h.selectTab('quick');await h.advance(100);assert.equal(media.dataset.art,'true');
  assert.equal(h.node('view-quick').querySelector('.art img').getAttribute('src'),'data:image/png,one');
});
