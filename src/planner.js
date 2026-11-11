// Planner: walks a target element and decides which elements the swarm will build.
//
// Nothing is cloned. Every task points at a real element, which is hidden until its
// turn and then revealed in place. There are four kinds of task:
//
//   box    a container with something of its own to show (background, full border,
//          shadow, a decorative pseudo-element or loose text). Its children wait for it.
//   line   an <hr>, or a container whose only decoration is a border on one or two
//          sides. Drawn with the pen. A container's children wait for it.
//   text   a block whose content is all inline: a heading, paragraph, link, button.
//   media  an atomic element: image, svg, video, canvas, iframe (role "image"), or a
//          form control (role "control"). A web component with a shadow root counts
//          as an image.
//
// Plain wrappers with nothing visible of their own get no task. Their children attach
// to the nearest container task above them.
//
// Repeated siblings (cards, list rows, nav links) are grouped: the first is built in
// full, the rest are marked as copies of it and get duplicated instead.

const SKIP = new Set([
  'script', 'style', 'link', 'meta', 'title', 'head', 'template', 'noscript', 'br', 'wbr',
  'source', 'track', 'param', 'base', 'datalist', 'option', 'optgroup', 'area', 'map',
]);

const IMAGES = new Set(['img', 'picture', 'svg', 'video', 'canvas', 'iframe', 'embed', 'object', 'math']);
const CONTROLS = new Set(['input', 'select', 'textarea', 'progress', 'meter', 'audio', 'hr']);

// An <hr> no taller than this is a line; a taller one is drawn as a box.
const RULE_MAX = 6;

// Smaller than this in either direction is treated as invisible (this also leaves
// screen-reader-only text alone, so it is never hidden from assistive tech).
const MIN_SIZE = 2;

const CLEAR_LEGACY = /^rgba\(.*,\s*0(\.0+)?\s*\)$/;
const CLEAR_MODERN = /\/\s*0(\.0+)?%?\s*\)$/;

function paints(color) {
  return !!color && color !== 'transparent' && !CLEAR_LEGACY.test(color) && !CLEAR_MODERN.test(color);
}

function borderSides(s) {
  const sides = [];
  for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
    const style = s[`border${side}Style`];
    if (style !== 'none' && style !== 'hidden' && parseFloat(s[`border${side}Width`]) > 0 && paints(s[`border${side}Color`])) {
      sides.push(side.toLowerCase());
    }
  }
  return sides;
}

function filled(s) {
  return (
    paints(s.backgroundColor) ||
    s.backgroundImage !== 'none' ||
    s.boxShadow !== 'none' ||
    !!(s.backdropFilter && s.backdropFilter !== 'none')
  );
}

function decorated(s) {
  return filled(s) || borderSides(s).length > 0;
}

// What an element draws of its own: { box: true }, { sides: [...] } for a border on
// one or two sides only, or null for nothing.
function shapeOf(s) {
  const sides = borderSides(s);
  if (filled(s) || sides.length > 2) return { box: true };
  if (sides.length) return { sides };
  return null;
}

// Two tasks look like copies of one another: same element, same classes, same
// make-up inside.
function signature(task) {
  return `${task.kind}:${task.el.localName}.${task.el.className}(${task.children.map(signature).join(',')})`;
}

const SIZE_SLOP = 2;

function sameSize(a, b) {
  return Math.abs(a.w - b.w) <= SIZE_SLOP || Math.abs(a.h - b.h) <= SIZE_SLOP;
}

// Mark repeated siblings: the first of each set stays as it is, the others become
// copies of it.
function groupCopies(tasks) {
  const bySlot = new Map(); // parent element -> signature -> tasks
  for (const task of tasks) {
    if (task.kind === 'media' || !task.el.parentElement) continue;
    let sigs = bySlot.get(task.el.parentElement);
    if (!sigs) bySlot.set(task.el.parentElement, (sigs = new Map()));
    const sig = signature(task);
    if (!sigs.has(sig)) sigs.set(sig, []);
    sigs.get(sig).push(task);
  }
  for (const sigs of bySlot.values()) {
    for (const set of sigs.values()) {
      const master = set[0];
      const group = set.filter((t) => sameSize(t, master));
      if (group.length < 2) continue;
      for (const task of group) {
        task.group = group;
        if (task !== master) task.copyOf = master;
      }
    }
  }
  // text anywhere inside a copy is typed as a quick edit
  for (const task of tasks) {
    if (task.kind !== 'text') continue;
    for (let t = task; t; t = t.parent) {
      if (t.copyOf) {
        task.quick = true;
        break;
      }
    }
  }
}

function hasDirectText(el) {
  for (const n of el.childNodes) {
    if (n.nodeType === 3 && n.nodeValue.trim()) return true;
  }
  return false;
}

/**
 * @param {Element} root  the targeted element
 * @param {{ ignore?: string }} [options]
 * @returns {Array<object>} tasks in document order
 */
