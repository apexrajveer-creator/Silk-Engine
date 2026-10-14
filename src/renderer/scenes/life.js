// Cell Garden: Conway's Game of Life (and a few cousins) as an arcade cabinet that is also a film shot.
//
// The simulation
//   One ping-pong grid at cell resolution, one fragment pass per generation, a fixed number of generations per
//   second whatever the frame rate. Each cell stores its state, its age and an afterglow.
//   Between generations the picture cross-fades previous -> current, so births brighten and deaths fade out
//   instead of flickering: that interpolation is what turns a grid of squares into flowing light.
//
// The look
//   Chunky square pixels, LED tiles or round dots over a faintly lit dead grid; newborn cells flash white-hot and cool
//   into a settled colour; afterglow trails behind dead cells. A tight bloom, a wide bloom and a horizontal anamorphic
//   streak (all computed at cell resolution, so they cost almost nothing) are laid over the crisp pixels, then CRT
//   scanlines, a vignette and a slow camera drift with a small punch on the bass.
//
// The gardener
//   Music plants things: beats launch glider volleys, onsets plant famous long-lived patterns, treble scatters sparks, the
//   cursor paints. Silence never kills it: a once-a-second health check replants anything that has died or stopped.
//   Every injection is mirrored when symmetry is on, and since the rules are symmetric the whole garden stays a mandala.
import { hexRGB } from '../../shared/catalog.js';
import { fitArea } from './util.js';

// ------------------------------------------------------------------------------------------ rules & patterns
export const RULES = {
  life: { b: [3], s: [2, 3] },                 // Conway
  highlife: { b: [3, 6], s: [2, 3] },          // adds a replicator
  daynight: { b: [3, 6, 7, 8], s: [3, 4, 6, 7, 8] },
  seeds: { b: [2], s: [] },                    // every cell lives one generation: explosive
  coral: { b: [3], s: [4, 5, 6, 7, 8] },       // slow, branching growth
  brain: { brain: true, b: [2], s: [] },       // Brian's Brain: on -> dying -> off; sparks that stream like neurons
};
const mask = list => list.reduce((m, n) => m | (1 << n), 0);

// Rows are drawn top to bottom, exactly as they appear on screen.
export const PATTERNS = {
  glider: ['.X.', '..X', 'XXX'],                                          // travels down-right
  rpentomino: ['.XX', 'XX.', '.X.'],                                      // 1103 generations to settle
  acorn: ['.X.....', '...X...', 'XX..XXX'],                              // 5206 generations from 7 cells
  diehard: ['......X.', 'XX......', '.X...XXX'],                         // vanishes after 130 generations
  lwss: ['.XXXX', 'X...X', '....X', 'X..X.'],                            // lightweight spaceship
  gun: [                                                                  // Gosper glider gun: a glider every 30 generations
    '........................X...........',
    '......................X.X...........',
    '............XX......XX............XX',
    '...........X...X....XX............XX',
    'XX........X.....X...XX..............',
    'XX........X...X.XX....X.X...........',
    '..........X.....X.......X...........',
    '...........X...X....................',
    '............XX......................'],
};
/** Cells of a pattern as [x, y] with y pointing up (like the grid), optionally mirrored. */
export function cells(rows, flipX = false, flipY = false) {
  const h = rows.length, w = rows[0].length, out = [];
  rows.forEach((row, r) => [...row].forEach((ch, c) => {
    if (ch !== 'X') return;
    out.push([flipX ? w - 1 - c : c, flipY ? r : h - 1 - r]);
  }));
  return out;
}
// the four glider headings: the direction each travels in grid coordinates (y up), and how to flip the base pattern
export const GLIDERS = [
  { dx: 1, dy: -1, fx: false, fy: false }, { dx: -1, dy: -1, fx: true, fy: false },
  { dx: 1, dy: 1, fx: false, fy: true }, { dx: -1, dy: 1, fx: true, fy: true },
];

// ------------------------------------------------------------------------------------------ shaders
const VS = `#version 300 es
in vec2 p; out vec2 vUv;
void main(){ vUv = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }`;

