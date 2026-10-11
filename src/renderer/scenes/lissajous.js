// Lissajous: a slowly turning 3D Lissajous figure drawn like an oscilloscope trace.
//   x = sin(a·t + δ), y = sin(b·t), z = sin(c·t + δ/2), rotated and seen in perspective.
// The curve is real geometry (thousands of thin quads built from gl_VertexID, no buffers), so it is
// sharp at any resolution. Each frame fades a 16-bit phosphor buffer a little and adds the new trace,
// so motion leaves soft trails that never band. A final pass lays the glow over a near-black
// background with a very subtle halftone dot pattern, at display resolution.
import { VS } from '../gl.js';
import { hexRGB } from '../../shared/catalog.js';
import { fitArea } from './util.js';

const LINE_VS = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uN, uA, uB, uC, uDelta, uRot, uTilt, uAmp, uCore, uGlow, uTime, uEcho;
uniform float uMode, uCount, uOffset, uGain; uniform sampler2D uWave; // uMode 1 = XY scope of the live waveform
out float vSide; out float vHalf; out float vDepth; out float vT; out float vEcho;
vec3 curve(float s) {
  float t = s * 6.2831853;
  float e = float(gl_InstanceID);                                       // 0 = main trace, 1-2 = echo strands
  float dl = uDelta + e * uEcho * (e == 1.0 ? 1.0 : -1.0);
  vec3 p = vec3(sin(uA * t + dl), sin(uB * t), sin(uC * t + dl * 0.5)) * uAmp * (1.0 - e * 0.012);
  float c = cos(uRot), sn = sin(uRot);
  p = vec3(c * p.x + sn * p.z, p.y, -sn * p.x + c * p.z);              // turn around the vertical axis
  float ct = cos(uTilt), st = sin(uTilt);
  return vec3(p.x, ct * p.y - st * p.z, st * p.y + ct * p.z);           // slight tilt
}
// smooth curve through the waveform samples (Catmull-Rom), so the trace has no corners at any size
float wav(int i) { return texelFetch(uWave, ivec2(clamp(i, 0, int(uCount) - 1), 0), 0).r; }
float wavAt(float u) {
  int i = int(floor(u)); float f = fract(u);
  float p0 = wav(i - 1), p1 = wav(i), p2 = wav(i + 1), p3 = wav(i + 2);
  return 0.5 * (2.0 * p1 + (-p0 + p2) * f + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * f * f + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * f * f * f);
}
// the synth's XY trick: each sample against the sample a quarter of the buffer later
vec3 scope(float s) {
  float u = s * (uCount - 1.0 - uOffset);
  vec2 xy = vec2(wavAt(u), wavAt(u + uOffset)) * uGain;
  float e = float(gl_InstanceID);
  return vec3(xy * (1.0 + e * 0.012), max(abs(xy.x), abs(xy.y)));          // z carries energy, not depth
}
vec2 project(vec3 p) {
  float k = 2.8 / (3.4 - p.z);                                          // gentle perspective
  float size = 0.36 * min(uRes.x, uRes.y);
  return p.xy * k * size;                                               // pixels from centre
}
void main() {
  int seg = gl_VertexID / 6, corner = gl_VertexID % 6;
  float s0 = float(seg) / uN, s1 = float(seg + 1) / uN;
  vec3 c0, c1; vec2 a, b;
  if (uMode > 0.5) {
    c0 = scope(s0); c1 = scope(s1);
    float size = 0.42 * min(uRes.x, uRes.y);
    a = c0.xy * size; b = c1.xy * size;
  } else {
    c0 = curve(s0); c1 = curve(s1);
    a = project(c0); b = project(c1);
  }
  vec2 dir = b - a; float len = length(dir); dir = len > 1e-4 ? dir / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float depth = uMode > 0.5 ? clamp(0.3 + 0.75 * mix(c0.z, c1.z, 0.5), 0.0, 1.0)    // scope: brighter where the signal is strong
                            : clamp(0.5 + 0.5 * mix(c0.z, c1.z, 0.5) / max(uAmp, 0.001), 0.0, 1.0);
  float half_ = (uCore * 0.5 + uGlow * 2.5) * mix(0.75, 1.15, depth) + 1.0;
  bool end = corner == 2 || corner == 3 || corner == 5;
  float side = (corner == 1 || corner == 4 || corner == 5) ? 1.0 : -1.0;
  vec2 pos = (end ? b : a) + nrm * side * half_ + dir * (end ? 0.5 : -0.5);
  vSide = side * half_; vHalf = half_; vDepth = depth; vT = end ? s1 : s0; vEcho = float(gl_InstanceID);
  gl_Position = vec4(pos / (uRes * 0.5), 0.0, 1.0);
}`;

// Silk: a family of hundreds of 3D Lissajous strands. Strand u (0..1) differs from its neighbour by a
// small phase step, so together they form ruled sheets that fold and twist like silk. Every strand is
// a hairline at very low opacity; overlaps accumulate into the luminous regions. One instanced draw:
// instance = strand, vertex = segment corner. Everything is evaluated here on the GPU.
const SILK_VS = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uM, uTime, uTurns, uA, uB, uC, uPhi, uSpread, uFold, uHarm, uWarp, uTreble, uAmp, uYaw, uPitch, uWidth;
uniform float uStrands;
uniform float uBands[32]; uniform float uRipA, uRipB, uBassE, uBeatE, uBandDrive;
out float vSide; out float vAlpha; out float vDepth;
// each strand of the sheet is an equaliser bar: strand u listens to its own slice of the spectrum
float bandAt(float u) { float x = clamp(u, 0.0, 1.0) * 31.0; int i = int(floor(x)); return mix(uBands[i], uBands[min(i + 1, 31)], fract(x)); }
float ripple(float u, float c) { float d = (u - c) * 6.0; return c < -0.5 ? 0.0 : exp(-d * d); }
vec3 P(float s, float u) {
  float t = s * 6.2831853 * uTurns, d = uPhi + u * uSpread;
  vec3 p = vec3(sin(uA * t + d) + uHarm * sin(2.0 * uA * t + d * 1.7 + uTime * 0.21),
                sin(uB * t + d * 0.6 + 1.3) + uHarm * 0.6 * sin(3.0 * uB * t - d + uTime * 0.17),
                sin(uC * t + d * 0.5 + u * uFold));
  p /= 1.0 + uHarm;
  float bd = bandAt(u) * uBandDrive, rp = ripple(u, uRipA) + ripple(u, uRipB);
  // spectrum ripples: loud bands push their strands into travelling waves; beats send a swell across the sheet
  float wv = sin(t * 3.0 - uTime * 2.2 + u * 14.0);
  p.z += (bd * 0.2 + rp * 0.26) * wv;
  p.x += (bd * 0.12 + rp * 0.10) * sin(t * 2.0 + uTime * 1.7 - u * 9.0);
  // smooth domain warp: folds the sheet without breaking it
  p.x += uWarp * sin(2.3 * p.y + uTime * 0.31 + u * 1.7);
  p.y += uWarp * cos(1.9 * p.x - uTime * 0.27);
  p.z += uWarp * 0.6 * sin(2.1 * p.x + 1.7 * p.y + uTime * 0.2);
  // treble: a fine shimmer along the filaments
  p.xy += uTreble * 0.01 * vec2(sin(t * 37.0 + uTime * 23.0 + u * 50.0), cos(t * 41.0 - uTime * 19.0 + u * 40.0));
  p *= uAmp;
  float cy = cos(uYaw), sy = sin(uYaw), cp = cos(uPitch), sp = sin(uPitch);
  p = vec3(cy * p.x + sy * p.z, p.y, -sy * p.x + cy * p.z);
  return vec3(p.x, cp * p.y - sp * p.z, sp * p.y + cp * p.z);
}
vec2 proj(vec3 p) { return p.xy * (2.6 / (3.4 - p.z)) * 0.44 * min(uRes.x, uRes.y); }   // fills ~60-85% of the frame
void main() {
  int seg = gl_VertexID / 6, corner = gl_VertexID % 6;
  float u = (float(gl_InstanceID) + 0.5) / uStrands;
  float s0 = float(seg) / uM, s1 = float(seg + 1) / uM;
  vec3 c0 = P(s0, u), c1 = P(s1, u);
  vec2 a = proj(c0), b = proj(c1), dir = b - a; float len = length(dir);
  dir = len > 1e-4 ? dir / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  bool end = corner == 2 || corner == 3 || corner == 5;
  float side = (corner == 1 || corner == 4 || corner == 5) ? 1.0 : -1.0;
  float half_ = uWidth * 0.5 + 1.0;
  vec2 pos = (end ? b : a) + nrm * side * half_;
  float s = end ? s1 : s0;
  float depth = clamp(0.5 + 0.35 * (end ? c1.z : c0.z) / max(uAmp, 0.01), 0.0, 1.0);
  // open strands fade in and out at their ends; the outer strands of the sheet are softer
  float ends = pow(sin(3.14159265 * s), 0.6), edge = 0.55 + 0.45 * sin(3.14159265 * u);
  float bu = bandAt(u) * uBandDrive, rpl = ripple(u, uRipA) + ripple(u, uRipB);
  float live = 0.5 + 1.25 * bu + 1.6 * rpl + 0.35 * uBeatE;                 // strands brighten with their own band and as a ripple passes
  vSide = side * half_; vAlpha = ends * edge * mix(0.35, 1.0, depth) * live; vDepth = clamp(depth + 0.25 * rpl + 0.2 * bu, 0.0, 1.0);
  gl_Position = vec4(pos / (uRes * 0.5), 0.0, 1.0);
}`;
const SILK_FS = `#version 300 es
precision highp float;
in float vSide; in float vAlpha; in float vDepth; out vec4 o;
uniform float uWidth, uIntensity; uniform vec3 uFront, uBack;
void main() {
  float d = abs(vSide);
  float core = 1.0 - smoothstep(uWidth * 0.5 - 0.5, uWidth * 0.5 + 0.5, d);   // ~1 px antialiased hairline
  vec3 col = mix(uBack, uFront, 0.35 + 0.65 * vDepth);
  o = vec4(col * core * vAlpha * uIntensity, 1.0);                       // additive: overlaps glow
}`;
// Families: [a, b, c, spread, fold, harmonics, warp, turns]. The scene eases between them.
const FAMILIES = {
  silk: [1.0, 2.0, 1.5, 1.7, 2.2, 0.25, 0.22, 1.0],
  knot: [2.0, 3.0, 5.0, 0.9, 3.0, 0.15, 0.12, 1.0],
  bloom: [5.0, 4.0, 3.0, 2.4, 1.0, 0.35, 0.08, 1.0],
  veil: [1.0, 1.5, 0.5, 3.0, 0.6, 0.10, 0.35, 1.0],
};
const CYCLE = ['silk', 'knot', 'silk', 'bloom', 'veil'];
const STRANDS = { eco: 70, balanced: 120, high: 170, ultra: 240 };

