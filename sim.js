/**
 * Physics Gym's small translational comparison model.
 * Accelerations are in m/s²; gains are mass-normalized. Contacts are plane
 * projections with an impulse-limited Coulomb friction approximation.
 * This is not PhysX, Rapier, full articulated dynamics, or paper-SPD.
 */
export const CONTROLLERS = [
  { id: 'spring', short: 'Spring', name: 'Spring only', color: '#fb7185', description: 'Position error creates a restoring acceleration. With no velocity damping, energy carries the hand past its target.', formula: 'a = Kp · e', tip: 'The bouncy baseline. Watch it after an impulse, then compare with velocity PD.' },
  { id: 'pd-zero', short: 'PD zero', name: 'PD · absolute velocity', color: '#fb923c', description: 'A spring pulls toward the tracked hand while damping resists all physical-hand movement, including intended motion.', formula: 'a = Kp · e − Kd · v', tip: 'Raise damping in Air tracking. The hand can become smooth but fall farther behind the moving target.' },
  { id: 'pd-velocity', short: 'PD velocity', name: 'PD · target velocity', color: '#facc15', description: 'Damps the difference between tracked and physical velocity. Matching the target velocity avoids braking all intentional movement.', formula: 'a = Kp · e + Kd · Δv', tip: 'Compare with PD zero at the same gains. The velocity target is part of the reference, not an integral term.' },
  { id: 'backward', short: 'Backward PD', name: 'Stable backward PD', color: '#60a5fa', description: 'Uses timestep-adjusted gains from the backward PD formulation. The implicit update is robust for the ideal linear model; contacts and force limits still change the response.', formula: 'a = [Kp · e + (Kd + Kp · dt) · Δv] / [1 + Kd · dt + Kp · dt²]', tip: 'A useful baseline for strong tracking. Very stiff implicit drives can still look damped because the timestep shapes their response.' },
  { id: 'spd', short: 'SPD V2', name: 'Digital Opus · SPD V2', color: '#c084fc', description: 'The Part II sample predicts the target and hand positions using their current velocities. This explicit lookahead variant is distinct from the full implicit SPD paper method.', formula: 'a = Kp · (e + dt · Δv) + Kd · Δv', tip: 'Prediction adds braking, but does not make arbitrary gains safe. Compare it with backward PD at high stiffness or a low tick rate.' },
  { id: 'feedforward', short: 'SPD + FF', name: 'SPD V2 + acceleration', color: '#4ade80', description: 'Adds the scripted target acceleration to SPD V2. The extra force can reduce lag when the input accelerates, but also reacts to tracking noise.', formula: 'a = SPD V2 + FF · aTarget', tip: 'Try Rapid reversal. The target acceleration here is known analytically; real tracked acceleration would need careful estimation.' },
  { id: 'adaptive', short: 'Adaptive PD', name: 'Adaptive backward PD', color: '#22d3ee', description: 'Lowers damping when the hand is far from its target, restoring the near-target value within the braking radius. Uses the backward PD update.', formula: 'Kd′ = Kd · lerp(1, far, smoothstep(|e| / radius))', tip: 'Distance alone does not tell you stopping distance. A fast hand may still overshoot before its higher damping engages.' },
  { id: 'contact', short: 'Contact PD', name: 'Contact-adaptive backward PD', color: '#f472b6', description: 'Changes stiffness after the preceding step detected contact. Damping scales with the square root of stiffness to preserve the nominal damping ratio.', formula: 'contact: Kp′ = Kp · scale; Kd′ = Kd · √scale', tip: 'Compare free-air motion with floor or wall pressure. Gain changes are applied on the next simulation step.' }
];

