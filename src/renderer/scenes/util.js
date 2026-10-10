/** Scale (w,h) down so it covers at most `mp` pixels, keeping aspect. */
export function fitArea(w, h, mp) {
  const s = Math.min(1, Math.sqrt(mp / Math.max(1, w * h)));
  return [Math.max(8, Math.round(w * s)), Math.max(8, Math.round(h * s))];
}

/** Scale so the long side is at most `px`. */
export function fitLong(w, h, px) {
  const s = Math.min(1, px / Math.max(w, h));
  return [Math.max(8, Math.round(w * s)), Math.max(8, Math.round(h * s))];
}

export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
