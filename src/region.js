// Region: one targeted element. Plans it, hides its tasks, tracks which are on
// screen, and reveals them as the scheduler hands out agents.

import { plan } from './planner.js';
import { hide, show } from './reveal.js';
import { perform, moveBack, clearShift, maybeDally } from './choreo.js';

// Stop whatever is happening on screen for a task and leave its element shown.
function settle(task) {
  if (task.anim) task.anim.cancel();
  task.anim = null;
  if (task.cleanup) task.cleanup();
  show(task);
}

// How long something may sit level with the screen without being visible before it
// is taken to be clipped or off to one side, and simply shown.
const GRACE = 400;

// The nearest ancestor that scrolls its contents up and down, or null for the page.
function findScroller(el, cache) {
  const start = el.parentElement;
  if (!start) return null;
  if (cache.has(start)) return cache.get(start);
  let found = null;
  const root = el.ownerDocument.documentElement;
  for (let p = start; p && p !== root && p !== el.ownerDocument.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && p.scrollHeight > p.clientHeight + 1) {
      found = p;
      break;
    }
  }
  cache.set(start, found);
  return found;
}

export function markReady(el) {
  el.setAttribute('data-crowdsurf-ready', '');
  // targets nested inside this one are absorbed by it
  for (const inner of el.querySelectorAll('[data-crowdsurf]')) inner.setAttribute('data-crowdsurf-ready', '');
}

export class Region {
  constructor(el, opts, scheduler, emit) {
    this.el = el;
    this.opts = opts;
    this.scheduler = scheduler;
    this.emit = emit;
    this.tasks = [];
    this.byEl = new WeakMap();
    this.ready = new Set(); // waiting tasks whose parent is built
    this.done = 0;
    this.building = 0;
    this.slips = 0; // deliberate mistakes played so far (see the `mistakes` option)
    this.slipCounts = {}; // the same, by kind
    this.chores = new Set(); // containers built out of place or at the wrong size, waiting to be put right
    this.dallies = 0; // times an agent dawdled between jobs (see the `dillyDally` option)
    this.epoch = 0; // bumped to abandon builds that are mid-flight
    this.started = false;
    this.completed = false;
    this.destroyed = false;
    this.io = null;
    this.mo = null;
    this.scrollers = new Map(); // parent element -> its scrolling ancestor
    this.recheck = 0;
    this.onFocus = (e) => this.revealNow(e.target);
  }

  get total() {
    return this.tasks.length;
  }

  init() {
    // Un-hide the root (if the page pre-hid it) and hide the tasks in the same tick,
    // so nothing is painted in between.
    markReady(this.el);
    this.tasks = plan(this.el, this.opts);
    for (const task of this.tasks) {
      task.region = this;
      this.byEl.set(task.el, task);
      hide(task);
    }
    this.el.addEventListener('focusin', this.onFocus);
    this.arm();
    this.scheduler.add(this);
    if (this.opts.watch && typeof MutationObserver === 'function') {
      // runs before the next paint, so added content is hidden before it is seen
      this.mo = new MutationObserver((records) => this.adopt(records));
      this.mo.observe(this.el, { childList: true, subtree: true });
    }
    if (!this.tasks.length) this.finishUp();
  }

  watchTasks() {
    if (!this.io) this.io = new IntersectionObserver((entries) => this.observe(entries), { rootMargin: this.opts.rootMargin });
    return this.io;
  }

  // Take on elements added to the region after it was planned (the `watch` option).
  adopt(records) {
    if (this.destroyed) return;
    const added = new Set();
    for (const record of records) {
      for (const node of record.addedNodes) if (node.nodeType === 1 && node.isConnected && this.el.contains(node)) added.add(node);
    }
    let grew = false;
    for (const el of added) {
      if (this.byEl.has(el)) continue;
      // find what it sits in: skip it if that is being adopted too, is ignored, or is
      // a single piece (text, media) that the new element is simply part of
      let parent = null;
      let skip = !!(this.opts.ignore && el.closest(this.opts.ignore));
      for (let p = el.parentElement; p && !skip; p = p.parentElement) {
        if (added.has(p)) skip = true;
        const task = this.byEl.get(p);
        if (task && !parent) {
          if (task.leaf) skip = true;
          parent = task;
        }
        if (p === this.el) break;
      }
      if (skip) continue;
      const fresh = plan(el, { ...this.opts, parent, firstId: this.tasks.length });
      for (const task of fresh) {
        task.region = this;
        this.byEl.set(task.el, task);
        hide(task);
        this.tasks.push(task);
        for (let t = task; t; t = t.parent) t.left++;
        if (!task.parent || task.parent.state === 'done') this.ready.add(task);
        this.watchTasks().observe(task.el);
        grew = true;
      }
    }
    if (!grew) return;
    if (this.completed) {
      // the region had finished: open it up again for the new arrivals
      this.completed = false;
      this.started = false;
      this.el.addEventListener('focusin', this.onFocus);
      this.scheduler.add(this);
    }
    this.emit('progress', this);
    this.scheduler.kick();
  }

