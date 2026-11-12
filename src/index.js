// Crowdsurf: build part or all of a page in front of the reader as they scroll.
//
//   import { crowdsurf } from 'crowdsurf';
//   crowdsurf('#features');          // one region
//   crowdsurf(document.body);        // the whole page
//   crowdsurf();                     // every [data-crowdsurf] element

import { Region, markReady } from './region.js';
import { scheduler } from './scheduler.js';

export const DEFAULTS = {
  agents: 5, // agents working at once in calm conditions
  maxAgents: 12, // ceiling when a backlog builds up (fast scrolling)
  speed: 1, // build speed multiplier
  mistakes: 0, // share of pieces (0 to 1) built with a slip that is then corrected; 0 turns it off
  naturalMovement: false, // cursors travel in hand-like curves, sometimes overshooting a little
  dillyDally: false, // between jobs a cursor sometimes loiters, or reads along a line of text
  rootMargin: '0px', // IntersectionObserver margin: when an element counts as on screen
  ignore: '[data-crowdsurf-ignore]', // elements (and their contents) the crew leaves alone
  names: null, // cursor names, e.g. ['Ada', 'Grace']; defaults to a built-in list
  colors: null, // cursor colors as 6-digit hex, e.g. ['#6247ea']; defaults to a built-in palette
  once: false, // skip regions a visitor has already seen built: 'session', true (always), or a number of days
  onceKey: '', // what `once` remembers a page by; defaults to its path
  watch: false, // also build elements added to a region later (lazy lists, "load more")
  respectReducedMotion: true, // do nothing for visitors who prefer reduced motion
};

// regions currently attached to the page, across every crowdsurf() call
const live = new Set();

function resolve(target) {
  let list;
  if (typeof target === 'string') list = [...document.querySelectorAll(target)];
  else if (target instanceof Element) list = [target];
  else if (target && typeof target[Symbol.iterator] === 'function') list = [...target].filter((t) => t instanceof Element);
  else list = [];
  return [...new Set(list)];
}

const ONCE = 'crowdsurf:once:';

function storeFor(once) {
  return once === 'session' ? window.sessionStorage : window.localStorage;
}

// Has this visitor already watched the region behind `key` being built?
function seen(key, once) {
  try {
    const at = Number(storeFor(once).getItem(key));
    if (!at) return false;
    return typeof once === 'number' ? Date.now() - at < once * 864e5 : true;
  } catch (_) {
    return false; // storage blocked: just build
  }
}

function remember(key, once) {
  try {
    storeFor(once).setItem(key, String(Date.now()));
  } catch (_) {
    /* storage blocked: nothing to do */
  }
}

/** Forget every region remembered by the `once` option, so they build again. */
export function forget() {
  for (const name of ['sessionStorage', 'localStorage']) {
    try {
      const store = window[name];
      for (let i = store.length - 1; i >= 0; i--) {
        const key = store.key(i);
        if (key && key.startsWith(ONCE)) store.removeItem(key);
      }
    } catch (_) {
      /* storage blocked */
    }
  }
}

function dataOptions(el) {
  const out = {};
  for (const key of ['speed', 'agents', 'maxAgents', 'mistakes']) {
    const attr = 'data-crowdsurf-' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
    const n = parseFloat(el.getAttribute(attr));
    if (n > 0) out[key] = n;
  }
  // on/off options: present (or "true") turns them on, "false" turns them off
  for (const key of ['naturalMovement', 'dillyDally', 'watch']) {
    const attr = 'data-crowdsurf-' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
    if (el.hasAttribute(attr)) out[key] = el.getAttribute(attr) !== 'false';
  }
  // data-crowdsurf-once, ="session", or ="7" (days)
  if (el.hasAttribute('data-crowdsurf-once')) {
    const v = el.getAttribute('data-crowdsurf-once');
    out.once = v === 'session' ? 'session' : parseFloat(v) > 0 ? parseFloat(v) : v !== 'false';
  }
  return out;
}

class Crowdsurf {
  #listeners = new Map();
  #target;
  #skipped = []; // [element, index] of targets not built because of `once`

