# Crowdsurf

A JavaScript library that builds part or all of a web page in front of the reader as they scroll.
Point it at a section, or at the whole page, and its elements wait hidden until they scroll into
view, then get built in order.

**Status: early release.** On npm as [`crowdsurf`](https://www.npmjs.com/package/crowdsurf). Its
checks pass in Chromium, Firefox and WebKit.

**Demo:** https://jugglingjon.github.io/crowdsurf/

## Use

### With a script tag

No build step and no code. Mark what should be built with `data-crowdsurf`:

```html
<link rel="stylesheet" href="https://unpkg.com/crowdsurf@0.1/dist/prehide.css">
<script src="https://unpkg.com/crowdsurf@0.1/dist/crowdsurf.auto.min.js" defer></script>

<section data-crowdsurf> ... </section>
```

To call it yourself instead, load `dist/crowdsurf.global.min.js`, which defines `window.crowdsurf`
and nothing more. The same files are on [jsDelivr](https://cdn.jsdelivr.net/npm/crowdsurf@0.1/dist/)
and on the demo site, or copy them out of the package and serve them yourself.

`prehide.css` keeps targets that are on screen at page load from being painted before the script
runs. Targets further down the page do not need it.

### As a module

```bash
npm install crowdsurf
```

```js
import { crowdsurf } from 'crowdsurf';

crowdsurf();                  // every [data-crowdsurf] element
crowdsurf('#pricing');        // one region
crowdsurf(document.body);     // the whole page
```

`import 'crowdsurf/auto'` builds every `[data-crowdsurf]` element with no further code, and
`crowdsurf/prehide.css` is the stylesheet above. Type definitions are included.

### Options at a glance

```js
const s = crowdsurf('#features', {
  speed: 1,               // build speed multiplier
  agents: 5,              // cursors working at once
  mistakes: 0.2,          // share of pieces built imperfectly, then corrected
  slips: { retype: 0 },   // which kinds of slip: 0 turns one off, 2 doubles it
  naturalMovement: true,  // hand-like curved cursor paths
  dillyDally: true,       // cursors sometimes loiter or read between jobs
  once: 'session',        // skip what a visitor has already seen
  watch: true,            // also build elements added later
});

s.on('complete', ({ element }) => console.log('built', element));
s.finish();   // build the rest instantly
s.replay();   // hide everything and build again
s.destroy();  // stop and restore the page
```

- **[Options and API](docs/options.md):** every option, method, event and attribute.
- **[Recipes](docs/recipes.md):** whole-page setup, first-visit-only, lazy lists, single-page apps,
  and trying it on any site from the console.

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

The demo pages run straight from `src/` with no build step. Serve the repo root and open `/demo/`:

```bash
npm run serve
```

Build `dist/` (an ES module, a script-tag file and an auto-run version of each):

```bash
npm run build
```

Browser checks (builds first; needs Playwright, and `BROWSER=firefox` or `BROWSER=webkit` picks
another engine):

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

## License

[MIT](LICENSE)
