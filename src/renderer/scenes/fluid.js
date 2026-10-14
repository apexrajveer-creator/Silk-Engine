// Real-time incompressible fluid (Stam's stable fluids) on half-float textures.
// Velocity/pressure live on a small grid; only the ink is kept at display-ish resolution.
import { VS } from '../gl.js';
import { paletteColor } from '../../shared/catalog.js';
import { fitLong, rand } from './util.js';

const H = `#version 300 es
precision highp float; precision highp sampler2D; in vec2 vUv; out vec4 o; uniform vec2 uTexel;`;
const N = `vec2 L=vUv-vec2(uTexel.x,0.0), R=vUv+vec2(uTexel.x,0.0), T=vUv+vec2(0.0,uTexel.y), B=vUv-vec2(0.0,uTexel.y);`;

const SPLAT = H + `uniform sampler2D uTarget; uniform float uAsp,uRadius; uniform vec3 uColor; uniform vec2 uPoint;
void main(){ vec2 p=vUv-uPoint; p.x*=uAsp; o=vec4(texture(uTarget,vUv).xyz+exp(-dot(p,p)/uRadius)*uColor,1.0); }`;
const ADVECT = H + `uniform sampler2D uVel,uSrc; uniform float uDt,uDiss;
void main(){ vec2 c=vUv-uDt*texture(uVel,vUv).xy*uTexel; o=vec4(texture(uSrc,c).xyz/(1.0+uDiss*uDt),1.0); }`;
const DIVERGENCE = H + `uniform sampler2D uVel;
void main(){ ${N} vec2 C=texture(uVel,vUv).xy;
 float l=texture(uVel,L).x, r=texture(uVel,R).x, t=texture(uVel,T).y, b=texture(uVel,B).y;
 if(L.x<0.0)l=-C.x; if(R.x>1.0)r=-C.x; if(T.y>1.0)t=-C.y; if(B.y<0.0)b=-C.y;
 o=vec4(0.5*(r-l+t-b),0.0,0.0,1.0); }`;
const CURL = H + `uniform sampler2D uVel;
void main(){ ${N} o=vec4(0.5*(texture(uVel,R).y-texture(uVel,L).y-texture(uVel,T).x+texture(uVel,B).x),0.0,0.0,1.0); }`;
const VORTICITY = H + `uniform sampler2D uVel,uCurl; uniform float uCurlAmt,uDt;
void main(){ ${N} float l=texture(uCurl,L).x, r=texture(uCurl,R).x, t=texture(uCurl,T).x, b=texture(uCurl,B).x, c=texture(uCurl,vUv).x;
 vec2 f=0.5*vec2(abs(t)-abs(b),abs(r)-abs(l)); f/=length(f)+1e-4; f*=uCurlAmt*c; f.y*=-1.0;
 o=vec4(clamp(texture(uVel,vUv).xy+f*uDt,-1000.0,1000.0),0.0,1.0); }`;
const PRESSURE = H + `uniform sampler2D uP,uDiv;
void main(){ ${N} o=vec4((texture(uP,L).x+texture(uP,R).x+texture(uP,B).x+texture(uP,T).x-texture(uDiv,vUv).x)*0.25,0.0,0.0,1.0); }`;
const GRADIENT = H + `uniform sampler2D uP,uVel;
void main(){ ${N} vec2 v=texture(uVel,vUv).xy-vec2(texture(uP,R).x-texture(uP,L).x,texture(uP,T).x-texture(uP,B).x); o=vec4(v,0.0,1.0); }`;
const SCALE = H + `uniform sampler2D uSrc; uniform float uK; void main(){ o=vec4(texture(uSrc,vUv).xyz*uK,1.0); }`;
const DISPLAY = H + `uniform sampler2D uDye; uniform float uShine;
void main(){ vec3 c=texture(uDye,vUv).rgb;
 if(uShine>0.0){ ${N} float dx=length(texture(uDye,R).rgb)-length(texture(uDye,L).rgb), dy=length(texture(uDye,T).rgb)-length(texture(uDye,B).rgb);
   vec3 n=normalize(vec3(dx,dy,length(uTexel)*6.0)); float d=clamp(dot(n,normalize(vec3(-0.4,0.5,1.0))),0.0,1.0);
   c*=mix(1.0,0.55+0.75*d,uShine); }
 o=vec4(1.0-exp(-c*1.5),1.0); }`;

const SIM = { preview: 40, eco: 96, balanced: 128, high: 160, ultra: 224 };
const DYE = { preview: 384, eco: 640, balanced: 900, high: 1280, ultra: 1700 };
const ITER = { preview: 6, eco: 12, balanced: 18, high: 22, ultra: 30 };

