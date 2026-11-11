// Scheduler: one shared pool of agents for every region on the page.
//
// Regions hand over tasks that are ready (parent built, element on screen). The
// scheduler orders them top to bottom, left to right, and gives each to the nearest
// free agent. When a backlog piles up (fast scrolling) more agents join, up to
// `maxAgents`.

import { Crew } from './crew.js';

const ROW = 8; // tasks whose tops are within this many px count as the same row

function order(a, b) {
  return Math.round(a.y / ROW) - Math.round(b.y / ROW) || a.x - b.x || a.id - b.id;
}

export class Scheduler {
  constructor() {
    this.regions = new Set();
    this.crew = new Crew();
    this.queued = false;
    this.listening = false;
    this.onScroll = () => this.kick();
  }

  // agents working right now
  get busy() {
    return this.crew.working;
  }

  add(region) {
    this.regions.add(region);
    this.listen();
    this.kick();
  }

  remove(region) {
    this.regions.delete(region);
    this.listen();
  }

  // Scrolling can carry waiting tasks past the viewport, which regions need to notice.
  // Capture phase, so scrolling inside any container counts too.
  listen() {
    const want = this.regions.size > 0;
    if (want === this.listening) return;
    this.listening = want;
    const method = want ? 'addEventListener' : 'removeEventListener';
    window[method]('scroll', this.onScroll, { passive: true, capture: true });
  }

  // Coalesce any number of "something changed" signals into one pump.
  kick() {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      this.pump();
    });
  }

  pump() {
    const queue = [];
    let agents = 1;
    let maxAgents = 1;
    for (const region of this.regions) {
      const before = queue.length;
      region.collect(queue);
      if (queue.length > before || region.building > 0) {
        agents = Math.max(agents, region.opts.agents);
        maxAgents = Math.max(maxAgents, region.opts.maxAgents, region.opts.agents);
      }
    }
    if (!queue.length) return;
    queue.sort(order);
    const limit = Math.min(maxAgents, Math.max(agents, Math.ceil(queue.length / 3)));
    for (const item of queue) {
      const agent = this.crew.hire(item, limit, item.region.opts);
      if (!agent) break;
      // either a task to build, or a finished piece to move back into place
      const work = item.chore ? item.region.runChore(item, agent) : item.region.build(item, agent);
      work.then(() => this.kick());
    }
  }
}

export const scheduler = new Scheduler();
