import * as THREE from 'three';
import { GtagTask, REPEAT, HORIZON, LEVELS, PAD_RADIUS } from '../rl/task.js';
import { Driver, checkBrain } from '../rl/trainer.js';
import { yawRotate, vec, vadd } from '../gorilla.js';

const $ = id => document.getElementById(id);
const text = (id, v) => { const e = $(id); if (e && e.textContent !== String(v)) e.textContent = String(v); };
const ARM = 1.5, HZ = 90;
const REACH = { y: -0.55, z: -0.8 }, PULL = { y: -1.12, z: 0.1 };

// ---- state ----
const task = new GtagTask({ stage: 'slap' });
let obs = task.reset(), sub = 0, ended = null, endedAt = 0;
let mode = 'human', slow = false, sideView = true;
let driver = null, brain = null, brainSource = 'none', shipped = null;
let accumulator = 0, last = 0, frames = 0, fpsClock = 0;
const best = { human: null, ppo: null };
const keys = new Set();

// ---- three.js ----
let renderer, scene, camera, monke, pad, camAt = null, lastAction = null;
const mat = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
function initThree() {
  const vp = $('viewport');
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  vp.prepend(renderer.domElement);
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101c2b);
  scene.fog = new THREE.Fog(0x101c2b, 18, 46);
  camera = new THREE.PerspectiveCamera(55, 1, 0.05, 120);
  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x1a2430, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7); sun.position.set(5, 9, 4); scene.add(sun);
  for (const b of task.env.stage.boxes) {
    if (b.tag === 'goal') continue; // this page draws its own pad, which moves with the curriculum
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.half.x * 2, b.half.y * 2, b.half.z * 2), mat(b.color));
    m.position.set(b.center.x, b.center.y, b.center.z); scene.add(m);
  }
  const grid = new THREE.GridHelper(60, 60, 0x4a6785, 0x2f4660); grid.position.set(0, 0.012, -15); scene.add(grid);
  // Distance posts every 2 m so speed and progress read at a glance.
  for (let d = 2; d <= 14; d += 2) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.06), mat(0x5f7d99)); post.position.set(-1.6, 0.25, -d); scene.add(post);
    const line = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.012, 0.04), mat(0x5f7d99)); line.position.set(0, 0.018, -d); scene.add(line);
    const c = document.createElement('canvas'); c.width = 128; c.height = 64;
    const g = c.getContext('2d'); g.fillStyle = '#b9cee0'; g.font = '700 40px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(`${d} m`, 64, 34);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, fog: true })); label.scale.set(0.8, 0.4, 1); label.position.set(-1.6, 0.75, -d); scene.add(label);
  }
  pad = new THREE.Group();
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(PAD_RADIUS, PAD_RADIUS, 3, 40, 1, true), new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false })); beam.position.y = 1.5; pad.add(beam);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(PAD_RADIUS, PAD_RADIUS, 0.04, 40), mat(0x34d399)); disc.position.y = 0.03; pad.add(disc);
  const flag = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2), mat(0x34d399)); flag.position.set(PAD_RADIUS + 0.1, 1.1, 0); pad.add(flag);
  scene.add(pad);
  monke = buildMonke(); scene.add(monke.group);
  const resize = () => { const w = vp.clientWidth, h = vp.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  new ResizeObserver(resize).observe(vp); resize();
}

