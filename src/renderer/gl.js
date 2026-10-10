// WebGL2 core shared by every scene: one context, one full-screen triangle, program and
// render-target helpers, and the display-resolution composite pass.

export const VS = `#version 300 es
in vec2 p; out vec2 vUv;
void main(){ vUv = p*0.5+0.5; gl_Position = vec4(p,0.0,1.0); }`;

export class GL {
  constructor(canvas) {
    // No depth/stencil/MSAA/alpha/preserved buffer: each of those is a full-screen allocation we never use.
    const attrs = { alpha: false, depth: false, stencil: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power' };
    const gl = canvas.getContext('webgl2', attrs);
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.float = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    this.p3 = false;
    try {
      if (matchMedia('(color-gamut: p3)').matches && 'drawingBufferColorSpace' in gl) { gl.drawingBufferColorSpace = 'display-p3'; this.p3 = gl.drawingBufferColorSpace === 'display-p3'; }
    } catch (e) { }
    // full-screen quad; attribute 0 everywhere
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.emptyVao = gl.createVertexArray(); // for attribute-less draws (particles use gl_VertexID)
    this.programs = new Map();
    this.bytes = 0;
    this.black = this.texture(1, 1, { data: new Uint8Array([0, 0, 0, 255]) });
    // bytes tracks every live GPU allocation, including the fallback texture.
    this.comp = this.program('composite', VS, COMPOSITE);
  }

  program(name, vs, fs) {
    if (this.programs.has(name)) return this.programs.get(name);
    const gl = this.gl;
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(name + ': ' + gl.getShaderInfoLog(o)); return o; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(name + ': ' + gl.getProgramInfoLog(p));
    const prog = { p, u: {}, units: {} };
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    let unit = 0;
    gl.useProgram(p);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i), loc = gl.getUniformLocation(p, info.name);
      prog.u[info.name.replace(/\[0\]$/, '')] = loc;
      if (info.type === gl.SAMPLER_2D) { prog.units[info.name] = unit; gl.uniform1i(loc, unit++); }
    }
    this.programs.set(name, prog);
    return prog;
  }

  /** Bind program, set uniforms by value shape, bind textures by sampler name. */
  use(prog, uniforms = {}) {
    const gl = this.gl;
    gl.useProgram(prog.p);
    for (const [k, v] of Object.entries(uniforms)) {
      const loc = prog.u[k]; if (loc == null) continue;
      if (k in prog.units) { gl.activeTexture(gl.TEXTURE0 + prog.units[k]); gl.bindTexture(gl.TEXTURE_2D, (v && v.tex) || v || this.black); continue; }
      if (typeof v === 'number') gl.uniform1f(loc, v);
      else if (v.length === 2) gl.uniform2fv(loc, v);
      else if (v.length === 3) gl.uniform3fv(loc, v);
      else if (v.length === 4) gl.uniform4fv(loc, v);
    }
    return prog;
  }

  draw() { const gl = this.gl; gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }

  static FORMATS = {
    rgba8: [0x8058 /*RGBA8*/, 0x1908 /*RGBA*/, 0x1401 /*UBYTE*/, 4],
    rgb10: [0x8059 /*RGB10_A2*/, 0x1908, 0x8368 /*UINT_2_10_10_10_REV*/, 4],
    rgba16f: [0x881A, 0x1908, 0x140B /*HALF_FLOAT*/, 8],
    rg16f: [0x822F, 0x8227 /*RG*/, 0x140B, 4],
    r16f: [0x822D, 0x1903 /*RED*/, 0x140B, 2],
    rgba32f: [0x8814, 0x1908, 0x1406 /*FLOAT*/, 16],
  };

  texture(w, h, { format = 'rgba8', filter = 'linear', wrap = 'clamp', mips = false, data = null } = {}) {
    const gl = this.gl, [ifmt, fmt, type, bpp] = GL.FORMATS[format];
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, data);
    const f = filter === 'nearest' ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : f);
    const wr = wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wr); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wr);
    const size = w * h * bpp * (mips ? 4 / 3 : 1);
    this.bytes += size;
    return { tex, w, h, format, mips, size };
  }

  /** A texture you can render into. */
  target(w, h, opts = {}) {
    const gl = this.gl;
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    let format = opts.format || 'rgb10';
    if ((format === 'rgba16f' || format === 'rg16f' || format === 'r16f' || format === 'rgba32f') && !this.float) format = 'rgba8';
    const t = this.texture(w, h, { ...opts, format });
    t.fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      this.free(t);
      if (format !== 'rgba8') return this.target(w, h, { ...opts, format: 'rgba8' });
      throw new Error('framebuffer incomplete');
    }
    if (t.mips) gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return t;
  }

  /** Two targets you can swap (simulation state). */
  pingpong(w, h, opts) { const a = this.target(w, h, opts), b = this.target(w, h, opts); return { read: a, write: b, swap() { const t = this.read; this.read = this.write; this.write = t; }, w: a.w, h: a.h }; }

  bindTarget(t) { const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null); if (t) gl.viewport(0, 0, t.w, t.h); }

  mip(t) { if (t && t.mips) { const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, t.tex); gl.generateMipmap(gl.TEXTURE_2D); } }

  free(t) {
    if (!t) return; const gl = this.gl;
    if (t.read) { this.free(t.read); this.free(t.write); return; }
    if (t.tex) gl.deleteTexture(t.tex);
    if (t.fb) gl.deleteFramebuffer(t.fb);
    this.bytes -= t.size || 0; t.tex = t.fb = null; t.size = 0;
  }
}

