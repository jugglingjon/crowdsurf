// Typing real text without touching the DOM.
//
// The text is already in the page. To make it look typed, the part that has not been
// "typed" yet is covered by a range in a CSS custom highlight whose color is
// transparent, and the range shrinks as typing advances. No wrapper elements, no
// layout change: the text occupies its final position from the first character.

const NAME = 'swarm-web-pending';
let highlight = null;

export function canType() {
  return typeof Highlight === 'function' && typeof CSS !== 'undefined' && !!CSS.highlights && typeof CSSStyleSheet === 'function';
}

function pending() {
  if (!highlight) {
    highlight = new Highlight();
    CSS.highlights.set(NAME, highlight);
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`::highlight(${NAME}){color:transparent;-webkit-text-fill-color:transparent;text-shadow:none}`);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }
  return highlight;
}

/** Number of text ranges currently hidden mid-typing (for tests and debugging). */
export function pendingCount() {
  return highlight ? highlight.size : 0;
}

/**
 * @returns {null | { count: number, hideAll(): void, reveal(n: number): void,
 *   caret(n: number): {x:number,y:number,h:number} | null, release(): void }}
 */
export function createTyper(el) {
  const doc = el.ownerDocument;
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const segs = [];
  let total = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue.trim()) continue;
    segs.push({ node, start: total, len: node.length });
    total += node.length;
  }
  if (!segs.length) return null;

  // don't spend time "typing" the indentation around the text in the source
  const first = segs[0];
  const last = segs[segs.length - 1];
  const lead = first.node.nodeValue.length - first.node.nodeValue.trimStart().length;
  const trail = last.node.nodeValue.length - last.node.nodeValue.trimEnd().length;
  const count = total - lead - trail;
  if (count <= 0) return null;

  const range = doc.createRange();
  const probe = doc.createRange();
  let cursor = 0; // segment index the caret was last in
  let lastCaret = null;

  function locate(index) {
    while (cursor > 0 && index < segs[cursor].start) cursor--; // deleting goes backwards
    while (cursor < segs.length - 1 && index >= segs[cursor].start + segs[cursor].len) cursor++;
    const seg = segs[cursor];
    return [seg.node, Math.min(seg.len, Math.max(0, index - seg.start))];
  }

  return {
    count,

    hideAll() {
      range.setStart(first.node, lead);
      range.setEnd(last.node, last.len);
      pending().add(range);
    },

    // show the first n characters
    reveal(n) {
      const [node, offset] = locate(lead + Math.min(n, count));
      range.setStart(node, offset);
    },

    // where the caret sits after n characters, in page coordinates
    caret(n) {
      const at = Math.max(0, Math.min(n, count) - 1);
      const [node, offset] = locate(lead + at);
      if (offset < node.length) {
        probe.setStart(node, offset);
        probe.setEnd(node, offset + 1);
        const rects = probe.getClientRects();
        const r = rects[rects.length - 1];
        // collapsed whitespace has no box: keep the caret where it was
        if (r && r.height > 0 && (r.width > 0 || !lastCaret)) {
          lastCaret = { x: (n > 0 ? r.right : r.left) + window.scrollX, y: r.top + window.scrollY, h: r.height };
        }
      }
      return lastCaret;
    },

    release() {
      if (highlight) highlight.delete(range);
    },
  };
}