export const EXERCISES = [
  { id: 'floor', name: 'Floor push', description: 'Synchronized downward strokes reach through the floor. Compare lift, bounce, and recovery after each push.' },
  { id: 'wall', name: 'Wall shove', description: 'Both hands extend into the wall and push the body backward. Start within 1.6 m to reach the wall.' },
  { id: 'climb', name: 'Climb wall', description: 'Alternating downward strokes press against the wall. Friction can lift the body; this test has no artificial sticky grip.' },
  { id: 'air', name: 'Air tracking', description: 'The bodies are held still while both hands trace smooth paths. Isolate tracking lag and overshoot without locomotion.' },
  { id: 'rapid', name: 'Rapid reversal', description: 'The bodies are held still during fast direction changes. Compare velocity tracking, force limits, and acceleration feedforward.' },
  { id: 'pressure', name: 'Wall pressure', description: 'Both targets hold a reach beyond the wall. Lock bodies to isolate sustained obstruction; otherwise they can push away.' },
  { id: 'ceiling', name: 'Ceiling push', description: 'Upward reaches meet a low ceiling. Watch contact error and the downward reaction on the body.' }
];

export const DEFAULTS = Object.freeze({
  frequency: 8, damping: 1, bodyMass: 75, handMass: 3,
  maxAccel: 350, feedforward: 1, adaptiveRadius: 0.25, farDamping: 0.2,
  friction: 1.2, hz: 90, contactStiffness: 1.5, inputSpeed: 1,
  startDistance: 1.1, trackingNoise: false, lockBodies: false
});

export const PRESETS = [
  { name: 'Balanced', params: { ...DEFAULTS } },
  { name: 'Boing boing', params: { ...DEFAULTS, frequency: 8, damping: 0.12 } },
  { name: 'Stiff & damped', params: { ...DEFAULTS, frequency: 18, damping: 1, maxAccel: 650 } },
  { name: 'Heavy player', params: { ...DEFAULTS, bodyMass: 120, frequency: 10, damping: 1, maxAccel: 500 } }
];

const WALL = 1.5, CEILING = 2.15, HAND_RADIUS = 0.105;
// Drills that touch the wall start within reach of it. The rest start in the middle of the lane.
export const WALL_DRILLS = Object.freeze(['wall', 'climb', 'pressure']);
const LANE_MIDDLE = -1.25;
const AXES = ['x', 'y', 'z'];
const LIMITS = {
  frequency: [0.5, 30], damping: [0, 3], bodyMass: [20, 150], handMass: [0.5, 12],
  maxAccel: [10, 1000], feedforward: [0, 2], adaptiveRadius: [0.02, 0.8],
  farDamping: [0, 1], friction: [0, 2], hz: [30, 240],
  contactStiffness: [0.1, 3], inputSpeed: [0, 3], startDistance: [0.4, 3]
};
const vec = (x = 0, y = 0, z = 0) => ({ x, y, z });
const copy = (out, a) => { out.x = a.x; out.y = a.y; out.z = a.z; return out; };
const magnitude = a => Math.hypot(a.x, a.y, a.z);
const input = () => ({ p: vec(), v: vec(), a: vec() });
function capVector(v, limit) {
  const size = magnitude(v);
  if (size > limit) { const scale = limit / size; v.x *= scale; v.y *= scale; v.z *= scale; }
}
function sanitize(patch, previous) {
  const result = { ...previous };
  for (const [key, [min, max]] of Object.entries(LIMITS)) {
    if (!(key in patch)) continue;
    const value = typeof patch[key] === 'number' ? patch[key] : Number(patch[key]);
    if (Number.isFinite(value)) result[key] = Math.max(min, Math.min(max, value));
  }
  for (const key of ['trackingNoise', 'lockBodies']) {
    if (typeof patch[key] === 'boolean') result[key] = patch[key];
  }
  return result;
}