function limb(radius, color) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.85, 1, 10), mat(color));
  m.userData.set = (a, b) => {
    const d = new THREE.Vector3().subVectors(b, a), len = d.length() || 1e-6;
    m.position.copy(a).addScaledVector(d, 0.5);
    m.scale.set(1, len, 1);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.multiplyScalar(1 / len));
  };
  return m;
}
function buildMonke() {
  const group = new THREE.Group();
  const fur = 0x6b4a2f, skin = 0xd9a878;
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 18, 14), mat(fur)); body.scale.set(1, 1.25, 0.85); group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 18, 14), mat(fur)); group.add(head);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 10), mat(skin)); face.scale.set(1, 0.9, 0.5); group.add(face);
  const eyes = [0, 1].map(() => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), mat(0x111111)); group.add(e); return e; });
  const legs = [0, 1].map(() => { const l = limb(0.075, fur); group.add(l); return l; });
  const arms = [0, 1].map(() => ({ upper: limb(0.07, fur), fore: limb(0.06, fur), hand: new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), mat(skin)), target: new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: 0x89ead6, wireframe: true, transparent: true, opacity: 0.6 })) }));
  for (const a of arms) group.add(a.upper, a.fore, a.hand, a.target);
  return { group, body, head, face, eyes, legs, arms };
}
const V3 = v => new THREE.Vector3(v.x, v.y, v.z);
function poseMonke() {
  const p = task.env.player, head = p.head();
  const fwd = yawRotate(vec(0, 0, -1), p.yaw);
  monke.head.position.set(head.x, head.y, head.z);
  monke.face.position.set(head.x + fwd.x * 0.11, head.y - 0.02, head.z + fwd.z * 0.11);
  monke.eyes.forEach((e, i) => { const s = yawRotate(vec(i ? 0.05 : -0.05, 0.03, -0.165), p.yaw); e.position.set(head.x + s.x, head.y + s.y, head.z + s.z); });
  monke.body.position.set(head.x, head.y - 0.47, head.z);
  monke.legs.forEach((l, i) => {
    const hip = vadd(head, yawRotate(vec(i ? 0.13 : -0.13, -0.72, 0), p.yaw));
    const foot = vadd(head, yawRotate(vec(i ? 0.17 : -0.17, -1.0, -0.08), p.yaw));
    l.userData.set(V3(hip), V3(foot));
  });
  for (const h of [0, 1]) {
    const a = monke.arms[h], hand = p.hands[h];
    const sh = V3(vadd(head, yawRotate(vec(h ? 0.24 : -0.24, -0.25, 0), p.yaw)));
    const hp = V3(hand.last);
    // Two-bone IK: the elbow sits on the circle between shoulder and hand, pushed out and back.
    const L = 0.82, d = Math.min(sh.distanceTo(hp), 2 * L - 1e-3);
    const dir = new THREE.Vector3().subVectors(hp, sh).normalize();
    const pole = V3(yawRotate(vec(h ? 0.7 : -0.7, -0.3, 0.65), p.yaw));
    const perp = pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const elbow = sh.clone().addScaledVector(dir, d / 2).addScaledVector(perp, Math.sqrt(Math.max(0, L * L - d * d / 4)));
    a.upper.userData.set(sh, elbow); a.fore.userData.set(elbow, hp);
    a.hand.position.copy(hp);
    a.hand.material.color.set(hand.wasTouching ? 0xffb968 : 0xd9a878);
    a.target.position.copy(V3(p.rawHand(h)));
  }
  const goal = task.goal(); pad.position.set(goal.x, 0, goal.z);
  // Smoothed camera: hops should move the monke, not the whole picture.
  const cx = head.x, cy = 1.0, cz = head.z;
  if (!camAt) camAt = new THREE.Vector3(cx, cy, cz);
  camAt.lerp(new THREE.Vector3(cx, cy, cz), 0.12);
  if (camAt.distanceTo(new THREE.Vector3(cx, cy, cz)) > 6) camAt.set(cx, cy, cz);
  if (sideView) { camera.position.set(camAt.x + 6.4, 2.3, camAt.z - 1.6 + 3.2); camera.lookAt(camAt.x, 0.85, camAt.z - 1.6); }
  else { camera.position.set(camAt.x + 0.9, 2.5, camAt.z + 4.2); camera.lookAt(camAt.x, 0.6, camAt.z - 2.5); }
}

