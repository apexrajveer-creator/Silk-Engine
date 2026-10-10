/* ECHELON web wallpaper runtime.
 * Injected into every web wallpaper's entry page by the wp:// protocol.
 *
 *  - Native API:   window.echelon.onAudio(cb(bands[32])), onCursor(cb({x,y,down})), onPause(cb(bool))
 *  - Wallpaper Engine compatibility: wallpaperRegisterAudioListener (128 values, L/R), 
 *    wallpaperPropertyListener.applyUserProperties with the defaults from project.json, and setPaused.
 *    Most unpacked Wallpaper Engine *web* wallpapers run unmodified.
 */
(function () {
  if (window.echelon) return;
  var audio = [], cursor = [], pause = [], weAudio = [];
  window.echelon = {
    version: 1,
    onAudio: function (cb) { audio.push(cb); },
    onCursor: function (cb) { cursor.push(cb); },
    onPause: function (cb) { pause.push(cb); },
  };
  window.wallpaperRegisterAudioListener = function (cb) { weAudio.push(cb); };
  window.wallpaperRegisterMediaStatusListener = function () {};
  window.wallpaperRegisterMediaPropertiesListener = function () {};
  window.wallpaperRegisterMediaThumbnailListener = function () {};
  window.wallpaperRegisterMediaPlaybackListener = function () {};
  window.wallpaperRegisterMediaTimelineListener = function () {};

  var we = new Array(128);
  function toWE(bands) { // 32 log bands -> WE's 64 per channel, mirrored to both channels
    for (var i = 0; i < 64; i++) {
      var f = i / 63 * 31, a = Math.floor(f), b = Math.min(31, a + 1), t = f - a;
      var v = (bands[a] || 0) * (1 - t) + (bands[b] || 0) * t;
      we[i] = v; we[i + 64] = v;
    }
    return we;
  }
  var lastEl = null;
  function mouse(type, x, y, el) {
    var ev = new MouseEvent(type, { clientX: x, clientY: y, screenX: x, screenY: y, bubbles: true, cancelable: true, view: window });
    (el || document).dispatchEvent(ev);
  }
  var down = false;
  window.addEventListener('message', function (e) {
    var d = e.data; if (e.source !== window.parent || !d || !d.echelon) return;
    if (d.echelon === 'audio') {
      if (!Array.isArray(d.bands) || d.bands.length !== 32 || d.bands.some(function(v){return !Number.isFinite(v);})) return;
      for (var i = 0; i < audio.length; i++) try { audio[i](d.bands); } catch (x) { }
      if (weAudio.length) { var arr = toWE(d.bands); for (var j = 0; j < weAudio.length; j++) try { weAudio[j](arr); } catch (x) { } }
    } else if (d.echelon === 'cursor') {
      if (!Number.isFinite(d.x) || !Number.isFinite(d.y)) return;
      for (var k = 0; k < cursor.length; k++) try { cursor[k](d); } catch (x) { }
      var el = document.elementFromPoint(d.x, d.y) || document.body;
      if (el !== lastEl) { if (lastEl) mouse('mouseout', d.x, d.y, lastEl); mouse('mouseover', d.x, d.y, el); lastEl = el; }
      mouse('mousemove', d.x, d.y, el);
      if (d.down && !down) { mouse('mousedown', d.x, d.y, el); }
      if (!d.down && down) { mouse('mouseup', d.x, d.y, el); mouse('click', d.x, d.y, el); }
      down = !!d.down;
    } else if (d.echelon === 'paused') {
      for (var m = 0; m < pause.length; m++) try { pause[m](d.value); } catch (x) { }
      var l = window.wallpaperPropertyListener; if (l && l.setPaused) try { l.setPaused(!!d.value); } catch (x) { }
    }
  });

  // Wallpaper Engine project.json -> apply default user properties once the page has loaded.
  function applyProject(p) {
    var props = (p && p.general && p.general.properties) || {};
    var general = { fps: 60 };
    function go() {
      var l = window.wallpaperPropertyListener; if (!l) return;
      try { l.applyGeneralProperties && l.applyGeneralProperties(general); } catch (x) { }
      try { l.applyUserProperties && l.applyUserProperties(props); } catch (x) { console.warn(x); }
    }
    if (document.readyState === 'complete') setTimeout(go, 0); else window.addEventListener('load', function () { setTimeout(go, 0); });
  }
  try { fetch('project.json').then(function (r) { return r.ok ? r.json() : null; }).then(applyProject).catch(function () { }); } catch (x) { }
})();
