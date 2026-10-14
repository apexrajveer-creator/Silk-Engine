// One API for both worlds:
//  * inside the app  -> Tauri commands/events
//  * in a plain browser (dev / web demo) -> a mock backend in localStorage, with
//    BroadcastChannel standing in for events so a Studio tab drives a renderer tab.

import { ACTIONS, canonicalAccel, defaultBindings, effectiveBindings, parseAccel, resolve, resolveStrict } from './hotkeys.js';

const T = window.__TAURI__;
export const isApp = !!(T && T.core);

const WIN = /Windows/.test(navigator.userAgent);
const listeners = new Map();

function on(evt, cb) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(cb);
  return () => listeners.get(evt)?.delete(cb);
}
function fire(evt, payload) { listeners.get(evt)?.forEach(cb => { try { cb(payload); } catch (e) { console.error(e); } }); }

// ---------------------------------------------------------------- mock backend
const KEY = 'silk-engine-mock';
const chan = !isApp && 'BroadcastChannel' in window ? new BroadcastChannel('silk-engine') : null;
if (chan) chan.onmessage = e => fire(e.data.evt, e.data.payload);
function broadcast(evt, payload) { fire(evt, payload); chan?.postMessage({ evt, payload }); }

// Hotkeys in the browser preview: nothing is really registered, but saving, validation and the statuses behave like the app.
// One combination is pretended to belong to another app, so the "in use" state can be seen and tested.
const MOCK_TAKEN = 'Ctrl+Alt+Shift+F12';
function hotkeysDto() {
  const hk = mockConfig().hotkeys || {}, enabled = hk.enabled !== false, bindings = effectiveBindings(hk.bindings), r = resolve(bindings);
  const status = Object.fromEntries(ACTIONS.map(x => [x.id, !bindings[x.id] ? 'off' : r[x.id]?.error ? 'invalid' : !enabled ? 'disabled' : r[x.id].combo === MOCK_TAKEN ? 'inUse' : 'active']));
  return { enabled, bindings, defaults: defaultBindings(), actions: ACTIONS, status };
}

