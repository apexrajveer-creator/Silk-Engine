import { aboutExperience } from './about.js';
import { installScrolling, navigationBusy, waitForNavigationIdle } from './scrolling.js';
import { keyboard } from './keyboard.js';
import { lifestyles } from './lifestyles.js';
import { maintenance } from './maintenance.js';
import { saveQueue } from '../shared/save-queue.js';
import { discover } from '../community/ui.js';
import { bridge } from '../shared/bridge.js';
import { DISPLAY, SYSTEM, SCENES, schemaFor, resolved, visible, defaults } from '../shared/catalog.js';
import { backdrop } from './backdrop.js';
import { previewWidth } from '../shared/resolution.js';
import { thumbnail } from './thumbs.js';
import { widgetEditor } from '../widgets/editor.js';
import { simulationPreview } from './previews.js';
import { lookFilter } from '../shared/preview-policy.js';
import { cleanTitle } from '../shared/titles.js';
import { installDropdowns } from './dropdown.js';
import { hotkeysSection } from './hotkeys.js';
installDropdowns();
import { accentFrom } from '../shared/accent.js';

const $ = id => document.getElementById(id);
const beginNavigation = installScrolling();
const aboutUI = aboutExperience();
const st = { cfg: null, monitors: [], vis: { covered: [] }, target: '*', sheet: null, filter: 'all', tab: 'library' };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Block document selection and native image/link dragging without disturbing controls
// or file drops arriving from Explorer. Text fields retain normal editing/copying.
const editable = target => target instanceof Element && target.closest('input:not([type]),input[type="text"],input[type="search"],input[type="url"],input[type="email"],input[type="number"],textarea,[contenteditable="true"]');
document.addEventListener('selectstart', e => { if (!editable(e.target)) e.preventDefault(); });
document.addEventListener('dragstart', e => e.preventDefault());
document.addEventListener('contextmenu', e => { if (!editable(e.target) && e.target.id !== 'add') e.preventDefault(); });
let toastTimer;
function toast(message) { $('toast').textContent = String(message); $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 6500); }
addEventListener('unhandledrejection', e => { e.preventDefault(); toast(e.reason?.message || e.reason || 'Action failed. Please try again.'); });

const discoverUI = discover({notify:toast,target:()=>st.target});
const widgetsUI = widgetEditor({ art, notify: toast });

backdrop($('bg'), { onLite: on => document.documentElement.classList.toggle('lite', on) });

