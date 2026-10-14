import test from 'node:test';
import assert from 'node:assert/strict';
import { createGate, createPoller, createLatestWriter, BoundedCache } from '../src/island/lifecycle.js';
import { deferred, flush } from './helpers/island-harness.mjs';

const timers = () => { const tasks = new Map(); let id = 0; return { tasks, setTimer: fn => { tasks.set(++id, fn); return id; }, clearTimer: id => tasks.delete(id) }; };

test('a canceled transition and an older reveal can never remain current', () => {
  const gate = createGate(), first = gate.next(), second = gate.next(); assert.equal(gate.valid(first), false); assert.equal(gate.valid(second), true); gate.cancel(); assert.equal(gate.valid(second), false);
});
test('slow polls coalesce refresh requests instead of spawning concurrent reads', async () => {
  const clock = timers(), first = deferred(), seen = []; let reads = 0;
  const poll = createPoller(() => ++reads === 1 ? first.promise : 2, x => seen.push(x), 1000, clock);
  poll.start(); await flush(); for (let i = 0; i < 50; i++) poll.refresh(); await flush(); assert.equal(reads, 1);
  first.resolve(1); await flush(); assert.equal(reads, 2); assert.deepEqual(seen, [1, 2]); assert.equal(clock.tasks.size, 1); poll.stop(); assert.equal(clock.tasks.size, 0);
});
test('stopping a poll prevents its late answer from painting or restarting timers', async () => {
  const clock = timers(), result = deferred(), seen = []; const poll = createPoller(() => result.promise, x => seen.push(x), 1000, clock);
  poll.start(); await flush(); poll.stop(); result.resolve(1); await flush(); assert.deepEqual(seen, []); assert.equal(clock.tasks.size, 0);
});
test('a tab reopened during its old read receives a fresh answer without overlapping it', async () => {
  const clock = timers(), first = deferred(), seen = []; let reads = 0;
  const poll = createPoller(() => ++reads === 1 ? first.promise : 2, x => seen.push(x), 1000, clock);
  poll.start(); await flush(); poll.stop(); poll.start(); await flush(); assert.equal(reads, 1);
  first.resolve(1); await flush(); assert.equal(reads, 2); assert.deepEqual(seen, [2]); poll.stop();
});
test('a user action invalidates a snapshot already in flight', async () => {
  const clock = timers(), first = deferred(), seen = []; let reads = 0;
  const poll = createPoller(() => ++reads === 1 ? first.promise : 'new', x => seen.push(x), 1000, clock);
  poll.start(); await flush(); poll.invalidate(); poll.refresh(); first.resolve('old'); await flush(); assert.deepEqual(seen, ['new']); poll.stop();
});
test('a failed read keeps the last value and schedules a retry', async () => {
  const clock = timers(), seen = [], errors = []; let reads = 0;
  const poll = createPoller(() => ++reads === 1 ? Promise.reject(Error('offline')) : 'recovered', x => seen.push(x), 1000, { ...clock, onError: e => errors.push(e.message) });
  poll.start(); await flush(); assert.deepEqual(errors, ['offline']); assert.deepEqual(seen, []);
  const callback = clock.tasks.values().next().value; clock.tasks.clear(); callback(); await flush(); assert.deepEqual(seen, ['recovered']); poll.stop();
});
test('repeated starts do not create duplicate polls', async () => {
  const clock = timers(); let reads = 0; const poll = createPoller(() => ++reads, () => {}, 1000, clock);
  poll.start(); poll.start(); await flush(); assert.equal(reads, 1); assert.equal(clock.tasks.size, 1); poll.stop();
});
test('volume writes stay ordered and the newest queued slider value wins', async () => {
  const first = deferred(), seen = []; const writer = createLatestWriter(x => { seen.push(x); return x === .1 ? first.promise : Promise.resolve(); });
  writer.push(.1); writer.push(.2); writer.push(.3); assert.deepEqual(seen, [.1]); assert.equal(writer.busy, true);
  first.resolve(); await flush(); assert.deepEqual(seen, [.1, .3]); assert.equal(writer.busy, false);
});
test('a failed volume write does not discard a newer value', async () => {
  const first = deferred(), seen = [], errors = []; const writer = createLatestWriter(x => { seen.push(x); return x === .1 ? first.promise : Promise.resolve(); }, { onError: e => errors.push(e.message) });
  writer.push(.1); writer.push(.9); first.reject(Error('device changed')); await flush(); assert.deepEqual(seen, [.1, .9]); assert.deepEqual(errors, ['device changed']); assert.equal(writer.busy, false);
});
test('thumbnail cache enforces count and byte limits and promotes recently used entries', () => {
  const cache = new BoundedCache(2, 10, x => x.size); cache.set('a', { size: 3 }); cache.set('b', { size: 3 }); cache.get('a'); cache.set('c', { size: 3 }); assert.equal(cache.has('b'), false); assert.equal(cache.has('a'), true);
  cache.set('a', { size: 8 }); assert.equal(cache.bytes, 8); assert.equal(cache.size, 1); cache.set('huge', { size: 20 }); assert.equal(cache.size, 0); assert.equal(cache.bytes, 0);
});
test('removed wallpaper entries and a cleared cache release their byte accounting', () => {
  const cache = new BoundedCache(24, 100, x => x?.size ?? 0); cache.set('a', { size: 6 }); cache.set('b', { size: 4 }); cache.retain(new Set(['b'])); assert.equal(cache.bytes, 4); cache.clear(); assert.equal(cache.size, 0); assert.equal(cache.bytes, 0);
});
