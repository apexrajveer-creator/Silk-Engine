// Kept independent of the Studio module graph so broken imports remain recoverable.
(() => {
  const panel = document.getElementById('startupFailure');
  const show = message => {
    document.getElementById('startupMessage').textContent = String(message).slice(0, 500);
    panel.hidden = false;
  };
  window.silkStartupFailed = show;
  document.getElementById('startupRetry').onclick = () => location.reload();
  setTimeout(() => { if (!window.silkReady) show('Studio could not finish loading. Reload to retry. If it repeats, keep the error message when reporting the problem.'); }, 15000);
})();