// ------------------------------------------------------------------ data helpers
const itemBy = id => st.cfg.items.find(i => i.id === id);
const itemOn = m => itemBy(st.cfg.assign[m.key] || st.cfg.assign['*']);
const assignedTo = id => st.monitors.filter(m => itemOn(m)?.id === id);
const shortName = m => m.name.replace(' · main', '');
const pretty = n => String(n || '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
const isAnim = it => /\.(gif|webp|apng)$/i.test(it.path || '');
const kindLabel = it => it.kind === 'scene' ? (SCENES[it.scene]?.tag || 'Scene') : { video: 'Video', image: isAnim(it) ? 'Animated image' : 'Image', web: 'Web wallpaper' }[it.kind];
const targetItem = () => st.target === '*' ? itemBy(st.cfg.assign['*']) || itemOn(st.monitors[0] || { key: '' }) : itemOn(st.monitors.find(m => m.key === st.target) || { key: '' });
const targetName = () => st.target === '*' ? (st.monitors.length > 1 ? 'all displays' : 'your desktop') : shortName(st.monitors.find(m => m.key === st.target) || { name: 'display' });

// ResizeObserver also fires when a hidden tab becomes visible or Windows scaling changes.
const pendingCardArt = new Map();
const cardVisibility = new IntersectionObserver(entries=>{
  for(const {target:box,isIntersecting} of entries){
    if(!isIntersecting)continue;
    const item=pendingCardArt.get(box);pendingCardArt.delete(box);cardVisibility.unobserve(box);
    if(box.isConnected&&item){const current=st.cfg?.items.find(i=>i.id===item.id);if(current)art(box,current,{hover:true});}
  }
},{rootMargin:'180px'});
function cardArt(box,item){pendingCardArt.set(box,item);cardVisibility.observe(box);}
const artBoxes = new Set();
const artObserver = new ResizeObserver(entries => {
  for (const {target:box,contentRect:r} of entries) {
    if(!box.isConnected){artObserver.unobserve(box);box._artCleanup?.();continue;}
    if(r.width && r.height && previewWidth(r.width,r.height,devicePixelRatio||1)>box._artWidth){
      clearTimeout(box._artResize);box._artResize=setTimeout(()=>art(box,box._artItem,box._artOptions),160);
    }
  }
});

new MutationObserver(()=>{for(const box of pendingCardArt.keys())if(!box.isConnected){cardVisibility.unobserve(box);pendingCardArt.delete(box);}for(const box of artBoxes)if(!box.isConnected){artObserver.unobserve(box);artBoxes.delete(box);clearTimeout(box._artResize);box._artCleanup?.();for(const url of box._artURLs||[])URL.revokeObjectURL(url);box._artURLs?.clear();box._artTicket++;}}).observe(document.body,{childList:true,subtree:true});

/** Fill `box` with a picture of the item: real renders for simulations, cached stills for media.
 *  A live video preview is created only while a card is hovered, and destroyed when it isn't. */
async function art(box, it, { hover = false } = {}) {
  box._artOptions = { hover }; box._artItem = it;
  artBoxes.add(box);artObserver.observe(box);
  const bounds = box.getBoundingClientRect();
  const width = previewWidth(bounds.width || 640, bounds.height || 360, devicePixelRatio || 1);
  box._artWidth = width;
  box._artCleanup?.();
  for(const url of box._artURLs||[])URL.revokeObjectURL(url);box._artURLs=new Set();
  const ticket = box._artTicket = (box._artTicket || 0) + 1;
  box.textContent = ''; box.style.background = '';
  box.dataset.item = it?.id || '';
  box.dataset.previewKey = it?.kind === 'scene' ? JSON.stringify(it.settings || {}) : '';
  if (!it) return;
  const img = src => { if(src.startsWith('blob:'))box._artURLs.add(src);const i = new Image(); i.decoding = 'async'; i.loading = 'lazy'; i.alt = ''; i.src = src; i.onload = () => { i.classList.add('in'); if(src.startsWith('blob:')) URL.revokeObjectURL(src); }; i.onerror = () => { if(src.startsWith('blob:')) URL.revokeObjectURL(src); }; box.append(i); return i; };
  if (it.kind === 'scene') { const sc = SCENES[it.scene]; if (sc?.thumb) img(sc.thumb); else box.style.background = sc?.art || '#000';
    const hero = !!box.closest('.cine');
    const heroWidth = hero ? Math.round((box.getBoundingClientRect().width || innerWidth) * (devicePixelRatio || 1)) : width;
    simulationPreview(it, st.cfg?.display, heroWidth, { hero }).then(src => {
      if (!src || box._artTicket !== ticket || !box.isConnected) return;
      if (hero) { const under = [...box.querySelectorAll('img')]; const top = img(src); top.addEventListener('load', () => setTimeout(() => under.forEach(u => u.remove()), 900), { once: true }); }
      else { box.textContent = ''; img(src); }
    }).catch(() => {});
    return; }
  if (it.kind === 'web') { box.append(el('div', 'web', 'WEB')); return; }
  await waitForNavigationIdle();
  if (box._artTicket !== ticket || !box.isConnected) return;
  const still = await thumbnail(it, width);
  if (box._artTicket !== ticket || !box.isConnected) return;
  if (still) img(URL.createObjectURL(still));
  else box.append(el('span', 'art-unavailable', 'Preview unavailable'));
  if (hover && it.kind === 'video') {
    const host = box.closest('.wcard') || box;
    let timer = 0, live = null, hoverEpoch = 0;
    const enter = () => {
      if(navigationBusy())return;
      clearTimeout(timer);
      const epoch=++hoverEpoch;
      timer = setTimeout(async () => {
        const url = await bridge.mediaURL(it); if (!url) return; if (epoch!==hoverEpoch || box._artTicket !== ticket || !host.isConnected || !host.matches(':hover') || document.hidden || !document.hasFocus() || navigationBusy()) { if (url.startsWith('blob:')) URL.revokeObjectURL(url); return; }
        live = el('video', 'live'); live.muted = true; live.loop = true; live.playsInline = true; live.src = url;
        live.oncanplay = () => live && live.classList.add('in');
        box.append(live); live.play().catch(() => { });
      }, 280);
    };
    host.addEventListener('mouseenter', enter);
    const stop = () => {
      hoverEpoch++;
      clearTimeout(timer);
      if (live) { const v = live; live = null; v.pause(); v.classList.remove('in'); setTimeout(() => { v.pause(); const url = v.src; v.removeAttribute('src'); v.load(); v.remove(); if (url.startsWith('blob:')) URL.revokeObjectURL(url); }, 250); }
    };
    host.addEventListener('mouseleave', stop);
    host._stopPreview = stop;
    box._artCleanup = () => { stop(); host.removeEventListener('mouseenter', enter); host.removeEventListener('mouseleave', stop); };
  }
}

// ------------------------------------------------------------------ controls (inset grouped rows)
function control(s, value, onChange) {
  const r = el(s.type === 'bool' ? 'label' : 'div', 'row' + (s.type === 'slider' ? ' slider' : ''));
  r.dataset.key = s.key;
  r.append(el('div', 'main', `<div class="title">${esc(s.label)}</div>`));
  if (s.hint) r.title = s.hint;
  let input;
  if (s.type === 'slider') {
    const trail = el('span', 'trail', value + (s.unit || '')); r.append(trail);
    input = Object.assign(el('input'), { type: 'range', min: s.min, max: s.max, step: 1, value });
    const paint = () => input.style.setProperty('--p', ((input.value - s.min) / (s.max - s.min) * 100) + '%');
    input.oninput = () => { trail.textContent = input.value + (s.unit || ''); paint(); onChange(+input.value); };
    input.setAttribute('aria-label', s.label); paint(); r.append(input);
  } else if (s.type === 'bool') {
    input = Object.assign(el('input'), { type: 'checkbox', className: 'switch', checked: !!value });
    input.onchange = () => onChange(input.checked); r.append(input);
  } else if (s.type === 'combo') {
    input = el('select', 'select'); input.setAttribute('aria-label', s.label);
    for (const [v, t] of s.options) input.append(new Option(t, v));
    input.value = value; input.onchange = () => onChange(input.value); r.append(input);
  } else if (s.type === 'color') {
    input = Object.assign(el('input'), { type: 'color', className: 'swatch', value }); input.setAttribute('aria-label', s.label);
    input.oninput = () => onChange(input.value); r.append(input);
  }
  return r;
}
/** A glass group of rows for `schema`, re-evaluating `when` conditions live. */
function group(schema, values, onChange, cls = 'group glass') {
  const g = el('div', cls), v = { ...values };
  const refresh = animate => g.querySelectorAll('.row').forEach(r => { const s = schema.find(x => x.key === r.dataset.key); toggleRow(r, !visible(s, v), animate); });
  for (const s of schema) g.append(control(s, v[s.key], val => { v[s.key] = val; refresh(true); onChange(s.key, val, v); }));
  refresh(false);
  return g;
}
/** Rows that appear or disappear with a setting slide open and closed instead of jumping. */
function toggleRow(r, hide, animate) {
  if (r.hidden === hide && !r._anim) return;
  if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) { r.hidden = hide; return; }
  r._anim?.cancel();
  if (!hide) r.hidden = false;
  const h = r.scrollHeight;
  const frames = [{ height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px', minHeight: '0px' }, { height: h + 'px', opacity: 1 }];
  r.style.overflow = 'hidden';
  r._anim = r.animate(hide ? frames.slice().reverse() : frames, { duration: 320, easing: 'cubic-bezier(.22,1,.36,1)' });
  // finalise on a timer rather than onfinish, so the row always ends in the right state
  clearTimeout(r._t);
  r._t = setTimeout(() => { r._anim?.cancel(); r._anim = null; r.style.overflow = ''; r.hidden = hide; }, 330);
}
function seg(root, options, value, onPick) {
  const thumb = root.querySelector('.thumb'); root.querySelectorAll('button').forEach(b => b.remove());
  options.forEach(([v, label]) => { const b = el('button', null, esc(label)); b.setAttribute('aria-pressed', v === value); b.title = label; b.onclick = () => onPick(v); root.append(b); });
  requestAnimationFrame(() => {
    const on = [...root.querySelectorAll('button')].find(b => b.getAttribute('aria-pressed') === 'true');
    if (on) { thumb.style.width = on.offsetWidth + 'px'; thumb.style.transform = `translateX(${on.offsetLeft - 2}px)`; thumb.style.opacity = 1; } else thumb.style.opacity = 0;
  });
}

// ------------------------------------------------------------------ chrome
function renderStatus() {
  const c = st.cfg, v = st.vis, cov = (v.covered || []).length;
  const [cls, txt] = c.paused ? ['warn', 'Paused'] : v.locked ? ['idle', 'Locked'] : v.hibernating ? ['idle', 'Hibernating'] : v.onBattery && c.system.battery === 'pause' ? ['warn', 'Paused on battery'] : cov && cov === st.monitors.length ? ['idle', 'Sleeping · covered'] : ['', v.onBattery ? 'Running · battery' : 'Running'];
  $('status').className = 'status-pill ' + cls; $('status').querySelector('span').textContent = txt;
  $('pause').textContent = c.paused ? 'Resume' : 'Pause';
  $('heroPause').classList.toggle('paused', !!c.paused); $('heroPause').setAttribute('aria-label', c.paused ? 'Resume wallpaper' : 'Pause wallpaper'); $('heroPause').title = c.paused ? 'Resume' : 'Pause';
}

function renderHero() {
  const it = targetItem();
  if (!it) return;
  const hero = $('hero'), cur = hero.querySelector('.hero-bg:not(.leaving)');
  if (cur.dataset.id !== it.id) {
    const first = !cur.dataset.id;
    const nb = el('div', 'hero-bg' + (first ? '' : ' entering')); nb.dataset.id = it.id;
    if (first) { cur.dataset.id = it.id; art(cur, it); updateAmbient(cur, it.id); }
    else {
      cur.after(nb); cur.removeAttribute('id'); nb.id = 'heroBg'; art(nb, it); updateAmbient(nb, it.id);
      cur.classList.add('leaving'); setTimeout(() => cur.remove(), 900);
      for (const id of ['heroName', 'heroSub']) { const e = $(id); e.classList.remove('swap'); void e.offsetWidth; e.classList.add('swap'); }
    }
  }
  const name = cleanTitle(pretty(it.name));
  $('heroName').textContent = name;
  $('heroName').title = pretty(it.name);
  const birdOn = !!resolved(schemaFor(it), it.settings).emblem;
  hero.querySelector('.hero-logo').hidden = !birdOn;
  $('heroToggle').setAttribute('aria-pressed', String(birdOn));
  $('heroToggle').setAttribute('aria-label', birdOn ? 'Hide eagle on this wallpaper' : 'Show eagle on this wallpaper');
  $('heroSub').textContent = heroCredits(it);
  const where = st.target === '*' ? (st.monitors.length > 1 ? 'All displays' : shortName(st.monitors[0] || { name: 'Desktop' })) : shortName(st.monitors.find(m => m.key === st.target) || { name: '' });
  $('heroTarget').innerHTML = `<i></i><span>${st.cfg.paused ? 'Paused' : 'Now playing'} · ${esc(where)}</span>`;
  $('heroTarget').className = 'cine-kicker' + (st.cfg.paused ? ' paused' : '');
  const d = { ...defaults(DISPLAY), ...st.cfg.display }, n = st.monitors.length, count = st.cfg.items.filter(i => i.kind !== 'skin').length;
  $('sub').textContent = `${count} wallpapers${n > 1 ? ` · ${n} displays` : ''}${d.oled ? ' · OLED mode on' : ''}`;
  if (!hero.dataset.opened) { hero.dataset.opened = '1'; hero.classList.add('cine-in'); setTimeout(() => hero.classList.remove('cine-in'), 1400); }
  if (hero.dataset.shot !== it.id) { hero.dataset.shot = it.id; hero.classList.remove('cine-push'); void hero.offsetWidth; hero.classList.add('cine-push'); }
}

// The line under the title, like the technical credit on a poster. Only facts we actually know.
function heroCredits(it) {
  const ext = (it.path || '').split('.').pop().toUpperCase();
  if (it.kind === 'scene') return `${SCENES[it.scene]?.tag || 'Scene'} · Rendered live on your GPU`;
  if (it.kind === 'video') return `Video${ext ? ' · ' + ext : ''} · Looping`;
  if (it.kind === 'image') return isAnim(it) ? `Animated image · ${ext} · Looping` : `Image${ext ? ' · ' + ext : ''}`;
  if (it.kind === 'web') return 'Web wallpaper · Interactive';
  return kindLabel(it) || '';
}

// Ambient light: the hero image's dominant colour glows faintly into the page below it.
let ambientFor = '';
async function updateAmbient(box, id) {
  if (ambientFor === id) return; ambientFor = id;
  const img = await new Promise(res => { let tries = 0; const look = () => { const i = box.querySelector('img'); if (i?.complete && i.naturalWidth) res(i); else if (++tries < 40) setTimeout(look, 150); else res(null); }; look(); });
  if (!img || ambientFor !== id) return;
  try {
    const c = document.createElement('canvas'); c.width = 32; c.height = 18;
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0, 32, 18);
    $('library').style.setProperty('--ambient', accentFrom(ctx.getImageData(0, 0, 32, 18).data));
  } catch { /* cross-origin or decode failure: keep the previous glow */ }
}

let mapKey = '';
function renderDisplays() {
  const map = $('map'), ms = st.monitors;
  // One screen: the hero already shows what's playing, so the Displays block would only repeat it.
  $('displaysBlock').hidden = ms.length < 2;
  if (ms.length < 2) { mapKey = ''; return; }
  const key = JSON.stringify([ms, ms.map(m => [itemOn(m)?.id, itemOn(m)?.name]), st.vis.covered, st.target, map.clientWidth]);
  if (key === mapKey) return; mapKey = key;
  map.textContent = '';
  $('dispMeta').textContent = st.cfg.span ? 'Spanning' : ms.length > 1 ? 'Independent' : '';
  if (ms.length) {
    const x0 = Math.min(...ms.map(m => m.x)), y0 = Math.min(...ms.map(m => m.y));
    const W = Math.max(...ms.map(m => m.x + m.w)) - x0, H = Math.max(...ms.map(m => m.y + m.h)) - y0;
    const cw = map.clientWidth || 400, k = Math.min(cw / W, Math.min(184, cw * .45) / H), ox = 0;
    map.style.height = Math.ceil(H * k) + 'px';
    for (const m of ms) {
      const it = itemOn(m), b = el('button', 'mon');
      Object.assign(b.style, { left: ox + (m.x - x0) * k + 'px', top: (m.y - y0) * k + 'px', width: m.w * k - 6 + 'px', height: m.h * k - 6 + 'px' });
      const a = el('div', 'mart'); b.append(a); art(a, it);
      b.append(el('b', null, esc(it ? cleanTitle(pretty(it.name)) : '—')), el('span', null, esc(m.name)));
      if ((st.vis.covered || []).includes(m.key)) b.append(el('span', 'cov', 'covered'));
      b.setAttribute('aria-pressed', st.target === m.key || (st.target === '*' && ms.length === 1));
      b.title = 'Choose what plays on ' + m.name;
      b.onclick = () => { st.target = m.key; render(); };
      map.append(b);
    }
  }
  seg($('targets'), [['*', 'All displays'], ...ms.map(m => [m.key, shortName(m)])], st.target, v => { st.target = v; render(); });
  $('span').checked = !!st.cfg.span;
  $('targets').hidden = ms.length < 2; $('span').closest('.row').hidden = ms.length < 2;
}

// ------------------------------------------------------------------ cards
const GEAR = '<svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>';
let cardsKey = '';
for(const id of ['librarySearch','favoritesOnly','librarySort'])$(id).addEventListener('input',()=>renderCards());
function renderCards() {
  const items = st.cfg.items;
  const key = items.map(i => i.id + '|' + i.name).join(',') + st.filter + $('librarySearch').value + $('favoritesOnly').checked + $('librarySort').value + JSON.stringify(st.cfg.favorites);
  if (key !== cardsKey) {
    cardsKey = key;
    const mine = items.filter(i => i.kind !== 'scene' && (st.filter === 'all' || i.kind === st.filter) && i.name.toLowerCase().includes($('librarySearch').value.toLowerCase()) && (!$('favoritesOnly').checked || st.cfg.favorites?.includes(i.id)));
    if ($('librarySort').value === 'name') mine.sort((a,b)=>a.name.localeCompare(b.name));
    for (const [root, list] of [[$('scenes'), items.filter(i => i.kind === 'scene')], [$('mine'), mine]]) {
      root.textContent = '';
      for (const it of list) {
        const c = el('div', 'wcard'); c.dataset.id = it.id; c.tabIndex = 0; c.setAttribute('role', 'button');
        c.setAttribute('aria-label', `Play ${it.name}`);
        const a = el('div', 'art'); c.append(a); cardArt(a, it);
        c.append(el('div', 'meta', `<b>${esc(pretty(it.name))}</b><span>${esc(kindLabel(it))}</span>`));
        c.append(el('span', 'playing status-pill', '<i></i><span></span>'));
        const tag = el('span', 'bird-tag', '<img src="assets/echelon-bird.svg" alt="">'); tag.title = 'ECHELON bird on'; c.append(tag);
        const g = el('button', 'gear', GEAR); g.setAttribute('aria-label', `Settings for ${it.name}`); g.title = 'Settings';
        g.onclick = e => { e.stopPropagation(); openSheet(it.id); };
        c.append(g);
        c.classList.add('reveal'); c.style.setProperty('--i', root.children.length);
        c.onclick = () => play(it.id);
        c.onkeydown = e => { if (e.target === c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); play(it.id); } };
        root.append(c);
      }
    }
    const kinds = new Set(items.filter(i => i.kind !== 'scene').map(i => i.kind));
    $('filter').hidden = kinds.size < 2;
    $('empty').hidden = items.some(i => i.kind !== 'scene');
  }
  seg($('filter'), [['all', 'All'], ['video', 'Videos'], ['image', 'Images'], ['web', 'Web']], st.filter, v => { st.filter = v; renderCards(); });
  document.querySelectorAll('#scenes .wcard,#mine .wcard').forEach(c => {
    const it = itemBy(c.dataset.id), on = assignedTo(c.dataset.id);
    c.classList.toggle('on', on.length > 0);
    const p = c.querySelector('.playing'); if (p.hidden && on.length) { p.classList.remove('pop'); void p.offsetWidth; p.classList.add('pop'); } p.hidden = !on.length;
    p.querySelector('span').textContent = st.monitors.length > 1 ? on.map(shortName).join(', ') : 'Playing';
    p.className = 'playing status-pill' + (st.cfg.paused ? ' warn' : '');
    c.querySelector('.bird-tag').hidden = !resolved(schemaFor(it), it?.settings).emblem;
  });
}

