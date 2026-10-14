// Minimal DOM/clock adapter for behavioral tests of the actual island controller.
// Layout, CSS compositing and Windows behavior are tested separately in Playwright/on Windows.
import vm from 'node:vm';
import fs from 'node:fs';
import * as model from '../../src/island/model.js';
import * as compact from '../../src/island/compact.js';
import * as surfaceTheme from '../../src/shared/surface-theme.js';
import * as drawer from '../../src/island/drawer.js';
import * as lifecycle from '../../src/island/lifecycle.js';

export const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
export async function flush() { for (let i = 0; i < 25; i++) await Promise.resolve(); }

export function harness() {
  let now = 0, timerId = 0;
  const timers = new Map(), events = new Map(), calls = [], answers = new Map();
  const setTimer = (fn, ms = 0, interval = 0) => { const id = ++timerId; timers.set(id, { fn, at: now + ms, interval }); return id; };
  const clearTimer = id => timers.delete(id);
  const document = { hidden: false, activeElement: null, addEventListener: (name, fn) => { (document.events[name] ||= []).push(fn); }, events: {} };
  class Node {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null; this.dataset = {}; this.attributes = new Map(); this.events = {};
      this.className = ''; this._text = ''; this.scrollTop = 0; this.inert = false; this.value = ''; this.disabled = false;
      this.style = { props: new Map(), setProperty(name, value) { this.props.set(name, value); }, removeProperty(name) { this.props.delete(name); }, getPropertyValue(name) { return this.props.get(name) ?? ''; } };
      this.classList = {
        contains: name => this.className.split(/\s+/).includes(name),
        add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
        remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
        toggle: (name, on) => { if (on ?? !this.classList.contains(name)) this.classList.add(name); else this.classList.remove(name); },
      };
    }
    set src(value) { this.attributes.set('src', value); setTimer(() => { if (this.isConnected) this.dispatch('load'); }, 0); }
    get src() { return this.getAttribute('src') ?? ''; }
    get firstChild() { return this.children[0]; }
    get lastChild() { return this.children.at(-1); }
    get isConnected() { return this === document.body || !!this.parentNode?.isConnected; }
    get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
    set textContent(value) { for (const node of [...this.children]) node.remove(); this._text = String(value); }
    set innerHTML(value) { this.textContent = ''; this._html = value; }
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
      if (name === 'class') this.className = String(value);
      if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
    }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    append(...nodes) { for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); } }
    prepend(node) { node.remove(); node.parentNode = this; this.children.unshift(node); }
    remove() {
      if (this.contains(document.activeElement)) document.activeElement = document.body;
      if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
      this.parentNode = null;
    }
    replaceWith(node) { const parent = this.parentNode, index = parent?.children.indexOf(this); this.remove(); if (parent) { node.parentNode = parent; parent.children.splice(index, 0, node); } }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    matches(selector) {
      const attributes = [...selector.matchAll(/\[([^=\]]+)(?:=['"]?([^'"\]]+)['"]?)?\]/g)];
      for (const [, name, value] of attributes) {
        const actual = name.startsWith('data-') ? this.dataset[name.slice(5)] : this.getAttribute(name);
        if (value == null ? actual == null : actual !== value) return false;
      }
      const base = selector.replace(/\[[^\]]+\]/g, '');
      const id = /#([\w-]+)/.exec(base)?.[1]; if (id && this.id !== id) return false;
      for (const [, cls] of base.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(cls)) return false;
      const tag = /^[a-z]+/i.exec(base)?.[0]; return !tag || this.tagName === tag.toUpperCase();
    }
    closest(selector) { return selector.split(',').some(s => this.matches(s.trim())) ? this : this.parentNode?.closest(selector) ?? null; }
    querySelectorAll(selector) {
      const result = [];
      const match = node => selector.split(',').some(s => {
        const parts = s.trim().split(/\s+/), last = parts.pop(); if (!node.matches(last)) return false;
        let ancestor = node.parentNode;
        while (parts.length) { const part = parts.pop(); while (ancestor && !ancestor.matches(part)) ancestor = ancestor.parentNode; if (!ancestor) return false; ancestor = ancestor.parentNode; }
        return true;
      });
      const walk = node => { for (const child of node.children) { if (match(child)) result.push(child); walk(child); } }; walk(this); return result;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    focus() { document.activeElement = this; }
    scrollTo({ top }) { this.scrollTop = top; }
    addEventListener(name, fn) { (this.events[name] ||= []).push(fn); }
    dispatch(name, extra = {}) { const event = { target: this, key: '', preventDefault() {}, ...extra }; for (const fn of this.events[name] ?? []) fn(event); }
    click() { if (!this.disabled) this.dispatch('click'); }
    get offsetWidth() { return 90; }
    get offsetLeft() { return 0; }
  }
  document.documentElement = new Node('html');
  document.body = new Node('body'); document.activeElement = document.body;
  document.createElement = tag => new Node(tag); document.createElementNS = (_, tag) => new Node(tag);
  const nodes = {};
  const add = (id, tag, parent, cls = '') => { const node = new Node(tag); node.id = id; node.className = cls; nodes[id] = node; parent.append(node); return node; };
  const root = add('island', 'main', document.body, 'island'), shell = add('shell', 'div', root, 'shell');
  const peek = add('peek', 'button', shell, 'peek');
  for (const id of ['peekTime', 'peekCpu', 'peekRam', 'peekBattery', 'batteryPercent', 'batteryFill', 'peekWave']) add(id, 'span', peek);
  const panel = add('panel', 'div', shell, 'panel'), tabs = add('tabs', 'nav', panel, 'tabs');
  add('tabPill', 'span', tabs, 'tab-pill'); add('views', 'div', panel, 'views'); add('note', 'div', panel, 'note');
  document.getElementById = id => nodes[id] ?? document.body.querySelector(`#${id}`);
  const config = { items: [{ id: 'one', name: 'One', kind: 'scene', scene: 'silk' }, { id: 'two', name: 'Two', kind: 'scene', scene: 'fluid' }], assign: { '*': 'one' }, display: {}, widgets: {}, paused: false };
  const defaults = {
    island_ready: null, island_expand: 2,
    widget_metrics: { cpu: 12, ram: 50 }, get_state: { config },
    quick_state: { volume: .5, muted: false, wifi: true, bluetooth: false },
    media_state: { active: true, title: 'Music', status: 'playing', position: 0, duration: 100, canToggle: true, canPrev: true, canNext: true, canSeek: true, thumbId: '' },
    clip_state: { enabled: true, items: [] }, apps_state: { enabled: true, items: [] },
  };
  const bridge = {
    isApp: true,
    invoke(name, args) { calls.push({ name, args }); const value = answers.has(name) ? answers.get(name) : defaults[name]; return Promise.resolve().then(() => typeof value === 'function' ? value(args) : value); },
    listen(name, fn) { const set = events.get(name) ?? new Set(); events.set(name, set); set.add(fn); return () => set.delete(fn); },
  };
  const scope = {
    ...drawer, ...model, ...lifecycle, ...compact, ...surfaceTheme, bridge, SCENES: { silk: { thumb: 'data:image/png,a' }, fluid: { thumb: 'data:image/png,b' } },
    thumbnail: async () => new Blob(['picture']), clearThumbnailMemory() {},
    createDrawerMotion: (root, content, opts) => drawer.createDrawerMotion(root, content, { ...opts, reduced: () => false, setTimer, clearTimer, observe: () => ({ observe() {}, disconnect() {} }) }),
    createPoller: (load, apply, interval) => lifecycle.createPoller(load, apply, interval, { setTimer, clearTimer }),
    document, console, Blob, URL, performance: { now: () => now }, matchMedia: () => ({ matches: false }),
    requestAnimationFrame: fn => setTimer(fn, 16), setTimeout: setTimer, clearTimeout: clearTimer,
    setInterval: (fn, ms) => setTimer(fn, ms, ms), clearInterval: clearTimer,
    ResizeObserver: class { observe() {} disconnect() {} }, IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    window: { addEventListener(name, fn) { (this.events[name] ||= []).push(fn); }, events: {} },
  };
  vm.createContext(scope);
  const source = fs.readFileSync(new URL('../../src/island/island.js', import.meta.url), 'utf8').replace(/^import .*;.*$/mg, '');
  vm.runInContext(source + '\nglobalThis.controller = { S, open, dismiss, showPeek, selectTab, onShow };', scope);
  return {
    ...scope.controller, document, calls, config,
    node: id => document.getElementById(id),
    setHidden(value) { document.hidden = value; for (const fn of document.events.visibilitychange ?? []) fn(); },
    answer(name, value) { answers.set(name, value); },
    emit(name, value) { for (const fn of events.get(name) ?? []) fn(value); },
    async advance(ms) {
      const end = now + ms; await flush();
      for (let count = 0; count < 1000; count++) {
        const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, t] = next; now = t.at; timers.delete(id); if (t.interval) timers.set(id, { ...t, at: now + t.interval }); t.fn(); await flush();
        if (count === 999) throw Error('Timer loop did not settle');
      }
      now = end; await flush();
    },
    cleanup() { for (const fn of scope.window.events.pagehide ?? []) fn(); timers.clear(); },
  };
}
