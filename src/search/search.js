import { bridge } from '../shared/bridge.js';
import { bindSurfaceTheme, surfacePalette } from '../shared/surface-theme.js';
import { appendPoint, selectionBounds, scaledSelection, tracePath } from './model.js';
const $ = id => document.getElementById(id), image = $('screen'), canvas = $('trace'), hint = $('hint'), search = $('search'), redraw = $('redraw');
const ctx = canvas.getContext('2d');
let points = [], drawing = false, pointer = null, screenshot = null, session = null, closed = false, submitting = false, frame = 0, themeUntil = 0;
const themeStop = bindSurfaceTheme(bridge, document.documentElement.style);
const stopAccentPaint = bridge.listen('accent-applied', () => { if (!closed) { themeUntil = performance.now() + (matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 240); schedulePaint(); } });
const state = value => { document.body.dataset.state = value; };
function sizeCanvas() { const dpr = Math.min(devicePixelRatio || 1, 2); canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); paint(); }
function paint() {
  frame = 0; ctx.clearRect(0, 0, innerWidth, innerHeight);
  ctx.fillStyle = 'rgba(5,8,15,.32)'; ctx.fillRect(0, 0, innerWidth, innerHeight);
  if (!points.length) return;
  ctx.save(); tracePath(ctx, points); ctx.globalCompositeOperation = 'destination-out'; ctx.fill('evenodd'); ctx.restore();
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-soft').trim() || surfacePalette(null).soft;
  ctx.save(); tracePath(ctx, points); ctx.strokeStyle = accent; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.shadowColor = accent; ctx.shadowBlur = 9; ctx.stroke(); ctx.restore();
  if (!closed && performance.now() < themeUntil) schedulePaint();
}
function schedulePaint() { if (!frame) frame = requestAnimationFrame(paint); }
function reset() { if (submitting) return; hint.hidden = true; drawing = false; points = []; search.disabled = true; redraw.disabled = true; hint.textContent = 'Draw any outline around what you want to find'; state('ready'); paint(); }
async function cancel() {
  if (closed) return;
  closed = true; if (frame) cancelAnimationFrame(frame); themeStop(); stopAccentPaint();
  if (screenshot) URL.revokeObjectURL(screenshot); image.removeAttribute('src');
  await bridge.invoke('circle_search_cancel', { session }).catch(() => {});
}
canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0 || closed || submitting || document.body.dataset.state === 'loading') return;
  e.preventDefault(); points = []; drawing = true; pointer = e.pointerId; canvas.setPointerCapture(pointer);
  appendPoint(points, { x: e.clientX, y: e.clientY }, innerWidth, innerHeight); search.disabled = true; redraw.disabled = true; state('drawing'); schedulePaint();
});
canvas.addEventListener('pointermove', e => {
  if (!drawing || e.pointerId !== pointer) return;
  for (const sample of e.getCoalescedEvents?.() ?? [e]) appendPoint(points, { x: sample.clientX, y: sample.clientY }, innerWidth, innerHeight);
  schedulePaint();
});
function finish(e) {
  if (!drawing || e.pointerId !== pointer) return;
  appendPoint(points, { x: e.clientX, y: e.clientY }, innerWidth, innerHeight); drawing = false;
  if (canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer); pointer = null;
  const bounds = selectionBounds(points, innerWidth, innerHeight);
  search.disabled = !bounds; redraw.disabled = !bounds; hint.textContent = bounds ? 'Your outline is ready. Search, or draw another one.' : 'Draw a larger outline around the object'; state('ready'); paint();
}
canvas.addEventListener('pointerup', finish);
canvas.addEventListener('pointercancel', () => { drawing = false; pointer = null; reset(); });
canvas.addEventListener('lostpointercapture', () => { if (drawing) { drawing = false; pointer = null; reset(); } });
redraw.addEventListener('click', reset);
document.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); void cancel(); } else if (e.key === 'Enter' && !search.disabled && !e.target.closest?.('button')) { e.preventDefault(); void submit(); } });
async function submit() {
  if (search.disabled || submitting || closed) return;
  const selection = scaledSelection(points, innerWidth, innerHeight, image.naturalWidth, image.naturalHeight); if (!selection) return;
  submitting = true; search.disabled = true; redraw.disabled = true; state('submitting'); hint.textContent = 'Opening Lens…';
  const crop = document.createElement('canvas'), b = selection.bounds; crop.width = b.width; crop.height = b.height;
  try {
    const c = crop.getContext('2d');
    // Pixels outside the actual cursor outline are transparent; no rectangular screen context is uploaded.
    tracePath(c, selection.points, b.x, b.y); c.clip('evenodd'); c.drawImage(image, -b.x, -b.y);
    const blob = await new Promise(resolve => crop.toBlob(resolve, 'image/png')); if (closed) return; if (!blob) throw Error('Could not prepare the selected area');
    if (blob.size > 8 * 1024 * 1024) throw Error('This selection is too large. Outline a smaller area.');
    const bytes = new Uint8Array(await blob.arrayBuffer()); if (closed) return; let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    await bridge.invoke('circle_search_submit', { session, png: btoa(binary) });
    closed = true; themeStop(); stopAccentPaint(); if (screenshot) URL.revokeObjectURL(screenshot); image.removeAttribute('src');
  } catch (error) { if (closed) return; submitting = false; state('ready'); search.disabled = false; redraw.disabled = false; hint.hidden = false; hint.textContent = String(error?.message ?? error); }
  finally { crop.width = crop.height = 1; }
}
search.addEventListener('click', submit);
window.addEventListener('resize', () => { if (!drawing) reset(); sizeCanvas(); });
window.addEventListener('pagehide', () => { closed = true; themeStop(); stopAccentPaint(); if (frame) cancelAnimationFrame(frame); if (screenshot) URL.revokeObjectURL(screenshot); }, { once: true });
async function init() {
  try {
    const ready = await bridge.invoke('circle_search_ready'); session = ready.session;
    const data = await bridge.invoke('circle_search_frame', { session }); if (closed) return;
    screenshot = URL.createObjectURL(new Blob([data instanceof ArrayBuffer ? data : new Uint8Array(data)], { type: 'image/png' }));
    image.src = screenshot; await image.decode(); if (closed) return;
    sizeCanvas(); reset(); await bridge.invoke('circle_search_show', { session });
  } catch (error) { hint.hidden = false; hint.textContent = String(error?.message ?? error); await cancel(); }
}
void init();
