// Bounded UI scheduling. These primitives keep only the newest work and have no idle loop.
export function createFrameBatch(render, { requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame, visible = () => !document.hidden } = {}) {
  let frame = 0, dirty = false, full = false, disposed = false;
  function flush() { if (disposed || !dirty || !visible()) return; if (frame) cancelFrame(frame); frame = 0; const all = full; dirty = full = false; render(all); }
  return {
    request(all = false) { if (disposed) return; dirty = true; full ||= all; if (!frame && visible()) frame = requestFrame(() => { frame = 0; flush(); }); },
    flush,
    dispose() { disposed = true; if (frame) cancelFrame(frame); frame = 0; dirty = full = false; },
  };
}

export function createPageTransition({ leave, commit, enter, settle, reduced = () => false, outMs = 90, inMs = 150,
  setTimer = setTimeout, clearTimer = clearTimeout, requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame, onError = () => {} }) {
  let generation = 0, timer = 0, fallback = 0, frame = 0, phase = null, target, disposed = false;
  const clear = () => { clearTimer(timer); clearTimer(fallback); if (frame) cancelFrame(frame); timer = fallback = frame = 0; };
  const done = () => { clear(); phase = null; settle(); };
  const apply = () => { try { commit(target); return true; } catch (e) { done(); onError(e); return false; } };
  function finish() { if (disposed) return; ++generation; if (phase === 'out') apply(); done(); }
  return {
    request(next) {
      if (disposed) return;
      target = next;
      if (reduced()) { ++generation; clear(); if (apply()) done(); return; }
      if (phase === 'out') return; // Coalesce clicks without restarting the outgoing fade.
      const token = ++generation; clear(); phase = 'out'; leave(outMs);
      timer = setTimer(() => {
        timer = 0; if (token !== generation || disposed || !apply()) return;
        phase = 'in'; let started = false;
        const reveal = () => {
          if (started || token !== generation || disposed) return;
          started = true; clearTimer(fallback); if (frame) cancelFrame(frame); frame = fallback = 0;
          enter(inMs); timer = setTimer(() => { if (token === generation && !disposed) done(); }, inMs);
        };
        frame = requestFrame(reveal); fallback = setTimer(reveal, 50);
      }, outMs);
    },
    finish,
    dispose() { if (disposed) return; ++generation; clear(); phase = null; disposed = true; settle(); },
    get active() { return phase !== null; },
  };
}
