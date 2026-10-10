import { waitForNavigationIdle } from './scrolling.js';
// Shader-rendered card previews for simulations whose settings differ from the defaults.
//
// Built-in scenes at default settings already ship with real renders (assets/thumbs), so they
// never touch the GPU here. Custom presets are rendered once, at thumbnail size, with the
// simulation steps spread across frames so the GPU stays free for the interface, encoded
// asynchronously, and stored in IndexedDB so the cost is paid once per preset, not per launch.
// The global display look (brightness, OLED...) is NOT part of a preview: it is applied to every
// thumbnail with a cheap CSS filter, so dragging a Display slider never re-runs a simulation.
import { GL } from '../renderer/gl.js';
import Silk from '../renderer/scenes/silk.js';
import Fluid from '../renderer/scenes/fluid.js';
import Lissajous from '../renderer/scenes/lissajous.js';
import Particles from '../renderer/scenes/particles.js';
import { defaults, schemaFor } from '../shared/catalog.js';
import { PREVIEW_MAX_WIDTH as MAX_WIDTH, HERO_MAX_WIDTH, previewKey, sceneSettings as sceneKeys, usesBundledRender } from '../shared/preview-policy.js';

const classes = { silk: Silk, fluid: Fluid, lissajous: Lissajous, particles: Particles };
const STEPS = { silk: 1, fluid: 12, lissajous: 40, particles: 18 };
const MEMORY = 24;                // Blob cache entries (~40 KB each)
const blobs = new Map(), pending = new Map(), latest = new Map();
let queue = Promise.resolve(), canvas = null, g = null, idle = 0, dbp = null;

function db() {
  return dbp ||= new Promise((res, rej) => { const r = indexedDB.open('silk-engine-previews', 1); r.onupgradeneeded = () => r.result.createObjectStore('p'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }).catch(() => null);
}
async function stored(key) { const d = await db(); if (!d) return null; return new Promise(res => { try { const q = d.transaction('p').objectStore('p').get(key); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); } catch { res(null); } }); }
async function store(key, blob) { const d = await db(); try { d?.transaction('p', 'readwrite').objectStore('p').put(blob, key); } catch { } }
function remember(key, blob) { blobs.delete(key); blobs.set(key, blob); while (blobs.size > MEMORY) blobs.delete(blobs.keys().next().value); }

function release() { g?.gl.getExtension('WEBGL_lose_context')?.loseContext(); g = canvas = null; }
document.addEventListener('visibilitychange', () => { if (document.hidden) queue.finally(release); });
// Let the compositor present a frame between GPU batches.
const breathe = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

async function render(item, width, consumer, key, hero) {
  await waitForNavigationIdle();
  if (document.hidden || latest.get(consumer) !== key) return null;
  clearTimeout(idle);
  const height = Math.round(width * 9 / 16);
  let scene;
  try {
    if (!g) { canvas = document.createElement('canvas'); g = new GL(canvas); }
    canvas.width = width; canvas.height = height;
    const C = classes[item.scene]; if (!C) return null;
    const settings = { ...defaults(schemaFor(item)), ...sceneKeys(item) };
    scene = new C(g, { ...settings, ...(item.scene === 'particles' ? { count: '16384' } : {}) });
    scene.resize(width, height, hero ? 'ultra' : item.scene === 'fluid' ? 'preview' : 'high', false);
    const inp = { motion: true, audio: { level: 0, bass: 0, mid: 0, treble: 0, beat: false }, pointer: { active: false, x: .5, y: .5, down: false, clicked: false }, oled: false };
    for (let i = 0; i < STEPS[item.scene]; i++) {
      scene.update(1 / 30, inp); scene.render(inp);
      if (i % 2 === 1) { await breathe(); await waitForNavigationIdle(); if (document.hidden || latest.get(consumer) !== key) return null; }
    }
    const out = scene.output; if (!out) return null;
    g.mip(out); const gl = g.gl; g.bindTarget(null); gl.viewport(0, 0, width, height);
    // neutral look: the display look is applied by CSS on the thumbnail
    g.use(g.comp, { uTex: out, uTexSize: [out.w, out.h], uMap: [0, 0, 1, 1], uVp: [width, height], uFx: [1, 0, 0, 0], uLod: [0, 4, out.mips ? 1 : 0, 0], uOled: [0, .0004, .35, g.p3 ? 1 : 0], uColour: [1, 1, 1, 0], uLook: [0, 0], uShadow: [0, 0, 0, 0] });
    g.draw();
    // toBlob encodes off the main thread (a synchronous encode blocked it for the whole encode)
    return await new Promise(res => canvas.toBlob(res, 'image/webp', 0.86));
  } catch (e) { console.warn('Simulation preview unavailable', e); return null; }
  finally { scene?.dispose(); idle = setTimeout(release, 4000); }
}

/** Resolves to a fresh object URL (caller revokes) or null when the bundled render applies. */
export async function simulationPreview(item, _display, width = 640, { hero = false } = {}) {
  // The bundled 960 px thumbnails are fine for cards; the full-width hero always gets a real render.
  if (!item || item.kind !== 'scene' || (!hero && usesBundledRender(item))) return null;
  const max = hero ? HERO_MAX_WIDTH : MAX_WIDTH;
  width = Math.min(max, Math.max(320, Math.round(width)));
  const key = previewKey(item, width, max) + (hero ? ':hero' : ''), consumer = item.id + ':' + width + (hero ? ':hero' : '');
  latest.set(consumer, key);
  if (latest.size > 256) latest.delete(latest.keys().next().value);
  let blob = blobs.get(key);
  if (!blob) {
    if (!pending.has(key)) {
      const job = (async () => {
        let b = await stored(key);
        if (!b) {
          const run = queue.then(() => render(item, width, consumer, key, hero));
          queue = run.catch(() => null);
          b = await run;
          if (b) store(key, b);
        }
        if (b) remember(key, b);
        return b;
      })().finally(() => pending.delete(key));
      pending.set(key, job);
    }
    blob = await pending.get(key);
  }
  return blob ? URL.createObjectURL(blob) : null;
}
