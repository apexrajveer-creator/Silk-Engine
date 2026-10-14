// Hotkey actions and shortcut helpers, shared by the Studio and the browser preview's mock backend.
// The Rust side (src-tauri/src/hotkeys.rs) is the source of truth for what is actually registered;
// tests/hotkeys.test.cjs checks that this mirror (action ids, order, defaults, rules) stays identical to it.

export const GROUPS = ['Wallpaper', 'Look', 'Input', 'App', 'Desktops'];
const a = (id, group, label, hint, def) => ({ id, group, label, hint, default: def });
export const ACTIONS = [
  a('next', 'Wallpaper', 'Next wallpaper', 'On every display', 'Ctrl+Alt+Shift+Right'),
  a('prev', 'Wallpaper', 'Previous wallpaper', 'On every display', 'Ctrl+Alt+Shift+Left'),
  a('random', 'Wallpaper', 'Random wallpaper', 'A different one from your library', 'Ctrl+Alt+Shift+N'),
  a('pause', 'Wallpaper', 'Pause or resume', 'Freeze the wallpaper', 'Ctrl+Alt+Shift+Space'),
  a('oled', 'Look', 'Toggle OLED mode', 'True blacks on any screen', 'Ctrl+Alt+Shift+O'),
  a('brightUp', 'Look', 'Brighter', 'Display brightness +5', 'Ctrl+Alt+Shift+Up'),
  a('brightDown', 'Look', 'Dimmer', 'Display brightness -5', 'Ctrl+Alt+Shift+Down'),
  a('quality', 'Look', 'Cycle render quality', 'Auto, Eco, Balanced, High, Ultra', 'Ctrl+Alt+Shift+Q'),
  a('audio', 'Input', 'Toggle audio reactivity', 'React to system audio', 'Ctrl+Alt+Shift+A'),
  a('interactive', 'Input', 'Toggle cursor reaction', 'React to the cursor on the desktop', 'Ctrl+Alt+Shift+C'),
  a('studio', 'App', 'Open Silk Engine', 'Bring up the Studio', 'Ctrl+Alt+Shift+S'),
  a('circleSearch', 'App', 'Circle to Search', 'Outline anything on screen and search Google Lens', 'Ctrl+Alt+Shift+0'),
  a('island', 'App', 'Open the island', 'The top-edge toolbar, on this screen', 'Ctrl+Alt+Shift+I'),
  a('widgets', 'App', 'Show or hide widgets', 'All desktop widgets', 'Ctrl+Alt+Shift+W'),
  a('restart', 'App', 'Restart wallpaper', 'Reload the renderer', 'Ctrl+Alt+Shift+R'),
  a('profile1', 'Desktops', 'Apply desktop 1', 'Your first saved desktop', ''),
  a('profile2', 'Desktops', 'Apply desktop 2', 'Your second saved desktop', ''),
  a('profile3', 'Desktops', 'Apply desktop 3', 'Your third saved desktop', ''),
  a('profile4', 'Desktops', 'Apply desktop 4', 'Your fourth saved desktop', ''),
  a('profile5', 'Desktops', 'Apply desktop 5', 'Your fifth saved desktop', ''),
];

// ---- keys. Names are the browser's `event.code` names where one exists, so recording a key is a lookup.
const NAMED = ['Left', 'Up', 'Right', 'Down', 'Space', 'Enter', 'Tab', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown',
  'Comma', 'Period', 'Slash', 'Semicolon', 'Quote', 'BracketLeft', 'BracketRight', 'Backslash', 'Minus', 'Equal', 'Backquote',
  'NumpadAdd', 'NumpadSubtract', 'NumpadMultiply', 'NumpadDivide', 'NumpadDecimal'];
const KEYS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  ...Array.from({ length: 24 }, (_, i) => 'F' + (i + 1)), ...Array.from({ length: 10 }, (_, i) => 'Numpad' + i), ...NAMED];
const KEY_BY_LOWER = new Map(KEYS.map(k => [k.toLowerCase(), k]));
export const KEY_NAMES = KEYS;