// one generation. R = state (0 off, .5 dying, 1 alive), G = age in generations / 255, B = afterglow
const STEP_FS = `#version 300 es
precision highp float; precision highp int;
out vec4 o;
uniform sampler2D uState, uSeed;
uniform vec2 uSize;
uniform float uBirth, uSurvive, uBrain, uWrap, uSeedOn, uTrail;
int alive(ivec2 p) {
  ivec2 s = ivec2(uSize);
  if (uWrap > .5) p = (p + s) % s; else if (p.x < 0 || p.y < 0 || p.x >= s.x || p.y >= s.y) return 0;
  return texelFetch(uState, p, 0).r > .75 ? 1 : 0;      // only fully-on cells count (Brian's Brain: dying cells do not)
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 me = texelFetch(uState, p, 0);
  int n = alive(p + ivec2(-1, -1)) + alive(p + ivec2(0, -1)) + alive(p + ivec2(1, -1)) + alive(p + ivec2(-1, 0))
        + alive(p + ivec2(1, 0)) + alive(p + ivec2(-1, 1)) + alive(p + ivec2(0, 1)) + alive(p + ivec2(1, 1));
  float st = me.r, next;
  if (uBrain > .5) {
    if (st > .75) next = .5;                              // on -> dying
    else if (st > .25) next = 0.;                         // dying -> off
    else next = (n == 2) ? 1. : 0.;                       // off -> on with exactly two neighbours on
  } else {
    int bits = (st > .75) ? int(uSurvive + .5) : int(uBirth + .5);
    next = (((bits >> n) & 1) == 1) ? 1. : 0.;
  }
  if (uSeedOn > .5 && texelFetch(uSeed, p, 0).r > .5) next = 1.;       // cells planted by the gardener, the music or the cursor
  float age = next > .75 ? (st > .75 ? min(me.g + 1. / 255., 1.) : 0.) : 0.;
  float trail = next > .75 ? 1. : (next > .25 ? .9 : me.b * uTrail);
  o = vec4(next, age, trail, 1.);
}`;

// colour every cell (HDR), cross-fading previous -> current generation
const LIGHT_FS = `#version 300 es
precision highp float; precision highp int;
out vec4 o;
uniform sampler2D uCur, uPrev;
uniform float uPhase, uAgeScale, uTrailAmt, uBrain;
uniform vec3 uGhost, uOld, uYoung, uFlash, uDying;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 c = texelFetch(uCur, p, 0), q = texelFetch(uPrev, p, 0);
  float t = smoothstep(0., 1., uPhase);
  float a = mix(q.r, c.r, t);                              // births brighten and deaths fade across the tick
  float age = c.g * 255.;
  vec3 col;
  if (uBrain > .5) {
    float on = smoothstep(.55, 1., a), dying = smoothstep(.1, .5, a) * (1. - on);
    col = on * (uYoung * .55 + uFlash * .6) + dying * uDying * .8;
  } else {
    float live = smoothstep(.05, 1., a);
    col = (mix(uYoung, uOld, smoothstep(2., uAgeScale, age)) + uFlash * exp(-age * .8)) * live;   // white-hot at birth, cooling to settled
  }
  float ghost = max(mix(q.b, c.b, t) - a, 0.);             // afterglow of cells that have just died
  col += uGhost * ghost * uTrailAmt;
  o = vec4(col, 1.);
}`;

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform vec2 uDir;               // direction in texels of the SOURCE
void main() {
  vec3 s = texture(uTex, vUv).rgb * .2270270;
  s += (texture(uTex, vUv + uDir * 1.3846).rgb + texture(uTex, vUv - uDir * 1.3846).rgb) * .3162162;
  s += (texture(uTex, vUv + uDir * 3.2308).rgb + texture(uTex, vUv - uDir * 3.2308).rgb) * .0702703;
  o = vec4(s, 1.);
}`;

// an anamorphic lens streak: a long horizontal smear, strongest from the brightest cells
const STREAK_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform vec2 uStep;
void main() {
  vec3 s = vec3(0.); float wsum = 0.;
  for (int i = -14; i <= 14; i++) {
    float w = exp(-abs(float(i)) * .17);
    vec3 v = texture(uTex, vUv + uStep * float(i)).rgb;
    s += v * w * smoothstep(.25, 1.2, max(v.r, max(v.g, v.b)));        // only highlights streak
    wsum += w;
  }
  o = vec4(s / wsum, 1.);
}`;

