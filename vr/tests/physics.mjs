import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GrabLab, MODES, LOCOMOTION_MODES, SCENARIOS, CANNON } from '../physics.js';

const V = (x = 0, y = 0, z = 0) => new CANNON.Vec3(x, y, z);
const length = v => Math.hypot(v.x, v.y, v.z);
const near = (value, expected, tolerance = 1e-6) => assert.ok(Math.abs(value - expected) <= tolerance, `${value} is not within ${tolerance} of ${expected}`);
const finiteBody = body => {
  for (const value of [body.position.x, body.position.y, body.position.z, body.velocity.x, body.velocity.y, body.velocity.z, body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w]) assert.ok(Number.isFinite(value));
};

function isolated(mode = 'backward', params = {}) {
  const lab = new GrabLab({ room: false, scripted: false, gravity: 0, mode, frequency: 3, ...params });
  lab.playerBody.linearDamping = 0;
  const item = lab._box('test-cube', 'Test cube', V(-0.25, 1.2, 0.95), V(0.3, 0.3, 0.3), { mass: 2, grabbable: true });
  item.body.linearDamping = 0;
  item.body.angularDamping = 0;
  lab.setInput({ hands: [{ position: V(-0.25, 1.2, -0.45), grip: true }] });
  lab.step();
  assert.equal(lab.hands[0].heldId, item.id);
  return { lab, item };
}

test('bidirectional drives conserve linear momentum in an isolated pair; one-way does not', () => {
  for (const mode of ['relative', 'backward', 'joint', 'velocity', 'oneway']) {
    const { lab, item } = isolated(mode);
    lab.setInput({ hands: [{ position: V(-0.12, 1.2, -0.45), grip: true }] });
    lab.step();
    const momentum = lab.playerBody.velocity.scale(lab.playerBody.mass).vadd(item.body.velocity.scale(item.body.mass));
    assert.ok(item.body.velocity.x > 0.01, `${mode} did not drive the object`);
    if (mode === 'oneway') {
      near(lab.playerBody.velocity.x, 0);
      assert.ok(momentum.x > 0.01);
    } else {
      assert.ok(lab.playerBody.velocity.x < 0, `${mode} omitted player reaction`);
      assert.ok(length(momentum) < 1e-6, `${mode} duplicated or lost a reaction impulse: ${momentum}`);
    }
    lab.dispose();
  }
});

test('switching controllers while held preserves object, anchor, transforms and velocity', () => {
  const { lab, item } = isolated();
  lab.setInput({ hands: [{ position: V(-0.12, 1.2, -0.45), grip: true }] });
  lab.step();
  const state = [...item.body.position.toArray(), ...item.body.quaternion.toArray(), ...item.body.velocity.toArray(), ...lab.playerBody.position.toArray()];
  const anchor = lab.hands[0].grab.localAnchor.toArray();
  for (const mode of ['joint', 'oneway', 'relative', 'backward', 'velocity', 'joint']) {
    lab.setMode(mode);
    assert.equal(lab.hands[0].heldId, item.id);
    assert.deepEqual(lab.hands[0].grab.localAnchor.toArray(), anchor);
    assert.deepEqual([...item.body.position.toArray(), ...item.body.quaternion.toArray(), ...item.body.velocity.toArray(), ...lab.playerBody.position.toArray()], state);
    assert.equal(lab.world.constraints.length, mode === 'joint' ? 1 : 0);
  }
  lab.release(0);
  assert.equal(lab.world.constraints.length, 0);
  assert.equal(item.body.collisionFilterMask & 2, 2);
  lab.dispose();
});

test('native joint cap is converted from newtons to the solver impulse for each timestep', () => {
  for (const dt of [1 / 60, 1 / 90, 1 / 120]) {
    const { lab } = isolated('joint', { maxForce: 10 });
    lab.setInput({ hands: [{ position: V(0.3, 1.45, -0.45), grip: true }] });
    lab.step(dt);
    for (const equation of lab.hands[0].grab.constraint.equations) assert.ok(Math.abs(equation.multiplier) <= 10.00001);
    assert.ok(lab.metrics.forceN > 9.9);
    assert.ok(lab.metrics.forceN <= Math.sqrt(3) * 10 + 1e-5);
    lab.dispose();
  }
});