/** Parse "Ctrl+Alt+Shift+Right" (any order and case, a few aliases). Throws an Error that explains what is wrong. */
export function parseAccel(s) {
  const c = { ctrl: false, alt: false, shift: false, win: false, key: null };
  for (const part of String(s).split('+')) {
    const t = part.trim();
    if (!t) throw new Error('There is an empty part in this shortcut');
    const lower = t.toLowerCase();
    const mod = { ctrl: 'ctrl', control: 'ctrl', alt: 'alt', option: 'alt', shift: 'shift', win: 'win', super: 'win', meta: 'win', cmd: 'win', command: 'win' }[lower];
    if (mod) { if (c[mod]) throw new Error(`${t} is listed twice`); c[mod] = true; continue; }
    if (c.key) throw new Error('Use just one key plus modifiers');
    const key = KEY_BY_LOWER.get(lower.startsWith('arrow') ? lower.slice(5) : lower);
    if (!key) throw new Error(`Unknown key "${t}"`);
    c.key = key;
  }
  if (!c.key) throw new Error('Choose a key');
  return c;
}

/** "Ctrl+Alt+Shift+Right": fixed modifier order and the canonical key name. */
export function canonicalAccel(c) {
  return [c.ctrl && 'Ctrl', c.alt && 'Alt', c.shift && 'Shift', c.win && 'Win', c.key].filter(Boolean).join('+');
}

/** The same safety rules as the Rust side: two modifiers (F13-F24 may stand alone), nothing Windows owns. */
export function checkPolicy(c) {
  const mods = [c.ctrl, c.alt, c.shift, c.win].filter(Boolean).length;
  const highF = /^F(1[3-9]|2[0-4])$/.test(c.key);
  if (mods < 2 && !highF) throw new Error('Use at least two of Ctrl, Alt, Shift and Win, so everyday shortcuts keep working');
  if ((c.ctrl && c.alt && c.key === 'Delete') || (c.alt && c.key === 'Tab') || (c.win && c.key === 'L')) throw new Error('Windows reserves this shortcut');
}

export const defaultBindings = () => Object.fromEntries(ACTIONS.map(x => [x.id, x.default]));

/** Defaults overridden by what the user stored; '' means deliberately unbound. */
export function effectiveBindings(stored = {}) {
  return Object.fromEntries(ACTIONS.map(x => {
    let v = Object.hasOwn(stored, x.id) ? String(stored[x.id]).trim() : x.default;
    try { v = canonicalAccel(parseAccel(v)); } catch { /* keep as typed; it is reported as invalid */ }
    return [x.id, v];
  }));
}

/** For every action: null (unbound), { combo } or { error } (refused, or already used by an earlier action). */
export function resolve(bindings) {
  const taken = new Map(), out = {};
  for (const act of ACTIONS) {
    const raw = String(bindings[act.id] ?? '').trim();
    if (!raw) { out[act.id] = null; continue; }
    try {
      const c = parseAccel(raw); checkPolicy(c);
      const key = canonicalAccel(c);
      if (taken.has(key)) throw new Error(`Already used for "${ACTIONS.find(x => x.id === taken.get(key)).label}"`);
      taken.set(key, act.id); out[act.id] = { combo: key };
    } catch (e) { out[act.id] = { error: e.message }; }
  }
  return out;
}

/** For saving: throws "<Action>: <problem>" for the first thing wrong, like the Rust command does. */
export function resolveStrict(bindings) {
  for (const [id, r] of Object.entries(resolve(bindings))) if (r?.error) throw new Error(`${ACTIONS.find(x => x.id === id).label}: ${r.error}`);
}

// ---- recording a shortcut from a keyboard event
const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/;
const ARROWS = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down' };
export function codeToKey(code = '') {
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
  if ((m = /^Digit([0-9])$/.exec(code))) return m[1];
  if (ARROWS[code]) return ARROWS[code];
  return KEY_BY_LOWER.get(code.toLowerCase()) ?? null;
}
/** The shortcut being held, as a canonical string; null while only modifiers are down or the key is unsupported. */
export function comboFromEvent(e) {
  if (MODIFIER_CODES.test(e.code || '')) return null;
  const key = codeToKey(e.code);
  return key ? canonicalAccel({ ctrl: !!e.ctrlKey, alt: !!e.altKey, shift: !!e.shiftKey, win: !!e.metaKey, key }) : null;
}

/** Pieces to draw as key caps: ['Ctrl', 'Alt', 'Shift', '→'] */
const GLYPH = { Left: '←', Right: '→', Up: '↑', Down: '↓', Space: 'Space', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`', NumpadAdd: 'Num +', NumpadSubtract: 'Num −',
  NumpadMultiply: 'Num ×', NumpadDivide: 'Num ÷', NumpadDecimal: 'Num .' };
export const keyCaps = accel => String(accel || '').split('+').filter(Boolean).map(p => GLYPH[p] ?? p.replace(/^Numpad(\d)$/, 'Num $1'));