const COMPOSITE_FS = `#version 300 es
precision highp float; precision highp int;
in vec2 vUv; out vec4 o;
uniform sampler2D uLight, uBloom, uWide, uStreak;
uniform vec2 uRes, uGrid;
uniform vec3 uCam, uGhost;                                // zoom, pan px
uniform float uCell, uGlow, uStreakAmt, uCrt, uUnlit, uShape, uBright, uHud, uGen, uPop, uPunch;

// 3x5 pixel font for the arcade readout: digits, then G E N P O
int glyph(int ch) {
  switch (ch) {
    case 0: return 0x7B6F; case 1: return 0x2C97; case 2: return 0x73E7; case 3: return 0x73CF; case 4: return 0x5BC9;
    case 5: return 0x79CF; case 6: return 0x79EF; case 7: return 0x7249; case 8: return 0x7BEF; case 9: return 0x7BCF;
    case 10: return 0x796F; case 11: return 0x79E7; case 12: return 0x7B6D; case 13: return 0x7BE4; case 14: return 0x7B6F;
  }
  return 0;
}
float hudLine(vec2 frag, vec2 origin, float px, int a, int b, int c, float value) {
  vec2 l = (frag - origin) / px;
  if (l.y < 0. || l.y >= 5. || l.x < 0.) return 0.;
  int slot = int(floor(l.x / 4.)); if (slot > 9) return 0.;
  float gx = floor(mod(l.x, 4.)); if (gx > 2.) return 0.;
  int ch = -1;
  if (slot == 0) ch = a; else if (slot == 1) ch = b; else if (slot == 2) ch = c;
  else if (slot >= 4) ch = int(mod(floor(value / pow(10., float(9 - slot))), 10.));
  if (ch < 0) return 0.;
  int row = 4 - int(floor(l.y));
  return float((glyph(ch) >> (14 - (row * 3 + int(gx)))) & 1);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 q = (frag - .5 * uRes) / uCam.x - uCam.yz;          // camera: slow drift and a punch on the bass
  vec2 gp = q / uCell + .5 * uGrid;
  vec2 cellId = floor(gp), f = fract(gp) - .5;
  bool inside = all(greaterThanEqual(cellId, vec2(0.))) && all(lessThan(cellId, uGrid));
  vec3 col = vec3(0.);
  if (inside) {
    // the pixel: square arcade tiles, rounded LED tiles or round dots
    float half_ = uShape < .5 ? .44 : (uShape < 1.5 ? .41 : .42), rad = uShape < .5 ? .04 : (uShape < 1.5 ? .2 : .42);
    vec2 d = abs(f) - (half_ - rad);
    float sd = length(max(d, 0.)) + min(max(d.x, d.y), 0.) - rad;
    float aa = fwidth(sd) * .75 + 1e-4, m = 1. - smoothstep(-aa, aa, sd);
    vec3 lit = texelFetch(uLight, ivec2(cellId), 0).rgb;
    col = (lit + uGhost * uUnlit * .12) * m;                // dead cells stay faintly visible, like an unlit LED matrix
  }
  vec2 guv = clamp(gp / uGrid, 0., 1.);
  vec2 dir = (guv - .5);
  vec3 wide = vec3(texture(uWide, guv + dir * .004).r, texture(uWide, guv).g, texture(uWide, guv - dir * .004).b);   // a touch of lens fringing
  col += texture(uBloom, guv).rgb * uGlow * 1.1 + wide * uGlow * .9;
  col += texture(uStreak, guv).rgb * uStreakAmt * (.6 + uPunch * .8) * vec3(.85, .95, 1.15);
  // CRT: scanlines, a soft triad shimmer and a heavier vignette
  float per = max(2., uCell * .5);
  float sl = .5 + .5 * cos(frag.y / per * 6.2831853);
  col *= 1. - uCrt * .38 * (1. - sl);
  vec2 sv = (vUv - .5) * vec2(uRes.x / uRes.y, 1.);
  float vig = smoothstep(1.35, .3, length(sv));
  col *= mix(1., vig, .45 + uCrt * .4);
  col = 1. - exp(-col * (1.15 + uPunch * .25));            // filmic shoulder: highlights roll off instead of clipping
  col *= uBright;
  if (uHud > .5) {                                         // arcade readout, top left: GEN 000123 / POP 004567
    float px = max(2., floor(uCell * .8)), mg = px * 5.;
    float on = max(hudLine(frag, vec2(mg, uRes.y - mg - 5. * px), px, 10, 11, 12, uGen),
                   hudLine(frag, vec2(mg, uRes.y - mg - 12. * px), px, 13, 14, 13, uPop));
    col = mix(col, uGhost * .5 + vec3(.55), on * .85);
  }
  o = vec4(col, 1.);
}`;