  // The part of the screen a task can be seen in: the viewport, cut down to its
  // scrolling container if it has one. Null when that container is itself off screen.
  visibleBox(task) {
    if (task.scroller === undefined) task.scroller = findScroller(task.el, this.scrollers);
    const box = { top: 0, bottom: window.innerHeight, passed: false };
    if (!task.scroller) return box;
    const s = task.scroller.getBoundingClientRect();
    if (s.bottom <= 0) return { ...box, passed: true };
    if (s.top >= window.innerHeight) return null;
    return { top: Math.max(0, s.top), bottom: Math.min(window.innerHeight, s.bottom), passed: false };
  }

  // (Re)start watching every unbuilt task.
  arm() {
    if (this.io) this.io.disconnect();
    this.io = null;
    this.ready.clear();
    this.watchTasks();
    // children come after parents in `tasks`, so walking backwards totals each subtree
    for (let i = this.tasks.length - 1; i >= 0; i--) {
      const task = this.tasks[i];
      task.left = task.state === 'done' ? 0 : 1;
      for (const child of task.children) task.left += child.left;
    }
    for (const task of this.tasks) {
      if (task.state === 'done') continue;
      if (!task.parent || task.parent.state === 'done') this.ready.add(task);
      this.io.observe(task.el);
    }
  }

  observe(entries) {
    const view = this.el.ownerDocument.defaultView;
    for (const entry of entries) {
      const task = this.byEl.get(entry.target);
      if (!task || task.state === 'done') continue;
      const r = entry.boundingClientRect;
      task.inView = entry.isIntersecting;
      task.x = r.left + view.scrollX;
      task.y = r.top + view.scrollY;
    }
    this.scheduler.kick();
  }

  // Called by the scheduler. Pushes tasks that are ready to build onto `queue`, and
  // finishes outright any that nobody will see being built.
  collect(queue) {
    if (this.completed || this.destroyed) return;
    const now = performance.now();
    let unsure = false;
    // completing a task adds its children to `ready`; a Set visits those too
    for (const task of this.ready) {
      if (task.state !== 'wait') continue;
      // removed from the page since it was planned
      if (!task.el.isConnected) {
        this.complete(task);
        continue;
      }
      if (task.inView) {
        task.offSince = 0;
        // a copy waits until the one it is copied from is completely built
        // (and, if it was built out of place or the wrong size, put right)
        if (!task.copyOf || (task.copyOf.left === 0 && !task.copyOf.shift)) queue.push(task);
        continue;
      }
      // Not on screen. The observer only reports changes, so work out why by measuring.
      const box = this.visibleBox(task);
      if (!box) continue; // its scrolling container has not come on screen yet
      const r = task.el.getBoundingClientRect();
      // Scrolled past without being seen (anchor jumps, flings): no need to animate.
      if (box.passed || r.bottom <= box.top) {
        this.complete(task);
        continue;
      }
      // Further down: it will be built when it is scrolled to.
      if (r.top >= box.bottom) {
        task.offSince = 0;
        continue;
      }
      // Level with what is on screen, yet not visible: clipped by something, or off to
      // one side (a carousel slide, an off-canvas menu). Scrolling down will never
      // bring it into view, so after a moment (the observer may just be a frame
      // behind) show it as it is.
      if (!task.offSince) task.offSince = now;
      if (now - task.offSince > GRACE) this.complete(task);
      else unsure = true;
    }
    if (unsure && !this.recheck) {
      this.recheck = setTimeout(() => {
        this.recheck = 0;
        this.scheduler.kick();
      }, GRACE + 60);
    }
    // A container built out of place is moved once everything inside it is built.
    for (const chore of this.chores) {
      if (chore.running || chore.task.left > 0) continue;
      const r = chore.task.el.getBoundingClientRect();
      if (r.bottom > 0 && r.top < window.innerHeight) queue.push(chore);
      else this.dropChore(chore); // nobody is looking: just put it right
    }
  }

