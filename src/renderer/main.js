// The wallpaper renderer. One window spans every monitor; one WebGL context draws each
// monitor as a viewport. Monitors showing the same wallpaper share one scene instance
// (rendered once, composited many times), or one spanning instance in Span mode.
import { GL } from './gl.js';
import { bridge } from '../shared/bridge.js';
import { DISPLAY, defaults, resolved, schemaFor, SCENES } from '../shared/catalog.js';
import Silk from './scenes/silk.js';
import Fluid from './scenes/fluid.js';
import Lissajous from './scenes/lissajous.js';
import Particles from './scenes/particles.js';
import Terrain from './scenes/terrain.js';
import Life from './scenes/life.js';
import Media from './scenes/media.js';
import { accentFor } from '../shared/accent.js';
import { sanitizeAudio } from '../shared/audio-input.js';

const SCENE_CLASSES = { silk: Silk, fluid: Fluid, lissajous: Lissajous, particles: Particles, terrain: Terrain, life: Life };
// Display-buffer caps per monitor. Smooth simulations don't need a native 4K buffer; video does.
const QUALITY = { eco: { out: 1.0e6, media: 2.1e6 }, balanced: { out: 2.1e6, media: 3.7e6 }, high: { out: 3.7e6, media: 8.4e6 }, ultra: { out: Infinity, media: Infinity } };
const AUTO = ['eco', 'balanced', 'high'];

const $ = id => document.getElementById(id);
const canvas = $('gl');
const S = {
  cfg: null, monitors: [], vis: { covered: [], onBattery: false, hibernating: false },
  positions: new Map(),
  groups: new Map(),        // itemId -> group
  vps: [],                  // per monitor viewport
  scale: 1, W: 1, H: 1, dpr: 1,
  raf: 0, last: 0, dirty: true, frame: 0, sleeping: false,
  autoLevel: 1, audio: { level: 0, bass: 0, mid: 0, treble: 0, beat: false, target: 0, t: -1e9, avg: 0, lastBeat: 0 },
  cursor: { x: 0, y: 0, down: false, active: false, t: 0 },
};
let rendererReady = false, rendererFault = false;
let g;
try { g = new GL(canvas); } catch (e) { document.body.classList.add('nogl'); console.error(e); }

const display = () => resolved(DISPLAY, S.cfg?.display);
function effective() {
  const d = display(), batt = S.vis.onBattery ? S.cfg.system.battery : 'normal';
  let quality = d.quality === 'auto' ? AUTO[S.autoLevel] : d.quality, fps = +d.fps;
  if (batt === 'eco') { quality = 'eco'; fps = Math.min(fps, 24); }
  return { ...d, quality, fps, paused: S.cfg.paused || batt === 'pause' };
}

// ------------------------------------------------------------------ layout & groups
function layout() {
  S.dpr = devicePixelRatio || 1;
  S.W = Math.max(1, Math.round(innerWidth * S.dpr)); S.H = Math.max(1, Math.round(innerHeight * S.dpr));
  if (!g || S.sleeping) return;
  const e = effective(), q = QUALITY[e.quality];
  const hasMedia = [...S.groups.values()].some(gr => gr.item.kind === 'video' || gr.item.kind === 'image');
  const cap = (hasMedia ? q.media : q.out) * Math.max(1, S.monitors.length);
  S.scale = Math.min(1, Math.sqrt(cap / (S.W * S.H)));
  const cw = Math.max(1, Math.round(S.W * S.scale)), ch = Math.max(1, Math.round(S.H * S.scale));
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
  S.vps = S.monitors.map(m => ({ mon: m, x: Math.round(m.x * S.scale), y: Math.round(m.y * S.scale), w: Math.max(1, Math.round(m.w * S.scale)), h: Math.max(1, Math.round(m.h * S.scale)) }));
  for (const vp of S.vps) vp.group = S.groups.get(itemFor(vp.mon)?.id);
  for (const gr of S.groups.values()) sizeGroup(gr);
  placeOverlays();
  S.dirty = true;
}

function itemFor(mon) {
  const c = S.cfg, id = c.assign[mon.key] || c.assign['*'];
  return c.items.find(i => i.id === id) || c.items.find(i => i.id === 'builtin-silk');
}