test('native point joint permits rotation instead of quietly adding an angular motor', () => {
  const { lab, item } = isolated('joint');
  const q = new CANNON.Quaternion().setFromEuler(0, 1.2, 0);
  lab.setInput({ hands: [{ quaternion: q, grip: true }] });
  for (let i = 0; i < 90; i++) lab.step();
  near(length(item.body.angularVelocity), 0);
  near(item.body.quaternion.w, 1);
  lab.dispose();
});

test('off-centre force creates object torque and exactly one linear reaction', () => {
  const { lab, item } = isolated('relative', { maxTorque: 0 });
  lab.hands[0].grab.localAnchor.set(0.12, 0.1, 0);
  lab.setInput({ hands: [{ position: V(-0.13, 1.3, -0.35), grip: true }] });
  lab.step();
  assert.ok(length(item.body.angularVelocity) > 0.01);
  const momentum = lab.playerBody.velocity.scale(lab.playerBody.mass).vadd(item.body.velocity.scale(item.body.mass));
  assert.ok(length(momentum) < 1e-6);
  lab.dispose();
});

test('backward PD converges at a high gain with a coarse timestep in its scalar free-space case', () => {
  const { lab } = isolated('backward', { frequency: 18, maxForce: 5000 });
  lab.setInput({ hands: [{ position: V(0.05, 1.2, -0.45), grip: true }] });
  for (let i = 0; i < 90; i++) lab.step(1 / 30);
  assert.ok(lab.metrics.gapCm < 0.02, `Residual gap: ${lab.metrics.gapCm} cm`);
  finiteBody(lab.playerBody);
  lab.dispose();
});

test('sampled XR velocity stays consistent across 72/90/120Hz poses and 90Hz physics', () => {
  for (const poseHz of [72, 90, 120]) {
    const { lab } = isolated('backward');
    let accumulator = 0;
    for (let frame = 1; frame <= poseHz / 2; frame++) {
      const t = frame / poseHz;
      lab.setInput({ hands: [{ position: V(-0.25 + 0.3 * t, 1.2, -0.45), velocity: V(0.3, 0, 0), angularVelocity: V(), grip: true }] });
      accumulator += 1 / poseHz;
      while (accumulator >= 1 / 90 - 1e-9) { lab.step(); accumulator -= 1 / 90; }
    }
    near(lab.hands[0].localVelocity.x, 0.3, 0.001);
    assert.ok(lab.metrics.gapCm < 1.5, `${poseHz}Hz tracking gap was ${lab.metrics.gapCm} cm`);
    // Desktop/manual inputs omit measured velocity and recover the fixed-step
    // estimator rather than retaining a stale XR velocity after session exit.
    lab.setInput({ hands: [{ position: lab.input.hands[0].position.clone(), grip: true }] });
    for (let i = 0; i < 15; i++) lab.step();
    assert.ok(lab.hands[0].localVelocity.x < 0.001);
    lab.dispose();
  }
});

function floorPush(twoHands, preserveExternal = true) {
  const lab = new GrabLab({ room: false, scripted: false, gravity: 0, preserveExternal });
  lab.playerBody.linearDamping = 0;
  lab._box('floor', 'Floor', V(0, -0.1, 0), V(10, 0.2, 10));
  const count = twoHands ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const x = i ? 0.3 : -0.3;
    lab.input.hands[i].position.set(x, -0.1, 0.15);
    lab.hands[i].previousLocal.copy(lab.input.hands[i].position);
    lab.hands[i].physical.set(x, 0.085, 1.55);
  }
  lab.playerBody.velocity.x = 1.5;
  lab.step();
  return lab;
}

test('one and two identical hand contacts move the origin equally, rather than doubling the push', () => {
  const single = floorPush(false), double = floorPush(true);
  assert.ok(single.rigPosition.y > 0.15);
  near(single.rigPosition.y, double.rigPosition.y, 1e-5);
  assert.equal(single.metrics.contacts, 1);
  assert.equal(double.metrics.contacts, 2);
  single.dispose(); double.dispose();
});

test('external velocity survives arcade contact only when preserveExternal is enabled', () => {
  const keep = floorPush(false, true), erase = floorPush(false, false);
  assert.ok(keep.playerBody.velocity.x > 1.4);
  near(erase.playerBody.velocity.x, 0);
  keep.dispose(); erase.dispose();
});

