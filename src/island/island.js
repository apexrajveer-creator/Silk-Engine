// The island's interface. The app (island_host.rs) decides WHEN it appears and where; this decides what it looks like and does.
//   hidden -> peek (a small bar) -> open (the panel with six tabs). Esc, clicking away, or the cursor leaving closes it.
// Everything shown that comes from outside (clipboard text, app names, wallpaper titles) is set with textContent, never as HTML.
import { bindSurfaceTheme } from '../shared/surface-theme.js';
import { batteryDisplay, visualizerLevels } from './compact.js';
import { bridge } from '../shared/bridge.js';
import { SCENES } from '../shared/catalog.js';
import { createGate, createPoller, createLatestWriter, BoundedCache } from './lifecycle.js';
import { thumbnail, clearThumbnailMemory } from '../studio/thumbs.js';   // the Studio's own thumbnail maker and cache: videos and images get real previews here too
import { fmtClock, livePosition, progressPct, mediaMode, mediaLines, TABS, nextTab, clampPct, pushSample, sparkline, fmtDuration, fmtAge, fmtGb, memoryUse, monogram, peekText, describeQuick, volumeLevel, powerStep, stillArmed, inPreviewZone, DESTRUCTIVE } from './model.js';

const $ = id => document.getElementById(id);
const root = $('island'), shell = $('shell'), peek = $('peek'), panel = $('panel'), tabsEl = $('tabs'), viewsEl = $('views'), pill = $('tabPill'), noteEl = $('note');
if (!bridge.isApp) { document.body.dataset.preview = ''; globalThis.__demoMetrics = true; }

