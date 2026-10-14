// Animate the actual content height, including async app/device list changes.
// Observe the inner content only: animating the outer box never schedules a frame loop.
export function createDrawerMotion(root, content, {
  reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  setTimer = setTimeout, clearTimer = clearTimeout,
  observe = callback => new ResizeObserver(callback),
  onCollapsed = () => {}, duration = 220,
} = {}) {
  let open = false, closing = false, disposed = false, measureTimer = null, finishTimer = null, lastHeight = -1;
  const clear = () => {
    if (measureTimer !== null) clearTimer(measureTimer);
    if (finishTimer !== null) clearTimer(finishTimer);
    measureTimer = finishTimer = null;
  };
  function measure() {
    measureTimer = null;
    if (!open || disposed) return;
    const height = Math.ceil(content.getBoundingClientRect?.().height ?? content.scrollHeight ?? 0) + 2;
    if (height !== lastHeight) { lastHeight = height; root.style.setProperty('height', `${height}px`); }
  }
  function refresh() {
    if (!open || disposed || measureTimer !== null) return;
    measureTimer = setTimer(measure, 0);
  }
  function collapsed() {
    if (open || !closing || disposed) return;
    closing = false;
    if (finishTimer !== null) clearTimer(finishTimer);
    finishTimer = null; onCollapsed();
  }
  const observer = observe(refresh); observer.observe(content);
  function transitionEnd(event) { if (event.target === root && event.propertyName === 'height') collapsed(); }
  root.addEventListener('transitionend', transitionEnd);
  return {
    setOpen(value, { immediate = false } = {}) {
      if (disposed) return;
      clear(); open = !!value; closing = !open;
      root.dataset.open = String(open);
      root.dataset.instant = String(immediate || reduced());
      if (open) measure();
      else {
        lastHeight = 0; root.style.setProperty('height', '0px');
        if (immediate || reduced()) collapsed();
        else finishTimer = setTimer(collapsed, duration + 40);
      }
    },
    refresh,
    settle() {
      if (disposed) return;
      clear(); root.dataset.instant = 'true';
      if (open) measure(); else { root.style.setProperty('height', '0px'); collapsed(); }
    },
    dispose() { clear(); disposed = true; observer.disconnect(); root.removeEventListener?.('transitionend', transitionEnd); },
  };
}
