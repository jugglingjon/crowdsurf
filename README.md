# swarm-web

A JavaScript library that builds part or all of a web page in front of the reader as they scroll.
Point it at a section, or at the whole page, and its elements wait hidden until they scroll into
view, then get built in order.

**Status: phase 3 of 6.** A crew of named cursors builds the page: boxes are dragged out with a
live size readout, images sweep in over a placeholder, lines are drawn with the pen, repeated
pieces are duplicated from a finished one, and text is typed into place. Still to come: a
once-only option and polish, packaged builds, then guides and sound.

**Demo:** https://jugglingjon.github.io/swarm-web/

## Use

```html
<section data-swarm> ... </section>

<script type="module">
  import { swarm } from './src/index.js';

  swarm();                  // every [data-swarm] element
  // swarm('#pricing');     // one region
  // swarm(document.body);  // the whole page
</script>
```

Or load `src/auto.js` as a module script to build every `[data-swarm]` element with no code.

For targets that are on screen when the page loads, add [`src/prehide.css`](src/prehide.css) in the
`<head>` so they are not painted before the script runs. Targets further down do not need it.

### Options

```js
const s = swarm('#features', {
  agents: 5,                      // agents working at once
  maxAgents: 12,                  // ceiling when a backlog builds up (fast scrolling)
  speed: 1,                       // build speed multiplier
  mistakes: 0,                    // share of pieces (0 to 1) built imperfectly, then corrected
  naturalMovement: false,         // hand-like curved cursor paths
  dillyDally: false,              // cursors sometimes loiter or read between jobs
  rootMargin: '0px',              // when an element counts as on screen
  ignore: '[data-swarm-ignore]',  // elements the swarm leaves alone
  names: ['Ada', 'Grace'],        // cursor names (defaults to a built-in list)
  colors: ['#6247ea', '#d93f4c'], // cursor colors, 6-digit hex (defaults to a built-in palette)
  respectReducedMotion: true,     // do nothing for visitors who prefer reduced motion
});
```

`data-swarm-speed`, `data-swarm-agents`, `data-swarm-max-agents`, `data-swarm-mistakes`,
`data-swarm-natural-movement` and `data-swarm-dilly-dally` on a target override these for that
region.

### Natural cursor movement

With `naturalMovement: true` cursors stop travelling in near-straight lines. Each trip is a curved
sweep (occasionally an S), quick off the mark and slow on the approach, and now and then runs a few
pixels past its target before settling back. Trip times vary, so no two cursors move in step.

### Dilly-dallying

With `dillyDally: true` a cursor that has just finished a job sometimes (about three times in ten)
takes a moment before the next. It either drifts a short way off and waits, or finds a line of
finished text nearby and runs along underneath it as if reading. A dallying cursor is called
straight back to work when every other cursor is busy, so it costs little build time.

### Imperfect placement

Set `mistakes` above zero and that share of pieces is built with a slip the agent then corrects:

- a box or image placeholder drawn too big and resized, or drawn in the wrong spot and moved
- a line drawn too long and pulled back
- a duplicate dropped off target and nudged into place
- text typed part of the way, a few characters deleted, then typed to the end
- a piece built slightly out of place, content and all, then selected and moved once it is
  finished. A card stays out of place until everything inside it is built

`mistakes: 0.25` means roughly one piece in four. Most slips only affect the drawing: the real
element is shown once the drawing is right, and deleted text is the real text hidden again, so no
wrong characters ever appear in the page. The out-of-place slip moves the real element with a
running animation of the CSS `translate` property, which changes no styles or layout and leaves
nothing behind. It is skipped for anything it would push past the edge of the page.

### Methods and events

| | |
| --- | --- |
| `s.on('start' \| 'progress' \| 'complete', fn)` | Fires per region with `{ element, done, total }` |
| `s.progress` | `{ done, total }` across all regions |
| `s.set({ speed: 2 })` | Change options while running |
| `s.finish()` | Build everything that is left, instantly |
| `s.replay()` | Hide everything and build again |
| `s.destroy()` | Stop and put every element back as it was |

Regions also dispatch `swarm:start` and `swarm:complete` DOM events.

## How it works

Nothing is cloned or screenshotted. The swarm hides the page's real elements and reveals them in place.

1. **Plan** ([`src/planner.js`](src/planner.js)). Walk the target and sort elements into four kinds
   of task: **box** (a container with a background, full border or shadow of its own), **line** (an
   `<hr>`, or a border on only one or two sides), **text** (a heading, paragraph, link or button)
   and **media** (image, SVG, video, form control). Plain wrappers get no task. Repeated siblings
   with the same tag, classes and make-up (cards, list rows, nav links) are grouped: the first is
   the original, the rest are copies.
2. **Hide** ([`src/reveal.js`](src/reveal.js)). Boxes get `visibility: hidden`; text and media get
   `opacity: 0`, so they stay available to screen readers and keyboard focus. Original inline styles
   are restored exactly when an element is built.
3. **Schedule** ([`src/scheduler.js`](src/scheduler.js), [`src/region.js`](src/region.js)). A task
   is ready once its parent box is built and it is on screen. Ready tasks are handed to a shared pool
   of agents in reading order, each going to the nearest free one. Anything scrolled past unseen is
   finished instantly.
4. **Build** ([`src/crew.js`](src/crew.js), [`src/choreo.js`](src/choreo.js)). Cursors live in one
   click-through layer above the page, removed again when the crew leaves. For a box an agent
   drags out an outline, then the real element fades in under it. An image gets a crossed
   placeholder, then is uncovered from the top. A line is drawn with the pen, anchor to anchor. A
   copy waits for its original to be finished, then an agent selects a finished sibling and drags
   a duplicate into place; the copy's boxes and icons arrive with it and its text is typed in. For text
   ([`src/typing.js`](src/typing.js)) the untyped part is made transparent with a CSS custom
   highlight that shrinks as the caret advances, so no wrapper elements are added and nothing
   reflows.

## Develop

No build step yet. Serve the repo root and open `/demo/`:

```bash
npm run serve
```

Browser checks (needs Playwright with Chromium):

```bash
npm test
```

## Known limits

- A copy waits for its original to be completely built, so a row of cards fills in one after the
  first. If part of the original is off screen, its copies wait until that part scrolls into view.
- A duplicate is shown as a tinted outline while it is dragged, not as a picture of the original.

- Typing needs the CSS Custom Highlight API (current Chrome, Edge, Safari and Firefox). Without it,
  text is drawn as a box and fades in.
- Inline pieces with their own background inside a paragraph (inline code, for example) show as soon
  as typing starts, before their text is typed.

- Loose text sitting directly in a container next to block elements appears with the container.
- Content that is hidden when the page loads (closed panels, inactive tabs) is left alone.
- Elements that are visible at load but never come on screen keep a region from reporting `complete`.
- Open shadow roots are treated as one piece of media, not built element by element.

## Credit

Inspired by [Swarm](https://califa.github.io/swarm-site/) by [Joel Califa](https://joelcalifa.com), a
site that builds itself as you scroll, and by [Swarm Rebuild](https://github.com/DhvanilPatel/swarm-cursors)
by Dhvanil Patel, a Chrome extension that points the same idea at any page. This library is written
from scratch and shares no code or assets with either.
