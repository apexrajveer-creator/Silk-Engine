// Shared by the Island and screen-search overlay. Derived from the accent actually applied to Windows.
const FALLBACK = '#344d78';
const hex = rgb => '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const mix = (rgb, target, amount) => rgb.map(v => Math.round(v + (target - v) * amount));
export function surfacePalette(color) {
  const base = /^#[0-9a-f]{6}$/i.test(color ?? '') ? color.toLowerCase() : FALLBACK;
  const rgb = [1, 3, 5].map(i => parseInt(base.slice(i, i + 2), 16));
  const bright = mix(rgb, 255, .42), soft = mix(rgb, 255, .62);
  return { base, rgb: rgb.join(','), glow: bright.join(','), bright: hex(bright), soft: hex(soft), top: mix(rgb, 16, .72).join(','), bottom: mix(rgb, 9, .84).join(',') };
}
export function applySurfaceTheme(style, color) {
  const p = surfacePalette(color);
  for (const [key, value] of Object.entries({ '--accent': p.base, '--accent-rgb': p.rgb, '--accent-glow': p.glow, '--accent-bright': p.bright, '--accent-soft': p.soft, '--surface-top': p.top, '--surface-bottom': p.bottom })) style.setProperty(key, value);
  return p;
}
export function bindSurfaceTheme(bridge, style, listen = bridge.listen.bind(bridge)) {
  let revision = 0, disposed = false;
  style.setProperty('--theme-duration', '0ms');
  applySurfaceTheme(style, null);
  const stop = listen('accent-applied', color => { ++revision; if (!disposed) { style.setProperty('--theme-duration', '220ms'); applySurfaceTheme(style, color); } });
  const token = revision;
  bridge.invoke('get_surface_accent').then(color => { if (!disposed && token === revision) applySurfaceTheme(style, color); }).catch(() => {});
  return () => { disposed = true; stop?.(); };
}