// ---- drivers ----
function humanAction() {
  const out = [];
  for (const h of [0, 1]) {
    const reach = keys.has(h ? 'KeyO' : 'KeyQ'), pull = keys.has(h ? 'KeyP' : 'KeyW');
    const c = task.cmd[h], side = h ? 0.25 : -0.25;
    let y = c.y, z = c.z;
    if (reach && !pull) { y = REACH.y; z = REACH.z; }
    else if (pull && !reach) { y = PULL.y; z = PULL.z; }
    out.push(side / ARM, y / ARM, z / ARM, -1);
  }
  return out;
}
function resetRun() {
  // You always get the full 12 m. The net gets the distance its curriculum has reached.
  task.distance = mode === 'ppo' && brain ? (brain.meta?.distance ?? LEVELS[LEVELS.length - 1]) : LEVELS[LEVELS.length - 1];
  obs = task.reset(); sub = 0; ended = null; endedAt = 0; accumulator = 0;
  $('banner').hidden = true;
}
function finishRun(result, now) {
  ended = result; endedAt = now;
  const seconds = task.t / 15, who = mode === 'human' ? 'human' : 'ppo';
  let msg;
  if (result.info.success) {
    if (task.distance === LEVELS[LEVELS.length - 1] && (best[who] === null || seconds < best[who])) best[who] = seconds;
    msg = `${mode === 'human' ? 'You' : 'PPO'} reached the pad (${task.distance} m) in ${seconds.toFixed(1)} s`;
  } else if (result.info.fell) msg = 'Fell off the course';
  else msg = mode === 'human' ? 'Out of time. Press R to try again.' : 'Out of time';
  text('banner-text', msg); $('banner').hidden = false;
  text('m-best', best.human === null ? '–' : `${best.human.toFixed(1)} s`);
  text('m-ppo-best', best.ppo === null ? '–' : `${best.ppo.toFixed(1)} s`);
}
function physicsStep(now) {
  if (ended) { if (now - endedAt > (mode === 'human' ? 3500 : 1800)) resetRun(); return; }
  if (sub === 0) { lastAction = Array.from(mode === 'ppo' && driver ? driver.act(obs) : humanAction()); task.begin(lastAction); }
  const over = task.substep();
  if (++sub >= REPEAT || over) {
    sub = 0;
    const result = task.finish();
    obs = result.obs;
    if (result.done || result.truncated) finishRun(result, now);
  }
}

