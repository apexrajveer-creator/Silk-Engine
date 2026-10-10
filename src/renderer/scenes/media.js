// Video, GIF/WebP/APNG and still images.
//   video : uploaded only when the decoder presents a new frame (requestVideoFrameCallback),
//           into storage that is reused frame after frame.
//   anim  : ImageDecoder streams one frame at a time; never more than one decoded frame alive.
//   still : downscaled during decode to the screen it's shown on; CPU copies dropped after upload.
import { bridge } from '../../shared/bridge.js';

export default class Media {
  constructor(g, settings, item, kick) {
    this.g = g; this.item = item; this.kick = kick; this.s = settings;
    this.tex = null; this.w = this.h = 0; this.texW = this.texH = 0; this.mips = false;
    this.stallRetries = 0; this.lastFrame = performance.now(); this.dirty = false; this.pending = null; this.gen = 0; this.error = null;
    this.flipY = true; this.alpha = true;
  }
  setSettings(s) {
    this.s = s;
    if (this.video) this.video.playbackRate = s.speed / 100;
  }
  resize(w, h, q, wantMips) {
    this.region = [w, h]; this.wantMips = wantMips;
    if (!this.started) { this.started = true; this.load(); }
    if (this.kind === 'video' || this.kind === 'anim') this.dirty = true;
    else if (this.kind === 'still' && wantMips && !this.mips) this.reload();
  }
  async load() {
    const gen = ++this.gen; this.error = null; this.noVFC = false; this.seen = false; this.lastFrame = performance.now();
    try {
      const url = await bridge.mediaURL(this.item);
      if (!url) throw new Error('file missing');
      if (gen !== this.gen) { if (url.startsWith('blob:')) URL.revokeObjectURL(url); return; }
      this.url = url;
      if (this.item.kind === 'video') await this.loadVideo(url, gen);
      else await this.loadImage(url, gen);
    } catch (e) {
      if (gen !== this.gen) return;
      console.warn('[media]', this.item.name, e);
      this.error = String(e.message || e);
    }
    this.kick();
  }
  reload() { this.unload(); this.started = true; this.load(); }

  async loadVideo(url, gen) {
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous'; v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto';
    v.disablePictureInPicture = true; v.setAttribute('disableremoteplayback', '');
    v.src = url; v.playbackRate = this.s.speed / 100;
    document.getElementById('decoders').append(v); // kept in the DOM as a 2px decode source so it is never throttled
    this.video = v; this.kind = 'video';
    await new Promise((res, rej) => {
      const finish = error => { clearTimeout(this.loadTimer); this.cancelLoad = null; v.onloadeddata = v.onerror = null; error ? rej(error) : res(); };
      this.cancelLoad = () => finish(new Error('Load cancelled'));
      this.loadTimer = setTimeout(() => finish(new Error('Video took too long to load')), 15000);
      v.onloadeddata = () => finish(); v.onerror = () => finish(new Error(v.error?.message || 'Unsupported or missing video'));
    });
    v.onerror = () => { this.error = v.error?.message || 'Video playback failed'; v.pause(); this.kick(); };
    if (gen !== this.gen) return;
    if (this.resumeAt) { try { v.currentTime = this.resumeAt; } catch (e) { } this.resumeAt = 0; }
    this.w = v.videoWidth; this.h = v.videoHeight; this.dirty = true;
    if ('requestVideoFrameCallback' in v) {
      const onFrame = () => { if (this.video !== v) return; this.lastFrame = performance.now(); this.seen = true; this.dirty = true; this.kick(); v.requestVideoFrameCallback(onFrame); };
      v.requestVideoFrameCallback(onFrame);
      setTimeout(() => { if (this.video === v && !this.seen && !v.paused) this.noVFC = true; }, 1500);
    } else this.noVFC = true;
    if (!this.paused) v.play().catch(() => { });
  }

  async loadImage(url, gen) {
    const ext = (this.item.path || '').split('.').pop().toLowerCase();
    const type = { gif: 'image/gif', webp: 'image/webp', png: 'image/png', apng: 'image/apng', avif: 'image/avif' }[ext];
    if (type && 'ImageDecoder' in window && await ImageDecoder.isTypeSupported(type)) {
      this.fetchAbort = new AbortController();
      const res = await fetch(url, { signal: this.fetchAbort.signal });
      if (!res.ok) throw new Error('Image file is unavailable');
      const dec = new ImageDecoder({ data: res.body, type });
      await dec.tracks.ready;
      if (gen !== this.gen) { dec.close(); return; }
      if (dec.tracks.selectedTrack && dec.tracks.selectedTrack.animated) {
        this.kind = 'anim'; this.dec = dec; this.idx = 0; this.due = 0;
        dec.completed.catch(() => { });
        this.chain = (this.chain || 0) + 1;
        return this.animTick(gen, this.chain);
      }
      dec.close();
    }
    const img = new Image(); img.decoding = 'async'; img.crossOrigin = 'anonymous'; img.src = url;
    await img.decode();
    if (gen !== this.gen) return;
    let iw = img.naturalWidth || 1920, ih = img.naturalHeight || 1080;
    const [rw, rh] = this.region || [1920, 1080];
    const s = Math.max(rw / iw, rh / ih);
    let src = img;
    if (s < 1 || !img.naturalWidth) {
      const k = Math.min(1, s);
      src = await createImageBitmap(img, { resizeWidth: Math.round(iw * k), resizeHeight: Math.round(ih * k), resizeQuality: 'high' });
      iw = src.width; ih = src.height;
    }
    if (gen !== this.gen) { src.close && src.close(); return; }
    this.kind = 'still';
    this.upload(src, iw, ih, this.wantMips);
    src.close && src.close();
    img.removeAttribute('src');
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  }

