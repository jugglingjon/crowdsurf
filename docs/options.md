# Options and API

```js
import { crowdsurf } from 'crowdsurf';

const s = crowdsurf(target, options);
```

`target` is a selector, an element, or a collection of elements. Leave it out to build every
`[data-crowdsurf]` element. Pass `document.body` to build the whole page.

## Options

| Option | Default | Attribute | What it does |
| --- | --- | --- | --- |
| `agents` | `5` | `data-crowdsurf-agents` | Cursors working at once in calm conditions |
| `maxAgents` | `12` | `data-crowdsurf-max-agents` | Ceiling when a backlog builds up, as when scrolling fast |
| `speed` | `1` | `data-crowdsurf-speed` | Build speed multiplier |
| `mistakes` | `0` | `data-crowdsurf-mistakes` | Share of pieces (0 to 1) built with a slip that is then corrected |
| `naturalMovement` | `false` | `data-crowdsurf-natural-movement` | Hand-like curved cursor paths |
| `dillyDally` | `false` | `data-crowdsurf-dilly-dally` | Cursors sometimes loiter or read between jobs |
| `once` | `false` | `data-crowdsurf-once` | Skip what a visitor has already seen: `'session'`, `true`, or a number of days |
| `onceKey` | page path | | What `once` remembers a page by |
| `watch` | `false` | `data-crowdsurf-watch` | Also build elements added to the region later |
| `ignore` | `'[data-crowdsurf-ignore]'` | | Selector for elements, and everything in them, that are left alone |
| `rootMargin` | `'0px'` | | IntersectionObserver margin: when an element counts as on screen |
| `names` | built-in list | | Cursor names, e.g. `['Ada', 'Grace']` |
| `colors` | built-in palette | | Cursor colors as 6-digit hex, e.g. `['#6247ea', '#d93f4c']` |
| `respectReducedMotion` | `true` | | Do nothing for visitors who prefer reduced motion |

An attribute on a target overrides the option for that region. On/off attributes are on when
present (`data-crowdsurf-watch`) and off when set to `"false"`.

Options can be changed while a build is running with `s.set({ ... })`.

## Methods

| | |
| --- | --- |
| `s.on(type, fn)` / `s.off(type, fn)` | Listen for `'start'`, `'progress'` or `'complete'`. Each fires per region with `{ type, region, element, done, total }` |
| `s.set({ speed: 2 })` | Change options while running |
| `s.finish()` | Build everything that is left, instantly |
| `s.replay()` | Hide everything and build again, including regions `once` had skipped |
| `s.destroy()` | Stop, and put every element back exactly as it was |
| `s.progress` | `{ done, total }` across all regions |
| `s.complete` | `true` when every region has finished |
| `s.skipped` | How many targets `once` left alone |
| `s.regions` | One entry per target, each with `el`, `done`, `total`, `completed`, `slips`, `dallies` |

Also exported:

| | |
| --- | --- |
| `forget()` | Clear what `once` has remembered, so everything builds again |
| `activeAgents()` | How many cursors are working right now |
| `DEFAULTS` | The default value of every option |

In the script-tag build these hang off the global: `crowdsurf.forget()`, `crowdsurf.activeAgents()`,
`crowdsurf.defaults`.

## DOM events

Each region's element dispatches `crowdsurf:start` and `crowdsurf:complete`. Both bubble, and
`event.detail` is the same object the listeners above receive.

```js
document.addEventListener('crowdsurf:complete', (e) => console.log('built', e.target));
```

## Markup

| Attribute | Meaning |
| --- | --- |
| `data-crowdsurf` | A target for `crowdsurf()` with no arguments, and for the auto builds |
| `data-crowdsurf-ignore` | Leave this element and everything in it alone |
| `data-crowdsurf-ready` | Set by Crowdsurf on a target once it has taken over. `prehide.css` keys off it |

## Imperfect placement

Set `mistakes` above zero and that share of pieces is built with a slip the cursor then corrects.
`mistakes: 0.25` means roughly one piece in four.

Caught while drawing, before the real element appears:

- a box or image placeholder drawn too big and resized, or drawn in the wrong spot and moved
- a line drawn too long and pulled back
- a duplicate dropped off target and nudged into place
- text typed part of the way, a few characters deleted, then typed to the end

Caught late, on the real element:

- **Out of place.** Built slightly off, content and all, then selected and moved. A card stays out
  of place until everything inside it is built.
- **Wrong size.** Built too wide, too tall or both, so its contents are laid out and wrapped for
  the wrong size. Once it is finished a cursor drags its corner handle to the right size and the
  contents reflow as it goes.
- **Square corners.** A piece with rounded corners is built square, then rounded off: the cursor
  takes the round handle inside the corner and drags it inwards, with a live radius readout.

Deleted text is the real text hidden again, so no wrong characters ever appear in the page. The
late slips act on the real element only through running animations: `translate` for position;
`width` and `height` for size, with matching negative margins so the piece keeps its footprint and
its neighbours stay put; `border-radius` for corners. No styles are written and nothing is left
behind. A late slip is skipped for anything it would push past the edge of the page or that covers
more than half the screen, and the size slip is skipped for images and table cells.

## Natural cursor movement

With `naturalMovement: true` cursors stop travelling in near-straight lines. Each trip is a curved
sweep (occasionally an S), quick off the mark and slow on the approach, and now and then runs a few
pixels past its target before settling back. Trip times vary, so no two cursors move in step.

## Dilly-dallying

With `dillyDally: true` a cursor that has just finished a job sometimes (about three times in ten)
takes a moment before the next. It either drifts a short way off and waits, or finds a line of
finished text nearby and runs along underneath it as if reading. A dallying cursor is called
straight back to work when every other cursor is busy, so it costs little build time.

## Once only

`once` stops returning visitors sitting through the build again. A region is remembered when it
finishes building; next time it is left exactly as it is.

- `once: 'session'` remembers until the tab is closed
- `once: true` remembers for good
- `once: 7` remembers for seven days

Regions are remembered per page path and element id (or position among the targets). Set `onceKey`
to share one memory across several pages. `replay()` builds a skipped region anyway, and `forget()`
clears everything remembered. If storage is blocked the region just builds.

## Content added later

With `watch: true`, elements added to a region after it was planned (a lazy-loaded list, a "load
more" button) are hidden before they are painted and built like the rest. A region that had
already finished reopens and fires `complete` again when the new arrivals are done. It is off by
default because on a page that updates itself constantly, every update would be rebuilt.

## Scrolling panels

A target inside an element that scrolls on its own (an app shell, a sidebar, a modal) follows that
element's scrolling: content further down the panel waits until the panel is scrolled to it.

## TypeScript

Types ship with the package. The option and event shapes are exported as `CrowdsurfOptions`,
`CrowdsurfEvent`, `CrowdsurfRegion` and `Crowdsurf` (the object `crowdsurf()` returns).