// ---- training ----
let worker = null, training = false, history = [], lastStat = null, rate = 0, workerOk = true;
function setBrain(b, source) {
  checkBrain(b);
  brain = b; brainSource = source; driver = new Driver(b);
  const m = b.meta || {};
  const where = m.distance && m.distance < LEVELS[LEVELS.length - 1] ? ` It has only learned the ${m.distance} m pad so far.` : '';
  const trained = m.decisions ? `${Math.round(m.decisions / 1000).toLocaleString()}k decisions` : 'untrained';
  let label;
  if (source === 'shipped') label = `Shipped brain: trained ahead of time in Node, ${trained}${m.seconds ? `, about ${Math.round(m.seconds / 60)} min` : ''}${m.evalSuccess !== undefined ? `. It reached the 12 m pad on ${Math.round(m.evalSuccess * 100)}% of ${m.evalEpisodes} spawns it had not seen.` : '.'}`;
  else if (source === 'file') label = `Brain loaded from a file: ${trained}.`;
  else label = m.decisions ? `Live brain, training in this tab: ${trained}.${where}` : 'A fresh, untrained brain. Press Start training and watch it flail, then improve.';
  text('brain-label', label);
}
function startWorker(initBrain) {
  if (worker) worker.terminate();
  training = false; history = []; lastStat = null; rate = 0; updateTrainUI(); drawGraphs();
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  } catch (error) { workerOk = false; text('train-note', 'This browser cannot start a module worker, so live training is unavailable. Driving and the shipped brain still work.'); $('train').disabled = true; return; }
  worker.onerror = () => { workerOk = false; $('train').disabled = true; text('train-note', 'The training thread failed to start in this browser. Driving and the shipped brain still work.'); };
  worker.onmessage = ({ data }) => {
    if (data.type === 'ready') worker.postMessage({ type: 'init', seed: (Math.random() * 2 ** 31) | 0, brain: initBrain || null });
    else if (data.type === 'error') text('train-note', `Training error: ${data.message}`);
    else if (data.type === 'stats') onStats(data);
  };
}
function onStats({ stats, brain: b }) {
  const now = performance.now();
  if (lastStat && stats.decisions > lastStat.decisions) rate = (stats.decisions - lastStat.decisions) / ((now - lastStat.at) / 1000);
  lastStat = { decisions: stats.decisions, at: now };
  // A shipped or loaded brain stays in the driving seat until training actually changes it.
  if (training || brainSource === 'live' || brainSource === 'none') setBrain(b, 'live');
  if (stats.window > 0 && training) history.push({ x: stats.decisions, ret: stats.meanReturn, success: stats.successRate, level: stats.level });
  if (history.length > 1600) history = history.filter((_, i) => i % 2 === 0 || i === history.length - 1);
  text('t-decisions', stats.decisions.toLocaleString());
  text('t-episodes', stats.episodes.toLocaleString());
  text('t-rate', rate ? Math.round(rate).toLocaleString() : '–');
  text('t-success', stats.window ? `${Math.round(stats.successRate * 100)}%` : '–');
  text('t-return', stats.window ? stats.meanReturn.toFixed(1) : '–');
  text('t-noise', stats.entropy.toFixed(2));
  text('t-level', `level ${stats.level + 1} of ${LEVELS.length}`);
  document.querySelectorAll('#levels li').forEach((li, i) => { li.classList.toggle('done', i < stats.level); li.classList.toggle('now', i === stats.level); });
  $('promo-fill').style.width = `${stats.window ? Math.round(stats.successRate * 100) : 0}%`;
  text('g-success-now', stats.window ? `now ${Math.round(stats.successRate * 100)}% at ${stats.distance} m` : '');
  if (window.gymShell) window.gymShell.badge(training && stats.window ? `${stats.distance} m · ${Math.round(stats.successRate * 100)}%` : '');
  drawGraphs();
}
function updateTrainUI() {
  const b = $('train');
  b.textContent = training ? 'Pause training' : (lastStat && lastStat.decisions ? 'Resume training' : 'Start training');
  b.classList.toggle('accent', !training);
  const st = $('train-state'); st.classList.toggle('on', training); st.textContent = training ? 'Training' : (lastStat && lastStat.decisions ? 'Paused' : 'Idle');
  if (!training && window.gymShell) window.gymShell.badge('');
}
function drawGraph(id, key, lo, hi, fmt) {
  const c = $(id), dpr = Math.min(devicePixelRatio || 1, 2);
  const W = c.clientWidth || 400, H = c.clientHeight || 120;
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const L = 38, R = 10, T = 10, B = 20, w = W - L - R, h = H - T - B;
  g.font = '11px system-ui'; g.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const y = T + h * i / 4;
    g.strokeStyle = '#1d3142'; g.lineWidth = 1; g.beginPath(); g.moveTo(L, y); g.lineTo(L + w, y); g.stroke();
    g.fillStyle = '#6f8597'; g.textAlign = 'right'; g.fillText(fmt(hi - (hi - lo) * i / 4), L - 6, y);
  }
  if (history.length < 2) { g.fillStyle = '#758d9f'; g.font = '13px system-ui'; g.textAlign = 'center'; g.fillText('Press Start training', L + w / 2, T + h / 2); return; }
  const x0 = history[0].x, x1 = history[history.length - 1].x, span = Math.max(1, x1 - x0);
  const X = v => L + (v - x0) / span * w, Y = v => T + h - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo) * h;
  g.textAlign = 'left'; g.fillStyle = '#6f8597'; g.textBaseline = 'alphabetic';
  g.fillText('0', L, H - 5); g.textAlign = 'right'; g.fillText(`${Math.round(x1 / 1000)}k decisions`, L + w, H - 5);
  // Pad moved further away: mark it, since success drops on purpose there.
  let row = 0, lastX = -99;
  for (let i = 1; i < history.length; i++) if (history[i].level !== history[i - 1].level) {
    const x = X(history[i].x);
    row = x - lastX < 60 ? row + 1 : 0; lastX = x;
    g.strokeStyle = '#f5c26b'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + h); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#f5c26b'; g.textAlign = x > L + w - 50 ? 'right' : 'left'; g.textBaseline = 'top'; g.fillText(`pad ${LEVELS[history[i].level]} m`, x + (x > L + w - 50 ? -4 : 4), T + 2 + row * 13);
  }
  g.beginPath();
  history.forEach((p, i) => { if (i) g.lineTo(X(p.x), Y(p[key])); else g.moveTo(X(p.x), Y(p[key])); });
  g.strokeStyle = '#89ead6'; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
  g.lineTo(L + w, T + h); g.lineTo(L, T + h); g.closePath(); g.fillStyle = 'rgba(137,234,214,.09)'; g.fill();
  const lastP = history[history.length - 1];
  g.beginPath(); g.arc(X(lastP.x), Y(lastP[key]), 4, 0, Math.PI * 2); g.fillStyle = '#f2f6fb'; g.fill();
}
function drawGraphs() {
  let lo = -5, hi = 5;
  for (const p of history) { lo = Math.min(lo, p.ret); hi = Math.max(hi, p.ret); }
  lo = Math.floor(lo / 5) * 5; hi = Math.ceil(hi / 5) * 5;
  drawGraph('g-return', 'ret', lo, hi, v => v.toFixed(0));
  text('g-return-range', history.length ? `now ${history[history.length - 1].ret.toFixed(1)}` : '');
  drawGraph('g-success', 'success', 0, 1, v => `${Math.round(v * 100)}%`);
}

