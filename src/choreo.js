// Choreography: what an agent does on screen to build one task.
//
//   box, media   travel to the top-left corner, drag out an outline with a live
//                size badge, release, and the real element fades in under it.
//   text         click into the text block and type it, with a caret. Text that sits
//                in its own shape (a button, a badge) gets the shape drawn first.
//
// Every step is cancellable: `ctx.live()` turns false when the task was finished some
// other way (keyboard focus, finish(), replay(), destroy()), and `task.cleanup`
// removes whatever is on screen for it.

import { show, fade } from './reveal.js';
import { clamp } from './crew.js';
import { canType, createTyper } from './typing.js';

const easeOut = (t) => 1 - Math.pow(1 - t, 3);

function pageRect(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
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

/** Build `task` with `agent`. Resolves when done or called off. */
export function perform(agent, task, ctx) {
  return task.kind === 'text' ? typeText(agent, task, ctx) : drawBox(agent, task, ctx);
}

async function drawBox(agent, task, ctx, beforeShow) {
  const { el } = task;
  const crew = agent.crew;

  if (!(await agent.travel(() => pageRect(el), ctx))) return false;

  agent.setShape('cross');
  const outline = crew.addRect(agent.color, { fill: true, badge: true });
  addCleanup(task, () => outline.remove());

  const start = pageRect(el);
  const dragMs = clamp(Math.hypot(start.w, start.h) * 0.45, 220, 620) / ctx.speed();
  const dragged = await crew.tween(
    dragMs,
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
  if (!dragged) return false;

  // release: the real element fades in while the outline fades away
  agent.setShape('arrow');
  const settleMs = 170 / ctx.speed();
  if (beforeShow) beforeShow();
  show(task);
  task.anim = fade(el, settleMs);
  const settled = await crew.tween(
    settleMs,
    (t) => {
      const r = pageRect(el);
      outline.set(r.x, r.y, r.w, r.h);
      outline.opacity(1 - t);
    },
    ctx.live,
  );
  outline.remove();
  return settled;
}

async function typeText(agent, task, ctx) {
  const { el } = task;
  const crew = agent.crew;
  const typer = canType() ? createTyper(el) : null;
  // no custom highlight support (or nothing to type): build it like a box
  if (!typer) return drawBox(agent, task, ctx);

  const hideText = () => {
    typer.hideAll();
    addCleanup(task, () => typer.release());
  };

  if (task.decorated) {
    // a button, badge or pill: draw its shape, then type into it
    if (!(await drawBox(agent, task, ctx, hideText))) return false;
  } else {
    const startAt = () => typer.caret(0) || pageRect(el);
    if (!(await agent.travel(() => {
      const c = startAt();
      return { x: c.x, y: c.y + (c.h || 0) / 2 };
    }, ctx))) return false;
    hideText();
    show(task);
  }

  agent.setShape('text');
  const frame = crew.addRect(agent.color);
  const caret = crew.addCaret(agent.color);
  addCleanup(task, () => {
    frame.remove();
    caret.remove();
  });

  const typeMs = clamp(typer.count * 16, 260, 1500) / ctx.speed();
  const typed = await crew.tween(
    typeMs,
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
