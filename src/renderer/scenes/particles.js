// Up to 1M particles simulated entirely on the GPU. State lives in a float texture, points
// are drawn with gl_VertexID (no vertex buffers at all), and trails accumulate in a 16-bit
// buffer that fades in place (no ping-pong, and no 8-bit "trails that never fully fade").
import { VS } from '../gl.js';
import { paletteColor, PALETTES, hexRGB } from '../../shared/catalog.js';
import { fitArea } from './util.js';

const NOISE = `
vec3 hash3(vec3 p){ p=fract(p*vec3(0.1031,0.1030,0.0973)); p+=dot(p,p.yxz+33.33); return fract((p.xxy+p.yxx)*p.zyx)*2.0-1.0; }
float gnoise(vec3 p){ vec3 i=floor(p), f=fract(p), u=f*f*(3.0-2.0*f);
  return mix(mix(mix(dot(hash3(i),f),dot(hash3(i+vec3(1,0,0)),f-vec3(1,0,0)),u.x),mix(dot(hash3(i+vec3(0,1,0)),f-vec3(0,1,0)),dot(hash3(i+vec3(1,1,0)),f-vec3(1,1,0)),u.x),u.y),
             mix(mix(dot(hash3(i+vec3(0,0,1)),f-vec3(0,0,1)),dot(hash3(i+vec3(1,0,1)),f-vec3(1,0,1)),u.x),mix(dot(hash3(i+vec3(0,1,1)),f-vec3(0,1,1)),dot(hash3(i+vec3(1,1,1)),f-vec3(1,1,1)),u.x),u.y),u.z); }
float psi(vec2 q,float t){ return gnoise(vec3(q,t))+0.5*gnoise(vec3(q*2.03+17.0,t*1.3)); }`;

const INIT = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o; uniform float uSeed;
float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233))+uSeed)*43758.5453); }
void main(){ o=vec4(h(vUv),h(vUv+3.7),h(vUv+9.1)*10.0,h(vUv+5.3)); }`;

const STEP = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uState; uniform float uTime,uDt,uSpeed,uScale,uAsp; uniform vec3 uPtr;
${NOISE}
float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
void main(){
  vec4 s=texture(uState,vUv); vec2 p=s.xy; float age=s.z, seed=s.w;
  vec2 q=vec2(p.x*uAsp,p.y)*uScale; float e=0.015, t=uTime*0.07;
  vec2 v=vec2(psi(q+vec2(0,e),t)-psi(q-vec2(0,e),t), -(psi(q+vec2(e,0),t)-psi(q-vec2(e,0),t)))/(2.0*e);
  v.x/=uAsp;
  if(uPtr.z>0.0){ vec2 d=uPtr.xy-p; d.x*=uAsp; float r2=dot(d,d); vec2 n=d/sqrt(r2+1e-6);
    v+=(n*0.6+vec2(-n.y,n.x)*1.2)*uPtr.z/(r2*60.0+0.4); }
  p+=v*uDt*uSpeed*0.035*(0.6+0.8*seed);
  age+=uDt;
  float life=3.0+seed*9.0;
  if(age>life||p.x<-0.01||p.x>1.01||p.y<-0.01||p.y>1.01){ p=vec2(h(vUv+uTime),h(vUv*1.7+uTime*1.3)); age=0.0; }
  o=vec4(p,age,seed);
}`;