function sizeGroup(gr) {
  const vps = S.vps.filter(v => v.group === gr);
  if (!vps.length) return;
  let w, h;
  if (S.cfg.span) {
    const x0 = Math.min(...vps.map(v => v.x)), y0 = Math.min(...vps.map(v => v.y));
    const x1 = Math.max(...vps.map(v => v.x + v.w)), y1 = Math.max(...vps.map(v => v.y + v.h));
    gr.box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; w = gr.box.w; h = gr.box.h;
  } else { w = Math.max(...vps.map(v => v.w)); h = Math.max(...vps.map(v => v.h)); gr.box = null; }
  gr.size = [w, h];
  if (gr.scene) gr.scene.resize(w, h, effective().quality, wantMips(gr));
}

function wantMips(gr) {
  const e = effective(), st = gr.settings || {};
  return e.oled || (st.glow > 0 && (gr.item.kind === 'video' || gr.item.kind === 'image'));
}

function sync() {
  if (!S.cfg || S.sleeping) return;
  const want = new Map();
  for (const m of S.monitors) { const it = itemFor(m); if (it) want.set(it.id, it); }
  for (const [id, gr] of S.groups) {
    const it = want.get(id);
    const changedKind = it && (it.kind !== gr.item.kind || it.scene !== gr.item.scene || it.path !== gr.item.path);
    if (!it || changedKind) { disposeGroup(gr); S.groups.delete(id); }
  }
  for (const [id, it] of want) {
    let gr = S.groups.get(id);
    const settings = resolved(schemaFor(it), it.settings);
    if (!gr) {
      gr = { item: it, settings };
      if (it.kind === 'scene') { const C = SCENE_CLASSES[it.scene]; if (C && g) gr.scene = new C(g, settings); }
      else if ((it.kind === 'video' || it.kind === 'image') && g) { gr.scene = new Media(g, settings, it, kick); gr.scene.resumeAt = S.positions.get(id) || 0; }
      S.groups.set(id, gr);
    } else { gr.item = it; gr.settings = settings; if (!gr.fallback) gr.scene?.setSettings(settings); }
  }
  layout();
  syncWeb();
  setPaused(effective().paused);
  kick();
}

function disposeGroup(gr) { if (gr.scene?.video) { S.positions.set(gr.item.id, gr.scene.video.currentTime); if (S.positions.size > 64) S.positions.delete(S.positions.keys().next().value); } try { gr.scene?.dispose(); } catch (e) { console.warn(e); } gr.scene = null; (gr.frames || []).forEach(f => f.remove()); gr.frames = []; }

