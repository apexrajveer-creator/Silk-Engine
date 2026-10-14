// Lifecycle primitives kept independent of the DOM so slow and reordered work can be tested.
export function createGate() {
  let generation = 0;
  return { next: () => ++generation, cancel: () => { ++generation; }, valid: token => token === generation };
}

// One outstanding read at a time. Stop/start and invalidation discard old answers.
// Schedule the next read after completion, so a slow backend never accumulates a queue.
export function createPoller(load, apply, interval, { onError = () => {}, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let active = false, generation = 0, timer = null, running = null, again = false;
  const clear = () => { if (timer !== null) clearTimer(timer); timer = null; };
  function refresh() {
    if (!active) return Promise.resolve();
    clear();
    if (running) { again = true; return running; }
    const token = generation;
    running = Promise.resolve().then(load).then(value => {
      if (active && token === generation && value != null) apply(value);
    }).catch(error => { if (active && token === generation) onError(error); }).finally(() => {
      running = null;
      if (!active) return;
      if (again) { again = false; void refresh(); }
      else if (interval > 0) timer = setTimer(() => { timer = null; void refresh(); }, interval);
    });
    return running;
  }
  return {
    start() { if (active) return; active = true; ++generation; void refresh(); },
    stop() { active = false; ++generation; again = false; clear(); },
    invalidate() { ++generation; },
    refresh,
  };
}

// Coalesce a slider's intermediate values while preserving write order.
export function createLatestWriter(write, { onError = () => {}, onIdle = () => {} } = {}) {
  let running = false, pending, hasPending = false;
  async function drain() {
    running = true;
    while (hasPending) {
      const value = pending; hasPending = false;
      try { await write(value); } catch (error) { onError(error); }
    }
    running = false; onIdle();
  }
  return {
    push(value) { pending = value; hasPending = true; if (!running) void drain(); },
    get busy() { return running || hasPending; },
  };
}

export class BoundedCache {
  constructor(maxEntries, maxBytes = Infinity, sizeOf = () => 0) {
    this.maxEntries = maxEntries; this.maxBytes = maxBytes; this.sizeOf = sizeOf;
    this.entries = new Map(); this.bytes = 0;
  }
  has(key) { return this.entries.has(key); }
  get(key) {
    if (!this.entries.has(key)) return undefined;
    const value = this.entries.get(key); this.entries.delete(key); this.entries.set(key, value); return value;
  }
  set(key, value) {
    this.delete(key); this.entries.set(key, value); this.bytes += this.sizeOf(value);
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) this.delete(this.entries.keys().next().value);
    return value;
  }
  delete(key) { if (this.entries.has(key)) { this.bytes -= this.sizeOf(this.entries.get(key)); this.entries.delete(key); } }
  retain(keys) { for (const key of this.entries.keys()) if (!keys.has(key)) this.delete(key); }
  clear() { this.entries.clear(); this.bytes = 0; }
  get size() { return this.entries.size; }
}