// ---------------------------------------------------------------- small helpers
const NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  quick: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  clipboard: '<rect x="6" y="4.5" width="12" height="16.5" rx="2.5"/><path d="M9 4.5h6V7H9z"/>',
  system: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  apps: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
  wallpapers: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
  power: '<path d="M12 3v9"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>',
  wifi: '<path d="M2 9a15 15 0 0 1 20 0"/><path d="M5.5 12.5a10 10 0 0 1 13 0"/><path d="M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="19.2" r=".9" fill="currentColor"/>',
  bluetooth: '<path d="m7 7 10 10-5 5V2l5 5L7 17"/>',
  speaker0: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  speaker1: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 10a3.5 3.5 0 0 1 0 4"/>',
  speaker2: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9.5a4.5 4.5 0 0 1 0 5"/>',
  speaker3: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9.5a4.5 4.5 0 0 1 0 5"/><path d="M18.7 6.8a8 8 0 0 1 0 10.4"/>',
  pause: '<path d="M8 5v14M16 5v14"/>', play: '<path d="m8 5 11 7-11 7z"/>',
  oled: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor"/>',
  widgets: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><path d="M17 13v8M13 17h8"/>',
  prev: '<path d="M7 5v14"/><path d="m19 5-9 7 9 7z"/>', next: '<path d="M17 5v14"/><path d="m5 5 9 7-9 7z"/>',
  shuffle: '<path d="M3 7h4l10 10h4M3 17h4l3-3M14 10l3-3h4M18 4l3 3-3 3M18 14l3 3-3 3"/>',
  sleep: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 7 7 0 0 0 20 14.5z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  signout: '<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="m16 8 4 4-4 4M20 12H9"/>',
  restart: '<path d="M20 12a8 8 0 1 1-2.5-5.8"/><path d="M20 4v5h-5"/>',
  shutdown: '<path d="M12 3v9"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  appglyph: '<rect x="3.5" y="5" width="17" height="14" rx="3"/><path d="M3.5 9.5h17"/><circle cx="6.8" cy="7.3" r=".7" fill="currentColor"/><circle cx="9.4" cy="7.3" r=".7" fill="currentColor"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  playFill: '<path d="M8 5.2v13.6a.6.6 0 0 0 .9.5l10.6-6.8a.6.6 0 0 0 0-1L8.9 4.7a.6.6 0 0 0-.9.5z" fill="currentColor" stroke="none"/>',
  pauseFill: '<rect x="6.5" y="4.8" width="4" height="14.4" rx="1.3" fill="currentColor" stroke="none"/><rect x="13.5" y="4.8" width="4" height="14.4" rx="1.3" fill="currentColor" stroke="none"/>',
  prevFill: '<rect x="5" y="5" width="2.4" height="14" rx="1.1" fill="currentColor" stroke="none"/><path d="M19 6.4v11.2a.6.6 0 0 1-.95.5L9.8 12.5a.6.6 0 0 1 0-1l8.25-5.6a.6.6 0 0 1 .95.5z" fill="currentColor" stroke="none"/>',
  nextFill: '<rect x="16.6" y="5" width="2.4" height="14" rx="1.1" fill="currentColor" stroke="none"/><path d="M5 6.4v11.2c0 .5.55.78.95.5l8.25-5.6a.6.6 0 0 0 0-1L5.95 5.9A.6.6 0 0 0 5 6.4z" fill="currentColor" stroke="none"/>',
  shield: '<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z"/>',
};
function icon(name, cls = '') { const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); if (cls) s.setAttribute('class', cls); s.innerHTML = ICONS[name] || ''; return s; }   // ICONS are constants, not data
function updateIcon(button, name) {
  if (button.dataset.icon === name) return;
  button.firstChild.replaceWith(icon(name)); button.dataset.icon = name;
}
function h(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
const frame = () => new Promise(r => requestAnimationFrame(() => r()));
const wait = ms => new Promise(r => setTimeout(r, ms));
const subscriptions = [];
const listen = (event, cb) => { const dispose = bridge.listen(event, cb); subscriptions.push(dispose); return dispose; };
const transitions = createGate();
let hostGeneration = null, activeTab = null, disposed = false;
const visible = () => !disposed && !document.hidden;
const active = id => visible() && S.state === 'open' && S.tab === id;
const errText = e => String(e?.message ?? e ?? 'Something went wrong');

async function call(cmd, args) {
  try { return await bridge.invoke(cmd, args); } catch (e) { say(errText(e)); return undefined; }
}
/** Like call(), but says whether it worked. */
async function attempt(cmd, args) {
  try { await bridge.invoke(cmd, args); return true; } catch (e) { say(errText(e)); return false; }
}
let noteTimer = 0;
function say(text) { if (S.state === 'hidden' || !visible()) return; noteEl.textContent = text; noteEl.hidden = false; clearTimeout(noteTimer); noteTimer = setTimeout(() => { noteEl.hidden = true; }, 2600); }

const actionLocks = new Set();
async function runAction(command, args, button, after) {
  const key = `${command}:${JSON.stringify(args ?? {})}`;
  if (actionLocks.has(key)) return;
  actionLocks.add(key); button?.setAttribute('aria-busy', 'true');
  try { if (await attempt(command, args)) after?.(); }
  finally { actionLocks.delete(key); button?.removeAttribute('aria-busy'); }
}

const themeStop = bindSurfaceTheme(bridge, document.documentElement.style);
function paintIslandAppearance(config) {
  const raw = config?.system?.islandTransparency;
  const transparency = Number.isFinite(raw) ? Math.max(0, Math.min(80, raw)) : 12;
  document.documentElement.style.setProperty('--island-opacity', String(1 - transparency / 100));
}
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const battery = $('peekBattery'), batteryPercent = $('batteryPercent'), batteryFill = $('batteryFill'), wave = $('peekWave');
const waveBars = Array.from({ length: 8 }, () => { const bar = h('i'); wave?.append(bar); return bar; });
let audioAt = 0;
function paintWave(audio) {
  const levels = visualizerLevels(audio);
  levels.forEach((level, i) => waveBars[i].style.setProperty('--level', String(level)));
  const playing = levels.some(level => level > .14);
  if (wave) { wave.dataset.playing = String(playing); wave.setAttribute('aria-label', `System audio visualizer, ${playing ? 'playing' : 'idle'}`); }
}
listen('audio', audio => { if (S.state === 'peek' && visible()) { audioAt = performance.now(); paintWave(audio); } });

// ---------------------------------------------------------------- state
const S = { state: 'hidden', tab: 'quick', cpu: [], ram: [], metrics: null, cfg: null, power: { armed: null, at: 0 }, views: {} };

function setState(next) {
  if (S.state === 'open' && next !== 'open') {
    S.views[activeTab]?.leave?.(); activeTab = null;
    clearTimeout(entranceTimer);
    for (const view of Object.values(S.views)) view.el.classList.remove('entering');
  }
  S.state = next; root.dataset.state = next;
  panel.setAttribute('aria-hidden', String(next !== 'open')); panel.inert = next !== 'open';
  peek.tabIndex = next === 'peek' ? 0 : -1; peek.inert = next !== 'peek';
  if (next !== 'peek') paintWave(null);
  if (next === 'hidden' || !visible()) metricsPoll.stop(); else metricsPoll.start();
  if (next === 'hidden') { clearTimeout(noteTimer); noteEl.hidden = true; }
}

let showing = null, opening = null;
function showPeek() {
  if (S.state === 'peek' || S.state === 'open') return Promise.resolve();
  if (showing) return showing;
  const token = transitions.next();
  const task = (async () => {
    await frame(); await frame();
    if (transitions.valid(token) && visible()) setState('peek');
  })();
  showing = task;
  task.finally(() => { if (showing === task) showing = null; });
  return task;
}

function open(viaKeyboard = false) {
  if (S.state === 'open') return Promise.resolve();
  if (opening) return opening;
  const token = transitions.next();
  const task = (async () => {
    try {
      const generation = await bridge.invoke('island_expand', { expanded: true, expectedGeneration: hostGeneration });
      if (!acceptHostGeneration(generation)) return;
      if (!transitions.valid(token) || !visible()) return;
      if (S.state === 'hidden') { setState('peek'); await frame(); }
      await frame();
      if (!transitions.valid(token) || !visible()) return;
      setState('open'); selectTab(S.tab, true);
      await wait(30);
      if (!transitions.valid(token) || S.state !== 'open') return;
      placePill();
      if (viaKeyboard === true) tabButtons[S.tab]?.focus({ preventScroll: true });
    } catch (error) { if (transitions.valid(token)) say(errText(error)); }
  })();
  opening = task;
  task.finally(() => { if (opening === task) opening = null; });
  return task;
}

async function dismiss() {
  if (S.state === 'hidden' && !opening && !showing) return;
  const token = transitions.next();
  showing = opening = null;
  setState('hidden');
  await wait(matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 280);
  if (transitions.valid(token) && S.state === 'hidden') await call('island_hide', { expectedGeneration: hostGeneration });
}

// ---------------------------------------------------------------- polling (only while something is on screen)
const metricsPoll = createPoller(() => bridge.invoke('widget_metrics'), m => {
  S.metrics = m;
  const power = batteryDisplay(m);
  if (battery) { battery.setAttribute('aria-label', power.label); battery.dataset.charging = String(power.charging); battery.dataset.low = String(power.low); batteryPercent.textContent = power.text; batteryFill.setAttribute('width', String(power.level * 15)); }
  if (performance.now() - audioAt > 700) paintWave(null);
  S.cpu = pushSample(S.cpu, clampPct(m?.cpu)); S.ram = pushSample(S.ram, clampPct(m?.ram));
  const p = peekText(m);
  $('peekTime').textContent = p.time; $('peekCpu').textContent = p.cpu; $('peekRam').textContent = p.ram;
  if (S.state === 'open') S.views[S.tab]?.tick?.();
}, 1000);

// Keep focus and scrolling stable even when the structure really changes (new clipboard entries, new app ranks).
function preserveView(el, render) {
  const focused = el.contains(document.activeElement) ? document.activeElement : null;
  const owner = focused?.closest('[data-id], [data-key]');
  const key = owner?.dataset.id ?? owner?.dataset.key;
  const remove = focused?.classList.contains('x');
  const label = focused?.getAttribute('aria-label') ?? focused?.textContent;
  const scrolls = [...el.querySelectorAll('.clips, .walls')].map(node => [node.className, node.scrollTop]);
  const top = el.scrollTop;
  try { render(); } finally {
    // Do not steal focus if an async update arrived after the user moved outside this view.
    if (focused && !focused.isConnected && (document.activeElement === document.body || document.activeElement === focused)) {
      let replacement = key == null ? null : [...el.querySelectorAll('[data-id], [data-key]')].find(node => (node.dataset.id ?? node.dataset.key) === key);
      if (replacement && remove) replacement = replacement.querySelector('.x');
      replacement ||= [...el.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') ?? node.textContent) === label);
      replacement ||= el.querySelector('button, [role=button]');
      replacement?.focus({ preventScroll: true });
    }
    el.scrollTop = top;
    for (const [cls, value] of scrolls) [...el.querySelectorAll('.clips, .walls')].find(node => node.className === cls)?.scrollTo({ top: value });
  }
}

// ---------------------------------------------------------------- tabs
const tabButtons = {};
let entranceTimer = 0;
for (const t of TABS) {
  const b = h('button', 'tab'); b.type = 'button'; b.id = `tab-${t.id}`; b.setAttribute('role', 'tab'); b.setAttribute('aria-controls', `view-${t.id}`); b.setAttribute('aria-selected', 'false'); b.tabIndex = -1;
  b.append(icon(t.id), h('span', '', t.label));
  b.addEventListener('click', () => selectTab(t.id));
  tabsEl.append(b); tabButtons[t.id] = b;
}
function placePill() {
  const b = tabButtons[S.tab];
  if (!b || !b.offsetWidth) return;
  pill.style.width = `${b.offsetWidth}px`;
  pill.style.transform = `translateX(${b.offsetLeft}px)`;
}
function selectTab(id, force = false) {
  if (!TABS.some(t => t.id === id)) return;
  if (!force && activeTab === id) return;
  S.views[activeTab]?.leave?.();
  activeTab = id; S.tab = id; root.dataset.tab = id;
  for (const t of TABS) { const on = t.id === id; tabButtons[t.id].setAttribute('aria-selected', String(on)); tabButtons[t.id].tabIndex = on ? 0 : -1; S.views[t.id].el.classList.toggle('on', on); S.views[t.id].el.inert = !on; }
  clearTimeout(entranceTimer);
  for (const view of Object.values(S.views)) view.el.classList.remove('entering');
  S.views[id].el.classList.add('entering');
  entranceTimer = setTimeout(() => S.views[id].el.classList.remove('entering'), 360);
  [...S.views[id].el.children].forEach((c, i) => c.style.setProperty('--i', i));
  placePill();
  S.views[id].enter?.();
}
const pillObserver = new ResizeObserver(placePill); pillObserver.observe(tabsEl);

// ---------------------------------------------------------------- Quick
// A media card (what is playing, with artwork, progress and controls), a compact row of switches, the volume, and shortcuts.
function quickView() {
  const el = h('section', 'view'); el.id = 'view-quick'; el.setAttribute('role', 'tabpanel'); el.setAttribute('aria-labelledby', 'tab-quick');

  // ---- the media card
  const media = h('div', 'media'); media.dataset.mode = 'none'; media.dataset.art = 'false';
  const mediaBg = h('div', 'media-bg'); mediaBg.setAttribute('aria-hidden', 'true');
  const art = h('button', 'art'); art.type = 'button'; art.setAttribute('aria-label', 'Open media player'); art.disabled = true; const artImg = h('img'); artImg.alt = ''; artImg.draggable = false; const artPh = h('div', 'art-ph'); artPh.append(icon('music')); art.append(artImg, artPh);
  const main = h('div', 'media-main');
  const appName = h('div', 'media-app'), title = h('h3', 'media-title'), artist = h('p', 'media-artist');
  const seekRow = h('div', 'media-seek'), tNow = h('span', 't', '0:00'), tAll = h('span', 't', '0:00');
  const seek = h('input'); seek.type = 'range'; seek.min = 0; seek.max = 1; seek.step = 'any'; seek.value = 0; seek.setAttribute('aria-label', 'Track position');
  seekRow.append(tNow, seek, tAll);
  const controls = h('div', 'media-controls');
  const mc = (id, label, ic, cls = '') => { const b = h('button', `mc ${cls}`.trim()); b.type = 'button'; b.dataset.id = id; b.setAttribute('aria-label', label); b.title = label; b.append(icon(ic)); controls.append(b); return b; };
  const bPrev = mc('prev', 'Previous track', 'prevFill'), bToggle = mc('toggle', 'Play', 'playFill', 'big'), bNext = mc('next', 'Next track', 'nextFill');
  const copy = h('div', 'media-copy'), copyHost = h('div', 'media-copy-host');
  copy.append(appName, title, artist); copyHost.append(copy);
  main.append(copyHost, seekRow, controls);
  media.append(mediaBg, art, main);

  let m = { active: false }, fetchedAt = 0, artFor = '', dragging = false, mediaBusy = false, mediaRevision = 0, artAttempts = 0, nextArtRetry = 0;
  let mediaFollowup = 0, quickActive = false, volumeEditing = false, volumeUntil = 0;
  let openingMedia = false;
  art.addEventListener('click', async () => {
    if (openingMedia || !quickActive || !m.active) return;
    openingMedia = true; art.disabled = true;
    try {
      // Resolve the currently displayed track natively, never launch a frontend-supplied path.
      await bridge.invoke('media_open', { id: m.thumbId || '', sourceId: m.sourceId || '' });
      if (quickActive) await dismiss();
    } catch (error) { if (quickActive) say(errText(error)); }
    finally { openingMedia = false; if (quickActive) paintMedia(); }
  });
  let songKey = null, previousLines = null, copyGhost = null, artGhost = null, glowGhost = null, songTimer = 0;
  function clearSongTransition() {
    clearTimeout(songTimer); songTimer = 0;
    copyGhost?.remove(); artGhost?.remove(); glowGhost?.remove(); copyGhost = artGhost = glowGhost = null;
    copy.classList.remove('song-in');
  }
  function transitionSong(key, lines) {
    if (key === songKey) return;
    clearSongTransition();
    if (songKey !== null && quickActive && visible() && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // Outgoing metadata/artwork are decorative only. The live controls never get cloned or replaced.
      copyGhost = h('div', 'media-copy song-out'); copyGhost.inert = true; copyGhost.setAttribute('aria-hidden', 'true');
      const source = h('div', 'media-app', previousLines.source); source.hidden = !previousLines.source;
      copyGhost.append(source, h('h3', 'media-title', previousLines.title), h('p', 'media-artist', previousLines.subtitle));
      copyHost.append(copyGhost); copy.classList.add('song-in');
      const oldArt = artImg.getAttribute('src');
      if (oldArt && media.dataset.art === 'true') {
        artGhost = h('img', 'media-art-ghost'); artGhost.alt = ''; artGhost.setAttribute('aria-hidden', 'true');
        artGhost.src = oldArt; art.append(artGhost);
        glowGhost = h('div', 'media-bg song-glow-out'); glowGhost.setAttribute('aria-hidden', 'true');
        glowGhost.style.setProperty('--art', media.style.getPropertyValue('--art')); media.prepend(glowGhost);
      }
      songTimer = setTimeout(clearSongTransition, 240);
    }
    songKey = key; previousLines = { ...lines };
  }

  const artworkPoll = createPoller(async () => {
    const id = artFor;
    return id ? { id, url: await bridge.invoke('media_thumb', { id }) } : null;
  }, ({ id, url }) => { if (quickActive && artFor === id) setArt(url || null); }, 0);
  artImg.addEventListener('error', () => { setArt(null); nextArtRetry = performance.now() + 3000; });
  artImg.addEventListener('load', () => { if (artImg.getAttribute('src')) media.dataset.art = 'true'; });
  function setArt(url) {
    if (typeof url === 'string' && /^data:image\//i.test(url)) { if (artImg.getAttribute('src') === url) return; media.dataset.art = 'false'; artImg.src = url; media.style.setProperty('--art', `url("${url}")`); }
    else { artImg.removeAttribute('src'); media.dataset.art = 'false'; media.style.removeProperty('--art'); }
  }
  function paintClock() {
    if (!m.active) { seek.value = 0; tNow.textContent = '0:00'; tAll.textContent = '0:00'; seek.style.setProperty('--p', '0%'); return; }
    const pos = dragging ? Number(seek.value) : livePosition(m, performance.now() - fetchedAt);
    if (!dragging) seek.value = pos;
    tNow.textContent = fmtClock(pos); tAll.textContent = m.duration > 0 ? fmtClock(m.duration) : 'Live';
    seek.style.setProperty('--p', `${progressPct(pos, m.duration)}%`);
  }
  function paintMedia() {
    const mode = mediaMode(m), L = mediaLines(m), can = k => m.active && !!m[k];
    transitionSong(JSON.stringify([!!m.active, L.source, L.title, L.subtitle, m.thumbId || '']), L);
    media.dataset.mode = mode;
    art.disabled = !m.active || !m.thumbId || openingMedia; art.title = m.active ? `Open ${m.app || 'media player'}` : 'Nothing is playing'; art.setAttribute('aria-label', art.title);
    appName.textContent = L.source; appName.hidden = !L.source;
    title.textContent = L.title; title.title = m.active ? L.title : '';
    artist.textContent = L.subtitle;
    bPrev.disabled = mediaBusy || !can('canPrev'); bNext.disabled = mediaBusy || !can('canNext'); bToggle.disabled = mediaBusy || !can('canToggle');
    const isPlaying = mode === 'playing';
    bToggle.dataset.state = isPlaying ? 'playing' : 'paused'; bToggle.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play'); bToggle.title = isPlaying ? 'Pause' : 'Play';
    updateIcon(bToggle, isPlaying ? 'pauseFill' : 'playFill');
    seek.disabled = mediaBusy || !can('canSeek'); seek.max = Math.max(1, m.duration || 1);
    paintClock();
  }
  const mediaPoll = createPoller(async () => {
    const revision = mediaRevision;
    return { next: await bridge.invoke('media_state'), revision };
  }, ({ next, revision }) => {
    if (!next || dragging || mediaBusy || revision !== mediaRevision) return;
    m = next.active ? next : { active: false }; fetchedAt = performance.now(); paintMedia();
    if (!m.active || !m.thumbId) { artworkPoll.invalidate(); artFor = ''; setArt(null); return; }
    if (m.thumbId !== artFor || (!artImg.getAttribute('src') && artAttempts < 3 && performance.now() >= nextArtRetry)) {
      if (m.thumbId !== artFor) artAttempts = 0;
      ++artAttempts; nextArtRetry = performance.now() + 3000;
      artFor = m.thumbId;
      setArt(null); // Never attach the old track's artwork to the new title.
      artworkPoll.invalidate(); void artworkPoll.refresh();
    }
  }, 1000);
  function refreshMedia() { return mediaPoll.refresh(); }
  async function send(action, value = 0, rollback = null) {
    if (mediaBusy || !quickActive) return;
    mediaBusy = true; ++mediaRevision; mediaPoll.invalidate(); paintMedia();
    try { await bridge.invoke('media_control', { action, value }); }
    catch (error) { if (rollback) { m = rollback.state; fetchedAt = rollback.at; } if (quickActive) say(errText(error)); }
    finally {
      mediaBusy = false;
      if (quickActive) {
        paintMedia(); clearTimeout(mediaFollowup);
        mediaFollowup = setTimeout(refreshMedia, 250);
      }
    }
  }
  bPrev.addEventListener('click', () => send('prev'));
  bNext.addEventListener('click', () => send('next'));
  bToggle.addEventListener('click', () => {
    if (!m.active || mediaBusy) return;
    const rollback = { state: m, at: fetchedAt };
    const playing = mediaMode(m) === 'playing';
    m = { ...m, status: playing ? 'paused' : 'playing', position: livePosition(m, performance.now() - fetchedAt) }; fetchedAt = performance.now();
    void send('toggle', 0, rollback);
  });
  seek.addEventListener('input', () => { dragging = true; ++mediaRevision; mediaPoll.invalidate(); paintClock(); });
  seek.addEventListener('change', () => {
    const rollback = { state: m, at: fetchedAt };
    const v = Number(seek.value); dragging = false;
    m = { ...m, position: v }; fetchedAt = performance.now(); paintClock();
    void send('seek', v, rollback);
  });
  const cancelSeek = () => { if (dragging) { dragging = false; void refreshMedia(); } };
  seek.addEventListener('pointercancel', cancelSeek); seek.addEventListener('blur', cancelSeek);

  // ---- the switches: one compact row
  const tiles = h('div', 'tiles'), defs = [
    { id: 'wifi', label: 'Wi-Fi', long: 'Wi-Fi', icon: () => 'wifi', radio: true, page: 'network' },
    { id: 'bluetooth', label: 'Bluetooth', long: 'Bluetooth', icon: () => 'bluetooth', radio: true, page: 'bluetooth' },
    { id: 'mute', label: 'Mute', long: 'Mute', icon: () => `speaker${volumeLevel(q?.volume, true)}` },
    { id: 'pause', label: 'Wallpaper', long: 'Pause wallpaper', icon: () => (S.cfg?.paused ? 'play' : 'pause') },
    { id: 'oled', label: 'OLED', long: 'OLED black', icon: () => 'oled' },
    { id: 'widgets', label: 'Widgets', long: 'Widgets', icon: () => 'widgets' },
  ];
  let q = null; const els = {};
  for (const d of defs) {
    const b = h('button', 'tile'); b.type = 'button'; b.dataset.id = d.id;
    b.append(icon(d.icon()), h('span', 'lbl', d.label));
    b.addEventListener('click', () => toggle(d));
    tiles.append(b); els[d.id] = b;
  }
  const vol = h('div', 'card volume'); const volIcon = icon('speaker2'); const slider = h('input'); slider.type = 'range'; slider.min = 0; slider.max = 100; slider.setAttribute('aria-label', 'Volume'); const volOut = h('output', '', '--');
  const mixerToggle = h('button', 'mixer-toggle'); mixerToggle.type = 'button'; mixerToggle.setAttribute('aria-label', 'App volumes and audio output'); mixerToggle.setAttribute('aria-expanded', 'false'); mixerToggle.setAttribute('aria-controls', 'audioMixer'); mixerToggle.append(volIcon);
  vol.append(mixerToggle, slider, volOut);
  const mixer = h('div', 'mixer-section'); mixer.id = 'audioMixer'; mixer.inert = true; mixer.setAttribute('aria-hidden', 'true');
  const mixerClip = h('div', 'mixer-clip'), mixerBody = h('section', 'card mixer-body'); mixerBody.setAttribute('aria-label', 'Audio mixer');
  mixerClip.append(mixerBody); mixer.append(mixerClip);
  const outputHead = h('div', 'mixer-output-head'), outputLabel = h('span', 'muted', 'Output');
  const outputButton = h('button', 'output-button', 'Loading…'); outputButton.type = 'button'; outputButton.setAttribute('aria-expanded', 'false'); outputButton.setAttribute('aria-controls', 'audioOutputs');
  outputHead.append(outputLabel, outputButton);
  const outputList = h('div', 'output-list'); outputList.id = 'audioOutputs'; outputList.hidden = true; outputList.setAttribute('aria-label', 'Audio output devices');
  const appList = h('div', 'mixer-apps'), mixerStatus = h('p', 'mixer-status', 'Loading audio apps…'); mixerStatus.setAttribute('role', 'status');
  const mixerFooter = h('button', 'chip mixer-settings', 'Sound settings'); mixerFooter.type = 'button'; mixerFooter.addEventListener('click', () => call('quick_open', { page: 'sound' }));
  mixerBody.append(outputHead, outputList, appList, mixerStatus, mixerFooter);
  let mixerOpen = false, outputOpen = false, outputBusy = false, mixerRevision = 0, mixerScrollTimer = 0, deviceSignature = '', lastDevices = [], mixerErrorUntil = 0, mixerErrorText = '';
  function mixerError(error) { mixerErrorUntil = performance.now() + 3500; mixerErrorText = errText(error); if (quickActive && mixerOpen) { mixerStatus.hidden = false; mixerStatus.textContent = mixerErrorText; } }
  const mixerRows = new Map();
  const mixing = () => [...mixerRows.values()].some(r => r.editing || r.timer || r.writer.busy);
  function paintOutputs(devices) {
    lastDevices = devices;
    const signature = JSON.stringify(devices); const blocked = outputBusy || mixing();
    const current = devices.find(d => d.default);
    outputButton.textContent = outputBusy ? 'Switching…' : current?.name || 'Choose output';
    outputButton.disabled = blocked || !devices.length;
    if (signature !== deviceSignature) {
      deviceSignature = signature; const focused = outputList.contains(document.activeElement) ? document.activeElement?.dataset.device : null;
      outputList.textContent = '';
      for (const device of devices) {
        const button = h('button', 'output-choice', device.name); button.type = 'button'; button.dataset.device = device.id; button.setAttribute('aria-pressed', String(!!device.default)); button.disabled = blocked;
        button.addEventListener('click', () => switchOutput(device.id)); outputList.append(button);
        if (focused === device.id) button.focus();
      }
    }
    for (const button of outputList.children) button.disabled = blocked;
  }
  function setOutputOpen(open) { outputOpen = open; outputList.hidden = !open; outputButton.setAttribute('aria-expanded', String(open)); }
  outputButton.addEventListener('click', () => setOutputOpen(!outputOpen));
  outputList.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation?.(); setOutputOpen(false); outputButton.focus(); } });
  async function switchOutput(deviceId) {
    if (outputBusy || mixing()) return;
    outputBusy = true; ++mixerRevision; mixerPoll.invalidate(); paintOutputs(lastDevices);
    for (const row of mixerRows.values()) row.slider.disabled = true;
    try { await bridge.invoke('mixer_output', { deviceId }); setOutputOpen(false); if (quickActive && mixerOpen) outputButton.focus(); quickPoll.invalidate(); void refresh(); }
    catch (error) { mixerError(error) }
    finally { outputBusy = false; ++mixerRevision; mixerPoll.invalidate(); paintOutputs(lastDevices); for (const row of mixerRows.values()) row.slider.disabled = false; void mixerPoll.refresh(); }
  }
  function makeMixerRow(app, key) {
    const row = h('div', 'mixer-app'); row.dataset.key = key;
    const label = h('div', 'mixer-app-label'), name = h('span', '', app.name), device = h('small', 'muted', app.deviceName); label.append(name, device);
    const bar = h('div', 'mixer-app-bar'), input = h('input'); input.type = 'range'; input.min = 0; input.max = 100; input.step = 1;
    const out = h('output'); bar.append(input, out); row.append(label, bar);
    const r = { el: row, name, device, slider: input, out, editing: false, timer: 0, confirmed: app.volume, failed: false };
    const draw = value => { input.value = Math.round(Math.max(0, Math.min(1, value)) * 100); input.style.setProperty('--p', `${input.value}%`); out.textContent = `${input.value}%`; };
    r.draw = draw;
    r.writer = createLatestWriter(async volume => {
      await bridge.invoke('mixer_volume', { deviceId: app.deviceId, appId: app.appId, volume }); r.confirmed = volume; r.failed = false;
    }, {
      onError: error => { r.failed = true; mixerError(error) },
      onIdle: () => { if (r.failed && !r.editing && !r.timer) draw(r.confirmed); paintOutputs(lastDevices); ++mixerRevision; mixerPoll.invalidate(); void mixerPoll.refresh(); },
    });
    r.flush = () => { clearTimeout(r.timer); r.timer = 0; r.writer.push(Number(input.value) / 100); };
    input.addEventListener('pointerdown', () => { r.editing = true; paintOutputs(lastDevices); });
    input.addEventListener('input', () => { ++mixerRevision; mixerPoll.invalidate(); draw(Number(input.value) / 100); clearTimeout(r.timer); r.timer = setTimeout(r.flush, 80); paintOutputs(lastDevices); });
    r.end = () => { r.editing = false; if (r.timer) r.flush(); if (r.failed && !r.writer.busy) draw(r.confirmed); paintOutputs(lastDevices); };
    for (const event of ['change', 'pointerup', 'pointercancel', 'blur']) input.addEventListener(event, r.end);
    return r;
  }
  function paintMixer(state) {
    if (!mixerOpen || !quickActive || outputBusy) return;
    paintOutputs(Array.isArray(state.devices) ? state.devices : []);
    const apps = Array.isArray(state.apps) ? state.apps : [], keys = new Set();
    for (const app of apps) {
      if (!Number.isFinite(app.volume) || typeof app.appId !== 'string' || typeof app.deviceId !== 'string') continue;
      const key = JSON.stringify([app.deviceId, app.appId]); keys.add(key);
      let row = mixerRows.get(key);
      if (!row) { row = makeMixerRow(app, key); mixerRows.set(key, row); appList.append(row.el); }
      row.name.textContent = app.name; row.device.textContent = app.deviceName; row.device.hidden = lastDevices.length <= 1;
      row.slider.setAttribute('aria-label', `${app.name} volume${lastDevices.length > 1 ? ` on ${app.deviceName}` : ''}`);
      if (!row.editing && !row.timer && !row.writer.busy) { row.confirmed = app.volume; row.draw(app.volume); row.out.textContent = app.muted ? 'Muted' : `${row.slider.value}%`; }
    }
    for (const [key, row] of mixerRows) if (!keys.has(key) && !row.editing && !row.timer && !row.writer.busy) {
      if (row.el.contains(document.activeElement)) mixerToggle.focus(); row.el.remove(); mixerRows.delete(key);
    }
    mixerStatus.hidden = mixerRows.size > 0 && performance.now() >= mixerErrorUntil; mixerStatus.textContent = performance.now() < mixerErrorUntil ? mixerErrorText : lastDevices.length ? 'Apps appear here when they use audio.' : 'No audio output connected.';
  }
  const mixerPoll = createPoller(async () => { const revision = mixerRevision; return { state: await bridge.invoke('mixer_state'), revision }; }, result => {
    if (result.revision === mixerRevision && result.state) paintMixer(result.state);
  }, 2000, { onError: error => { mixerError(error) } });
  function closeMixer() {
    mixerOpen = false; mixerPoll.stop(); clearTimeout(mixerScrollTimer); mixerScrollTimer = 0;
    for (const row of mixerRows.values()) row.end();
    if (mixer.contains(document.activeElement)) mixerToggle.focus();
    mixer.dataset.open = 'false'; mixer.inert = true; mixer.setAttribute('aria-hidden', 'true'); mixerToggle.setAttribute('aria-expanded', 'false'); setOutputOpen(false);
  }
  mixerToggle.addEventListener('click', () => {
    if (mixerOpen) { closeMixer(); return; }
    mixerOpen = true; mixer.dataset.open = 'true'; mixer.inert = false; mixer.setAttribute('aria-hidden', 'false'); mixerToggle.setAttribute('aria-expanded', 'true');
    mixerPoll.start();
    mixerScrollTimer = setTimeout(() => { mixerScrollTimer = 0; if (quickActive && mixerOpen) mixer.scrollIntoView?.({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }, 200);
  });
  const chips = h('div', 'chips');
  for (const [page, label] of [['network', 'Network'], ['bluetooth', 'Bluetooth'], ['sound', 'Sound'], ['display', 'Display']]) {
    const c = h('button', 'chip', label); c.type = 'button'; c.setAttribute('aria-label', `${label} settings`); c.title = `${label} settings`; c.addEventListener('click', () => call('quick_open', { page })); chips.append(c);
  }
  const searchChip = h('button', 'chip search-chip', 'Circle to Search'); searchChip.type = 'button'; searchChip.title = 'Circle to Search · Ctrl + Shift + Alt + 0';
  searchChip.addEventListener('click', async () => {
    if (searchChip.disabled) return;
    searchChip.disabled = true; searchChip.setAttribute('aria-busy', 'true');
    try {
      await dismiss(); // Complete the Island's exit animation before requesting a capture.
      if (S.state === 'hidden') await attempt('island_action', { id: 'circleSearch' });
    } finally { searchChip.disabled = false; searchChip.removeAttribute('aria-busy'); }
  }); chips.append(searchChip);
  const studioChip = h('button', 'chip studio-chip', 'Open Studio'); studioChip.type = 'button';
  studioChip.addEventListener('click', () => runAction('island_action', { id: 'studio' }, studioChip)); chips.append(studioChip);
  el.append(media, tiles, vol, mixer, chips);

  function paintVolume() {
    const v = Number.isFinite(q?.volume) ? Math.round(q.volume * 100) : null;
    if (v !== null && !volumeEditing && !volumeWriter.busy && performance.now() >= volumeUntil) slider.value = Math.max(0, Math.min(100, v));
    slider.style.setProperty('--p', `${slider.value}%`);
    volOut.textContent = v === null ? '--' : `${slider.value}%`;
    slider.disabled = v === null;
    const name = `speaker${volumeLevel(Number(slider.value) / 100, q?.muted)}`;
    if (volIcon.dataset.icon !== name) { volIcon.innerHTML = ICONS[name]; volIcon.dataset.icon = name; }
  }
  function paint() {
    const st = describeQuick(q);
    const set = (id, on, text, unavailable = false) => {
      const b = els[id], d = defs.find(x => x.id === id);
      b.dataset.on = String(on); b.dataset.unavailable = String(unavailable); b.setAttribute('aria-pressed', String(on));
      b.title = `${d.long}: ${text}`; b.setAttribute('aria-label', `${d.long}: ${text}`);   // the row shows only icons and short names: the state is in the tooltip and for screen readers
    };
    for (const k of ['wifi', 'bluetooth']) set(k, st[k] === 'on', st[k] === 'unavailable' ? 'Not available' : st[k] === 'on' ? 'On' : 'Off', st[k] === 'unavailable');
    set('mute', st.mute === 'on', st.mute === 'unavailable' ? 'Not available' : st.mute === 'on' ? 'Muted' : 'Sound on', st.mute === 'unavailable');
    const paused = !!S.cfg?.paused; set('pause', paused, paused ? 'Paused' : 'Playing');
    const oled = !!S.cfg?.display?.oled; set('oled', oled, oled ? 'On' : 'Off');
    const widgets = S.cfg?.widgets?.enabled ?? true; set('widgets', widgets, widgets ? 'Shown' : 'Hidden');
    updateIcon(els.pause, paused ? 'play' : 'pause');
    updateIcon(els.mute, `speaker${volumeLevel(q?.volume, st.mute === 'on')}`);
    paintVolume();
  }
  let quickRevision = 0, confirmedVolume = null, volumeWriteFailed = false; const pendingToggles = new Set();
  const quickPoll = createPoller(async () => {
    const revision = quickRevision;
    const [quick, state] = await Promise.all([bridge.invoke('quick_state').catch(() => null), bridge.invoke('get_state').catch(() => null)]);
    return { quick, state, revision };
  }, ({ quick, state, revision }) => {
    if (revision !== quickRevision || pendingToggles.size) return;
    if (quick) q = { ...quick, ...((volumeEditing || volumeWriter.busy || performance.now() < volumeUntil) && q ? { volume: q.volume } : {}) };
    if (quick && !volumeEditing && !volumeWriter.busy && performance.now() >= volumeUntil && Number.isFinite(quick.volume)) confirmedVolume = quick.volume;
    S.cfg = state?.config ?? S.cfg; paintIslandAppearance(S.cfg); paint();
  }, 4000);
  function refresh() { return quickPoll.refresh(); }
  async function toggle(d) {
    if (pendingToggles.has(d.id)) return;
    pendingToggles.add(d.id); ++quickRevision; quickPoll.invalidate();
    const previous = q;
    try {
      if (d.radio) {
        const cur = q?.[d.id];
        if (cur == null) { await bridge.invoke('quick_open', { page: d.page }); return; }
        q = { ...q, [d.id]: !cur }; paint();
        await bridge.invoke('quick_set', { what: d.id, value: cur ? 0 : 1 });
      } else if (d.id === 'mute') {
        if (q?.muted == null) return;
        q = { ...q, muted: !q.muted }; paint();
        await bridge.invoke('quick_set', { what: 'mute', value: q.muted ? 1 : 0 });
      } else await bridge.invoke('island_action', { id: d.id });
    } catch (error) {
      // Roll back only this setting; a simultaneous volume adjustment must survive.
      if (previous && (d.radio || d.id === 'mute')) q = { ...q, [d.id === 'mute' ? 'muted' : d.id]: previous[d.id === 'mute' ? 'muted' : d.id] };
      if (quickActive) { paint(); say(errText(error)); }
    } finally { pendingToggles.delete(d.id); ++quickRevision; quickPoll.invalidate(); void refresh(); }
  }
  const volumeWriter = createLatestWriter(async value => { await bridge.invoke('quick_set', { what: 'volume', value }); confirmedVolume = value; volumeWriteFailed = false; }, {
    onError: error => { volumeWriteFailed = true; if (quickActive) say(errText(error)); },
    onIdle: () => { if (volumeWriteFailed && confirmedVolume !== null) { q = { ...q, volume: confirmedVolume }; if (quickActive) paintVolume(); } volumeUntil = 0; ++quickRevision; quickPoll.invalidate(); void refresh(); },
  });
  let sliderTimer = 0;
  const flushVolume = () => { clearTimeout(sliderTimer); sliderTimer = 0; volumeWriter.push(Number(slider.value) / 100); };
  slider.addEventListener('pointerdown', () => { volumeEditing = true; });
  slider.addEventListener('input', () => {
    ++quickRevision; quickPoll.invalidate(); volumeUntil = performance.now() + 300;
    q = { ...q, volume: Number(slider.value) / 100 }; paintVolume();
    clearTimeout(sliderTimer); sliderTimer = setTimeout(flushVolume, 80);
  });
  const endVolume = () => { volumeEditing = false; if (sliderTimer) flushVolume(); };
  slider.addEventListener('change', endVolume); slider.addEventListener('pointerup', endVolume);
  slider.addEventListener('pointercancel', endVolume); slider.addEventListener('blur', endVolume);
  listen('state', c => { ++quickRevision; quickPoll.invalidate(); S.cfg = c; paintIslandAppearance(c); if (active('quick')) paint(); });
  let clockTimer = 0;
  return {
    el, settleMotion: clearSongTransition,
    enter() { quickActive = true; quickPoll.start(); mediaPoll.start(); artworkPoll.start(); paintMedia(); clockTimer = setInterval(paintClock, 250); },
    leave() {
      quickActive = false; closeMixer(); clearSongTransition(); quickPoll.stop(); mediaPoll.stop(); artworkPoll.stop(); dragging = false;
      clearInterval(clockTimer); clearTimeout(mediaFollowup); endVolume();
    },
  };
}

// ---------------------------------------------------------------- Clipboard
function clipboardView() {
  const el = h('section', 'view'); el.id = 'view-clipboard'; el.setAttribute('role', 'tabpanel'); el.setAttribute('aria-labelledby', 'tab-clipboard');
  let structure = null;
  function render(s) { preserveView(el, () => {
    if (!s || !Array.isArray(s.items)) return; // A failed poll must not replace a valid view with the disabled screen.
    const next = JSON.stringify([s.enabled, s.items.map(it => [it.id, it.preview])]);
    if (next === structure) {
      el.querySelectorAll('.clip small').forEach((age, i) => { age.textContent = fmtAge(s.items[i].ageSecs); });
      return;
    }
    structure = next;
    el.textContent = '';
    if (!s?.enabled) {
      const e = h('div', 'empty'); const on = h('button', 'btn primary', 'Turn on clipboard history'); on.type = 'button';
      on.addEventListener('click', () => { poll.invalidate(); void runAction('clip_enable', { enabled: true }, on, refresh); });
      e.append(icon('shield'), h('h3', '', 'Clipboard history is off'), h('p', '', 'Turn it on to keep the last 30 things you copy. It stays in memory only: never saved to disk, cleared when you quit, and anything a password manager copies is skipped.'), on);
      el.append(e); return;
    }
    const bar = h('div', 'row'); const lab = h('div', 'grow faint', 'Remembering text you copy (kept in memory only)');
    const off = h('button', 'btn small', 'Turn off'), clear = h('button', 'btn small', 'Clear'); off.type = clear.type = 'button';
    off.addEventListener('click', () => { poll.invalidate(); void runAction('clip_enable', { enabled: false }, off, refresh); });
    clear.addEventListener('click', () => { poll.invalidate(); void runAction('clip_clear', {}, clear, refresh); });
    bar.append(lab, clear, off); el.append(bar);
    if (!s.items.length) { const e = h('div', 'empty'); e.append(h('p', '', 'Copy some text and it will appear here. Click an item to copy it again.')); el.append(e); return; }
    const list = h('div', 'clips');
    for (const it of s.items) {
      const row = h('div', 'clip'); row.setAttribute('role', 'button'); row.tabIndex = 0; row.dataset.id = it.id;
      const use = () => runAction('clip_use', { id: it.id }, row, () => { if (active('clipboard') && row.isConnected) { row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash'); say('Copied to the clipboard'); } });
      row.addEventListener('click', e => { if (!e.target.closest('.x')) use(); });
      row.addEventListener('keydown', e => { if (e.target === row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); use(); } });
      const x = h('button', 'x'); x.type = 'button'; x.setAttribute('aria-label', 'Remove from history'); x.append(icon('x'));
      x.addEventListener('click', () => { poll.invalidate(); void runAction('clip_remove', { id: it.id }, x, refresh); });
      row.append(h('span', 'txt', it.preview), h('small', '', `${fmtAge(it.ageSecs)}`), x);
      list.append(row);
    }
    el.append(list);
  }); }
  const poll = createPoller(() => bridge.invoke('clip_state'), render, 1800);
  function refresh() { poll.invalidate(); return poll.refresh(); }
  return { el, enter: poll.start, leave: poll.stop };
}

// ---------------------------------------------------------------- System
function systemView() {
  const el = h('section', 'view'); el.id = 'view-system'; el.setAttribute('role', 'tabpanel'); el.setAttribute('aria-labelledby', 'tab-system');
  const mk = (cls, name) => {
    const g = h('div', `card gauge ${cls}`);
    const big = h('div', 'big'); const val = h('span', '', '--'); big.append(val, h('small', '', '%'));
    const sv = document.createElementNS(NS, 'svg'); sv.setAttribute('class', 'spark'); sv.setAttribute('viewBox', '0 0 120 40'); sv.setAttribute('preserveAspectRatio', 'none');
    const area = document.createElementNS(NS, 'path'); area.setAttribute('class', 'area'); const line = document.createElementNS(NS, 'path'); line.setAttribute('class', 'line'); sv.append(area, line);
    const bar = h('div', 'bar'); const fill = h('i'); bar.append(fill);
    const sub = h('div', 'faint', ' ');
    g.append(h('div', 'lab', name), big, sv, bar, sub);
    return { g, val, line, area, fill, sub };
  };
  const cpu = mk('cpu', 'CPU'), ram = mk('ram', 'MEMORY');
  const gauges = h('div', 'gauges'); gauges.append(cpu.g, ram.g);
  const foot = h('div', 'card row'); const up = h('div', 'grow muted', 'Up since startup'); foot.append(up);
  el.append(gauges, foot);
  function paintOne(g, series) {
    const v = series[series.length - 1];
    g.val.textContent = v === null || v === undefined ? '--' : String(Math.round(v));
    g.fill.style.width = `${v ?? 0}%`;
    const d = sparkline(series, 120, 40);
    g.line.setAttribute('d', d); g.area.setAttribute('d', d ? `${d}L120 40L0 40Z` : '');
  }
  function tickFn() {
    paintOne(cpu, S.cpu); paintOne(ram, S.ram);
    const mem = memoryUse(S.metrics?.ramTotal, S.metrics?.ramAvail);
    ram.sub.textContent = mem ? `${fmtGb(mem.used)} of ${fmtGb(mem.total)} in use` : 'Memory in use';
    cpu.sub.textContent = 'All processors, last minute';
    up.textContent = Number.isFinite(S.metrics?.uptime) ? `Windows has been running for ${fmtDuration(S.metrics.uptime)}` : 'Uptime unavailable';
  }
  return { el, enter: tickFn, tick: tickFn };
}

// ---------------------------------------------------------------- Apps
// Bubble buttons: the program's own icon (read once by the app, where Windows has one) or a neutral glyph, its name, the time, and
// the share of your time as a soft fill inside the bubble. Never a made-up letter tile.
function appsView() {
  const el = h('section', 'view'); el.id = 'view-apps'; el.setAttribute('role', 'tabpanel'); el.setAttribute('aria-labelledby', 'tab-apps');
  let structure = null, appsActive = false; const icons = new BoundedCache(32);
  const iconJobs = new Map();   // key -> data URL, or null when the program has no icon
  function showIcon(bub, url) { if (!url) return; const img = h('img'); img.alt = ''; img.draggable = false; img.src = url; bub.textContent = ''; bub.append(img); bub.dataset.icon = 'true'; }
  async function loadIcon(key, bub) {
    if (!icons.has(key)) {
      if (!iconJobs.has(key)) iconJobs.set(key, bridge.invoke('apps_icon', { key }).then(url => icons.set(key, url || null)).finally(() => iconJobs.delete(key)));
      try { await iconJobs.get(key); } catch { return; }
    }
    if (appsActive && bub.isConnected) showIcon(bub, icons.get(key));
  }
  function render(s) { preserveView(el, () => {
    if (!s || !Array.isArray(s.items)) return;
    const next = JSON.stringify([s.enabled, s.items.map(a => [a.key, a.name])]);
    if (next === structure) {
      el.querySelectorAll('.app').forEach((b, i) => {
        const a = s.items[i];
        b.title = `${a.name}: ${fmtDuration(a.seconds)}`;
        b.style.setProperty('--share', `${Math.max(8, Math.min(100, a.share))}%`);
        b.querySelector('.who small').textContent = fmtDuration(a.seconds);
        if (!icons.has(a.key)) void loadIcon(a.key, b.querySelector('.bub'));
      });
      return;
    }
    structure = next;
    el.textContent = '';
    if (!s?.enabled) {
      const e = h('div', 'empty'); const on = h('button', 'btn primary', 'Start tracking'); on.type = 'button';
      on.addEventListener('click', () => { poll.invalidate(); void runAction('apps_enable', { enabled: true }, on, refresh); });
      e.append(icon('shield'), h('h3', '', 'Your most used apps'), h('p', '', 'Keep a tally of which apps you use most. Only each program\u2019s name and the seconds it was in front are saved, on this PC. Time when you are away from the keyboard is not counted, and nothing leaves your computer.'), on);
      el.append(e); return;
    }
    if (!s.items.length) { const e = h('div', 'empty'); e.append(h('p', '', 'Use your apps for a while and your favourites will appear here.')); el.append(e); }
    else {
      const grid = h('div', 'apps');
      for (const a of s.items) {
        const b = h('button', 'app'); b.type = 'button'; b.dataset.key = a.key; b.title = `${a.name}: ${fmtDuration(a.seconds)}`;
        b.style.setProperty('--share', `${Math.max(8, Math.min(100, a.share))}%`);
        const bub = h('span', 'bub'); bub.append(icon('appglyph'));
        const who = h('span', 'who'); who.append(h('b', '', a.name), h('small', '', fmtDuration(a.seconds)));
        b.append(bub, who);
        b.addEventListener('click', () => runAction('apps_launch', { key: a.key }, b));
        grid.append(b);
        if (icons.has(a.key)) showIcon(bub, icons.get(a.key)); else loadIcon(a.key, bub);
      }
      el.append(grid);
    }
    const foot = h('div', 'row'); foot.append(h('div', 'grow faint', 'Counted while you are at the keyboard. Stored on this PC only.'));
    const stop = h('button', 'btn small', 'Stop tracking'), clear = h('button', 'btn small', 'Clear'); stop.type = clear.type = 'button';
    stop.addEventListener('click', () => { poll.invalidate(); void runAction('apps_enable', { enabled: false }, stop, refresh); });
    clear.addEventListener('click', () => { poll.invalidate(); void runAction('apps_clear', {}, clear, refresh); });
    foot.append(clear, stop); el.append(foot);
  }); }
  const poll = createPoller(() => bridge.invoke('apps_state'), render, 5000);
  function refresh() { poll.invalidate(); return poll.refresh(); }
  return { el, enter() { appsActive = true; poll.start(); }, leave() { appsActive = false; poll.stop(); } };
}

// ---------------------------------------------------------------- Wallpapers
function wallpapersView() {
  const el = h('section', 'view'); el.id = 'view-wallpapers'; el.setAttribute('role', 'tabpanel'); el.setAttribute('aria-labelledby', 'tab-wallpapers');
  const transport = h('div', 'transport');
  const buttons = {};
  for (const [id, label] of [['prev', 'Previous wallpaper'], ['pause', 'Pause or play'], ['next', 'Next wallpaper'], ['random', 'Random wallpaper']]) {
    const b = h('button', 'btn'); b.type = 'button'; b.setAttribute('aria-label', label); b.title = label; b.append(icon(id === 'random' ? 'shuffle' : id));
    b.addEventListener('click', () => wallpaperAction(b, 'island_action', { id }));
    transport.append(b); buttons[id] = b;
  }
  const grid = h('div', 'walls');
  el.append(transport, grid);
  const blobs = new BoundedCache(24, 8 * 1024 * 1024, blob => blob?.size ?? 0);
  const jobs = new Map(); const urls = new Set(); const previewItems = new WeakMap();
  let wallsActive = false, structure = null, wallBusy = false;
  const previewObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting && wallsActive) {
      previewObserver.unobserve(entry.target);
      void loadPreview(previewItems.get(entry.target), entry.target);
    }
  }, { root: grid, rootMargin: '100px' });
  const dropUrls = () => {
    previewObserver.disconnect();
    for (const url of urls) URL.revokeObjectURL(url); urls.clear(); structure = null;
  };
  function current(cfg) { return cfg?.assign?.['*'] ?? Object.values(cfg?.assign ?? {})[0] ?? cfg?.items?.[0]?.id; }
  function paintPicture(b, src) {
    const img = h('img'); img.alt = ''; img.draggable = false; img.decoding = 'async';
    img.addEventListener('load', () => b.querySelector('.ph')?.remove(), { once: true });
    img.addEventListener('error', () => {
      img.remove(); if (src.startsWith('blob:')) { URL.revokeObjectURL(src); urls.delete(src); }
    }, { once: true });
    img.src = src; b.prepend(img);
  }
  async function loadPreview(it, b) {
    if (!it || !wallsActive) return;
    const epoch = previewEpoch;
    const key = `${it.id}|${it.path || ''}|${it.kind}`;
    let blob = blobs.get(key);
    if (!blob) {
      if (!jobs.has(key)) {
        const job = thumbnail(it, 360, () => wallsActive && epoch === previewEpoch).then(value => {
          if (value && wallsActive && epoch === previewEpoch) blobs.set(key, value); return value;
        }).catch(() => null).finally(() => jobs.delete(key));
        jobs.set(key, job);
      }
      blob = await jobs.get(key);
    }
    if (blob && wallsActive && epoch === previewEpoch && b.isConnected) {
      const url = URL.createObjectURL(blob); urls.add(url); paintPicture(b, url);
    } else if (!blob && wallsActive && epoch === previewEpoch && b.isConnected && !b.dataset.previewRetry) {
      b.dataset.previewRetry = 'true';
      setTimeout(() => { if (wallsActive && epoch === previewEpoch && b.isConnected) void loadPreview(it, b); }, 150);
    }
  }
  let previewEpoch = 0;
  async function wallpaperAction(button, command, args, message) {
    if (wallBusy) return;
    wallBusy = true; button.setAttribute('aria-busy', 'true'); poll.invalidate();
    try { await bridge.invoke(command, args); if (wallsActive && message) say(message); }
    catch (error) { if (wallsActive) say(errText(error)); }
    finally { wallBusy = false; button.removeAttribute('aria-busy'); poll.invalidate(); void refresh(); }
  }
  function render() { preserveView(el, () => {
    const cfg = S.cfg;
    if (!cfg || !Array.isArray(cfg.items)) return;
    updateIcon(buttons.pause, cfg?.paused ? 'play' : 'pause');
    const now = current(cfg);
    const next = JSON.stringify(cfg?.items ?? []);
    if (next === structure) {
      for (const b of grid.children) {
        if (b.dataset.id === now) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
      }
      return;
    }
    ++previewEpoch; dropUrls(); structure = next; grid.textContent = '';
    blobs.retain(new Set(cfg.items.map(it => `${it.id}|${it.path || ''}|${it.kind}`)));
    for (const it of cfg?.items ?? []) {
      const b = h('button', 'wall'); b.type = 'button'; b.dataset.id = it.id; b.title = it.name;
      if (it.id === now) b.setAttribute('aria-current', 'true');
      const bundled = it.kind === 'scene' && Object.hasOwn(SCENES, it.scene) ? SCENES[it.scene].thumb : null;
      if (bundled) paintPicture(b, bundled);
      else {
        const ph = h('div', 'ph'); ph.style.setProperty('--h', monogram(it.name).hue);
        if (it.kind === 'web') ph.append(h('span', 'tag', 'WEB')); else ph.append(icon(it.kind === 'video' ? 'play' : 'wallpapers'));
        b.append(ph);
        if (it.kind === 'video' || it.kind === 'image') { previewItems.set(b, it); previewObserver.observe(b); }
      }
      b.append(h('div', 'cap', it.name));
      b.addEventListener('click', () => wallpaperAction(b, 'assign', { monitor: '*', itemId: it.id }, `Now playing ${it.name}`));
      grid.append(b);
    }
  }); }
  const poll = createPoller(() => bridge.invoke('get_state'), st => { if (st?.config) { S.cfg = st.config; render(); } }, 5000);
  function refresh() { return poll.refresh(); }
  listen('state', c => { S.cfg = c; poll.invalidate(); if (active('wallpapers')) render(); });
  return {
    el,
    enter() { wallsActive = true; ++previewEpoch; poll.start(); },
    leave() { wallsActive = false; ++previewEpoch; poll.stop(); dropUrls(); grid.textContent = ''; blobs.clear(); clearThumbnailMemory(); },
    dispose() { previewObserver.disconnect(); },
  };
}

// ---------------------------------------------------------------- Power
function powerView() {
  const el = h('section', 'view'); el.id = 'view-power'; el.setAttribute('role', 'tabpanel'); el.setAttribute('aria-labelledby', 'tab-power');
  const grid = h('div', 'power');
  const defs = [['sleep', 'Sleep', 'Low power'], ['lock', 'Lock', 'Keep apps open'], ['signout', 'Sign out', ''], ['restart', 'Restart', ''], ['shutdown', 'Shut down', '']];
  const els = {};
  const powerGate = createGate();
  let disarmTimer = 0, powerBusy = false, closeTimer = 0, powerActive = false;
  for (const [id, label, hint] of defs) {
    const b = h('button', `pbtn${DESTRUCTIVE.has(id) ? ' danger' : ''}`); b.type = 'button'; b.dataset.id = id; b.dataset.armed = 'false';
    const small = h('small', '', hint); b.append(icon(id), h('span', '', label), small);
    b.addEventListener('click', () => press(id));
    grid.append(b); els[id] = { b, small, hint };
  }
  function paint() {
    const now = performance.now();
    for (const [id] of defs) { const on = stillArmed(S.power, now) && S.power.armed === id; els[id].b.dataset.armed = String(on); els[id].small.textContent = on ? 'Tap again to confirm' : els[id].hint; }
  }
  async function press(id) {
    if (powerBusy || !powerActive) return;
    const now = performance.now();
    const step = powerStep(S.power, id, now);
    S.power = { armed: step.armed, at: step.at };
    paint(); clearTimeout(disarmTimer);
    if (step.armed) { disarmTimer = setTimeout(paint, 3100); return; }
    if (!step.perform) return;
    const token = powerGate.next(); powerBusy = true;
    try {
      if (await attempt('power_do', { action: id, confirmed: DESTRUCTIVE.has(id) }) && powerActive && powerGate.valid(token)) closeTimer = setTimeout(() => { if (powerActive && powerGate.valid(token)) void dismiss(); }, 200);
    } finally { powerBusy = false; }
  }
  el.append(grid, h('div', 'faint', 'Sign out, restart and shut down ask for a second tap.'));
  el.lastChild.style.textAlign = 'center';
  return { el, enter() { powerGate.cancel(); powerActive = true; S.power = { armed: null, at: 0 }; paint(); }, leave() { powerGate.cancel(); powerActive = false; S.power = { armed: null, at: 0 }; clearTimeout(disarmTimer); clearTimeout(closeTimer); paint(); } };
}

S.views = { quick: quickView(), clipboard: clipboardView(), system: systemView(), apps: appsView(), wallpapers: wallpapersView(), power: powerView() };
motionPreference.addEventListener?.('change', () => { if (motionPreference.matches) for (const view of Object.values(S.views)) view.settleMotion?.(); });
for (const t of TABS) { S.views[t.id].el.inert = true; viewsEl.append(S.views[t.id].el); }
panel.inert = true;

// ---------------------------------------------------------------- input
peek.addEventListener('click', () => open(false));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && (S.state !== 'hidden' || opening || showing)) { e.preventDefault(); dismiss(); return; }
  if (S.state === 'peek' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(true); return; }
  if (S.state !== 'open') return;
  if (e.altKey || e.ctrlKey || e.metaKey || e.target.closest?.('input, textarea, [contenteditable=true]')) return;
  if ((e.key === 'Home' || e.key === 'End') && e.target.closest?.('[role=tab]')) { e.preventDefault(); const id = TABS[e.key === 'Home' ? 0 : TABS.length - 1].id; selectTab(id); tabButtons[id].focus(); }
  else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { if (e.target.closest?.('input[type=range]')) return; e.preventDefault(); const id = nextTab(S.tab, e.key === 'ArrowRight' ? 1 : -1); selectTab(id); tabButtons[id].focus(); }
  else if (/^[1-6]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) { selectTab(TABS[Number(e.key) - 1].id); tabButtons[S.tab].focus(); }
});

