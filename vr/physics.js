/*
 * Grab Lab — shared desktop/WebXR physics, metres / kilograms / seconds.
 * Cannon-es 0.20.0 is vendored with its MIT licence. This is a small teaching
 * model, not PhysX, a ConfigurableJoint clone, or an exact Gorilla Tag port.
 * The static-hand sweep / equal two-hand average is inspired by the MIT
 * Another-Axiom/GorillaLocomotion Player.cs, commit bc42e959cf3e69178f9147d89bd3ffeab1c432c4.
 */
import * as CANNON from './vendor/cannon-es-0.20.0.js';

export const MODES = Object.freeze([
  { id: 'oneway', name: 'One-way PD', short: 'One-way', color: '#fb923c', description: 'The object follows a moving hand. No equal-and-opposite force reaches the player.' },
  { id: 'relative', name: 'Relative PD', short: 'Relative PD', color: '#38bdf8', description: 'A spring with relative-velocity damping. The same force pushes the object and reacts on the player.' },
  { id: 'backward', name: 'Backward PD', short: 'Backward PD', color: '#a78bfa', description: 'Timestep-adjusted spring and damping gains, with body reaction and optional target-acceleration feedforward.' },
  { id: 'joint', name: 'Cannon point joint', short: 'Point joint', color: '#4ade80', description: 'A native three-axis point constraint. It reacts on both bodies and allows free rotation; this is not a Unity ConfigurableJoint.' },
  { id: 'velocity', name: 'Capped velocity servo', short: 'Velocity servo', color: '#f472b6', description: 'Requests one-substep positional and angular catch-up with bounded impulses. The player receives the opposite linear impulse. Gain sliders and acceleration feedforward do not apply.' },
]);

export const LOCOMOTION_MODES = Object.freeze([
  { id: 'cast', name: 'Cast correction', description: 'Sweep massless hand query points, average contact corrections, and move the player geometrically. Intentional strokes can launch on release.' },
  { id: 'force', name: 'Contact force servo', description: 'Use the same hand queries, but move the player with a bounded backward-PD contact force. There is no geometric hand correction or extra launch impulse.' },
  { id: 'off', name: 'Hand locomotion off', description: 'Hands do not move the player through environment queries. Grabbing reactions and body collisions still work.' },
]);

export const SCENARIOS = Object.freeze([
  { id: 'workout', name: 'Full workout', duration: 18, description: 'The original pickup, reversal, prop-wall press, release and two-hand floor push.' },
  { id: 'airborne', name: 'Airborne arm sweep', duration: 8, description: 'Zero-gravity free-space arm motion with no held prop. Tests whether tracking alone invents player movement.' },
  { id: 'floor', name: 'Two-hand floor push', duration: 8, description: 'Repeated identical strokes on clear floor. Compare direct correction with finite contact force.' },
  { id: 'wall', name: 'Prop against wall', duration: 12, description: 'Pick up the small cube, reverse it, press it into the wall, then release. Compare reaction and force limits.' },
  { id: 'shove', name: 'External shove', duration: 8, description: 'Plant both hands on clear floor, then apply one 90 N·s sideways impulse at 2 seconds. Watch which motion survives.' },
]);

export const DEFAULTS = Object.freeze({
  frequency: 8, damping: 1, angularFrequency: 6,
  maxForce: 1600, maxTorque: 30, bodyMass: 75, cubeMass: 1,
  feedforward: 0, preserveExternal: true, maxArmLength: 1.65,
  gripReach: 0.18, gravity: 9.81,
  contactFrequency: 6, contactDamping: 1, maxContactForce: 1800,
});

