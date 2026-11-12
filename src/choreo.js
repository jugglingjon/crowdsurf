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
// With the `mistakes` option above zero, a share of tasks are built with a slip that
// the agent then corrects. Most are caught while drawing: a box drawn too big or in
// the wrong spot, a line drawn too long, a copy dropped off target, text typed and
// partly deleted again. Those only affect the drawing; the real element is shown
// once the drawing is right.
//
// Two are caught late, after the real element and everything in it is built:
//
//   out of place   built a little off, then picked up by the middle and moved. The
//                  offset is a running animation of the CSS `translate` property.
//   wrong size     built too wide, too tall or both, so its contents are laid out
//                  and wrapped for that size, then resized from the corner handle
//                  while the contents reflow. The size is a running animation of
//                  width and height, with matching negative margins so that the
//                  space the piece takes up in the page stays the same and nothing
//                  around it is pushed about.
//
//   sharp corners  a piece with rounded corners is built square. As soon as it is
//                  drawn the cursor takes the round handle inside its corner and
//                  drags it inwards, and the corners round off to their real radius.
//                  The radius is a running animation of border-radius.
//
// A container waits out of place or at the wrong size until everything inside it is
// built (corners are rounded straight away). All three are animations only: no
// styles are written, and cancelling them puts the element back exactly.
//
// While anything is being carried (a duplicate, or a piece being moved) the cursor
// is a closed hand.
//
// With `dillyDally` on, an agent that has just finished a job sometimes takes a
// moment before the next: it drifts off and waits, or runs along under a line of
// finished text as if reading it. It can be called away at any point.
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

const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const sign = () => (Math.random() < 0.5 ? -1 : 1);

// The kinds of slip, and how each is weighted by default (the `slips` option). A
// weight multiplies how often that kind happens: 0 turns it off, 2 doubles it.
//
//   oversize   an outline drawn too big, then pulled back in from the corner
//   misplace   an outline drawn in the wrong spot, then moved
//   overshoot  a line drawn too long, then pulled back
//   nudge      a duplicate dropped off target, then nudged into place
//   retype     text typed part way, a few characters deleted, then finished
//   place      a piece built out of place, then moved once it is finished
//   size       a piece built too big, then resized from the corner once finished
//   round      a rounded piece built square, then rounded off
export const SLIP_KINDS = ['oversize', 'misplace', 'overshoot', 'nudge', 'retype', 'place', 'size', 'round'];

// Roll for a slip at this step. `kinds` are the ones possible here; `share` is how
// much of the `mistakes` rate they get between them at default weights. Each kind's
// own rate is mistakes x share / kinds.length x its weight, so with every weight at 1
// the step slips at mistakes x share, split evenly. Returns the kind, or null.
function slipKind(ctx, kinds, share = 1) {
  const rate = ctx.mistakes();
  if (!rate) return null;
  const weights = kinds.map((k) => ctx.weight(k));
  const total = weights.reduce((a, b) => a + b, 0);
  if (!total || Math.random() >= Math.min(1, (rate * share * total) / kinds.length)) return null;
  let pick = Math.random() * total;
  let kind = kinds[kinds.length - 1];
  for (let i = 0; i < kinds.length; i++) {
    pick -= weights[i];
    if (pick < 0) {
      kind = kinds[i];
      break;
    }
  }
  ctx.slipped(kind);
  return kind;
}

// Hold still for a moment (the "hm, that's not right" beat).
function pause(agent, ctx, ms) {
  return agent.crew.tween(ms / ctx.speed(), () => {}, ctx.live);
}

// How a rectangle is off: too big, or out of place. Null for no slip.
function rectSlip(ctx, r, kinds) {
  const kind = slipKind(ctx, kinds);
  if (!kind) return null;
  if (kind === 'oversize') {
    return { ox: 0, oy: 0, ew: Math.min(r.w * rand(0.08, 0.28), 70), eh: Math.min(r.h * rand(0.08, 0.3), 70) };
  }
  return { ox: sign() * rand(8, 28), oy: sign() * rand(6, 22), ew: 0, eh: 0 };
}

