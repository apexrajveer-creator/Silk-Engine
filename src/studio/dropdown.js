// Glass dropdowns. Native <select> popups are drawn by Windows and ignore CSS, so every select in the
// Studio gets a button + listbox in the app's design language. The real <select> stays in the DOM
// (hidden) as the source of truth: existing code keeps reading .value and listening for change,
// and programmatic .value changes update the button.
const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
const idxDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
let open = null;

function label(sel) {
  const o = sel.options[sel.selectedIndex];
  return o ? o.textContent : '';
}
function sync(sel) { const b = sel._dd; if (!b) return; b.querySelector('.dd-value').textContent = label(sel); b.disabled = sel.disabled; }

function close(focus = true) {
  if (!open) return;
  const { menu, sel } = open; open = null;
  sel._dd.setAttribute('aria-expanded', 'false');
  menu.classList.add('dd-out'); setTimeout(() => menu.remove(), 120);
  if (focus) sel._dd.focus({ preventScroll: true });
}
function choose(sel, i) {
  if (i < 0 || i >= sel.options.length || sel.options[i].disabled) return;
  const changed = sel.selectedIndex !== i;
  idxDesc.set.call(sel, i); sync(sel);
  if (changed) { sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); }
}
function show(sel) {
  if (open?.sel === sel) return close();
  close(false);
  const b = sel._dd, r = b.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.className = 'dd-menu'; menu.setAttribute('role', 'listbox'); menu.tabIndex = -1;
  [...sel.options].forEach((o, i) => {
    const it = document.createElement('div');
    it.className = 'dd-item'; it.setAttribute('role', 'option'); it.dataset.i = i; it.textContent = o.textContent;
    it.setAttribute('aria-selected', String(i === sel.selectedIndex));
    if (o.disabled) it.setAttribute('aria-disabled', 'true');
    it.onpointerup = e => { e.preventDefault(); choose(sel, i); close(); };
    menu.append(it);
  });
  document.body.append(menu);
  const h = menu.offsetHeight, below = innerHeight - r.bottom - 8;
  menu.style.minWidth = r.width + 'px';
  menu.style.left = Math.min(r.left, innerWidth - menu.offsetWidth - 8) + 'px';
  menu.style.top = (below >= h || below > r.top ? r.bottom + 6 : r.top - h - 6) + 'px';
  menu.style.transformOrigin = below >= h ? 'top' : 'bottom';
  b.setAttribute('aria-expanded', 'true');
  open = { sel, menu, active: Math.max(0, sel.selectedIndex) };
  highlight();
}
function highlight() {
  if (!open) return;
  open.menu.querySelectorAll('.dd-item').forEach((it, i) => it.classList.toggle('active', i === open.active));
  open.menu.children[open.active]?.scrollIntoView({ block: 'nearest' });
}

export function enhance(sel) {
  if (sel._dd || sel.multiple || sel.size > 1) return;
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'dd select'; b.setAttribute('aria-haspopup', 'listbox'); b.setAttribute('aria-expanded', 'false');
  const name = sel.getAttribute('aria-label') || sel.closest('label')?.textContent.trim() || sel.title;
  if (name) b.setAttribute('aria-label', name);
  if (sel.id) b.dataset.for = sel.id;
  b.innerHTML = '<span class="dd-value"></span><svg viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5 6 6.5 11 1.5"/></svg>';
  sel._dd = b; sel.classList.add('dd-native'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
  sel.after(b);
  Object.defineProperty(sel, 'value', { configurable: true, get() { return desc.get.call(this); }, set(v) { desc.set.call(this, v); sync(this); } });
  Object.defineProperty(sel, 'selectedIndex', { configurable: true, get() { return idxDesc.get.call(this); }, set(v) { idxDesc.set.call(this, v); sync(this); } });
  new MutationObserver(() => sync(sel)).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  sel.addEventListener('change', () => sync(sel));
  b.onclick = () => show(sel);
  b.onkeydown = e => {
    if (!open || open.sel !== sel) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show(sel); }
      return;
    }
    const n = sel.options.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); open.active = Math.min(n - 1, open.active + 1); highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); open.active = Math.max(0, open.active - 1); highlight(); }
    else if (e.key === 'Home') { e.preventDefault(); open.active = 0; highlight(); }
    else if (e.key === 'End') { e.preventDefault(); open.active = n - 1; highlight(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(sel, open.active); close(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close(false);
    else if (e.key.length === 1) { const k = e.key.toLowerCase(); const i = [...sel.options].findIndex((o, j) => j > open.active && o.textContent.trim().toLowerCase().startsWith(k)); const f = i >= 0 ? i : [...sel.options].findIndex(o => o.textContent.trim().toLowerCase().startsWith(k)); if (f >= 0) { open.active = f; highlight(); } }
  };
  sync(sel);
}

export function installDropdowns(root = document.body) {
  root.querySelectorAll('select').forEach(enhance);
  new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.tagName === 'SELECT') enhance(n); else n.querySelectorAll?.('select').forEach(enhance); } }).observe(root, { childList: true, subtree: true });
  addEventListener('pointerdown', e => { if (open && !open.menu.contains(e.target) && e.target !== open.sel._dd && !open.sel._dd.contains(e.target)) close(false); }, true);
  addEventListener('resize', () => close(false));
  addEventListener('scroll', e => { if (open && !open.menu.contains(e.target)) close(false); }, true);
  addEventListener('blur', () => close(false));
}
