// Planner: walks a target element and decides which elements the swarm will build.
//
// Nothing is cloned. Every task points at a real element, which is hidden until its
// turn and then revealed in place. There are three kinds of task:
//
//   box    a container with something of its own to show (background, border, shadow,
//          a decorative pseudo-element or loose text). Its children wait for it.
//   text   a block whose content is all inline: a heading, paragraph, link, button.
//   media  an atomic element: image, svg, video, canvas, iframe, form control, <hr>,
//          or a web component with a shadow root.
//
// Plain wrappers with nothing visible of their own get no task. Their children attach
// to the nearest box above them.

const SKIP = new Set([
  'script', 'style', 'link', 'meta', 'title', 'head', 'template', 'noscript', 'br', 'wbr',
  'source', 'track', 'param', 'base', 'datalist', 'option', 'optgroup', 'area', 'map',
]);

const ATOMIC = new Set([
  'img', 'picture', 'svg', 'video', 'audio', 'canvas', 'iframe', 'embed', 'object',
  'input', 'select', 'textarea', 'hr', 'progress', 'meter', 'math',
]);

// Smaller than this in either direction is treated as invisible (this also leaves
// screen-reader-only text alone, so it is never hidden from assistive tech).
const MIN_SIZE = 2;

const CLEAR_LEGACY = /^rgba\(.*,\s*0(\.0+)?\s*\)$/;
const CLEAR_MODERN = /\/\s*0(\.0+)?%?\s*\)$/;

function paints(color) {
  return !!color && color !== 'transparent' && !CLEAR_LEGACY.test(color) && !CLEAR_MODERN.test(color);
}

function hasBorder(s) {
  for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
    const style = s[`border${side}Style`];
    if (style !== 'none' && style !== 'hidden' && parseFloat(s[`border${side}Width`]) > 0 && paints(s[`border${side}Color`])) {
      return true;
    }
  }
  return false;
}

function decorated(s) {
  return (
    paints(s.backgroundColor) ||
    s.backgroundImage !== 'none' ||
    s.boxShadow !== 'none' ||
    (s.backdropFilter && s.backdropFilter !== 'none') ||
    hasBorder(s)
  );
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
      state: 'wait',
      inView: false,
      x: 0,
      y: 0,
      chars: 0,
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

      if (ATOMIC.has(name) || el.shadowRoot) {
        // an image that has not loaded yet has no size, but will
        const loading = name === 'img' && !el.complete;
        if (sized || loading) add('media', el, parent);
        return;
      }

      if (isTextBlock(el)) {
        if (sized) {
          add('text', el, parent, {
            chars: el.textContent.trim().replace(/\s+/g, ' ').length,
            // text in a shape of its own (button, badge): the shape is drawn first
            decorated: decorated(s),
          });
        }
        return;
      }

      if (sized && (decorated(s) || hasDirectText(el) || paintedPseudo(el))) {
        parent = add('box', el, parent);
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

  return tasks;
}
