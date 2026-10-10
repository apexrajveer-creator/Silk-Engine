// Single source of truth for every setting. Studio builds its controls from this;
// the renderer reads defaults from it. Adding a setting = adding one line here.

const pct = (key, label, value, extra = {}) => ({ key, label, type: 'slider', min: 0, max: 100, value, unit: '%', ...extra });

export const DISPLAY = [
  pct('brightness', 'Brightness', 100, { max: 150 }),
  pct('contrast', 'Contrast', 100, { min: 50, max: 150 }),
  pct('saturation', 'Saturation', 100, { max: 200 }),
  pct('warmth', 'Temperature', 0, { min: -100, unit: '' }),
  { key: 'oled', label: 'OLED mode', type: 'bool', value: false, hint: 'True blacks, emissive highlights and OLED-style colour on any panel.' },
  pct('oledStrength', 'OLED intensity', 70, { when: ['oled', true] }),
  pct('blackCrush', 'Black crush', 40, { when: ['oled', true], hint: 'How far near-black shadows fall to true #000.' }),
  { key: 'quality', label: 'Render quality', type: 'combo', value: 'auto', options: [['auto', 'Auto (adaptive)'], ['eco', 'Eco'], ['balanced', 'Balanced'], ['high', 'High'], ['ultra', 'Ultra (native)']] },
  { key: 'fps', label: 'Frame limit', type: 'combo', value: '30', options: [['24', '24 fps'], ['30', '30 fps'], ['60', '60 fps'], ['120', '120 fps'], ['144', '144 fps']] },
  pct('grain', 'Film grain', 25),
  pct('vignette', 'Vignette', 35),
  { key: 'clock', label: 'Clock overlay', type: 'bool', value: false },
  { key: 'clockFormat', label: 'Time format', type: 'combo', value: 'system', when: ['clock', true], options: [['system', 'System'], ['12', '12-hour'], ['24', '24-hour']] },
  { key: 'clockDate', label: 'Show date', type: 'bool', value: true, when: ['clock', true] },
  { key: 'clockPosition', label: 'Position', type: 'combo', value: 'bottom', when: ['clock', true], options: [['bottom', 'Bottom centre'], ['top', 'Top centre'], ['lower-left', 'Bottom left'], ['lower-right', 'Bottom right']] },
  pct('clockSize', 'Size', 100, { min: 50, max: 200, when: ['clock', true] }),
  pct('clockOpacity', 'Opacity', 100, { min: 10, when: ['clock', true] }),
  { key: 'stats' , label: 'Performance overlay', type: 'bool', value: false, hint: 'Shows frame rate, buffer sizes and estimated GPU memory on the wallpaper.' },
  { key: 'burnGuard', label: 'Burn-in guard (pixel shift)', type: 'bool', value: false, hint: 'For real OLED owners: overlays drift a few pixels every 2 minutes.' },
];

export const SYSTEM = [
  { key: 'pauseWhenCovered', label: 'Pause screens that are covered', type: 'bool', value: false, hint: 'A maximised or fullscreen window stops that monitor\u2019s wallpaper.' },
  { key: 'hibernate', label: 'Hibernate when every screen is covered', type: 'bool', value: false, hint: 'After 10 s, GPU buffers and decoders are freed and the renderer is frozen.' },
  { key: 'battery', label: 'On battery', type: 'combo', value: 'eco', options: [['normal', 'Run normally'], ['eco', 'Eco: 24 fps, Eco quality'], ['pause', 'Pause wallpaper']] },
  { key: 'audio', label: 'React to system audio', type: 'bool', value: true },
  { key: 'interactive', label: 'React to the cursor on the desktop', type: 'bool', value: true },
  { key: 'startWithWindows', label: 'Start with Windows', type: 'bool', value: false },
  { key: 'themeSync', label: 'Match Windows accent colour to wallpaper', type: 'bool', value: false, hint: 'Start, taskbar highlights and title bars follow the wallpaper. Your own colour comes back when you turn this off.' },
];

// The ECHELON bird overlay, available on every wallpaper type.
const emblem = on => [
  { key: 'emblem', label: 'Show ECHELON bird', type: 'bool', value: on },
  { key: 'emblemSize', label: 'Bird size', type: 'slider', min: 10, max: 65, value: 38, unit: '%', when: ['emblem', true] },
  { key: 'emblemPos', label: 'Bird position', type: 'combo', value: 'center', when: ['emblem', true], options: [['center', 'Centre'], ['lower-right', 'Lower right'], ['lower-left', 'Lower left'], ['upper-right', 'Upper right'], ['upper-left', 'Upper left']] },
  { key: 'emblemOpacity', label: 'Bird opacity', type: 'slider', min: 10, max: 100, value: 100, unit: '%', when: ['emblem', true] },
];

