// What a simulation preview depends on. Pure, so it is unit-tested (tests/previews.test.cjs).
import { defaults, schemaFor } from './catalog.js';

export const PREVIEW_VERSION = 'p4';
export const PREVIEW_MAX_WIDTH = 960;   // a card never needs more; keeps every simulation step cheap
export const HERO_MAX_WIDTH = 2560;     // the full-width Library hero renders at its real size

/** A preset's own settings, without the bird overlay (an overlay never changes the render). */
export const sceneSettings = item => Object.fromEntries(Object.entries(item?.settings || {}).filter(([k]) => !k.startsWith('emblem')));

/** True when the bundled render (assets/thumbs) already shows exactly this preset. */
export function usesBundledRender(item) {
  const d = defaults(schemaFor(item));
  return Object.entries(sceneSettings(item)).every(([k, v]) => d[k] === v);
}

/** Cache identity of a rendered preview. The global display look is deliberately excluded:
 *  it is applied as a CSS filter, so Display sliders never re-run a simulation. */
export function previewKey(item, width, max = PREVIEW_MAX_WIDTH) {
  return JSON.stringify([PREVIEW_VERSION, item.scene, sceneSettings(item), Math.min(max, Math.round(width))]);
}

/** CSS filter approximating the display look on thumbnails. 'none' when neutral. */
export function lookFilter(display) {
  const d = display || {};
  const num = (v, f) => Number.isFinite(+v) ? +v : f;
  const os = d.oled ? num(d.oledStrength, 70) / 100 : 0;
  const b = num(d.brightness, 100) / 100 * (1 - os * .06), c = num(d.contrast, 100) / 100 * (1 + os * .28), s = num(d.saturation, 100) / 100 * (1 + os * .12);
  const w = num(d.warmth, 0), parts = [];
  if (Math.abs(b - 1) > .005) parts.push(`brightness(${b.toFixed(3)})`);
  if (Math.abs(c - 1) > .005) parts.push(`contrast(${c.toFixed(3)})`);
  if (Math.abs(s - 1) > .005) parts.push(`saturate(${s.toFixed(3)})`);
  if (w > 0) parts.push(`sepia(${(w / 400).toFixed(3)})`);
  else if (w < 0) parts.push(`hue-rotate(${(w * .12).toFixed(1)}deg)`);
  return parts.join(' ') || 'none';
}