const LINE_FS = `#version 300 es
precision highp float;
in float vSide; in float vHalf; in float vDepth; in float vT; in float vEcho; out vec4 o;
uniform float uCore, uGlow, uEnergy, uSpectrum, uTime, uWeight; uniform vec3 uFront, uBack;
vec3 hue(float h) { return clamp(abs(fract(h + vec3(0.0, 2.0, 1.0) / 3.0) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
void main() {
  float d = abs(vSide);
  float core = 1.0 - smoothstep(uCore * 0.5 - 0.6, uCore * 0.5 + 0.6, d);   // crisp antialiased core
  float glow = exp(-(d * d) / max(uGlow * uGlow, 0.01)) * 0.22;
  vec3 col = uSpectrum > 0.5 ? mix(vec3(1.0), hue(vT + uTime * 0.03), 0.75) : mix(uBack, uFront, vDepth);
  float bright = mix(0.32, 1.0, vDepth) * uEnergy;
  float strand = vEcho > 0.5 ? 0.22 : 1.0;
  o = vec4(col * (core * 0.9 + glow) * bright * strand * uWeight, 1.0); // MAX-blended into this frame's trace
}`;

const ZERO_FS = `#version 300 es
precision highp float; out vec4 o; void main() { o = vec4(0.0); }`;
const ADD_FS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o; uniform sampler2D uFrame; uniform float uGain;
void main() { o = vec4(texture(uFrame, vUv).rgb * uGain, 1.0); }`;

const TONE_FS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uTrail; uniform vec2 uRes; uniform float uHalftone, uTime, uBright, uOled;
uniform float uBand[32]; uniform float uBeat, uStars, uFlow, uLevel, uBass; uniform vec3 uFront, uBack;
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; } return v; }
float bandAt(float x01) { float x = clamp(x01, 0.0, 1.0) * 31.0; int i = int(floor(x)); return mix(uBand[i], uBand[min(i + 1, 31)], fract(x)); }
// One layer of stars. Every star has its own twinkle rate, base brightness and a slice of the spectrum
// it listens to, so the field shimmers unevenly like the music does: bass stars swell, treble stars sparkle.
vec3 starLayer(vec2 px, float cell, float dens, float seed, float sizeMul) {
  vec2 id = floor(px / cell);
  float h = hash(id + seed);
  if (h > dens) return vec3(0.0);
  vec2 f = px - (id + 0.5) * cell;
  vec2 off = (vec2(hash(id + seed + 3.1), hash(id + seed + 7.7)) - 0.5) * cell * 0.6;
  float h2 = hash(id + seed + 11.3), h3 = hash(id + seed + 19.9), h4 = hash(id + seed + 23.1);
  float d = length(f - off), size = mix(0.55, 1.8, h2 * h2) * sizeMul * max(1.0, uRes.y / 1080.0);
  float core = exp(-(d * d) / (size * size)), halo = exp(-(d * d) / (size * size * 6.0)) * 0.22 * step(0.7, h2);
  float tw = 0.5 + 0.5 * sin(uTime * (0.7 + 2.8 * h3) + h3 * 60.0), tw2 = 0.5 + 0.5 * sin(uTime * (2.1 + 4.5 * h4) + h4 * 31.0);
  float band = bandAt(h4);
  float music = 0.6 + 2.0 * band + 0.9 * uBeat * h3;
  float inten = mix(0.22, 1.0, h2 * h2) * (0.3 + 0.7 * mix(tw, tw2, 0.5)) * music;
  vec3 tint = mix(vec3(0.72, 0.84, 1.0), vec3(1.0, 0.9, 0.74), h4);
  tint = mix(tint, uFront * 1.25 + 0.25, 0.3);
  return tint * (core + halo) * inten;
}
void main() {
  vec2 px = vUv * uRes;
  // halftone: a fixed dot grid whose dot size follows a slow, soft field, dim enough to be felt more than seen
  float cell = max(6.0, uRes.y / 150.0);
  vec2 gc = floor(px / cell), f = (fract(px / cell) - 0.5) * cell;
  vec2 q = (gc * cell) / uRes.y;
  float field = 0.5 + 0.5 * sin(q.x * 3.1 + uTime * 0.05) * sin(q.y * 2.3 - uTime * 0.04);
  float vign = 1.0 - smoothstep(0.25, 0.95, length(vUv - 0.5) * 1.3);
  float r = cell * mix(0.1, 0.34, field * vign);
  float dot_ = 1.0 - smoothstep(r - 0.7, r + 0.7, length(f));
  vec3 bg = vec3(0.005) + vec3(0.075) * dot_ * uHalftone * (1.0 - uOled * 0.5);
  if (uStars > 0.001) {
    // nebula: slow domain-warped clouds in the palette's colours (plus a hue-rotated second tone). The music
    // drives how fast they flow and how bright they glow: bass swells the whole cloud, beats flare it.
    vec2 w = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0) * 1.7;
    vec2 fl = vec2(uFlow * 0.035, -uFlow * 0.022);
    float n1 = fbm(w + fl + fbm(w * 1.3 - fl * 1.4) * 1.3), n2 = fbm(w * 2.4 - 5.0 + fl * 2.0);
    float cloud = smoothstep(0.34, 0.86, n1), dens = smoothstep(0.42, 0.9, n2) * cloud;
    float lo = bandAt(0.08), mi = bandAt(0.4), hi = bandAt(0.8);
    float react = 0.85 + 1.4 * uBass + 1.0 * uBeat + 0.5 * uLevel;
    vec3 toneA = mix(uBack, uFront, 0.5), toneB = vec3(uFront.b, uFront.r, uFront.g) * 0.85;
    vec3 neb = toneA * cloud * (0.7 + 0.9 * lo) + toneB * dens * (0.5 + 1.2 * mi) + uFront * pow(dens, 3.0) * (0.4 + 1.6 * hi);
    float vg = 0.55 + 0.45 * smoothstep(1.1, 0.2, length(vUv - 0.5) * 1.5);
    bg += neb * react * 0.075 * uStars * vg * (1.0 - uOled * 0.35);
    // stars, three depths drifting at different speeds
    vec2 dr = vec2(uTime * 1.6, uTime * 0.7);
    vec3 st = starLayer(px + dr * 0.6, 34.0, 0.34, 1.0, 1.0) * 0.8 + starLayer(px + dr * 1.1 + 40.0, 74.0, 0.3, 2.1, 1.0) + starLayer(px + dr * 1.8 - 90.0, 160.0, 0.26, 3.7, 1.55) * 1.25;
    bg += st * uStars * 0.6;
  }
  vec3 trace = texture(uTrail, vUv).rgb;
  vec3 glow = 1.0 - exp(-trace * 2.2);                                       // filmic: dense crossings glow, never clip
  vec3 col = bg * (1.0 - smoothstep(0.0, 0.25, max(glow.r, max(glow.g, glow.b)))) + glow; // background recedes under the light
  col += (hash(px + fract(uTime) * 91.0) - 0.5) / 255.0;                     // break up any banding in the glow
  o = vec4(mix(mix(vec3(0.004), vec3(0.0), uOled), col, uBright), 1.0);
}`;