// The rectangle with `k` (1 -> 0) of the slip still applied.
function off(r, slip, k) {
  return slip ? { x: r.x + slip.ox * k, y: r.y + slip.oy * k, w: r.w + slip.ew * k, h: r.h + slip.eh * k } : r;
}

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
  const late = displace(task, ctx);
  const corners = late && task.shift.kind === 'round';
  // these two are put right before the task counts as built, whatever ends it
  if (late && (task.leaf || corners)) addCleanup(task, () => clearShift(task));
  const result = await build(agent, task, ctx);
  if (!late) return result;
  if (corners) {
    const rounded = result && task.shift && (await roundOff(agent, task, ctx));
    clearShift(task);
    return rounded && result;
  }
  if (!task.leaf) {
    // a container is put right later, once its contents are in
    if (task.shift) ctx.later(task);
    return result;
  }
  const moved = result && (await moveBack(agent, task, ctx));
  clearShift(task);
  return moved && result;
}

// ------------------------------------------- built out of place or wrong size

const LATE_SHARE = 0.4; // how often a piece gets one of the caught-late kinds, as a share of `mistakes`
const px = (v) => parseFloat(v) || 0;

export function clearShift(task) {
  if (!task.shift) return;
  task.shift.anim.cancel();
  task.shift = null;
}

const CORNERS = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'];
const MIN_RADIUS = 5; // corners rounder than this are worth a rounding slip

// A corner radius in px as it actually renders (a pill's 999px is really half its height).
function radiusPx(value, r) {
  const first = String(value).split(' ')[0];
  const n = parseFloat(first) || 0;
  const most = Math.min(r.width, r.height) / 2;
  return Math.min(first.endsWith('%') ? (n / 100) * Math.min(r.width, r.height) : n, most);
}

// Maybe start building this task out of place, at the wrong size, or with square
// corners. True if so. Either way the state lives in `task.shift`: the running
// animation, the keyframe that holds the wrong state, and the keyframe for the
// right one.
function displace(task, ctx) {
  if (!ctx.mistakes()) return false;
  const { el } = task;
  if (typeof el.animate !== 'function' || !(window.CSS && CSS.supports && CSS.supports('translate', '1px 1px'))) return false;
  const cs = getComputedStyle(el);
  if (cs.display === 'inline') return false; // inline boxes can't be moved or sized
  for (let t = task.parent; t; t = t.parent) if (t.shift) return false; // one at a time per branch

  const r = el.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  if (r.width * r.height > vw * window.innerHeight * 0.5) return false; // too big to shove around
  // never push anything past the edge of the page: that would add a scrollbar
  const fits = (dx) => r.left + dx >= 4 && r.right + dx <= vw - 4;
  let ox = sign() * rand(10, 30);
  if (!fits(ox)) ox = fits(-ox) ? -ox : 0;
  // Wrong size: not for media (it would distort), rules, or table parts (the table
  // would re-flow around them).
  const sizable = task.kind !== 'media' && !(task.kind === 'line' && task.leaf) && !cs.display.startsWith('table');
  // Square corners: only where there is a visible shape with rounding to speak of.
  const shaped = task.kind === 'box' || task.kind === 'media' || (task.kind === 'text' && task.decorated);
  const radius = shaped && Math.min(r.width, r.height) >= 24 ? radiusPx(cs.borderTopLeftRadius, r) : 0;
  const kinds = ['place'];
  if (sizable) kinds.push('size');
  if (radius >= MIN_RADIUS) kinds.push('round');
  const kind = slipKind(ctx, kinds, LATE_SHARE);
  if (!kind) return false;

  let hold = null;
  let rest = null;
  if (kind === 'round') {
    hold = {};
    rest = {};
    for (const corner of CORNERS) {
      hold[corner] = '0px';
      // as rendered, so the rounding is spread over the whole drag (see radiusPx)
      rest[corner] = `${radiusPx(cs[corner], r)}px`;
    }
    task.shift = { kind: 'round', radius };
  } else if (kind === 'size') {
    let ew = Math.random() < 0.75 ? clamp(r.width * rand(0.12, 0.35), 16, 120) : 0;
    if (!fits(ew) || r.left < 0) ew = 0;
    const eh = !ew || Math.random() < 0.45 ? clamp(r.height * rand(0.12, 0.35), 12, 90) : 0;
    // let the new size take effect whatever the layout around it
    const free = { maxWidth: 'none', maxHeight: 'none', flexGrow: '0', flexShrink: '0', flexBasis: 'auto' };
    const sized = (dw, dh) => ({
      ...free,
      width: `${px(cs.width) + dw}px`,
      height: `${px(cs.height) + dh}px`,
      // give back exactly the extra room, so the neighbours stay where they are
      marginRight: `${px(cs.marginRight) - dw}px`,
      marginBottom: `${px(cs.marginBottom) - dh}px`,
    });
    hold = sized(ew, eh);
    rest = sized(0, 0);
    task.shift = { kind: 'size' };
  } else {
    hold = { translate: `${ox}px ${sign() * rand(8, 24)}px` };
    rest = { translate: '0px 0px' };
    task.shift = { kind: 'place' };
  }
  task.shift.hold = hold;
  task.shift.rest = rest;
  task.shift.anim = el.animate([hold, hold], { duration: 1000, fill: 'both' });
  return true;
}