// ------------------------------------------------------------------ settings sheet
let sheetReturnFocus = null;
const BIRD_KEYS = ['emblem', 'emblemSize', 'emblemPos', 'emblemOpacity'];
function openSheet(id) {
  const it = itemBy(id); if (!it) return;
  if (!st.sheet) sheetReturnFocus = document.activeElement;
  st.sheet = id;
  renderFavourite();
  $('sheet').classList.remove('closing'); $('scrim').classList.remove('closing');
  $('sheet').hidden = false; $('scrim').hidden = false;
  $('sTitle').textContent = pretty(it.name);
  $('sName').value = pretty(it.name);
  art($('sArt'), it);
  $('sDesc').textContent = it.kind === 'scene' ? SCENES[it.scene]?.desc || '' : it.path || '';
  $('sDesc').classList.toggle('prose', it.kind === 'scene');
  const schema = schemaFor(it), values = resolved(schema, it.settings);
  const main = schema.filter(s => !BIRD_KEYS.includes(s.key)), bird = schema.filter(s => BIRD_KEYS.includes(s.key));
  const form = $('sForm'); form.textContent = '';
  const push = (k, v) => pushSettings(id, k, v);
  if (main.length) { form.append(el('div', 's-group-title', it.kind === 'scene' ? 'Look & motion' : it.kind === 'web' ? 'Page' : 'Playback')); form.append(group(main, values, push, 'group')); }
  if (bird.length) { form.append(el('div', 's-group-title', 'ECHELON bird')); form.append(group(bird, values, push, 'group')); }
  $('sRemove').hidden = !!it.builtin;
  $('sApply').textContent = `Play on ${targetName()}`;
  $('sDone').focus();
}
function closeSheet() {
  if (!st.sheet) return; st.sheet = null;
  (sheetReturnFocus?.isConnected?sheetReturnFocus:$('customise')).focus();
  const sh = $('sheet'), sc = $('scrim');
  sh.classList.add('closing'); sc.classList.add('closing');
  setTimeout(() => { if (st.sheet) return; sh.hidden = true; sc.hidden = true; sh.classList.remove('closing'); sc.classList.remove('closing'); }, 280);
}
function renderFavourite() { const on=!!st.cfg?.favorites?.includes(st.sheet);$('sFavorite').textContent=on?'Remove from favourites':'Add to favourites';$('sFavorite').setAttribute('aria-pressed',String(on)); }
$('sFavorite').onclick=async()=>{try{await bridge.invoke('set_favorite',{id:st.sheet,favorite:!st.cfg.favorites?.includes(st.sheet)});renderFavourite();}catch(e){toast(e.message);}};
$('sDone').onclick = closeSheet; $('scrim').onclick = closeSheet;
addEventListener('keydown', e => { if (e.key === 'Escape' && st.sheet) closeSheet(); });
$('sApply').onclick = () => { play(st.sheet); closeSheet(); };
$('sDup').onclick = async () => { const it = await bridge.invoke('duplicate_item', { id: st.sheet }); if (it) openSheet(it.id); };
$('sRemove').onclick = () => { const it = itemBy(st.sheet); if (it && !it.builtin && confirm(`Remove “${it.name}” from the library? The file itself is not deleted.`)) { bridge.invoke('remove_item', { id: it.id }); closeSheet(); } };
$('sName').onchange = e => { const n = e.target.value.trim() || 'Untitled'; $('sTitle').textContent = n; bridge.invoke('update_item', { id: st.sheet, name: n }); };