// ---- UI ----
function setMode(m) {
  mode = m;
  $('drive-human').classList.toggle('active', m === 'human'); $('drive-human').setAttribute('aria-pressed', m === 'human');
  $('drive-ppo').classList.toggle('active', m === 'ppo'); $('drive-ppo').setAttribute('aria-pressed', m === 'ppo');
  $('qwop').classList.toggle('off', m !== 'human');
  text('driver-badge', m === 'human' ? 'YOU' : 'PPO');
  text('hint-title', m === 'human' ? 'Q and W move the left hand, O and P the right.' : 'The neural net is driving.');
  text('hint-text', m === 'human' ? 'Reach, then pull. A hand that touches the floor sticks, so pulling it back drags you forward.' : 'Same hands, same physics. It outputs hand targets 15 times a second.');
  resetRun();
}
function bind() {
  const tracked = ['KeyQ', 'KeyW', 'KeyO', 'KeyP'];
  const paint = () => document.querySelectorAll('#qwop button').forEach(b => b.classList.toggle('down', keys.has(b.dataset.key)));
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
    if (tracked.includes(e.code)) { keys.add(e.code); paint(); if (mode !== 'human') setMode('human'); e.preventDefault(); }
    if (e.code === 'KeyR') resetRun();
  });
  addEventListener('keyup', e => { keys.delete(e.code); paint(); });
  addEventListener('blur', () => { keys.clear(); paint(); });
  document.querySelectorAll('#qwop button').forEach(b => {
    const down = e => { e.preventDefault(); if (mode !== 'human') setMode('human'); keys.add(b.dataset.key); paint(); };
    const up = e => { e.preventDefault(); keys.delete(b.dataset.key); paint(); };
    b.addEventListener('pointerdown', down); b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up);
  });
  $('drive-human').onclick = () => setMode('human');
  $('drive-ppo').onclick = () => setMode('ppo');
  $('reset').onclick = resetRun;
  $('slow').onclick = () => { slow = !slow; $('slow').setAttribute('aria-pressed', slow); $('slow').classList.toggle('active', slow); };
  $('camera').onclick = () => { sideView = !sideView; text('camera', sideView ? 'Side view' : 'Chase view'); };
  $('train').onclick = () => {
    if (!worker || !workerOk) return;
    training = !training;
    worker.postMessage({ type: training ? 'start' : 'pause' });
    if (training && mode !== 'ppo') setMode('ppo');
    updateTrainUI();
  };
  $('scratch').onclick = () => { brainSource = 'none'; brain = null; startWorker(null); setMode('ppo'); };
  $('shipped').onclick = () => { if (!shipped) { text('train-note', 'No shipped brain is available on this copy of the page.'); return; } setBrain(shipped, 'shipped'); startWorker(shipped); setMode('ppo'); };
  $('save').onclick = () => {
    if (!brain) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(brain)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'monke-ppo-brain.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $('load').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try { const b = JSON.parse(await file.text()); setBrain(b, 'file'); startWorker(b); setMode('ppo'); }
    catch (error) { text('train-note', `Could not load that file: ${error.message}`); }
    e.target.value = '';
  };
}
function hud(now) {
  const p = task.env.player;
  text('sim-time', `${(task.env.steps / HZ).toFixed(1)} s`);
  text('dist', `${task.goalDistance().toFixed(1)} m to go`);
  text('m-speed', `${Math.hypot(p.velocity.x, p.velocity.y, p.velocity.z).toFixed(1)} m/s`);
  text('m-stuck', `${p.hands[0].wasTouching ? 'L' : '–'} ${p.hands[1].wasTouching ? 'R' : '–'}`);
  const left = Math.max(0, (HORIZON - task.t) / 15);
  text('line', mode === 'human' ? `You are driving. ${left.toFixed(0)} s left.` : (driver ? `PPO is driving (${brainSource === 'shipped' ? 'shipped brain' : brainSource === 'file' ? 'brain from file' : 'live brain'}). ${left.toFixed(0)} s left.` : 'No brain yet.'));
  const total = task.distance || LEVELS[LEVELS.length - 1], done = Math.max(0, Math.min(1, 1 - task.goalDistance() / total));
  $('track-fill').style.width = $('track-dot').style.left = `${(done * 100).toFixed(1)}%`;
  text('track-goal', `${total} m`);
  if (lastAction) [1, 2, 5, 6].forEach((ch, i) => {
    const v = Math.max(-1, Math.min(1, lastAction[ch])), bar = $(`s-${i}`);
    bar.style.left = `${v < 0 ? 50 + v * 50 : 50}%`; bar.style.width = `${Math.abs(v) * 50}%`;
  });
  text('signals-who', mode === 'human' ? 'from your keys' : 'from the neural net');
  if (++frames && now - fpsClock > 1000) { text('fps', `${Math.round(frames * 1000 / (now - fpsClock))} fps`); frames = 0; fpsClock = now; }
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - (last || now)) / 1000, 0.1); last = now;
  accumulator += dt * (slow ? 0.25 : 1);
  let n = 0;
  while (accumulator >= 1 / HZ && n++ < 12) { accumulator -= 1 / HZ; physicsStep(now); }
  poseMonke(); renderer.render(scene, camera); hud(now);
}

async function boot() {
  try { initThree(); } catch (error) { const e = $('load-error'); e.hidden = false; e.textContent = `This page needs WebGL. ${error.message}`; return; }
  bind(); setMode('human'); drawGraphs();
  addEventListener('resize', drawGraphs); addEventListener('gym:visibility', e => { if (e.detail.visible) { last = 0; drawGraphs(); } });
  try {
    const response = await fetch('./brain.json', { cache: 'no-cache' });
    if (response.ok) { shipped = await response.json(); checkBrain(shipped); }
  } catch { shipped = null; /* no usable shipped brain: the page still trains from scratch */ }
  if (!shipped) $('shipped').disabled = true;
  startWorker(null); // open on a fresh, untrained brain so the learning is yours to watch
  window.monkePPO = { task, get brain() { return brain; }, get history() { return history; }, get mode() { return mode; } };
  requestAnimationFrame(frame);
}
boot();