const WORLD = 1, PLAYER = 2, OBJECT = 4;
const V = (x = 0, y = 0, z = 0) => new CANNON.Vec3(x, y, z);
const Q = () => new CANNON.Quaternion();
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const finite = (n, fallback) => Number.isFinite(n) ? n : fallback;
const xyz = (p, fallback = V()) => V(finite(p?.x, fallback.x), finite(p?.y, fallback.y), finite(p?.z, fallback.z));
const add = (a, b) => V(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a, b) => V(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a, n) => V(a.x * n, a.y * n, a.z * n);
const lerp = (a, b, t) => V(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
const length = a => Math.hypot(a.x, a.y, a.z);
const capped = (a, max) => length(a) > max ? mul(a, max / length(a)) : a;
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const quaternion = q => {
  const out = new CANNON.Quaternion(finite(q?.x, 0), finite(q?.y, 0), finite(q?.z, 0), finite(q?.w, 1));
  if (out.x * out.x + out.y * out.y + out.z * out.z + out.w * out.w < 1e-10) out.w = 1;
  out.normalize();
  return out;
};

/** Natural-frequency gains. Backward gains describe the scalar free-space model;
 * finite force caps, rotation, contacts and an iterative solver still matter. */
export function pdGains(frequency, damping, dt, backward = false) {
  const omega = 2 * Math.PI * frequency;
  const kp = omega * omega, kd = 2 * damping * omega;
  const g = backward ? 1 / (1 + kd * dt + kp * dt * dt) : 1;
  return { kp: kp * g, kd: (kd + (backward ? kp * dt : 0)) * g };
}

/** Conservative swept point against an expanded axis-aligned box. */
function boxHit(start, delta, low, high) {
  const axes = ['x', 'y', 'z'];
  const inside = axes.every(a => start[a] >= low[a] - 1e-7 && start[a] <= high[a] + 1e-7);
  if (inside) {
    let distance = Infinity, normal = V();
    for (const axis of axes) {
      const d0 = start[axis] - low[axis], d1 = high[axis] - start[axis];
      if (d0 < distance) { distance = d0; normal = V(); normal[axis] = -1; }
      if (d1 < distance) { distance = d1; normal = V(); normal[axis] = 1; }
    }
    return delta.dot(normal) < -1e-8 ? { t: 0, normal } : null;
  }
  let enter = 0, leave = 1, normal = null;
  for (const axis of axes) {
    const s = start[axis], d = delta[axis];
    if (Math.abs(d) < 1e-10) {
      if (s < low[axis] || s > high[axis]) return null;
      continue;
    }
    let near = (low[axis] - s) / d, far = (high[axis] - s) / d;
    const sign = d > 0 ? -1 : 1;
    if (near > far) [near, far] = [far, near];
    if (near >= enter) { enter = near; normal = V(); normal[axis] = sign; }
    leave = Math.min(leave, far);
    if (enter > leave) return null;
  }
  return normal && enter >= 0 && enter <= 1 && delta.dot(normal) < -1e-8 ? { t: enter, normal } : null;
}

/** Equal weighting is intentional: two touching hands must not double a move. */
export function averageHandCorrection(corrections) {
  if (!corrections.length) return V();
  return mul(corrections.reduce((sum, v) => add(sum, v), V()), 1 / corrections.length);
}

export class GrabLab {
  constructor(options = {}) {
    this.params = { ...DEFAULTS };
    this.mode = MODES.some(m => m.id === options.mode) ? options.mode : 'backward';
    this.locomotion = LOCOMOTION_MODES.some(m => m.id === options.locomotion) ? options.locomotion : 'cast';
    this.scenario = SCENARIOS.some(s => s.id === options.scenario) ? options.scenario : 'workout';
    this.repeatTrial = options.repeatTrial !== false;
    this.scripted = options.scripted !== false;
    this.roomEnabled = options.room !== false;
    this.time = 0;
    this.elapsed = 0;
    this.cycle = 0;
    this.workoutDuration = SCENARIOS.find(s => s.id === this.scenario).duration;
    this.items = [];
    this.staticBoxes = [];
    this.constraints = [];
    this._history = [];
    this._wasTouching = false;
    this._contactForce = V();
    this._contactCorrection = V();
    this._launchVelocity = V();
    this._trackingRecovery = false;
    this._shoveDelivered = false;
    this._spawn = V(0, 0, 1.4);
    this._phase = 'Reach for the small cube';
    this.world = new CANNON.World({ gravity: V(0, -DEFAULTS.gravity, 0), allowSleep: true });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.solver.iterations = 16;
    this.world.solver.tolerance = 1e-7;
    this.world.defaultContactMaterial.friction = 0.65;
    this.world.defaultContactMaterial.restitution = 0;
    this.world.defaultContactMaterial.contactEquationStiffness = 1e7;
    this.world.defaultContactMaterial.contactEquationRelaxation = 4;
    this.environmentMaterial = new CANNON.Material('environment');
    this.playerMaterial = new CANNON.Material('player');
    // The capsule has no foot-friction motor. Static hand contact supplies grip;
    // the free capsule makes external grabbing reaction directly observable.
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.playerMaterial, this.environmentMaterial, { friction: 0, restitution: 0, contactEquationStiffness: 1e7, contactEquationRelaxation: 4 }));
    this.playerBody = new CANNON.Body({ mass: DEFAULTS.bodyMass, material: this.playerMaterial, fixedRotation: true, linearDamping: 0.4, angularDamping: 1, allowSleep: false });
    this.playerBody.collisionFilterGroup = PLAYER;
    this.playerBody.collisionFilterMask = WORLD | OBJECT;
    this.playerBody.addShape(new CANNON.Sphere(0.26), V(0, 0.26, 0));
    this.playerBody.addShape(new CANNON.Box(V(0.24, 0.46, 0.24)), V(0, 0.76, 0));
    this.playerBody.addShape(new CANNON.Sphere(0.13), V(0, 1.65, 0));
    this.playerBody.position.copy(this._spawn);
    this.world.addBody(this.playerBody);
    // The body position is the tracking origin at floor height, NOT head height.
    // Rotation is frozen; compound-shape offsets do not model human inertia.
    this.rigPosition = this.playerBody.position;
    this.input = {
      head: { position: V(0, 1.65, 0), quaternion: Q() },
      hands: [
        { position: V(-0.25, 1.2, -0.45), quaternion: Q(), grip: false },
        { position: V(0.25, 1.2, -0.45), quaternion: Q(), grip: false },
      ],
    };
    this._previousHead = add(this.rigPosition, this.input.head.position);
    this.hands = this.input.hands.map((input, index) => ({
      index, target: add(this.rigPosition, input.position), physical: add(this.rigPosition, input.position),
      localPosition: input.position.clone(), quaternion: Q(), grip: false, heldId: null,
      contact: false, forceN: 0, limited: false, grab: null,
      previousLocal: input.position.clone(), localVelocity: V(), localAcceleration: V(),
      previousQuaternion: Q(), angularVelocity: V(), previousGrip: false,
      trackedDelta: V(),
    }));
    this.metrics = { gapCm: 0, peakGapCm: 0, forceN: 0, speed: 0, contacts: 0, heldCount: 0, limited: false, time: 0, workoutPhase: this._phase, grounded: false, playerDriftM: 0, contactCorrectionM: 0, contactForceN: 0, launchSpeed: 0 };
    if (this.roomEnabled) this._buildRoom();
    this.setParams(options);
    this._trialOrigin = this.playerBody.position.clone();
    this._newTrial();
    if (this.scenario !== 'workout') this.setScenario(this.scenario);
  }

  _box(id, label, center, size, { mass = 0, color = '#283647', grabbable = false, massScale = 0 } = {}) {
    const body = new CANNON.Body({ mass, material: this.environmentMaterial, position: xyz(center), linearDamping: 0.025, angularDamping: 0.08, allowSleep: true });
    body.addShape(new CANNON.Box(mul(xyz(size), 0.5)));
    body.collisionFilterGroup = mass > 0 ? OBJECT : WORLD;
    body.collisionFilterMask = WORLD | PLAYER | OBJECT;
    body.sleepSpeedLimit = 0.035;
    this.world.addBody(body);
    const item = { id, label, kind: 'box', size: xyz(size), color, body, grabbable, isStatic: mass === 0, massScale, initialPosition: body.position.clone(), initialQuaternion: body.quaternion.clone() };
    this.items.push(item);
    if (!mass) this.staticBoxes.push(item);
    return item;
  }

  _buildRoom() {
    this._box('floor', 'Floor', V(0, -0.1, 0), V(16, 0.2, 16), { color: '#182334' });
    this._box('press-wall', 'Press wall', V(0, 1.35, -0.21), V(2.8, 2.7, 0.5), { color: '#35445c' });
    this._box('table', 'Work bench', V(0, 0.7, 0.55), V(2.5, 0.12, 0.55), { color: '#4a5368' });
    this._box('table-left', 'Bench leg', V(-1.05, 0.35, 0.55), V(0.1, 0.7, 0.4), { color: '#344052' });
    this._box('table-right', 'Bench leg', V(1.05, 0.35, 0.55), V(0.1, 0.7, 0.4), { color: '#344052' });
    this._box('cube', '1× mass cube', V(-0.45, 0.91, 0.55), V(0.28, 0.28, 0.28), { mass: this.params.cubeMass, massScale: 1, color: '#a78bfa', grabbable: true });
    this._box('heavy-cube', '8× mass cube', V(0.55, 0.95, 0.55), V(0.36, 0.36, 0.36), { mass: this.params.cubeMass * 8, massScale: 8, color: '#fb923c', grabbable: true });
    this._box('crate', '12× mass crate', V(2.3, 0.3, 0.3), V(0.6, 0.6, 0.6), { mass: this.params.cubeMass * 12, massScale: 12, color: '#38bdf8', grabbable: true });
    this._box('climb-wall', 'Climbing wall', V(-3.2, 1.7, -1.1), V(0.25, 3.4, 3.4), { color: '#283b4d' });
    this._box('grip-low', 'Fixed lower grip', V(-2.98, 1.15, -0.2), V(0.22, 0.18, 0.32), { color: '#34d399', grabbable: true });
    this._box('grip-high', 'Fixed upper grip', V(-2.98, 1.9, -0.8), V(0.22, 0.18, 0.32), { color: '#34d399', grabbable: true });
    this._box('platform', 'Low landing', V(2.8, 0.22, -2.2), V(1.8, 0.44, 1.5), { color: '#2e4659' });
  }

  setInput(next = {}) {
    if (next.head) {
      this.input.head.position.copy(xyz(next.head.position || next.head, this.input.head.position));
      if (next.head.quaternion) this.input.head.quaternion.copy(quaternion(next.head.quaternion));
    }
    if (next.hands) for (let i = 0; i < 2; i++) {
      const input = next.hands[i];
      if (!input) continue;
      this.input.hands[i].position.copy(xyz(input.position || input, this.input.hands[i].position));
      if (input.quaternion) this.input.hands[i].quaternion.copy(quaternion(input.quaternion));
      if (typeof input.grip === 'boolean') this.input.hands[i].grip = input.grip;
      // A real tracking source can supply velocities sampled at its own pose
      // cadence; desktop/scripted inputs fall back to fixed-step differences.
      this.input.hands[i].velocity = input.velocity ? xyz(input.velocity) : null;
      this.input.hands[i].angularVelocity = input.angularVelocity ? xyz(input.angularVelocity) : null;
    }
  }

  setScripted(enabled) {
    this.scripted = Boolean(enabled);
    this._history.length = 0;
    this._wasTouching = false;
    for (const hand of this.hands) {
      this.input.hands[hand.index].velocity = null;
      this.input.hands[hand.index].angularVelocity = null;
      this._resetHandHistory(hand);
    }
  }

  setParams(patch = {}) {
    const ranges = { frequency: [0.25, 18], damping: [0, 3], angularFrequency: [0.25, 12], maxForce: [1, 5000], maxTorque: [0, 100], bodyMass: [1, 150], cubeMass: [0.1, 30], feedforward: [0, 1.5], maxArmLength: [0.5, 2.4], gripReach: [0.03, 0.4], gravity: [0, 20], contactFrequency: [0.25, 15], contactDamping: [0, 3], maxContactForce: [1, 5000] };
    for (const [key, range] of Object.entries(ranges)) if (Number.isFinite(patch[key])) this.params[key] = clamp(patch[key], ...range);
    if (typeof patch.preserveExternal === 'boolean') this.params.preserveExternal = patch.preserveExternal;
    this.world.gravity.set(0, this.scenario === 'airborne' ? 0 : -this.params.gravity, 0);
    this.playerBody.mass = this.params.bodyMass;
    this.playerBody.updateMassProperties();
    for (const item of this.items) if (item.massScale) {
      item.body.mass = this.params.cubeMass * item.massScale;
      item.body.updateMassProperties();
      item.body.wakeUp();
    }
    for (const hand of this.hands) if (hand.grab?.constraint) this._configureConstraint(hand.grab.constraint);
  }

  setMode(id) {
    if (!MODES.some(mode => mode.id === id)) throw new Error(`Unknown grab mode: ${id}`);
    if (this.mode === id) return;
    for (const hand of this.hands) this._removeConstraint(hand);
    this.mode = id;
    if (id === 'joint') for (const hand of this.hands) if (hand.grab) this._createConstraint(hand);
  }

  /** Player contact is independent of the controller driving held objects. */
  setLocomotion(id) {
    if (!LOCOMOTION_MODES.some(mode => mode.id === id)) throw new Error(`Unknown locomotion mode: ${id}`);
    this.locomotion = id;
    this._history.length = 0;
    this._wasTouching = false;
    this._contactForce.setZero();
    this._contactCorrection.setZero();
    this._launchVelocity.setZero();
    for (const hand of this.hands) if (!hand.grab) {
      const shoulder = add(this.rigPosition, add(this.input.head.position, V(hand.index ? 0.18 : -0.18, -0.25, 0)));
      const anchored = id === 'off' ? hand.target : this._sweep(shoulder, sub(hand.target, shoulder), V(0.085, 0.085, 0.085)).position;
      hand.physical.copy(anchored);
      hand.contact = false;
    }
  }

  /** Selects a deterministic setup. It does not change manual/scripted input. */
  setScenario(id) {
    const scenario = SCENARIOS.find(s => s.id === id);
    if (!scenario) throw new Error(`Unknown scenario: ${id}`);
    this.scenario = id;
    this.workoutDuration = scenario.duration;
    this._spawn.set(0, id === 'airborne' ? 2 : 0, ['airborne', 'floor', 'shove'].includes(id) ? 3.8 : 1.4);
    this.world.gravity.set(0, id === 'airborne' ? 0 : -this.params.gravity, 0);
    this.playerBody.linearDamping = id === 'airborne' ? 0 : 0.4;
    this.reset();
  }

  _configureConstraint(constraint, dt = 1 / 180) {
    // Cannon caps each Cartesian equation separately. sqrt(3) times the entered
    // cap is therefore the possible vector magnitude; UI must not call this a
    // Euclidean force cap or a ConfigurableJoint maximumForce reproduction.
    for (const equation of constraint.equations) {
      // This Cannon release bounds the solver impulse lambda, despite naming
      // the field maxForce. multiplier = lambda / h; scale N to N·s here.
      equation.maxForce = this.params.maxForce * dt;
      equation.minForce = -this.params.maxForce * dt;
    }
  }

  _createConstraint(hand) {
    const grab = hand.grab;
    const constraint = new CANNON.PointToPointConstraint(this.playerBody, hand.localPosition, grab.item.body, grab.localAnchor, this.params.maxForce);
    constraint.collideConnected = false;
    this._configureConstraint(constraint);
    grab.constraint = constraint;
    this.world.addConstraint(constraint);
  }

  _removeConstraint(hand) {
    if (hand.grab?.constraint) {
      this.world.removeConstraint(hand.grab.constraint);
      hand.grab.constraint = null;
    }
  }

  _resetHandHistory(hand) {
    const input = this.input.hands[hand.index];
    hand.localPosition.copy(input.position);
    hand.previousLocal.copy(input.position);
    hand.previousQuaternion.copy(input.quaternion);
    hand.localVelocity.setZero();
    hand.localAcceleration.setZero();
    hand.angularVelocity.setZero();
    hand.trackedDelta.setZero();
  }

  release(index) {
    const hand = this.hands[index];
    if (!hand?.grab) return;
    const item = hand.grab.item;
    this._removeConstraint(hand);
    item.body.collisionFilterMask = WORLD | PLAYER | OBJECT;
    item.body.wakeUp();
    hand.grab = null;
    hand.heldId = null;
    hand.forceN = 0;
    hand.physical.copy(hand.target);
  }

  _tryGrab(hand) {
    let closest = null, distance = this.params.gripReach;
    for (const item of this.items) {
      if (!item.grabbable || this.hands.some(other => other !== hand && other.heldId === item.id)) continue;
      const local = item.body.pointToLocalFrame(hand.target);
      const half = mul(item.size, 0.5);
      const anchor = V(clamp(local.x, -half.x, half.x), clamp(local.y, -half.y, half.y), clamp(local.z, -half.z, half.z));
      const world = item.body.pointToWorldFrame(anchor);
      const d = length(sub(world, hand.target));
      if (d <= distance) { distance = d; closest = { item, anchor, world }; }
    }
    if (!closest) return false;
    const relativeRotation = hand.quaternion.conjugate().mult(closest.item.body.quaternion);
    hand.grab = { item: closest.item, localAnchor: closest.anchor, relativeRotation, constraint: null };
    hand.heldId = closest.item.id;
    hand.physical.copy(closest.world);
    hand.grab.item.body.collisionFilterMask = WORLD | OBJECT;
    hand.grab.item.body.wakeUp();
    if (this.mode === 'joint') this._createConstraint(hand);
    return true;
  }

  _sweep(start, movement, extent) {
    let position = start.clone(), remaining = movement.clone(), collided = false, recovered = false;
    const target = add(start, movement);
    // Query targets can begin inside a surface after changing contact mode.
    // Recover to its nearest expanded face before sweeping. This geometric
    // recovery is explicitly excluded from the launch-velocity history.
    for (let pass = 0; pass < 4; pass++) {
      let recovery = null;
      for (const item of this.staticBoxes) {
        const half = add(mul(item.size, 0.5), extent);
        const low = sub(item.body.position, half), high = add(item.body.position, half);
        if (!['x', 'y', 'z'].every(axis => position[axis] > low[axis] + 1e-6 && position[axis] < high[axis] - 1e-6)) continue;
        for (const axis of ['x', 'y', 'z']) for (const sign of [-1, 1]) {
          const distance = sign < 0 ? position[axis] - low[axis] : high[axis] - position[axis];
          if (!recovery || distance < recovery.distance) { const normal = V(); normal[axis] = sign; recovery = { normal, distance }; }
        }
      }
      if (!recovery) break;
      position = add(position, mul(recovery.normal, recovery.distance + 0.001));
      remaining = sub(target, position);
      collided = recovered = true;
    }
    for (let iteration = 0; iteration < 3 && length(remaining) > 1e-7; iteration++) {
      let hit = null;
      for (const item of this.staticBoxes) {
        const half = add(mul(item.size, 0.5), extent);
        const candidate = boxHit(position, remaining, sub(item.body.position, half), add(item.body.position, half));
        if (candidate && (!hit || candidate.t < hit.t)) hit = candidate;
      }
      if (!hit) { position = add(position, remaining); break; }
      collided = true;
      const advance = Math.max(0, hit.t - 0.001 / Math.max(length(remaining), 0.001));
      position = add(position, mul(remaining, advance));
      remaining = mul(remaining, 1 - advance);
      const into = remaining.dot(hit.normal);
      if (into < 0) remaining = sub(remaining, mul(hit.normal, into));
    }
    return { position, collided, recovered };
  }

  _moveOrigin(movement) {
    const start = this.playerBody.position;
    const center = add(start, V(0, 0.77, 0));
    const hull = this._sweep(center, movement, V(0.26, 0.77, 0.26));
    const allowed = sub(hull.position, center);
    const head = add(start, this.input.head.position);
    const headResult = this._sweep(head, allowed, V(0.13, 0.13, 0.13));
    const result = sub(headResult.position, head);
    this.playerBody.position.vadd(result, this.playerBody.position);
    this.playerBody.aabbNeedsUpdate = true;
    this.playerBody.wakeUp();
    return result;
  }

  /** Collision-constrained world-space displacement for keyboard locomotion. */
  move(displacement) {
    return this._moveOrigin(capped(xyz(displacement), 0.5));
  }

  /** Actual impulse in N·s, not a requested velocity change. */
  impulsePlayer(impulse = V(0, 150, 100)) {
    this.playerBody.applyImpulse(xyz(impulse));
  }

  /** Explicit recenter/teleport: no retained grips or differentiated jump. */
  teleport(position = this._spawn) {
    for (const hand of this.hands) this.release(hand.index);
    this.playerBody.position.copy(xyz(position, this._spawn));
    this.playerBody.previousPosition.copy(this.playerBody.position);
    this.playerBody.interpolatedPosition.copy(this.playerBody.position);
    this.playerBody.velocity.setZero();
    this.playerBody.angularVelocity.setZero();
    this.playerBody.force.setZero();
    this.playerBody.quaternion.set(0, 0, 0, 1);
    this.playerBody.aabbNeedsUpdate = true;
    this._history.length = 0;
    this._wasTouching = false;
    this._contactForce.setZero();
    this._contactCorrection.setZero();
    this._launchVelocity.setZero();
    this._previousHead.copy(add(this.rigPosition, this.input.head.position));
    for (const hand of this.hands) {
      this.input.hands[hand.index].velocity = null;
      this.input.hands[hand.index].angularVelocity = null;
      this._resetHandHistory(hand);
      hand.target.copy(add(this.rigPosition, this.input.hands[hand.index].position));
      hand.physical.copy(hand.target);
      hand.contact = false;
    }
  }

  reset() {
    this.time = 0;
    this._phase = 'Reach for the small cube';
    this.input.head.position.set(0, 1.65, 0);
    this.input.head.quaternion.set(0, 0, 0, 1);
    this.input.hands[0].position.set(-0.25, 1.2, -0.45);
    this.input.hands[1].position.set(0.25, 1.2, -0.45);
    for (const input of this.input.hands) { input.grip = false; input.quaternion.set(0, 0, 0, 1); }
    this.teleport(this._spawn);
    this._shoveDelivered = false;
    this._trialOrigin = this.playerBody.position.clone();
    this._newTrial();
    for (const item of this.items) if (!item.isStatic) {
      item.body.position.copy(item.initialPosition);
      item.body.quaternion.copy(item.initialQuaternion);
      item.body.previousPosition.copy(item.initialPosition);
      item.body.interpolatedPosition.copy(item.initialPosition);
      item.body.previousQuaternion.copy(item.initialQuaternion);
      item.body.interpolatedQuaternion.copy(item.initialQuaternion);
      item.body.velocity.setZero();
      item.body.angularVelocity.setZero();
      item.body.force.setZero();
      item.body.torque.setZero();
      item.body.aabbNeedsUpdate = true;
      item.body.wakeUp();
    }
    this.metrics.peakGapCm = 0;
    this._updateMetrics();
  }

  _newTrial() {
    this._trial = { samples: 0, heldSamples: 0, heldSeconds: 0, errorSquared: 0, peakGapCm: 0, peakSpeed: 0, peakForceN: 0, peakContactForceN: 0, contactSeconds: 0, limitedSeconds: 0, correctionDistanceM: 0, peakDriftM: 0, launches: 0, externalImpulseNs: 0, minDt: Infinity, maxDt: 0 };
  }

  /** Plain data for a saved comparison. No private project data or training. */
  exportTrial() {
    const t = this._trial;
    return {
      schema: 'tront-grab-lab-trial-v1',
      model: 'Cannon-es teaching model; massless hand query targets, upright player, static axis-aligned environment. Not PhysX or FireBlast source.',
      scenario: this.scenario, grabController: this.mode, locomotion: this.locomotion,
      repeatTrial: this.repeatTrial, parameters: { ...this.params },
      simulatedSeconds: this.time, samples: t.samples,
      physics: { solverSubsteps: 2, minimumHz: t.samples ? 1 / t.maxDt : null, maximumHz: t.samples ? 1 / t.minDt : null },
      summary: {
        rmsGapCm: t.heldSeconds ? Math.sqrt(t.errorSquared / t.heldSeconds) : 0,
        peakGapCm: t.peakGapCm, peakSpeed: t.peakSpeed, peakForceN: t.peakForceN, peakContactForceN: t.peakContactForceN,
        contactSeconds: t.contactSeconds, limitedSeconds: t.limitedSeconds,
        correctionDistanceM: t.correctionDistanceM, peakDriftM: t.peakDriftM,
        launches: t.launches, externalImpulseNs: t.externalImpulseNs,
      },
      player: { position: this.playerBody.position.toArray(), velocity: this.playerBody.velocity.toArray() },
      metrics: { ...this.metrics },
    };
  }

  _scenarioInput() {
    const t = this.time;
    const left = V(-0.3, 1.2, -0.45), right = V(0.3, 1.2, -0.45);
    if (this.scenario === 'airborne') {
      left.x -= 0.22 * Math.sin(t * 4); right.x += 0.22 * Math.sin(t * 4);
      left.y += 0.2 * Math.sin(t * 5); right.y -= 0.2 * Math.sin(t * 5);
      this._phase = 'Free-space arm sweep: no prop, gravity off';
    } else {
      const phase = (t % 1.8) / 1.8;
      const stroke = this.scenario === 'shove'
        ? (t < 1 ? smooth(t) : t < 6 ? 1 : 1 - smooth(t - 6))
        : (phase < 0.6 ? smooth(phase / 0.6) : 1 - smooth((phase - 0.6) / 0.4));
      left.y = right.y = 1.2 - 1.33 * stroke;
      left.z = right.z = -0.45 + 0.57 * stroke;
      this._phase = this.scenario === 'shove'
        ? (t < 2 ? 'Plant hands; sideways shove at 2 seconds' : t < 6 ? 'External shove: does existing velocity survive?' : 'Release and coast')
        : 'Two-hand floor strokes: compare contact architectures';
    }
    this.setInput({ head: { position: V(0, 1.65, 0) }, hands: [
      { position: left, quaternion: Q(), grip: false },
      { position: right, quaternion: Q(), grip: false },
    ] });
  }

  _scenarioEvents() {
    // This event also runs for recorded-input replay. It is not dependent on
    // render cadence or on the scripted pose generator being enabled.
    if (this.scenario === 'shove' && !this._shoveDelivered && this.time >= 2 - 1e-9) {
      this._shoveDelivered = true;
      this.impulsePlayer(V(90, 0, 0));
      this._trial.externalImpulseNs += 90;
    }
  }

  _scriptInput() {
    if (!['workout', 'wall'].includes(this.scenario)) { this._scenarioInput(); return; }
    const t = this.time;
    const restL = V(-0.25, 1.2, -0.45), restR = V(0.25, 1.2, -0.45);
    const reach = V(-0.45, 0.91, -0.85), lift = V(-0.45, 1.35, -0.65);
    let left = restL, right = restR, grip = false, angle = 0;
    if (t < 1.3) {
      // This first reach uses the actual cube position so a settling tabletop
      // cannot make the automatic demonstration mysteriously miss its grab.
      const cube = this.items.find(item => item.id === 'cube');
      const actual = cube ? sub(cube.body.position, this.rigPosition) : reach;
      left = lerp(restL, actual, smooth(t / 1.2));
      grip = t > 1.05;
      this._phase = 'Reach and grip';
    } else if (t < 3.2) {
      left = lerp(reach, lift, smooth((t - 1.3) / 1.9)); grip = true;
      this._phase = 'Lift: gravity and tracking error';
    } else if (t < 6) {
      left = add(lift, V(0.4 * Math.sin((t - 3.2) * 3.7), 0.06 * Math.sin((t - 3.2) * 5), 0));
      grip = true; angle = 0.8 * Math.sin((t - 3.2) * 3.7);
      this._phase = 'Reverse: damping and rotation';
    } else if (t < 8.5) {
      left = lerp(lift, V(-0.3, 1.25, -1.58), smooth((t - 6) / 1.2)); grip = true;
      this._phase = 'Press the wall: object reaction moves the rig';
    } else if (t < 10.5) {
      left = lerp(V(-0.3, 1.25, -1.58), lift, smooth((t - 8.5) / 1.3)); grip = true;
      this._phase = 'Recover while still holding';
    } else if (t < 12) {
      left = lerp(lift, restL, smooth((t - 10.5) / 1.5));
      this._phase = 'Release: the cube keeps its simulated velocity';
    } else if (t < 15.2 && this.scenario === 'workout') {
      const phase = ((t - 12) % 1.6) / 1.6;
      const down = phase < 0.55 ? smooth(phase / 0.55) : 1 - smooth((phase - 0.55) / 0.45);
      left = lerp(restL, V(-0.33, -0.13, 0.17), down);
      right = lerp(restR, V(0.33, -0.13, 0.17), down);
      this._phase = 'Floor push: two-hand correction is averaged';
    } else this._phase = this.repeatTrial ? 'Settle, then repeat the same trial' : 'Trial continues: released hands, no automatic reset';
    this.setInput({ head: { position: V(0, 1.65, 0) }, hands: [
      { position: left, quaternion: new CANNON.Quaternion().setFromEuler(0, 0, angle), grip },
      { position: right, quaternion: Q(), grip: false },
    ] });
  }

  _sampleHands(dt) {
    // Velocity feedforward is from tracking-origin-local motion plus current
    // player velocity. Differentiating the corrected world target would count
    // motor motion twice. Local acceleration feedforward is separately filtered.
    const velocityBlend = 1 - Math.exp(-2 * Math.PI * 16 * dt);
    const accelerationBlend = 1 - Math.exp(-2 * Math.PI * 7 * dt);
    for (const hand of this.hands) {
      const input = this.input.hands[hand.index];
      const shoulder = add(this.input.head.position, V(hand.index ? 0.18 : -0.18, -0.25, 0));
      const local = add(shoulder, capped(sub(input.position, shoulder), this.params.maxArmLength));
      const delta = sub(local, hand.previousLocal);
      if (length(delta) > 0.7) {
        this.release(hand.index);
        this._resetHandHistory(hand);
        hand.physical.copy(add(this.rigPosition, local));
        delta.setZero();
        this._trackingRecovery = true;
        input.velocity = null;
        input.angularVelocity = null;
      }
      const previousVelocity = hand.localVelocity.clone();
      const measuredVelocity = input.velocity ? input.velocity : mul(delta, 1 / dt);
      hand.localVelocity.copy(lerp(hand.localVelocity, capped(measuredVelocity, 12), velocityBlend));
      hand.localAcceleration.copy(lerp(hand.localAcceleration, capped(mul(sub(hand.localVelocity, previousVelocity), 1 / dt), 35), accelerationBlend));
      hand.localPosition.copy(local);
      hand.target.copy(add(this.rigPosition, local));
      hand.quaternion.copy(input.quaternion);
      const dq = hand.quaternion.mult(hand.previousQuaternion.conjugate());
      if (dq.w < 0) { dq.x *= -1; dq.y *= -1; dq.z *= -1; dq.w *= -1; }
      const sine = Math.hypot(dq.x, dq.y, dq.z);
      const angle = 2 * Math.atan2(sine, clamp(dq.w, -1, 1));
      const av = input.angularVelocity || (sine > 1e-7 ? mul(V(dq.x, dq.y, dq.z), angle / (sine * dt)) : V());
      hand.angularVelocity.copy(lerp(hand.angularVelocity, capped(av, 20), velocityBlend));
      hand.previousLocal.copy(local);
      hand.trackedDelta.copy(delta);
      hand.previousQuaternion.copy(hand.quaternion);
      hand.grip = input.grip;
      hand.contact = false;
      hand.forceN = 0;
      hand.limited = false;
      if (!hand.grip) this.release(hand.index);
      else if (!hand.grab) this._tryGrab(hand);
    }
    if (this._trackingRecovery) {
      this._history.length = 0;
      this._wasTouching = false;
      for (const hand of this.hands) {
        this.release(hand.index);
        this._resetHandHistory(hand);
        hand.trackedDelta.setZero();
      }
    }
  }

  _arcadeMotor(dt) {
    this._contactForce.setZero();
    this._contactCorrection.setZero();
    this._launchVelocity.setZero();
    if (this.locomotion === 'off' || this._trackingRecovery) {
      this._history.length = 0;
      this._wasTouching = false;
      for (const hand of this.hands) if (!hand.grab) hand.physical.copy(hand.target);
      return;
    }
    const corrections = [], deliberateStrokes = [], contactVelocities = [];
    for (const hand of this.hands) {
      if (hand.grab) continue;
      const result = this._sweep(hand.physical, sub(hand.target, hand.physical), V(0.085, 0.085, 0.085));
      hand.physical.copy(result.position);
      hand.contact = result.collided;
      if (hand.contact) {
        const correction = sub(result.position, hand.target);
        corrections.push(correction);
        contactVelocities.push(hand.localVelocity);
        // Separate intentional tracking displacement from depenetration,
        // gravity and rig motion. Only the intentional component can launch.
        const normal = length(correction) > 1e-7 ? mul(correction, 1 / length(correction)) : V();
        if (result.recovered) this._history.length = 0;
        deliberateStrokes.push(result.recovered ? V() : mul(normal, Math.max(0, -hand.trackedDelta.dot(normal))));
      }
    }
    const correction = averageHandCorrection(corrections);
    const touching = corrections.length > 0;
    if (this.locomotion === 'force') {
      if (touching) {
        const gains = pdGains(this.params.contactFrequency, this.params.contactDamping, dt, true);
        const velocityError = sub(mul(averageHandCorrection(contactVelocities), -1), this.playerBody.velocity);
        const acceleration = add(mul(correction, gains.kp), mul(velocityError, gains.kd));
        this._contactForce.copy(capped(mul(acceleration, this.playerBody.mass), this.params.maxContactForce));
      }
      this._history.length = 0;
      this._wasTouching = touching;
      return;
    }
    const applied = this._moveOrigin(capped(correction, 0.3));
    this._contactCorrection.copy(applied);
    if (touching) {
      if (!this.params.preserveExternal) this.playerBody.velocity.setZero();
      const fraction = length(correction) > 1e-7 ? clamp(length(applied) / length(correction), 0, 1) : 0;
      const velocity = mul(averageHandCorrection(deliberateStrokes), fraction / dt);
      this._history.push({ velocity, dt });
      let duration = this._history.reduce((n, sample) => n + sample.dt, 0);
      while (duration > 0.1 && this._history.length > 1) duration -= this._history.shift().dt;
    } else if (this._wasTouching) {
      const duration = this._history.reduce((n, sample) => n + sample.dt, 0);
      const integral = this._history.reduce((sum, sample) => add(sum, mul(sample.velocity, sample.dt)), V());
      const launch = duration > 0 ? capped(mul(integral, 1 / duration), 5) : V();
      if (length(launch) > 0.8) {
        if (this.params.preserveExternal) this.playerBody.velocity.vadd(launch, this.playerBody.velocity);
        else this.playerBody.velocity.copy(launch);
        this._launchVelocity.copy(launch);
        this._trial.launches++;
      }
      this._history.length = 0;
    }
    this._wasTouching = touching;
    for (const hand of this.hands) hand.target.copy(add(this.rigPosition, hand.localPosition));
  }

  _headSweep() {
    const target = add(this.rigPosition, this.input.head.position);
    const displacement = sub(target, this._previousHead);
    if (length(displacement) > 0.8) {
      // A tracking-origin reset is not a deliberate physical head strike.
      for (const hand of this.hands) { this.release(hand.index); this._resetHandHistory(hand); }
      this._previousHead.copy(target);
      this._trackingRecovery = true;
      return;
    }
    const result = this._sweep(this._previousHead, displacement, V(0.13, 0.13, 0.13));
    if (result.collided) this._moveOrigin(sub(result.position, target));
  }

  _driveHand(hand, dt) {
    const grab = hand.grab;
    if (!grab) return;
    const body = grab.item.body;
    if (grab.constraint) {
      grab.constraint.pivotA.copy(hand.localPosition);
      this._configureConstraint(grab.constraint, dt);
      return; // The solver applies reaction once. No parallel PD or angular motor.
    }
    const point = body.pointToWorldFrame(grab.localAnchor);
    const objectVelocity = body.getVelocityAtWorldPoint(point, V());
    const targetVelocity = add(this.playerBody.velocity, hand.localVelocity);
    const error = sub(hand.target, point);
    const relativeVelocity = sub(targetVelocity, objectVelocity);
    const backward = this.mode === 'backward';
    const velocityServo = this.mode === 'velocity';
    const gains = pdGains(this.params.frequency, this.params.damping, dt, backward);
    // Scalar reduced mass: rotational effective mass at an off-centre anchor is
    // not solved here. That is one real difference from the native constraint.
    const inverseMass = body.invMass + (this.mode === 'oneway' ? 0 : this.playerBody.invMass);
    const effectiveMass = inverseMass > 0 ? 1 / inverseMass : 0;
    if (velocityServo) {
      // Solve the 3x3 point-velocity response for a paired impulse. Off-centre
      // anchor inertia matters here; simply assigning the object's velocity
      // would erase existing momentum and omit the player reaction.
      const offset = sub(point, body.position);
      const axes = [V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)];
      const columns = axes.map(axis => add(mul(axis, inverseMass), body.invInertiaWorld.vmult(offset.cross(axis)).cross(offset)));
      const matrix = new CANNON.Mat3([
        columns[0].x, columns[1].x, columns[2].x,
        columns[0].y, columns[1].y, columns[2].y,
        columns[0].z, columns[1].z, columns[2].z,
      ]);
      const requested = matrix.solve(add(mul(error, 1 / dt), relativeVelocity));
      const impulse = capped(requested, this.params.maxForce * dt);
      if (body.type === CANNON.Body.DYNAMIC) body.applyImpulse(impulse, offset);
      this.playerBody.applyImpulse(mul(impulse, -1));
      hand.forceN = length(impulse) / dt;
      hand.limited = length(requested) > this.params.maxForce * dt;
    } else {
      let acceleration = add(mul(error, gains.kp), mul(relativeVelocity, gains.kd));
      if (backward && this.params.feedforward) acceleration = add(acceleration, mul(hand.localAcceleration, this.params.feedforward));
      const requested = mul(acceleration, effectiveMass);
      const force = capped(requested, this.params.maxForce);
      hand.forceN = length(force);
      hand.limited = length(requested) > this.params.maxForce;
      if (body.type === CANNON.Body.DYNAMIC) body.applyForce(force, sub(point, body.position));
      if (this.mode !== 'oneway') this.playerBody.applyForce(mul(force, -1));
    }
    if (body.type === CANNON.Body.DYNAMIC && this.params.maxTorque > 0) {
      const desired = hand.quaternion.mult(grab.relativeRotation);
      const errorQ = desired.mult(body.quaternion.conjugate());
      if (errorQ.w < 0) { errorQ.x *= -1; errorQ.y *= -1; errorQ.z *= -1; errorQ.w *= -1; }
      const sine = Math.hypot(errorQ.x, errorQ.y, errorQ.z);
      const angle = 2 * Math.atan2(sine, clamp(errorQ.w, -1, 1));
      const rotationError = sine > 1e-7 ? mul(V(errorQ.x, errorQ.y, errorQ.z), angle / sine) : V();
      const angular = pdGains(this.params.angularFrequency, this.params.damping, dt, backward);
      const alpha = velocityServo
        ? mul(add(mul(rotationError, 1 / dt), sub(hand.angularVelocity, body.angularVelocity)), 1 / dt)
        : add(mul(rotationError, angular.kp), mul(sub(hand.angularVelocity, body.angularVelocity), angular.kd));
      const localAlpha = body.quaternion.conjugate().vmult(alpha);
      const torque = body.quaternion.vmult(V(localAlpha.x * body.inertia.x, localAlpha.y * body.inertia.y, localAlpha.z * body.inertia.z));
      body.torque.vadd(capped(torque, this.params.maxTorque), body.torque);
    }
  }

  _updateMetrics() {
    let gap = 0, held = 0, force = 0, contacts = 0, limited = false, squareGap = 0, largestGap = 0;
    for (const hand of this.hands) {
      hand.target.copy(add(this.rigPosition, hand.localPosition));
      if (hand.grab) {
        const body = hand.grab.item.body;
        body.pointToWorldFrame(hand.grab.localAnchor, hand.physical);
        const handGap = length(sub(hand.target, hand.physical)) * 100;
        gap += handGap;
        squareGap += handGap * handGap;
        largestGap = Math.max(largestGap, handGap);
        held++;
        hand.contact = hand.grab.item.isStatic || this.world.contacts.some(contact => (contact.bi === body && contact.bj.mass === 0) || (contact.bj === body && contact.bi.mass === 0));
        if (hand.grab.constraint) {
          hand.forceN = Math.hypot(...hand.grab.constraint.equations.map(equation => equation.multiplier));
          hand.limited = hand.grab.constraint.equations.some(equation => Math.abs(equation.multiplier) >= this.params.maxForce * 0.995);
        }
      } else if (!hand.contact) {
        hand.physical.copy(hand.target);
      }
      force += hand.forceN;
      if (hand.contact) contacts++;
      limited ||= hand.limited;
    }
    this.metrics.gapCm = held ? gap / held : 0;
    this.metrics.peakGapCm = Math.max(this.metrics.peakGapCm, largestGap);
    this.metrics.rmsHandGapCm = held ? Math.sqrt(squareGap / held) : 0;
    this.metrics.forceN = force;
    this.metrics.speed = length(this.playerBody.velocity);
    this.metrics.contacts = contacts;
    this.metrics.heldCount = held;
    this.metrics.limited = limited;
    this.metrics.time = this.time;
    this.metrics.workoutPhase = this.scripted ? this._phase : 'Manual tracking';
    this.metrics.grounded = this.world.contacts.some(c => (c.bi === this.playerBody || c.bj === this.playerBody) && Math.abs(c.ni.y) > 0.65);
    this.metrics.playerDriftM = length(sub(this.rigPosition, this._trialOrigin));
    this.metrics.contactCorrectionM = length(this._contactCorrection);
    this.metrics.contactForceN = length(this._contactForce);
    this.metrics.launchSpeed = length(this._launchVelocity);
  }

  step(dt = 1 / 90) {
    dt = clamp(finite(dt, 1 / 90), 1 / 240, 1 / 30);
    if (this.scripted && this.roomEnabled) {
      if (this.repeatTrial && this.time >= this.workoutDuration) { this.cycle++; this.reset(); }
      this._scriptInput();
    }
    this._trackingRecovery = false;
    this._scenarioEvents();
    this._headSweep();
    this.playerBody.shapeOffsets[2].copy(this.input.head.position);
    this.playerBody.aabbNeedsUpdate = true;
    this._sampleHands(dt);
    this._arcadeMotor(dt);
    // Two solver substeps reduce discrete collision tunnelling; this is not CCD.
    // Feedback uses the actual substep duration, not the display frame interval.
    const h = dt * 0.5;
    for (let substep = 0; substep < 2; substep++) {
      if (this.locomotion === 'force') this.playerBody.applyForce(this._contactForce);
      for (const hand of this.hands) {
        hand.target.copy(add(this.rigPosition, hand.localPosition));
        this._driveHand(hand, h);
      }
      this.world.step(h);
    }
    this.time += dt;
    this.elapsed += dt;
    this._previousHead.copy(add(this.rigPosition, this.input.head.position));
    this._updateMetrics();
    const m = this.metrics, t = this._trial;
    t.samples++;
    t.minDt = Math.min(t.minDt, dt); t.maxDt = Math.max(t.maxDt, dt);
    if (m.heldCount) { t.heldSamples += m.heldCount; t.heldSeconds += m.heldCount * dt; t.errorSquared += m.rmsHandGapCm * m.rmsHandGapCm * m.heldCount * dt; }
    t.peakGapCm = Math.max(t.peakGapCm, m.peakGapCm);
    t.peakSpeed = Math.max(t.peakSpeed, m.speed);
    t.peakForceN = Math.max(t.peakForceN, m.forceN);
    t.peakContactForceN = Math.max(t.peakContactForceN, m.contactForceN);
    t.peakDriftM = Math.max(t.peakDriftM, m.playerDriftM);
    if (m.contacts) t.contactSeconds += dt;
    if (m.limited) t.limitedSeconds += dt;
    t.correctionDistanceM += m.contactCorrectionM;
    return this.metrics;
  }

  dispose() {
    for (const hand of this.hands) this.release(hand.index);
    for (const body of [...this.world.bodies]) this.world.removeBody(body);
  }
}

export { CANNON };
