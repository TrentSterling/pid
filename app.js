import { GymSimulation, CONTROLLERS, EXERCISES, DEFAULTS, PRESETS } from './sim.js?v=2.0.0';
import { GymScene } from './scene.js?v=2.0.0';

const $ = id => document.getElementById(id);
const sim = new GymSimulation();
const scene = new GymScene($('viewport'), CONTROLLERS);
const options = { forces: false, targets: true, trails: false };
let selected = 3;
let paused = false;
let slow = false;
let twoRows = window.innerWidth < 800;
let viewMode = 'front';
let graphMode = 0;
let accumulator = 0;
let last = performance.now();
let lastUi = -Infinity;
let lastGraph = -Infinity;
let lastFps = 0;
let smoothFrame = 1 / 60;
let trialDuration = 20;
let repeat = true;
let toastTimer;
let frameId;
const laneNodes = [], scoreNodes = [], legendNodes = [], sliderNodes = new Map();
const colors = CONTROLLERS.map(c => c.color);
const write = (node, value) => { if (node.textContent !== value) node.textContent = value; };

function notify(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2200);
}
function number(value, digits = 1) {
  if (!Number.isFinite(value)) return '—';
  return Math.abs(value) >= 10000 ? value.toExponential(1) : value.toFixed(digits);
}
function clock(t) {
  const minutes = Math.floor(t / 60);
  const seconds = t - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}`;
}

// Create score cells once. Live updates only replace changed text nodes.
CONTROLLERS.forEach((controller, i) => {
  const lane = document.createElement('button');
  lane.className = 'lane-tab';
  lane.style.setProperty('--lane', controller.color);
  lane.innerHTML = `<span class="lane-name"><span class="lane-number">${String(i + 1).padStart(2, '0')}</span>${controller.short}</span><span class="lane-metric">0.0 cm RMS</span>`;
  lane.setAttribute('aria-label', `Inspect ${controller.name}`);
  lane.addEventListener('click', () => select(i));
  $('lane-strip').append(lane);
  laneNodes.push({ button: lane, metric: lane.querySelector('.lane-metric') });

  const row = document.createElement('tr');
  row.style.setProperty('--lane', controller.color);
  row.innerHTML = `<td><button><span>${String(i + 1).padStart(2, '0')}</span>${controller.short}</button></td><td>0.0 cm</td><td>0.0 cm</td><td>0.00 m/s</td><td>0 N</td><td class="contact-cell">0 / 2</td>`;
  row.addEventListener('click', () => select(i));
  $('score-body').append(row);
  scoreNodes.push({ row, cells: Array.from(row.cells) });

  const legend = document.createElement('button');
  legend.style.setProperty('--lane', controller.color);
  legend.innerHTML = `<i class="legend-swatch"></i>${controller.short}`;
  legend.setAttribute('aria-label', `Highlight ${controller.name}`);
  legend.addEventListener('click', () => select(i));
  $('graph-legend').append(legend);
  legendNodes.push(legend);
});

EXERCISES.forEach(exercise => {
  const button = document.createElement('button');
  button.textContent = exercise.name;
  button.dataset.exercise = exercise.id;
  button.addEventListener('click', () => {
    sim.setExercise(exercise.id);
    resetClock();
    refreshExercise();
    scene.render(sim, 1, options);
    scene.fit(viewMode, selected);
  });
  $('exercise-tabs').append(button);
});

function refreshExercise() {
  const active = EXERCISES.find(e => e.id === sim.exercise);
  let description = active.description;
  if (['wall', 'climb', 'pressure'].includes(sim.exercise) && sim.params.startDistance > 1.6) {
    description += ' The starting line is beyond hand reach; move it closer to test contact.';
  }
  $('exercise-description').textContent = description;
  document.querySelectorAll('[data-exercise]').forEach(button => {
    const on = button.dataset.exercise === sim.exercise;
    button.classList.toggle('active', on);
    button.setAttribute('aria-pressed', String(on));
  });
  $('lock').disabled = ['air', 'rapid'].includes(sim.exercise);
  $('lock').checked = sim.bodiesLocked;
  $('lock').title = $('lock').disabled ? 'This exercise automatically holds the bodies still.' : '';
}
function select(index) {
  selected = index;
  const controller = CONTROLLERS[index];
  document.documentElement.style.setProperty('--selected', controller.color);
  $('controller-lane').textContent = `LANE ${String(index + 1).padStart(2, '0')}`;
  $('controller-name').textContent = controller.name;
  $('controller-description').textContent = controller.description;
  $('controller-formula').textContent = controller.formula;
  $('controller-tip').textContent = controller.tip;
  $('selection-tag').textContent = `Inspecting ${controller.short}`;
  laneNodes.forEach((node, i) => { node.button.classList.toggle('selected', i === index); node.button.setAttribute('aria-pressed', String(i === index)); });
  scoreNodes.forEach((node, i) => node.row.classList.toggle('selected', i === index));
  legendNodes.forEach((node, i) => { node.classList.toggle('selected', i === index); node.setAttribute('aria-pressed', String(i === index)); });
  scene.select(index);
  if (viewMode === 'focus') scene.fit('focus', index);
  lastGraph = -Infinity;
}

const primaryControls = [
  ['frequency', 'Natural frequency', 1, 30, 0.5, 'Hz', 'Higher values pull the hand toward its target faster.'],
  ['damping', 'Damping ratio', 0, 3, 0.05, '', '1 is the continuous-model critical-damping reference.'],
  ['maxAccel', 'Acceleration limit', 10, 1000, 10, 'm/s²', 'Caps every controller equally.'],
  ['startDistance', 'Starting distance from wall', 0.4, 3, 0.05, 'm', 'Move the whole starting line back or forward.']
];
const advancedControls = [
  ['bodyMass', 'Body mass', 20, 150, 1, 'kg'],
  ['handMass', 'Hand mass', 0.5, 12, 0.5, 'kg'],
  ['inputSpeed', 'Input speed', 0.25, 2, 0.05, '×'],
  ['friction', 'Surface friction', 0, 2, 0.05, ''],
  ['feedforward', 'Feedforward strength', 0, 2, 0.05, '×'],
  ['adaptiveRadius', 'Adaptive braking radius', 0.02, 0.8, 0.01, 'm'],
  ['farDamping', 'Damping far from target', 0, 1, 0.05, '×'],
  ['contactStiffness', 'Contact stiffness', 0.1, 3, 0.1, '×']
];
function formatParameter(value, step, unit) {
  const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  return `${value.toFixed(decimals)}${unit ? ' ' + unit : ''}`;
}
function addSlider(parent, definition) {
  const [key, label, min, max, step, unit, hint] = definition;
  const node = document.createElement('div');
  node.className = 'range-control';
  node.innerHTML = `<div class="range-label"><label for="param-${key}">${label}</label><output for="param-${key}"></output></div><input id="param-${key}" type="range" min="${min}" max="${max}" step="${step}">${hint ? `<p class="field-hint">${hint}</p>` : ''}`;
  const input = node.querySelector('input'), output = node.querySelector('output');
  input.value = sim.params[key];
  output.textContent = formatParameter(sim.params[key], step, unit);
  input.addEventListener('input', () => {
    const value = Number(input.value);
    output.textContent = formatParameter(value, step, unit);
    sim.setParams({ [key]: value });
    resetClock();
    refreshExercise();
    updateGains();
    document.querySelectorAll('#presets button').forEach(button => button.classList.remove('active'));
  });
  parent.append(node);
  sliderNodes.set(key, { input, output, step, unit });
}
primaryControls.forEach(definition => addSlider($('primary-sliders'), definition));
advancedControls.forEach(definition => addSlider($('advanced-sliders'), definition));
PRESETS.forEach((preset, i) => {
  const button = document.createElement('button');
  button.textContent = preset.name;
  button.classList.toggle('active', i === 0);
  button.addEventListener('click', () => {
    sim.setParams(preset.params);
    syncSettings(); resetClock(); refreshExercise();
    document.querySelectorAll('#presets button').forEach(other => other.classList.toggle('active', other === button));
    notify(`${preset.name} applied to all lanes`);
  });
  $('presets').append(button);
});
function updateGains() {
  const omega = Math.PI * 2 * sim.params.frequency;
  write($('kp'), Math.round(omega * omega).toLocaleString('en-US'));
  write($('kd'), (2 * sim.params.damping * omega).toFixed(1));
  write($('physics-rate'), `${sim.params.hz} Hz physics`);
}
function syncSettings() {
  sliderNodes.forEach((node, key) => { node.input.value = sim.params[key]; node.output.textContent = formatParameter(sim.params[key], node.step, node.unit); });
  $('hz').value = sim.params.hz;
  $('noise').checked = sim.params.trackingNoise;
  $('lock').checked = sim.bodiesLocked;
  updateGains();
}
function resetClock() {
  accumulator = 0;
  last = performance.now();
  lastUi = lastGraph = -Infinity;
}
function restart() { sim.reset(); resetClock(); }
function pause() {
  paused = !paused;
  $('pause').textContent = paused ? 'Resume' : 'Pause';
  $('pause').setAttribute('aria-label', paused ? 'Resume simulation' : 'Pause simulation');
  $('run-state').textContent = paused ? 'Paused' : 'Running';
  $('run-indicator').classList.toggle('paused', paused);
  accumulator = 0;
  last = performance.now();
}
function updateRepeat() {
  const raw = Number($('duration').value);
  trialDuration = Number.isFinite(raw) && raw >= 2 ? Math.min(600, raw) : 20;
  $('duration').value = trialDuration;
  repeat = $('repeat').checked;
  $('repeat-help').textContent = repeat ? `Restarts every ${trialDuration} seconds. Turn off for an unlimited run.` : 'Continuous run. Players and telemetry keep going until you restart.';
  $('run-duration').textContent = repeat ? `of ${trialDuration} s` : 'continuous';
}
$('pause').addEventListener('click', pause);
$('restart').addEventListener('click', restart);
$('impulse').addEventListener('click', () => { sim.impulse(); notify(sim.bodiesLocked ? 'Applied the same kick to all physical hands' : 'Applied the same kick to all players'); });
$('back').addEventListener('click', () => { sim.impulse('back'); notify(sim.bodiesLocked ? 'Bodies are locked in this exercise' : 'Nudged every player back'); });
$('slow').addEventListener('click', () => { slow = !slow; $('slow').setAttribute('aria-pressed', String(slow)); $('slow').textContent = slow ? '0.2× active' : '0.2× slow'; });
$('repeat').addEventListener('change', updateRepeat);
$('duration').addEventListener('change', updateRepeat);
$('hz').addEventListener('change', () => { sim.setParams({ hz: Number($('hz').value) }); resetClock(); updateGains(); });
$('lock').addEventListener('change', () => { sim.setParams({ lockBodies: $('lock').checked }); resetClock(); refreshExercise(); });
$('noise').addEventListener('change', () => { sim.setParams({ trackingNoise: $('noise').checked }); resetClock(); });
$('defaults').addEventListener('click', () => { sim.setParams(DEFAULTS); syncSettings(); resetClock(); refreshExercise(); notify('Default tuning restored'); });
['forces', 'targets', 'trails'].forEach(id => $(id).addEventListener('change', () => { options[id] = $(id).checked; }));
function setCamera(mode) {
  viewMode = mode;
  scene.fit(mode, selected);
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === mode));
}
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setCamera(button.dataset.view)));
$('fit').addEventListener('click', () => setCamera('front'));
function syncLayout() {
  scene.setLayout(twoRows);
  $('lane-strip').classList.toggle('two-rows', twoRows);
  $('layout-button').textContent = twoRows ? 'Single row' : '2 rows';
  scene.fit(viewMode, selected);
}
$('layout-button').addEventListener('click', () => { twoRows = !twoRows; syncLayout(); });
$('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.querySelector('.arena-panel').requestFullscreen();
  } catch { notify('Use your browser full screen shortcut instead'); }
});
document.addEventListener('fullscreenchange', () => { $('fullscreen').textContent = document.fullscreenElement ? 'Collapse' : 'Expand'; });
document.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input, select, textarea, button, summary, a')) return;
  if (event.code === 'Space') { event.preventDefault(); pause(); }
  if (event.code === 'KeyR') restart();
  if (event.code === 'KeyF') setCamera('front');
  if (event.code === 'KeyI') sim.impulse();
});
document.addEventListener('visibilitychange', () => { last = performance.now(); accumulator = 0; });

const chart = $('chart');
const ctx = chart.getContext('2d');
let chartWidth = 0, chartHeight = 0, chartRatio = 1;
function resizeChart() {
  const rect = chart.getBoundingClientRect();
  chartRatio = Math.min(window.devicePixelRatio || 1, 2);
  chartWidth = rect.width; chartHeight = rect.height;
  chart.width = Math.round(chartWidth * chartRatio); chart.height = Math.round(chartHeight * chartRatio);
  lastGraph = -Infinity;
}
const chartObserver = new ResizeObserver(resizeChart);
chartObserver.observe(chart);
document.querySelectorAll('[data-graph]').forEach(button => button.addEventListener('click', () => {
  graphMode = Number(button.dataset.graph);
  document.querySelectorAll('[data-graph]').forEach(other => other.classList.toggle('active', other === button));
  lastGraph = -Infinity;
}));
function drawGraph() {
  if (!chartWidth || !ctx) return;
  const w = chartWidth, h = chartHeight, left = 52, right = w - 12, top = 14, bottom = h - 26;
  const column = graphMode + 1, scale = graphMode === 0 ? 100 : 1;
  const start = Math.max(0, sim.time - 12);
  let maximum = graphMode === 0 ? 10 : graphMode === 1 ? 1 : 100;
  for (const player of sim.players) for (const sample of player.history) if (sample[0] >= start) maximum = Math.max(maximum, sample[column] * scale);
  const exponent = 10 ** Math.floor(Math.log10(maximum));
  const max = Math.ceil(maximum / exponent * 2) / 2 * exponent;
  ctx.setTransform(chartRatio, 0, 0, chartRatio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.font = '11px ui-monospace, SFMono-Regular, Consolas, monospace';
  ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const value = max * (1 - i / 4), y = top + (bottom - top) * i / 4;
    ctx.strokeStyle = '#2b3a4e'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
    ctx.fillStyle = '#91a7c2';
    ctx.fillText(value >= 100 ? value.toFixed(0) : value.toFixed(1), left - 9, y);
  }
  ctx.textAlign = 'center';
  for (let i = 0; i <= 4; i++) {
    const x = left + (right - left) * i / 4;
    ctx.fillStyle = '#91a7c2'; ctx.fillText(`${(start + i * 3).toFixed(0)}s`, x, h - 8);
  }
  ctx.textAlign = 'left'; ctx.fillStyle = '#91a7c2'; ctx.fillText(['cm', 'm/s', 'N'][graphMode], 3, 9);
  ctx.save(); ctx.beginPath(); ctx.rect(left, top - 2, right - left, bottom - top + 4); ctx.clip();
  for (let pass = 0; pass < 2; pass++) {
    sim.players.forEach((player, i) => {
      if ((i === selected) !== (pass === 1)) return;
      ctx.strokeStyle = colors[i]; ctx.lineWidth = i === selected ? 2.6 : 1.4; ctx.globalAlpha = i === selected ? 1 : 0.55;
      ctx.beginPath(); let first = true;
      for (const sample of player.history) {
        if (sample[0] < start) continue;
        const x = left + (sample[0] - start) / 12 * (right - left), y = bottom - sample[column] * scale / max * (bottom - top);
        if (first) ctx.moveTo(x, y); else ctx.lineTo(x, y); first = false;
      }
      ctx.stroke();
    });
  }
  ctx.restore(); ctx.globalAlpha = 1;
}
function updateMetrics() {
  sim.players.forEach((player, i) => {
    const s = player.stats, cells = scoreNodes[i].cells;
    write(laneNodes[i].metric, `${number(s.rms * 100)} cm RMS`);
    write(cells[1], `${number(s.rms * 100)} cm`);
    write(cells[2], `${number(s.peak * 100)} cm`);
    write(cells[3], `${number(s.speed, 2)} m/s`);
    write(cells[4], `${number(s.force, 0)} N`);
    cells[4].title = s.limited ? 'Acceleration limit active on at least one hand' : 'Sum of both hand drive force magnitudes';
    write(cells[5], `${s.contacts} / 2`);
    cells[5].classList.toggle('touching', s.contacts > 0);
  });
}
$('export').addEventListener('click', () => {
  const snapshot = {
    version: '2.0.0', generatedAt: new Date().toISOString(), exercise: sim.exercise, simulationSeconds: sim.time,
    parameters: { ...sim.params }, repeat, trialDuration,
    model: 'Educational translational contact approximation. No integral term. Not a PhysX benchmark.',
    units: { error: 'm', rms: 'm', peak: 'm', speed: 'm/s', force: 'N', peakHeight: 'm' },
    results: sim.players.map((player, i) => ({ controller: CONTROLLERS[i].name, ...player.stats })),
    historyColumns: ['seconds', 'error_m', 'speed_m_per_s', 'force_N'],
    last12Seconds: sim.players.map((player, i) => ({ controller: CONTROLLERS[i].id, samples: player.history }))
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `physics-gym-${sim.exercise}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  notify('Exported settings, results, and recent telemetry');
});

