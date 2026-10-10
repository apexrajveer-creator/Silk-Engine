// One API for both worlds:
//  * inside the app  -> Tauri commands/events
//  * in a plain browser (dev / web demo) -> a mock backend in localStorage, with
//    BroadcastChannel standing in for events so a Studio tab drives a renderer tab.

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

const BUILTINS = [['silk', 'Living Silk'], ['fluid', 'Fluid Ink'], ['lissajous', 'Harmonics'], ['particles', 'Flow Field']];
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

const mock = {
  get_state() { return { config: mockConfig(), monitors: mockMonitors(), visibility: { covered: [], onBattery: false, hibernating: false }, platform: 'browser', version: 'dev' }; },
  _save(c) { localStorage.setItem(KEY, JSON.stringify(c)); broadcast('state', c); },
  profile_action({action,id,name}) {const c=mockConfig();c.profiles ||= [];if(action==='save'){if(c.profiles.length>=24&&!c.profiles.some(p=>p.id===id))throw Error('Maximum 24 profiles');const p={id:id||crypto.randomUUID(),name,assign:structuredClone(c.assign),span:c.span,display:structuredClone(c.display),widgets:structuredClone(c.widgets||{enabled:true,items:[]}),settings:Object.fromEntries(c.items.map(i=>[i.id,structuredClone(i.settings)]))};c.profiles=c.profiles.filter(v=>v.id!==p.id);c.profiles.push(p);}else if(action==='delete')c.profiles=c.profiles.filter(p=>p.id!==id);else{const p=c.profiles.find(p=>p.id===id);if(!p)throw Error('Profile missing');c.assign=Object.fromEntries(Object.entries(p.assign).filter(([,id])=>c.items.some(i=>i.id===id)));c.assign['*'] ||= 'builtin-silk';c.span=p.span;c.display=p.display;c.widgets=p.widgets;for(const i of c.items)if(p.settings[i.id])i.settings=p.settings[i.id];if(c.playlist)c.playlist.enabled=false;}this._save(c); },
  set_playlist({playlist}) {const c=mockConfig();c.playlist=playlist;this._save(c);},
  set_favorite({id,favorite}) {const c=mockConfig();c.favorites=(c.favorites||[]).filter(v=>v!==id);if(favorite)c.favorites.push(id);this._save(c);},
  set_widgets({ widgets }) { const c=mockConfig(); c.widgets=widgets; this._save(c); },
  widget_metrics() { return {cpu:null,ram:null,uptime:performance.now()/1000}; },
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
