import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GorillaPlayer, Cube, sweepBoxes, vec, DEFAULTS } from '../../gtag/gorilla.js';
import { GtagEnvironment, ACTION_SCHEMA, OBSERVATION_SCHEMA } from '../../gtag/env.js';
import { ScriptedExpert } from '../../gtag/expert.js';
import { STAGES } from '../../gtag/stages.js';

const floor = { id: 'floor', center: vec(0, -0.5, -20), half: vec(10, 0.5, 40) };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);
function settled(extra = {}) {
  const p = new GorillaPlayer({ boxes: [floor], position: vec(0, -0.65, 0), ...extra });
  for (let i = 0; i < 90; i++) p.step(1 / 90);
  return p;
}
// Hand targets are rig-local; head-relative y of the floor is -1.0 when the body rests on it.
const head = 1.65;

// One stroke: lift ahead, ease the hands down onto the floor, then pull back `pull` metres.
function stroke(p, hands, pull = 0.7, { frames = 27 } = {}) {
  const dt = 1 / 90;
  const set = (z, y) => { for (const h of hands) p.handLocal[h] = vec(h ? 0.25 : -0.25, head + y, z); };
  for (let i = 0; i < 20; i++) { set(-0.7, -0.4); p.step(dt); }
  // Lower until the hand touches, then stop pressing: pushing on, the player is launched upward.
  let y = -0.4;
  for (let i = 0; i < 40 && !hands.every(h => p.hands[h].wasTouching); i++) { y -= 4 * dt; set(-0.7, y); p.step(dt); }
  const start = p.position.z;
  let peak = 0;
  for (let i = 0; i < frames; i++) { set(-0.7 + pull * (i + 1) / frames, y); p.step(dt); peak = Math.max(peak, Math.abs(p.velocity.z)); }
  return { moved: start - p.position.z, peak };
}

test('sweepBoxes finds the entry face and ignores a path that misses', () => {
  const box = { center: vec(0, 0, -2), half: vec(1, 1, 0.5) };
  const hit = sweepBoxes(vec(0, 0, 0), vec(0, 0, -3), vec(0.1, 0.1, 0.1), [box]);
  assert.ok(hit); near(hit.t, (2 - 0.5 - 0.1) / 3, 1e-9); assert.deepEqual(hit.normal, vec(0, 0, 1));
  assert.equal(sweepBoxes(vec(5, 0, 0), vec(0, 0, -3), vec(0.1, 0.1, 0.1), [box]), null);
});

test('the body comes to rest on the floor', () => {
  const p = settled();
  assert.ok(p.grounded);
  near(p.position.y, -0.65, 0.02);
});

test('a hand stuck to the floor moves the player the opposite way, about one stroke length', () => {
  const p = settled();
  const { moved } = stroke(p, [0]);
  assert.ok(moved > 0.5 && moved < 0.85, `moved ${moved}`);
});

test('two stuck hands average, they do not add', () => {
  const one = stroke(settled(), [0]).moved;
  const both = stroke(settled(), [0, 1]).moved;
  assert.ok(both < one * 1.3, `both ${both} vs one ${one}`);
});

test('carried mass shares launch momentum with the player', () => {
  const plain = stroke(settled(), [0, 1]).peak;
  const heavy = new Cube('h', vec(-0.25, 0.15, -0.5), 0.3, 400);
  const p = settled({ cubes: [heavy] });
  p.handLocal[0] = vec(-0.25, head - 1.0, -0.5);
  p.setHands(null, null, true, false);
  for (let i = 0; i < 20; i++) p.step(1 / 90);
  assert.equal(heavy.heldBy, 0);
  const loaded = stroke(p, [0, 1]).peak;
  assert.ok(loaded < plain * 0.5, `loaded ${loaded} plain ${plain}`);
});

test('a gripped cube follows the hand and cannot be pushed into the floor', () => {
  const cube = new Cube('c', vec(-0.25, 0.15, -0.5), 0.3, 5);
  const p = settled({ cubes: [cube] });
  p.handLocal[0] = vec(-0.25, head - 1.0, -0.5);
  p.setHands(null, null, true, false);
  for (let i = 0; i < 20; i++) p.step(1 / 90);
  assert.equal(cube.heldBy, 0);
  p.handLocal[0] = vec(-0.25, head - 1.2, -0.5);
  for (let i = 0; i < 20; i++) p.step(1 / 90);
  assert.ok(cube.position.y >= 0.15 - 0.01, `cube sank to ${cube.position.y}`);
});

test('environment schema matches the vectors it returns and resets deterministically', () => {
  const a = new GtagEnvironment({ stage: 'slap' });
  const b = new GtagEnvironment({ stage: 'slap' });
  assert.equal(a.observe().length, OBSERVATION_SCHEMA.length);
  const action = new Array(ACTION_SCHEMA.length).fill(0);
  action[1] = -0.3; action[5] = -0.3;
  for (let i = 0; i < 100; i++) { a.step(action); b.step(action); }
  assert.deepEqual(a.observe(), b.observe());
  assert.equal(a.step(action).reward, null);
  assert.ok(a.observe().every(Number.isFinite));
});

test('every stage lists a goal and valid geometry', () => {
  assert.ok(STAGES.length >= 5);
  for (const s of STAGES) {
    assert.ok(s.goal && s.boxes.length && s.lesson, s.id);
    for (const b of s.boxes) for (const a of ['x', 'y', 'z']) assert.ok(b.half[a] > 0);
  }
});

function runExpert(id) {
  const env = new GtagEnvironment({ stage: id });
  const expert = new ScriptedExpert();
  let obs = env.observe(), result;
  for (let i = 0; i < env.maxSteps; i++) {
    result = env.step(expert.act(obs));
    obs = result.observation;
    if (result.terminated || result.truncated) break;
  }
  return { result, env, expert };
}

for (const id of ['slap', 'steps', 'carry', 'gap']) {
  test(`the scripted expert completes the "${id}" stage from the standard spawn`, () => {
    const { result } = runExpert(id);
    assert.ok(result.info.success, JSON.stringify(result.info));
  });
}

test('the wall stage is marked as having no scripted routine, and the expert says so', () => {
  const stage = STAGES.find(s => s.id === 'wall');
  assert.equal(stage.expert, false);
  const { expert, result } = runExpert('wall');
  assert.ok(/no scripted routine/.test(expert.label));
  assert.equal(result.info.success, false);
});
