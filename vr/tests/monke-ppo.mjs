import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MLP, RunningNorm, mulberry32 } from '../../gtag/rl/nn.js';
import { GaussianPolicy, computeGAE, ppoUpdate } from '../../gtag/rl/ppo.js';
import { GtagTask, OBS_DIM, ACT_DIM, LEVELS, PAD_RADIUS, HORIZON } from '../../gtag/rl/task.js';
import { Trainer, Driver, evaluate, checkBrain, BRAIN_FORMAT } from '../../gtag/rl/trainer.js';

const near = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);

test('backpropagation matches finite differences', () => {
  const rng = mulberry32(7);
  const net = new MLP([5, 6, 4, 3], rng, 1);
  const x = Float64Array.from({ length: 5 }, () => rng() * 2 - 1);
  const target = [0.3, -0.2, 0.5];
  const loss = () => { const y = net.forward(x); let s = 0; for (let i = 0; i < 3; i++) s += 0.5 * (y[i] - target[i]) ** 2; return s; };
  net.zeroGrad();
  const y = net.forward(x);
  net.backward(Float64Array.from(y, (v, i) => v - target[i]));
  for (const L of net.layers) for (const [p, g] of [[L.W, L.gW], [L.b, L.gb]]) for (const i of [0, Math.floor(p.length / 2), p.length - 1]) {
    const keep = p[i], h = 1e-6;
    p[i] = keep + h; const up = loss(); p[i] = keep - h; const down = loss(); p[i] = keep;
    near(g[i], (up - down) / (2 * h), 1e-6, 'gradient');
  }
});

test('Adam reduces a regression loss', () => {
  const rng = mulberry32(3);
  const net = new MLP([2, 16, 1], rng, 1);
  const data = Array.from({ length: 64 }, () => { const x = [rng() * 2 - 1, rng() * 2 - 1]; return { x, y: x[0] * 0.7 - x[1] * 0.4 }; });
  const epoch = train => { let s = 0; if (train) net.zeroGrad(); for (const d of data) { const e = net.forward(d.x)[0] - d.y; s += 0.5 * e * e; if (train) net.backward([e / data.length]); } if (train) net.adam(0.01); return s / data.length; };
  const before = epoch(false);
  for (let i = 0; i < 300; i++) epoch(true);
  assert.ok(epoch(false) < before * 0.05);
});

test('running normalisation centres and scales', () => {
  const norm = new RunningNorm(1);
  norm.update(Array.from({ length: 1000 }, (_, i) => [10 + (i % 2 ? 2 : -2)]));
  near(norm.apply([10])[0], 0, 1e-3); near(norm.apply([12])[0], 1, 1e-2);
});

test('GAE: a timeout bootstraps from the next value, a real ending does not', () => {
  const step = extra => ({ reward: 1, value: 0, done: false, end: false, nextValue: 0, ...extra });
  const timeout = computeGAE([step(), step({ end: true, done: false, nextValue: 5 })], 0.9, 1);
  const ended = computeGAE([step(), step({ end: true, done: true, nextValue: 5 })], 0.9, 1);
  near(timeout.ret[1], 1 + 0.9 * 5, 1e-12); near(ended.ret[1], 1, 1e-12);
  near(timeout.ret[0], 1 + 0.9 * (1 + 0.9 * 5), 1e-12); near(ended.ret[0], 1.9, 1e-12);
});

test('GAE does not leak advantage across concatenated trajectories', () => {
  const s = (reward, end) => ({ reward, value: 0, done: end, end, nextValue: 0 });
  const { adv } = computeGAE([s(0, false), s(0, true), s(100, true)], 0.99, 0.95);
  near(adv[0], 0, 1e-12); near(adv[1], 0, 1e-12); near(adv[2], 100, 1e-12);
});

