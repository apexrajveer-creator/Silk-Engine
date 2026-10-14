// Audio arrives from the Rust capture thread and goes straight into every scene's state. One NaN would poison the smoothed
// level for good (NaN feeds back into itself), and one absurd value can turn "plant this many gliders" into a loop of
// billions. So everything is made sane exactly once, here, before any scene sees it.
export const BANDS = 32;
const WAVE_MIN = 64, WAVE_MAX = 4096, WAVE_LIMIT = 16;

const unit = v => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const signed = v => (typeof v === 'number' && Number.isFinite(v) ? Math.min(WAVE_LIMIT, Math.max(-WAVE_LIMIT, v)) : 0);

/**
 * @returns {{bass:number, mid:number, treble:number, bands:number[]|null, wave:number[]|null}}
 *   bass, mid and treble are 0..1; bands is exactly 32 numbers 0..1 (or null if none were sent);
 *   wave is at most 4096 finite numbers (or null if there are fewer than 64).
 */
export function sanitizeAudio(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    bass: unit(o.bass), mid: unit(o.mid), treble: unit(o.treble),
    bands: Array.isArray(o.bands) ? Array.from({ length: BANDS }, (_, i) => unit(o.bands[i])) : null,
    wave: Array.isArray(o.wave) && o.wave.length >= WAVE_MIN ? o.wave.slice(0, WAVE_MAX).map(signed) : null,
  };
}
