// Browser checks for the demo page. Needs Playwright with Chromium available:
//   node test/smoke.cjs
// Serves the repo itself, so nothing else has to be running.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function serve() {
  const server = http.createServer((req, res) => {
    let file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(ROOT)) return res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

let failures = 0;
function check(name, ok, extra = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
}

const opacityOf = (page, sel) => page.$eval(sel, (el) => getComputedStyle(el).opacity);
const visibilityOf = (page, sel) => page.$eval(sel, (el) => getComputedStyle(el).visibility);
const progress = (page) => page.evaluate(() => ({ ...window.demoSwarm.progress, complete: window.demoSwarm.complete }));
// inline visibility/opacity left behind on anything outside the demo's own controls
const residue = (page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll('[style]')].filter(
        (el) => !el.closest('[data-swarm-ignore], [data-swarm-layer]') && (el.style.visibility || el.style.opacity),
      ).length,
  );

async function scrollThrough(page, step = 300, pause = 250) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= height; y += step) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
    await page.waitForTimeout(pause);
  }
}

async function waitComplete(page, timeout = 20000) {
  await page.waitForFunction(() => window.demoSwarm.complete, null, { timeout });
}

const layer = (page) =>
  page.evaluate(() => {
    const host = document.querySelector('[data-swarm-layer]');
    const hl = CSS.highlights.get('swarm-web-pending');
    return {
      agents: host ? host.shadowRoot.querySelectorAll('.agent').length : 0,
      outlines: host ? host.shadowRoot.querySelectorAll('.rect').length : 0,
      pens: host ? host.shadowRoot.querySelectorAll('.path').length : 0,
      placeholders: host ? host.shadowRoot.querySelectorAll('.rect.media').length : 0,
      selections: host ? host.shadowRoot.querySelectorAll('.rect i').length / 4 : 0,
      carets: host ? host.shadowRoot.querySelectorAll('.caret').length : 0,
      hiddenText: hl ? hl.size : 0,
      mounted: !!host,
    };
  });