// ------------------------------------------------------------------ web wallpapers (iframes)
async function syncWeb() {
  for (const gr of S.groups.values()) {
    if (gr.item.kind !== 'web') continue;
    const vps = S.vps.filter(v => v.group === gr);
    const rects = S.cfg.span ? [unionCss(vps)] : vps.map(v => css(v.mon));
    gr.frames = gr.frames || [];
    while (gr.frames.length > rects.length) gr.frames.pop().remove();
    const url = await bridge.mediaURL(gr.item, '');
    if (S.groups.get(gr.item.id) !== gr || S.sleeping) continue;
    rects.forEach((r, i) => {
      let f = gr.frames[i];
      if (!f) {
        f = document.createElement('iframe');
        f.setAttribute('sandbox', 'allow-scripts allow-same-origin');
        f.setAttribute('allow', 'autoplay');
        f.className = 'web'; $('web').append(f); gr.frames[i] = f;
      }
      if (f.dataset.src !== url && url) { f.src = url; f.dataset.src = url; }
      Object.assign(f.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
      f.hidden = S.cfg.span ? vps.every(v => S.vis.covered.includes(v.mon.key)) : S.vis.covered.includes(vps[i]?.mon.key);
    });
  }
}
const css = m => ({ x: m.x / S.dpr, y: m.y / S.dpr, w: m.w / S.dpr, h: m.h / S.dpr });
function unionCss(vps) { const ms = vps.map(v => css(v.mon)); const x = Math.min(...ms.map(m => m.x)), y = Math.min(...ms.map(m => m.y)); return { x, y, w: Math.max(...ms.map(m => m.x + m.w)) - x, h: Math.max(...ms.map(m => m.y + m.h)) - y }; }
function postWeb(msg) { for (const gr of S.groups.values()) (gr.frames || []).forEach(f => f.contentWindow?.postMessage(msg, '*')); }

// ------------------------------------------------------------------ overlays (bird, clock)
let shift = { x: 0, y: 0 };
function placeOverlays() {
  const root = $('overlays'); root.textContent = '';
  const d = display();
  for (const vp of S.vps) {
    const r = css(vp.mon), it = vp.group?.item, st = vp.group?.settings || {};
    const box = document.createElement('div'); box.className = 'ovl';
    Object.assign(box.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
    if (st.emblem && (!S.cfg.span || vp === S.vps.find(v => v.group === vp.group))) {
      const b = document.createElement('img'); b.src = 'assets/echelon-bird.svg'; b.className = 'bird'; b.alt = '';
      let area = r, ox = 0, oy = 0;
      if (S.cfg.span && vp.group.box) { const u = unionCss(S.vps.filter(v => v.group === vp.group)); area = u; ox = u.x - r.x; oy = u.y - r.y; }
      const size = Math.min(area.w, area.h) * st.emblemSize / 100;
      const [cx, cy] = emblemCentre(st.emblemPos, area.w, area.h, size);
      Object.assign(b.style, { width: size + 'px', left: ox + cx + 'px', top: oy + cy + 'px', opacity: (st.emblemOpacity ?? 100) / 100 });
      box.append(b);
    }
    if (d.clock) { const c = document.createElement('div'); c.className = 'clock'; c.innerHTML = '<time></time><span></span>'; c.dataset.position = d.clockPosition; c.style.opacity = d.clockOpacity / 100; c.style.setProperty('--clock-scale', d.clockSize / 100); c.querySelector('span').hidden = !d.clockDate; box.append(c); }
    box.style.transform = `translate(${shift.x}px,${shift.y}px)`;
    box.hidden = S.vis.covered.includes(vp.mon.key);
    root.append(box);
  }
  tickClock();
}
// Bird centre within an area, in px. Corner positions keep a margin of 7% of the short side.
function emblemCentre(pos, w, h, size) {
  const m = Math.min(w, h) * .07 + size / 2;
  switch (pos) {
    case 'lower-right': return [w - m, h - m];
    case 'lower-left': return [m, h - m];
    case 'upper-right': return [w - m, m];
    case 'upper-left': return [m, m];
    default: return [w / 2, h * .48];
  }
}
function tickClock() {
  const t = new Date(), d = display();
  document.querySelectorAll('.clock').forEach(c => {
    c.querySelector('time').textContent = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(d.clockFormat === 'system' ? {} : { hour12: d.clockFormat === '12' }) });
    c.querySelector('span').textContent = t.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase();
  });
}
(function minute() { tickClock(); const t = new Date(); setTimeout(minute, 60000 - t.getSeconds() * 1000 - t.getMilliseconds() + 30); })();
setInterval(() => {
  if (!display().burnGuard) { if (shift.x || shift.y) { shift = { x: 0, y: 0 }; placeOverlays(); } return; }
  const t = Math.floor(Date.now() / 120000); shift = { x: Math.round(Math.sin(t * 1.7) * 4), y: Math.round(Math.cos(t * 1.3) * 4) }; placeOverlays();
}, 5000);

