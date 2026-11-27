/*
 * The learning task: stage 1 of the Gorilla course as a reinforcement-learning problem.
 * It wraps GtagEnvironment (the same 8-action / 27-observation interface the scripted
 * player uses) and adds what a learner needs and the environment deliberately omits:
 * a decision rate, a reward, a randomised spawn and a time horizon.
 *
 *   decision rate  15 Hz (6 physics steps of 90 Hz per decision)
 *   action         8 numbers in [-1, 1]; hand targets move at up to 5 m/s toward them.
 *                  On this stage only height and forward/back of each hand are used (4 of the 8).
 *   observation    the 27 environment values + the 6 current hand commands (33)
 *   reward         metres of distance closed to the pad, -0.01 per decision, +10 on arriving, -5 for a fall
 *   success        the body is within 1.2 m of the pad centre (it does not have to stop there)
 *   curriculum     the pad starts 4 m away, then 8 m, then 12 m
 */
import { GtagEnvironment } from '../env.js';
import { ScriptedExpert } from '../expert.js';
import { vec } from '../gorilla.js';

export const REPEAT = 6;
export const HORIZON = 300;          // decisions: 20 s
export const OBS_DIM = 33;
export const LEVELS = Object.freeze([4, 8, 12]); // curriculum: how far away the pad is
export const PAD_RADIUS = 1.2;
export const ACT_DIM = 8;
const ARM = 1.5;
const SIDE = 0.25;                   // metres each hand sits out from the centre line
const SLEW = 5.0;                    // m/s per axis

const clamp1 = v => Math.max(-1, Math.min(1, Number.isFinite(v) ? v : 0));

export class GtagTask {
  constructor(options = {}) {
    this.stage = options.stage ?? 'slap';
    this.spawnJitter = options.spawnJitter ?? 0.3;
    this.planar = options.planar ?? true;
    this.distance = options.distance ?? LEVELS[LEVELS.length - 1]; // metres from the spawn to the finish pad
    this.env = new GtagEnvironment({ stage: this.stage });
    this.cmd = [vec(-0.25, -0.5, -0.45), vec(0.25, -0.5, -0.45)];
    this.t = 0;
  }

  reset(rng = Math.random) {
    this.env.reset(this.stage);
    const dx = (rng() * 2 - 1) * this.spawnJitter, dz = (rng() * 2 - 1) * this.spawnJitter;
    this.env.player.shift(dx, dz);
    this.cmd = [vec(-0.25, -0.5, -0.45), vec(0.25, -0.5, -0.45)];
    this.t = 0;
    this.lastD = this.goalDistance();
    this.obs27 = this.env.observe();
    return this.augment(this.obs27);
  }

  /** The pad sits straight ahead of the stage spawn at this task's distance. */
  goal() { const s = this.env.stage.spawn; return { x: s.x, z: s.z - this.distance }; }

  goalDistance() {
    const g = this.goal(), p = this.env.player.position;
    return Math.hypot(p.x - g.x, p.z - g.z);
  }

  augment(o27) {
    const out = new Float64Array(OBS_DIM);
    for (let i = 0; i < 27; i++) out[i] = o27[i];
    // The environment reports its fixed pad; this task's pad moves with the curriculum level.
    const g = this.goal(), head = this.env.player.head();
    out[15] = g.x - head.x; out[16] = -head.y; out[17] = g.z - head.z;
    for (let h = 0; h < 2; h++) { out[27 + h * 3] = this.cmd[h].x / ARM; out[28 + h * 3] = this.cmd[h].y / ARM; out[29 + h * 3] = this.cmd[h].z / ARM; }
    return out;
  }

  /** Latch one decision's action. The page calls begin / substep / finish itself so it can draw every physics step. */
  begin(action) {
    const a = Array.from(action, clamp1);
    // Like the four-key player, each hand moves in its own vertical plane: the sideways
    // channel and the grip are ignored on this stage (there is nothing to pick up).
    const x = h => (this.planar ? (h ? SIDE : -SIDE) : a[h * 4] * ARM);
    this.target = [vec(x(0), a[1] * ARM, a[2] * ARM), vec(x(1), a[5] * ARM, a[6] * ARM)];
    this.grips = this.planar ? [false, false] : [a[3] > 0, a[7] > 0];
  }

  /** One 90 Hz physics step toward the latched targets. Returns true when the episode has ended. */
  substep() {
    const env = this.env, p = env.player, head = p.p.headHeight, s = SLEW / 90;
    for (let h = 0; h < 2; h++) {
      const c = this.cmd[h], tg = this.target[h];
      for (const ax of ['x', 'y', 'z']) { const d = tg[ax] - c[ax]; c[ax] += Math.abs(d) <= s ? d : Math.sign(d) * s; }
      const len = Math.hypot(c.x, c.y, c.z);
      if (len > ARM) { const k = ARM / len; c.x *= k; c.y *= k; c.z *= k; }
      p.handLocal[h] = vec(c.x, head + c.y, c.z);
    }
    p.grip = [this.grips[0], this.grips[1]];
    p.step(1 / 90);
    env.steps++;
    env._judge();
    return env.terminated || env.truncated;
  }

  /** Close the decision: observe once (the probes are most of the cost) and score it. */
  finish() {
    const env = this.env;
    this.t++;
    // Progress is distance closed to the goal, so running past it costs what it earned.
    const d = this.goalDistance();
    let reward = (this.lastD - d) - 0.01;
    this.lastD = d;
    // Arriving means getting the body onto the pad. Stopping there is not required (yet).
    const success = d < PAD_RADIUS;
    const fell = env.stats.falls > 0;
    if (success) reward += 10;
    if (fell) reward -= 5;
    const done = success || fell;
    const truncated = !done && (this.t >= HORIZON || env.truncated);
    this.obs27 = env.observe();
    return { obs: this.augment(this.obs27), reward, done, truncated, info: { success, fell } };
  }

  /** action: array-like of 8 in [-1, 1] (clipped). Returns { obs, reward, done, truncated, info }. */
  step(action) {
    this.begin(action);
    for (let k = 0; k < REPEAT; k++) if (this.substep()) break;
    return this.finish();
  }
}

/**
 * Demonstrations from the scripted player on the learning task, with action noise so the
 * learner sees recoveries. Returns { obs[], act[], successRate }.
 */
export function collectDemos(rng, episodes, { noise = 0.08, stage = 'slap' } = {}) {
  const obs = [], act = [];
  let ok = 0;
  for (let e = 0; e < episodes; e++) {
    const task = new GtagTask({ stage });
    const expert = new ScriptedExpert({ dt: REPEAT / 90 });
    let o = task.reset(rng), r;
    for (let t = 0; t < HORIZON; t++) {
      const a = expert.act(task.obs27);
      obs.push(o);
      act.push(Float64Array.from(a, v => clamp1(v)));
      const noisy = a.map(v => v + noise * (rng() * 2 - 1));
      r = task.step(noisy);
      o = r.obs;
      if (r.done || r.truncated) break;
    }
    if (r.info.success) ok++;
  }
  return { obs, act, successRate: ok / episodes };
}