// Only a preset's own settings change its render. The global display look is a CSS filter on
// every thumbnail (see applyLook), so Display sliders never re-run a simulation.
function refreshPreviews() {
  applyLook();
  document.querySelectorAll('[data-item]').forEach(box => {
    const it = itemBy(box.dataset.item);
    if (it?.kind !== 'scene') return;
    if (JSON.stringify(it.settings || {}) !== box.dataset.previewKey) art(box, it);
  });
}
let lookValue = '';
function applyLook() {
  const v = lookFilter({ ...defaults(DISPLAY), ...(st.cfg?.display || {}) });
  if (v !== lookValue) { lookValue = v; document.documentElement.style.setProperty('--look', v); }
}
const settingsWrites = saveQueue((key, patch) => key === '$display'
  ? bridge.invoke('set_display', { patch })
  : bridge.invoke('update_item', { id: key, settings: patch }),
  error => toast('Changes are not saved. Retry in System: ' + String(error)));
async function flushAll() { await settingsWrites.flush(); await widgetsUI.flush(); }
function changeDisplay(k, v) {
  settingsWrites.push('$display', { [k]: v }); st.cfg.display[k] = v;
  applyLook(); // instant, no GPU work
  renderReadout({ ...defaults(DISPLAY), ...st.cfg.display });
  if (k === 'vignette' || k === 'grain') { $('display').style.setProperty(k === 'vignette' ? '--vig' : '--grain', String(v / 100)); }
  if (['brightness', 'contrast', 'saturation', 'warmth'].includes(k)) for (const b of document.querySelectorAll('.look-chip')) b.setAttribute('aria-pressed', 'false');
  if (document.activeElement?.closest('#quickControls')) renderPages();
}

