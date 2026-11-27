import * as THREE from 'three';
import { GtagEnvironment } from './env.js';
import { ScriptedExpert } from './expert.js';
import { STAGES } from './stages.js';
import { DEFAULTS, yawRotate, vec, vadd } from './gorilla.js';

const $ = id => document.getElementById(id);
const text = (id, v) => { const e = $(id); if (e && e.textContent !== String(v)) e.textContent = String(v); };
const HZ = 90, ARM = DEFAULTS.maxArmLength;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const SETTINGS = { jumpMultiplier: DEFAULTS.jumpMultiplier, maxJumpSpeed: DEFAULTS.maxJumpSpeed, velocityLimit: DEFAULTS.velocityLimit, maxArmLength: DEFAULTS.maxArmLength };

let env, expert, stageId = new URLSearchParams(location.search).get('stage') || 'slap';
if (!STAGES.some(s => s.id === stageId)) stageId = 'slap';
let manual = false, paused = false, slow = false, chase = true, accumulator = 0, last = 0, endedAt = 0, frames = 0, fpsClock = 0;
let obs;
const cmd = [{ x: -0.25, y: -0.5, z: -0.6 }, { x: 0.25, y: -0.5, z: -0.6 }];
const grip = [false, false];
const keys = new Set();
let active = -1, mouse = { x: 0, y: 0 };

function resetEnv(id = stageId) {
  stageId = id;
  if (!env) env = new GtagEnvironment({ stage: id, params: { ...SETTINGS } });
  else { env.options.params = { ...SETTINGS }; env.reset(id); }
  expert = new ScriptedExpert({ dt: 1 / HZ });
  obs = env.observe();
  cmd[0] = { x: -0.25, y: -0.5, z: -0.6 }; cmd[1] = { x: 0.25, y: -0.5, z: -0.6 };
  grip[0] = grip[1] = false;
  endedAt = 0;
  buildScene();
  const s = env.stage;
  text('stage-title', s.name);
  text('lesson-title', s.name.replace(/^\d+\.\s*/, ''));
  text('lesson-text', s.lesson);
  text('stage-lesson', s.lesson);
  text('stage-expert', s.expert === false ? 'No scripted routine for this stage yet. Climb it by hand.' : 'The scripted player completes this stage from the standard spawn.');
  document.querySelectorAll('#stage-list button').forEach(b => { const on = b.dataset.id === id; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); });
  history.replaceState(null, '', `?stage=${id}`);
}