const MP = { eco: 2.1e6, balanced: 3.7e6, high: 8.4e6, ultra: 8.4e6 };       // crisp cells want native resolution
const PALETTES = {                                          // ghost, settled, young, flash, dying
  phosphor: ['#0a6a30', '#0f8a42', '#3dff8a', '#e8fff0', '#19a88f'],
  amber: ['#8a4200', '#b86400', '#ffb000', '#fff1c9', '#ff5a00'],
  arcade: ['#4a10a0', '#6a35e0', '#ff3fb4', '#b8fbff', '#1fd8ff'],
  gameboy: ['#2a6a2a', '#4f8420', '#9bbc0f', '#e4f78a', '#3a7040'],
  ember: ['#8a1c00', '#c9400c', '#ffa11f', '#fff6d0', '#b8260a'],
  ice: ['#0c5a90', '#1d86c8', '#59d3ff', '#ffffff', '#7a6aff'],
  echelon: ['#0c2e9a', '#1450d4', '#5b8dff', '#eaf2ff', '#a4c4ff'],
};
function hsv2rgb(h, s, v) {
  const f = n => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
}
const RES_SYM = { off: 0, mirror: 1, quad: 2 };

export default class Life {
  constructor(g, settings) {
    this.g = g;
    this.progs = {
      step: g.program('life-step', VS, STEP_FS), light: g.program('life-light', VS, LIGHT_FS), blur: g.program('life-blur', VS, BLUR_FS),
      streak: g.program('life-streak', VS, STREAK_FS), comp: g.program('life-comp', VS, COMPOSITE_FS),
    };
    this.t = 40; this.tick = 0; this.phase = 0; this.gen = 0; this.pop = 0; this.stale = 0; this.punch = 0; this.hue = 0;
    // (the timer is not called `health`: the renderer's heartbeat calls scene.health() on every scene)
    this.healthClock = 0; this.garden = 5; this.prevLevel = 0; this.beatCool = 0; this.onsetCool = 0; this.lastPaint = null;
    this.seed = (Math.random() * 1e9) | 0;
    this.setSettings(settings);
  }
  setSettings(s) {
    const old = this.s;
    this.s = s;
    // the rules, the edges and the symmetry change what a garden even is: start a fresh one
    if (old && (old.rule !== s.rule || old.symmetry !== s.symmetry || old.wrap !== s.wrap)) this.needsReset = true;
  }
  get rule() { return RULES[this.s.rule] || RULES.life; }