// Cymatics. The sand field is a live blend of 12 vibration modes, each weighted by its own slice of
// the music's spectrum (bass -> simple modes, treble -> intricate ones), so the pattern is the music.
// Silent: the weights drift on unrelated slow rhythms, so it never repeats.
//   Full screen: rectangular plate modes  cos(nπx)cos(mπy) + s·cos(mπx)cos(nπy), s sweeping -1..1.
//   Sphere:      spherical harmonics  P_l^m(cos θ)·cos(mφ + phase) on a slowly turning sphere, with the
//                flat field glowing faintly behind it, pulsing with the music.
// Sand ridges sit on the nodal lines (field = 0), antialiased with fwidth so they're sharp at any size.
const CYM_FS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
#define K 12
uniform float uW[K];   // how strongly each vibration mode is excited (from the spectrum)
uniform float uPh[K];  // each mode's morph phase: advances with its band's energy, kicked by its onsets
uniform vec2 uRes; uniform float uSphere, uWidth, uGlow, uGrain, uShake, uEnergy, uTime, uPulse, uScale, uWarp, uWarpPh, uBump, uSpin;
uniform vec3 uFront, uBack;
const float PI = 3.14159265;
const vec3 MODES[K] = vec3[K](vec3(1,2,1), vec3(2,3,-1), vec3(1,4,1), vec3(3,4,-1), vec3(2,5,1), vec3(3,5,-1),
                              vec3(4,5,1), vec3(1,6,-1), vec3(3,7,1), vec3(5,6,-1), vec3(4,7,1), vec3(6,7,-1));
