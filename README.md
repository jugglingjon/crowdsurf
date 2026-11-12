# Crowdsurf

A JavaScript library that builds part or all of a web page in front of the reader as they scroll.
Point it at a section, or at the whole page, and its elements wait hidden until they scroll into
view, then get built in order.

**Status: phase 4 of 6.** A crew of named cursors builds the page: boxes are dragged out with a
live size readout, images sweep in over a placeholder, lines are drawn with the pen, repeated
pieces are duplicated from a finished one, and text is typed into place. Still to come: packaged
builds and a release, then guides and sound.

**Demo:** https://jugglingjon.github.io/swarm-web/

## Use

```html
<section data-crowdsurf> ... </section>

<script type="module">
  import { crowdsurf } from './src/index.js';

  crowdsurf();                  // every [data-crowdsurf] element
  // crowdsurf('#pricing');     // one region
  // crowdsurf(document.body);  // the whole page
</script>
```

Or load `src/auto.js` as a module script to build every `[data-crowdsurf]` element with no code.

For targets that are on screen when the page loads, add [`src/prehide.css`](src/prehide.css) in the
`<head>` so they are not painted before the script runs. Targets further down do not need it.

### Options

```js
const s = crowdsurf('#features', {
  agents: 5,                      // agents working at once
  maxAgents: 12,                  // ceiling when a backlog builds up (fast scrolling)
  speed: 1,                       // build speed multiplier
  mistakes: 0,                    // share of pieces (0 to 1) built imperfectly, then corrected
  naturalMovement: false,         // hand-like curved cursor paths
  dillyDally: false,              // cursors sometimes loiter or read between jobs
  rootMargin: '0px',              // when an element counts as on screen
  ignore: '[data-crowdsurf-ignore]',  // elements the crew leaves alone
  once: false,                    // skip what a visitor has already seen: 'session', true, or days
  watch: false,                   // also build elements added to the region later
  names: ['Ada', 'Grace'],        // cursor names (defaults to a built-in list)
  colors: ['#6247ea', '#d93f4c'], // cursor colors, 6-digit hex (defaults to a built-in palette)
  respectReducedMotion: true,     // do nothing for visitors who prefer reduced motion
});
```

`data-crowdsurf-speed`, `data-crowdsurf-agents`, `data-crowdsurf-max-agents`, `data-crowdsurf-mistakes`,
`data-crowdsurf-natural-movement`, `data-crowdsurf-dilly-dally`, `data-crowdsurf-once` and `data-crowdsurf-watch` on
a target override these for that region.

### Once only

`once` stops returning visitors sitting through the build again. A region is remembered when it
finishes building; next time it is left exactly as it is.

- `once: 'session'` remembers until the tab is closed
- `once: true` remembers for good
- `once: 7` remembers for seven days

Regions are remembered per page path and element id (or position among the targets). Set `onceKey`
to share one memory across several pages. `replay()` builds a skipped region anyway, and the
exported `forget()` clears everything remembered. If storage is blocked the region just builds.

### Content added later

With `watch: true`, elements added to a region after it was planned (a lazy-loaded list, a "load
more" button) are hidden before they are painted and built like the rest. A region that had
already finished reopens and fires `complete` again when the new arrivals are done. It is off by
default because on a page that updates itself constantly, every update would be rebuilt.

### Scrolling panels

A target inside an element that scrolls on its own (an app shell, a sidebar, a modal) follows that
element's scrolling: content further down the panel waits until the panel is scrolled to it.

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
- a piece built too wide, too tall or both, so that what is inside it is laid out and wrapped for
  the wrong size. Once it is finished a cursor drags its corner handle to the right size and the
  contents reflow as it goes

- a piece with rounded corners built square, then rounded off: the cursor takes the round handle
  inside the corner and drags it inwards, with a live radius readout

`mistakes: 0.25` means roughly one piece in four. Most slips only affect the drawing: the real
element is shown once the drawing is right, and deleted text is the real text hidden again, so no
wrong characters ever appear in the page. The last three act on the real element, but only through running
animations (`translate` for position; `width` and `height` for size, with matching negative margins
so the piece keeps its footprint and its neighbours stay put; `border-radius` for corners). No styles are written and nothing
is left behind. Both are skipped for anything they would push past the edge of the page, and the
size slip is skipped for images and table cells.

### Methods and events

| | |
| --- | --- |
| `s.on('start' \| 'progress' \| 'complete', fn)` | Fires per region with `{ element, done, total }` |
| `s.progress` | `{ done, total }` across all regions |
| `s.set({ speed: 2 })` | Change options while running |
| `s.finish()` | Build everything that is left, instantly |
| `s.replay()` | Hide everything and build again, including regions `once` had skipped |
| `s.skipped` | How many targets `once` left alone |
| `forget()` | Exported function: clear what `once` has remembered |
| `s.destroy()` | Stop and put every element back as it was |

Regions also dispatch `crowdsurf:start` and `crowdsurf:complete` DOM events.

## How it works

Nothing is cloned or screenshotted. Crowdsurf hides the page's real elements and reveals them in place.

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
   a duplicate into place with a closed-hand cursor; the copy's boxes and icons arrive with it and
   its text is typed in. For text
   ([`src/typing.js`](src/typing.js)) the untyped part is made transparent with a CSS custom
   highlight that shrinks as the caret advances, so no wrapper elements are added and nothing
   reflows.

## Develop

No build step yet. Serve the repo root and open `/demo/`:

```bash
npm run serve
```

Browser checks (needs Playwright; `BROWSER=firefox` or `BROWSER=webkit` picks another engine):

```bash
npm test
```

The same checks run in Chromium, Firefox and WebKit on every push
([`.github/workflows/test.yml`](.github/workflows/test.yml)).

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
- Content that is level with the screen but cannot be seen (carousel slides off to the side, an
  off-canvas menu, anything clipped to nothing) is shown as it is after a moment, not built.
- Content further down a scrolling panel that is never scrolled to stays unbuilt, and keeps its
  region from reporting `complete`.
- Outlines and cursors are drawn over the whole viewport, so for a piece half-hidden by the edge of
  a scrolling panel they can spill a little outside the panel.
- Open shadow roots are treated as one piece of media, not built element by element.

## Credit

Inspired by [Swarm](https://califa.github.io/swarm-site/) by [Joel Califa](https://joelcalifa.com), a
site that builds itself as you scroll, and by [Swarm Rebuild](https://github.com/DhvanilPatel/swarm-cursors)
by Dhvanil Patel, a Chrome extension that points the same idea at any page. This library is written
from scratch and shares no code or assets with either.
