// Crew: the cursors on screen, and the one animation loop that drives them.
//
// Everything is drawn in a single fixed, click-through layer above the page, inside
// a shadow root so the page's CSS cannot reach it. Positions are kept in page
// coordinates, so cursors and outlines stay attached to the content while it scrolls.
// The layer exists only while there are agents; it is removed when the last one leaves.

export const NAMES = [
  'Mara', 'Tobi', 'Ines', 'Kofi', 'Lena', 'Ravi', 'Noor', 'Sven',
  'Yuki', 'Dara', 'Milo', 'Zoe', 'Anya', 'Theo', 'Lior', 'Bea',
];

export const COLORS = ['#6247ea', '#d93f4c', '#0b8f6c', '#c8660a', '#0b7fd1', '#b8297f', '#1b8f9c', '#7a5cff'];

const IDLE_MS = 1500; // how long an agent hangs around with nothing to do
const EDGE = 44; // how far outside the viewport agents enter from and leave to

const CSS_TEXT = `
.agent { position: absolute; left: 0; top: 0; will-change: transform, opacity; transition: opacity .18s linear; }
.agent svg { position: absolute; display: block; overflow: visible; filter: drop-shadow(0 1px 1.5px rgba(0,0,0,.28)); }
.name { position: absolute; left: 13px; top: 17px; padding: 3px 7px 4px; border-radius: 3px 9px 9px 9px;
  color: #fff; font: 600 11px/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; white-space: nowrap; }
.rect { position: absolute; left: 0; top: 0; box-sizing: border-box; border: 1.5px solid; border-radius: 1px; }
.rect.media { background-color: #e4e6ea; background-image:
  linear-gradient(to top right, transparent calc(50% - .6px), #a3a9b4 calc(50% - .6px), #a3a9b4 calc(50% + .6px), transparent calc(50% + .6px)),
  linear-gradient(to bottom right, transparent calc(50% - .6px), #a3a9b4 calc(50% - .6px), #a3a9b4 calc(50% + .6px), transparent calc(50% + .6px)); }
.rect i { position: absolute; width: 7px; height: 7px; box-sizing: border-box; background: #fff; border: 1.5px solid; border-color: inherit; }
.rect i:nth-child(1) { left: -4px; top: -4px; } .rect i:nth-child(2) { right: -4px; top: -4px; }
.rect i:nth-child(3) { left: -4px; bottom: -4px; } .rect i:nth-child(4) { right: -4px; bottom: -4px; }
.path { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; }
.badge { position: absolute; left: 50%; top: 100%; transform: translate(-50%, 6px); padding: 2px 6px 3px; border-radius: 4px;
  color: #fff; font: 600 11px/1.2 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; white-space: nowrap; }
.caret { position: absolute; left: 0; top: 0; width: 2px; border-radius: 1px; }
`;

const SHAPES = {
  arrow: (c) =>
    `<svg width="20" height="22" viewBox="0 0 20 22" style="left:-2px;top:-1.5px"><path d="M2 1.5v16.2l4.4-4 3 6.8 2.7-1.2-3-6.6h6z" fill="${c}" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
  cross: (c) =>
    `<svg width="22" height="22" viewBox="0 0 22 22" style="left:-11px;top:-11px"><path d="M11 2v18M2 11h18" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="M11 2v18M2 11h18" stroke="${c}" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  pen: (c) =>
    `<svg width="22" height="22" viewBox="0 0 22 22" style="left:-2px;top:-20px"><path d="M2 20l2.2-7.6L13.6 3l5.4 5.4-9.4 9.4z" fill="${c}" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/><path d="M2 20l5.2-5.2" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/><circle cx="8.6" cy="13.4" r="1.5" fill="#fff"/></svg>`,
  copy: (c) =>
    `<svg width="28" height="26" viewBox="0 0 28 26" style="left:-2px;top:-1.5px"><path d="M2 1.5v16.2l4.4-4 3 6.8 2.7-1.2-3-6.6h6z" fill="${c}" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/><circle cx="20" cy="18" r="6" fill="${c}" stroke="#fff" stroke-width="1.4"/><path d="M20 15v6M17 18h6" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  text: (c) =>
    `<svg width="12" height="22" viewBox="0 0 12 22" style="left:-6px;top:-11px"><path d="M2 2h2.5Q6 2 6 3.5v15Q6 20 4.5 20H2M10 2H7.5Q6 2 6 3.5M10 20H7.5Q6 20 6 18.5" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="M2 2h2.5Q6 2 6 3.5v15Q6 20 4.5 20H2M10 2H7.5Q6 2 6 3.5M10 20H7.5Q6 20 6 18.5" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round"/></svg>`,
};

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function viewport() {
  return { x: window.scrollX, y: window.scrollY, w: window.innerWidth, h: window.innerHeight };
}

