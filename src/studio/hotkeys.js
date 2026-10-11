// The Hotkeys section of the System tab: every action with its shortcut, recorded by pressing the keys.
// The backend is the authority (it knows which shortcuts another app already owns); this screen shows what it
// reports and explains anything it refuses. While a shortcut is being recorded the live hotkeys are paused, so the
// current ones can't swallow the key presses, and they always come back (the backend also restores them by itself).
import { GROUPS, canonicalAccel, checkPolicy, comboFromEvent, keyCaps, parseAccel } from '../shared/hotkeys.js';

const STATUS = {
  active: ['Active', ''],
  inUse: ['In use by another app. Pick a different shortcut.', 'warn'],
  invalid: ['Not allowed. Change it.', 'bad'],
  disabled: ['Hotkeys are switched off', 'dim'],
  off: ['Not set', 'dim'],
};
const X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>';

export function hotkeysSection({ bridge, notify }) {
  const $ = id => document.getElementById(id);
  let st = null, capturing = null, notes = {};

  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const labelOf = id => st?.actions.find(a => a.id === id)?.label || id;
  const message = e => String(e?.message ?? e);

  function row(act) {
    const bound = st.bindings[act.id], rec = capturing === act.id, status = st.status[act.id] || 'off';
    const [statusText, tone] = STATUS[status] || STATUS.off;
    const r = h('div', 'hk-row' + (rec ? ' capturing' : '')); r.dataset.id = act.id; r.dataset.status = status;
    const dot = h('span', 'hk-dot'); dot.dataset.tone = bound ? tone : 'dim'; dot.setAttribute('aria-hidden', 'true');
    const text = h('div', 'hk-text'), sub = h('small', null, notes[act.id] || (status === 'active' || status === 'off' ? act.hint : statusText));
    if (notes[act.id] || tone === 'bad') sub.className = 'err'; else if (tone === 'warn') sub.className = 'warn';
    text.append(h('b', null, act.label), sub, h('span', 'visually-hidden', bound ? `, ${statusText}` : ', not set'));
    const keys = h('div', 'hk-keys');
    if (rec) keys.append(h('span', 'hk-prompt', 'Press the new keys\u2026 Esc cancels'));
    else if (bound) keyCaps(bound).forEach(k => keys.append(h('kbd', null, k)));
    else keys.append(h('span', 'hk-none', 'Not set'));
    const change = h('button', 'hk-btn', rec ? 'Cancel' : 'Change'); change.type = 'button';
    change.setAttribute('aria-label', (rec ? 'Cancel changing ' : 'Change shortcut for ') + act.label);
    change.onclick = () => (rec ? stop() : start(act.id));
    const clear = h('button', 'hk-btn hk-icon'); clear.type = 'button'; clear.innerHTML = X; clear.disabled = !bound || rec;
    clear.setAttribute('aria-label', 'Clear shortcut for ' + act.label); clear.title = 'Clear';
    clear.onclick = () => save({ [act.id]: '' });
    r.append(dot, text, keys, change, clear);
    return r;
  }

  function render() {
    const list = $('hotkeyList'); if (!list || !st) return;
    $('hotkeysEnabled').checked = st.enabled;
    list.classList.toggle('is-off', !st.enabled);
    list.textContent = '';
    for (const group of GROUPS) {
      const acts = st.actions.filter(a => a.group === group);
      if (!acts.length) continue;
      const block = h('section', 'hk-block'); block.setAttribute('aria-label', group);
      const card = h('div', 'hk-card');
      acts.forEach(a => card.append(row(a)));
      block.append(h('h3', 'hk-group', group), card);
      list.append(block);
    }
    const bad = Object.values(st.status).filter(s => s === 'inUse').length;
    $('hotkeysNote').textContent = bad ? `${bad} shortcut${bad > 1 ? 's are' : ' is'} in use by another app and won't work until changed.` : '';
  }

  async function load() {
    try { st = await bridge.invoke('get_hotkeys'); } catch (e) { $('hotkeysNote').textContent = message(e); return; }
    render();
  }

  /** Send the whole set; the backend refuses anything unsafe or duplicated and says why. */
  async function save(patch, enabled = st.enabled) {
    const id = Object.keys(patch)[0];
    try { st = await bridge.invoke('set_hotkeys', { enabled, bindings: { ...st.bindings, ...patch } }); notes = {}; }
    catch (e) { notes = id ? { [id]: message(e) } : {}; $('hotkeysNote').textContent = id ? '' : message(e); try { st = await bridge.invoke('get_hotkeys'); } catch { /* keep what we have */ } }
    render();
  }

  // ---- recording
  const onBlur = () => stop();
  function onKey(e) {
    if (!capturing) return;
    e.preventDefault(); e.stopImmediatePropagation();                // the Studio's own shortcuts must not react
    if (e.code === 'Escape') { stop(); return; }
    if (e.repeat) return;
    const accel = comboFromEvent(e);
    if (!accel) return;                                              // only modifiers so far: keep waiting
    let canon;
    try { const c = parseAccel(accel); checkPolicy(c); canon = canonicalAccel(c); } catch (err) { notes = { [capturing]: err.message }; render(); return; }
    // already on another action? Say so here, naming that action (the backend would blame whichever comes later in the list)
    const other = st.actions.find(a => a.id !== capturing && st.bindings[a.id] === canon);
    if (other) { notes = { [capturing]: `Already used for "${other.label}"` }; render(); return; }
    const id = capturing; listen(false); capturing = null;
    save({ [id]: canon }).then(resume);
  }
  function listen(on) {
    const f = on ? 'addEventListener' : 'removeEventListener';
    window[f]('keydown', onKey, true); window[f]('blur', onBlur);
  }
  async function resume() { try { st = await bridge.invoke('hotkeys_suspend', { suspended: false }); } catch { /* it restores itself */ } render(); }
  async function start(id) {
    if (capturing) await stop();
    capturing = id; notes = {}; render(); listen(true);
    try { await bridge.invoke('hotkeys_suspend', { suspended: true }); } catch { /* recording still works; existing hotkeys may react */ }
  }
  async function stop() {
    if (!capturing) return;
    capturing = null; notes = {}; listen(false); await resume();
  }

  // ---- wiring
  $('hotkeysEnabled')?.addEventListener('change', e => save({}, e.target.checked));
  $('hotkeysReset')?.addEventListener('click', () => save({ ...st.defaults }));
  bridge.listen('hotkey', id => notify(`${labelOf(id)}`));          // a hotkey fired while the Studio is open
  load();

  return { refresh: load, cancel: () => { if (capturing) stop(); } };
}
