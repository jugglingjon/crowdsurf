import { swarm, activeAgents } from '../src/index.js';

const mode = document.documentElement.getAttribute('data-mode');
const $ = (id) => document.getElementById(id);

if (mode !== 'off') {
  // Imperfect placement: on at 30% here so it can be seen. ?mistakes=0 to 1 sets it from the URL.
  const param = parseFloat(new URLSearchParams(location.search).get('mistakes'));
  let often = param > 0 ? Math.min(1, param) : 0.3;
  let imperfect = !(param === 0);
  const options = { mistakes: imperfect ? often : 0 };

  // respectReducedMotion is left on: with "reduce motion" set in your OS, nothing builds.
  const instance = mode === 'page' ? swarm(document.body, options) : swarm('[data-swarm]', options);
  window.demoSwarm = instance; // handy in the console

  // ------------------------------------------------------------ live stats

  const speeds = [1, 2, 4];
  let speedIx = 0;

  function render() {
    const { done, total } = instance.progress;
    $('count').textContent = total ? `${done} / ${total} built` : 'nothing to build';
    $('meter').style.width = total ? `${(done / total) * 100}%` : '0';
    const n = activeAgents();
    $('agents').textContent = `${n} agent${n === 1 ? '' : 's'} working`;
    const kinds = { box: 0, text: 0, media: 0, line: 0 };
    let copies = 0;
    for (const region of instance.regions) {
      for (const task of region.tasks) {
        kinds[task.kind]++;
        if (task.copyOf) copies++;
      }
    }
    $('kinds').textContent = `${kinds.box} box · ${kinds.text} text · ${kinds.media} media · ${kinds.line} line`;
    $('copies').textContent = `${copies} of these are duplicates`;
    let slipCount = 0;
    for (const region of instance.regions) slipCount += region.slips;
    $('slips').textContent = imperfect ? `${slipCount} slip${slipCount === 1 ? '' : 's'}` : '';
  }

  instance.on('progress', render).on('start', render).on('complete', render);
  setInterval(render, 150);
  render();

  // --------------------------------------------------------------- buttons

  $('replay').addEventListener('click', () => instance.replay());
  $('finish').addEventListener('click', () => instance.finish());
  $('speed').addEventListener('click', () => {
    speedIx = (speedIx + 1) % speeds.length;
    instance.set({ speed: speeds[speedIx] });
    $('speed').textContent = speeds[speedIx] + '×';
  });

  // -------------------------------------------------- imperfect placement

  function syncImperfect() {
    $('imperfect').checked = imperfect;
    $('howoften').value = String(Math.round(often * 100));
    $('howoften').disabled = !imperfect;
    $('howoften-out').textContent = Math.round(often * 100) + '%';
    $('howoften-row').classList.toggle('is-off', !imperfect);
    instance.set({ mistakes: imperfect ? often : 0 });
    render();
  }
  $('imperfect').addEventListener('change', (e) => {
    imperfect = e.target.checked;
    syncImperfect();
  });
  $('howoften').addEventListener('input', (e) => {
    often = Number(e.target.value) / 100;
    syncImperfect();
  });
  syncImperfect();

  // ---------------------------------------------------------- plan overlay
  // Outlines every planned task, so the planner's decisions can be checked by eye.

  let overlay = null;

  function drawPlan() {
    if (overlay) overlay.remove();
    overlay = document.createElement('div');
    overlay.className = 'plan-overlay';
    overlay.setAttribute('data-swarm-ignore', '');
    overlay.setAttribute('aria-hidden', 'true');
    const frag = document.createDocumentFragment();
    for (const region of instance.regions) {
      for (const task of region.tasks) {
        const r = task.el.getBoundingClientRect();
        const box = document.createElement('i');
        box.className = `k-${task.kind}${task.state === 'done' ? ' is-done' : ''}${task.copyOf ? ' is-copy' : ''}`;
        box.style.cssText = `left:${r.left + scrollX}px;top:${r.top + scrollY}px;width:${r.width}px;height:${r.height}px`;
        frag.appendChild(box);
      }
    }
    overlay.appendChild(frag);
    document.body.appendChild(overlay);
  }

  function setPlan(on) {
    $('planbtn').setAttribute('aria-pressed', String(on));
    $('planbtn').textContent = on ? 'Hide plan' : 'Show plan';
    $('legend').hidden = !on;
    if (on) drawPlan();
    else if (overlay) {
      overlay.remove();
      overlay = null;
    }
  }

  $('planbtn').addEventListener('click', () => setPlan($('planbtn').getAttribute('aria-pressed') !== 'true'));
  addEventListener('resize', () => overlay && drawPlan());
  instance.on('progress', () => {
    if (!overlay) return;
    cancelAnimationFrame(drawPlan.raf);
    drawPlan.raf = requestAnimationFrame(drawPlan);
  });
}
