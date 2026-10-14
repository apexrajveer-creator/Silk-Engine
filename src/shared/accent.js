// Pick a Windows accent colour from a small RGBA sample of the wallpaper.
// Colourful areas vote by hue, weighted by saturation and brightness, so a large blue silk wins
// over a few red pixels, and black/grey areas don't vote at all. The winner is then nudged into a
// range Windows can use legibly (never neon, never muddy). Greyscale wallpapers get a neutral slate.
const BINS = 24;

function hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h * 60) + 360) % 360, mx ? d / mx : 0, mx];
}
function rgb(h, s, v) {
  const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
}
const hex = c => '#' + c.map(x => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('');

/** @param data RGBA bytes (e.g. ImageData.data). Returns "#rrggbb". */
export function accentFrom(data) {
  const w = new Float64Array(BINS), sr = new Float64Array(BINS), sg = new Float64Array(BINS), sb = new Float64Array(BINS);
  let total = 0, lum = 0, n = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const [h, s, v] = hsv(r, g, b);
    lum += v; n++;
    if (v < 0.08 || s < 0.12) continue;           // black and grey don't vote
    const k = Math.pow(s, 1.5) * v, bin = Math.floor(h / 360 * BINS) % BINS;
    w[bin] += k; sr[bin] += r * k; sg[bin] += g * k; sb[bin] += b * k; total += k;
  }
  if (!n) return '#5b6474';
  if (total < n * 0.004) {                         // effectively greyscale
    const v = 0.38 + 0.18 * Math.min(1, lum / n * 2);
    return hex(rgb(220, 0.14, v));
  }
  let best = 0, score = -1;
  for (let i = 0; i < BINS; i++) {
    const s = w[i] + 0.5 * (w[(i + BINS - 1) % BINS] + w[(i + 1) % BINS]);
    if (s > score) { score = s; best = i; }
  }
  let r = 0, g = 0, b = 0, k = 0;
  for (const j of [(best + BINS - 1) % BINS, best, (best + 1) % BINS]) { r += sr[j]; g += sg[j]; b += sb[j]; k += w[j]; }
  const [h, s, v] = hsv(r / k, g / k, b / k);
  return hex(rgb(h, Math.min(0.9, Math.max(0.38, s)), Math.min(0.86, Math.max(0.5, v))));
}

// ---- RGB colour modes
// Some wallpapers have an "RGB" palette that cycles through every hue. Chasing that with the Windows accent would
// flash the taskbar through the rainbow and hit the registry (plus a system-wide broadcast) over and over, so while a
// wallpaper is in RGB mode the accent is pinned to a dark neutral: the taskbar and Start go black / dark grey and stay put.
export const RGB_MODE_ACCENT = '#1b1b1d';
export const isRgbMode = (item, settings) => item?.kind === 'scene' && settings?.palette === 'rgb';

/**
 * The accent to apply for a wallpaper. `readSample` is only called when it is needed, so RGB mode skips reading pixels.
 * @param item     the wallpaper item ({ kind, scene, ... })
 * @param settings its resolved settings
 * @param readSample () => RGBA bytes of a small sample of the picture
 */
export function accentFor(item, settings, readSample) {
  return isRgbMode(item, settings) ? RGB_MODE_ACCENT : accentFrom(readSample());
}