const refreshPreviewSoon = debounce(refreshPreviews, 140);
function pushSettings(id, k, v) {
  settingsWrites.push(id, { [k]: v });
  const it = itemBy(id); if (it) it.settings = { ...it.settings, [k]: v };
  renderHero(); refreshPreviewSoon();
}

const desktopsUI = lifestyles({ bridge, flush: flushAll, notify: toast, state: () => st, art });
maintenance({ bridge, flush: flushAll, notify: toast, state: () => st });
const hotkeysUI = hotkeysSection({ bridge, notify: toast });

// ------------------------------------------------------------------ Display & System pages
// [title, keys, column, icon, resettable]
const DISPLAY_GROUPS = [['Rendering', ['quality', 'fps'], 0, 'render'], ['OLED', ['oled', 'oledStrength', 'blackCrush', 'burnGuard'], 0, 'oled'], ['Clock', ['clock', 'clockFormat', 'clockDate', 'clockPosition', 'clockSize', 'clockOpacity'], 0, 'clock'], ['Overlays', ['stats'], 0, 'overlay'],
  ['Colour', ['brightness', 'contrast', 'saturation', 'warmth'], 1, 'colour', true], ['Finish', ['grain', 'vignette'], 1, 'finish', true]];
const GROUP_ICONS = { power: '<path d="M12 3v8"/><path d="M6.3 7a8 8 0 1 0 11.4 0"/>', input: '<path d="M6 3l12 8-5 1 3 6-2 1-3-6-4 3z"/>', windows: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>', render: '<path d="M4 6h16v10H4z"/><path d="M9 20h6M12 16v4"/>', oled: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor"/>', clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>', overlay: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 15l3-3 2 2 3-4"/>', colour: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16" opacity=".35"/><circle cx="12" cy="12" r="3"/>', finish: '<path d="M5 19 19 5"/><path d="M14 5h5v5"/><circle cx="7" cy="7" r="1.2" fill="currentColor"/><circle cx="17" cy="17" r="1.2" fill="currentColor"/>' };
const LOOKS = [['Natural', { brightness: 100, contrast: 100, saturation: 100, warmth: 0 }], ['Vivid', { brightness: 103, contrast: 110, saturation: 128, warmth: 0 }], ['Cinema', { brightness: 95, contrast: 114, saturation: 88, warmth: 14 }], ['Warm', { brightness: 101, contrast: 102, saturation: 106, warmth: 32 }], ['Cool', { brightness: 100, contrast: 104, saturation: 102, warmth: -30 }], ['Muted', { brightness: 98, contrast: 94, saturation: 70, warmth: 4 }]];
const SYSTEM_GROUPS = [['Power', ['pauseWhenCovered', 'hibernate', 'battery'], 0, 'power'], ['Input', ['audio', 'interactive'], 1, 'input'], ['Windows', ['themeSync', 'startWithWindows'], 2, 'windows']];
let quickKey = '';
function renderQuick() {
  const d = resolved(DISPLAY, st.cfg.display);
  const key = JSON.stringify([d.quality, d.fps, st.cfg.system.audio, st.cfg.system.interactive]);
  if (key === quickKey) return;
  quickKey = key;
  const root = $('quickControls');
  if (root.children.length) {
    for (const row of root.children) { const k = row.dataset.key, input = row.querySelector('input,select'); if (input.type === 'checkbox') input.checked = !!st.cfg.system[k]; else input.value = d[k]; }
    return;
  }
  root.textContent = '';
  for (const k of ['quality', 'fps']) root.append(control(DISPLAY.find(s => s.key === k), d[k], v => changeDisplay(k, v)));
  for (const k of ['audio', 'interactive']) root.append(control(SYSTEM.find(s => s.key === k), st.cfg.system[k], v => bridge.invoke('set_system', { system: { ...st.cfg.system, [k]: v } })));
}
function renderPages() {
  const pages = [
    [$('displayGroups'), DISPLAY, DISPLAY_GROUPS, { ...defaults(DISPLAY), ...st.cfg.display }, (k, v) => changeDisplay(k, v)],
    [$('systemGroups'), SYSTEM, SYSTEM_GROUPS, { ...defaults(SYSTEM), ...st.cfg.system }, (k, v, all) => bridge.invoke('set_system', { system: { ...defaults(SYSTEM), ...st.cfg.system, ...all } })],
  ];
  for (const [root, schema, groups, values, save] of pages) {
    root.textContent = '';
    const n = Math.max(2, ...groups.map(g => (g[2] ?? 0) + 1)); const cols = Array.from({ length: n }, () => el('div', 'set-col'));
    groups.forEach(([title, keys, column, icon, resettable], i) => {
      const col = cols[column ?? i % 2];
      const head = el('div', 'section-head', `<h2>${icon ? `<span class="group-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${GROUP_ICONS[icon] || ''}</svg></span>` : ''}${esc(title)}</h2>`);
      if (resettable) { const r = el('button', 'link-btn', 'Reset'); r.type = 'button'; r.onclick = () => { const d = defaults(schema); for (const k of keys) save(k, d[k]); renderPages(); }; head.append(r); }
      col.append(head);
      col.append(group(keys.map(k => schema.find(s => s.key === k)).filter(Boolean), values, save));
    });
    root.append(...cols);
  }
  renderAccent();
  renderLook();
  const d = { ...defaults(DISPLAY), ...st.cfg.display };
  for (const [id, q, f] of [['presetQuiet', 'eco', '24'], ['presetBalanced', 'auto', '30'], ['presetSmooth', 'high', '60'], ['presetMax', 'high', '144']]) $(id)?.setAttribute('aria-pressed', String(d.quality === q && String(d.fps) === f));
}
// Display tab live preview + looks
let lookArtFor = '';
function renderLook() {
  const it = targetItem(); if (!it || !$('lookArt')) return;
  if (lookArtFor !== it.id) { lookArtFor = it.id; art($('lookArt'), it); }
  const d = { ...defaults(DISPLAY), ...st.cfg.display };
  $('display').style.setProperty('--vig', String(d.vignette / 100)); $('display').style.setProperty('--grain', String(d.grain / 100));
  const root = $('lookPresets'); if (!root.children.length) for (const [name, v] of LOOKS) { const b = el('button', 'look-chip', esc(name)); b.type = 'button'; b.dataset.look = name; b.onclick = () => { for (const [k, x] of Object.entries(v)) changeDisplay(k, x); renderPages(); }; root.append(b); }
  for (const b of root.children) { const v = LOOKS.find(l => l[0] === b.dataset.look)[1]; const on = Object.entries(v).every(([k, x]) => d[k] === x); b.setAttribute('aria-pressed', String(on)); }
  renderReadout(d);
}
function renderReadout(d) {
  const r = $('lookReadout'); if (!r) return;
  const items = [['Brightness', d.brightness + '%'], ['Contrast', d.contrast + '%'], ['Saturation', d.saturation + '%'], ['Temperature', (d.warmth > 0 ? '+' : '') + d.warmth], ['Grain', d.grain + '%'], ['Vignette', d.vignette + '%']];
  r.innerHTML = items.map(([k, v]) => `<div><span>${k}</span><b>${esc(String(v))}</b></div>`).join('');
}
// Shows the colour theme sync last applied, next to its switch. Text, not colour alone.
let accentNow = null;
function renderAccent() {
  const row = document.querySelector('#systemGroups .row[data-key="themeSync"]'); if (!row) return;
  let chip = row.querySelector('.accent-chip');
  if (!st.cfg.system?.themeSync || !accentNow) { chip?.remove(); return; }
  if (!chip) { chip = el('span', 'accent-chip'); row.querySelector('.main')?.append(chip); }
  chip.style.setProperty('--accent', accentNow);
  chip.textContent = 'Current accent ' + accentNow.toUpperCase();
}

// ------------------------------------------------------------------ render & actions
function render(full) {
  desktopsUI.update();
  if(st.sheet)renderFavourite();
  discoverUI.update(st.cfg);
  applyLook(); renderStatus(); renderHero(); renderDisplays(); renderCards(); renderQuick(); refreshPreviewSoon();
  widgetsUI.update(st.cfg, st.monitors);
  if (full) renderPages();
  if (st.sheet && !itemBy(st.sheet)) closeSheet();
}
async function play(id) { await bridge.invoke('assign', { monitor: st.target, itemId: id }); }
async function addPaths(paths) {
  if (!paths.length) return;
  const added = await bridge.invoke('add_paths', { paths });
  if (added && added.length) await play(added[0].id);
}
$('add').onclick = async () => addPaths(await bridge.pickFiles());
$('addWeb').onclick = async () => addPaths(await bridge.pickFiles({ directory: true }));
$('add').oncontextmenu = async e => { e.preventDefault(); addPaths(await bridge.pickFiles({ directory: true })); };
$('add').title = 'Add videos, GIFs or images';
const togglePause = () => bridge.invoke('set_paused', { paused: !st.cfg.paused });
$('pause').onclick = togglePause; $('heroPause').onclick = togglePause;
// Previous / next wallpaper, in library order, on the selected display(s).
function stepWallpaper(dir) {
  const list = st.cfg.items.filter(i => i.kind !== 'skin'); if (!list.length) return;
  const cur = list.findIndex(i => i.id === targetItem()?.id);
  play(list[(cur + dir + list.length) % list.length].id);
}
$('heroPrev').onclick = () => stepWallpaper(-1); $('heroNext').onclick = () => stepWallpaper(1);
$('customise').onclick = () => { const it = targetItem(); if (it) openSheet(it.id); };
$('heroToggle').onclick = () => { const it = targetItem(); if (it) bridge.invoke('update_item', { id: it.id, settings: { emblem: !resolved(schemaFor(it), it.settings).emblem } }); };
$('restartRenderer').onclick = async () => { await bridge.invoke('restart_renderer'); toast('Wallpaper restarted'); };
$('backupSettings').onclick = async () => { await flushAll(); await bridge.invoke('backup_settings'); toast('Settings backup saved'); };
$('restoreSettings').onclick = async () => { if (confirm('Restore your saved settings backup? Current settings will be backed up first.')) { await flushAll(); await bridge.invoke('restore_settings'); render(true); toast('Settings restored'); } };
$('span').onchange = e => bridge.invoke('set_span', { span: e.target.checked });

function animateTitle(page) {
  const t = page.querySelector('.large-title'); if (!t) return;
  const text = t.dataset.text || (t.dataset.text = t.textContent);
  t.setAttribute('aria-label', text); t.textContent = '';
  [...text].forEach((ch, i) => { const sp = el('span', null, ch === ' ' ? '&nbsp;' : esc(ch)); sp.style.setProperty('--i', i); sp.setAttribute('aria-hidden', 'true'); t.append(sp); });
}
const tabScroll = new Map();
// Tab changes: fade the content out, swap pages while it is invisible (so any rendering hitch on the
// new page can't be seen), then fade back in. One layer, opacity only. A click mid-fade just retargets.
const FADE_OUT = 140, FADE_IN = 240;
let fade = { phase: null, target: null, timer: 0 };
function swapTab(tab) {
  if (tab === st.tab || !$(tab)) return;
  const old = $(st.tab), next = $(tab);
  hotkeysUI.cancel();
  tabScroll.set(st.tab, scrollY);
  document.querySelectorAll('.wcard').forEach(c => c._stopPreview?.());
  widgetsUI.activate(false);
  old.hidden = true;
  st.tab = tab;
  aboutUI.activate(tab === 'about');
  if (tab === 'display' || tab === 'system') renderPages();
  if (tab === 'system') hotkeysUI.refresh();
  next.hidden = false;
  document.querySelectorAll('.dock-item').forEach(x => { const selected = x.dataset.tab === tab; x.classList.toggle('active', selected); x.setAttribute('aria-current', selected ? 'page' : 'false'); });
  $('compact').textContent = document.querySelector(`.dock-item[data-tab=${tab}]`).getAttribute('aria-label');
  scrollTo({ top: tabScroll.get(tab) || 0, behavior: 'instant' });
  if (tab === 'widgets') widgetsUI.activate(true);
  if (tab === 'library') { mapKey = ''; renderDisplays(); }
  if (old.contains(document.activeElement)) { const title = next.querySelector('h1'); if (title) { title.tabIndex = -1; title.focus({ preventScroll: true }); } }
}
function showTab(tab) {
  if (!$(tab)) return;
  const app = document.querySelector('.app');
  // active dock state responds instantly, even before the fade completes
  document.querySelectorAll('.dock-item').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { swapTab(tab); return; }
  if (tab === st.tab && !fade.phase) return;
  beginNavigation();
  fade.target = tab;
  if (fade.phase === 'out') return;                    // already fading out: the swap will use the latest target
  clearTimeout(fade.timer);
  fade.phase = 'out';
  app.style.willChange = 'opacity';
  app.style.transition = `opacity ${FADE_OUT}ms ease-in`;
  app.style.opacity = '0';
  fade.timer = setTimeout(() => {
    swapTab(fade.target);
    fade.phase = 'in';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      app.style.transition = `opacity ${FADE_IN}ms ease-out`;
      app.style.opacity = '1';
      fade.timer = setTimeout(() => { fade.phase = null; app.style.transition = ''; app.style.opacity = ''; app.style.willChange = ''; }, FADE_IN + 30);
    }));
  }, FADE_OUT);
}
document.querySelectorAll('.dock-item').forEach(b => b.onclick = () => showTab(b.dataset.tab));
let scrolled = false;
document.addEventListener('studio-navigation-start',()=>document.querySelectorAll('.wcard').forEach(c=>c._stopPreview?.()));
addEventListener('scroll', () => { const v = scrollY > 30; if (v !== scrolled) { scrolled = v; $('navbar').classList.toggle('scrolled', v); } }, { passive: true });
document.addEventListener('pointermove', e => {
  if(navigationBusy())return;
  const c = e.target.closest?.('.card-spotlight'); if (!c) return;
  const r = c.getBoundingClientRect(); c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px');
}, { passive: true });