const BUILTINS = [['silk', 'Living Silk'], ['fluid', 'Fluid Ink'], ['lissajous', 'Harmonics'], ['particles', 'Flow Field'], ['terrain', 'Spectral Terrain'], ['life', 'Cell Garden']];
function mockConfig() {
  let c;
  try { c = JSON.parse(localStorage.getItem(KEY)); } catch (e) { }
  c = c || { version: 1, items: [], assign: { '*': 'builtin-silk' }, span: false, paused: false, display: {}, system: { pauseWhenCovered: false, hibernate: false, battery: 'eco', audio: true, interactive: true, startWithWindows: false } };
  BUILTINS.forEach(([s, n], i) => { if (!c.items.some(it => it.id === 'builtin-' + s)) c.items.splice(i, 0, { id: 'builtin-' + s, name: n, kind: 'scene', scene: s, settings: {}, builtin: true }); });
  return c;
}
function mockMonitors() {
  const requested = Number(new URLSearchParams(location.search).get('monitors') || 1);
  const n = Number.isFinite(requested) ? Math.max(1, Math.min(8, Math.floor(requested))) : 1;
  const dpr = devicePixelRatio || 1, W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr);
  return Array.from({ length: n }, (_, i) => {
    const w = Math.floor(W / n), x = i * w;
    return { key: 'mock' + (i + 1), name: 'Display ' + (i + 1) + (i ? '' : ' \u00b7 main'), x, y: 0, w, h: H, wx: x, wy: 0, ww: w, wh: H, scale: dpr, primary: i === 0 };
  });
}
const idb = {
  db() { return new Promise((res, rej) => { const r = indexedDB.open('silk-engine-media', 1); r.onupgradeneeded = () => r.result.createObjectStore('m'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  async put(k, v) {
    const db = await this.db();
    return new Promise((res, rej) => {
      const t = db.transaction('m', 'readwrite'); t.objectStore('m').put(v, k);
      t.oncomplete = () => { db.close(); res(); };
      t.onerror = t.onabort = () => { db.close(); rej(t.error || Error('Media could not be saved')); };
    });
  },
  async get(k) {
    const db = await this.db();
    return new Promise((res, rej) => {
      const t = db.transaction('m'); const q = t.objectStore('m').get(k);
      t.oncomplete = () => { db.close(); res(q.result); };
      t.onerror = t.onabort = () => { db.close(); rej(t.error || Error('Media could not be read')); };
    });
  },
};
let pickedFiles = [];

const islandLog = [];
const islandMock = {
  quick: { wifi: true, bluetooth: false, volume: .62, muted: false },
  mixer: { devices: [{ id: 'demo-speakers', name: 'Speakers', default: true }, { id: 'demo-headphones', name: 'Headphones', default: false }], apps: [{ deviceId: 'demo-speakers', appId: 'spotify', name: 'Spotify', deviceName: 'Speakers', volume: .8, muted: false }, { deviceId: 'demo-speakers', appId: 'chrome', name: 'Google Chrome', deviceName: 'Speakers', volume: .5, muted: false }] },
  clipOn: false, clip: [], appsOn: false, apps: [], nextId: 1,
  // a pretend media player: its position moves with the clock, like a real one
  media: { active: true, app: 'Spotify', status: 'playing', base: 62, at: Date.now(), track: 0, noArt: false, canPrev: true, canNext: true, canToggle: true, canSeek: true },
};
const DEMO_TRACKS = [
  { title: 'Midnight City', artist: 'M83', album: "Hurry Up, We're Dreaming", duration: 243, hue: 285 },
  { title: 'Resonance', artist: 'HOME', album: 'Odyssey', duration: 212, hue: 190 },
  { title: 'Instant Crush (feat. Julian Casablancas)', artist: 'Daft Punk', album: 'Random Access Memories', duration: 337, hue: 20 },
];
const demoArt = hue => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 80% 62%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360} 75% 28%)"/></linearGradient></defs><rect width="200" height="200" fill="url(#g)"/><circle cx="130" cy="70" r="46" fill="hsl(${(hue + 30) % 360} 90% 78%)" opacity=".55"/><circle cx="70" cy="140" r="58" fill="hsl(${(hue + 200) % 360} 70% 40%)" opacity=".5"/></svg>`);
const demoPosition = m => { const d = DEMO_TRACKS[m.track].duration; return m.status === 'playing' ? Math.min(d, m.base + (Date.now() - m.at) / 1000) : m.base; };
if (!isApp && typeof globalThis === 'object') {
  globalThis.__islandMock = {
    log: islandLog, state: islandMock,
    copy(text) { if (islandMock.clipOn) { islandMock.clip = [{ id: islandMock.nextId++, text, at: Date.now() }, ...islandMock.clip.filter(c => c.text !== text)].slice(0, 30); } },
    use(name, seconds) { const key = name.toLowerCase(); const a = islandMock.apps.find(x => x.key === key); if (a) a.seconds += seconds; else islandMock.apps.push({ key, name, seconds }); },
    quick(patch) { Object.assign(islandMock.quick, patch); },
    media(patch) { const m = islandMock.media; if ('status' in patch || 'position' in patch) { m.base = patch.position ?? demoPosition(m); m.at = Date.now(); } Object.assign(m, patch); delete m.position; },
  };
}

const mock = {
  get_state() { return { config: mockConfig(), monitors: mockMonitors(), visibility: { covered: [], onBattery: false, hibernating: false }, platform: 'browser', version: 'dev' }; },
  _save(c) { localStorage.setItem(KEY, JSON.stringify(c)); broadcast('state', c); },
  profile_action({action,id,name}) {const c=mockConfig();c.profiles ||= [];if(action==='save'){if(c.profiles.length>=24&&!c.profiles.some(p=>p.id===id))throw Error('Maximum 24 profiles');const p={id:id||crypto.randomUUID(),name,assign:structuredClone(c.assign),span:c.span,display:structuredClone(c.display),widgets:structuredClone(c.widgets||{enabled:true,items:[]}),settings:Object.fromEntries(c.items.map(i=>[i.id,structuredClone(i.settings)]))};c.profiles=c.profiles.filter(v=>v.id!==p.id);c.profiles.push(p);}else if(action==='delete')c.profiles=c.profiles.filter(p=>p.id!==id);else{const p=c.profiles.find(p=>p.id===id);if(!p)throw Error('Profile missing');c.assign=Object.fromEntries(Object.entries(p.assign).filter(([,id])=>c.items.some(i=>i.id===id)));c.assign['*'] ||= 'builtin-silk';c.span=p.span;c.display=p.display;c.widgets=p.widgets;for(const i of c.items)if(p.settings[i.id])i.settings=p.settings[i.id];if(c.playlist)c.playlist.enabled=false;}this._save(c); },
  set_playlist({playlist}) {const c=mockConfig();c.playlist=playlist;this._save(c);},
  set_favorite({id,favorite}) {const c=mockConfig();c.favorites=(c.favorites||[]).filter(v=>v!==id);if(favorite)c.favorites.push(id);this._save(c);},
  set_widgets({ widgets }) { const c=mockConfig(); c.widgets=widgets; this._save(c); },
  // Crash handling in the browser preview: set localStorage 'silk-engine-mock-safe' to '1' to see the safe-mode banner.
  get_stability() {
    const crashed = localStorage.getItem('silk-engine-mock-crash') === '1'; localStorage.removeItem('silk-engine-mock-crash');
    return { safeMode: localStorage.getItem('silk-engine-mock-safe') === '1', crashedLastTime: crashed, crashReports: [], log: [] };
  },
  leave_safe_mode() { localStorage.removeItem('silk-engine-mock-safe'); },
  // ---- the island (browser preview): in-memory stand-ins for what the app does. __islandMock lets tests play "the user copied something".
  island_expand() {}, island_hide() {}, island_ready() { return null; },
  island_action({ id }) { const c = mockConfig(); if (id === 'pause') c.paused = !c.paused; if (id === 'oled') c.display = { ...c.display, oled: !c.display?.oled }; if (id === 'widgets') c.widgets = { ...(c.widgets || {}), enabled: !(c.widgets?.enabled ?? true) }; this._save?.(c); islandLog.push(['action', id]); },
  mixer_state() { return structuredClone(islandMock.mixer); },
  mixer_volume({ deviceId, appId, volume }) { const app = islandMock.mixer.apps.find(a => a.deviceId === deviceId && a.appId === appId); if (!app) throw Error('Audio session ended'); if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw Error('Invalid app volume'); app.volume = volume; if (volume > 0) app.muted = false; islandLog.push(['mixer_volume', appId, volume]); },
  mixer_output({ deviceId }) { const device = islandMock.mixer.devices.find(d => d.id === deviceId); if (!device) throw Error('Output disconnected'); for (const d of islandMock.mixer.devices) d.default = d.id === deviceId; for (const a of islandMock.mixer.apps) { a.deviceId = deviceId; a.deviceName = device.name; } islandLog.push(['mixer_output', deviceId]); },
  media_open({ id, sourceId }) { islandLog.push(['media_open', id, sourceId]); },
  quick_state() { return { ...islandMock.quick }; },
  quick_set({ what, value }) { const q = islandMock.quick; if (what === 'wifi') q.wifi = value >= .5; else if (what === 'bluetooth') q.bluetooth = value >= .5; else if (what === 'mute') q.muted = value >= .5; else if (what === 'volume') q.volume = value; else throw 'Unknown setting'; islandLog.push(['quick_set', what, value]); },
  quick_open({ page }) { islandLog.push(['quick_open', page]); },
  power_do({ action, confirmed }) { if (['signout', 'restart', 'shutdown'].includes(action) && !confirmed) throw 'This ends your session, so it has to be confirmed first'; islandLog.push(['power', action, confirmed]); },
  clip_state() { return { enabled: islandMock.clipOn, items: islandMock.clip.map(c => ({ id: c.id, preview: c.text.replace(/\s+/g, ' ').slice(0, 140), chars: c.text.length, ageSecs: Math.max(0, Math.floor((Date.now() - c.at) / 1000)) })) }; },
  clip_enable({ enabled }) { islandMock.clipOn = !!enabled; if (!enabled) islandMock.clip = []; },
  clip_use({ id }) { const c = islandMock.clip.find(x => x.id === id); if (!c) throw 'That item is gone'; islandLog.push(['clip_use', c.text]); },
  clip_remove({ id }) { islandMock.clip = islandMock.clip.filter(x => x.id !== id); },
  clip_clear() { islandMock.clip = []; },
  apps_state() { const total = islandMock.apps.reduce((n, a) => n + a.seconds, 0) || 1; return { enabled: islandMock.appsOn, items: [...islandMock.apps].sort((a, b) => b.seconds - a.seconds).slice(0, 8).map(a => ({ key: a.key, name: a.name, seconds: a.seconds, share: a.seconds / total * 100 })) }; },
  apps_enable({ enabled }) { islandMock.appsOn = !!enabled; },
  apps_clear() { islandMock.apps = []; },
  apps_launch({ key }) { islandLog.push(['apps_launch', key]); },
  apps_icon({ key }) {
    islandMock.iconAsks = (islandMock.iconAsks || 0) + 1;
    if (key.startsWith('noicon')) return null;                       // a program Windows has no icon for: the bubble keeps its neutral glyph
    let hue = 0; for (const ch of key) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
    return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="6" y="6" width="52" height="52" rx="13" fill="hsl(${hue} 70% 52%)"/><circle cx="32" cy="32" r="13" fill="none" stroke="#fff" stroke-width="5"/></svg>`);
  },
  media_state() {
    islandMock.mediaPolls = (islandMock.mediaPolls || 0) + 1;
    const m = islandMock.media; if (!m.active) return { active: false };
    const t = DEMO_TRACKS[m.track];
    return { active: true, app: m.app, sourceId: 'demo-player', title: m.title ?? t.title, artist: m.artist ?? t.artist, album: t.album, status: m.status, position: demoPosition(m), duration: m.duration ?? t.duration, canPrev: m.canPrev, canNext: m.canNext, canToggle: m.canToggle, canSeek: m.canSeek, thumbId: `demo-${m.track}` };
  },
  media_thumb({ id }) { const m = islandMock.media; return m.noArt || !String(id).startsWith('demo-') ? null : demoArt(DEMO_TRACKS[Number(String(id).slice(5)) % DEMO_TRACKS.length].hue); },
  media_control({ action, value }) {
    const m = islandMock.media;
    if (!m.active) throw 'Nothing is playing';
    if (action === 'toggle') { m.base = demoPosition(m); m.at = Date.now(); m.status = m.status === 'playing' ? 'paused' : 'playing'; }
    else if (action === 'next' || action === 'prev') { m.track = (m.track + (action === 'next' ? 1 : DEMO_TRACKS.length - 1)) % DEMO_TRACKS.length; m.base = 0; m.at = Date.now(); delete m.title; delete m.artist; delete m.duration; }
    else if (action === 'seek') { m.base = value; m.at = Date.now(); }
    else throw 'Unknown media action';
    islandLog.push(['media', action, ...(action === 'seek' ? [value] : [])]);
  },
  get_surface_accent() { return mockConfig().system?.themeSync ? localStorage.getItem('silk-engine-accent') : null; },
  get_hotkeys() { return hotkeysDto(); },
  set_hotkeys({ enabled, bindings }) {
    const stored = {};
    for (const [id, v] of Object.entries(bindings || {})) {
      if (!ACTIONS.some(x => x.id === id)) throw Error('Unknown hotkey action');
      const t = String(v).trim(); stored[id] = t ? canonicalAccel(parseAccel(t)) : '';
    }
    resolveStrict(effectiveBindings(stored));
    const c = mockConfig(); c.hotkeys = { enabled: !!enabled, bindings: stored }; this._save(c);
    return hotkeysDto();
  },
  hotkeys_suspend() { return hotkeysDto(); },
  widget_metrics() {
    if (globalThis.__demoMetrics) { const t = performance.now() / 1000, total = 16 * 2 ** 30; const ram = 58 + 6 * Math.sin(t / 5); return { battery: 83, hasBattery: true, charging: false, cpu: Math.max(2, 24 + 18 * Math.sin(t / 2.3) + 6 * Math.sin(t * 1.7)), ram, ramTotal: total, ramAvail: total * (1 - ram / 100), uptime: 3 * 3600 + t }; }
    return {battery:null,hasBattery:null,charging:false,cpu:null,ram:null,uptime:performance.now()/1000};
  },
  set_display({ patch }) { const c = mockConfig(); for (const [k, v] of Object.entries(patch)) v === null ? delete c.display[k] : c.display[k] = v; this._save(c); },
  set_system({ system }) { const c = mockConfig(); const off = c.system?.themeSync && !system.themeSync; c.system = system; this._save(c); if (off) broadcast('accent-applied', null); else if (system.themeSync) broadcast('accent-request', null); },
  // Browser preview: record the colour instead of touching Windows.
  apply_accent({ color }) { if (!/^#[0-9a-f]{6}$/i.test(color)) throw Error('Expected a #rrggbb colour'); if (mockConfig().system?.themeSync) { localStorage.setItem('silk-engine-accent', color); broadcast('accent-applied', color); } return true; },
  async add_paths({ paths }) {
    const c = mockConfig(), added = [];
    for (const p of paths) {
      const f = pickedFiles.find(f => f.name === p); if (!f) continue;
      const kind = f.type.startsWith('video/') ? 'video' : f.type.startsWith('image/') ? 'image' : null; if (!kind) continue;
      const it = { id: 'item-' + Date.now().toString(16) + Math.random().toString(16).slice(2, 6), name: f.name.replace(/\.[^.]+$/, ''), kind, path: f.name, settings: {}, builtin: false };
      await idb.put(it.id, f); c.items.push(it); added.push(it);
    }
    this._save(c); return added;
  },
  remove_item({ id }) { const c = mockConfig(); c.items = c.items.filter(i => i.id !== id || i.builtin); for (const k in c.assign) if (c.assign[k] === id) delete c.assign[k]; if (!c.assign['*']) c.assign['*'] = 'builtin-silk'; this._save(c); },
  update_item({ id, name, settings }) { const c = mockConfig(); const it = c.items.find(i => i.id === id); if (it) { if (name != null) it.name = name; if (settings) for (const [k, v] of Object.entries(settings)) v === null ? delete it.settings[k] : it.settings[k] = v; } this._save(c); },
  duplicate_item({ id }) { const c = mockConfig(); const s = c.items.find(i => i.id === id); if (!s) return null; const it = { ...s, id: 'item-' + Date.now().toString(16), name: s.name + ' copy', builtin: false, settings: { ...s.settings } }; c.items.push(it); this._save(c); return it; },
  assign({ monitor, itemId }) { const c = mockConfig(); if(c.playlist)c.playlist.enabled=false; if (monitor === '*') c.assign = {}; c.assign[monitor] = itemId; this._save(c); },
  set_span({ span }) { const c = mockConfig(); c.span = span; this._save(c); },
  set_paused({ paused }) { const c = mockConfig(); c.paused = paused; this._save(c); },
  export_settings() { return JSON.stringify(mockConfig(), null, 2); },
  import_settings({ contents }) { const c = JSON.parse(contents); if(c.version!==1||!Array.isArray(c.items)||!c.assign)throw Error('Invalid settings'); const old=mockConfig();localStorage.setItem(KEY+'-before-import',JSON.stringify(old));c.system.startWithWindows=old.system.startWithWindows;this._save(c); },
  reset_preferences() { const c=mockConfig();localStorage.setItem(KEY+'-before-reset',JSON.stringify(c)); c.display={};c.system={pauseWhenCovered:true,hibernate:true,battery:'eco',audio:true,interactive:true,startWithWindows:c.system.startWithWindows};c.paused=false;c.span=false;for(const item of c.items)item.settings={};this._save(c); },
  undo_reset() { const raw=localStorage.getItem(KEY+'-before-reset');if(!raw)throw Error('No reset recovery copy found');this._save(JSON.parse(raw)); },
  backup_settings() { localStorage.setItem(KEY + '-backup', JSON.stringify(mockConfig())); },
  restore_settings() { const backup = localStorage.getItem(KEY + '-backup'); if (!backup) throw new Error('No settings backup found'); const c = JSON.parse(backup); localStorage.setItem(KEY + '-before-restore', JSON.stringify(mockConfig())); this._save(c); },
  report_renderer_error({ message }) { broadcast('renderer-error', message); },
  config_dir() { return '(browser localStorage)'; },
};

// ---------------------------------------------------------------- public API
export const bridge = {
  isApp,
  invoke(cmd, args = {}) {
    if (isApp) return T.core.invoke(cmd, args);
    return Promise.resolve().then(() => mock[cmd] ? mock[cmd](args) : null);
  },
  listen(evt, cb) {
    if (isApp) { let un, disposed = false; T.event.listen(evt, e => { if (!disposed) cb(e.payload); }).then(u => { if (disposed) u(); else un = u; }).catch(console.error); return () => { disposed = true; un?.(); }; }
    return on(evt, cb);
  },
  /** URL the renderer uses to load a library item's file (or a file inside a web wallpaper). */
  async mediaURL(item, rel = '') {
    if (isApp) {
      const base = WIN ? 'http://wp.localhost/' : 'wp://localhost/';
      return base + encodeURIComponent(item.id) + '/' + rel.split('/').map(encodeURIComponent).join('/');
    }
    const blob = await idb.get(item.id);
    return blob ? URL.createObjectURL(blob) : null;
  },
  async pickFiles({ directory = false } = {}) {
    if (isApp) {
      const r = await T.core.invoke('plugin:dialog|open', { options: {
        multiple: !directory, directory,
        filters: directory ? undefined : [{ name: 'Wallpapers', extensions: ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'ogv', 'gif', 'webp', 'png', 'apng', 'jpg', 'jpeg', 'bmp', 'avif', 'svg', 'html', 'htm'] }],
      } });
      return r == null ? [] : Array.isArray(r) ? r : [r];
    }
    if (directory) { alert('Web wallpaper folders can be added in the desktop app.'); return []; }
    return new Promise(res => {
      const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.accept = 'image/*,video/*';
      i.onchange = () => { pickedFiles = [...i.files]; res(pickedFiles.map(f => f.name)); };
      i.click();
    });
  },
  async importCommunity(row,blob,apply,monitor){
    if(isApp)throw Error('Use the native community downloader');
    const id='community-'+row.id;await idb.put(id,blob);const c=mockConfig();const item={id,name:row.title,kind:row.extension==='gif'?'image':'video',path:'community/'+row.id+'.'+row.extension,settings:{}};
    if(!c.items.some(i=>i.id===id))c.items.push(item);if(apply){if(monitor==='*')c.assign={};c.assign[monitor]=id;}mock._save(c);return item;
  },
  /** Native drag & drop of files onto a window (paths). */
  onDrop(cb) {
    if (isApp && T.webview) {
      T.webview.getCurrentWebview().onDragDropEvent(e => { const p = e.payload; cb(p.type, p.paths || []); });
      return;
    }
    let n = 0;
    addEventListener('dragenter', e => { e.preventDefault(); n++; cb('enter', []); });
    addEventListener('dragover', e => e.preventDefault());
    addEventListener('dragleave', () => { if (--n <= 0) { n = 0; cb('leave', []); } });
    addEventListener('drop', e => { e.preventDefault(); n = 0; pickedFiles = [...e.dataTransfer.files]; cb('drop', pickedFiles.map(f => f.name)); });
  },
};