  constructor(target, options) {
    this.options = { ...DEFAULTS, ...options };
    this.regions = [];
    this.destroyed = false;
    this.#target = target;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.#init(), { once: true });
    } else {
      this.#init();
    }
  }

  #init() {
    if (this.destroyed) return;
    const els = resolve(this.#target);
    const reduced =
      this.options.respectReducedMotion &&
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;

    els.forEach((el, index) => {
      if (reduced) markReady(el);
      else this.#attach(el, index, false);
    });
  }

  // Set up one target. `again` builds it even if `once` says it has been seen.
  #attach(el, index, again) {
    const opts = { ...this.options, ...dataOptions(el) };
    const key = `${ONCE}${opts.onceKey || location.pathname}:${el.id || index}`;
    if (opts.once && !again && seen(key, opts.once)) {
      markReady(el);
      this.#skipped.push([el, index]);
      return;
    }
    // one region per element, and no region inside another
    const clash = [...live].some((r) => r.el === el || r.el.contains(el) || el.contains(r.el));
    if (clash) {
      if (![...live].some((r) => r.el.contains(el))) {
        console.warn('crowdsurf: skipped a target that overlaps one already running', el);
      }
      return;
    }
    const region = new Region(el, opts, scheduler, (type, r) => this.#emit(type, r));
    region.onceKey = key;
    live.add(region);
    this.regions.push(region);
    try {
      region.init();
    } catch (err) {
      // never leave a page hidden because of a planning error
      console.error('crowdsurf: could not set up a region, showing it as is', err);
      region.destroy();
      live.delete(region);
      this.regions.pop();
      markReady(el);
    }
  }

  #emit(type, region) {
    if (type === 'start') live.add(region); // also when `watch` reopens a finished region
    if (type === 'complete') {
      live.delete(region);
      if (region.opts.once) remember(region.onceKey, region.opts.once);
    }
    const detail = { type, region, element: region.el, done: region.done, total: region.total };
    // Deferred, so listeners added right after crowdsurf() still hear events from setup.
    queueMicrotask(() => {
      if (this.destroyed) return;
      for (const fn of this.#listeners.get(type) || []) fn(detail);
      if (type !== 'progress') {
        region.el.dispatchEvent(new CustomEvent('crowdsurf:' + type, { bubbles: true, detail }));
      }
    });
  }

  /** Listen for 'start', 'progress' or 'complete'. Each fires per region. */
  on(type, fn) {
    if (!this.#listeners.has(type)) this.#listeners.set(type, new Set());
    this.#listeners.get(type).add(fn);
    return this;
  }

  off(type, fn) {
    const set = this.#listeners.get(type);
    if (set) set.delete(fn);
    return this;
  }

  /** Change options on the fly, e.g. set({ speed: 2 }). */
  set(options) {
    Object.assign(this.options, options);
    for (const region of this.regions) Object.assign(region.opts, options);
    scheduler.kick();
    return this;
  }

  /** { done, total } across every region. */
  get progress() {
    let done = 0;
    let total = 0;
    for (const region of this.regions) {
      done += region.done;
      total += region.total;
    }
    return { done, total };
  }

  get complete() {
    return this.regions.every((r) => r.completed);
  }

  /** How many targets were left as they are because of the `once` option. */
  get skipped() {
    return this.#skipped.length;
  }

  /** Build everything that is left, instantly. */
  finish() {
    for (const region of this.regions) region.finish();
    return this;
  }

  /** Hide everything again and rebuild, including anything `once` had skipped. */
  replay() {
    for (const region of this.regions) {
      if (region.destroyed) continue;
      live.add(region);
      region.replay();
    }
    for (const [el, index] of this.#skipped.splice(0)) this.#attach(el, index, true);
    return this;
  }

  /** Stop, and put every element back exactly as it was. */
  destroy() {
    for (const region of this.regions) {
      region.destroy();
      live.delete(region);
    }
    this.destroyed = true;
    this.#listeners.clear();
  }
}

/**
 * @param {string | Element | Iterable<Element>} [target='[data-crowdsurf]']
 * @param {Partial<typeof DEFAULTS>} [options]
 */
export function crowdsurf(target = '[data-crowdsurf]', options = {}) {
  return new Crowdsurf(target, options);
}

/** How many agents are working right now, across every region. */
export function activeAgents() {
  return scheduler.busy;
}

export default crowdsurf;