const PALETTE = [['cobalt', 'Cobalt'], ['spectrum', 'Spectrum'], ['ember', 'Ember'], ['aurora', 'Aurora'], ['mono', 'Custom colour']];

export const SCENES = {
  silk: {
    thumb: 'assets/thumbs/silk.webp',
    name: 'Living Silk', tag: 'Shader', desc: 'The ECHELON silk weave, with an optional Icarus drift tunnel and the silver bird.',
    art: 'radial-gradient(120% 80% at 70% 20%,#3d7be0 0,#17479e 30%,#06122b 70%,#02050c)',
    settings: [
      { key: 'color', label: 'Silk colour', type: 'color', value: '#17479e' },
      { key: 'mode', label: 'Motion', type: 'combo', value: 'silk', options: [['silk', 'Flowing silk'], ['tunnel', 'Icarus drift']] },
      { key: 'speed', label: 'Speed', type: 'slider', min: 0, max: 200, value: 90, unit: '%' },
      { key: 'brightness', label: 'Brightness', type: 'slider', min: 15, max: 100, value: 72, unit: '%' },
      { key: 'bloom', label: 'Sheen', type: 'slider', min: 0, max: 120, value: 60, unit: '%' },
      ...emblem(false),
    ],
  },
  fluid: {
    thumb: 'assets/thumbs/fluid.webp',
    name: 'Fluid Ink', tag: 'Simulation', desc: 'Real-time Navier–Stokes fluid. Ink follows your cursor and bursts on the beat.',
    art: 'radial-gradient(60% 60% at 30% 40%,#ff3d7f 0,transparent 60%),radial-gradient(50% 60% at 70% 60%,#2bd2ff 0,transparent 60%),#05060c',
    settings: [
      { key: 'palette', label: 'Palette', type: 'combo', value: 'spectrum', options: PALETTE },
      { key: 'color', label: 'Custom colour', type: 'color', value: '#3a7bff', when: ['palette', 'mono'] },
      pct('swirl', 'Swirl (vorticity)', 45),
      pct('persistence', 'Ink persistence', 55),
      pct('flow', 'Flow persistence', 40),
      pct('splatSize', 'Splat size', 35),
      pct('ambient', 'Ambient splats', 40),
      pct('audioBurst', 'Beat bursts', 60),
      pct('shine', 'Shading', 60),
      ...emblem(false),
    ],
  },
  lissajous: {
    thumb: 'assets/thumbs/lissajous.webp',
    name: 'Harmonics', tag: 'Visualizer', desc: 'Music made visible: hundreds of hairline Lissajous strands folding like silk, or cymatics sand patterns. Reacts to your audio.',
    art: 'radial-gradient(40% 40% at 50% 50%,#2a3550,#050506 70%)',
    settings: [
      { key: 'mode', label: 'Mode', type: 'combo', value: 'cymatics', options: [['lissajous', 'Lissajous'], ['cymatics', 'Cymatics']] },
      { key: 'family', label: 'Shape', type: 'combo', value: 'silk', options: [['silk', 'Silk fold'], ['knot', 'Orbital knot'], ['bloom', 'Harmonic bloom'], ['veil', 'Ethereal veil'], ['cycle', 'Slowly cycle all']], when: ['mode', 'lissajous'] },
      pct('density', 'Strand density', 60, { when: ['mode', 'lissajous'] }),
      { key: 'plate', label: 'Plate', type: 'combo', value: 'circle', options: [['square', 'Full screen'], ['circle', 'Sphere']], when: ['mode', 'cymatics'] },
      pct('grain', 'Sand grain', 55, { when: ['mode', 'cymatics'] }),
      { key: 'palette', label: 'Colour', type: 'combo', value: 'blue', options: [['blue', 'Blue'], ['rgb', 'RGB (reacts to music)'], ['white', 'Pure white'], ['silver', 'Silver'], ['ice', 'Ice blue'], ['cobalt', 'Cobalt'], ['violet', 'Violet'], ['cherry', 'Cherry'], ['forest', 'Forest'], ['amber', 'Amber'], ['custom', 'Custom colour']] },
      { key: 'color', label: 'Custom colour', type: 'color', value: '#8fb6ff', when: ['palette', 'custom'] },
      { key: 'speed', label: 'Motion', type: 'slider', min: 0, max: 200, value: 70, unit: '%' },
      pct('thickness', 'Line weight', 30),
      pct('glow', 'Glow', 45),
      pct('persistence', 'Phosphor trail', 35),
      pct('react', 'Audio response', 70),
      pct('stars', 'Stars & nebula', 70),
      pct('halftone', 'Halftone background', 20),
      { key: 'brightness', label: 'Brightness', type: 'slider', min: 20, max: 100, value: 95, unit: '%' },
      ...emblem(false),
    ],
  },
  particles: {
    thumb: 'assets/thumbs/particles.webp',
    name: 'Flow Field', tag: 'Simulation', desc: 'Up to a million GPU particles riding curl noise, leaving 16-bit light trails.',
    art: 'repeating-linear-gradient(115deg,transparent 0 9px,#ffb34755 10px,transparent 12px),radial-gradient(80% 80% at 50% 50%,#3a1a05,#020203)',
    settings: [
      { key: 'count', label: 'Particles', type: 'combo', value: '262144', options: [['16384', '16 K'], ['65536', '65 K'], ['262144', '262 K'], ['1048576', '1 M']] },
      { key: 'palette', label: 'Palette', type: 'combo', value: 'ember', options: PALETTE },
      { key: 'color', label: 'Custom colour', type: 'color', value: '#ffb347', when: ['palette', 'mono'] },
      { key: 'speed', label: 'Speed', type: 'slider', min: 0, max: 200, value: 80, unit: '%' },
      pct('trail', 'Trail length', 70),
      pct('scale', 'Flow scale', 45),
      pct('glow', 'Brightness', 55),
      pct('cursor', 'Cursor gravity', 50),
      ...emblem(false),
    ],
  },
};

