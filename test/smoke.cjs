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
        (el) => !el.closest('[data-swarm-ignore]') && (el.style.visibility || el.style.opacity),
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

async function cleanShot(page, file) {
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
    await page.goto(base + query);
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
    const k = { box: 0, text: 0, media: 0 };
    for (const r of window.demoSwarm.regions) for (const t of r.tasks) k[t.kind]++;
    return k;
  });
  check('regions: all three kinds found', kinds.box > 10 && kinds.text > 40 && kinds.media >= 9, JSON.stringify(kinds));

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
  check('regions: building has started but not finished', p.done > 0 && p.done < p.total, `(${p.done}/${p.total})`);
  await scrollThrough(page);
  await waitComplete(page);
  p = await progress(page);
  check('regions: everything built after scrolling through', p.done === p.total && p.complete, `(${p.done}/${p.total})`);
  check('regions: parents always built before children', (await page.evaluate(() => window.orderViolations)) === 0);
  check('regions: no inline styles left behind', (await residue(page)) === 0);
  check('regions: finished page is pixel-identical to the plain page', baseline.equals(await cleanShot(page, 'regions-final.png')));
  await page.context().close();

  // ---------------------------------------------------------- whole page
  page = await open('?mode=page');
  await page.waitForTimeout(60);
  await page.screenshot({ path: path.join(OUT, 'page-first-frames.png') });
  check('page: body was un-hidden by the script', (await visibilityOf(page, 'body')) === 'visible');
  await page.waitForTimeout(1200);
  p = await progress(page);
  check('page: first screen builds without scrolling', p.done > 5 && p.done < p.total, `(${p.done}/${p.total})`);
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
  check('reduced motion: nothing is hidden or planned', p.total === 0 && (await opacityOf(page, '#pricing h2')) === '1' && (await visibilityOf(page, '#features .card')) === 'visible');
  await page.context().close();

  // -------------------------------------------------------------- mobile
  page = await open('?mode=regions', { viewport: { width: 390, height: 800 } });
  await scrollThrough(page, 400, 150);
  await waitComplete(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
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