// ------------------------------------------------------------------ input
function onAudio(raw) {
  const b = sanitizeAudio(raw);   // one place makes every value sane, so no scene can be poisoned by a NaN or a runaway number
  const a = S.audio; a.target = (b.bass * 0.7 + b.mid * 0.3); a.bassIn = b.bass; a.midIn = b.mid; a.trebleIn = b.treble; a.t = performance.now();
  if (b.bands) a.bands = b.bands;                                         // full 32-band spectrum (cymatics)
  if (b.wave) { a.wave = b.wave; a.waveT = a.t; a.waveSeq = (a.waveSeq || 0) + 1; } // raw waveform for the XY scope
  if (a.target > 0.01 || a.level > 0.002) kick();
  postWeb({ echelon: 'audio', bands: b.bands });
}
function onCursor(x, y, down) {
  const c = S.cursor; c.x = x; c.y = y; c.clicked = down && !c.down; c.down = down; c.active = true; c.t = performance.now();
  kick();
  const vp = S.vps.find(v => x >= v.mon.x && x < v.mon.x + v.mon.w && y >= v.mon.y && y < v.mon.y + v.mon.h);
  if (vp?.group?.item.kind === 'web' && vp.group.settings.interactive) {
    const f = vp.group.frames?.[S.cfg.span ? 0 : S.vps.filter(v => v.group === vp.group).indexOf(vp)];
    if (f) { const r = f.getBoundingClientRect(); f.contentWindow?.postMessage({ echelon: 'cursor', x: x / S.dpr - r.left, y: y / S.dpr - r.top, down }, '*'); }
  }
}
function pointerFor(gr) {
  const c = S.cursor;
  if (!c.active || !S.cfg.system.interactive) return { active: false, x: .5, y: .5, down: false, clicked: false };
  const vp = S.vps.find(v => v.group === gr && c.x >= v.mon.x && c.x < v.mon.x + v.mon.w && c.y >= v.mon.y && c.y < v.mon.y + v.mon.h);
  if (!vp) return { active: false, x: .5, y: .5, down: false, clicked: false };
  let x, y;
  if (S.cfg.span && gr.box) { x = (c.x * S.scale - gr.box.x) / gr.box.w; y = 1 - (c.y * S.scale - gr.box.y) / gr.box.h; }
  else { x = (c.x - vp.mon.x) / vp.mon.w; y = 1 - (c.y - vp.mon.y) / vp.mon.h; }
  return { active: true, x, y, down: c.down, clicked: c.clicked };
}

// ------------------------------------------------------------------ pause / hibernate
function setPaused(p) {
  for (const gr of S.groups.values()) {
    const hidden = !S.vps.some(v => v.group === gr && !S.vis.covered.includes(v.mon.key));
    gr.scene?.pause?.(p || hidden);
    (gr.frames || []).forEach((f, i) => {
      const vps = S.vps.filter(v => v.group === gr);
      const covered = S.cfg.span ? hidden : S.vis.covered.includes(vps[i]?.mon.key);
      f.contentWindow?.postMessage({ echelon: 'paused', value: p || covered }, '*');
    });
  }
}
const allCovered = () => S.monitors.length > 0 && S.monitors.every(m => S.vis.covered.includes(m.key));
function hibernate() {
  if (S.sleeping) return;
  for (const gr of S.groups.values()) disposeGroup(gr);
  S.groups.clear(); S.sleeping = true;
  if (g) { canvas.width = canvas.height = 1; }
  if (S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; }
}
function wake() { if (!S.sleeping) return; S.sleeping = false; sync(); }

// ------------------------------------------------------------------ frame loop (event-driven)
function kick() { if (!S.raf && !S.sleeping && !allCovered()) S.raf = requestAnimationFrame(frame); }
let gEma = 0, gBad = 0, gGood = 0, gCool = 0;
function govern(gap, target) {
  if (display().quality !== 'auto') return;
  gEma = gEma ? gEma * .94 + gap * .06 : gap; if (gCool > 0) { gCool--; return; }
  if (gEma > target * 1.3) { if (++gBad > 60 && S.autoLevel > 0) { S.autoLevel--; gBad = gGood = 0; gCool = 180; layout(); } } else gBad = Math.max(0, gBad - 1);
  if (gEma < target * 1.06) { if (++gGood > 900 && S.autoLevel < AUTO.length - 1) { S.autoLevel++; gGood = gBad = 0; gCool = 300; layout(); } } else gGood = 0;
}