// ---- three.js ----
let renderer, scene, camera, rig, group, meshes = {};
let xrSession = null;
const xrHands = [null, null]; // [left, right] -> { grip, gamepad }
const xrEdge = {};
function initThree() {
  const vp = $('viewport');
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  vp.prepend(renderer.domElement);
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1520);
  scene.fog = new THREE.Fog(0x0b1520, 18, 55);
  camera = new THREE.PerspectiveCamera(62, 1, 0.05, 120);
  // The camera lives in a rig so a headset can move it while the simulation moves the rig.
  rig = new THREE.Group(); rig.add(camera); scene.add(rig);
  renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local-floor');
  for (const i of [0, 1]) {
    const g = renderer.xr.getControllerGrip(i);
    g.addEventListener('connected', e => { const h = e.data.handedness === 'left' ? 0 : e.data.handedness === 'right' ? 1 : -1; if (h >= 0) xrHands[h] = { grip: g, gamepad: e.data.gamepad }; });
    g.addEventListener('disconnected', () => { for (const h of [0, 1]) if (xrHands[h] && xrHands[h].grip === g) xrHands[h] = null; });
    rig.add(g);
  }
  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x1a2430, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(4, 9, 6); scene.add(sun);
  const resize = () => { if (renderer.xr.isPresenting) return; const w = vp.clientWidth, h = vp.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  new ResizeObserver(resize).observe(vp); resize();
}
const mat = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
function buildScene() {
  if (group) scene.remove(group);
  group = new THREE.Group(); scene.add(group);
  meshes = { boxes: [], cubes: [] };
  for (const b of env.stage.boxes) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.half.x * 2, b.half.y * 2, b.half.z * 2), mat(b.color));
    m.position.set(b.center.x, b.center.y, b.center.z);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0x0b1520, transparent: true, opacity: 0.55 }));
    m.add(edges); group.add(m);
  }
  const grid = new THREE.GridHelper(60, 60, 0x4a6785, 0x2f4660); grid.position.set(0, 0.012, -15); group.add(grid);
  const g = env.stage.goal;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(g.radius, 0.04, 8, 48), new THREE.MeshBasicMaterial({ color: 0x34d399 }));
  ring.rotation.x = Math.PI / 2; ring.position.set(g.center.x, g.center.y + 0.05, g.center.z); group.add(ring);
  for (const c of env.cubes) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(c.half.x * 2, c.half.y * 2, c.half.z * 2), mat(c.mass > 6 ? 0xfb923c : 0xa78bfa));
    group.add(m); meshes.cubes.push(m);
  }
  meshes.head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), mat(0xeaf1f7)); group.add(meshes.head);
  meshes.hull = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.4, 1, 0.4)), new THREE.LineBasicMaterial({ color: 0x8bb7ff })); group.add(meshes.hull);
  meshes.hands = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), mat(0xffffff)); group.add(m); return m; });
  meshes.targets = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: 0x89ead6, wireframe: true })); group.add(m); return m; });
  meshes.arms = [0, 1].map(() => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xbfd2e2 })); group.add(l); return l; });
}
function syncScene() {
  const p = env.player, head = p.head();
  meshes.head.position.set(head.x, head.y, head.z);
  const hull = p.hull(); meshes.hull.position.set(hull.center.x, hull.center.y, hull.center.z); meshes.hull.rotation.y = p.yaw;
  for (const h of [0, 1]) {
    const hand = p.hands[h], tgt = p.rawHand(h);
    meshes.hands[h].position.set(hand.last.x, hand.last.y, hand.last.z);
    meshes.hands[h].material.color.set(hand.wasTouching ? 0xffb968 : 0xffffff);
    meshes.targets[h].position.set(tgt.x, tgt.y, tgt.z);
    const sh = vadd(head, yawRotate(vec(h ? 0.18 : -0.18, -0.25, 0), p.yaw));
    const pos = meshes.arms[h].geometry.attributes.position;
    pos.setXYZ(0, sh.x, sh.y, sh.z); pos.setXYZ(1, hand.last.x, hand.last.y, hand.last.z); pos.needsUpdate = true;
  }
  env.cubes.forEach((c, i) => meshes.cubes[i].position.set(c.position.x, c.position.y, c.position.z));
  const fwd = yawRotate(vec(0, 0, -1), p.yaw);
  const inXR = renderer.xr.isPresenting;
  meshes.head.visible = meshes.hull.visible = !inXR; for (const h of [0, 1]) { meshes.arms[h].visible = !inXR; meshes.targets[h].visible = !inXR; }
  if (inXR) {
    // Put the rig where it makes the real head coincide with the simulated head.
    const local = yawRotate(vec(camera.position.x, camera.position.y, camera.position.z), p.yaw);
    rig.rotation.y = p.yaw; rig.position.set(head.x - local.x, head.y - local.y, head.z - local.z);
  } else if (chase) {
    const back = yawRotate(vec(0.5, 0.9, 2.8), p.yaw);
    camera.position.set(head.x + back.x, head.y + back.y, head.z + back.z);
    camera.lookAt(head.x + fwd.x * 1.5, head.y - 0.5, head.z + fwd.z * 1.5);
  } else {
    camera.position.set(head.x, head.y, head.z);
    camera.lookAt(head.x + fwd.x, head.y - 0.45, head.z + fwd.z);
  }
  renderer.render(scene, camera);
}

