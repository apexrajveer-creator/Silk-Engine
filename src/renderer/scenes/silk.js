import { VS } from '../gl.js';
import { hexRGB } from '../../shared/catalog.js';
import { fitArea } from './util.js';

const FS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform float uTime,uBloom,uAsp,uMouseAmt,uWarp,uDepth,uSpin,uSurge,uBright,uOledBg;
uniform vec3 uColor; uniform vec2 uMouse; uniform vec4 uP0,uP1,uCam; uniform vec3 uSweep;
float ripple(vec4 p,vec2 uv,float asp){if(p.w<=0.0)return 0.0;vec2 d=vec2((uv.x-p.x)*asp,uv.y-p.y);float r=length(d);float f=p.z*0.62;return sin((r-f)*26.0)*exp(-pow((r-f)*6.5,2.0))*exp(-p.z*1.9)*p.w;}
float pat(vec2 t,float o){return 0.6+0.4*sin(5.0*(t.x+t.y+cos(3.0*t.x+5.0*t.y)+0.02*o)+sin(20.0*(t.x+t.y-0.1*o)));}
vec2 rot(vec2 uv,float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c)*uv;}
void main(){
  vec2 U=vUv; float tO=0.9*uTime, asp=uAsp;
  vec2 wd=vec2((U.x-0.5)*asp,U.y-0.5); float wr=max(length(wd),0.0001); vec2 dir=wd/wr;
  float rho=pow(0.32,uWarp)*pow(wr+0.035*uWarp,1.0-2.0*uWarp)+uDepth*uWarp;
  float sp=uSpin*uWarp, cs=cos(sp), sn=sin(sp); vec2 sdir=vec2(dir.x*cs-dir.y*sn,dir.x*sn+dir.y*cs);
  vec2 cu=vec2((U.x-0.5)*asp,U.y-0.5); float cr=uCam.w; cu=vec2(cu.x*cos(cr)-cu.y*sin(cr),cu.x*sin(cr)+cu.y*cos(cr))/uCam.x; cu=vec2(cu.x/asp,cu.y)+0.5+uCam.yz;
  vec2 tex=mix(rot(cu*0.85,0.5)*0.85, vec2(rho*0.55+sdir.x*0.55,rho*0.35+sdir.y*0.55), uWarp);
  vec2 md=vec2((U.x-uMouse.x)*asp,U.y-uMouse.y); float mr=length(md);
  float mA=uMouseAmt*(1.0-uWarp), pull=exp(-mr*mr*9.0)*mA, lift=exp(-mr*mr*4.5)*mA;
  tex+=md*exp(-mr*mr*6.0)*mA*1.5; tex.y-=lift*0.05;
  float rp=ripple(uP0,U,asp)+ripple(uP1,U,asp); tex+=vec2(rp*0.09,rp*0.07);
  tex.y+=0.03*sin(8.0*tex.x-tO);
  float pattern=pat(tex,tO);
  vec3 col=uColor, r=col*pattern;
  float sheen=smoothstep(0.62,1.0,pattern); r+=uBloom*(pow(sheen,2.0)*0.55+pow(sheen,6.0)*0.85)*mix(col*2.2,vec3(1.0),0.45);
  r+=mix(col*2.0,vec3(1.0),0.35)*(lift*0.35+pull*0.3)*(0.3+0.7*pattern);
  float swd=dot(vec2((U.x-0.5)*asp,U.y-0.5),normalize(vec2(1.0,0.42))); float sw=exp(-pow((swd-uSweep.x)*uSweep.z,2.0))*uSweep.y*(1.0-uWarp);
  r+=mix(col*2.3,vec3(1.0),0.5)*sw*(0.12+0.88*smoothstep(0.6,1.0,pattern));
  r+=mix(col*2.4,vec3(1.0),0.5)*abs(rp)*0.5;
  float ab=smoothstep(0.015,0.42,wr); r*=mix(1.0,ab*ab*(1.0+0.35*smoothstep(0.35,0.9,wr)),uWarp);
  float sa=(atan(sdir.y,sdir.x)/6.2831853+0.5)*180.0, h=fract(sin(floor(sa)*12.9898)*43758.5453);
  float lane=pow(1.0-abs(fract(sa)-0.5)*2.0,5.0), seg=smoothstep(0.5,1.0,fract(h*17.0+0.22/(wr+0.05)-uDepth*0.9));
  r+=mix(col*2.6,vec3(1.0),0.6)*step(0.84,h)*lane*seg*smoothstep(0.05,0.35,wr)*uSurge*0.9*uWarp;
  r=mix(r,r.gbr*1.05,0.1*uSurge*uWarp);
  r=1.0-exp(-r*1.25);
  r=clamp((mix(vec3(dot(r,vec3(0.2126,0.7152,0.0722))),r,1.12)-0.5)*1.04+0.5,0.0,1.0);
  r=mix(mix(vec3(0.027,0.039,0.075),vec3(0.0),uOledBg), r, uBright);
  o=vec4(r,1.0);
}`;

const MP = { eco: .45e6, balanced: .8e6, high: 1.4e6, ultra: 2.4e6 };

export default class Silk {
  constructor(g, settings) {
    this.g = g; this.prog = g.program('silk', VS, FS);
    this.t = 3.7; this.warp = 0; this.color = null; this.ripples = []; this.lastBeat = 0;
    this.mouse = { x: .5, y: .5 };
    this.setSettings(settings);
  }
  setSettings(s) { this.s = s; }
  resize(w, h, q, wantMips) {
    const [sw, sh] = fitArea(w, h, MP[q] || MP.balanced);
    this.asp = w / h;
    if (this.out && this.out.w === sw && this.out.h === sh && this.out.mips === wantMips) return;
    this.g.free(this.out);
    this.out = this.g.target(sw, sh, { format: 'rgb10', mips: wantMips });
  }
  update(dt, inp) {
    const s = this.s, motion = inp.motion;
    let anim = false;
    const target = hexRGB(s.color);
    if (!this.color) this.color = target.slice();
    const ease = 1 - Math.exp(-dt * 3);
    let cd = 0; this.color = this.color.map((x, i) => { const y = x + (target[i] - x) * ease; cd += Math.abs(target[i] - y); return y; });
    if (cd > 1e-3) anim = true; else this.color = target;
    const wt = s.mode === 'tunnel' ? 1 : 0; this.warp += (wt - this.warp) * ease;
    if (Math.abs(wt - this.warp) > 1e-3) anim = true; else this.warp = wt;
    if (motion && s.speed > 0) { this.t += dt * .1 * s.speed / 90 * 1; anim = true; }
    const p = inp.pointer;
    if (p.active) {
      this.mouse.x += (p.x - this.mouse.x) * ease; this.mouse.y += (p.y - this.mouse.y) * ease;
      if (Math.abs(p.x - this.mouse.x) + Math.abs(p.y - this.mouse.y) > 1e-4) anim = true;
      if (p.clicked && motion) this.ripples = [...this.ripples, { x: p.x, y: p.y, t: this.t, s: .7 }].slice(-2);
    }
    this.mouseAmt = (this.mouseAmt || 0) + ((p.active && motion ? .3 : 0) - (this.mouseAmt || 0)) * ease;
    if (Math.abs(this.mouseAmt - (p.active && motion ? .3 : 0)) > 1e-3) anim = true;
    // Living Silk deliberately ignores audio: its motion is steady, only the cursor disturbs it
    if (motion && this.ripples.some(r => (this.t - r.t) * 10 < 3.2)) anim = true;
    this.resp = 0;
    return anim;
  }
  render(inp) {
    const g = this.g, e = this.t, s = this.s, r = this.ripples;
    g.bindTarget(this.out);
    const rip = i => { const x = r[i], age = x ? (e - x.t) * 10 : 4; return [x ? x.x : 0, x ? x.y : 0, age, x && age < 3.2 ? x.s : 0]; };
    g.use(this.prog, {
      uTime: e, uBloom: s.bloom / 100 * (1 + this.resp * .75), uAsp: this.asp, uWarp: this.warp, uDepth: e * .7, uSpin: e * .13,
      uSurge: this.resp * .35, uColor: this.color, uMouse: [this.mouse.x, this.mouse.y], uMouseAmt: this.mouseAmt,
      uCam: [1.08 + Math.sin(e * .7) * .025, Math.sin(e * .47) * .035, Math.sin(e * .39) * .025, Math.sin(e * .33) * .025],
      uSweep: [Math.sin(e * .48) * 1.4, .16, 3.2], uP0: rip(0), uP1: rip(1), uBright: s.brightness / 100, uOledBg: inp.oled ? 1 : 0,
    });
    g.draw();
  }
  get output() { return this.out; }
  dispose() { this.g.free(this.out); this.out = null; }
}
