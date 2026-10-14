import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameBatch, createPageTransition } from '../src/shared/motion.js';
function clock() {
  let time = 0, seq = 0; const timers = new Map();
  const set = (fn, delay = 0) => { const id = ++seq; timers.set(id, { fn, at: time + delay }); return id; };
  const clear = id => timers.delete(id);
  return { setTimer: set, clearTimer: clear, requestFrame: fn => set(fn, 16), cancelFrame: clear,
    tick(ms) { const end = time + ms; for (;;) { const next = [...timers].filter(([,t]) => t.at <= end).sort((a,b) => a[1].at - b[1].at)[0]; if (!next) break; const [id,t] = next; timers.delete(id); time = t.at; t.fn(); } time = end; }, get size() { return timers.size; } };
}
test('frame batching merges repeated requests and preserves a required full render', () => {
  const c = clock(), renders = []; let visible = true;
  const batch = createFrameBatch(all => renders.push(all), { ...c, visible: () => visible });
  for (let i=0;i<100;i++) batch.request(i === 20);
  assert.equal(c.size, 1); c.tick(16); assert.deepEqual(renders, [true]);
  visible = false; batch.request(); batch.request(true); c.tick(100); assert.equal(c.size, 0);
  visible = true; batch.flush(); assert.deepEqual(renders, [true,true]);
  batch.request(); batch.dispose(); c.tick(100); assert.equal(renders.length,2); assert.equal(c.size,0);
});
function navigation() {
  const c = clock(), calls = []; let reduced = false;
  const nav = createPageTransition({ ...c, reduced: () => reduced, leave: ms => calls.push(['out',ms]), commit: tab => calls.push(['tab',tab]), enter: ms => calls.push(['in',ms]), settle: () => calls.push(['idle']) });
  return { c, calls, nav, reduce() { reduced = true; } };
}
test('rapid clicks during fade-out commit only the latest tab', () => {
  const { c,calls,nav } = navigation(); nav.request('one'); c.tick(40); nav.request('two'); nav.request('three'); c.tick(50);
  assert.deepEqual(calls.filter(x=>x[0]==='tab'), [['tab','three']]); c.tick(166); assert.equal(nav.active,false); assert.equal(c.size,0);
});
test('a new request during fade-in invalidates every old completion callback', () => {
  const { c,calls,nav } = navigation(); nav.request('one'); c.tick(106); nav.request('two'); c.tick(106);
  assert.equal(nav.active,true); c.tick(150); assert.equal(nav.active,false); assert.equal(calls.filter(x=>x[0]==='idle').length,1); assert.equal(c.size,0);
});
test('hidden/suspended animation frames have a bounded fallback and no stranded opacity', () => {
  const { c,calls } = navigation();
  const nav = createPageTransition({ ...c, requestFrame: () => 999, cancelFrame() {}, leave() {}, commit: tab => calls.push(tab), enter: () => calls.push('visible'), settle: () => calls.push('idle') });
  nav.request('latest'); c.tick(140); assert.deepEqual(calls, ['latest','visible']); c.tick(150); assert.equal(nav.active,false); assert.equal(c.size,0);
});
test('reduced motion settles synchronously and hidden-page finish commits the latest target', () => {
  const { c,calls,nav,reduce } = navigation(); nav.request('one'); nav.request('two'); nav.finish();
  assert.deepEqual(calls.filter(x=>x[0]==='tab'), [['tab','two']]); assert.equal(c.size,0);
  reduce(); nav.request('three'); assert.equal(nav.active,false); assert.equal(c.size,0);
  nav.dispose(); nav.request('four'); assert.equal(calls.some(x=>x[1]==='four'),false);
});
test('a failed page commit releases motion resources and reports the error', () => {
  const c=clock(), errors=[];let settled=0;
  const nav=createPageTransition({...c,leave(){},commit(){throw Error('bad page');},enter(){},settle(){settled++;},onError:e=>errors.push(e.message)});
  nav.request('broken');c.tick(90);assert.deepEqual(errors,['bad page']);assert.equal(nav.active,false);assert.equal(settled,1);assert.equal(c.size,0);
});
