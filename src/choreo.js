// Choreography: what an agent does on screen to build one task.
//
//   box        travel to the top-left corner, drag out an outline with a live size
//              badge, release, and the real element fades in under it.
//   media      images, video and the like get a crossed placeholder dragged out, then
//              the real thing sweeps in from the top. Form controls are drawn as boxes.
//   line       rules and one-sided borders are drawn with the pen: anchor, rubber
//              band, anchor.
//   text       click into the text block and type it, with a caret. Text in a shape
//              of its own (button, badge, bordered cell) gets the shape made first.
//   duplicate  a repeated sibling (card, list row, nav link) is not built from
//              scratch: a finished one is selected and a copy dragged into place,
//              then the copy's own text is typed in.
//
// Every step is cancellable: `ctx.live()` turns false when the task was finished some
// other way (keyboard focus, finish(), replay(), destroy()), and `task.cleanup`
// removes whatever is on screen for it.
//
// perform() resolves to false when called off, true when done, or { also: [...] }
// when done and further tasks were built along with it.

import { show, fade } from './reveal.js';
import { clamp } from './crew.js';
import { canType, createTyper } from './typing.js';

const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a, b, t) => a + (b - a) * t;

const SETTLE_MS = 170; // release: the real element fades in, the drawing fades out
const ICON_SIZE = 64; // media no larger than this comes along with a duplicated parent

function pageRect(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
}

function onScreen(el) {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
}

// keep the cursor on screen while it drags out something larger than the viewport
function intoView(x, y) {
  const pad = 10;
  return [
    clamp(x, window.scrollX + pad, window.scrollX + window.innerWidth - pad),
    clamp(y, window.scrollY + pad, window.scrollY + window.innerHeight - pad),
  ];
}

function addCleanup(task, fn) {
  const prev = task.cleanup;
  task.cleanup = () => {
    task.cleanup = null;
    fn();
    if (prev) prev();
  };
}

/** Build `task` with `agent`. */
export async function perform(agent, task, ctx) {
  if (task.kind === 'text') return typeText(agent, task, ctx);
  if (task.copyOf) {
    const copied = await duplicate(agent, task, ctx);
    if (copied !== null) return copied && { also: carried(task) };
  }
  if (task.kind === 'line') return drawLines(agent, task, ctx);
  if (task.kind === 'media' && task.role === 'image') return drawMedia(agent, task, ctx);
  return drawBox(agent, task, ctx);
}

// ------------------------------------------------------------------- boxes

// Travel to the corner and drag an outline out to the element's full size.
// Resolves to the outline, or null if called off.
async function dragOut(agent, task, ctx, look) {
  const { el } = task;
  const crew = agent.crew;
  if (!(await agent.travel(() => pageRect(el), ctx))) return null;

  agent.setShape('cross');
  const outline = crew.addRect(agent.color, { fill: true, badge: true, ...look });
  addCleanup(task, () => outline.remove());

  const start = pageRect(el);
  const ok = await crew.tween(
    clamp(Math.hypot(start.w, start.h) * 0.45, 220, 620) / ctx.speed(),
    (t) => {
      const e = easeOut(t);
      const r = pageRect(el);
      const w = r.w * e;
      const h = r.h * e;
      outline.set(r.x, r.y, w, h, `${Math.round(w)} × ${Math.round(h)}`);
      agent.place(...intoView(r.x + w, r.y + h));
    },
    ctx.live,
  );
  agent.setShape('arrow');
  return ok ? outline : null;
}

// Show the real element and fade it in while whatever was drawn over it fades out.
async function settle(agent, task, ctx, drawings, beforeShow) {
  const { el } = task;
  const ms = SETTLE_MS / ctx.speed();
  if (beforeShow) beforeShow();
  show(task);
  task.anim = fade(el, ms);
  const ok = await agent.crew.tween(
    ms,
    (t) => {
      for (const d of drawings) {
        if (d.track) d.track(pageRect(el));
        d.opacity(1 - t);
      }
    },
    ctx.live,
  );
  for (const d of drawings) d.remove();
  return ok;
}

async function drawBox(agent, task, ctx, beforeShow) {
  const outline = await dragOut(agent, task, ctx);
  if (!outline) return false;
  outline.track = (r) => outline.set(r.x, r.y, r.w, r.h);
  return settle(agent, task, ctx, [outline], beforeShow);
}