// ---------------------------------------------------------------- the app tells us when to appear and leave
// The app may say "show" more than once (an event, then the page's own "did I miss one?" check on the first reveal). Showing is
// idempotent: it only ever moves forward (hidden -> peek -> open), never back to hidden first, which would be a visible blink.
function acceptHostGeneration(generation) {
  if (!Number.isFinite(generation)) return true;
  if (hostGeneration !== null && generation < hostGeneration) return false;
  hostGeneration = generation; return true;
}
async function onShow(request) {
  const generation = typeof request === 'object' ? request?.generation : null;
  if (!acceptHostGeneration(generation)) return;
  const openNow = typeof request === 'boolean' ? request : request?.open;
  await showPeek();
  if (hostGeneration !== null && generation !== null && generation !== hostGeneration) return;
  if (openNow && S.state === 'peek') void open(true);
}
listen('studio-opened', () => { if (S.state === 'open') void dismiss(); });
listen('island-show', onShow);
bridge.invoke('island_ready').then(pending => { if (pending != null) void onShow(pending); }).catch(() => {});
listen('island-leave', generation => {
  if (!acceptHostGeneration(generation) || S.state === 'open') return;
  transitions.cancel(); showing = opening = null; setState('hidden');
});
listen('island-hidden', generation => {
  if (!acceptHostGeneration(generation)) return;
  transitions.cancel(); showing = opening = null; setState('hidden');
});
document.addEventListener('pointerdown', e => {
  if (S.state === 'open' && !shell.contains(e.target)) void dismiss();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    metricsPoll.stop(); S.views[activeTab]?.leave?.(); activeTab = null;
    transitions.cancel(); showing = opening = null;
  } else if (S.state !== 'hidden') {
    metricsPoll.start(); if (S.state === 'open') selectTab(S.tab, true);
  }
});
window.addEventListener('pagehide', () => {
  disposed = true; transitions.cancel(); setState('hidden'); metricsPoll.stop();
  themeStop(); pillObserver.disconnect(); for (const view of Object.values(S.views)) view.dispose?.();
  for (const dispose of subscriptions) dispose?.();
}, { once: true });

// ---------------------------------------------------------------- browser preview only: the cursor wakes the bar (the app does this in Rust)
if (!bridge.isApp) {
  let dwell = 0, away = 0;
  document.addEventListener('mousemove', e => {
    const inZone = inPreviewZone(e.clientX, e.clientY, innerWidth);
    const r = shell.getBoundingClientRect(), over = e.clientX >= r.left && e.clientX <= r.right && e.clientY <= r.bottom + 6;
    if (S.state === 'hidden' && !opening) { if (inZone) { if (!dwell) dwell = setTimeout(() => { dwell = 0; showPeek(); }, 250); } else { clearTimeout(dwell); dwell = 0; } }
    if (S.state === 'peek') { clearTimeout(away); away = over || inZone ? 0 : setTimeout(() => { if (S.state === 'peek') setState('hidden'); }, 900); }
  });
  const q = new URLSearchParams(location.search);
  if (q.has('open')) { showPeek().then(() => open()); } else if (q.has('peek')) showPeek();
}