test('grabbing a fixed grip moves the player in reaction modes and has no one-way reaction', () => {
  for (const mode of ['oneway', 'backward', 'joint']) {
    const { lab, item } = isolated(mode);
    item.body.mass = 0; item.body.type = CANNON.Body.STATIC; item.body.updateMassProperties();
    lab.setInput({ hands: [{ position: V(-0.1, 1.2, -0.45), grip: true }] });
    for (let i = 0; i < 20; i++) lab.step();
    if (mode === 'oneway') near(lab.rigPosition.x, 0);
    else assert.ok(lab.rigPosition.x < -0.1, `${mode} failed to react on a static grip`);
    lab.dispose();
  }
});

test('teleport and a tracking discontinuity release a grab without differentiating it into a launch', () => {
  const { lab } = isolated('joint');
  lab.teleport(V(2, 0, 2));
  assert.equal(lab.hands[0].heldId, null);
  assert.equal(lab.world.constraints.length, 0);
  near(length(lab.playerBody.velocity), 0);
  const fresh = isolated('backward').lab;
  fresh.setInput({ hands: [{ position: V(1.5, 1.2, -0.45), grip: true }] });
  fresh.step();
  assert.equal(fresh.hands[0].heldId, null);
  near(length(fresh.playerBody.velocity), 0);
  lab.dispose(); fresh.dispose();
});

test('manual movement and room-scale head motion stop at static walls', () => {
  const lab = new GrabLab({ scripted: false, gravity: 0 });
  for (let i = 0; i < 15; i++) lab.move(V(0, 0, -0.2));
  assert.ok(lab.rigPosition.z >= 1.08, `Capsule passed through the bench: ${lab.rigPosition.z}`);
  lab.dispose();
  const wallLab = new GrabLab({ room: false, scripted: false, gravity: 0 });
  wallLab._box('wall', 'Wall', V(0, 1.35, -0.21), V(2.8, 2.7, 0.5));
  wallLab.teleport(V(0, 0, 0.4));
  wallLab.setInput({ head: { position: V(0, 1.65, -0.4) } });
  wallLab.step();
  assert.ok(wallLab.rigPosition.z + wallLab.input.head.position.z >= 0.169, 'Head passed through the front wall');
  wallLab.dispose();
});

test('all five grab controllers complete contact workouts and reset for a second cycle', () => {
  for (const mode of MODES) {
    const lab = new GrabLab({ mode: mode.id });
    let heldFrames = 0, contactFrames = 0, minimumWallZ = Infinity, maximumSpeed = 0;
    for (let i = 0; i < 1800; i++) {
      lab.step();
      heldFrames += Number(lab.metrics.heldCount > 0);
      contactFrames += Number(lab.metrics.contacts > 0);
      maximumSpeed = Math.max(maximumSpeed, lab.metrics.speed);
      if (lab.time > 6 && lab.time < 10) minimumWallZ = Math.min(minimumWallZ, lab.items.find(item => item.id === 'cube').body.position.z);
      finiteBody(lab.playerBody);
      for (const item of lab.items) if (!item.isStatic) finiteBody(item.body);
    }
    assert.ok(heldFrames > 700, `${mode.id}: failed scripted grab`);
    assert.ok(contactFrames > 40, `${mode.id}: missing real collisions`);
    assert.ok(minimumWallZ > -0.05, `${mode.id}: cube tunnelled through press wall`);
    assert.ok(maximumSpeed < 8, `${mode.id}: unexpected launch (${maximumSpeed})`);
    assert.equal(lab.cycle, 1);
    assert.ok(lab.time > 1 && lab.time < 3);
    assert.ok(lab.rigPosition.y > -0.1);
    lab.dispose();
  }
});

test('locomotion selection preserves the held prop and is independent of grab-controller choice', () => {
  const { lab, item } = isolated('joint');
  const anchor = lab.hands[0].grab.localAnchor.toArray();
  const constraint = lab.hands[0].grab.constraint;
  const initial = [...item.body.position.toArray(), ...item.body.velocity.toArray()];
  for (const mode of LOCOMOTION_MODES) {
    lab.setLocomotion(mode.id);
    assert.equal(lab.mode, 'joint');
    assert.equal(lab.hands[0].heldId, item.id);
    assert.equal(lab.hands[0].grab.constraint, constraint);
    assert.deepEqual(lab.hands[0].grab.localAnchor.toArray(), anchor);
    assert.deepEqual([...item.body.position.toArray(), ...item.body.velocity.toArray()], initial);
    assert.equal(lab.world.constraints.length, 1);
  }
  lab.dispose();
});

