// The island's interface logic as pure functions (no DOM, no backend), so it can be unit-tested.
// tests/island-model.test.mjs covers every function here.

export const TABS = [
  { id: 'quick', label: 'Quick' },
  { id: 'clipboard', label: 'Clipboard' },
  { id: 'system', label: 'System' },
  { id: 'apps', label: 'Apps' },
  { id: 'wallpapers', label: 'Wallpapers' },
  { id: 'power', label: 'Power' },
];

/** The tab `dir` steps from `id` (-1 left, +1 right), wrapping around. An unknown id counts as the first tab. */
export function nextTab(id, dir) {
  const n = TABS.length, i = Math.max(0, TABS.findIndex(t => t.id === id));
  const step = Number.isFinite(dir) ? Math.trunc(dir) : 0;
  return TABS[(((i + step) % n) + n) % n].id;
}

/** A percentage 0..100, or null when there is no usable reading. */
export function clampPct(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean' || typeof v === 'object' || typeof v === 'function') return null;   // [] and {} would coerce to 0
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
}

/** A rolling window of readings: appends, and keeps only the newest `max`. */
export function pushSample(list, value, max = 60) {
  const next = [...list, value];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** An SVG path for a small line chart. Missing readings repeat the previous one, so a hiccup is a flat step, not a hole. */
export function sparkline(values, w = 120, h = 32, max = 100) {
  const pts = [];
  let last = 0;
  for (const v of values) {
    const p = clampPct(v);
    last = p === null ? last : p;
    pts.push(last);
  }
  if (pts.length < 2 || !(max > 0)) return '';
  return pts.map((v, i) => `${i ? 'L' : 'M'}${(i / (pts.length - 1) * w).toFixed(1)} ${(h - Math.min(1, v / max) * h).toFixed(1)}`).join('');
}

/** "<1m", "12m", "1h 05m": how long an app has been used. */
export function fmtDuration(seconds) {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  if (s < 60) return '<1m';
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** "now", "42s", "5m", "3h", "2d": how long ago something was copied. */
export function fmtAge(seconds) {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  if (s < 5) return 'now';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const GB = 2 ** 30;
/** "7.4 GB", or a dash when unknown. */
export function fmtGb(bytes) {
  return Number.isFinite(bytes) && bytes >= 0 ? `${(bytes / GB).toFixed(1)} GB` : '\u2014';
}

/** Memory in use, from the totals Windows reports. */
export function memoryUse(total, avail) {
  if (!Number.isFinite(total) || !Number.isFinite(avail) || total <= 0 || avail < 0) return null;
  const used = Math.max(0, total - Math.min(avail, total));
  return { used, total, pct: used / total * 100 };
}

/** A stable letter and hue for an app that has no icon here. */
export function monogram(name) {
  const text = String(name ?? '').trim();
  const m = /[\p{L}\p{N}]/u.exec(text);
  let hue = 0;
  for (const ch of text) hue = (hue * 31 + ch.codePointAt(0)) % 360;
  return { letter: m ? m[0].toUpperCase() : '?', hue };
}

/** What the peek bar shows: the time and the two live readings. */
export function peekText(metrics, now = new Date()) {
  const p = n => String(n).padStart(2, '0');
  const pct = v => { const c = clampPct(v); return c === null ? '--' : `${Math.round(c)}%`; };
  return { time: `${p(now.getHours())}:${p(now.getMinutes())}`, cpu: pct(metrics?.cpu), ram: pct(metrics?.ram) };
}

/** Which of the quick tiles are usable, on or off. `null` from the backend means "this PC has no such thing". */
export function describeQuick(q) {
  const tri = v => (v === null || v === undefined ? 'unavailable' : v ? 'on' : 'off');
  return { wifi: tri(q?.wifi), bluetooth: tri(q?.bluetooth), mute: q?.muted === null || q?.muted === undefined ? 'unavailable' : q.muted ? 'on' : 'off' };
}

/** 0 muted, 1 quiet, 2 medium, 3 loud: which speaker icon to draw. */
export function volumeLevel(volume, muted) {
  const v = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0;
  if (muted || v === 0) return 0;
  return v < .34 ? 1 : v < .67 ? 2 : 3;
}

export const DESTRUCTIVE = new Set(['signout', 'restart', 'shutdown']);

/**
 * The double-tap rule for the Power tab. Anything that ends your session needs a second tap on the same button within
 * `windowMs`; a tap on a different button re-arms that one instead; harmless actions go straight through.
 * Returns the new state and whether to perform the action now.
 */
export function powerStep(prev, action, now, windowMs = 3000) {
  if (!DESTRUCTIVE.has(action)) return { armed: null, at: 0, perform: true };
  if (prev && prev.armed === action && now - prev.at >= 0 && now - prev.at <= windowMs) return { armed: null, at: 0, perform: true };
  return { armed: action, at: now, perform: false };
}

/** Is the arming still valid at `now`? (the button shows "Tap again" only while it is) */
export function stillArmed(state, now, windowMs = 3000) {
  return !!state?.armed && now - state.at >= 0 && now - state.at <= windowMs;
}

/** The peek bar in a browser preview wakes when the cursor rests in the top-centre; this mirrors island.rs's zone. */
export function inPreviewZone(x, y, width) {
  return y <= 2 && Math.abs(x - width / 2) <= 150;
}

// ---------------------------------------------------------------- the media card
/** "0:42", "3:05", "1:02:03". */
export function fmtClock(seconds) {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60, p = n => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
}

/**
 * Where the track is now. The app reports a position now and then; between reports the card moves it on by the time that has
 * passed since (only while playing), and keeps it inside the track (a live stream, with no length, only has a lower bound).
 */
export function livePosition(media, elapsedMs) {
  if (!media?.active) return 0;
  const base = Number.isFinite(media.position) ? Math.max(0, media.position) : 0;
  const moved = media.status === 'playing' && Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs / 1000 : 0;
  const p = base + moved;
  return media.duration > 0 ? Math.min(p, media.duration) : p;
}

/** The share of the track played, 0..100 (0 for a live stream). */
export function progressPct(position, duration) {
  return duration > 0 && Number.isFinite(position) ? Math.min(100, Math.max(0, position / duration * 100)) : 0;
}

/** 'none' (nothing open), 'playing' or 'paused' (stopped counts as paused: the play button starts it). */
export function mediaMode(media) {
  if (!media?.active) return 'none';
  return media.status === 'playing' ? 'playing' : 'paused';
}

/** The three lines of text on the card. Something is always shown for the title, so the card never looks broken. */
export function mediaLines(media) {
  if (!media?.active) return { title: 'Nothing playing', subtitle: 'Play something and it will appear here', source: '' };
  return { title: media.title || 'Unknown title', subtitle: media.artist || media.album || '', source: media.app || '' };
}
