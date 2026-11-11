# swarm-web

A JavaScript library that builds part or all of a web page in front of the reader as they scroll.
Point it at a section, or at the whole page, and its elements wait hidden until they scroll into
view, then get built in order.

**Status: phase 1 of 6.** The planner and scheduler work. The cursor swarm that does the building
arrives in phase 2; until then each element fades in.

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
  agents: 4,                      // agents working at once
  maxAgents: 12,                  // ceiling when a backlog builds up (fast scrolling)
  speed: 1,                       // build speed multiplier
  rootMargin: '0px',              // when an element counts as on screen
  ignore: '[data-swarm-ignore]',  // elements the swarm leaves alone
  respectReducedMotion: true,     // do nothing for visitors who prefer reduced motion
});
```

`data-swarm-speed`, `data-swarm-agents` and `data-swarm-max-agents` on a target override these for
that region.

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

1. **Plan** ([`src/planner.js`](src/planner.js)). Walk the target and sort elements into three kinds
   of task: **box** (a container with a background, border or shadow of its own), **text** (a
   heading, paragraph, link or button) and **media** (image, SVG, video, form control). Plain
   wrappers get no task.
2. **Hide** ([`src/reveal.js`](src/reveal.js)). Boxes get `visibility: hidden`; text and media get
   `opacity: 0`, so they stay available to screen readers and keyboard focus. Original inline styles
   are restored exactly when an element is built.
3. **Schedule** ([`src/scheduler.js`](src/scheduler.js), [`src/region.js`](src/region.js)). A task
   is ready once its parent box is built and it is on screen. Ready tasks are handed to a shared pool
   of agents in reading order. Anything scrolled past unseen is finished instantly.

## Develop

No build step yet. Serve the repo root and open `/demo/`:

```bash
npm run serve
```

Browser checks (needs Playwright with Chromium):

```bash
npm test
```

## Known limits in phase 1

- Loose text sitting directly in a container next to block elements appears with the container.
- Content that is hidden when the page loads (closed panels, inactive tabs) is left alone.
- Elements that are visible at load but never come on screen keep a region from reporting `complete`.
- Open shadow roots are treated as one piece of media, not built element by element.

## Credit

Inspired by [Swarm](https://califa.github.io/swarm-site/) by [Joel Califa](https://joelcalifa.com), a
site that builds itself as you scroll, and by [Swarm Rebuild](https://github.com/DhvanilPatel/swarm-cursors)
by Dhvanil Patel, a Chrome extension that points the same idea at any page. This library is written
from scratch and shares no code or assets with either.
