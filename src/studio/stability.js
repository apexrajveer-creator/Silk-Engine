// The safe-mode banner. When the app crashed several times in a row it starts on simple settings (see stability.rs) and keeps
// the user's real settings aside; this is where the user chooses what to do about it. It also tells the user, once, when the
// previous run ended in a real crash.
export function stabilityBanner({ bridge, notify }) {
  const box = document.getElementById('safeBanner');
  if (!box) return { refresh() {} };
  const busy = on => box.querySelectorAll('button').forEach(b => { b.disabled = on; });

  async function refresh() {
    let s;
    try { s = await bridge.invoke('get_stability'); } catch { return null; }   // never let a diagnostics call break the Studio
    box.hidden = !s.safeMode;
    if (s.crashedLastTime) notify('Silk Engine restarted after an unexpected problem. A report was saved; see System \u2192 Diagnostics.');
    return s;
  }
  async function leave(restore) {
    busy(true);
    try {
      await bridge.invoke('leave_safe_mode', { restore });
      box.hidden = true;
      notify(restore ? 'Your settings are back.' : 'Keeping the safe settings.');
    } catch (e) { notify(String(e?.message ?? e)); } finally { busy(false); }
  }
  box.querySelector('[data-act="restore"]').addEventListener('click', () => leave(true));
  box.querySelector('[data-act="keep"]').addEventListener('click', () => leave(false));
  refresh();
  return { refresh };
}