class Agent {
  constructor(crew, name, color) {
    this.crew = crew;
    this.name = name;
    this.color = color;
    this.pos = { x: 0, y: 0 }; // page coordinates
    this.state = 'idle'; // idle | working | leaving
    this.idleSince = 0;
    this.shape = '';
    this.el = document.createElement('div');
    this.el.className = 'agent';
    this.el.style.opacity = '0';
    this.icon = document.createElement('span');
    this.label = document.createElement('span');
    this.label.className = 'name';
    this.label.textContent = name;
    this.label.style.background = color;
    this.el.append(this.icon, this.label);
    this.setShape('arrow');
  }

  setShape(shape) {
    if (shape === this.shape) return;
    this.shape = shape;
    this.icon.innerHTML = SHAPES[shape](this.color);
  }

  place(x, y) {
    this.pos.x = x;
    this.pos.y = y;
  }

  inView(margin = 80) {
    const v = viewport();
    const { x, y } = this.pos;
    return x > v.x - margin && x < v.x + v.w + margin && y > v.y - margin && y < v.y + v.h + margin;
  }

  // Put the agent just outside the left or right edge of the viewport, level with a point.
  enterNear(point) {
    const v = viewport();
    const fromLeft = point.x - v.x < v.w / 2 ? Math.random() < 0.7 : Math.random() < 0.3;
    this.place(
      fromLeft ? v.x - EDGE : v.x + v.w + EDGE,
      clamp(point.y + (Math.random() - 0.5) * 260, v.y + 20, v.y + v.h - 20),
    );
  }

  // Glide to a (possibly moving) target. Resolves false if the work was called off.
  travel(getTarget, ctx) {
    this.setShape('arrow');
    let to = getTarget();
    if (!this.inView()) this.enterNear(to); // scrolled away since its last job
    this.el.style.opacity = '1';
    const from = { ...this.pos };
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const bend = (Math.random() - 0.5) * dist * 0.2;
    return this.crew.tween(
      clamp(dist * 0.7, 140, 480) / ctx.speed(),
      (t) => {
        to = getTarget();
        const e = easeInOut(t);
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.hypot(dx, dy) || 1;
        const off = Math.sin(Math.PI * e) * bend;
        this.place(from.x + dx * e - (dy / len) * off, from.y + dy * e + (dx / len) * off);
      },
      ctx.live,
    );
  }

  release() {
    if (this.state !== 'working') return;
    this.state = 'idle';
    this.idleSince = performance.now();
    this.setShape('arrow');
  }

  leave() {
    this.state = 'leaving';
    if (!this.inView(0)) return this.crew.dismiss(this);
    const v = viewport();
    const from = { ...this.pos };
    const toX = from.x - v.x < v.w / 2 ? v.x - EDGE : v.x + v.w + EDGE;
    this.el.style.opacity = '0';
    this.crew
      .tween(
        360,
        (t) => this.place(from.x + (toX - from.x) * t * t, from.y - 30 * t),
        () => this.state === 'leaving',
      )
      .then(() => this.crew.dismiss(this));
  }
}

export class Crew {
  constructor() {
    this.agents = [];
    this.jobs = new Set();
    this.host = null;
    this.root = null;
    this.raf = 0;
    this.hired = 0;
    this.frame = this.frame.bind(this);
  }

  get working() {
    let n = 0;
    for (const a of this.agents) if (a.state === 'working') n++;
    return n;
  }