const ivec2 SH[K] = ivec2[K](ivec2(2,1), ivec2(3,2), ivec2(4,1), ivec2(4,3), ivec2(5,2), ivec2(5,4),
                             ivec2(6,3), ivec2(6,5), ivec2(7,2), ivec2(7,4), ivec2(8,3), ivec2(8,6));
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }

float plateField(vec2 p) {
  float f = 0.0, ws = 1e-3;
  for (int k = 0; k < K; k++) {
    vec3 m = MODES[k];
    float s = m.z * cos(uPh[k]);                                                // the music drives each mode's morph
    f += uW[k] * (cos(m.x * PI * p.x) * cos(m.y * PI * p.y) + s * cos(m.y * PI * p.x) * cos(m.x * PI * p.y));
    ws += uW[k];
  }
  return f / ws;
}
// associated Legendre P_l^m(x), normalised so every mode has a comparable amplitude
float legendre(int l, int m, float x) {
  float pmm = 1.0, s = sqrt(max(0.0, 1.0 - x * x)), fct = 1.0;
  for (int i = 1; i <= 8; i++) { if (i > m) break; pmm *= -fct * s; fct += 2.0; }
  float r = pmm;
  if (l > m) {
    float pm1 = x * float(2 * m + 1) * pmm; r = pm1;
    for (int ll = 2; ll <= 8; ll++) { int L = m + ll; if (L > l) break; float pl = (x * float(2 * L - 1) * pm1 - float(L + m - 1) * pmm) / float(L - m); pmm = pm1; pm1 = pl; r = pl; }
  }
  float nrm = 1.0; for (int i = 1; i <= 16; i++) { int v = l - m + i; if (v > l + m) break; nrm /= float(v); }
  return r * sqrt(nrm);
}
float sphereField(vec3 n) {
  float th = acos(clamp(n.y, -1.0, 1.0)), ph = atan(n.z, n.x), f = 0.0, ws = 1e-3, x = cos(th);
  for (int k = 0; k < K; k++) {
    ivec2 lm = SH[k];
    f += uW[k] * legendre(lm.x, lm.y, x) * cos(float(lm.y) * ph + uPh[k] * 0.7);
    ws += uW[k];
  }
  return f / ws;
}
// sand: a crisp ridge on the nodal line, a soft glow, and grains clustered along it
vec3 sand(float f, vec2 px, float width) {
  float d = abs(f) / max(fwidth(f), 1e-5);
  float line = exp(-pow(d / max(width, 0.5), 2.0));
  float glow = exp(-d / uGlow) * 0.28;
  vec2 gp = floor(px / 1.3) + floor(uShake * 8.0) * 17.0;
  float grain = step(1.0 - exp(-d / (width * 3.5)) * 0.55 * uGrain, hash(gp)) * (0.5 + 0.5 * hash(gp + 7.0));
  return uFront * (line * 1.1 + glow + grain * 0.7) * uEnergy;
}