test('cast contact, force contact, and contact off have distinct bounded effects', () => {
  const results = {};
  for (const mode of LOCOMOTION_MODES) {
    const lab = new GrabLab({ room: false, scripted: false, gravity: 0, locomotion: mode.id, maxContactForce: 300 });
    lab.playerBody.linearDamping = 0;
    lab._box('floor', 'Floor', V(0, -0.1, 0), V(10, 0.2, 10));
    lab.input.hands[0].position.set(-0.3, -0.1, 0.15);
    lab.hands[0].previousLocal.copy(lab.input.hands[0].position);
    lab.hands[0].physical.set(-0.3, 0.085, 1.55);
    lab.step();
    results[mode.id] = { y: lab.rigPosition.y, ...lab.metrics };
    if (mode.id === 'force') {
      assert.ok(lab.metrics.contactForceN > 0);
      assert.ok(lab.metrics.contactForceN <= 300 + 1e-8);
      near(lab.metrics.contactCorrectionM, 0);
      assert.ok(lab.playerBody.velocity.y <= 300 / lab.playerBody.mass / 90 + 1e-5);
    }
    lab.dispose();
  }
  assert.ok(results.cast.y > 0.15);
  assert.ok(results.force.y > 0 && results.force.y < 0.01);
  assert.ok(Math.abs(results.off.y) < 1e-5);
  assert.equal(results.off.contacts, 0);
});

test('velocity servo caps paired impulse in newtons times timestep across 72/90/120 Hz', () => {
  for (const hz of [72, 90, 120]) {
    const { lab, item } = isolated('velocity', { maxForce: 10, maxTorque: 0 });
    lab.setLocomotion('off');
    lab.setInput({ hands: [{ position: V(0.2, 1.2, -0.45), grip: true }] });
    lab.step(1 / hz);
    const impulse = length(item.body.velocity) * item.body.mass;
    assert.ok(impulse <= 10 / hz + 1e-7, `${hz} Hz exceeded the force-time bound`);
    assert.ok(impulse > 9.9 / hz);
    const momentum = lab.playerBody.velocity.scale(lab.playerBody.mass).vadd(item.body.velocity.scale(item.body.mass));
    near(length(momentum), 0, 1e-7);
    assert.ok(lab.metrics.forceN <= 10 + 1e-7);
    lab.dispose();
  }
});

test('velocity servo does not quietly depend on the disabled spring or feedforward gains', () => {
  const a = isolated('velocity', { frequency: 1, damping: 0.1, angularFrequency: 1, feedforward: 0 });
  const b = isolated('velocity', { frequency: 18, damping: 3, angularFrequency: 12, feedforward: 1.5 });
  const pose = { hands: [{ position: V(-0.1, 1.3, -0.45), quaternion: new CANNON.Quaternion().setFromEuler(0, 0, 0.4), grip: true }] };
  for (const { lab } of [a, b]) {
    lab.setInput(pose);
    for (let i = 0; i < 15; i++) lab.step();
  }
  assert.deepEqual(a.item.body.position.toArray(), b.item.body.position.toArray());
  assert.deepEqual(a.item.body.quaternion.toArray(), b.item.body.quaternion.toArray());
  assert.deepEqual(a.lab.playerBody.velocity.toArray(), b.lab.playerBody.velocity.toArray());
  a.lab.dispose(); b.lab.dispose();
});

test('geometric penetration recovery alone cannot manufacture a release launch', () => {
  const lab = floorPush(false);
  near(lab.playerBody.velocity.y, 0, 1e-7);
  lab.setInput({ hands: [{ position: V(-0.3, 0.3, 0.15), grip: false }] });
  lab.step();
  near(lab.metrics.launchSpeed, 0);
  near(lab.playerBody.velocity.y, 0, 1e-7);
  assert.equal(lab.exportTrial().summary.launches, 0);
  lab.dispose();
});