  mount() {
    if (this.host) return;
    const host = document.createElement('div');
    host.setAttribute('data-swarm-layer', '');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText =
      'all:initial!important;position:fixed!important;inset:0!important;display:block!important;' +
      'overflow:hidden!important;pointer-events:none!important;z-index:2147483000!important;contain:strict!important';
    const root = host.attachShadow({ mode: 'open' });
    try {
      // not subject to a page's style-src policy, unlike a <style> element
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS_TEXT);
      root.adoptedStyleSheets = [sheet];
    } catch (_) {
      const style = document.createElement('style');
      style.textContent = CSS_TEXT;
      root.appendChild(style);
    }
    document.documentElement.appendChild(host);
    this.host = host;
    this.root = root;
  }

  unmount() {
    if (this.host) this.host.remove();
    this.host = null;
    this.root = null;
  }

  // An agent for a task at page position (x, y): the nearest idle one, or a new one
  // while the crew is under `limit`. Returns null when everyone is busy.
  hire(point, limit, opts) {
    let best = null;
    let bestDist = Infinity;
    let active = 0;
    for (const a of this.agents) {
      if (a.state === 'leaving') continue;
      active++;
      if (a.state !== 'idle') continue;
      const d = Math.hypot(a.pos.x - point.x, a.pos.y - point.y);
      if (d < bestDist) {
        best = a;
        bestDist = d;
      }
    }
    if (!best) {
      if (active >= limit) return null;
      this.mount();
      const names = opts.names && opts.names.length ? opts.names : NAMES;
      const colors = opts.colors && opts.colors.length ? opts.colors : COLORS;
      best = new Agent(this, names[this.hired % names.length], colors[this.hired % colors.length]);
      this.hired++;
      best.enterNear(point);
      this.agents.push(best);
      this.root.appendChild(best.el);
    }
    best.state = 'working';
    this.wake();
    return best;
  }

  dismiss(agent) {
    agent.el.remove();
    const i = this.agents.indexOf(agent);
    if (i >= 0) this.agents.splice(i, 1);
    if (!this.agents.length) this.unmount();
  }

  // Run `step(t)` every frame with t going 0 -> 1 over `ms`. Resolves true when it
  // finishes, or false as soon as `live()` says the work was called off.
  tween(ms, step, live) {
    return new Promise((resolve) => {
      let t0 = 0;
      this.jobs.add((now) => {
        if (live && !live()) {
          resolve(false);
          return false;
        }
        if (!t0) t0 = now;
        const t = ms > 0 ? Math.min(1, (now - t0) / ms) : 1;
        step(t);
        if (t < 1) return true;
        resolve(true);
        return false;
      });
      this.wake();
    });
  }

  wake() {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  frame(now) {
    this.raf = 0;
    for (const job of this.jobs) if (job(now) === false) this.jobs.delete(job);
    const v = viewport();
    for (const a of [...this.agents]) {
      if (a.state === 'idle' && now - a.idleSince > IDLE_MS) a.leave();
      a.el.style.transform = `translate(${a.pos.x - v.x}px,${a.pos.y - v.y}px)`;
    }
    if (this.jobs.size || this.agents.length) this.wake();
  }

  // An outline rectangle in page coordinates. Options: a tint, a size badge, the
  // crossed "image goes here" look, or corner handles as on a selected object.
  addRect(color, { fill = false, badge = false, media = false, handles = false } = {}) {
    this.mount();
    const el = document.createElement('div');
    el.className = media ? 'rect media' : 'rect';
    el.style.borderColor = color;
    if (handles) el.innerHTML = '<i></i><i></i><i></i><i></i>';
    if (fill && !media) el.style.backgroundColor = color + '1f';
    let label = null;
    if (badge) {
      label = document.createElement('span');
      label.className = 'badge';
      label.style.background = color;
      el.appendChild(label);
    }
    this.root.appendChild(el);
    return {
      set(x, y, w, h, text) {
        const v = viewport();
        el.style.transform = `translate(${x - v.x}px,${y - v.y}px)`;
        el.style.width = w + 'px';
        el.style.height = h + 'px';
        if (label && text != null) label.textContent = text;
      },
      opacity(o) {
        el.style.opacity = String(o);
      },
      // cut away the top `t` (0..1) of the rectangle
      clip(t) {
        el.style.clipPath = `inset(${t * 100}% -80px -40px -80px)`;
      },
      remove() {
        el.remove();
      },
    };
  }

  // A straight stroke through points given in page coordinates, optionally with a
  // pen-tool anchor at each end.
  addPath(color, { anchors = false } = {}) {
    this.mount();
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'path');
    const line = document.createElementNS(NS, 'polyline');
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '1.5');
    svg.appendChild(line);
    const dots = [];
    this.root.appendChild(svg);
    return {
      set(points) {
        const v = viewport();
        line.setAttribute('points', points.map((p) => `${p.x - v.x},${p.y - v.y}`).join(' '));
        if (!anchors) return;
        points.forEach((p, i) => {
          if (!dots[i]) {
            dots[i] = document.createElementNS(NS, 'rect');
            dots[i].setAttribute('width', '6');
            dots[i].setAttribute('height', '6');
            dots[i].setAttribute('fill', '#fff');
            dots[i].setAttribute('stroke', color);
            dots[i].setAttribute('stroke-width', '1.5');
            svg.appendChild(dots[i]);
          }
          dots[i].setAttribute('x', p.x - v.x - 3);
          dots[i].setAttribute('y', p.y - v.y - 3);
        });
      },
      opacity(o) {
        svg.style.opacity = String(o);
      },
      remove() {
        svg.remove();
      },
    };
  }

  addCaret(color) {
    this.mount();
    const el = document.createElement('div');
    el.className = 'caret';
    el.style.background = color;
    el.style.opacity = '0';
    this.root.appendChild(el);
    return {
      set(x, y, h) {
        const v = viewport();
        el.style.opacity = '1';
        el.style.transform = `translate(${x - v.x - 1}px,${y - v.y}px)`;
        el.style.height = h + 'px';
      },
      remove() {
        el.remove();
      },
    };
  }
}
