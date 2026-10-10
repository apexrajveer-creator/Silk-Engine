// Serialize writes, coalesce pending patches, and retain failed edits for retry.
export function saveQueue(write, onError = () => {}, delay = 120) {
  const pending = new Map();
  let timer, running = null, current = null;
  function schedule() { clearTimeout(timer); timer = setTimeout(() => { flush().catch(onError); }, delay); }
  async function drain() {
    while (pending.size) {
      const [key, patch] = pending.entries().next().value;
      pending.delete(key); current = { key, patch };
      try { await write(key, patch); }
      catch (error) {
        pending.set(key, { ...patch, ...pending.get(key) });
        throw error;
      } finally { current = null; }
    }
  }
  function flush() {
    clearTimeout(timer);
    if (!running) running = drain().finally(() => { running = null; });
    return running;
  }
  return {
    push(key, patch) { pending.set(key, { ...pending.get(key), ...patch }); schedule(); },
    flush,
    patches() {
      const all = new Map(current ? [[current.key, current.patch]] : []);
      for (const [key, patch] of pending) all.set(key, { ...all.get(key), ...patch });
      return all;
    },
    get dirty() { return !!current || pending.size > 0; },
  };
}