test('enabling cast contact with a query hand inside the floor recovers without launch energy', () => {
  const lab = new GrabLab({ room: false, scripted: false, gravity: 0, locomotion: 'off' });
  lab.playerBody.linearDamping = 0;
  lab._box('floor', 'Floor', V(0, -0.1, 0), V(10, 0.2, 10));
  lab.input.hands[0].position.set(-0.3, -0.1, 0.15);
  lab.hands[0].previousLocal.copy(lab.input.hands[0].position);
  lab.step();
  assert.ok(lab.hands[0].physical.y < 0);
  lab.setLocomotion('cast');
  lab.step();
  assert.ok(lab.hands[0].physical.y >= 0.085);
  assert.ok(lab.metrics.contactCorrectionM > 0.15);
  lab.setInput({ hands: [{ position: V(-0.3, 0.3, 0.15), grip: false }] });
  lab.step();
  near(lab.metrics.launchSpeed, 0);
  near(lab.playerBody.velocity.y, 0, 1e-7);
  lab.dispose();
});

test('deliberate contact strokes can launch, while head-tracking recovery clears the launch history', () => {
  for (const recover of [false, true]) {
    const lab = floorPush(false);
    for (let i = 1; i <= 4; i++) {
      lab.setInput({ hands: [{ position: V(-0.3, -0.1 - 0.04 * i, 0.15), grip: false }] });
      lab.step();
    }
    if (recover) lab.setInput({ head: { position: V(0, 2.7, 0) } });
    lab.setInput({ hands: [{ position: V(-0.3, 0.3, 0.15), grip: false }] });
    lab.step();
    if (recover) {
      near(lab.metrics.launchSpeed, 0);
      assert.equal(lab.exportTrial().summary.launches, 0);
    } else {
      assert.ok(lab.metrics.launchSpeed > 0.8);
      assert.equal(lab.exportTrial().summary.launches, 1);
    }
    lab.dispose();
  }
});

test('unheld airborne tracking produces no root movement in every contact architecture', () => {
  for (const locomotion of LOCOMOTION_MODES) {
    const lab = new GrabLab({ scenario: 'airborne', locomotion: locomotion.id, repeatTrial: false });
    for (let i = 0; i < 720; i++) lab.step();
    near(lab.metrics.playerDriftM, 0, 1e-8);
    near(lab.metrics.speed, 0, 1e-8);
    assert.equal(lab.metrics.heldCount, 0);
    assert.equal(lab.metrics.contacts, 0);
    assert.equal(lab.exportTrial().summary.launches, 0);
    lab.dispose();
  }
});

test('shove is a single scenario event during recorded/manual input and repeat can be disabled', () => {
  const lab = new GrabLab({ scripted: false, gravity: 0, locomotion: 'off' });
  lab.setScenario('shove');
  lab.repeatTrial = false;
  lab.playerBody.linearDamping = 0;
  for (let i = 0; i < 810; i++) lab.step();
  assert.equal(lab.scripted, false);
  assert.ok(lab.time > 8.9);
  assert.equal(lab.cycle, 0);
  near(lab.playerBody.velocity.x, 90 / lab.playerBody.mass, 1e-6);
  assert.equal(lab.exportTrial().summary.externalImpulseNs, 90);
  const data = JSON.parse(JSON.stringify(lab.exportTrial()));
  assert.equal(data.scenario, 'shove');
  assert.equal(data.locomotion, 'off');
  assert.equal(data.parameters.bodyMass, 75);
  lab.dispose();
});

test('all scenario setups run finite and preserve requested gravity outside the airborne isolation case', () => {
  for (const scenario of SCENARIOS) for (const locomotion of ['cast', 'force', 'off']) {
    const lab = new GrabLab({ scenario: scenario.id, locomotion, repeatTrial: false });
    let held = 0, contacts = 0;
    for (let i = 0; i < scenario.duration * 72; i++) {
      lab.step(1 / 72);
      held += lab.metrics.heldCount;
      contacts += lab.metrics.contacts;
      finiteBody(lab.playerBody);
    }
    if (['workout', 'wall'].includes(scenario.id)) assert.ok(held > 300, `${scenario.id}/${locomotion}: missed pickup`);
    if (scenario.id === 'floor' && locomotion !== 'off') assert.ok(contacts > 5, `${scenario.id}/${locomotion}: missed floor`);
    if (scenario.id === 'airborne') {
      near(lab.world.gravity.y, 0);
      lab.setScenario('workout');
      near(lab.world.gravity.y, -lab.params.gravity);
    }
    lab.dispose();
  }
});
