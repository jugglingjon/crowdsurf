# Recipes

Short, complete examples for common setups. They use the module build; with the script-tag build,
drop the `import` and call the global `crowdsurf` instead.

## One section, with no JavaScript of your own

```html
<link rel="stylesheet" href="prehide.css">
<script src="crowdsurf.auto.min.js" defer></script>

<section data-crowdsurf data-crowdsurf-speed="1.5"> ... </section>
```

## The whole page

The first screen is visible as soon as the page loads, so hide the body until Crowdsurf has taken
over. The animation is a safety net that shows the page after four seconds if the script never runs.

```html
<style>
  body:not([data-crowdsurf-ready]) { visibility: hidden; animation: show 0s 4s forwards; }
  @keyframes show { to { visibility: visible; } }
  @media (prefers-reduced-motion: reduce) { body:not([data-crowdsurf-ready]) { visibility: visible; } }
</style>

<script type="module">
  import { crowdsurf } from 'crowdsurf';
  crowdsurf(document.body);
</script>
```

## Only on a visitor's first visit this week

```js
crowdsurf('#features', { once: 7 });
```

## A livelier crew

```js
crowdsurf('[data-crowdsurf]', {
  mistakes: 0.2,
  naturalMovement: true,
  dillyDally: true,
});
```

## Your own crew

```js
crowdsurf('#team', {
  names: ['Priya', 'Tom', 'Ana'],
  colors: ['#0b7fd1', '#c8660a', '#0b8f6c'],
  agents: 3,
  maxAgents: 3,
});
```

## Keep something out of it

Anything matching `ignore` is left alone, along with everything inside it.

```html
<section data-crowdsurf>
  <h2>Built</h2>
  <div data-crowdsurf-ignore>A video player, a map, a cookie banner: shown as normal.</div>
</section>
```

## A list that loads more as you scroll

```js
crowdsurf('#feed', { watch: true });
```

## Do something when a section has been built

```js
crowdsurf('#pricing').on('complete', ({ element }) => {
  element.classList.add('is-built');
});
```

Or, without holding on to the instance:

```js
document.addEventListener('crowdsurf:complete', (e) => console.log('built', e.target.id));
```

## A "skip" button

```js
const s = crowdsurf(document.body);
document.querySelector('#skip').addEventListener('click', () => s.finish());
```

## Single-page apps

Call `destroy()` when the view is torn down. It stops the build and restores every element.

```js
// React
useEffect(() => {
  const s = crowdsurf(ref.current);
  return () => s.destroy();
}, []);
```

## Try it on any website from the console

Paste into the browser console:

```js
const { crowdsurf } = await import('https://jugglingjon.github.io/crowdsurf/dist/crowdsurf.js');
const s = crowdsurf(document.body, { mistakes: 0.3, naturalMovement: true, dillyDally: true });
```

Some sites refuse scripts from other addresses and the import fails with a content security policy
error. For those, open
[`crowdsurf.global.min.js`](https://jugglingjon.github.io/crowdsurf/dist/crowdsurf.global.min.js),
copy the whole file, paste it into the console, then run:

```js
const s = crowdsurf(document.body, { mistakes: 0.3, naturalMovement: true, dillyDally: true });
```

Scroll to the top first: anything above where you are is finished instantly. If your system is set
to reduce motion, add `respectReducedMotion: false`.