bridge.onDrop((type, paths) => {
  if (type === 'enter' || type === 'over') { $('drop').classList.remove('closing'); $('drop').hidden = false; }
  else if (type === 'leave' || type === 'drop') { const d = $('drop'); if (d.hidden) { if (type === 'drop') addPaths(paths); return; } d.classList.add('closing'); setTimeout(() => { d.hidden = true; d.classList.remove('closing'); }, 200); if (type === 'drop') addPaths(paths); }
});
addEventListener('resize', debounce(() => { renderDisplays();for(const box of artBoxes){const r=box.getBoundingClientRect();if(r.width&&r.height&&previewWidth(r.width,r.height,devicePixelRatio||1)>box._artWidth)art(box,box._artItem,box._artOptions);} }, 160));

// ------------------------------------------------------------------ window controls (desktop app only)
if (bridge.isApp && window.__TAURI__?.window) {
  const w = window.__TAURI__.window.getCurrentWindow();
  $('winctl').hidden = false;
  $('wMin').onclick = () => w.minimize();
  $('wMax').onclick = () => w.toggleMaximize();
  $('wClose').onclick = () => w.close();
  let closing=false;
  w.onCloseRequested(async event => {
    if(closing)return;event.preventDefault();
    try { await flushAll();closing=true;await w.close(); } catch(e) { closing=false;toast(e.message||e); }
  });
  const sync = async () => { const m = await w.isMaximized(); document.body.classList.toggle('maximized', m); $('wMax').setAttribute('aria-label', m ? 'Restore' : 'Maximise'); };
  w.onResized(debounce(sync, 60)); sync();
}

