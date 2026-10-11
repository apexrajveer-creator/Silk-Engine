// Spectral Terrain: a ridgeline plot of the music, in the manner of a famous pulsar chart.
// Every row is a snapshot of the spectrum a moment ago; rows slide slowly back into the distance and
// each one hides the rows behind it with a solid black fill, so the music piles up into mountains.
//
// One instanced draw, no per-frame geometry upload:
//   - instance 2k   : the black fill under row k's curve (hides everything behind it)
//   - instance 2k+1 : the hairline on top, a continuous antialiased ribbon (no gaps or double-covered joints)
// Instances are drawn back to front, so the painter's algorithm gives correct hidden-line removal.
// The history of rows is a small float texture (points x rows) that gains one row at a time.
//
// With no music playing it keeps producing pulsar-like bursts, so it is never a dead screen.
import { hexRGB } from '../../shared/catalog.js';
import { fitArea } from './util.js';

const VS = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uRows, uPts, uPhase, uBlockW, uTotalH, uYFront, uAmp, uPersp, uWidth, uFade;
uniform sampler2D uHist;           // R32F: x = point, y = row (0 = newest, at the front)
out float vSide; out float vAlpha; out float vH; flat out float vLine;

float hist(int row, int i) { return texelFetch(uHist, ivec2(clamp(i, 0, int(uPts) - 1), row), 0).r; }
float rowY(float d) { return uYFront + uTotalH * (d - 0.2 * uPersp * d * d) / (1.0 - 0.2 * uPersp); }
float rowX(float d, int i) { return (float(i) / (uPts - 1.0) - 0.5) * uBlockW * (1.0 - 0.34 * uPersp * d); }
vec2 curve(int row, float p, int i, out float h) {
  float d = clamp(p / uRows, 0.0, 1.0);
  h = hist(row, i);
  return vec2(rowX(d, i), rowY(d) + h * uAmp * (1.0 - 0.3 * uPersp * d));
}
void main() {
  int inst = gl_InstanceID, k = inst >> 1;
  bool isLine = (inst & 1) == 1;
  int row = int(uRows) - k;                         // oldest (back) first
  float p = float(row) + uPhase;                    // distance back, in rows
  int seg = gl_VertexID / 6, c = gl_VertexID % 6;
  bool second = (c == 2 || c == 3 || c == 5), high = (c == 1 || c == 4 || c == 5);
  int i = second ? seg + 1 : seg;
  float h; vec2 pc = curve(row, p, i, h);
  vec2 pos;
  if (!isLine) {
    float d = clamp(p / uRows, 0.0, 1.0);
    pos = high ? pc : vec2(pc.x, rowY(d));          // fill: baseline up to the curve
  } else {
    float h0, h1;
    vec2 pa = curve(row, p, max(i - 1, 0), h0), pb = curve(row, p, min(i + 1, int(uPts) - 1), h1);
    vec2 t = pb - pa; float l = length(t); t = l > 1e-4 ? t / l : vec2(1.0, 0.0);
    float half_ = uWidth * 0.5 + 0.75, s = high ? 1.0 : -1.0;
    pos = pc + vec2(-t.y, t.x) * s * half_;
    vSide = s * half_;
  }
  // rows fade in at the front and out at the back, so nothing ever pops
  float a = smoothstep(0.0, 1.0, p) * (1.0 - smoothstep(uRows - 1.0, uRows, p));
  vAlpha = isLine ? a * mix(1.0, 0.3, uFade * clamp(p / uRows, 0.0, 1.0)) : a;
  vH = h; vLine = isLine ? 1.0 : 0.0;
  gl_Position = vec4(pos / (uRes * 0.5), 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in float vSide; in float vAlpha; in float vH; flat in float vLine; out vec4 o;
uniform float uWidth, uTint; uniform vec3 uFront, uBack;
void main() {
  if (vLine < 0.5) { o = vec4(0.0, 0.0, 0.0, vAlpha); return; }       // solid black: hides the rows behind
  float cov = 1.0 - smoothstep(uWidth * 0.5 - 0.5, uWidth * 0.5 + 0.5, abs(vSide));   // antialiased hairline
  vec3 col = mix(uFront, mix(uBack, uFront, smoothstep(0.0, 0.75, vH)), uTint);       // peaks catch the light
  o = vec4(col, cov * vAlpha);
}`;

const P = 208;        // points per row
const RMAX = 130;     // rows kept (the Rows setting goes up to 110)
const MP = { eco: 2.1e6, balanced: 3.7e6, high: 8.4e6, ultra: 8.4e6 };   // lines want native resolution
const PALETTES = {
  white: ['#ffffff', '#8a8f99'], silver: ['#e6e9f0', '#555a66'], ice: ['#d8f1ff', '#3d6a8c'], blue: ['#5b8dff', '#16307a'],
  cobalt: ['#8fb6ff', '#16307a'], violet: ['#d9c2ff', '#4a2c7a'], cherry: ['#ffc2cf', '#7a1c33'], forest: ['#c8f5d2', '#1f5a33'],
  amber: ['#ffc46b', '#7a3a08'],
};
function hsv2rgb(h, s, v) {
  const f = n => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
}
const clamp01 = x => Math.min(1, Math.max(0, x));

export default class Terrain {
  constructor(g, settings) {
    this.g = g; this.prog = g.program('terrain', VS, FS);
    this.t = 30; this.phase = 0; this.kick = 0; this.agc = .3; this.hue = 0; this.seed = (Math.random() * 1e6) | 0;
    this.hist = new Float32Array(P * RMAX);
    this.setSettings(settings);
    // start with a full stack, so the first frame already looks finished
    for (let j = RMAX - 1; j >= 0; j--) this.hist.set(this.idleRow(this.t - j * .19), j * P);
    const gl = g.gl, tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, P, RMAX, 0, gl.RED, gl.FLOAT, this.hist);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.histTex = { tex };
  }
  setSettings(s) { this.s = s; }
  resize(w, h, q, wantMips) {
    const [sw, sh] = fitArea(w, h, MP[q] || MP.balanced);
    if (this.out && this.out.w === sw && this.out.h === sh && this.out.mips === wantMips) return;
    this.g.free(this.out);
    this.out = this.g.target(sw, sh, { format: 'rgb10', mips: wantMips });
  }

  // ---- row generation -------------------------------------------------------------------------------
  rnd() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }
  // A row is a quiet, slightly wobbling baseline with a handful of distinct triangular peaks. Where the peaks
  // land, and how tall they get, is what the callers decide (the music, or a drifting burst when it is silent).
  row(count, pick, kick) {
    const out = new Float32Array(P), wob = this.rnd() * 6.28, jag = .22 + this.s.roughness / 100 * .75;
    for (let i = 0; i < P; i++) out[i] = (.012 + .008 * Math.sin(i * .21 + wob)) * (.5 + this.rnd()) * taper(i / (P - 1) * 2 - 1);
    for (let k = 0; k < count; k++) {
      const [x, h] = pick(); if (h <= 0) continue;
      const c = Math.round((x + 1) / 2 * (P - 1)), hw = 2 + this.rnd() * 5 + Math.min(4, h * 3);
      const top = h * (1 + kick) * taper(x);
      for (let i = Math.max(0, Math.floor(c - hw)); i <= Math.min(P - 1, Math.ceil(c + hw)); i++) {
        const v = top * (1 - Math.abs(i - c) / hw) * (1 - jag / 2 + jag * this.rnd());   // ragged flanks (Roughness)
        if (v > out[i]) out[i] = v;
      }
    }
    return out;
  }
  // No music: a pulsar-like burst that breathes and wanders.
  idleRow(t) {
    const mirrored = this.s.layout !== 'spectrum';
    const breath = .5 + .5 * Math.sin(t * .31) * Math.sin(t * .113 + 1.3);
    const centre = (mirrored ? 0 : -.15) + .12 * Math.sin(t * .21), width = .2 + .06 * Math.sin(t * .17 + 1);
    return this.row(4 + Math.floor(this.rnd() * 5), () => {
      const x = centre + (this.rnd() + this.rnd() + this.rnd() - 1.5) * width * 1.9;
      return [Math.max(-1, Math.min(1, x)), (.18 + .82 * Math.pow(this.rnd(), 1.5)) * (.3 + .7 * breath)];
    }, 0);
  }
  // Music: peaks are drawn where the spectrum has energy and are as tall as it is, so loud passages build
  // big mountains and quiet ones shrink back. Lows sit in the middle (like the pulsar) or on the left.
  liveRow(bands, level, rough) {
    const mirrored = this.s.layout !== 'spectrum', n = bands.length;
    const env = x => {
      const f = mirrored ? Math.abs(x) : (x + 1) / 2, pos = Math.pow(f, .85) * (n - 1) * .9, lo = Math.floor(pos), fr = pos - lo;
      const raw = (bands[lo] || 0) * (1 - fr) + (bands[Math.min(n - 1, lo + 1)] || 0) * fr;
      return Math.pow(clamp01(raw / this.agc), 1.25);
    };
    const gain = .5 + this.s.height / 100 * .7;
    return this.row(4 + Math.round(level * 6) + Math.round(rough * 4), () => {
      for (let tries = 0; tries < 10; tries++) {                                  // pick a spot in proportion to its energy
        const x = this.rnd() * 2 - 1, e = env(x);
        if (this.rnd() < e) return [x, e * gain * (.45 + .75 * this.rnd())];
      }
      return [0, 0];
    }, this.kick * .5);
  }
  push(row) {
    this.hist.copyWithin(P, 0, (RMAX - 1) * P);
    this.hist.set(row, 0);
    const gl = this.g.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.histTex.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, P, RMAX, gl.RED, gl.FLOAT, this.hist);
  }

  update(dt, inp) {
    const s = this.s, a = inp.audio;
    if (!inp.motion) return false;
    dt = Math.min(dt, .1);
    this.t += dt;
    this.hue = (this.hue + dt * (.02 + (a.level || 0) * .12)) % 1;
    const live = s.react > 0 && a.t && performance.now() - a.t < 500 && a.level > .004 && Array.isArray(a.bands) && a.bands.length >= 16;
    if (live) {
      let mx = 1e-3; for (const v of a.bands) if (v > mx) mx = v;
      this.agc = Math.max(.05, mx, this.agc * Math.exp(-dt * .3));          // slow auto-gain: quiet and loud both fill the plot
      if (a.beat) this.kick = 1;
    }
    this.kick *= Math.exp(-dt * 5);
    this.phase += dt * 6 * s.speed / 100;
    let pushed = 0;
    while (this.phase >= 1 && pushed < RMAX) {
      this.phase -= 1; pushed++;
      this.push(live ? this.liveRow(a.bands, Math.min(1, a.level * 2), s.roughness / 100) : this.idleRow(this.t));
    }
    if (this.phase >= 1) this.phase = 0;
    return s.speed > 0;
  }

  render() {
    const g = this.g, gl = g.gl, s = this.s, W = this.out.w, H = this.out.h;
    const pal = s.palette === 'custom' ? [hexRGB(s.color), hexRGB(s.color).map(x => x * .35)]
      : s.palette === 'rgb' ? [hsv2rgb(this.hue, .8, 1), hsv2rgb((this.hue + .1) % 1, .85, .45)]
      : (PALETTES[s.palette] || PALETTES.white).map(hexRGB);
    const rows = Math.round(s.rows);
    g.bindTarget(this.out);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    g.use(this.prog, {
      uHist: this.histTex, uRes: [W, H], uRows: rows, uPts: P, uPhase: this.phase,
      uBlockW: W * (.35 + .65 * s.width / 100), uTotalH: H * .78, uYFront: -H * .42, uAmp: H * .22 * (.25 + s.height / 100 * .75),
      uPersp: s.perspective / 100, uFade: s.depthFade / 100, uWidth: (.9 + s.weight / 100 * 1.8) * Math.max(1, H / 1080),
      uTint: s.peakTint / 100, uFront: pal[0], uBack: pal[1],
    });
    gl.bindVertexArray(g.emptyVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, (P - 1) * 6, (rows + 1) * 2);
    gl.disable(gl.BLEND);
  }
  get output() { return this.out; }
  dispose() { this.g.free(this.out); this.g.gl.deleteTexture(this.histTex.tex); this.out = null; }
}
// flat at the edges of the block, like the original
function taper(x) { const a = Math.abs(x); return a < .78 ? 1 : Math.max(0, 1 - (a - .78) / .22) ** 1.5; }
