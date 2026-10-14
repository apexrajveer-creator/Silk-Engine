import { bridge } from '../shared/bridge.js';
import { bindSurfaceTheme } from '../shared/surface-theme.js';
const stop = bindSurfaceTheme(bridge, document.documentElement.style);
const error = document.getElementById('error');
let layoutReady = false, layoutBusy = false, layoutAgain = false, disposed = false;
const viewportBounds = () => { const r = document.getElementById('lensViewport').getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; };
async function layout() {
  if (!layoutReady || disposed) return; if (layoutBusy) { layoutAgain = true; return; }
  layoutBusy = true;
  try { do { layoutAgain = false; await bridge.invoke('lens_layout', { bounds: viewportBounds() }); } while (layoutAgain && !disposed); }
  catch (e) { if (!disposed) { error.hidden = false; error.textContent = String(e?.message ?? e); } }
  finally { layoutBusy = false; }
}
const observer = 'ResizeObserver' in window ? new ResizeObserver(layout) : null; observer?.observe(document.getElementById('lensViewport'));
window.addEventListener('resize', layout);
async function control(action, button) {
  if (button?.disabled) return;
  if (button) button.disabled = true;
  try { await bridge.invoke('lens_control', { action }); error.hidden = true; }
  catch (e) { error.hidden = false; error.textContent = String(e?.message ?? e); }
  finally { if (button) button.disabled = false; }
}
for (const button of document.querySelectorAll('[data-action]')) button.addEventListener('click', () => control(button.dataset.action, button));
document.getElementById('titlebar').addEventListener('pointerdown', e => { if (e.button === 0 && !e.target.closest('button')) void control('drag'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); void control('close'); } });
window.addEventListener('pagehide', () => { disposed = true; observer?.disconnect(); stop(); }, { once: true });

// Hidden WebView2 can suspend animation frames, so readiness has a bounded layout fallback.
async function ready() {
  void document.body.offsetHeight;
  await new Promise(resolve => { const timer = setTimeout(resolve, 50); requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); })); });
  try { await bridge.invoke('lens_ready', { bounds: viewportBounds() }); layoutReady = true; }
  catch (e) { error.hidden = false; error.textContent = String(e?.message ?? e); }
}
void ready();