  async animTick(gen, chain) {
    if (gen !== this.gen || chain !== this.chain || !this.dec || this.paused) { this.due = 0; return; }
    let r;
    try { r = await this.dec.decode({ frameIndex: this.idx }); }
    catch (e) { if (this.idx > 0 && gen === this.gen) { this.idx = 0; return this.animTick(gen, chain); } throw e; }
    if (gen !== this.gen || chain !== this.chain) { r.image.close(); return; }
    const f = r.image; let d = (f.duration || 0) / 1000; if (d <= 10) d = 100;
    if (this.pending) this.pending.close();
    this.pending = f; this.w = f.displayWidth; this.h = f.displayHeight;
    this.idx = (this.idx + 1) % (this.dec.tracks.selectedTrack.frameCount || 1);
    const now = performance.now();
    this.due = (this.due && now - this.due < 1000 ? this.due : now) + d / (this.s.speed / 100);
    this.timer = setTimeout(() => this.animTick(gen, chain).catch(() => { }), Math.max(0, this.due - now));
    this.kick();
  }

  upload(src, w, h, keepMips) {
    const g = this.g, gl = g.gl;
    if (!this.tex) { this.tex = gl.createTexture(); this.texW = this.texH = 0; }
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    try {
      if (w === this.texW && h === this.texH) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
      else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
        this.texW = w; this.texH = h;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      }
    } catch (e) { this.error = 'GPU upload blocked: ' + e.name; return false; }
    const mips = !!(this.wantMips || keepMips);
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    else if (this.mips) this.texW = 0; // drop the mip chain on next upload to hand the memory back
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    g.bytes -= this.bytes || 0; this.bytes = w * h * 4 * (mips ? 4 / 3 : 1); g.bytes += this.bytes;
    this.mips = mips; this.w = w; this.h = h;
    return true;
  }

  update() {
    if (this.kind === 'video' && this.noVFC && this.video && !this.video.paused) return true;
    return this.dirty || !!this.pending;
  }
  render() {
    const v = this.video;
    if (v && v.currentTime !== this.lastVideoTime) { this.lastVideoTime = v.currentTime; this.lastFrame = performance.now(); }
    if (this.kind === 'video' && v && (this.dirty || this.noVFC) && v.readyState >= 2) this.upload(v, v.videoWidth, v.videoHeight);
    else if (this.pending) { const f = this.pending; this.pending = null; this.upload(f, f.displayWidth, f.displayHeight); f.close(); }
    this.dirty = false;
  }
  get output() { return this.tex && this.texW ? { tex: this.tex, w: this.texW, h: this.texH, mips: this.mips } : null; }

  health() {
    const v = this.video;
    if (!v || this.paused || v.paused || this.error) { this.lastFrame = performance.now(); return; }
    if (performance.now() - this.lastFrame > 15000) {
      this.lastFrame = performance.now();
      if (this.stallRetries++ < 2) this.reload();
      else { this.error = 'Video decoder stopped responding'; v.pause(); this.kick(); }
    }
  }
  pause(p) {
    if (this.paused === p) return;
    this.paused = p; this.lastFrame = performance.now();
    if (this.video) p ? this.video.pause() : this.video.play().catch(() => { });
    if (this.kind === 'anim') { clearTimeout(this.timer); if (!p) { this.due = 0; this.chain++; this.animTick(this.gen, this.chain).catch(() => { }); } }
  }
  unload() {
    this.gen++; clearTimeout(this.timer); clearTimeout(this.loadTimer); this.cancelLoad?.(); this.fetchAbort?.abort();
    if (this.pending) { this.pending.close(); this.pending = null; }
    if (this.dec) { try { this.dec.close(); } catch (e) { } this.dec = null; }
    if (this.video) { this.resumeAt = this.video.currentTime; this.video.pause(); this.video.removeAttribute('src'); this.video.load(); this.video.remove(); this.video = null; }
    if (this.tex) { this.g.gl.deleteTexture(this.tex); this.g.bytes -= this.bytes || 0; this.bytes = 0; this.tex = null; this.texW = 0; }
    if (this.url && this.url.startsWith('blob:')) URL.revokeObjectURL(this.url);
    this.kind = null; this.started = false;
  }
  dispose() { this.unload(); }
}