export default class Fluid {
  constructor(g, settings) {
    this.g = g;
    const p = (n, s) => g.program('fluid-' + n, VS, s);
    this.P = { splat: p('splat', SPLAT), advect: p('advect', ADVECT), div: p('div', DIVERGENCE), curl: p('curl', CURL), vort: p('vort', VORTICITY), press: p('press', PRESSURE), grad: p('grad', GRADIENT), scale: p('scale', SCALE), display: p('display', DISPLAY) };
    this.acc = 0; this.last = null; this.hue = Math.random();
    this.setSettings(settings);
  }
  setSettings(s) { this.s = s; }
  resize(w, h, q, wantMips) {
    const asp = w / h, sim = SIM[q] || 128;
    const sw = Math.round(asp >= 1 ? sim * asp : sim), sh = Math.round(asp >= 1 ? sim : sim / asp);
    const [dw, dh] = fitLong(w, h, DYE[q] || 900);
    this.iter = ITER[q] || 18; this.asp = asp;
    if (this.vel && this.vel.w === sw && this.dye.w === dw && this.out.mips === wantMips) return;
    this.dispose();
    const g = this.g;
    this.vel = g.pingpong(sw, sh, { format: 'rg16f' });
    this.press = g.pingpong(sw, sh, { format: 'r16f' });
    this.div = g.target(sw, sh, { format: 'r16f' });
    this.curl = g.target(sw, sh, { format: 'r16f' });
    this.dye = g.pingpong(dw, dh, { format: 'rgba16f' });
    this.out = g.target(dw, dh, { format: 'rgb10', mips: wantMips });
    this.fresh = true;
  }
  color(k = 1) {
    const s = this.s; this.hue = (this.hue + 0.11 + Math.random() * 0.2) % 1;
    return paletteColor(s.palette, s.color, s.palette === 'spectrum' ? this.hue : Math.random()).map(x => x * 0.15 * k);
  }
  splat(x, y, dx, dy, col, rMul = 1) {
    const g = this.g, r = (this.s.splatSize / 100 * 0.6 + 0.05) / 100 * rMul;
    const radius = this.asp > 1 ? r * this.asp : r;
    g.bindTarget(this.vel.write); g.use(this.P.splat, { uTarget: this.vel.read, uAsp: this.asp, uPoint: [x, y], uColor: [dx, dy, 0], uRadius: radius }); g.draw(); this.vel.swap();
    g.bindTarget(this.dye.write); g.use(this.P.splat, { uTarget: this.dye.read, uColor: col, uRadius: radius }); g.draw(); this.dye.swap();
  }
  burst(n, k = 1) { for (let i = 0; i < n; i++) this.queue.push([rand(.1, .9), rand(.1, .9), 1000 * (Math.random() - .5), 1000 * (Math.random() - .5), this.color(8 * k), 1]); }
  update(dt, inp) {
    this.queue = this.queue || [];
    if (this.fresh) { this.fresh = false; this.burst(5 + (Math.random() * 4 | 0)); }
    if (!inp.motion) return this.queue.length > 0;
    dt = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;   // a huge or broken time step must never become a huge amount of work
    const s = this.s, p = inp.pointer;
    if (p.active && this.last) {
      const dx = p.x - this.last.x, dy = p.y - this.last.y;
      if (Math.abs(dx) + Math.abs(dy) > 1e-5) this.queue.push([p.x, p.y, dx * 6000, dy * 6000, this.color(p.down ? 3 : 1), p.down ? 1.6 : 1]);
    }
    this.last = p.active ? { x: p.x, y: p.y } : null;
    this.acc += dt * (s.ambient / 100) * 1.4;
    for (let n = 0; this.acc > 1 && n < 8; n++) { this.acc -= Math.random() * 2; this.queue.push([rand(.05, .95), rand(.05, .95), 900 * (Math.random() - .5), 900 * (Math.random() - .5), this.color(4), rand(.7, 1.6)]); }
    if (!Number.isFinite(this.acc) || this.acc > 8) this.acc = 0;
    if (inp.audio.beat && s.audioBurst > 0) this.burst(1 + Math.round(inp.audio.bass * 3 * s.audioBurst / 100), 0.6 + inp.audio.bass);
    this.dt = Math.min(dt, 1 / 30);
    return true;
  }
  render() {
    const g = this.g, gl = g.gl, s = this.s, P = this.P, dt = this.dt || 1 / 60;
    const tv = [1 / this.vel.w, 1 / this.vel.h];
    for (const q of this.queue) this.splat(...q);
    this.queue.length = 0;
    // curl + vorticity confinement
    g.bindTarget(this.curl); g.use(P.curl, { uTexel: tv, uVel: this.vel.read }); g.draw();
    g.bindTarget(this.vel.write); g.use(P.vort, { uTexel: tv, uVel: this.vel.read, uCurl: this.curl, uCurlAmt: s.swirl / 100 * 60, uDt: dt }); g.draw(); this.vel.swap();
    // project: make velocity divergence-free
    g.bindTarget(this.div); g.use(P.div, { uTexel: tv, uVel: this.vel.read }); g.draw();
    g.bindTarget(this.press.write); g.use(P.scale, { uTexel: tv, uSrc: this.press.read, uK: 0.8 }); g.draw(); this.press.swap();
    for (let i = 0; i < this.iter; i++) { g.bindTarget(this.press.write); g.use(P.press, { uTexel: tv, uP: this.press.read, uDiv: this.div }); g.draw(); this.press.swap(); }
    g.bindTarget(this.vel.write); g.use(P.grad, { uTexel: tv, uP: this.press.read, uVel: this.vel.read }); g.draw(); this.vel.swap();
    // advect velocity and ink
    const vd = 2.5 - 2.45 * s.flow / 100, dd = 3.0 - 2.85 * s.persistence / 100;
    g.bindTarget(this.vel.write); g.use(P.advect, { uTexel: tv, uVel: this.vel.read, uSrc: this.vel.read, uDt: dt, uDiss: vd }); g.draw(); this.vel.swap();
    g.bindTarget(this.dye.write); g.use(P.advect, { uTexel: tv, uVel: this.vel.read, uSrc: this.dye.read, uDt: dt, uDiss: dd }); g.draw(); this.dye.swap();
    g.bindTarget(this.out); g.use(P.display, { uTexel: [1 / this.dye.w, 1 / this.dye.h], uDye: this.dye.read, uShine: s.shine / 100 }); g.draw();
    void gl;
  }
  get output() { return this.out; }
  dispose() { const g = this.g; [this.vel, this.press, this.div, this.curl, this.dye, this.out].forEach(t => g.free(t)); this.vel = this.dye = this.out = null; }
}
