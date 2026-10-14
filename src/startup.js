// Kept independent of the Studio module graph so broken imports remain recoverable.
(() => {
  const panel = document.getElementById('startupFailure');
  let revealPromise;
  window.silkRevealStudio = () => revealPromise ||= (async () => {
    const native = window.__TAURI__?.core;
    if (!native) return;
    // Flush local layout before showing the native window, then fade the painted UI in.
    document.body.classList.add('studio-opening');
    void document.body.offsetHeight;
    // Hidden WebView2 surfaces may suspend rAF; the bounded fallback prevents a stuck launch.
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 50);
      requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); }));
    });
    try { await native.invoke('studio_ready'); }
    finally { requestAnimationFrame(() => document.body.classList.remove('studio-opening')); }
  })().catch(error => { revealPromise = null; console.error('Studio reveal failed', error); });
  const show = message => {
    document.getElementById('startupMessage').textContent = String(message).slice(0, 500);
    panel.hidden = false;
    void window.silkRevealStudio();
  };
  window.silkStartupFailed = show;
  document.getElementById('startupRetry').onclick = () => location.reload();
  setTimeout(() => { if (!window.silkReady) show('Studio could not finish loading. Reload to retry. If it repeats, keep the error message when reporting the problem.'); }, 15000);
})();
