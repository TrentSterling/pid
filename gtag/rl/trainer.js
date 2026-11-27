/*
 * The training loop, free of DOM and worker APIs so the page's worker and Node tests run
 * the same code. One call to iterate() collects a rollout from N parallel copies of the
 * task and applies one PPO update.
 */
import { GtagTask, OBS_DIM, ACT_DIM, LEVELS } from './task.js';
import { MLP, RunningNorm, mulberry32 } from './nn.js';
import { GaussianPolicy, computeGAE, ppoUpdate } from './ppo.js';

export const BRAIN_FORMAT = 'tront-gtag-ppo-brain-v1';
export const TRAIN_DEFAULTS = Object.freeze({
  envs: 16, horizon: 128, gamma: 0.99, lambda: 0.95,
  epochs: 4, minibatch: 256, promoteAt: 0.7, promoteWindow: 40, lr: 3e-4, clip: 0.2, hidden: [64, 64], logStd0: -0.7,
});

export class Trainer {
  constructor(options = {}) {
    this.cfg = { ...TRAIN_DEFAULTS, ...(options.cfg || {}) };
    this.seed = options.seed ?? 1;
    this.rng = mulberry32(this.seed);
    this.stage = options.stage ?? 'slap';
    this.policy = new GaussianPolicy(OBS_DIM, ACT_DIM, this.cfg.hidden, this.rng, this.cfg.logStd0);
    this.value = new MLP([OBS_DIM, ...this.cfg.hidden, 1], this.rng, 1);
    this.norm = new RunningNorm(OBS_DIM);
    this.level = options.level ?? 0;
    this.tasks = Array.from({ length: this.cfg.envs }, () => new GtagTask({ stage: this.stage, distance: LEVELS[this.level] }));
    this.obs = this.tasks.map(t => t.reset(this.rng));
    this.episodeReturn = new Float64Array(this.cfg.envs);
    this.decisions = 0; this.iterations = 0; this.episodes = 0; this.seconds = 0;
    this.recentReturn = []; this.recentSuccess = [];
    if (options.brain) this.load(options.brain);
  }

  iterate() {
    const started = Date.now();
    const { envs, horizon, gamma, lambda } = this.cfg;
    const traj = this.tasks.map(() => []);
    const raw = [];
    for (let t = 0; t < horizon; t++) {
      for (let i = 0; i < envs; i++) {
        raw.push(this.obs[i]);
        const on = this.norm.apply(this.obs[i]);
        const { action, logp } = this.policy.act(on, this.rng);
        const v = this.value.forward(on)[0];
        const r = this.tasks[i].step(action);
        this.episodeReturn[i] += r.reward;
        const end = r.done || r.truncated || t === horizon - 1;
        // A timeout or a cut-off rollout bootstraps from V(s'); a real ending does not.
        const nextValue = end && !r.done ? this.value.forward(this.norm.apply(r.obs))[0] : 0;
        traj[i].push({ obs: on, act: action, logp, reward: r.reward, value: v, done: r.done, end, nextValue });
        if (r.done || r.truncated) {
          this.recentReturn.push(this.episodeReturn[i]); this.recentSuccess.push(r.info.success ? 1 : 0);
          if (this.recentReturn.length > 100) { this.recentReturn.shift(); this.recentSuccess.shift(); }
          this.episodeReturn[i] = 0; this.episodes++;
          this.obs[i] = this.tasks[i].reset(this.rng);
        } else this.obs[i] = r.obs;
      }
    }
    this.norm.update(raw);
    const batch = { obs: [], act: [], oldLogp: [], adv: [], ret: [] };
    for (const tr of traj) {
      const { adv, ret } = computeGAE(tr, gamma, lambda);
      tr.forEach((s, k) => { batch.obs.push(s.obs); batch.act.push(s.act); batch.oldLogp.push(s.logp); batch.adv.push(adv[k]); batch.ret.push(ret[k]); });
    }
    const diag = ppoUpdate(this.policy, this.value, batch, this.cfg, this.rng);
    this.decisions += envs * horizon; this.iterations++;
    this.seconds += (Date.now() - started) / 1000;
    const stats = this.stats(diag);
    // Curriculum: once most recent attempts arrive, move the pad further away.
    if (this.level < LEVELS.length - 1 && this.recentSuccess.length >= this.cfg.promoteWindow && stats.successRate >= this.cfg.promoteAt) {
      this.setLevel(this.level + 1);
      stats.promoted = true;
    }
    stats.level = this.level;
    return stats;
  }

