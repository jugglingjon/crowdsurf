// Region: one targeted element. Plans it, hides its tasks, tracks which are on
// screen, and reveals them as the scheduler hands out agents.

import { plan } from './planner.js';
import { hide, show, reveal, TRAVEL } from './reveal.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function markReady(el) {
  el.setAttribute('data-swarm-ready', '');
  // targets nested inside this one are absorbed by it
  for (const inner of el.querySelectorAll('[data-swarm]')) inner.setAttribute('data-swarm-ready', '');
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
    this.epoch = 0; // bumped to abandon builds that are mid-flight
    this.started = false;
    this.completed = false;
    this.destroyed = false;
    this.io = null;
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
    if (!this.tasks.length) this.finishUp();
  }

  // (Re)start watching every unbuilt task.
  arm() {
    if (this.io) this.io.disconnect();
    this.ready.clear();
    this.io = new IntersectionObserver((entries) => this.observe(entries), { rootMargin: this.opts.rootMargin });
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
  // finishes outright any that are already above the viewport.
  collect(queue) {
    if (this.completed || this.destroyed) return;
    // completing a task adds its children to `ready`; a Set visits those too
    for (const task of this.ready) {
      if (task.state !== 'wait') continue;
      if (task.inView) queue.push(task);
      // Scrolled past without being seen (anchor jumps, flings): no need to animate.
      // The observer only reports changes, so this has to be measured.
      else if (task.el.getBoundingClientRect().bottom <= 0) this.complete(task);
    }
  }

  async build(task) {
    const epoch = this.epoch;
    const live = () => epoch === this.epoch && task.state === 'build';
    task.state = 'build';
    this.ready.delete(task);
    this.building++;
    if (!this.started) {
      this.started = true;
      this.emit('start', this);
    }
    try {
      await sleep(TRAVEL / this.opts.speed);
      if (!live()) return;
      task.anim = reveal(task, this.opts.speed);
      if (task.anim) await task.anim.finished.catch(() => {});
      task.anim = null;
      if (!live()) return;
      this.complete(task);
    } finally {
      this.building--;
    }
  }

  complete(task) {
    if (task.state === 'done') return;
    if (task.anim) {
      task.anim.cancel();
      task.anim = null;
    }
    show(task);
    task.state = 'done';
    this.ready.delete(task);
    if (this.io) this.io.unobserve(task.el);
    for (const child of task.children) if (child.state === 'wait') this.ready.add(child);
    this.done++;
    this.emit('progress', this);
    if (this.done === this.tasks.length) this.finishUp();
    else this.scheduler.kick();
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
    this.emit('complete', this);
  }

  // Build everything that is left, instantly.
  finish() {
    if (this.completed || this.destroyed) return;
    this.epoch++;
    let changed = false;
    for (const task of this.tasks) {
      if (task.state === 'done') continue;
      if (task.anim) task.anim.cancel();
      task.anim = null;
      show(task);
      task.state = 'done';
      this.done++;
      changed = true;
    }
    this.ready.clear();
    if (changed) this.emit('progress', this);
    this.finishUp();
  }

  // Hide everything again and rebuild from the current scroll position.
  replay() {
    if (this.destroyed) return;
    this.epoch++;
    for (const task of this.tasks) {
      if (task.anim) task.anim.cancel();
      task.anim = null;
      task.state = 'wait';
      task.inView = false;
      hide(task);
    }
    this.done = 0;
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
      if (task.anim) task.anim.cancel();
      task.anim = null;
      show(task);
    }
    if (this.io) this.io.disconnect();
    this.io = null;
    this.ready.clear();
    this.el.removeEventListener('focusin', this.onFocus);
    this.scheduler.remove(this);
  }
}