// Analytic derivatives keep input velocity and acceleration consistent with its
// position and avoid finite-difference spikes at the old clipped-sine corners.
function harmonic(out, axis, center, amplitude, omega, time, phase = 0, cosine = false) {
  const angle = omega * time + phase;
  const wave = cosine ? Math.cos(angle) : Math.sin(angle);
  out.p[axis] = center + amplitude * wave;
  out.v[axis] = amplitude * omega * (cosine ? -Math.sin(angle) : Math.cos(angle));
  out.a[axis] = -amplitude * omega * omega * wave;
}
function sampleInput(out, hand, t, params, exercise) {
  const side = hand ? 1 : -1, phase = hand * Math.PI;
  const speed = params.inputSpeed;
  out.p.x = side * 0.43; out.p.y = 0.2; out.p.z = 0.35;
  out.v.x = out.v.y = out.v.z = out.a.x = out.a.y = out.a.z = 0;
  switch (exercise) {
    case 'floor':
      harmonic(out, 'y', -0.9, 0.5, 3.3 * speed, t, 0, true);
      harmonic(out, 'z', 0.35, 0.12, 3.3 * speed, t);
      break;
    case 'wall':
      out.p.y = 0.23;
      harmonic(out, 'z', 1.03, -0.65, 2.5 * speed, t, 0, true);
      break;
    case 'climb':
      harmonic(out, 'y', 0.2, 0.58, 3 * speed, t, phase);
      harmonic(out, 'z', 1.12, 0.12, 3 * speed, t, phase, true);
      break;
    case 'air':
      harmonic(out, 'x', side * 0.48, side * 0.1, 3 * speed, t, phase);
      harmonic(out, 'y', 0.25, 0.28, 3 * speed, t, phase);
      harmonic(out, 'z', 0.4, 0.22, 3 * speed, t, phase, true);
      break;
    case 'rapid':
      out.p.x = side * 0.5;
      harmonic(out, 'y', 0.2, 0.4, 9 * speed, t, phase);
      harmonic(out, 'z', 0.35, 0.43, 11 * speed, t, phase);
      break;
    case 'pressure':
      out.p.y = 0.2; out.p.z = 1.4;
      break;
    case 'ceiling':
      harmonic(out, 'y', 1.075, -0.475, 3 * speed, t, 0, true);
      out.p.z = 0.15;
      break;
  }
  if (params.trackingNoise) {
    // One reproducible signal is used by every lane, including its derivatives.
    for (let axis = 0; axis < 3; axis++) {
      const key = AXES[axis], amplitude = axis === 1 ? 0.003 : 0.004;
      const omega = 2 * Math.PI * (12 + axis * 3), angle = omega * t + hand * 0.7;
      out.p[key] += amplitude * Math.sin(angle);
      out.v[key] += amplitude * omega * Math.cos(angle);
      out.a[key] -= amplitude * omega * omega * Math.sin(angle);
    }
  }
  return out;
}

function makeHand() {
  return { position: vec(), previous: vec(), target: vec(), prevTarget: vec(), velocity: vec(), accel: vec(), contact: false };
}
function makePlayer(index) {
  return {
    id: CONTROLLERS[index].id, body: vec(), prevBody: vec(), velocity: vec(), hands: [makeHand(), makeHand()],
    stats: { error: 0, rms: 0, peak: 0, speed: 0, force: 0, contacts: 0, freeRms: 0, peakHeight: 0.88, limited: false },
    history: [], _sum: 0, _samples: 0, _freeSum: 0, _freeSamples: 0
  };
}

function contactPlane(hand, axis, bound, sign, friction) {
  if ((hand.position[axis] - bound) * sign <= 0) return;
  hand.position[axis] = bound;
  const normalSpeed = Math.max(0, hand.velocity[axis] * sign);
  hand.velocity[axis] -= normalSpeed * sign;
  const v = hand.velocity;
  const tangentSpeed = axis === 'y' ? Math.hypot(v.x, v.z) : Math.hypot(v.x, v.y);
  const scale = tangentSpeed > 0 ? Math.max(0, 1 - friction * normalSpeed / tangentSpeed) : 1;
  if (axis !== 'x') v.x *= scale;
  if (axis !== 'y') v.y *= scale;
  if (axis !== 'z') v.z *= scale;
  hand.contact = true;
}

export class GymSimulation {
  constructor(params = {}) {
    this.params = sanitize(params, DEFAULTS);
    this.exercise = 'floor';
    this.time = 0;
    this.players = CONTROLLERS.map((_, index) => makePlayer(index));
    this._inputs = [input(), input()];
    this._endInputs = [input(), input()];
    this._recordAt = 1 / 30;
    this.reset();
  }

  get bodiesLocked() { return this.params.lockBodies || this.exercise === 'air' || this.exercise === 'rapid'; }

  setParams(patch, reset = true) {
    Object.assign(this.params, sanitize(patch, this.params));
    if (reset) this.reset();
  }

  setExercise(id) {
    if (!EXERCISES.some(exercise => exercise.id === id)) return;
    this.exercise = id;
    this.reset();
  }