// ------------------------------------------------------------------ boot
(async () => {
  const s = await bridge.invoke('get_state');
  st.cfg = s.config; st.monitors = s.monitors; st.vis = s.visibility || st.vis;
  $('ver').textContent = `Version ${s.version} · ${s.platform}`;
  $('compact').textContent = 'Library';
  if (!bridge.isApp) { $('restartRenderer').hidden = true; }
  bridge.invoke('config_dir').then(d => $('cfgdir').textContent = d);
  render(true);
  animateTitle($('library'));
  document.querySelectorAll('#library .hero,#library .group').forEach((e, i) => { e.style.setProperty('--i', i); e.classList.add('reveal'); });
  bridge.listen('state', c => {
    const pagesChanged = JSON.stringify([c.system, c.display]) !== JSON.stringify([st.cfg.system, st.cfg.display]);
    for (const [id, patch] of settingsWrites.patches()) { const it = c.items.find(i => i.id === id); if (it) it.settings = { ...it.settings, ...patch }; }
    c.display = { ...c.display, ...settingsWrites.patches().get('$display') };
    st.cfg = c;
    // never rebuild a form while the user is dragging one of its sliders
    render(pagesChanged && !document.activeElement?.closest('#displayGroups,#systemGroups'));
  });
  bridge.listen('app-error', message => toast(message));
  bridge.listen('renderer-error', message => toast(message));
  bridge.listen('layout', m => { st.monitors = m; if (st.target !== '*' && !m.some(x => x.key === st.target)) st.target = '*'; render(); });
  bridge.listen('accent-applied', c => { accentNow = c || null; renderAccent(); });
  bridge.listen('visibility', v => { st.vis = v; renderStatus(); renderHero(); renderDisplays(); });
  window.silkReady = true;
  $('startupFailure').hidden = true;
})().catch(error => window.silkStartupFailed?.(error.message || error));

addEventListener('keydown', e => { if (e.defaultPrevented || st.sheet || document.querySelector('dialog[open]') || editable(e.target)) return; if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); $('add').click(); } });

addEventListener('blur', () => document.querySelectorAll('.wcard').forEach(c => c._stopPreview?.()));
document.addEventListener('visibilitychange', () => { if (document.hidden) document.querySelectorAll('.wcard').forEach(c => c._stopPreview?.()); });

keyboard({state:()=>st,showTab,openSheet,closeSheet,flush:flushAll,notify:toast});