// ------------------------------------------------------------------- media

async function drawMedia(agent, task, ctx) {
  const { el } = task;
  const crew = agent.crew;
  const placeholder = await dragOut(agent, task, ctx, { media: true });
  if (!placeholder) return false;

  // An element with a clip-path of its own can't take the sweep: fade it instead.
  const clipped = getComputedStyle(el).clipPath;
  if ((clipped && clipped !== 'none') || typeof el.animate !== 'function') {
    placeholder.track = (r) => placeholder.set(r.x, r.y, r.w, r.h);
    return settle(agent, task, ctx, [placeholder]);
  }

  // The real thing is uncovered from the top while the placeholder is cut away.
  const ms = clamp(pageRect(el).h * 1.6, 200, 620) / ctx.speed();
  const scan = crew.addPath(agent.color);
  addCleanup(task, () => scan.remove());
  show(task);
  task.anim = el.animate([{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: ms, easing: 'linear' });
  const ok = await crew.tween(
    ms,
    (t) => {
      const r = pageRect(el);
      const y = r.y + r.h * t;
      placeholder.set(r.x, r.y, r.w, r.h);
      placeholder.clip(t);
      scan.set([{ x: r.x, y }, { x: r.x + r.w, y }]);
      agent.place(...intoView(r.x + r.w + 6, y));
    },
    ctx.live,
  );
  placeholder.remove();
  scan.remove();
  return ok;
}

// ------------------------------------------------------------------- lines

function segment(el, side) {
  const r = pageRect(el);
  if (side === 'top') return [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }];
  if (side === 'bottom') return [{ x: r.x, y: r.y + r.h }, { x: r.x + r.w, y: r.y + r.h }];
  if (side === 'left') return [{ x: r.x, y: r.y }, { x: r.x, y: r.y + r.h }];
  if (side === 'right') return [{ x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }];
  return [{ x: r.x, y: r.y + r.h / 2 }, { x: r.x + r.w, y: r.y + r.h / 2 }]; // a rule: through the middle
}

async function drawLines(agent, task, ctx, beforeShow) {
  const { el } = task;
  const crew = agent.crew;
  const paths = [];
  addCleanup(task, () => paths.forEach((p) => p.remove()));

  for (const side of task.sides) {
    if (!(await agent.travel(() => segment(el, side)[0], ctx))) return false;
    agent.setShape('pen');
    const path = crew.addPath(agent.color, { anchors: true });
    paths.push(path);
    path.track = () => path.set(segment(el, side));
    const [a, b] = segment(el, side);
    const ok = await crew.tween(
      clamp(Math.hypot(b.x - a.x, b.y - a.y) * 0.5, 180, 520) / ctx.speed(),
      (t) => {
        const [from, to] = segment(el, side);
        const e = easeInOut(t);
        const tip = { x: lerp(from.x, to.x, e), y: lerp(from.y, to.y, e) };
        path.set([from, tip]);
        for (const done of paths) if (done !== path) done.track();
        agent.place(...intoView(tip.x, tip.y));
      },
      ctx.live,
    );
    if (!ok) return false;
  }
  agent.setShape('arrow');
  return settle(agent, task, ctx, paths, beforeShow);
}

// -------------------------------------------------------------- duplicates

// The nearest finished sibling that is on screen to copy from.
function sourceFor(task) {
  const at = pageRect(task.el);
  let best = null;
  let bestDist = Infinity;
  for (const other of task.group) {
    if (other === task || other.state !== 'done' || other.left > 0 || !onScreen(other.el)) continue;
    const r = pageRect(other.el);
    const d = Math.hypot(r.x - at.x, r.y - at.y);
    if (d < bestDist) {
      best = other;
      bestDist = d;
    }
  }
  return best;
}

// What comes along when a container is duplicated: its nested boxes, lines and
// icons. Text and larger media are still built in the copy afterwards.
function carried(task) {
  const out = [];
  (function collect(t) {
    for (const child of t.children) {
      const comes = child.kind === 'box' || child.kind === 'line' || (child.kind === 'media' && Math.max(child.w, child.h) <= ICON_SIZE);
      if (!comes) continue;
      if (child.state !== 'done') out.push(child);
      collect(child);
    }
  })(task);
  return out;
}

