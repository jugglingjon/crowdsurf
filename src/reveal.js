// Hiding and revealing real elements in place.
//
// Phase 1 uses a plain fade as a stand-in. The cursor choreography (drag a box, type
// the text) replaces `reveal` later; `hide` and `show` stay as they are.
//
// How elements are hidden matters:
//   box   -> visibility:hidden. Children can still be shown independently, which a
//            parent's opacity would not allow.
//   text, media -> opacity:0 with visibility forced visible, so they stay in the
//            accessibility tree and keep their place in the tab order while waiting.
//
// Styles are set inline through the CSSOM (works under a strict CSP and inside any
// stylesheet setup) and put back exactly as they were.

const PROPS = ['visibility', 'opacity'];

export function hide(task) {
  const style = task.el.style;
  if (!task.saved) {
    task.saved = PROPS.map((p) => [p, style.getPropertyValue(p), style.getPropertyPriority(p)]);
    task.hadStyleAttr = task.el.hasAttribute('style');
  }
  if (task.kind === 'box') {
    style.setProperty('visibility', 'hidden', 'important');
  } else {
    style.setProperty('visibility', 'visible', 'important');
    style.setProperty('opacity', '0', 'important');
  }
  task.hidden = true;
}

export function show(task) {
  if (!task.hidden) return;
  const style = task.el.style;
  for (const [prop, value, priority] of task.saved) {
    if (value) style.setProperty(prop, value, priority);
    else style.removeProperty(prop);
  }
  if (!task.hadStyleAttr && !task.el.getAttribute('style')) task.el.removeAttribute('style');
  task.hidden = false;
}

// Milliseconds an agent spends on a task at 1x speed.
export function duration(task) {
  if (task.kind === 'box') return 240;
  if (task.kind === 'media') return 380;
  return Math.min(900, Math.max(200, 160 + task.chars * 8));
}

// Milliseconds an agent takes to get to its next task (stand-in for cursor travel).
export const TRAVEL = 90;

/**
 * Show the element and fade it in. Returns the running Animation, or null when the
 * browser has no Web Animations support (the element is simply shown).
 */
export function reveal(task, speed = 1) {
  show(task);
  if (typeof task.el.animate !== 'function') return null;
  // The empty end keyframe means "whatever the element's own opacity is".
  return task.el.animate([{ opacity: 0 }, {}], { duration: duration(task) / speed, easing: 'ease-out' });
}
