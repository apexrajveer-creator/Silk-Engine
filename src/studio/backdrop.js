import { navigationBusy } from './scrolling.js';
// Living-silk backdrop for the Studio.
//
// Built to stay smooth on weak machines:
//  * the silk is band-limited, so it renders at 1/2 (or 1/3 on weak devices) of window
//    resolution and the browser's bilinear upscale is indistinguishable from native;
//  * grain, vignette and the darkening veil are baked into this one shader, so the page has a
//    single background layer instead of three full-screen blended ones;
//  * it runs at 30 fps (20 on weak devices), drops to 8 fps when the window isn't focused,
//    stops entirely while minimised, and renders a single still frame for reduced motion;
//  * if frames start arriving late it steps itself down automatically and tells the page to
//    switch to "lite" styling (no live blur), so the UI never stutters.
export function backdrop(canvas, { onLite } = {}) {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
  if (!gl) { canvas.style.background = 'radial-gradient(120% 90% at 70% 20%,#2a2d36,#000 70%)'; return; }
  const fs = `precision highp float;
uniform vec2 uRes; uniform float uTime;
float pat(vec2 t,float o){return 0.6+0.4*sin(5.0*(t.x+t.y+cos(3.0*t.x+5.0*t.y)+0.02*o)+sin(20.0*(t.x+t.y-0.1*o)));}
float hash(vec2 p){vec3 q=fract(vec3(p.xyx)*0.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes; float asp=uRes.x/uRes.y; float t=uTime;
  vec2 cu=vec2((uv.x-0.5)*asp,uv.y-0.5);
  float cr=sin(t*0.33)*0.025; cu=vec2(cu.x*cos(cr)-cu.y*sin(cr),cu.x*sin(cr)+cu.y*cos(cr))/(1.08+sin(t*0.7)*0.025);
  cu=vec2(cu.x/asp,cu.y)+0.5+vec2(sin(t*0.47)*0.035,sin(t*0.39)*0.025);
  float a=0.5,c=cos(a),s=sin(a);
  vec2 tex=mat2(c,-s,s,c)*(cu*0.85)*0.85;
  tex.y+=0.03*sin(8.0*tex.x-t*0.9);
  float p=pat(tex,t*0.9);
  vec3 base=vec3(0.30,0.32,0.37);                       // graphite silver, the Logbook palette
  vec3 col=base*p;
  float sheen=smoothstep(0.62,1.0,p);
  col+=(pow(sheen,2.0)*0.5+pow(sheen,6.0)*0.8)*vec3(0.78,0.80,0.86)*0.6;
  float swd=dot(vec2((uv.x-0.5)*asp,uv.y-0.5),normalize(vec2(1.0,0.42)));
  col+=vec3(0.8,0.82,0.9)*exp(-pow((swd-sin(t*0.48)*1.4)*3.2,2.0))*0.10*(0.2+0.8*smoothstep(0.6,1.0,p));
  col=1.0-exp(-col*1.1);
  // veil: dark at the top where titles sit, deepest at the edges
  vec2 v=vec2(uv.x-0.5,(1.0-uv.y)+0.14); float r=length(v*vec2(0.74,1.0));
  float veil=mix(0.96,0.58,smoothstep(0.0,0.62,r));
  veil=mix(veil,0.84,smoothstep(0.62,1.15,r));
  col*=1.0-veil;
  col-=hash(gl_FragCoord.xy+fract(t)*91.0)*0.012;        // grain, also kills 8-bit banding
  gl_FragColor=vec4(max(col,0.0),1.0);
}`;
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}'));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return;
  gl.useProgram(p);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const uRes = gl.getUniformLocation(p, 'uRes'), uTime = gl.getUniformLocation(p, 'uTime');

  const weak = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let lite = weak, scale = weak ? 1 / 3 : 1 / 2, fps = weak ? 20 : 30;
  if (lite) onLite?.(true);

  let raf = 0, last = 0, t = 7, slow = 0, frames = 0, focused = document.hasFocus();
  const size = () => {
    const w = Math.max(1, Math.round(innerWidth * scale)), h = Math.max(1, Math.round(innerHeight * scale));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
    gl.uniform2f(uRes, w, h);
  };
  const paint = () => { gl.uniform1f(uTime, t); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); };
  const step = now => {
    raf = 0;
    if (document.hidden || navigationBusy()) return;
    const interval = 1000 / (focused ? fps : 8);
    const gap = now - last;
    if (gap >= interval - 2) {
      if (last && focused) {
        // frames arriving much later than asked = the machine is struggling: step down once
        if (gap > interval * 1.8) slow++; else slow = Math.max(0, slow - 0.25);
        if (++frames > 90 && slow > 25 && !lite) { lite = true; scale = 1 / 3; fps = 20; size(); onLite?.(true); }
      }
      t += Math.min(0.1, gap / 1000) * 0.32; last = now; paint();
    }
    raf = requestAnimationFrame(step);
  };
  const kick = () => { if (!raf && !reduce && !document.hidden && !navigationBusy()) { last = performance.now(); raf = requestAnimationFrame(step); } };
  document.addEventListener('studio-navigation-start',()=>{cancelAnimationFrame(raf);raf=0;});
  document.addEventListener('studio-navigation-idle',kick);
  size(); paint();
  kick();
  let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { size(); paint(); }, 80); });
  document.addEventListener('visibilitychange', kick);
  addEventListener('focus', () => { focused = true; kick(); });
  addEventListener('blur', () => { focused = false; });
}