  /** Where every body stands at the start of a trial, along the lane. */
  startZ() { return WALL_DRILLS.includes(this.exercise) ? WALL - this.params.startDistance : LANE_MIDDLE; }

  reset() {
    this.time = 0; this._recordAt = 1 / 30;
    this._sample(0, this._inputs);
    for (const player of this.players) {
      player.body.x = 0; player.body.y = 0.88; player.body.z = this.startZ();
      copy(player.prevBody, player.body);
      player.velocity.x = player.velocity.y = player.velocity.z = 0;
      for (let i = 0; i < 2; i++) {
        const hand = player.hands[i], tracked = this._inputs[i].p;
        for (const axis of AXES) hand.target[axis] = player.body[axis] + tracked[axis];
        copy(hand.position, hand.target);
        hand.position.y = Math.max(HAND_RADIUS, hand.position.y);
        if (this.exercise === 'ceiling') hand.position.y = Math.min(CEILING - HAND_RADIUS, hand.position.y);
        hand.position.z = Math.min(WALL - HAND_RADIUS, hand.position.z);
        copy(hand.previous, hand.position); copy(hand.prevTarget, hand.target);
        hand.velocity.x = hand.velocity.y = hand.velocity.z = 0;
        hand.accel.x = hand.accel.y = hand.accel.z = 0; hand.contact = false;
      }
      Object.assign(player.stats, { error: 0, rms: 0, peak: 0, speed: 0, force: 0, contacts: 0, freeRms: 0, peakHeight: 0.88, limited: false });
      player.history.length = 0;
      player._sum = player._samples = player._freeSum = player._freeSamples = 0;
    }
  }

  impulse(kind = 'kick') {
    const y = kind === 'back' ? 0 : 1.5, z = kind === 'back' ? -1.5 : -2;
    for (const player of this.players) {
      if (!this.bodiesLocked) { player.velocity.y += y; player.velocity.z += z; }
      for (const hand of player.hands) { hand.velocity.y += y; hand.velocity.z += z; }
    }
  }

  _sample(t, output) {
    sampleInput(output[0], 0, t, this.params, this.exercise);
    sampleInput(output[1], 1, t, this.params, this.exercise);
  }