function frame(now) {
  S.raf = 0;
  if (S.sleeping || !S.cfg || !g || allCovered()) return;
  const e = effective(), interval = 1000 / e.fps;
  if (now - S.last < interval - 1.5) { S.raf = requestAnimationFrame(frame); return; }
  const gap = now - S.last, dt = gap > 250 ? 1 / e.fps : gap / 1000; S.last = now - ((now - S.last) % interval);
  const motion = !e.paused;
  // audio smoothing + beat detection
  const a = S.audio, live = S.cfg.system.audio && now - a.t < 500;
  const tgt = live && motion ? a.target : 0;
  a.level += (tgt - a.level) * (1 - Math.exp(-dt * (tgt > a.level ? 12 : 3))); if (a.level < 1e-4 && !tgt) a.level = 0;
  a.bass = live ? a.bassIn : 0; a.mid = live ? a.midIn : 0; a.treble = live ? a.trebleIn : 0;
  a.avg = a.avg * 0.96 + a.bass * 0.04;
  a.beat = live && a.bass > 0.22 && a.bass > a.avg * 1.35 && now - a.lastBeat > 250;
  if (a.beat) a.lastBeat = now;
  if (S.cursor.active && now - S.cursor.t > 3000) S.cursor.active = false;

  let anim = motion && a.level > 0;
  const covered = S.vis.covered;
  for (const gr of S.groups.values()) {
    if (!gr.scene) continue;
    const visible = S.vps.some(v => v.group === gr && !covered.includes(v.mon.key));
    if (!visible) continue;
    if (gr.scene.error && !gr.reportedError) {
      const error = gr.scene.error;
      disposeGroup(gr); gr.reportedError = true; gr.fallback = true;
      const fallback = { kind: 'scene', scene: 'silk' };
      gr.scene = new Silk(g, resolved(schemaFor(fallback), {})); sizeGroup(gr);
      bridge.invoke('report_renderer_error', { message: `${gr.item.name}: ${error}. Showing Living Silk; use Restart wallpaper to retry.` }).catch(() => {});
    }
    const inp = { motion, audio: a, pointer: pointerFor(gr), oled: e.oled };
    const busy = gr.scene.update(dt, inp);
    if (busy || S.dirty || gr.needs) { gr.scene.render(inp); if (gr.item.kind === 'scene' || gr.fallback) g.mip(gr.scene.output); }
    gr.needs = false;
    if (busy) anim = true;
  }
  S.cursor.clicked = false;
  composite(e);
  if (accent.wanted) sampleAccent(); // same task as the draw, before the buffer is presented
  S.dirty = false;
  if (anim) { govern(gap > 250 ? interval : gap, interval); S.raf = requestAnimationFrame(frame); }
  stats(now, anim);
}

// ------------------------------------------------------------------ theme sync
// Samples the primary monitor's composited frame (48x27 px, a one-off readback) after a wallpaper
// settles, then every 5 seconds for moving scenes. Rust rate-limits and writes the accent.
const accent = { wanted: false, timer: 0, last: '', canvas: null };
function scheduleAccent(delay = 100) {
  clearTimeout(accent.timer);
  if (!S.cfg?.system?.themeSync) return;
  accent.timer = setTimeout(() => { accent.wanted = true; S.dirty = true; kick(); }, delay);
}
// After any change, sample a few times in quick succession: simulations start nearly empty and a
// freshly built scene is still warming up, so the first frame is not always the final look.
// Unchanged colours are skipped, so the extra samples cost almost nothing.
function accentBurst(first = 100) {
  (accent.burst || []).forEach(clearTimeout);
  accent.burst = [first, first + 700, first + 2000].map(d => setTimeout(() => scheduleAccent(0), d));
}
function sampleAccent() {
  accent.wanted = false;
  const vp = S.vps.find(v => v.mon.primary) || S.vps[0];
  if (!vp || S.vis.covered.includes(vp.mon.key) || !vp.group || vp.group.item.kind === 'web') return;
  try {
    // RGB colour modes pin the accent to a dark neutral (see accent.js); everything else follows the picture
    const color = accentFor(vp.group.item, vp.group.settings, () => {
      accent.canvas ||= Object.assign(document.createElement('canvas'), { width: 48, height: 27 });
      const ctx = accent.canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(canvas, vp.x, vp.y, vp.w, vp.h, 0, 0, 48, 27);
      return ctx.getImageData(0, 0, 48, 27).data;
    });
    // skip changes nobody could see: each real change is a registry write plus a system-wide broadcast
    const dist = (a, b) => { const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16); return Math.abs((x >> 16) - (y >> 16)) + Math.abs(((x >> 8) & 255) - ((y >> 8) & 255)) + Math.abs((x & 255) - (y & 255)); };
    if (color !== accent.last && (!accent.last || dist(color, accent.last) > 14)) {
      accent.last = color;
      // Rust answers false when it throttled the write; ask again shortly so the change is never lost
      bridge.invoke('apply_accent', { color }).then(r => { if (r === false) { accent.last = ''; scheduleAccent(200); } }).catch(() => {});
    }
  } catch (e) { console.warn('Theme sync sample failed', e); }
}
setInterval(() => { if (S.cfg?.system?.themeSync && !S.sleeping && !document.hidden && !allCovered()) scheduleAccent(0); }, 5000);