  // ---- GPU resources ------------------------------------------------------------------------------
  resize(w, h, q, wantMips) {
    const g = this.g, [sw, sh] = fitArea(w, h, MP[q] || MP.balanced);
    const cellPx = Math.max(2, Math.round(this.s.cell * Math.max(.5, sh / 1080)));
    const gw = Math.max(24, Math.ceil(sw / cellPx * 1.12)), gh = Math.max(24, Math.ceil(sh / cellPx * 1.12));   // a little overscan for the camera
    if (!this.out || this.out.w !== sw || this.out.h !== sh || this.out.mips !== wantMips) {
      g.free(this.out); this.out = g.target(sw, sh, { format: 'rgb10', mips: wantMips });
    }
    if (this.gw !== gw || this.gh !== gh || this.cellPx !== cellPx) { this.buildGrid(gw, gh); this.cellPx = cellPx; }
    this.outW = sw; this.outH = sh;
  }
  buildGrid(gw, gh) {
    const g = this.g;
    [this.ping, this.light, this.tmp, this.bloom, this.wTmp, this.wide, this.streak, this.seedTex].forEach(t => g.free(t));
    const hw = Math.max(8, Math.round(gw / 2)), hh = Math.max(8, Math.round(gh / 2));
    this.gw = gw; this.gh = gh;
    this.ping = g.pingpong(gw, gh, { format: 'rgba8', filter: 'nearest' });
    this.seedTex = g.texture(gw, gh, { format: 'rgba8', filter: 'nearest', data: new Uint8Array(gw * gh * 4) });
    this.light = g.target(gw, gh, { format: 'rgba16f' });
    this.tmp = g.target(gw, gh, { format: 'rgba16f' }); this.bloom = g.target(gw, gh, { format: 'rgba16f' });
    this.wTmp = g.target(hw, hh, { format: 'rgba16f' }); this.wide = g.target(hw, hh, { format: 'rgba16f' }); this.streak = g.target(hw, hh, { format: 'rgba16f' });
    this.seedBuf = new Uint8Array(gw * gh * 4); this.seedDirty = false; this.seedOn = 0;
    this.buf = new Uint8Array(gw * gh * 4); this.buf2 = new Uint8Array(gw * gh * 4);
    this.reset();
  }
  /** A fresh garden: a soup in the middle, a few famous seeds, then a short run-in so it starts life already grown. */
  reset() {
    const { gw, gh } = this, gl = this.g.gl;
    this.needsReset = false;
    const empty = new Uint8Array(gw * gh * 4);
    for (const t of [this.ping.read, this.ping.write]) { gl.bindTexture(gl.TEXTURE_2D, t.tex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gw, gh, gl.RGBA, gl.UNSIGNED_BYTE, empty); }
    this.seedBuf.fill(0);
    // an organic ellipse over most of the frame, thinning towards the edges (a soup that fills a shot, not a dot in the middle)
    const cx = gw / 2, cy = gh / 2, rx = gw * .44, ry = gh * .44;
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry), wob = .08 * Math.sin(x * .19) * Math.sin(y * .23);
      if (d + wob < 1 && this.rnd() < .12 + .22 * (1 - d)) this.plot(x, y);
    }
    for (let i = 0; i < 6; i++) this.put(this.pick(['rpentomino', 'acorn', 'diehard']), this.rint(gw * .12, gw * .88), this.rint(gh * .12, gh * .88));
    this.flushSeed(true);
    for (let i = 0; i < 120; i++) this.step();                // run-in: by the first frame the soup has settled into a garden
    this.phase = 0; this.gen = 0; this.stale = 0;
    this.checkHealth(true);
  }

  // ---- tiny deterministic-ish RNG and planting tools ------------------------------------------------
  rnd() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }
  rint(a, b) { return Math.floor(a + this.rnd() * (b - a)); }
  pick(list) { return list[Math.floor(this.rnd() * list.length)]; }
  /** Plant one cell, and its mirror images when symmetry is on. */
  plot(x, y) {
    const { gw, gh } = this, sym = RES_SYM[this.s.symmetry] || 0;
    if (this.s.wrap) { x = ((x % gw) + gw) % gw; y = ((y % gh) + gh) % gh; } else if (x < 0 || y < 0 || x >= gw || y >= gh) return;
    const set = (a, b) => { this.seedBuf[(b * gw + a) * 4] = 255; };
    set(x, y);
    if (sym >= 1) set(gw - 1 - x, y);
    if (sym >= 2) { set(x, gh - 1 - y); set(gw - 1 - x, gh - 1 - y); }
    this.seedDirty = true;
  }
  put(name, x, y, fx = false, fy = false) {
    const rows = PATTERNS[name];
    for (const [cx, cy] of cells(rows, fx, fy)) this.plot(x + cx, y + cy);
  }
  /** A volley of gliders entering from one edge and crossing the garden. */
  volley(n) {
    n = Math.min(8, Math.max(0, Math.floor(Number.isFinite(n) ? n : 0)));   // however loud, never more than a handful: a runaway value must not become a runaway loop
    const { gw, gh } = this, side = this.rint(0, 4), dirs = GLIDERS;
    // one heading per volley, pointing inward from the chosen edge: a tidy formation, not a pile-up
    const g = side < 2 ? dirs[side === 0 ? this.pick([0, 2]) : this.pick([1, 3])] : dirs[side === 2 ? this.pick([0, 1]) : this.pick([2, 3])];
    const along = side < 2 ? this.rint(gh * .12, gh * .88) : this.rint(gw * .12, gw * .88);   // picked once: the whole volley shares one line
    for (let i = 0; i < n; i++) {
      const slot = along + i * 7 - ((n * 7) >> 1);                                              // evenly spaced, so gliders never touch
      let x, y;
      if (side < 2) { x = side === 0 ? 6 : gw - 9; y = slot; }
      else { y = side === 2 ? gh - 10 : 6; x = slot; }
      this.put('glider', x, y, g.fx, g.fy);
    }
  }
  /** Sprinkle small random blobs (single cells would simply die). */
  sparks(n) {
    n = Math.min(8, Math.max(0, Math.floor(Number.isFinite(n) ? n : 0)));
    const { gw, gh } = this;
    for (let i = 0; i < n; i++) {
      const x = this.rint(4, gw - 4), y = this.rint(4, gh - 4);
      for (let k = 0; k < 5; k++) this.plot(x + this.rint(0, 3), y + this.rint(0, 3));
    }
  }
  paint(gx, gy, radius, density) {
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++)
      if (dx * dx + dy * dy <= radius * radius && this.rnd() < density) this.plot(gx + dx, gy + dy);
  }
  plantSomething(big = false) {
    const { gw, gh } = this, x = this.rint(gw * .2, gw * .8), y = this.rint(gh * .2, gh * .8), what = this.rnd();
    if (what < .3) this.put('rpentomino', x, y);
    else if (what < .52) this.put('acorn', x, y);
    else if (what < .66) this.put('diehard', x, y);
    else if (what < .8) this.volley(3 + this.rint(0, 3));
    else if (what < .9 || !big) this.put('lwss', x, y, this.rnd() < .5, this.rnd() < .5);
    else this.put('gun', x - 18, y);
  }

  // ---- stepping ---------------------------------------------------------------------------------
  flushSeed(force = false) {
    if (!this.seedDirty && !force) return;
    const gl = this.g.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.seedTex.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.gw, this.gh, gl.RGBA, gl.UNSIGNED_BYTE, this.seedBuf);
    this.seedBuf.fill(0); this.seedDirty = false; this.seedOn = 1;     // the next generation absorbs everything planted since the last one
  }
  step() {
    const g = this.g, r = this.rule, p = this.ping;
    this.flushSeed();
    g.bindTarget(p.write);
    g.use(this.progs.step, {
      uState: p.read, uSeed: this.seedTex, uSize: [this.gw, this.gh], uBirth: mask(r.b), uSurvive: mask(r.s), uBrain: r.brain ? 1 : 0,
      uWrap: this.s.wrap ? 1 : 0, uSeedOn: this.seedOn, uTrail: .78 + this.s.afterglow / 100 * .16,
    });
    g.draw();
    p.swap(); this.seedOn = 0; this.gen++;                     // read = the new generation, write = the one before it
  }
  /** Once a second: count what is alive and replant anything that has died out or frozen. */
  checkHealth(initial = false) {
    const gl = this.g.gl, { gw, gh } = this, total = gw * gh;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ping.read.fb); gl.readPixels(0, 0, gw, gh, gl.RGBA, gl.UNSIGNED_BYTE, this.buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ping.write.fb); gl.readPixels(0, 0, gw, gh, gl.RGBA, gl.UNSIGNED_BYTE, this.buf2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    let pop = 0, changed = 0;
    for (let i = 0; i < total * 4; i += 4) { const a = this.buf[i] > 191, b = this.buf2[i] > 191; if (a) pop++; if (a !== b) changed++; }
    this.pop = pop;
    this.stale = changed < Math.max(6, total * .00012) ? this.stale + 1 : 0;
    const dead = pop < total * .003;
    if (dead || pop < total * .006 || this.stale >= 3) {
      this.stale = 0;
      const n = dead ? 4 : 2;
      for (let i = 0; i < n; i++) this.plantSomething(dead);
      this.volley(2);
      if (dead) {                                               // nothing left at all: grow a fresh patch somewhere
        const x = this.rint(this.gw * .25, this.gw * .75), y = this.rint(this.gh * .25, this.gh * .75), rad = Math.min(gw, gh) * .12;
        for (let k = 0; k < rad * rad * 1.2; k++) this.plot(Math.round(x + (this.rnd() * 2 - 1) * rad), Math.round(y + (this.rnd() * 2 - 1) * rad));
      }
      if (initial) for (let i = 0; i < 60; i++) this.step();
    }
  }

  update(dt, inp) {
    const s = this.s, a = inp.audio || {}, ptr = inp.pointer || {};
    if (!inp.motion || !this.ping) return false;
    dt = Math.min(dt, .1);
    this.t += dt; this.hue = (this.hue + dt * (.03 + (a.level || 0) * .15)) % 1;
    if (this.needsReset) this.reset();
    const live = s.react > 0 && a.t && performance.now() - a.t < 500 && a.level > .004;
    const unit = v => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
    const level = live ? unit(a.level) : 0, treble = unit(a.treble), r = s.react / 100;

    // ---- the gardener
    this.beatCool -= dt; this.onsetCool -= dt; this.garden -= dt;
    if (live && a.beat && this.beatCool <= 0) { this.beatCool = .22; this.punch = 1; this.volley(1 + Math.round(level * 3 * r)); }
    if (live && level - this.prevLevel > .1 && this.onsetCool <= 0) { this.onsetCool = .9; this.plantSomething(level > .5); }
    if (live && treble > .25 && this.rnd() < dt * 5 * r) this.sparks(1 + Math.round(treble * 2));
    this.prevLevel = level;
    if (this.garden <= 0) { this.garden = 2.5 + this.rnd() * 3; if (!live || this.pop < this.gw * this.gh * .05) this.plantSomething(); }   // a quiet gardener plants something every few seconds
    this.punch *= Math.exp(-dt * 4.5);

    // ---- the cursor paints (hold to draw, click to plant a burst)
    if (s.brush && ptr.active && this.outW) {
      const cam = this.cam || { zoom: 1, px: 0, py: 0 };
      const fx = ptr.x * this.outW, fy = ptr.y * this.outH;
      const gx = Math.floor(((fx - .5 * this.outW) / cam.zoom - cam.px) / this.cellPx + .5 * this.gw);
      const gy = Math.floor(((fy - .5 * this.outH) / cam.zoom - cam.py) / this.cellPx + .5 * this.gh);
      const moved = !this.lastPaint || Math.abs(gx - this.lastPaint[0]) + Math.abs(gy - this.lastPaint[1]) >= 2;
      if (ptr.clicked) { this.put('acorn', gx - 3, gy - 1); for (const d of GLIDERS) this.put('glider', gx + d.dx * 9, gy + d.dy * 9, d.fx, d.fy); }   // a big bang: a seed and four gliders flying out
      else if (ptr.down && moved) this.paint(gx, gy, 3, .55);
      else if (moved && this.rnd() < .5) this.paint(gx, gy, 1, .7);        // a light trail where the cursor just was
      this.lastPaint = [gx, gy];
    } else this.lastPaint = null;

    // ---- time: a fixed number of generations per second
    const rate = 12 * s.speed / 100 * (1 + level * .6 * r);
    this.tick += dt * rate;
    let n = 0;
    while (this.tick >= 1 && n < 4) { this.tick -= 1; this.step(); n++; }
    if (this.tick >= 1) this.tick = 0;                          // we fell behind (a hitch): drop the surplus instead of racing to catch up
    this.phase = s.speed > 0 ? this.tick : 1;
    this.healthClock += dt;
    if (this.healthClock >= 1) { this.healthClock = 0; this.checkHealth(); }
    return true;
  }

  // ---- drawing ----------------------------------------------------------------------------------
  render() {
    const g = this.g, s = this.s, P = this.progs, { gw, gh } = this, cur = this.ping.read, prev = this.ping.write;
    const pal = s.palette === 'custom' ? [hexRGB(s.color).map(x => x * .5), hexRGB(s.color).map(x => x * .7), hexRGB(s.color), hexRGB(s.color).map(x => .55 + x * .45), hexRGB(s.color).map(x => x * .8)]
      : s.palette === 'rgb' ? [hsv2rgb((this.hue + .08) % 1, .9, .55), hsv2rgb((this.hue + .08) % 1, .85, .75), hsv2rgb(this.hue, .8, 1), [1, 1, 1], hsv2rgb((this.hue + .45) % 1, .8, .9)]
      : (PALETTES[s.palette] || PALETTES.phosphor).map(hexRGB);
    const brain = this.rule.brain ? 1 : 0;
    g.bindTarget(this.light);
    g.use(P.light, { uCur: cur, uPrev: prev, uPhase: this.phase, uAgeScale: 44, uTrailAmt: .25 + s.afterglow / 100 * 1.0, uBrain: brain,
      uGhost: pal[0], uOld: pal[1], uYoung: pal[2], uFlash: pal[3], uDying: pal[4] });
    g.draw();
    // bloom: tight (cell resolution) and wide (half resolution), plus the anamorphic streak
    g.bindTarget(this.tmp); g.use(P.blur, { uTex: this.light, uDir: [1 / gw, 0] }); g.draw();
    g.bindTarget(this.bloom); g.use(P.blur, { uTex: this.tmp, uDir: [0, 1 / gh] }); g.draw();
    g.bindTarget(this.wTmp); g.use(P.blur, { uTex: this.bloom, uDir: [3.2 / gw, 0] }); g.draw();
    g.bindTarget(this.wide); g.use(P.blur, { uTex: this.wTmp, uDir: [0, 3.2 / gh] }); g.draw();
    g.bindTarget(this.streak); g.use(P.streak, { uTex: this.bloom, uStep: [2.6 / gw, 0] }); g.draw();
    // the shot: a slow push-in with a little drift, and a small punch-in on the bass
    const c = s.camera / 100, t = this.t;
    const zoom = 1 + c * (.03 + .03 * Math.sin(t * .043)) + this.punch * .012 * Math.max(.3, c + .4);
    const px = c * (Math.sin(t * .027) * 2.4 + Math.sin(t * .071) * .8) * this.cellPx, py = c * Math.cos(t * .031) * 1.7 * this.cellPx;
    this.cam = { zoom, px, py };
    g.bindTarget(this.out);
    g.use(P.comp, {
      uLight: this.light, uBloom: this.bloom, uWide: this.wide, uStreak: this.streak, uRes: [this.outW, this.outH], uGrid: [gw, gh], uCam: [zoom, px, py],
      uGhost: pal[0], uCell: this.cellPx, uGlow: s.glow / 100, uStreakAmt: s.streaks / 100 * 1.3, uCrt: s.crt / 100, uUnlit: s.unlit / 100,
      uShape: s.shape === 'dot' ? 2 : s.shape === 'led' ? 1 : 0, uBright: s.brightness / 100, uHud: s.hud ? 1 : 0, uGen: this.gen % 1e6, uPop: Math.min(this.pop, 999999), uPunch: this.punch,
    });
    g.draw();
  }
  get output() { return this.out; }
  dispose() {
    const g = this.g;
    [this.out, this.ping, this.light, this.tmp, this.bloom, this.wTmp, this.wide, this.streak, this.seedTex].forEach(t => g.free(t));
    this.out = this.ping = null;
  }
}
