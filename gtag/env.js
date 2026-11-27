/*
 * One interface for a human, the scripted expert, and any future learned policy.
 * No reward, no policy, no trainer: this is the boundary, like GrabEnvironment in vr/.
 *
 * Action (8 numbers, each clamped to [-1, 1]):
 *   [0..2] left hand target, [3] left grip (> 0 grips), [4..6] right hand target, [7] right grip.
 *   A target is a head-relative offset in the rig frame: metres = value * maxArmLength,
 *   then clamped to maxArmLength like the Unity original.
 * Observation: see OBSERVATION_SCHEMA. World frame, metres and seconds, +Y up, -Z forward.
 */
import { GorillaPlayer, Cube, vec, vadd, vsub, vlen, sweepBoxes, yawRotate } from './gorilla.js';
import { stageById, REST_OFFSET } from './stages.js';

export const ENV_FORMAT = 'tront-gtag-environment-v1';
export const ACTION_SCHEMA = Object.freeze([
  'left.x', 'left.y', 'left.z', 'left.grip', 'right.x', 'right.y', 'right.z', 'right.grip',
]);
export const OBSERVATION_SCHEMA = Object.freeze([
  'vel.x', 'vel.y', 'vel.z', 'grounded', 'head.y',
  'leftHand.x', 'leftHand.y', 'leftHand.z', 'rightHand.x', 'rightHand.y', 'rightHand.z',
  'leftTouching', 'rightTouching', 'leftHolding', 'rightHolding',
  'goal.x', 'goal.y', 'goal.z',
  'cube.x', 'cube.y', 'cube.z',
  'ahead.dist', 'ahead.top', 'gap.dist', 'timeFraction',
  'leftHand.vz', 'rightHand.vz',
]);

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export class GtagEnvironment {
  constructor(options = {}) {
    this.hz = options.hz ?? 90;
    this.options = options;
    this.reset(options.stage ?? 'slap');
  }

  reset(stageId = this.stage?.id) {
    this.stage = stageById(stageId);
    const s = this.stage;
    const boxes = s.boxes.map(b => ({ id: b.id, center: vec(b.center.x, b.center.y, b.center.z), half: vec(b.half.x, b.half.y, b.half.z), tag: b.tag }));
    const cubes = s.cubes.map(c => new Cube(c.id, c.position, c.size, c.mass));
    this.player = new GorillaPlayer({ ...(this.options.params || {}), boxes, cubes, position: vec(s.spawn.x, s.spawn.y + REST_OFFSET, s.spawn.z) });
    this.boxes = boxes;
    this.cubes = cubes;
    this.steps = 0;
    this.terminated = false;
    this.truncated = false;
    this.success = false;
    this.maxSteps = Math.round(s.timeLimit * this.hz);
    // Let the body settle so every run starts from the same resting state.
    const dt = 1 / this.hz;
    this.player.setHands(vec(-0.25, 1.65 - 0.5, -0.45), vec(0.25, 1.65 - 0.5, -0.45), false, false);
    for (let i = 0; i < this.hz; i++) this.player.step(dt);
    this.player.stats = { launches: 0, touchSeconds: 0 };
    this.player.time = 0;
    this.stats = { falls: 0, grips: 0 };
    return this.observe();
  }

  /** Apply one 8-number action, advance one fixed step, return { observation, terminated, truncated, info }. */
  step(action) {
    const p = this.player;
    const a = action.map(v => clamp(Number.isFinite(v) ? v : 0, -1, 1));
    const arm = p.p.maxArmLength;
    const rel = i => vec(a[i] * arm, a[i + 1] * arm, a[i + 2] * arm);
    const toLocal = r => vadd(vec(0, p.p.headHeight, 0), r);
    p.setHands(toLocal(rel(0)), toLocal(rel(4)), a[3] > 0, a[7] > 0);
    p.step(1 / this.hz);
    this.steps++;
    if (!this.terminated && !this.truncated) this._judge();
    return { observation: this.observe(), terminated: this.terminated, truncated: this.truncated, reward: null, info: this.info() };
  }

  _judge() {
    const g = this.stage.goal, p = this.player;
    const head = p.head();
    const dx = head.x - g.center.x, dz = head.z - g.center.z;
    const standingOn = p.grounded && Math.abs(head.y - (g.center.y + 1.0 + 0.45)) < 0.6;
    const atGoal = Math.hypot(dx, dz) < g.radius && (g.center.y === 0 ? head.y < 2.2 : standingOn || head.y > g.center.y + 1.0);
    let cubesOk = true;
    if (g.requireCubes) {
      cubesOk = this.cubes.every(c => c.heldBy < 0 && c.resting && Math.hypot(c.position.x - g.center.x, c.position.z - g.center.z) < g.radius);
    }
    const reached = g.requireCubes ? cubesOk : atGoal && p.grounded;
    if (reached && (g.requireCubes ? true : true)) { this.terminated = true; this.success = true; }
    else if (head.y < -6) { this.terminated = true; this.stats.falls++; }
    else if (this.steps >= this.maxSteps) this.truncated = true;
  }

  info() {
    return { stage: this.stage.id, success: this.success, time: this.steps / this.hz, launches: this.player.stats.launches, falls: this.stats.falls };
  }

  /** Forward probe at body height: distance to the first box face ahead and its top, relative to the head. */
  _ahead() {
    const p = this.player, head = p.head();
    const start = vsub(head, vec(0, 0.4, 0));
    const hit = sweepBoxes(start, yawRotate(vec(0, 0, -4), p.yaw), vec(0.2, 0.3, 0.2), this.boxes);
    if (!hit) return [4, 0];
    return [hit.t * 4, hit.box.center.y + hit.box.half.y - head.y];
  }

  /** Distance forward to the first point where the ground drops away below knee height. */
  _gap() {
    const p = this.player, head = p.head();
    for (let d = 0.5; d <= 3; d += 0.25) {
      const probe = vadd(head, yawRotate(vec(0, -1.3, -d), p.yaw));
      const down = sweepBoxes(probe, vec(0, -0.5, 0), vec(0.05, 0.05, 0.05), this.boxes);
      if (!down) return d;
    }
    return 3;
  }

  observe() {
    const p = this.player, head = p.head(), g = this.stage.goal;
    const hand = h => vsub(p.hands[h].last, head);
    const lh = hand(0), rh = hand(1);
    const goal = vsub(vec(g.center.x, g.center.y, g.center.z), head);
    let cube = vec();
    let nearest = Infinity;
    for (const c of this.cubes) {
      const onPad = Math.hypot(c.position.x - g.center.x, c.position.z - g.center.z) < g.radius && c.heldBy < 0;
      if (c.heldBy >= 0 || onPad) continue;
      const d = vlen(vsub(c.position, head));
      if (d < nearest) { nearest = d; cube = vsub(c.position, head); }
    }
    const [aheadDist, aheadTop] = this._ahead();
    return [
      p.velocity.x, p.velocity.y, p.velocity.z, p.grounded ? 1 : 0, head.y,
      lh.x, lh.y, lh.z, rh.x, rh.y, rh.z,
      p.hands[0].wasTouching ? 1 : 0, p.hands[1].wasTouching ? 1 : 0, p.hands[0].held ? 1 : 0, p.hands[1].held ? 1 : 0,
      goal.x, goal.y, goal.z, cube.x, cube.y, cube.z,
      aheadDist, aheadTop, this._gap(), this.steps / this.maxSteps,
      p.hands[0].velocity.z, p.hands[1].velocity.z,
    ];
  }
}

/** Plain-language names for the observation vector, for expert/UI readouts. */
export function describe(observation) {
  const out = {};
  OBSERVATION_SCHEMA.forEach((k, i) => { out[k] = observation[i]; });
  return out;
}