function fitMap(sw, sh, rw, rh, fit, flipY) {
  const sa = rw / rh, ma = sw / sh;
  let x = 1, y = 1;
  if (fit === 'cover') { if (ma > sa) x = sa / ma; else y = ma / sa; }
  else if (fit === 'contain') { if (ma > sa) y = ma / sa; else x = sa / ma; }
  let ox = (1 - x) / 2, oy = (1 - y) / 2;
  if (flipY) { oy += y; y = -y; }
  return [ox, oy, x, y];
}

function composite(e) {
  const gl = g.gl;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  const os = e.oled ? Math.max(.001, e.oledStrength / 100) : 0;
  for (const vp of S.vps) {
    const gr = vp.group;
    if (!gr || !gr.scene || S.vis.covered.includes(vp.mon.key)) continue;
    const out = gr.scene.output; if (!out || !out.tex) continue;
    const media = !gr.fallback && (gr.item.kind === 'video' || gr.item.kind === 'image'), st = gr.settings;
    const region = S.cfg.span && gr.box ? gr.box : vp;
    const [sw, sh] = media ? [out.w, out.h] : gr.size;
    const R = fitMap(sw, sh, region.w, region.h, media ? st.fit : 'cover', media);
    let sub = [0, 0, 1, 1];
    if (S.cfg.span && gr.box) sub = [(vp.x - gr.box.x) / gr.box.w, 1 - (vp.y + vp.h - gr.box.y) / gr.box.h, vp.w / gr.box.w, vp.h / gr.box.h];
    const map = [R[0] + sub[0] * R[2], R[1] + sub[1] * R[3], sub[2] * R[2], sub[3] * R[3]];
    const texPerPx = out.w * Math.abs(map[2]) / vp.w;
    const baseLod = out.mips ? Math.max(0, Math.log2(Math.max(texPerPx, 1e-6))) : 0;
    const localLod = Math.log2(Math.max(1, out.w * Math.abs(map[2]) / (vp.w / 24)));
    let shadow = [0, 0, 0, 0];
    if (st.emblem && gr.item.kind !== 'web') { // soft contact shadow under the bird, wherever it sits
      const area = region, size = Math.min(area.w, area.h) * st.emblemSize / 100, [cx, cy] = emblemCentre(st.emblemPos, area.w, area.h, size);
      const k = st.emblemSize / 38 * (st.emblemOpacity ?? 100) / 100;
      let u = cx / area.w, v = 1 - cy / area.h;
      if (S.cfg.span && gr.box) { u = (u * gr.box.w - (vp.x - gr.box.x)) / vp.w; v = 1 - ((1 - v) * gr.box.h - (vp.y - gr.box.y)) / vp.h; }
      const sx = S.cfg.span && gr.box ? gr.box.w / vp.w : 1, sy = S.cfg.span && gr.box ? gr.box.h / vp.h : 1;
      shadow = [u, v, .23 * k * sx, .3 * k * sy];
    }
    gl.viewport(vp.x, canvas.height - vp.y - vp.h, vp.w, vp.h);
    g.use(g.comp, {
      uTex: out, uTexSize: [out.w, out.h], uMap: map, uVp: [vp.w, vp.h],
      uFx: [media ? st.brightness / 100 : 1, media ? st.glow / 100 * (1 + S.audio.level * .6) : 0, media ? st.sharpen / 100 : 0, media ? 1 : 0],
      uLod: [baseLod, localLod, out.mips ? 1 : 0, texPerPx < 0.98 ? 1 : 0],
      uOled: [os, .0004 + (e.blackCrush / 100) ** 2 * .03, e.oled ? Math.max(e.vignette / 100, .6 * os) : e.vignette / 100, g.p3 ? 1 : 0],
      uColour: [e.brightness / 100, e.contrast / 100, e.saturation / 100, e.warmth / 100],
      uLook: [e.grain / 100 * .05, S.frame % 64],
      uShadow: shadow,
    });
    g.draw();
  }
  S.frame++;
}