test('PPO moves a policy toward the rewarded action on a one-step problem', () => {
  const rng = mulberry32(11);
  const policy = new GaussianPolicy(1, 1, [8], rng, -0.5);
  const value = new MLP([1, 8, 1], rng, 1);
  const obs = Float64Array.of(1);
  const mean = () => policy.act(obs, rng, true).action[0];
  const before = Math.abs(mean() - 0.6);
  for (let iter = 0; iter < 60; iter++) {
    const batch = { obs: [], act: [], oldLogp: [], adv: [], ret: [] };
    for (let i = 0; i < 64; i++) { const { action, logp } = policy.act(obs, rng); const r = -((action[0] - 0.6) ** 2); batch.obs.push(obs); batch.act.push(action); batch.oldLogp.push(logp); batch.adv.push(r - value.forward(obs)[0]); batch.ret.push(r); }
    ppoUpdate(policy, value, batch, { epochs: 4, minibatch: 32, lr: 3e-3 }, rng);
  }
  assert.ok(Math.abs(mean() - 0.6) < Math.min(0.15, before), `mean action ${mean()}`);
});

test('the task is deterministic for a seed and has the documented shapes', () => {
  const run = () => { const rng = mulberry32(5); const task = new GtagTask(); const first = task.reset(rng); let r; for (let i = 0; i < 20; i++) r = task.step([0, -0.5, -0.4, -1, 0, -0.5, -0.4, -1]); return { first, last: r.obs, reward: r.reward }; };
  const a = run(), b = run();
  assert.equal(a.first.length, OBS_DIM); assert.equal(ACT_DIM, 8);
  assert.deepEqual(Array.from(a.last), Array.from(b.last)); assert.equal(a.reward, b.reward);
  assert.ok(Array.from(a.last).every(Number.isFinite));
});

test('reward is distance closed to the pad minus a time cost, and arriving ends the episode', () => {
  const task = new GtagTask({ distance: LEVELS[0], spawnJitter: 0 });
  task.reset(mulberry32(1));
  const idle = task.step([0, -0.3, -0.3, -1, 0, -0.3, -0.3, -1]);
  near(idle.reward, -0.01, 0.02, 'idle reward');
  task.env.player.shift(0, -(task.goalDistance() - PAD_RADIUS + 0.2));
  const arrive = task.step([0, -0.3, -0.3, -1, 0, -0.3, -0.3, -1]);
  assert.ok(arrive.done && arrive.info.success); assert.ok(arrive.reward > 9);
});

test('an episode that runs out of time is truncated, not failed', () => {
  const task = new GtagTask({ spawnJitter: 0 });
  task.reset(mulberry32(1));
  let r; for (let i = 0; i < HORIZON; i++) r = task.step([0, -0.3, -0.3, -1, 0, -0.3, -0.3, -1]);
  assert.ok(r.truncated && !r.done);
});

test('a trainer iterates, saves a brain the driver can load, and rejects foreign brains', () => {
  const trainer = new Trainer({ seed: 2, cfg: { envs: 2, horizon: 16, epochs: 1, minibatch: 16 } });
  const stats = trainer.iterate();
  assert.equal(stats.decisions, 32); assert.ok(Number.isFinite(stats.entropy));
  const brain = JSON.parse(JSON.stringify(trainer.brain()));
  assert.equal(brain.format, BRAIN_FORMAT);
  const driver = new Driver(brain);
  const obs = new GtagTask().reset(mulberry32(1));
  const direct = trainer.policy.act(trainer.norm.apply(obs), Math.random, true).action;
  assert.deepEqual(Array.from(driver.act(obs)), Array.from(direct));
  assert.throws(() => checkBrain({ format: 'climbppo-brain-1' }));
  assert.throws(() => checkBrain({ ...brain, obsDim: 36 }));
  const score = evaluate(brain, { episodes: 1 });
  assert.equal(score.episodes, 1);
});

test('the curriculum moves the pad when recent attempts succeed', () => {
  const trainer = new Trainer({ seed: 2, cfg: { envs: 2, horizon: 8, epochs: 1, minibatch: 16, promoteWindow: 3 } });
  trainer.recentSuccess = [1, 1, 1]; trainer.recentReturn = [1, 1, 1];
  const stats = trainer.iterate();
  assert.ok(stats.promoted); assert.equal(trainer.level, 1);
  assert.ok(trainer.tasks.every(t => t.distance === LEVELS[1]));
});