// Display-resolution composite. Scenes render small; this pass reconstructs them at the
// monitor's resolution and applies everything that must happen per display pixel.
const COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTex;
uniform vec2 uTexSize;
uniform vec4 uMap;        // tex uv = uMap.xy + vUv * uMap.zw
uniform vec2 uVp;         // viewport size in px
uniform vec4 uFx;         // brightness, glow, sharpen, alpha-as-coverage
uniform vec4 uLod;        // base lod, local-adaptation lod, mips available, bicubic
uniform vec4 uOled;       // intensity (0=off), black knee, vignette strength, P3 output
uniform vec4 uColour;     // brightness, contrast, saturation, temperature
uniform vec2 uLook;       // grain, frame
uniform vec4 uShadow;     // emblem shadow: centre xy, radius zw (0 = none)
const mat3 P3 = mat3(0.8225,0.0332,0.0171, 0.1774,0.9669,0.0724, 0.0,0.0,0.9108);
float luma(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }
vec3 lin(vec3 c){ return pow(max(c,0.0), vec3(2.2)); }
vec3 enc(vec3 c){ return pow(max(c,0.0), vec3(1.0/2.2)); }
float ign(vec2 p){ return fract(52.9829189*fract(dot(p, vec2(0.06711056,0.00583715)))); }
float hash(vec2 p){ vec3 q=fract(vec3(p.xyx)*0.1031); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }
// Catmull-Rom from 9 bilinear taps
vec4 cubic(vec2 uv){
  vec2 sz=uTexSize, sp=uv*sz, t1=floor(sp-0.5)+0.5, f=sp-t1;
  vec2 w0=f*(-0.5+f*(1.0-0.5*f)), w1=1.0+f*f*(-2.5+1.5*f), w2=f*(0.5+f*(2.0-1.5*f)), w3=f*f*(-0.5+0.5*f);
  vec2 w12=w1+w2, a=(t1-1.0)/sz, b=(t1+2.0)/sz, m=(t1+w2/w12)/sz;
  float L=uLod.x;
  return textureLod(uTex,vec2(a.x,a.y),L)*w0.x*w0.y + textureLod(uTex,vec2(m.x,a.y),L)*w12.x*w0.y + textureLod(uTex,vec2(b.x,a.y),L)*w3.x*w0.y
       + textureLod(uTex,vec2(a.x,m.y),L)*w0.x*w12.y + textureLod(uTex,vec2(m.x,m.y),L)*w12.x*w12.y + textureLod(uTex,vec2(b.x,m.y),L)*w3.x*w12.y
       + textureLod(uTex,vec2(a.x,b.y),L)*w0.x*w3.y + textureLod(uTex,vec2(m.x,b.y),L)*w12.x*w3.y + textureLod(uTex,vec2(b.x,b.y),L)*w3.x*w3.y;
}
void main(){
  vec2 fc = gl_FragCoord.xy;
  vec2 uv = uMap.xy + vUv*uMap.zw;
  float inside = step(0.0,uv.x)*step(uv.x,1.0)*step(0.0,uv.y)*step(uv.y,1.0);
  vec2 cuv = clamp(uv, 0.0, 1.0);
  vec4 t = uLod.w > 0.5 ? clamp(cubic(cuv),0.0,1.0) : texture(uTex, cuv);
  if(uFx.z > 0.0){ // contrast-limited sharpening at one display pixel
    vec2 d = abs(uMap.zw)/uVp;
    vec3 n = texture(uTex,cuv+vec2(d.x,0)).rgb + texture(uTex,cuv-vec2(d.x,0)).rgb + texture(uTex,cuv+vec2(0,d.y)).rgb + texture(uTex,cuv-vec2(0,d.y)).rgb;
    t.rgb = clamp(t.rgb + clamp((t.rgb-n*0.25)*uFx.z*1.6,-0.1,0.1), 0.0, 1.0);
  }
  float cover = inside * (uFx.w > 0.5 ? t.a : 1.0);
  vec3 c = t.rgb * uFx.x * cover;
  vec3 local = c;
  if(uLod.z > 0.5){
    local = textureLod(uTex, cuv, uLod.y).rgb * uFx.x;
    if(uFx.y > 0.0){ // bloom straight from the mip chain: no extra passes or buffers
      vec3 g = textureLod(uTex,cuv,uLod.x+2.5).rgb*0.45 + textureLod(uTex,cuv,uLod.x+4.5).rgb*0.35 + textureLod(uTex,cuv,uLod.x+6.5).rgb*0.2;
      g = max(g*uFx.x - 0.5, 0.0)*2.0; c += g*g*uFx.y*inside;
    }
  }
  if(uShadow.z > 0.0){ vec2 sd=(vUv-uShadow.xy)/uShadow.zw; c *= 1.0 - 0.1*exp(-dot(sd,sd)*1.7); }
  // Existing composite pass: no new textures, render targets or timers.
  c *= uColour.x;
  c = max((c - 0.5) * uColour.y + 0.5, 0.0);
  c = max(mix(vec3(luma(c)), c, uColour.z), 0.0);
  c *= vec3(1.0 + uColour.w * .15, 1.0, 1.0 - uColour.w * .15);
  c *= inside;
  float os = uOled.x;
  c = max(c - hash(fc)*uLook.x*(1.0-0.7*os), 0.0);
  vec2 vq = (vUv-0.5)*2.0; float vd = length(vq)*0.70710678;
  if(os <= 0.0){
    c *= 1.0 - uOled.z*smoothstep(0.3,1.05,vd)*0.75;
    if(uOled.w > 0.5) c = enc(P3*lin(c));
  } else {
    vec3 l = lin(c); float L = luma(l)+1e-5, Ll = luma(lin(local))+1e-5;
    float Lo = min(L*pow(L/Ll, 0.32*os), L*3.0);              // contrast against own surroundings
    Lo *= 1.0 + 0.4*os*smoothstep(0.2,0.9,Lo);                 // emissive highlight pop
    float k = uOled.y; Lo *= smoothstep(k, k*3.0+1e-4, Lo);    // smooth knee into true #000
    float vg = 1.0 - smoothstep(0.4,1.08,vd)*uOled.z; Lo *= vg*vg;
    l *= Lo/L;
    if(uOled.w > 0.5) l = P3*l;
    float mx=max(l.r,max(l.g,l.b)), mn=min(l.r,min(l.g,l.b)), sat=(mx-mn)/(mx+1e-5);
    l = max(mix(vec3(luma(l)), l, 1.0+0.5*os*(1.0-sat)*smoothstep(0.0,0.04,mx)), 0.0); // vibrance
    mx = max(l.r,max(l.g,l.b));
    if(mx > 0.85) l *= (0.85+0.15*(1.0-exp(-(mx-0.85)/0.15)))/mx; // hue-preserving roll-off
    c = enc(l);
  }
  // triangular temporal dither; never lifts a true-black pixel
  float n = ign(fc+uLook.y*5.588238) + ign(fc.yx*1.37+19.19+uLook.y*3.17) - 1.0;
  c += n/255.0 * smoothstep(0.0, 3.0/255.0, max(c.r,max(c.g,c.b)));
  o = vec4(clamp(c,0.0,1.0), 1.0);
}`;