// ------------------------------------------------------------------ stats (?stats or Studio toggle)
let sFrames = 0, sT = 0;
function stats(now, anim) {
  sFrames++;
  if (!display().stats && !location.search.includes('stats')) { $('stats').hidden = true; return; }
  if (now - sT < 1000) return;
  const fps = sFrames * 1000 / (now - sT); sFrames = 0; sT = now;
  $('stats').hidden = false;
  const mem = performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(1) + ' MB' : 'n/a';
  const canvasMB = canvas.width * canvas.height * 4 * 2 / 1048576;
  $('stats').textContent = `${fps.toFixed(0)} fps${anim ? '' : ' · idle'} · ${canvas.width}×${canvas.height} · gpu ~${(canvasMB + g.bytes / 1048576).toFixed(1)} MB · heap ${mem} · ${effective().quality}${g.p3 ? ' · P3' : ''}`;
}

// ------------------------------------------------------------------ wiring
async function boot() {
  const st = await bridge.invoke('get_state');
  S.cfg = st.config; S.monitors = st.monitors; S.vis = st.visibility || S.vis;
  S.autoLevel = 1; // Begin balanced; the governor upgrades only after sustained headroom.
  if (S.vis.hibernating) hibernate(); else sync();
  accentBurst(1200);
  const wallpaperKey = c => JSON.stringify({...c, widgets: undefined});
  let lastWallpaper = wallpaperKey(S.cfg);
  bridge.listen('state', c => { const key = wallpaperKey(c); const syncWas = S.cfg?.system?.themeSync; S.cfg = c; if (key !== lastWallpaper) { lastWallpaper = key; sync(); accentBurst(); } else if (c.system?.themeSync && !syncWas) { accent.last = ''; accentBurst(250); } });
  bridge.listen('accent-retry', () => { accent.last = ''; });
  bridge.listen('accent-request', () => { accent.last = ''; accentBurst(250); });
  bridge.listen('layout', m => { S.monitors = m; sync(); });
  bridge.listen('visibility', v => {
    const was = S.vis; S.vis = v;
    if (v.hibernating && !was.hibernating) return hibernate();
    if (!v.hibernating && S.sleeping) return wake();
    S.last = 0; sync();
  });
  bridge.listen('audio', onAudio);
  bridge.listen('cursor', c => onCursor(c.x, c.y, c.down));
  bridge.listen('cursor-leave', () => { S.cursor.active = false; kick(); });
  rendererReady = true;
  if (!bridge.isApp) {
    // browser preview: the page itself is the desktop
    addEventListener('pointermove', e => onCursor(e.clientX * S.dpr, e.clientY * S.dpr, e.buttons & 1));
    addEventListener('pointerdown', e => onCursor(e.clientX * S.dpr, e.clientY * S.dpr, true));
    addEventListener('pointerup', e => onCursor(e.clientX * S.dpr, e.clientY * S.dpr, false));
    document.addEventListener('pointerleave', () => { S.cursor.active = false; });
    let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(async () => { S.monitors = (await bridge.invoke('get_state')).monitors; layout(); kick(); }, 150); });
    document.addEventListener('visibilitychange', () => { S.vis = { ...S.vis, covered: document.hidden ? S.monitors.map(m => m.key) : [] }; setPaused(effective().paused); kick(); });
  }
}

canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); hibernate(); });
canvas.addEventListener('webglcontextrestored', () => { try { g = new GL(canvas); } catch (e) { return; } S.sleeping = true; wake(); });
// Heartbeat is independent of frame production: a paused/static wallpaper is healthy.
if (bridge.isApp) { const heartbeat = () => { if (rendererReady && !rendererFault && !S.sleeping) { for (const gr of S.groups.values()) gr.scene?.health?.(); if (!S.raf || performance.now() - S.last < 15000) bridge.invoke('renderer_heartbeat').catch(() => {}); } }; heartbeat(); setInterval(heartbeat, 10000); }
globalThis.addEventListener?.('error', event => { rendererFault = true; bridge.invoke('report_renderer_error', { message: 'Wallpaper error: ' + event.message }).catch(() => {}); });
globalThis.addEventListener?.('unhandledrejection', event => { rendererFault = true; bridge.invoke('report_renderer_error', { message: 'Wallpaper operation failed: ' + String(event.reason) }).catch(() => {}); });
window.__echelon = S; // for debugging / tests
Object.defineProperty(S, 'gpuBytes', { get: () => g ? g.bytes : 0 }); // read-only estimate for leak tests
boot().catch(e => bridge.invoke('report_renderer_error', { message: 'Wallpaper startup failed: ' + String(e) }).catch(() => {}));