export function plan(root, { ignore = '[data-swarm-ignore]' } = {}) {
  const view = root.ownerDocument.defaultView;
  const tasks = [];
  const styleCache = new Map();
  const inlineCache = new Map();

  const cs = (el) => {
    let s = styleCache.get(el);
    if (!s) styleCache.set(el, (s = view.getComputedStyle(el)));
    return s;
  };

  // A ::before / ::after that draws something (a filled shape, or generated text).
  function paintedPseudo(el) {
    for (const which of ['::before', '::after']) {
      const p = view.getComputedStyle(el, which);
      const content = p.content;
      if (!content || content === 'none' || content === 'normal' || p.display === 'none') continue;
      if (content !== '""' && content !== "''") return true;
      if (decorated(p)) return true;
    }
    return false;
  }

  // True when every element inside is inline-level, i.e. the element is one run of text.
  function inlineOnly(el) {
    let v = inlineCache.get(el);
    if (v !== undefined) return v;
    v = true;
    for (const c of el.children) {
      if (SKIP.has(c.localName)) continue;
      const d = cs(c).display;
      if (d === 'none') continue;
      if (!(d.startsWith('inline') || d === 'contents' || d.startsWith('ruby')) || !inlineOnly(c)) {
        v = false;
        break;
      }
    }
    inlineCache.set(el, v);
    return v;
  }

  // A text block reads as one piece of copy. A row of inline-block buttons does not:
  // each of those becomes its own text task instead.
  function isTextBlock(el) {
    if (!inlineOnly(el)) return false;
    if (hasDirectText(el)) return true;
    let any = false;
    for (const c of el.children) {
      if (SKIP.has(c.localName)) continue;
      const d = cs(c).display;
      if (d === 'none' || !c.textContent.trim()) continue;
      if (d !== 'inline') return false;
      any = true;
    }
    return any;
  }

  function add(kind, el, parent, extra) {
    const task = {
      id: tasks.length,
      kind,
      el,
      parent,
      children: [],
      depth: parent ? parent.depth + 1 : 0,
      // leaves are hidden with opacity, containers with visibility (see reveal.js)
      leaf: kind === 'text' || kind === 'media',
      state: 'wait',
      inView: false,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      left: 0, // unbuilt tasks in this subtree, itself included (kept by the region)
      chars: 0,
      role: null, // media: 'image' | 'control'
      sides: null, // which borders to pen, or ['rule'] for an <hr>
      decorated: false, // text sitting in a box of its own
      group: null, // repeated siblings this task belongs to
      copyOf: null, // the first of that group, when this is not it
      quick: false,
      ...extra,
    };
    if (parent) parent.children.push(task);
    tasks.push(task);
    return task;
  }

  function walk(el, parent) {
    const name = el.localName;
    if (SKIP.has(name)) return;
    if (ignore && el !== root && el.matches(ignore)) return;

    const s = cs(el);
    // Hidden by the site itself (closed menus, reveal-on-scroll effects): leave it alone.
    if (s.display === 'none' || s.visibility !== 'visible' || parseFloat(s.opacity) === 0) return;
    // Not rendered for another reason, e.g. inside a closed <details>.
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) return;

    if (s.display !== 'contents') {
      const r = el.getBoundingClientRect();
      const sized = r.width >= MIN_SIZE && r.height >= MIN_SIZE;

      const size = { w: r.width, h: r.height };

      if (name === 'hr' && r.width >= MIN_SIZE && r.height <= RULE_MAX) {
        add('line', el, parent, { ...size, leaf: true, sides: ['rule'] });
        return;
      }

      if (IMAGES.has(name) || CONTROLS.has(name) || el.shadowRoot) {
        // an image that has not loaded yet has no size, but will
        const loading = name === 'img' && !el.complete;
        if (sized || loading) add('media', el, parent, { ...size, role: CONTROLS.has(name) ? 'control' : 'image' });
        return;
      }

      const shape = shapeOf(s);

      if (isTextBlock(el)) {
        if (sized) {
          add('text', el, parent, {
            ...size,
            chars: el.textContent.trim().replace(/\s+/g, ' ').length,
            // text in a shape of its own (button, badge, bordered cell): that is made first
            decorated: !!(shape && shape.box),
            sides: shape && shape.sides ? shape.sides : null,
          });
        }
        return;
      }

      if (sized) {
        if (shape && shape.sides) parent = add('line', el, parent, { ...size, sides: shape.sides });
        else if (shape || hasDirectText(el) || paintedPseudo(el)) parent = add('box', el, parent, size);
      }
    }

    for (const c of el.children) walk(c, parent);
  }

  // <html> and <body> are never tasks: the page background stays put.
  if (root.localName === 'html' || root.localName === 'body') {
    const body = root.localName === 'html' ? root.ownerDocument.body : root;
    if (body) for (const c of body.children) walk(c, null);
  } else {
    walk(root, null);
  }

  groupCopies(tasks);
  return tasks;
}