  setLevel(level) {
    this.level = Math.max(0, Math.min(LEVELS.length - 1, level));
    for (const task of this.tasks) task.distance = LEVELS[this.level];
    this.recentReturn = []; this.recentSuccess = [];
  }

  stats(diag = {}) {
    const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
    return {
      level: this.level, distance: LEVELS[this.level], iterations: this.iterations, decisions: this.decisions, episodes: this.episodes, seconds: this.seconds,
      meanReturn: mean(this.recentReturn), successRate: mean(this.recentSuccess), window: this.recentReturn.length,
      approxKl: diag.approxKl ?? 0, clipFraction: diag.clipFraction ?? 0, entropy: diag.entropy ?? this.policy.entropy(), valueLoss: diag.valueLoss ?? 0,
    };
  }

  brain(meta = {}) {
    return {
      format: BRAIN_FORMAT, stage: this.stage, obsDim: OBS_DIM, actDim: ACT_DIM,
      policy: this.policy.toJSON(), value: this.value.toJSON(), norm: this.norm.toJSON(),
      meta: { level: this.level, distance: LEVELS[this.level], decisions: this.decisions, iterations: this.iterations, seconds: Math.round(this.seconds), seed: this.seed, ...meta },
    };
  }

  load(brain) {
    checkBrain(brain);
    this.policy = GaussianPolicy.fromJSON(brain.policy);
    this.value = MLP.fromJSON(brain.value);
    this.norm = RunningNorm.fromJSON(brain.norm);
    this.decisions = brain.meta?.decisions ?? 0; this.iterations = brain.meta?.iterations ?? 0; this.seconds = brain.meta?.seconds ?? 0;
    if (Number.isInteger(brain.meta?.level)) this.setLevel(brain.meta.level);
  }
}

export function checkBrain(brain) {
  if (brain?.format !== BRAIN_FORMAT) throw new Error('Not a Gorilla course PPO brain.');
  if (brain.obsDim !== OBS_DIM || brain.actDim !== ACT_DIM) throw new Error('This brain was trained for a different observation or action layout.');
}

/** A loaded brain that only acts: used by the page to drive the visible monke. */
export class Driver {
  constructor(brain) {
    checkBrain(brain);
    this.policy = GaussianPolicy.fromJSON(brain.policy);
    this.norm = RunningNorm.fromJSON(brain.norm);
    this.meta = brain.meta || {};
  }
  act(obs, rng = Math.random, deterministic = true) { return this.policy.act(this.norm.apply(obs), rng, deterministic).action; }
}

/** Score a brain on spawns it was not trained on (a separate seed stream). */
export function evaluate(brain, { episodes = 50, seed = 0x9e3779b9, stage = 'slap', deterministic = true, distance = LEVELS[LEVELS.length - 1], spawnJitter = 0.3 } = {}) {
  const driver = new Driver(brain);
  const rng = mulberry32(seed);
  const task = new GtagTask({ stage, distance, spawnJitter });
  let success = 0, falls = 0, time = 0, ret = 0;
  for (let e = 0; e < episodes; e++) {
    let o = task.reset(rng), r;
    do { r = task.step(driver.act(o, rng, deterministic)); o = r.obs; ret += r.reward; } while (!r.done && !r.truncated);
    if (r.info.success) { success++; time += task.t / 15; }
    if (r.info.fell) falls++;
  }
  return { episodes, successRate: success / episodes, fallRate: falls / episodes, meanReturn: ret / episodes, meanSuccessSeconds: success ? time / success : null };
}