async function cleanShot(page, file) {
  // the cursors pack up and leave shortly after the work runs out
  await page.waitForFunction(() => !document.querySelector('[data-swarm-layer]'), null, { timeout: 8000 });
  await page.evaluate(() => {
    document.querySelectorAll('.dock, .plan-overlay').forEach((el) => (el.style.display = 'none'));
    document.documentElement.setAttribute('data-mode', 'off'); // same mode switch highlight as the baseline
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  await page.waitForTimeout(150);
  return page.screenshot({ path: path.join(OUT, file), fullPage: true });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/demo/`;
  const browser = await chromium.launch();
  const errors = [];
  const open = async (query, contextOptions = {}) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, ...contextOptions });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`${query}: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`${query}: ${m.text()}`));
    // the demo turns its extras on by default; tests opt in to each explicitly
    const defaults = ['mistakes', 'natural', 'dally'].filter((k) => !query.includes(k + '=')).map((k) => `&${k}=0`).join('');
    await page.goto(base + query + defaults);
    await page.waitForLoadState('load');
    return page;
  };

  // ------------------------------------------------------------ baseline
  let page = await open('?mode=off');
  const baseline = await cleanShot(page, 'baseline.png');
  await page.context().close();

  // ------------------------------------------------------------- regions
  page = await open('?mode=regions');
  await page.waitForTimeout(300);
  check('regions: hero is untouched', (await opacityOf(page, '.hero h1')) === '1' && (await visibilityOf(page, '.hero h1')) === 'visible');
  check('regions: a card below the fold is hidden', (await visibilityOf(page, '#features .card')) === 'hidden');
  check('regions: text below the fold is transparent', (await opacityOf(page, '#features .card h3')) === '0');
  check('regions: untargeted section is visible', (await opacityOf(page, '.plain h2')) === '1');
  let p = await progress(page);
  check('regions: tasks were planned and none built yet', p.total > 80 && p.done === 0, `(${p.done}/${p.total})`);
  const kinds = await page.evaluate(() => {
    const k = { box: 0, text: 0, media: 0, line: 0, copies: 0, images: 0, penned: 0 };
    for (const r of window.demoSwarm.regions) {
      for (const t of r.tasks) {
        k[t.kind]++;
        if (t.copyOf) k.copies++;
        if (t.role === 'image') k.images++;
        if (t.sides) k.penned++;
      }
    }
    return k;
  });
  check('regions: every kind found', kinds.box > 10 && kinds.text > 40 && kinds.media >= 9 && kinds.line >= 5, JSON.stringify(kinds));
  check('planner: repeated siblings are marked as copies', kinds.copies >= 20);
  check('planner: images and bordered cells are told apart', kinds.images === 7 && kinds.penned > 10);
  const cards = await page.evaluate(() => {
    const tasks = window.demoSwarm.regions[0].tasks.filter((t) => t.el.classList.contains('card'));
    return { n: tasks.length, masters: tasks.filter((t) => !t.copyOf).length, quick: tasks[1].children.filter((c) => c.kind === 'text').every((c) => c.quick) };
  });
  check('planner: one card is the original, five are copies', cards.n === 6 && cards.masters === 1 && cards.quick);

  // children never appear before their parent
  await page.evaluate(() => {
    window.orderViolations = 0;
    window.demoSwarm.on('progress', ({ region }) => {
      for (const t of region.tasks) if (t.state !== 'wait' && t.parent && t.parent.state !== 'done') window.orderViolations++;
    });
  });
  await page.evaluate(() => document.querySelector('#features').scrollIntoView({ behavior: 'instant' }));
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(OUT, 'regions-mid-build.png') });
  p = await progress(page);
  check('regions: building has started but not finished', p.done < p.total, `(${p.done}/${p.total})`);
  // sample the cursor layer while the first region builds: every kind of drawing should turn up
  const seen = { agents: 0, outlines: 0, carets: 0, hiddenText: 0, pens: 0, placeholders: 0, selections: 0 };
  // a copy is never animated before the one it is copied from is completely built
  // (content scrolled past unseen is finished outright, which is fine)
  await page.evaluate(() => {
    window.copyViolations = 0;
    window.demoSwarm.on('progress', ({ region }) => {
      for (const t of region.tasks) if (t.copyOf && t.state === 'build' && t.copyOf.left > 0) window.copyViolations++;
    });
  });
  for (let i = 0; i < 110; i++) {
    const l = await layer(page);
    for (const k in seen) seen[k] = Math.max(seen[k], l[k]);
    if (i === 20) await page.screenshot({ path: path.join(OUT, 'regions-cursors.png') });
    await page.waitForTimeout(40);
  }
  check('cursors: a line is penned, an image placeholder drawn, a sibling duplicated', seen.pens > 0 && seen.placeholders > 0 && seen.selections > 0);
  check('cursors: agents are on screen while building', seen.agents >= 3 && seen.agents <= 12, JSON.stringify(seen));
  check('cursors: outlines are dragged and text is typed', seen.outlines > 0 && seen.carets > 0 && seen.hiddenText > 0);
  await scrollThrough(page);
  await waitComplete(page);
  p = await progress(page);
  check('regions: everything built after scrolling through', p.done === p.total && p.complete, `(${p.done}/${p.total})`);
  check('regions: parents always built before children', (await page.evaluate(() => window.orderViolations)) === 0);
  check('duplicates: copies wait for the original to be finished', (await page.evaluate(() => window.copyViolations)) === 0);
  check('regions: no inline styles left behind', (await residue(page)) === 0);
  check('cursors: no text is left hidden mid-typing', (await layer(page)).hiddenText === 0);
  check('regions: finished page is pixel-identical to the plain page', baseline.equals(await cleanShot(page, 'regions-final.png')));
  await page.context().close();

  // ---------------------------------------------------------- whole page
  page = await open('?mode=page');
  await page.waitForTimeout(60);
  await page.screenshot({ path: path.join(OUT, 'page-first-frames.png') });
  check('page: body was un-hidden by the script', (await visibilityOf(page, 'body')) === 'visible');
  await page.waitForTimeout(1200);
  p = await progress(page);
  check('page: first screen builds without scrolling', p.done > 2 && p.done < p.total, `(${p.done}/${p.total})`);
  check('page: content below the fold still waits', (await opacityOf(page, '#pricing h2')) === '0');
  await scrollThrough(page);
  await waitComplete(page);
  check('page: no inline styles left behind', (await residue(page)) === 0);
  check('page: finished page is pixel-identical to the plain page', baseline.equals(await cleanShot(page, 'page-final.png')));
  await page.context().close();

  // ------------------------------------------------- jump straight to end
  page = await open('?mode=page');
  await page.waitForTimeout(200);
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await page.waitForTimeout(250);
  p = await progress(page);
  check('jump: skipped content is finished at once', p.done > p.total * 0.6, `(${p.done}/${p.total})`);
  await waitComplete(page, 8000);
  check('jump: page completes', true);
  await page.context().close();

  // ------------------------------------------- replay, finish and destroy
  page = await open('?mode=regions');
  await scrollThrough(page, 500, 120);
  await waitComplete(page);
  // replay from the top: regions that are above the viewport would be finished at once
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.evaluate(() => window.demoSwarm.replay());
  await page.waitForTimeout(50);
  p = await progress(page);
  check('replay: everything is hidden again', p.done < p.total && !p.complete, `(${p.done}/${p.total})`);
  await page.evaluate(() => window.demoSwarm.finish());
  p = await progress(page);
  check('finish: builds the rest instantly', p.done === p.total && p.complete && (await residue(page)) === 0);
  check('finish: no text is left hidden mid-typing', (await layer(page)).hiddenText === 0);
  await page.evaluate(() => window.demoSwarm.replay());
  await page.evaluate(() => window.demoSwarm.destroy());
  check('destroy: puts every element back', (await residue(page)) === 0 && (await opacityOf(page, '#features .card h3')) === '1');
  await page.context().close();

  // --------------------------------------------------------------- focus
  page = await open('?mode=regions');
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('#pricing .plan button').focus({ preventScroll: true }));
  const focused = await page.evaluate(() => {
    const btn = document.querySelector('#pricing .plan button');
    const card = btn.closest('.plan');
    return getComputedStyle(btn).opacity === '1' && getComputedStyle(card).visibility === 'visible';
  });
  check('focus: a focused control and its container are built at once', focused);
  await page.context().close();

  // ------------------------------------------------------ reduced motion
  page = await open('?mode=page', { reducedMotion: 'reduce' });
  await page.waitForTimeout(200);
  p = await progress(page);
  check('reduced motion: no cursor layer', !(await layer(page)).mounted);
  check('reduced motion: nothing is hidden or planned', p.total === 0 && (await opacityOf(page, '#pricing h2')) === '1' && (await visibilityOf(page, '#features .card')) === 'visible');
  await page.context().close();

  // ------------------------------------------------- imperfect placement
  page = await open('?mode=regions');
  await scrollThrough(page, 500, 150);
  await waitComplete(page);
  const noSlips = await page.evaluate(() => window.demoSwarm.regions.reduce((n, r) => n + r.slips, 0));
  check('mistakes: off means no slips at all', noSlips === 0, `(${noSlips})`);
  await page.context().close();

  page = await open('?mode=regions&mistakes=1');
  await page.evaluate(() => document.querySelector('#features').scrollIntoView({ behavior: 'instant' }));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, 'mistakes-mid-build.png') });
  // watch for pieces built out of place, and make sure they never widen the page
  await page.evaluate(() => {
    window.late = { leaves: 0, containers: 0, withContent: 0, overflow: 0, moved: 0, resized: 0, bigger: 0, rewrapped: 0 };
    window.linesThen = new Map();
    window.lineCount = (el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return new Set([...range.getClientRects()].filter((r) => r.width > 1).map((r) => Math.round(r.top))).size;
    };
    const seen = new Set();
    setInterval(() => {
      const root = document.documentElement;
      window.late.overflow = Math.max(window.late.overflow, root.scrollWidth - root.clientWidth);
      for (const r of window.demoSwarm.regions) {
        for (const t of r.tasks) {
          if (!t.shift) continue;
          if (!seen.has(t)) {
            seen.add(t);
            window.late[t.leaf ? 'leaves' : 'containers']++;
            window.late[t.shift.kind === 'size' ? 'resized' : 'moved']++;
          }
          if (t.shift.kind === 'size') {
            const r = t.el.getBoundingClientRect();
            const key = 'big:' + t.id;
            if (!seen.has(key) && (r.width > t.w + 8 || r.height > t.h + 8)) {
              seen.add(key);
              window.late.bigger++;
            }
            // note how many lines the text in (or of) a wrong-size piece wraps onto for now
            for (const c of [t, ...t.children]) {
              if (c.kind === 'text' && !window.linesThen.has(c)) window.linesThen.set(c, window.lineCount(c.el));
            }
          }
          // still out of place although it and everything inside it is built
          if (!t.leaf && t.left === 0 && !seen.has(t.el)) {
            seen.add(t.el);
            window.late.withContent++;
          }
        }
      }
    }, 30);
  });
  // slowly, so pieces are built on screen and not finished outright by being scrolled past
  await scrollThrough(page, 150, 1500);
  await waitComplete(page, 60000);
  const slipCount = await page.evaluate(() => window.demoSwarm.regions.reduce((n, r) => n + r.slips, 0));
  check('mistakes: at 100% most pieces slip', slipCount > 50, `(${slipCount} slips over ${(await progress(page)).total} tasks)`);
  check('mistakes: nothing left behind', (await residue(page)) === 0 && (await layer(page)).hiddenText === 0);
  await page.evaluate(() => {
    // text that sat on a different number of lines while its piece was the wrong size
    for (const [task, then] of window.linesThen) if (window.lineCount(task.el) !== then) window.late.rewrapped++;
    window.late.textChecked = window.linesThen.size;
  });
  const late = await page.evaluate(() => window.late);
  check('late slip: pieces are built out of place', late.leaves > 3 && late.containers > 1, JSON.stringify(late));
  check('late slip: both kinds happen, out of place and wrong size', late.moved > 3 && late.resized > 3);
  // how often text re-wraps depends on which pieces happen to slip, so it is reported, not required
  check('wrong size: pieces really are built bigger', late.bigger > 3, `(${late.rewrapped} of ${late.textChecked} text pieces re-wrapped)`);
  check('late slip: a container is moved only after its contents are built', late.withContent > 0);
  check('late slip: never widens the page', late.overflow <= 0, `(overflow ${late.overflow}px)`);
  const leftover = await page.evaluate(() =>
    window.demoSwarm.regions.reduce((n, r) => n + r.tasks.filter((t) => t.shift || t.el.getAnimations().length).length + r.chores.size, 0),
  );
  check('late slip: no offsets or animations left on any element', leftover === 0, `(${leftover})`);
  check('mistakes: finished page is still pixel-identical to the plain page', baseline.equals(await cleanShot(page, 'mistakes-final.png')));
  await page.evaluate(() => window.demoSwarm.set({ mistakes: 0.5 }));
  check('mistakes: can be changed while running', (await page.evaluate(() => window.demoSwarm.regions[0].opts.mistakes)) === 0.5);
  await page.context().close();

  // ------------------------------------- natural movement, dilly-dallying
  page = await open('?mode=regions&natural=1&dally=1');
  await page.evaluate(() => {
    window.sawDallying = 0;
    setInterval(() => {
      const host = document.querySelector('[data-swarm-layer]');
      if (host) window.sawDallying = Math.max(window.sawDallying, host.shadowRoot.querySelectorAll('.agent').length);
    }, 50);
  });
  await scrollThrough(page, 200, 700);
  await waitComplete(page, 60000);
  const extras = await page.evaluate(() => ({
    dallies: window.demoSwarm.regions.reduce((n, r) => n + r.dallies, 0),
    natural: window.demoSwarm.regions.every((r) => r.opts.naturalMovement === true),
    agents: window.sawDallying,
  }));
  check('dilly-dally: cursors dawdle between jobs', extras.dallies > 5, JSON.stringify(extras));
  check('dilly-dally: never puts more cursors on screen than allowed', extras.agents > 0 && extras.agents <= 12);
  check('natural movement: on, and the build still completes cleanly', extras.natural && (await residue(page)) === 0);
  check('extras: finished page is pixel-identical to the plain page', baseline.equals(await cleanShot(page, 'extras-final.png')));
  await page.context().close();

  page = await open('?mode=regions');
  await scrollThrough(page, 500, 150);
  await waitComplete(page);
  check('dilly-dally: off means no dawdling', (await page.evaluate(() => window.demoSwarm.regions.reduce((n, r) => n + r.dallies, 0))) === 0);
  await page.context().close();

  // -------------------------------------------------------------- mobile
  page = await open('?mode=regions', { viewport: { width: 390, height: 800 } });
  await scrollThrough(page, 400, 150);
  await waitComplete(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.waitForFunction(() => !document.querySelector('[data-swarm-layer]'), null, { timeout: 8000 });
  check('cursors: layer is removed once the crew has left', true);
  check('mobile: completes with no sideways scroll', overflow <= 0, `(overflow ${overflow}px)`);
  await page.context().close();

  check('no page or console errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  server.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
