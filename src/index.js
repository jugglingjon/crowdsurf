// swarm-web: build part or all of a page in front of the reader as they scroll.
//
//   import { swarm } from 'swarm-web';
//   swarm('#features');          // one region
//   swarm(document.body);        // the whole page
//   swarm();                     // every [data-swarm] element

import { Region, markReady } from './region.js';
import { scheduler } from './scheduler.js';

export const DEFAULTS = {
  agents: 4, // agents working at once in calm conditions
  maxAgents: 12, // ceiling when a backlog builds up (fast scrolling)
  speed: 1, // build speed multiplier
  rootMargin: '0px', // IntersectionObserver margin: when an element counts as on screen
  ignore: '[data-swarm-ignore]', // elements (and their contents) the swarm leaves alone
  respectReducedMotion: true, // do nothing for visitors who prefer reduced motion
};

// regions currently attached to the page, across every swarm() call
const live = new Set();

function resolve(target) {
  let list;
  if (typeof target === 'string') list = [...document.querySelectorAll(target)];
  else if (target instanceof Element) list = [target];
  else if (target && typeof target[Symbol.iterator] === 'function') list = [...target].filter((t) => t instanceof Element);
  else list = [];
  return [...new Set(list)];
}

function dataOptions(el) {
  const out = {};
  for (const key of ['speed', 'agents', 'maxAgents']) {
    const attr = 'data-swarm-' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
    const n = parseFloat(el.getAttribute(attr));
    if (n > 0) out[key] = n;
  }
  return out;
}

class Swarm {
  #listeners = new Map();
  #target;

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

    for (const el of els) {
      if (reduced) {
        markReady(el);
        continue;
      }
      // one region per element, and no region inside another
      const clash = [...live].some((r) => r.el === el || r.el.contains(el) || el.contains(r.el));
      if (clash) {
        if (![...live].some((r) => r.el.contains(el))) {
          console.warn('swarm-web: skipped a target that overlaps one already running', el);
        }
        continue;
      }
      const region = new Region(el, { ...this.options, ...dataOptions(el) }, scheduler, (type, r) => this.#emit(type, r));
      live.add(region);
      this.regions.push(region);
      try {
        region.init();
      } catch (err) {
        // never leave a page hidden because of a planning error
        console.error('swarm-web: could not set up a region, showing it as is', err);
        region.destroy();
        live.delete(region);
        this.regions.pop();
        markReady(el);
      }
    }
  }

  #emit(type, region) {
    if (type === 'complete') live.delete(region);
    const detail = { type, region, element: region.el, done: region.done, total: region.total };
    // Deferred, so listeners added right after swarm() still hear events from setup.
    queueMicrotask(() => {
      if (this.destroyed) return;
      for (const fn of this.#listeners.get(type) || []) fn(detail);
      if (type !== 'progress') {
        region.el.dispatchEvent(new CustomEvent('swarm:' + type, { bubbles: true, detail }));
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

  /** Build everything that is left, instantly. */
  finish() {
    for (const region of this.regions) region.finish();
    return this;
  }

  /** Hide everything again and rebuild. */
  replay() {
    for (const region of this.regions) {
      if (region.destroyed) continue;
      live.add(region);
      region.replay();
    }
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
 * @param {string | Element | Iterable<Element>} [target='[data-swarm]']
 * @param {Partial<typeof DEFAULTS>} [options]
 */
export function swarm(target = '[data-swarm]', options = {}) {
  return new Swarm(target, options);
}

/** How many agents are working right now, across every region. */
export function activeAgents() {
  return scheduler.busy;
}

export default swarm;