  async build(task, agent) {
    const epoch = this.epoch;
    const ctx = {
      live: () => epoch === this.epoch && task.state === 'build',
      speed: () => this.opts.speed,
      natural: () => !!this.opts.naturalMovement,
      mistakes: () => Math.min(1, Math.max(0, Number(this.opts.mistakes) || 0)),
      // how much more or less often one kind of slip happens (the `slips` option)
      weight: (kind) => {
        const w = this.opts.slips ? this.opts.slips[kind] : undefined;
        return w == null ? 1 : Math.max(0, Number(w) || 0);
      },
      slipped: (kind) => {
        this.slips++;
        this.slipCounts[kind] = (this.slipCounts[kind] || 0) + 1;
      },
      later: (t) => {
        if (epoch !== this.epoch) return;
        this.chores.add({ chore: true, task: t, region: this, id: t.id, x: t.x, y: t.y, running: false });
      },
    };
    task.state = 'build';
    this.ready.delete(task);
    this.building++;
    if (!this.started) {
      this.started = true;
      this.emit('start', this);
    }
    let result = null;
    try {
      result = await perform(agent, task, ctx);
    } catch (err) {
      console.error('crowdsurf: a build step failed, showing the element as is', err);
    } finally {
      this.building--;
      if (!maybeDally(agent, this)) agent.release();
      // also reached when a step failed: the element must never stay hidden
      if (ctx.live()) {
        this.complete(task);
        // things that were built along with it (the insides of a duplicated card)
        if (result && result.also) for (const extra of result.also) this.complete(extra);
      }
    }
  }

  async runChore(chore, agent) {
    const epoch = this.epoch;
    chore.running = true;
    try {
      await moveBack(agent, chore.task, {
        live: () => epoch === this.epoch && this.chores.has(chore),
        speed: () => this.opts.speed,
        natural: () => !!this.opts.naturalMovement,
      });
    } catch (err) {
      console.error('crowdsurf: could not move a piece back, putting it in place', err);
    } finally {
      if (!maybeDally(agent, this)) agent.release();
      if (epoch === this.epoch) this.dropChore(chore);
    }
  }

  dropChore(chore) {
    clearShift(chore.task);
    this.chores.delete(chore);
    this.checkDone();
  }

  // Forget every pending move and put those pieces where they belong.
  clearChores() {
    this.chores.clear();
    for (const task of this.tasks) clearShift(task);
  }

  checkDone() {
    if (this.done === this.tasks.length && !this.chores.size) this.finishUp();
    else this.scheduler.kick();
  }

  complete(task) {
    if (task.state === 'done') return;
    settle(task);
    task.state = 'done';
    for (let t = task; t; t = t.parent) t.left--;
    this.ready.delete(task);
    if (this.io) this.io.unobserve(task.el);
    for (const child of task.children) if (child.state === 'wait') this.ready.add(child);
    this.done++;
    this.emit('progress', this);
    this.checkDone();
  }

  // Show `target` and everything it sits inside, right now. Used when keyboard focus
  // lands on something that has not been built yet.
  revealNow(target) {
    const chain = [];
    for (let el = target; el; el = el.parentElement) {
      const task = this.byEl.get(el);
      if (task && task.state !== 'done') chain.push(task);
      if (el === this.el) break;
    }
    for (let i = chain.length - 1; i >= 0; i--) this.complete(chain[i]);
  }

  finishUp() {
    if (this.completed) return;
    this.completed = true;
    if (this.io) this.io.disconnect();
    this.io = null;
    this.el.removeEventListener('focusin', this.onFocus);
    this.scheduler.remove(this);
    // (the mutation observer stays: with `watch`, later additions reopen the region)
    this.emit('complete', this);
  }

  // Build everything that is left, instantly.
  finish() {
    if (this.completed || this.destroyed) return;
    this.epoch++;
    let changed = false;
    for (const task of this.tasks) {
      if (task.state === 'done') continue;
      settle(task);
      task.state = 'done';
      task.left = 0;
      this.done++;
      changed = true;
    }
    for (const task of this.tasks) task.left = 0;
    this.clearChores();
    this.ready.clear();
    if (changed) this.emit('progress', this);
    this.finishUp();
  }

  // Hide everything again and rebuild from the current scroll position.
  replay() {
    if (this.destroyed) return;
    this.epoch++;
    for (const task of this.tasks) {
      settle(task);
      task.offSince = 0;
      task.state = 'wait';
      task.inView = false;
      hide(task);
    }
    this.clearChores();
    this.done = 0;
    this.slips = 0;
    this.slipCounts = {};
    this.dallies = 0;
    this.started = false;
    this.completed = false;
    this.el.removeEventListener('focusin', this.onFocus);
    this.el.addEventListener('focusin', this.onFocus);
    this.arm();
    this.scheduler.add(this);
    this.emit('progress', this);
    if (!this.tasks.length) this.finishUp();
  }

  // Stop and put the element back exactly as it was.
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.epoch++;
    for (const task of this.tasks) {
      settle(task);
    }
    this.clearChores();
    if (this.io) this.io.disconnect();
    this.io = null;
    if (this.mo) this.mo.disconnect();
    this.mo = null;
    clearTimeout(this.recheck);
    this.ready.clear();
    this.el.removeEventListener('focusin', this.onFocus);
    this.scheduler.remove(this);
  }
}