void main() {
  vec2 px = vUv * uRes, asp = vec2(uRes.x / uRes.y, 1.0);
  vec2 jitter = uShake * vec2(hash(floor(vec2(uTime * 37.0))) - 0.5, hash(floor(vec2(uTime * 41.0)) + 3.0) - 0.5) * vec2(0.0045, 0.015);              // beat jitter: barely any sideways shake
  vec2 p = ((vUv - 0.5) * 2.0 * asp) * uScale;                       // full-screen plate; pitch sets the scale
  // smooth warp: bends the existing lines (never adds new ones, so nothing overlaps)
  // The sideways part is kept small (it read as an obnoxious left-right wobble at full strength);
  // the vertical bending carries the morph.
  p += uWarp * vec2(0.15 * (sin(p.y * 2.3 + uWarpPh) + 0.5 * sin(p.y * 4.1 - uWarpPh * 1.3)), cos(p.x * 1.9 - uWarpPh * 0.8) + 0.5 * cos(p.x * 3.7 + uWarpPh));
  p += jitter;
  vec3 flatSand = sand(plateField(p), px, uWidth);
  if (uSphere < 0.5) { o = vec4(flatSand * 0.9, 1.0); return; }

  // background: the flat field, faint, breathing with the music
  vec3 col = flatSand * uPulse;
  vec2 sp = (px - 0.5 * uRes) / (0.4 * (1.0 + uBump * 0.07) * min(uRes.x, uRes.y));   // the sphere swells on beats
  float r2 = dot(sp, sp);
  if (r2 < 1.0) {
    vec3 nv = vec3(sp.x, sp.y, sqrt(1.0 - r2));                     // view-space normal
    float a = uSpin, c = cos(a), sn = sin(a), t = 0.38, ct = cos(t), st = sin(t);
    vec3 n = vec3(c * nv.x + sn * nv.z, nv.y, -sn * nv.x + c * nv.z);
    n = vec3(n.x, ct * n.y - st * n.z, st * n.y + ct * n.z);           // turn and tilt the sphere
    vec3 sphSand = sand(sphereField(n), px, uWidth * 0.9);
    float lam = max(dot(nv, normalize(vec3(-0.45, 0.55, 0.7))), 0.0), rim = pow(1.0 - nv.z, 3.0);
    vec3 body = uBack * (0.02 + 0.05 * lam) + uFront * rim * 0.14 + sphSand * (0.35 + 0.65 * nv.z);
    float edge = smoothstep(1.0, 0.985, r2);
    col = mix(col * 0.25, body, edge);                               // the sphere hides the lines behind it
  }
  o = vec4(col * 0.9, 1.0);
}`;
const MP = { eco: 1.3e6, balanced: 2.1e6, high: 3.7e6, ultra: 8.4e6 };
const N = 2400;
const PALETTES = {
  blue: ['#0e54d8', '#05204f'], white: ['#ffffff', '#8a8f99'], ice: ['#d8f1ff', '#3d6a8c'], violet: ['#d9c2ff', '#4a2c7a'], cherry: ['#ffc2cf', '#7a1c33'],
  forest: ['#c8f5d2', '#1f5a33'],
  phosphor: ['#f2f6ff', '#5a6a8a'], cobalt: ['#8fb6ff', '#16307a'], amber: ['#ffc46b', '#7a3a08'],
  green: ['#9dffb3', '#0f5a2a'], silver: ['#ffffff', '#4a4a50'],
};
// RGB mode: the hue travels round the wheel, faster with loudness and shoved along on every beat.
function hsv2rgb(h, s, v) {
  const f = n => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
}
// classic frequency ratios the figure moves between (a : b : c)
const FIGURES = [[3, 2, 1], [5, 4, 3], [3, 4, 2], [5, 6, 1], [1, 2, 3], [7, 6, 5], [4, 3, 5], [2, 3, 4]];

export default class Lissajous {
  constructor(g, settings) {
    this.g = g;
    this.line = g.program('lissajous-line', LINE_VS, LINE_FS);
    this.silk = g.program('lissajous-silk', SILK_VS, SILK_FS);
    this.fam = (FAMILIES.silk).slice(); this.famT = 0; this.famI = 0; this.foldKick = 0;
    this.zero = g.program('lissajous-zero', VS, ZERO_FS);
    this.tone = g.program('lissajous-tone', VS, TONE_FS);
    this.add = g.program('lissajous-add', VS, ADD_FS);
    this.cym = g.program('lissajous-cymatics', VS, CYM_FS);
    this.shake = 0; this.pulse = .14;
    this.t = 0; this.rot = .6; this.delta = 0; this.fig = 0; this.morph = 1; this.figT = 0;
    this.abc = FIGURES[1].slice(); this.fig = 1; this.amp = 1; this.energy = 1; this.kick = 0;
    this.vb = new Float32Array(32); this.agc = .05; this.bassE = 0; this.midE = 0; this.highE = 0; this.lv = 0; this.beatE = 0; this.musicT = 0; this.spin = .6; this.ripA = -1; this.ripB = -1; this.lastRip = 0; this.prevB = new Float32Array(32);
    this.scopeMix = 0; this.gain = 1; this.waveSeq = -1; this.waveLen = 0;
    this.setSettings(settings);
  }
  setSettings(s) { this.s = s; }
  resize(w, h, q, wantMips) {
    const [sw, sh] = fitArea(w, h, MP[q] || MP.balanced); this.quality = q;
    if (this.out && this.out.w === sw && this.out.h === sh && this.out.mips === wantMips) return;
    this.g.free(this.trail); this.g.free(this.frame); this.g.free(this.out);
    this.trail = this.g.target(sw, sh, { format: 'rgba16f' });
    this.frame = this.g.target(sw, sh, { format: 'rgba16f' });
    this.out = this.g.target(sw, sh, { format: 'rgb10', mips: wantMips });
    const gl = this.g.gl; this.g.bindTarget(this.trail); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  }
  update(dt, inp) {
    const s = this.s, motion = inp.motion, a = inp.audio;
    this.dt = Math.min(dt, 1 / 20);
    if (!motion) return false;
    const sp = s.speed / 100;
    this.t += this.dt;
    this.analyse(a);
    const r0 = s.react / 100;
    this.hue = ((this.hue || 0) + this.dt * (.03 + this.lv * .3 * r0) + this.beatE * this.dt * .12 * r0) % 1;
    // the figure travels with the music: louder = faster turning and a quicker phase sweep, with the
    // low end leaning the whole thing and the mids opening it, all smoothly (no per-beat jerks)
    this.spin += this.dt * (.1 + this.lv * .5 * r0 + this.bassE * .25 * r0) * sp;
    this.rot = this.spin + Math.sin(this.musicT * .23) * .35 * (.4 + .6 * r0);
    this.delta += this.dt * (.18 + (this.midE * .9 + this.lv * .5) * r0) * sp;
    // move to the next figure every ~22 s, easing the ratios across 5 s
    this.figT += this.dt * sp;
    if (this.beatE > .85 && this.figT > 9 && r0 > 0) this.figT = 22.1;   // a big hit changes the figure
    if (this.figT > 22) { this.figT = 0; this.fig = (this.fig + 1) % FIGURES.length; this.from = this.abc.slice(); this.morph = 0; }
    if (this.morph < 1) {
      this.morph = Math.min(1, this.morph + this.dt / 5);
      const k = this.morph * this.morph * (3 - 2 * this.morph), to = FIGURES[this.fig];
      this.abc = this.from.map((v, i) => v + (to[i] - v) * k);
    }
    // XY scope: follow the live waveform while sound is playing, ease back to the figure when silent
    const fresh = a.wave && performance.now() - (a.waveT || 0) < 300;
    let peak = 0;
    if (fresh) { for (const v of a.wave) { const m = Math.abs(v); if (m > peak) peak = m; } }
    const wantScope = s.source === 'scope' ? 1 : 0;
    this.scopeMix += (wantScope - this.scopeMix) * (1 - Math.exp(-this.dt * (wantScope ? 6 : 1.5)));
    const shapedPk = this.shapedPeak || peak;                                     // gain from the smoothed signal fills the frame
    if (fresh && shapedPk > .002) this.gain += (Math.min(14, .9 / shapedPk) - this.gain) * (1 - Math.exp(-this.dt * 4));
    if (fresh && a.waveSeq !== this.waveSeq) { this.waveSeq = a.waveSeq; this.pendingWave = this.shape(a.wave); }
    if (s.mode === 'cymatics') this.updateCymatics(a, fresh, peak);
    else this.updateSilk(a);
    const r = s.react / 100;
    this.amp += ((1 + (this.bassE * .14 + this.beatE * .06) * r) - this.amp) * (1 - Math.exp(-this.dt * 14));
    this.energy += ((1 + (this.highE * .7 + this.lv * .5 + this.beatE * .3) * r) - this.energy) * (1 - Math.exp(-this.dt * 10));
    return true;
  }
  render(inp) {
    const g = this.g, gl = g.gl, s = this.s, w = this.trail.w, h = this.trail.h, k = h / 1080, r = s.react / 100;
    const pal = s.palette === 'custom' ? [hexRGB(s.color), hexRGB(s.color).map(x => x * .3)]
      : s.palette === 'rgb' ? [hsv2rgb(this.hue || 0, .85, 1), hsv2rgb(((this.hue || 0) + .12) % 1, .9, .32)]
      : (PALETTES[s.palette] || PALETTES.blue).map(hexRGB);
    if (this.pendingWave) this.uploadWave(this.pendingWave);
    // 1. this frame's trace, MAX-blended so overlapping segment ends never bead
    g.bindTarget(this.frame); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE);
    const common = {
      uRes: [w, h], uN: N, uA: this.abc[0], uB: this.abc[1], uC: this.abc[2], uDelta: this.delta, uRot: this.rot,
      uTilt: .32 + Math.sin(this.t * .05) * .12, uAmp: this.amp, uCore: (1.1 + s.thickness / 100 * 3.2) * Math.max(1, k),
      uGlow: (2 + s.glow / 100 * 12) * Math.max(1, k), uEnergy: this.energy, uSpectrum: s.palette === 'spectrum' ? 1 : 0,
      uTime: this.t, uFront: pal[0] || [1, 1, 1], uBack: pal[1] || [.3, .3, .3], uEcho: .035,
    };
    gl.bindVertexArray(g.emptyVao);
    if (s.mode === 'cymatics') {
      gl.disable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD);
      g.use(this.cym, {
        uRes: [w, h], uSphere: s.plate === 'circle' ? 1 : 0,
        uWidth: (1.1 + s.thickness / 100 * 2.6) * Math.max(1, h / 1080) * (1 + .26 * (this.cloud || 0)), uGlow: 2 + s.glow / 100 * 14, uGrain: .4 + s.grain / 100,
        uShake: this.shake, uEnergy: 1 + (this.energy - 1) * .35, uTime: this.t, uPulse: this.pulse || .05, uScale: this.cscale || .62, uWarp: this.cwarp || 0, uWarpPh: this.cwarpPh || 0, uBump: this.cbump || 0, uSpin: this.spin, uFront: pal[0] || [1, 1, 1], uBack: pal[1] || [.3, .3, .3],
      });
      gl.uniform1fv(this.cym.u.uW, this.cw || new Float32Array(12).fill(.5));
      gl.uniform1fv(this.cym.u.uPh, this.cph || new Float32Array(12));
      g.draw();
    } else {
    const fig = 1 - this.scopeMix, sc = this.scopeMix;
    if (fig > .01) {
      // additive accumulation of hairline strands (not MAX): overlaps are what make the silk glow
      gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE);
      const f = this.fam, t = this.t, q = this.quality || 'balanced', dens = .5 + (s.density ?? 60) / 100;
      const strands = Math.max(30, Math.round((STRANDS[q] || 120) * dens)), M = 420;
      g.use(this.silk, {
        uRes: [w, h], uM: M, uStrands: strands, uTime: t, uTurns: f[7],
        uA: f[0] + .06 * Math.sin(t * .037), uB: f[1] + .05 * Math.sin(t * .029 + 1), uC: f[2] + .07 * Math.sin(t * .023 + 2),
        uPhi: t * .05 * (s.speed / 100 + .2), uSpread: f[3] * (1 + .25 * Math.sin(t * .041) + .16 * this.bassE * r),
        uFold: f[4] * (1 + .3 * Math.sin(t * .033 + 1)) + this.midE * 2.4 * r + this.foldKick * .6 * r,
        uHarm: f[5], uWarp: f[6] * (1 + .4 * Math.sin(t * .027)) + this.beatE * .06 * r + this.midE * .05 * r, uTreble: this.highE * 2.2 * r,
        uAmp: 1.05 * this.amp, uYaw: this.rot, uPitch: .35 + .2 * Math.sin(t * .019) + (this.midE - .3) * .22 * r,
        uRipA: this.ripA, uRipB: this.ripB, uBassE: this.bassE, uBeatE: this.beatE * r, uBandDrive: r * 1.1,
        uWidth: (.8 + s.thickness / 100 * 1.4) * Math.max(1, h / 1080),
        uIntensity: (.9 + s.glow / 100 * .8) * this.energy * 18 / strands * fig,
        uFront: pal[0] || [1, 1, 1], uBack: pal[1] || [.5, .5, .5],
      });
      gl.uniform1fv(this.silk.u.uBands, this.vb);
      gl.bindVertexArray(g.emptyVao); gl.drawArraysInstanced(gl.TRIANGLES, 0, M * 6, strands);
      gl.blendEquation(gl.MAX);
    }
    if (sc > .01 && this.waveTex) {
      // 4 smooth sub-steps per sample; a single faint echo keeps the scope clean
      const n = Math.min(4096, (this.waveLen - 1) * 4);
      // one clean strand, finer core and tighter glow than the figure: the audio is busy enough
      g.use(this.line, { ...common, uN: n, uMode: 1, uWeight: sc, uWave: this.waveTex, uCount: this.waveLen, uOffset: Math.floor(this.waveLen / 4), uGain: this.gain,
        uCore: common.uCore * .75, uGlow: common.uGlow * .55 });
      gl.bindVertexArray(g.emptyVao); gl.drawArraysInstanced(gl.TRIANGLES, 0, n * 6, 1);
    }
    }
    gl.blendEquation(gl.FUNC_ADD); gl.enable(gl.BLEND);
    // 2. phosphor: fade the trail in place, then add this frame
    g.bindTarget(this.trail);
    // the audio scope keeps a shorter trail so frames don't pile into a tangle
    const fade = Math.pow((.55 + .43 * s.persistence / 100) * (1 - .12 * this.scopeMix), (this.dt || 1 / 60) * 60);
    gl.blendColor(0, 0, 0, fade); gl.blendFunc(gl.ZERO, gl.CONSTANT_ALPHA);
    g.use(this.zero); g.draw();
    gl.blendFunc(gl.ONE, gl.ONE);
    g.use(this.add, { uFrame: this.frame, uGain: (1 - fade) * 1.2 + .12 });
    g.draw();
    gl.disable(gl.BLEND);
    // 3. glow over the halftone background
    g.bindTarget(this.out);
    g.use(this.tone, { uTrail: this.trail, uRes: [w, h], uHalftone: s.halftone / 100, uTime: this.t, uBright: s.brightness / 100, uOled: inp?.oled ? 1 : 0,
      uBeat: this.beatE * r, uStars: (s.stars ?? 70) / 100, uFlow: this.musicT, uLevel: this.lv * r, uBass: this.bassE * r, uFront: pal[0] || [1, 1, 1], uBack: pal[1] || [.3, .3, .3] });
    gl.uniform1fv(this.tone.u.uBand, this.vb);
    g.draw();
  }
  // Music analysis shared by every mode. The 32-band spectrum is auto-levelled (slow gain, so quiet and loud
  // passages both fill the range), contrast-shaped, and smoothed with a fast attack and a slower release so
  // it moves like an equaliser instead of flickering. From it: bass / mid / high envelopes, loudness, an
  // onset (spectral flux) envelope for hits, a music clock that runs faster when it is loud, and travelling
  // ripples that leave on strong onsets.
  analyse(a) {
    const dt = this.dt, r = this.s.react / 100, vb = this.vb;
    const live = this.s.react > 0 && a.t && performance.now() - a.t < 500 && a.level > .004;
    const tgt = new Float32Array(32);
    let flux = 0;
    if (live) {
      if (Array.isArray(a.bands) && a.bands.length >= 24) {
        const n = a.bands.length; let mx = 1e-3;
        for (let b = 0; b < 32; b++) { const x = b * (n - 1) / 31, i = Math.floor(x), v = (a.bands[i] || 0) * (1 - (x - i)) + (a.bands[Math.min(n - 1, i + 1)] || 0) * (x - i); tgt[b] = v; if (v > mx) mx = v; }
        this.agc = Math.max(mx, this.agc * Math.exp(-dt * .3));
        for (let b = 0; b < 32; b++) tgt[b] = Math.min(1.25, Math.pow(tgt[b] / this.agc, 1.6));
      } else {
        for (let b = 0; b < 32; b++) { const x = b / 31, v = x < .33 ? a.bass : x < .66 ? a.mid : a.treble; tgt[b] = Math.min(1.2, (v || 0) * 1.6); }
      }
      if (a.t !== this.aT) { this.aT = a.t; for (let b = 0; b < 32; b++) { flux += Math.max(0, tgt[b] - this.prevB[b]) * (b < 12 ? 1.6 : 1); this.prevB[b] = tgt[b]; } flux /= 14; }
    }
    for (let b = 0; b < 32; b++) vb[b] += (tgt[b] - vb[b]) * (1 - Math.exp(-dt * (tgt[b] > vb[b] ? 22 : 4.2)));
    const mean = (i0, i1) => { let v = 0; for (let b = i0; b < i1; b++) v += vb[b]; return v / (i1 - i0); };
    const ease = (cur, t, up, dn) => cur + (t - cur) * (1 - Math.exp(-dt * (t > cur ? up : dn)));
    this.bassE = ease(this.bassE, Math.min(1, mean(0, 4) * 1.15), 20, 5);
    this.midE = ease(this.midE, Math.min(1, mean(4, 16) * 1.3), 14, 4);
    this.highE = ease(this.highE, Math.min(1, mean(16, 32) * 1.8), 22, 7);
    this.lv = ease(this.lv, live ? Math.min(1, a.level * 2.2) : 0, 8, 1.6);
    this.beatE = Math.max(this.beatE * Math.exp(-dt * 3.4), live ? Math.min(1, flux * 3.2 + (a.beat ? .65 : 0)) : 0);
    this.musicT += dt * (.25 + 1.6 * this.lv * r);
    // a strong onset sends a ripple of light across the sheet (at most one every ~0.35 s)
    if (this.ripA >= 0) { this.ripA += dt * .85; if (this.ripA > 1.25) this.ripA = -1; }
    if (this.ripB >= 0) { this.ripB += dt * .85; if (this.ripB > 1.25) this.ripB = -1; }
    if (this.beatE > .55 && this.t - this.lastRip > .35) { this.lastRip = this.t; if (this.ripA < 0) this.ripA = 0; else if (this.ripB < 0) this.ripB = 0; }
  }
  // Silk: ease toward the chosen family (or the cycle), drift on slow unrelated oscillators, and let the
  // music shape the sheet: bass breathes its size and spread, mids deepen and twist the folds, highs shimmer
  // the filaments, every strand glows with its own band, and onsets send ripples across it.
  updateSilk(a) {
    const sp = this.s.speed / 100;
    let name = this.s.family || 'silk';
    if (name === 'cycle') { this.famT += this.dt * sp; if (this.famT > 48) { this.famT = 0; this.famI = (this.famI + 1) % CYCLE.length; } name = CYCLE[this.famI]; }
    const to = FAMILIES[name] || FAMILIES.silk, k = 1 - Math.exp(-this.dt / 6);
    for (let i = 0; i < 8; i++) this.fam[i] += (to[i] - this.fam[i]) * k;
    this.foldKick = this.beatE * .9;
    this.silkMid = this.midE;
    this.silkTreble = this.highE;
  }
  // Cymatics. 12 vibration modes, each tied to a slice of the spectrum (low -> high):
  //  - weight: how strongly the mode is excited (fast attack, quick release, sharp contrast between bands)
  //  - phase: its morph angle. It advances with its band's energy and takes a kick on every onset in
  //    that band, so each new note visibly makes its part of the pattern flow
  // plus pitch -> pattern scale, beats -> swell, loudness -> warp depth and line weight.
  // Silent: slow incommensurate drift, so it never repeats.
  updateCymatics(a, fresh) {
    const N = 12, dt = this.dt, r = Math.min(1.6, .3 + this.s.react / 100 * .9), sp = this.s.speed / 100;
    this.cw = this.cw || new Float32Array(N).fill(.5);
    this.cph = this.cph || Float32Array.from({ length: N }, (_, k) => k * 1.3);
    this.cprev = this.cprev || new Float32Array(N);
    this.ckick = this.ckick || new Float32Array(N);
    const live = fresh && a.level > .015 && Array.isArray(a.bands) && a.bands.length >= 24;
    const target = new Float32Array(N), nrm = new Float32Array(N);
    let pitchT = .45, loud = 0;
    if (live) {
      let mx = 1e-3;
      for (let k = 0; k < N; k++) {
        const b0 = Math.floor(k * 32 / N), b1 = Math.max(b0 + 1, Math.floor((k + 1) * 32 / N));
        let v = 0; for (let b = b0; b < b1; b++) v += a.bands[b] || 0;
        nrm[k] = v / (b1 - b0); mx = Math.max(mx, nrm[k]);
      }
      // slow automatic gain: quiet and loud passages both use the full range
      this.cmax = Math.max(mx, (this.cmax || mx) * Math.exp(-dt * .35));
      let sw = 0, sx = 0;
      for (let b = 0; b < a.bands.length; b++) { const v = a.bands[b] || 0; sw += v; sx += v * b; }
      pitchT = sw > 1e-3 ? Math.min(1, Math.max(0, sx / sw / (a.bands.length - 1) * 1.7)) : .45;   // spectral centroid
      const fresher = a.t !== this.cT;                 // a new audio frame arrived: look for onsets
      if (fresher) this.cT = a.t;
      for (let k = 0; k < N; k++) {
        nrm[k] /= this.cmax;
        if (fresher) { const flux = Math.max(0, nrm[k] - this.cprev[k]); this.ckick[k] = Math.min(1.5, this.ckick[k] + flux * 2.4 * r); this.cprev[k] = nrm[k]; }
        target[k] = .05 + Math.pow(nrm[k], 2.1) + this.ckick[k] * .8;
      }
      loud = Math.min(1, a.level * 2.2);
    } else {
      const t = this.t * sp;
      for (let k = 0; k < N; k++) target[k] = .15 + Math.pow(.5 + .5 * Math.sin(t * (.071 + .0293 * k) + k * 2.1) * Math.sin(t * (.043 + .017 * k) + k), 2);
    }
    for (let k = 0; k < N; k++) {
      const up = target[k] > this.cw[k];
      this.cw[k] += (target[k] - this.cw[k]) * (1 - Math.exp(-dt * (up ? 18 : 4.5)));
      this.ckick[k] *= Math.exp(-dt * 4.2);
      // phase: slow base drift + band energy + onset kicks (so a note shows up as motion immediately)
      this.cph[k] += dt * ((.07 + .023 * k) * sp + (live ? nrm[k] * 1.9 * r + this.ckick[k] * 5.5 * r : 0));
    }
    // beats: a quick swell that settles
    this.shake = 0;                                                       // no per-beat jitter: motion stays fluid
    this.cbump = Math.min(1, this.beatE * .7 + this.bassE * .55);
    this.cpitch = (this.cpitch ?? .45) + (pitchT - (this.cpitch ?? .45)) * (1 - Math.exp(-dt * 2.6));
    this.cloud = (this.cloud || 0) + (loud - (this.cloud || 0)) * (1 - Math.exp(-dt * 5));
    const warpT = (live ? .016 + .048 * this.cloud * r + .032 * this.cbump * r : .02 + .006 * Math.sin(this.t * .13));
    this.cwarp = (this.cwarp ?? .02) + (warpT - (this.cwarp ?? .02)) * (1 - Math.exp(-dt * 7));
    this.cwarpPh = (this.cwarpPh || 0) + dt * (.35 + (live ? (a.treble || 0) * 4.5 * r + this.cloud * .8 : 0));
    // pitch zoom: low sounds -> big bold shapes, high sounds -> fine lace (silent: the calm default)
    this.cscale = (live ? .84 - .34 * this.cpitch : .62) * (1 - .06 * this.cbump * r);
    // the faint background lines behind the sphere: subtle, breathing with the music
    this.pulse = .05 + (live ? this.lv * .12 + this.bassE * .1 : .025 * (1 + Math.sin(this.t * .6)));
  }
  // Real music carries hi-hats and cymbals that turn an XY trace into a scribble. Smooth the
  // waveform (a gentle Gaussian low-pass), keep a 320-sample window, and blend with the previous
  // frame so the figure flows with the melody and bass instead of flickering.
  shape(raw) {
    const n = Math.min(320, raw.length);
    // wide Gaussian (sigma 4 samples) applied twice: keeps bass and melody, drops hi-hat fizz
    const K = []; let ks = 0; for (let j = -10; j <= 10; j++) { const w = Math.exp(-(j * j) / 32); K.push(w); ks += w; }
    const blur = src => { const o = new Float32Array(src.length); for (let i = 0; i < src.length; i++) { let v = 0; for (let j = -10; j <= 10; j++) v += src[Math.min(src.length - 1, Math.max(0, i + j))] * K[j + 10]; o[i] = v / ks; } return o; };
    const smooth = blur(blur(Float32Array.from(raw)));
    const out = smooth.slice(0, n);
    if (this.prevWave && this.prevWave.length === n) for (let i = 0; i < n; i++) out[i] = this.prevWave[i] * 0.45 + out[i] * 0.55;
    this.prevWave = out;
    let pk = 0; for (const v of out) pk = Math.max(pk, Math.abs(v)); this.shapedPeak = pk;
    return out;
  }
  uploadWave(w) {
    const gl = this.g.gl, data = new Float32Array(w);
    this.pendingWave = null;
    if (!this.waveTex || this.waveLen !== data.length) {
      if (this.waveTex) gl.deleteTexture(this.waveTex.tex);
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, data.length, 1, 0, gl.RED, gl.FLOAT, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.waveTex = { tex }; this.waveLen = data.length;
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.waveTex.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, data.length, 1, gl.RED, gl.FLOAT, data);
    }
  }
  get output() { return this.out; }
  dispose() { this.g.free(this.trail); this.g.free(this.frame); this.g.free(this.out); if (this.waveTex) this.g.gl.deleteTexture(this.waveTex.tex); this.trail = this.frame = this.out = this.waveTex = null; }
}