  step(dt) {
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.1) return;
    const p = this.params, k = (2 * Math.PI * p.frequency) ** 2, d = 2 * p.damping * Math.sqrt(k);
    const nextTime = this.time + dt;
    this._sample(this.time, this._inputs);
    this._sample(nextTime, this._endInputs);
    const locked = this.bodiesLocked;
    const record = nextTime + 1e-9 >= this._recordAt;
    for (let mode = 0; mode < this.players.length; mode++) {
      const player = this.players[mode], stats = player.stats;
      let rx = 0, ry = 0, rz = 0;
      copy(player.prevBody, player.body);
      stats.contacts = stats.force = stats.error = 0; stats.limited = false;
      for (let i = 0; i < 2; i++) {
        const hand = player.hands[i], reference = this._inputs[i];
        copy(hand.previous, hand.position); copy(hand.prevTarget, hand.target);
        const ex = player.body.x + reference.p.x - hand.position.x;
        const ey = player.body.y + reference.p.y - hand.position.y;
        const ez = player.body.z + reference.p.z - hand.position.z;
        const dx = player.velocity.x + reference.v.x - hand.velocity.x;
        const dy = player.velocity.y + reference.v.y - hand.velocity.y;
        const dz = player.velocity.z + reference.v.z - hand.velocity.z;
        let kk = k, dd = d;
        if (mode === 6) {
          const fraction = Math.min(1, Math.hypot(ex, ey, ez) / p.adaptiveRadius);
          dd *= 1 + (p.farDamping - 1) * fraction * fraction * (3 - 2 * fraction);
        }
        if (mode === 7 && hand.contact) { kk *= p.contactStiffness; dd *= Math.sqrt(p.contactStiffness); }
        const a = hand.accel;
        a.x = kk * ex; a.y = kk * ey; a.z = kk * ez;
        if (mode === 1) {
          a.x -= dd * hand.velocity.x; a.y -= dd * hand.velocity.y; a.z -= dd * hand.velocity.z;
        } else if (mode === 2) {
          a.x += dd * dx; a.y += dd * dy; a.z += dd * dz;
        } else if (mode >= 3) {
          const velocityGain = dd + kk * dt;
          a.x += velocityGain * dx; a.y += velocityGain * dy; a.z += velocityGain * dz;
          if (mode === 3 || mode === 6 || mode === 7) {
            const g = 1 / (1 + dd * dt + kk * dt * dt);
            a.x *= g; a.y *= g; a.z *= g;
          }
          if (mode === 5) {
            a.x += p.feedforward * reference.a.x;
            a.y += p.feedforward * reference.a.y;
            a.z += p.feedforward * reference.a.z;
          }
        }
        if (magnitude(a) > p.maxAccel) stats.limited = true;
        capVector(a, p.maxAccel);
        for (const axis of AXES) {
          hand.velocity[axis] += a[axis] * dt;
          hand.position[axis] += hand.velocity[axis] * dt;
        }
        hand.contact = false;
        contactPlane(hand, 'y', HAND_RADIUS, -1, p.friction);
        contactPlane(hand, 'z', WALL - HAND_RADIUS, 1, p.friction);
        if (this.exercise === 'ceiling') contactPlane(hand, 'y', CEILING - HAND_RADIUS, 1, p.friction);
        if (hand.contact) stats.contacts++;
        rx -= a.x * p.handMass / p.bodyMass;
        ry -= a.y * p.handMass / p.bodyMass;
        rz -= a.z * p.handMass / p.bodyMass;
        stats.force += magnitude(a) * p.handMass;
      }
      if (!locked) {
        player.velocity.x += rx * dt;
        player.velocity.y += (ry - 9.81) * dt;
        player.velocity.z += rz * dt;
        for (const axis of AXES) player.body[axis] += player.velocity[axis] * dt;
        if (player.body.y < 0.85) {
          player.body.y = 0.85;
          player.velocity.y = Math.max(0, player.velocity.y);
          player.velocity.x *= Math.exp(-2 * dt); player.velocity.z *= Math.exp(-2 * dt);
        }
        if (player.body.z > WALL - 0.32) { player.body.z = WALL - 0.32; player.velocity.z = Math.min(0, player.velocity.z); }
        if (player.body.z < -6) { player.body.z = -6; player.velocity.z = Math.max(0, player.velocity.z); }
        const top = this.exercise === 'ceiling' ? CEILING - 0.85 : 3.8;
        if (player.body.y > top) { player.body.y = top; player.velocity.y = Math.min(0, player.velocity.y); }
        if (Math.abs(player.body.x) > 0.65) {
          player.body.x = Math.sign(player.body.x) * 0.65;
          player.velocity.x = 0;
        }
      } else {
        player.velocity.x = player.velocity.y = player.velocity.z = 0;
      }
      // Compare post-step physical positions with the post-step reference.
      // Keeping these timestamps equal matters especially for moving targets.
      for (let i = 0; i < 2; i++) {
        const hand = player.hands[i], reference = this._endInputs[i].p;
        for (const axis of AXES) hand.target[axis] = player.body[axis] + reference[axis];
        const error = Math.hypot(hand.target.x - hand.position.x, hand.target.y - hand.position.y, hand.target.z - hand.position.z);
        stats.error += error * 0.5;
        player._sum += error * error; player._samples++;
        stats.peak = Math.max(stats.peak, error);
        if (!hand.contact) { player._freeSum += error * error; player._freeSamples++; }
      }
      stats.rms = Math.sqrt(player._sum / player._samples);
      stats.freeRms = player._freeSamples ? Math.sqrt(player._freeSum / player._freeSamples) : 0;
      stats.speed = magnitude(player.velocity);
      stats.peakHeight = Math.max(stats.peakHeight, player.body.y);
      if (record) {
        player.history.push([nextTime, stats.error, stats.speed, stats.force]);
        if (player.history.length > 360) player.history.shift();
        while (player.history.length && player.history[0][0] < nextTime - 12) player.history.shift();
      }
    }
    this.time = nextTime;
    if (record) while (this._recordAt <= nextTime + 1e-9) this._recordAt += 1 / 30;
  }
}