// ---- headset ----
// Hand targets are the controllers measured from the headset, which is exactly what the
// environment's actions mean, so the same port runs with real arms.
function pressed(h, button) { const pad = xrHands[h] && xrHands[h].gamepad; return Boolean(pad && pad.buttons[button] && pad.buttons[button].pressed); }
function edge(name, down) { const was = xrEdge[name]; xrEdge[name] = down; return down && !was; }
function xrAction() {
  const p = env.player, out = [];
  for (const h of [0, 1]) {
    const c = xrHands[h];
    if (!c) { out.push(h ? 0.25 / ARM : -0.25 / ARM, -0.5 / ARM, -0.3 / ARM, -1); continue; }
    const r = c.grip.position.clone().sub(camera.position); // both are in rig space, which already turns with the player
    if (r.length() > ARM) r.setLength(ARM);
    out.push(r.x / ARM, r.y / ARM, r.z / ARM, pressed(h, 1) ? 1 : -1);
  }
  const stick = xrHands[1] && xrHands[1].gamepad ? xrHands[1].gamepad.axes[2] || 0 : 0;
  if (edge('turnL', stick < -0.6)) p.turn(Math.PI / 6);
  if (edge('turnR', stick > 0.6)) p.turn(-Math.PI / 6);
  return out;
}
function xrButtons() {
  if (edge('reset', pressed(1, 4) || pressed(0, 4))) resetEnv();
  if (edge('next', pressed(1, 5) || pressed(0, 5))) resetEnv(STAGES[(STAGES.findIndex(s => s.id === stageId) + 1) % STAGES.length].id);
}
async function checkXR() {
  const b = $('enter-vr');
  if (!b || !navigator.xr || !window.isSecureContext) return;
  try { if (!(await navigator.xr.isSessionSupported('immersive-vr'))) return; } catch { return; }
  b.hidden = false;
  b.onclick = async () => {
    if (xrSession) { xrSession.end(); return; }
    try {
      const session = await navigator.xr.requestSession('immersive-vr', { requiredFeatures: ['local-floor'] });
      xrSession = session;
      session.addEventListener('end', () => {
        xrSession = null; b.textContent = 'Enter VR';
        rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); camera.fov = 62;
        const vp = $('viewport'); renderer.setSize(vp.clientWidth, vp.clientHeight, false); camera.aspect = vp.clientWidth / vp.clientHeight; camera.updateProjectionMatrix();
      });
      await renderer.xr.setSession(session);
      if (!manual) setMode(true); else resetEnv();
      paused = false; slow = false; b.textContent = 'Exit VR';
    } catch (error) { text('expert-line', `VR could not start: ${error.message}`); }
  };
}

// ---- input ----
function manualAction() {
  const p = env.player;
  if (active >= 0) {
    const side = active ? 0.25 : -0.25;
    cmd[active].x = side + mouse.x * 0.7;
    cmd[active].y = -0.5 + mouse.y * 0.95;
  }
  const turn = (keys.has('KeyD') ? -1 : 0) + (keys.has('KeyA') ? 1 : 0);
  if (turn) p.turn(turn * 1.6 / HZ);
  const out = [];
  for (const h of [0, 1]) {
    const c = cmd[h]; const len = Math.hypot(c.x, c.y, c.z), k = len > ARM ? ARM / len : 1;
    out.push(c.x * k / ARM, c.y * k / ARM, c.z * k / ARM, grip[h] ? 1 : -1);
  }
  return out;
}
function bindInput() {
  const vp = $('viewport');
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    keys.add(e.code);
    if (e.code === 'KeyQ') active = 0;
    if (e.code === 'KeyE') active = 1;
    if (e.code === 'Space' && manual) { e.preventDefault(); const h = active >= 0 ? active : 0; grip[h] = true; }
    if (e.code === 'KeyR') resetEnv();
  });
  addEventListener('keyup', e => {
    keys.delete(e.code);
    if ((e.code === 'KeyQ' && active === 0) || (e.code === 'KeyE' && active === 1)) active = -1;
    if (e.code === 'Space') { grip[0] = grip[1] = false; }
  });
  vp.addEventListener('pointermove', e => {
    const r = vp.getBoundingClientRect();
    mouse.x = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
    mouse.y = clamp(1 - ((e.clientY - r.top) / r.height) * 2, -1, 1);
  });
  vp.addEventListener('wheel', e => {
    if (!manual) return;
    e.preventDefault();
    const h = active >= 0 ? active : 0;
    cmd[h].z = clamp(cmd[h].z - Math.sign(e.deltaY) * 0.06, -1.3, 0.2);
  }, { passive: false });
}