// Select a finished sibling and drag a copy of it onto this task's element.
// Resolves null when there is nothing suitable to copy from (nothing has happened
// on screen yet, so the caller can build the task the ordinary way).
async function duplicate(agent, task, ctx, beforeShow) {
  const source = sourceFor(task);
  if (!source) return null;
  const { el } = task;
  const crew = agent.crew;
  const centre = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

  if (!(await agent.travel(() => centre(pageRect(source.el)), ctx))) return false;

  // select the original
  const selection = crew.addRect(agent.color, { handles: true });
  addCleanup(task, () => selection.remove());
  const select = () => {
    const r = pageRect(source.el);
    selection.set(r.x, r.y, r.w, r.h);
  };
  if (!(await crew.tween(130 / ctx.speed(), select, ctx.live))) return false;

  // drag a copy across, taking on the new element's size on the way
  agent.setShape('copy');
  const ghost = crew.addRect(agent.color, { fill: true });
  addCleanup(task, () => ghost.remove());
  const s0 = pageRect(source.el);
  const d0 = pageRect(el);
  const moved = await crew.tween(
    clamp(Math.hypot(d0.x - s0.x, d0.y - s0.y) * 0.6, 260, 640) / ctx.speed(),
    (t) => {
      const e = easeInOut(t);
      const s = pageRect(source.el);
      const d = pageRect(el);
      const g = { x: lerp(s.x, d.x, e), y: lerp(s.y, d.y, e), w: lerp(s.w, d.w, e), h: lerp(s.h, d.h, e) };
      select();
      ghost.set(g.x, g.y, g.w, g.h);
      agent.place(...intoView(g.x + g.w / 2, g.y + g.h / 2));
    },
    ctx.live,
  );
  agent.setShape('arrow');
  if (!moved) return false;

  ghost.track = (r) => ghost.set(r.x, r.y, r.w, r.h);
  selection.track = select;
  return settle(agent, task, ctx, [ghost, selection], beforeShow);
}

// -------------------------------------------------------------------- text

async function typeText(agent, task, ctx) {
  const { el } = task;
  const crew = agent.crew;
  const typer = canType() ? createTyper(el) : null;
  // no custom highlight support (or nothing to type): build it like a box
  if (!typer) return task.sides ? drawLines(agent, task, ctx) : drawBox(agent, task, ctx);

  const hideText = () => {
    typer.hideAll();
    addCleanup(task, () => typer.release());
  };

  // First whatever the text sits in, then the text itself.
  let shaped = null;
  if (task.copyOf) shaped = await duplicate(agent, task, ctx, hideText);
  if (shaped === null) {
    if (task.decorated) {
      shaped = await drawBox(agent, task, ctx, hideText); // a button, badge or pill
    } else if (task.sides) {
      shaped = await drawLines(agent, task, ctx, hideText); // a bordered cell or row
    } else {
      shaped = await agent.travel(() => {
        const c = typer.caret(0) || pageRect(el);
        return { x: c.x, y: c.y + (c.h || 0) / 2 };
      }, ctx);
      if (shaped) {
        hideText();
        show(task);
      }
    }
  }
  if (!shaped) return false;

  agent.setShape('text');
  const frame = crew.addRect(agent.color);
  const caret = crew.addCaret(agent.color);
  addCleanup(task, () => {
    frame.remove();
    caret.remove();
  });

  // text inside a duplicate is a quick edit, not a fresh paragraph
  const pace = task.quick ? 10 : 16;
  const typed = await crew.tween(
    clamp(typer.count * pace, task.quick ? 180 : 260, task.quick ? 900 : 1500) / ctx.speed(),
    (t) => {
      const n = Math.round(t * typer.count);
      typer.reveal(n);
      const r = pageRect(el);
      frame.set(r.x - 3, r.y - 2, r.w + 6, r.h + 4);
      const c = typer.caret(n);
      if (c) {
        caret.set(c.x, c.y, c.h);
        agent.place(c.x + 10, c.y + c.h * 0.62);
      }
    },
    ctx.live,
  );
  if (task.cleanup) task.cleanup();
  return typed;
}