function frame(now) {
  const elapsed = Math.max(0, (now - last) / 1000);
  last = now;
  if (elapsed > 0 && elapsed < 0.25) smoothFrame += (elapsed - smoothFrame) * 0.035;
  if (!paused && !document.hidden) {
    accumulator += Math.min(0.1, elapsed) * (slow ? 0.2 : 1);
    const dt = 1 / sim.params.hz;
    let steps = 0;
    while (accumulator >= dt && steps < 25) {
      sim.step(dt); accumulator -= dt; steps++;
      if (repeat && sim.time + 1e-9 >= trialDuration) { sim.reset(); accumulator = 0; break; }
    }
  }
  const alpha = paused ? 1 : Math.min(1, accumulator * sim.params.hz);
  scene.render(sim, alpha, options);
  write($('clock'), clock(sim.time));
  if (now - lastUi >= 1000 / 30) { updateMetrics(); lastUi = now; }
  if (now - lastGraph >= 1000 / 30) { drawGraph(); lastGraph = now; }
  if (now - lastFps >= 500) { write($('fps'), `${Math.round(1 / smoothFrame)} fps`); lastFps = now; }
  frameId = requestAnimationFrame(frame);
}

refreshExercise(); syncSettings(); select(selected); updateRepeat();
scene.render(sim, 1, options); syncLayout(); resizeChart();
$('run-state').textContent = 'Running';
frameId = requestAnimationFrame(frame);
window.addEventListener('pagehide', event => {
  if (!event.persisted) { cancelAnimationFrame(frameId); chartObserver.disconnect(); scene.dispose(); }
});