const POINTS_VS = `#version 300 es
precision highp float;
uniform sampler2D uState; uniform float uSide,uSize,uBright,uMode; uniform vec3 uC0,uC1,uC2;
out vec3 vCol;
vec3 hsv(float h){ vec3 k=clamp(abs(fract(h+vec3(0.0,2.0/3.0,1.0/3.0))*6.0-3.0)-1.0,0.0,1.0); return k; }
void main(){
  int side=int(uSide); ivec2 c=ivec2(gl_VertexID%side, gl_VertexID/side);
  vec4 s=texelFetch(uState,c,0);
  gl_Position=vec4(s.xy*2.0-1.0,0.0,1.0); gl_PointSize=uSize;
  float life=3.0+s.w*9.0, fade=smoothstep(0.0,0.8,s.z)*(1.0-smoothstep(life-1.2,life,s.z));
  vec3 col=uMode>0.5? hsv(s.w*0.8+s.x*0.2) : (s.w<0.5? mix(uC0,uC1,s.w*2.0) : mix(uC1,uC2,s.w*2.0-1.0));
  vCol=col*uBright*fade;
}`;
const POINTS_FS = `#version 300 es
precision highp float; in vec3 vCol; out vec4 o; void main(){ o=vec4(vCol,1.0); }`;
const ZERO = `#version 300 es
precision highp float; out vec4 o; void main(){ o=vec4(0.0); }`;
const TONE = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o; uniform sampler2D uTrail;
void main(){ vec3 c=texture(uTrail,vUv).rgb; o=vec4(1.0-exp(-c*1.6),1.0); }`;

const MP = { eco: 1.0e6, balanced: 2.1e6, high: 3.7e6, ultra: 8.4e6 };
const CAP = { eco: 65536, balanced: 262144, high: 1048576, ultra: 1048576 };

export default class Particles {
  constructor(g, settings) {
    this.g = g; this.t = 0;
    this.P = { init: g.program('pt-init', VS, INIT), step: g.program('pt-step', VS, STEP), points: g.program('pt-points', POINTS_VS, POINTS_FS), zero: g.program('pt-zero', VS, ZERO), tone: g.program('pt-tone', VS, TONE) };
    this.setSettings(settings);
  }
  setSettings(s) {
    const recount = this.s && this.s.count !== s.count;
    this.s = s;
    if (recount && this.last) this.resize(...this.last, true);
  }
  resize(w, h, q, wantMips, force) {
    this.last = [w, h, q, wantMips];
    const [tw, th] = fitArea(w, h, MP[q] || MP.balanced);
    const count = Math.min(+this.s.count || 262144, CAP[q] || 262144);
    const side = Math.ceil(Math.sqrt(count));
    this.asp = w / h; this.size = Math.max(1, tw / 1600);
    const g = this.g;
    if (force || !this.state || this.side !== side) {
      g.free(this.state);
      this.side = side;
      this.state = g.pingpong(side, side, { format: 'rgba32f', filter: 'nearest' });
      g.bindTarget(this.state.read); g.use(this.P.init, { uSeed: Math.random() * 100 }); g.draw();
    }
    if (!this.trail || this.trail.w !== tw || this.trail.h !== th || this.out.mips !== wantMips) {
      g.free(this.trail); g.free(this.out);
      this.trail = g.target(tw, th, { format: 'rgba16f' });
      this.out = g.target(tw, th, { format: 'rgb10', mips: wantMips });
      g.bindTarget(this.trail); g.gl.clearColor(0, 0, 0, 1); g.gl.clear(g.gl.COLOR_BUFFER_BIT);
    }
  }
  update(dt, inp) {
    if (!inp.motion) return false;
    this.dt = Math.min(dt, 1 / 20);
    this.t += this.dt * (1 + inp.audio.level * 1.5);
    this.audio = inp.audio.level;
    const p = inp.pointer;
    this.ptr = p.active ? [p.x, p.y, (this.s.cursor / 100) * (p.down ? -2.5 : 1)] : [0, 0, 0];
    return true;
  }
  render() {
    const g = this.g, gl = g.gl, s = this.s;
    g.bindTarget(this.state.write);
    g.use(this.P.step, { uState: this.state.read, uTime: this.t, uDt: this.dt || 1 / 60, uSpeed: s.speed / 100 * (1 + (this.audio || 0)), uScale: 0.8 + s.scale / 100 * 5, uAsp: this.asp, uPtr: this.ptr || [0, 0, 0] });
    g.draw(); this.state.swap();

    g.bindTarget(this.trail);
    gl.enable(gl.BLEND);
    const fade = Math.pow(0.5 + 0.495 * s.trail / 100, (this.dt || 1 / 60) * 60);
    gl.blendColor(0, 0, 0, fade); gl.blendFunc(gl.ZERO, gl.CONSTANT_ALPHA);
    g.use(this.P.zero); g.draw();                       // trail *= fade, in place
    gl.blendFunc(gl.ONE, gl.ONE);
    const count = this.side * this.side;
    const pal = s.palette === 'mono' ? [0.4, 1, 1.6].map(k => hexRGB(s.color).map(x => Math.min(1, x * k))) : PALETTES[s.palette] ? [0, .5, .99].map(t => paletteColor(s.palette, s.color, t)) : [[1, 1, 1], [1, 1, 1], [1, 1, 1]];
    g.use(this.P.points, { uState: this.state.read, uSide: this.side, uSize: this.size, uBright: s.glow / 100 * 0.12 * Math.sqrt(262144 / count) * (1 + (this.audio || 0)), uMode: s.palette === 'spectrum' ? 1 : 0, uC0: pal[0], uC1: pal[1], uC2: pal[2] });
    gl.bindVertexArray(g.emptyVao); gl.drawArrays(gl.POINTS, 0, count);
    gl.disable(gl.BLEND);

    g.bindTarget(this.out); g.use(this.P.tone, { uTrail: this.trail }); g.draw();
  }
  get output() { return this.out; }
  dispose() { [this.state, this.trail, this.out].forEach(t => this.g.free(t)); this.state = this.trail = this.out = null; }
}