/**
 * Select a piece that was built out of place or at the wrong size and put it right:
 * drag it by the middle, or drag its corner handle. Resolves false if called off.
 * The caller clears the shift afterwards.
 */
export async function moveBack(agent, task, ctx) {
  const { el } = task;
  const crew = agent.crew;
  const { live, speed } = ctx;
  const resizing = task.shift.kind === 'size';
  // where the cursor holds the piece: the bottom-right handle, or the middle
  const grip = () => {
    const r = pageRect(el);
    return resizing ? { x: r.x + r.w, y: r.y + r.h } : { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  };
  if (!(await agent.travel(grip, ctx))) return false;

  const selection = crew.addRect(agent.color, { handles: true, badge: resizing });
  const follow = () => {
    const r = pageRect(el);
    selection.set(r.x, r.y, r.w, r.h, `${Math.round(r.w)} × ${Math.round(r.h)}`);
    const g = grip();
    agent.place(...intoView(g.x, g.y));
  };
  try {
    agent.setShape(resizing ? 'resize' : 'grab');
    if (!(await crew.tween(220 / speed(), follow, live))) return false;
    const ms = (resizing ? 460 : 320) / speed();
    const { hold, rest, anim } = task.shift;
    anim.cancel();
    task.shift.anim = el.animate([hold, rest], { duration: ms, easing: 'ease-in-out', fill: 'both' });
    if (!(await crew.tween(ms, follow, live))) return false;
    agent.setShape('arrow');
    return await crew.tween(140 / speed(), (t) => {
      follow();
      selection.opacity(1 - t);
    }, live);
  } finally {
    selection.remove();
  }
}

/**
 * Round off a piece that was built with square corners: take the round handle
 * inside its top-left corner and drag it inwards. Resolves false if called off.
 * The caller clears the shift afterwards.
 */
async function roundOff(agent, task, ctx) {
  const { el } = task;
  const crew = agent.crew;
  const { radius } = task.shift;
  // the handle sits on the corner's diagonal, further in the rounder the corner
  const handle = (k) => {
    const r = pageRect(el);
    const d = Math.min(9 + radius * k * 0.75, Math.min(r.w, r.h) / 2);
    return { x: r.x + d, y: r.y + d };
  };
  if (!(await agent.travel(() => handle(0), ctx))) return false;

  const selection = crew.addRect(agent.color, { handles: true, badge: true });
  const dot = crew.addDot(agent.color);
  addCleanup(task, () => {
    selection.remove();
    dot.remove();
  });
  const show = (k) => {
    const r = pageRect(el);
    selection.set(r.x, r.y, r.w, r.h, `Radius ${Math.round(radius * k)}`);
    const h = handle(k);
    dot.set(h.x, h.y);
    agent.place(...intoView(h.x, h.y));
  };
  try {
    if (!(await crew.tween(240 / ctx.speed(), () => show(0), ctx.live))) return false;
    const ms = clamp(260 + radius * 8, 320, 620) / ctx.speed();
    const { hold, rest, anim } = task.shift;
    anim.cancel();
    task.shift.anim = el.animate([hold, rest], { duration: ms, easing: 'ease-in-out', fill: 'both' });
    if (!(await crew.tween(ms, (t) => show(easeInOut(t)), ctx.live))) return false;
    return await crew.tween(150 / ctx.speed(), (t) => {
      show(1);
      selection.opacity(1 - t);
      dot.opacity(1 - t);
    }, ctx.live);
  } finally {
    selection.remove();
    dot.remove();
  }
}

// ------------------------------------------------------------ dilly-dallying

const DALLY_CHANCE = 0.3; // after any one job

// A line of finished text near the agent, as { x, y, w } in page coordinates
// (y is the bottom of the line), or null.
function lineToRead(agent, region) {
  let best = null;
  let bestDist = 700;
  for (const t of region.tasks) {
    if (t.kind !== 'text' || t.state !== 'done' || t.w < 90) continue;
    const d = Math.hypot(t.x - agent.pos.x, t.y - agent.pos.y);
    if (d < bestDist) {
      best = t;
      bestDist = d;
    }
  }
  if (!best || !onScreen(best.el)) return null;
  const range = document.createRange();
  range.selectNodeContents(best.el);
  const lines = [...range.getClientRects()].filter((r) => r.width > 60 && r.top > 0 && r.bottom < window.innerHeight);
  if (!lines.length) return null;
  const r = lines[Math.floor(Math.random() * Math.min(lines.length, 3))];
  return { x: r.left + window.scrollX, y: r.bottom + window.scrollY, w: r.width };
}

/**
 * Maybe let `agent` dawdle for a moment now that its job is done. Returns true if
 * it is dallying (it goes idle by itself afterwards), false if the caller should
 * release it as usual.
 */
export function maybeDally(agent, region) {
  if (!region.opts.dillyDally || agent.state !== 'working' || Math.random() >= DALLY_CHANCE) return false;
  const token = (agent.dallyToken = {});
  agent.state = 'dallying';
  agent.setShape('arrow');
  region.dallies++;
  const ctx = {
    live: () => agent.state === 'dallying' && agent.dallyToken === token,
    speed: () => region.opts.speed,
    natural: () => !!region.opts.naturalMovement,
  };
  const crew = agent.crew;
  (async () => {
    const line = Math.random() < 0.6 ? lineToRead(agent, region) : null;
    if (line) {
      // read: along under the line at an unhurried pace, not always to the end
      if (!(await agent.travel(() => ({ x: line.x - 2, y: line.y + 5 }), ctx))) return;
      const far = line.w * rand(0.6, 1);
      const moved = await crew.tween(
        clamp(far * rand(3.4, 4.8), 450, 1700) / ctx.speed(),
        (t) => agent.place(line.x + far * t, line.y + 5 + Math.sin(t * 9) * 1.2),
        ctx.live,
      );
      if (moved) await pause(agent, ctx, rand(120, 380));
    } else {
      // loiter: drift a short way off and stay there a moment
      const angle = rand(0, Math.PI * 2);
      const reach = rand(50, 150);
      const [x, y] = intoView(agent.pos.x + Math.cos(angle) * reach, agent.pos.y + Math.sin(angle) * reach);
      if (await agent.travel(() => ({ x, y }), ctx)) await pause(agent, ctx, rand(450, 1100));
    }
  })()
    .catch(() => {})
    .then(() => {
      if (ctx.live()) agent.idle();
    });
  return true;
}

function build(agent, task, ctx) {
  if (task.kind === 'text') return typeText(agent, task, ctx);
  if (task.copyOf) return copyOrDraw(agent, task, ctx);
  return draw(agent, task, ctx);
}

function draw(agent, task, ctx) {
  if (task.kind === 'line') return drawLines(agent, task, ctx);
  if (task.kind === 'media' && task.role === 'image') return drawMedia(agent, task, ctx);
  return drawBox(agent, task, ctx);
}

async function copyOrDraw(agent, task, ctx) {
  const copied = await duplicate(agent, task, ctx);
  if (copied !== null) return copied && { also: carried(task) };
  return draw(agent, task, ctx);
}

// ------------------------------------------------------------------- boxes

// Travel to the corner and drag an outline out to the element's full size.
// Resolves to the outline, or null if called off.
async function dragOut(agent, task, ctx, look) {
  const { el } = task;
  const crew = agent.crew;
  const start = pageRect(el);
  const slip = task.shift ? null : rectSlip(ctx, start, ['oversize', 'misplace']); // one slip per piece is plenty
  const size = (g) => `${Math.round(g.w)} × ${Math.round(g.h)}`;
  if (!(await agent.travel(() => off(pageRect(el), slip, 1), ctx))) return null;

  agent.setShape('cross');
  const outline = crew.addRect(agent.color, { fill: true, badge: true, ...look });
  addCleanup(task, () => outline.remove());

  let ok = await crew.tween(
    clamp(Math.hypot(start.w, start.h) * 0.45, 220, 620) / ctx.speed(),
    (t) => {
      const e = easeOut(t);
      const g = off(pageRect(el), slip, 1);
      const w = g.w * e;
      const h = g.h * e;
      outline.set(g.x, g.y, w, h, `${Math.round(w)} × ${Math.round(h)}`);
      agent.place(...intoView(g.x + w, g.y + h));
    },
    ctx.live,
  );

  if (ok && slip) {
    const hold = () => {
      const g = off(pageRect(el), slip, 1);
      outline.set(g.x, g.y, g.w, g.h, size(g));
    };
    const moved = slip.ox || slip.oy;
    // wrong spot: pick it up by the middle. Too big: pull the corner back in.
    const grip = (g) => (moved ? { x: g.x + g.w / 2, y: g.y + g.h / 2 } : { x: g.x + g.w, y: g.y + g.h });
    ok = await crew.tween(260 / ctx.speed(), hold, ctx.live);
    if (ok && moved) {
      ok = await agent.travel(() => {
        hold();
        return grip(off(pageRect(el), slip, 1));
      }, ctx);
    }
    if (ok) {
      if (moved) agent.setShape('grab');
      ok = await crew.tween(
        300 / ctx.speed(),
        (t) => {
          const g = off(pageRect(el), slip, 1 - easeInOut(t));
          outline.set(g.x, g.y, g.w, g.h, size(g));
          const p = grip(g);
          agent.place(...intoView(p.x, p.y));
        },
        ctx.live,
      );
    }
    if (ok) ok = await pause(agent, ctx, 90);
  }

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
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    // a slip here is a line drawn too long, then pulled back
    const extra = slipKind(ctx, ['overshoot']) ? Math.min(length * rand(0.06, 0.18), 60) : 0;
    // the end point, `e` of the way along, with `k` (1 -> 0) of the overshoot applied
    const draw = (e, k) => {
      const [from, to] = segment(el, side);
      const reach = e * (1 + (extra * k) / length);
      const tip = { x: lerp(from.x, to.x, reach), y: lerp(from.y, to.y, reach) };
      path.set([from, tip]);
      for (const done of paths) if (done !== path) done.track();
      agent.place(...intoView(tip.x, tip.y));
    };
    let ok = await crew.tween(clamp(length * 0.5, 180, 520) / ctx.speed(), (t) => draw(easeInOut(t), 1), ctx.live);
    if (ok && extra) {
      ok = await crew.tween(220 / ctx.speed(), () => draw(1, 1), ctx.live);
      if (ok) ok = await crew.tween(240 / ctx.speed(), (t) => draw(1, 1 - easeInOut(t)), ctx.live);
    }
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
    if (other === task || other.state !== 'done' || other.left > 0 || other.shift || !onScreen(other.el)) continue;
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
  agent.setShape('grab');
  const ghost = crew.addRect(agent.color, { fill: true });
  addCleanup(task, () => ghost.remove());
  const s0 = pageRect(source.el);
  const d0 = pageRect(el);
  // a slip here is a copy dropped slightly off target, then nudged into place
  const slip = task.shift ? null : rectSlip(ctx, d0, ['nudge']);
  const put = (g) => {
    select();
    ghost.set(g.x, g.y, g.w, g.h);
    agent.place(...intoView(g.x + g.w / 2, g.y + g.h / 2));
  };
  let moved = await crew.tween(
    clamp(Math.hypot(d0.x - s0.x, d0.y - s0.y) * 0.6, 260, 640) / ctx.speed(),
    (t) => {
      const e = easeInOut(t);
      const s = pageRect(source.el);
      const d = off(pageRect(el), slip, 1);
      put({ x: lerp(s.x, d.x, e), y: lerp(s.y, d.y, e), w: lerp(s.w, d.w, e), h: lerp(s.h, d.h, e) });
    },
    ctx.live,
  );
  if (moved && slip) {
    moved = await crew.tween(240 / ctx.speed(), () => put(off(pageRect(el), slip, 1)), ctx.live);
    if (moved) moved = await crew.tween(260 / ctx.speed(), (t) => put(off(pageRect(el), slip, 1 - easeInOut(t))), ctx.live);
  }
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
  const perChar = clamp(typer.count * pace, task.quick ? 180 : 260, task.quick ? 900 : 1500) / typer.count;

  // Move the caret from character `from` to `to` (forwards types, backwards deletes).
  const run = (from, to, ms) =>
    crew.tween(
      ms / ctx.speed(),
      (t) => {
        const n = Math.round(lerp(from, to, t));
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

  let typed;
  if (typer.count >= 8 && slipKind(ctx, ['retype'])) {
    // type part of it, think better of the last few characters, delete them, carry on
    const stop = Math.round(typer.count * rand(0.35, 0.9));
    const back = stop - Math.min(stop - 1, Math.round(rand(3, 9)));
    typed =
      (await run(0, stop, stop * perChar)) &&
      (await pause(agent, ctx, 240)) &&
      (await run(stop, back, (stop - back) * 34)) &&
      (await pause(agent, ctx, 140)) &&
      (await run(back, typer.count, (typer.count - back) * perChar));
  } else {
    typed = await run(0, typer.count, typer.count * perChar);
  }
  frame.remove();
  caret.remove();
  typer.release();
  return typed;
}
