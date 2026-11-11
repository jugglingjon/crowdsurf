// Hiding and revealing real elements in place.
//
// How elements are hidden matters:
//   containers (box, bordered wrapper) -> visibility:hidden. Children can still be
//            shown independently, which a parent's opacity would not allow.
//   leaves (text, media, <hr>) -> opacity:0 with visibility forced visible, so they
//            stay in the accessibility tree and keep their place in the tab order.
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
  if (!task.leaf) {
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

/**
 * Fade an already-shown element in from transparent. Returns the running Animation,
 * or null when the browser has no Web Animations support.
 */
export function fade(el, ms) {
  if (typeof el.animate !== 'function') return null;
  // The empty end keyframe means "whatever the element's own opacity is".
  return el.animate([{ opacity: 0 }, {}], { duration: ms, easing: 'ease-out' });
}