// ---- UI ----
function setMode(m) {
  manual = m;
  $('mode-expert').classList.toggle('active', !m); $('mode-expert').setAttribute('aria-pressed', !m);
  $('mode-manual').classList.toggle('active', m); $('mode-manual').setAttribute('aria-pressed', m);
  $('manual-panel').hidden = !m;
  resetEnv();
}
function buildUI() {
  const list = $('stage-list');
  STAGES.forEach(s => {
    const b = document.createElement('button');
    b.className = 'mode-button'; b.dataset.id = s.id; b.type = 'button';
    b.innerHTML = `<span class="number">${s.name.split('.')[0]}</span><span><strong>${s.name.replace(/^\d+\.\s*/, '')}</strong><small>${s.expert === false ? 'by hand' : 'scripted player ready'}</small></span><span class="tick ${s.expert === false ? 'no' : 'ok'}">${s.expert === false ? '✋' : '✓'}</span>`;
    b.addEventListener('click', () => resetEnv(s.id));
    list.appendChild(b);
  });
  $('mode-expert').onclick = () => setMode(false);
  $('mode-manual').onclick = () => setMode(true);
  $('pause').onclick = () => { paused = !paused; $('pause').textContent = paused ? 'Resume' : 'Pause'; $('live-dot').classList.toggle('paused', paused); };
  $('reset').onclick = () => resetEnv();
  $('slow').onclick = () => { slow = !slow; $('slow').setAttribute('aria-pressed', slow); $('slow').classList.toggle('active', slow); };
  $('camera').onclick = () => { chase = !chase; $('camera').textContent = chase ? 'Chase view' : 'First person'; };
  const sliders = [['s-jump', 'o-jump', 'jumpMultiplier', v => `${(+v).toFixed(2)}×`], ['s-max', 'o-max', 'maxJumpSpeed', v => `${v} m/s`], ['s-limit', 'o-limit', 'velocityLimit', v => `${(+v).toFixed(2)} m/s`], ['s-arm', 'o-arm', 'maxArmLength', v => `${(+v).toFixed(2)} m`]];
  const show = () => { for (const [i, o, k, f] of sliders) { $(i).value = SETTINGS[k]; text(o, f(SETTINGS[k])); } };
  for (const [i, o, k, f] of sliders) $(i).addEventListener('input', () => { SETTINGS[k] = +$(i).value; text(o, f($(i).value)); clearTimeout(buildUI.t); buildUI.t = setTimeout(() => resetEnv(), 250); });
  $('reset-settings').onclick = () => { Object.assign(SETTINGS, { jumpMultiplier: DEFAULTS.jumpMultiplier, maxJumpSpeed: DEFAULTS.maxJumpSpeed, velocityLimit: DEFAULTS.velocityLimit, maxArmLength: DEFAULTS.maxArmLength }); show(); resetEnv(); };
  show();
}
function hud(now) {
  const p = env.player;
  text('sim-time', `${(env.steps / HZ).toFixed(1)} s`);
  text('m-speed', `${Math.hypot(p.velocity.x, p.velocity.y, p.velocity.z).toFixed(1)} m/s`);
  text('m-stuck', `${p.hands[0].wasTouching ? 'L' : '–'} ${p.hands[1].wasTouching ? 'R' : '–'}`);
  text('m-launch', p.stats.launches);
  text('m-carry', `${p.heldMass()} kg`);
  const line = $('expert-line');
  let msg;
  if (env.success) msg = `Stage complete in ${(env.steps / HZ).toFixed(1)} s.`;
  else if (env.truncated) msg = 'Out of time. Press R to try again.';
  else if (env.terminated) msg = 'You fell off the course. Press R to try again.';
  else if (manual) msg = active >= 0 ? `Steering the ${active ? 'right' : 'left'} hand. Ease it onto a surface, then pull.` : 'Hold Q or E, then move the mouse.';
  else msg = `Scripted player: ${expert.label}`;
  if (line.textContent !== msg) { line.textContent = msg; line.classList.toggle('warn', !env.success && (env.truncated || env.terminated || /no scripted routine/.test(msg))); }
  if (++frames && now - fpsClock > 1000) { text('fps', `${Math.round(frames * 1000 / (now - fpsClock))} fps`); frames = 0; fpsClock = now; }
}

function frame(now) {
  if (renderer.xr.isPresenting) xrButtons();
  const dt = Math.min((now - (last || now)) / 1000, 0.1); last = now;
  if (!paused) {
    accumulator += dt * (slow ? 0.25 : 1);
    let n = 0;
    while (accumulator >= 1 / HZ && n++ < 12) {
      accumulator -= 1 / HZ;
      if (env.terminated || env.truncated) { if (!manual) { endedAt = endedAt || now; if (now - endedAt > 3000) resetEnv(); } continue; }
      const action = renderer.xr.isPresenting ? xrAction() : manual ? manualAction() : expert.act(obs);
      obs = env.step(action).observation;
    }
  }
  syncScene(); hud(now);
}

try {
  initThree(); buildUI(); bindInput(); resetEnv();
  window.gtag = { get env() { return env; }, STAGES };
  checkXR();
  renderer.setAnimationLoop(frame);
} catch (err) {
  const e = $('load-error'); e.hidden = false;
  e.textContent = `This page needs WebGL. ${err.message}`;
}