export const MEDIA = {
  video: [
    { key: 'fit', label: 'Fit', type: 'combo', value: 'cover', options: [['cover', 'Fill screen'], ['contain', 'Show whole frame'], ['stretch', 'Stretch']] },
    { key: 'speed', label: 'Playback speed', type: 'slider', min: 25, max: 200, value: 100, unit: '%' },
    { key: 'brightness', label: 'Brightness', type: 'slider', min: 20, max: 150, value: 100, unit: '%' },
    pct('glow', 'Highlight glow', 15),
    pct('sharpen', 'Detail sharpening', 20),
    ...emblem(false),
  ],
  image: [
    { key: 'fit', label: 'Fit', type: 'combo', value: 'cover', options: [['cover', 'Fill screen'], ['contain', 'Show whole frame'], ['stretch', 'Stretch']] },
    { key: 'speed', label: 'Animation speed', type: 'slider', min: 25, max: 200, value: 100, unit: '%' },
    { key: 'brightness', label: 'Brightness', type: 'slider', min: 20, max: 150, value: 100, unit: '%' },
    pct('glow', 'Highlight glow', 10),
    pct('sharpen', 'Detail sharpening', 15),
    ...emblem(false),
  ],
  web: [
    { key: 'interactive', label: 'Forward cursor to page', type: 'bool', value: true },
    ...emblem(false),
  ],
};

export function schemaFor(item) {
  if (!item) return [];
  if (item.kind === 'scene') return SCENES[item.scene]?.settings || [];
  return MEDIA[item.kind] || [];
}

export function defaults(schema) {
  const o = {};
  for (const s of schema) o[s.key] = s.value;
  return o;
}

export function resolved(schema, values) {
  const result = defaults(schema);
  for (const s of schema) {
    const value = values?.[s.key];
    if (s.type === 'slider' && typeof value === 'number' && Number.isFinite(value)) result[s.key] = Math.max(s.min, Math.min(s.max, value));
    else if (s.type === 'bool' && typeof value === 'boolean') result[s.key] = value;
    else if (s.type === 'combo' && s.options.some(([v]) => v === value)) result[s.key] = value;
    else if (s.type === 'color' && typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) result[s.key] = value;
  }
  return result;
}

export function visible(s, values) {
  if (!s.when) return true;
  return values[s.when[0]] === s.when[1];
}

export const PALETTES = {
  cobalt: ['#17479e', '#3d7be0', '#9cc2ff', '#e6eeff'],
  spectrum: null, // random hues
  ember: ['#ff5e1a', '#ffb347', '#ffd98a', '#ff2d55'],
  aurora: ['#2bffb1', '#29c7ff', '#7a5cff', '#c2ff4d'],
};

export function hexRGB(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(h || '');
  if (!m) return [1, 1, 1];
  const n = parseInt(m[1], 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

export function hsv(h, s, v) {
  const f = n => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
}

/** Pick a colour for splats/particles from a palette setting. */
export function paletteColor(name, custom, t = Math.random()) {
  if (name === 'mono') {
    const c = hexRGB(custom);
    const k = 0.6 + 0.8 * t;
    return c.map(x => Math.min(1, x * k));
  }
  const p = PALETTES[name];
  if (!p) return hsv(t, 0.85, 1);
  return hexRGB(p[Math.floor(t * p.length) % p.length]);
}
