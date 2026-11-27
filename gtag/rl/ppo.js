/*
 * Proximal Policy Optimisation with a diagonal Gaussian policy, generalised advantage
 * estimation, and a separate value network. Written for this project; it follows the
 * published algorithm (Schulman et al. 2017) and shares no code with any other project.
 *
 * Timeouts versus terminations: an episode that ends because time ran out is NOT a
 * failure, so its value is bootstrapped from V(s'). A real termination (goal, fall) is
 * worth zero afterwards. Mixing these up is the classic PPO bug; tests cover both.
 */
import { MLP, gaussian } from './nn.js';

const LOG2PI = Math.log(2 * Math.PI);

export class GaussianPolicy {
  constructor(obsDim, actDim, hidden = [64, 64], rng = Math.random, logStd0 = -1.0) {
    this.obsDim = obsDim; this.actDim = actDim;
    this.mean = new MLP([obsDim, ...hidden, actDim], rng, 0.01);
    this.logStd = new Float64Array(actDim).fill(logStd0);
    this.gLogStd = new Float64Array(actDim); this.mStd = new Float64Array(actDim); this.vStd = new Float64Array(actDim);
    this.stdT = 0;
  }
  /** Returns { action, logp, mean }. */
  act(obs, rng, deterministic = false) {
    const mean = Float64Array.from(this.mean.forward(obs));
    const action = new Float64Array(this.actDim);
    let logp = 0;
    for (let i = 0; i < this.actDim; i++) {
      const s = Math.exp(this.logStd[i]);
      action[i] = deterministic ? mean[i] : mean[i] + s * gaussian(rng);
      const z = (action[i] - mean[i]) / s;
      logp += -0.5 * z * z - this.logStd[i] - 0.5 * LOG2PI;
    }
    return { action, logp, mean };
  }
  logProb(mean, action) {
    let logp = 0;
    for (let i = 0; i < this.actDim; i++) { const z = (action[i] - mean[i]) / Math.exp(this.logStd[i]); logp += -0.5 * z * z - this.logStd[i] - 0.5 * LOG2PI; }
    return logp;
  }
  entropy() { let h = 0; for (let i = 0; i < this.actDim; i++) h += 0.5 + 0.5 * LOG2PI + this.logStd[i]; return h; }
  adamStd(lr) {
    this.stdT++;
    const c1 = 1 - 0.9 ** this.stdT, c2 = 1 - 0.999 ** this.stdT;
    for (let i = 0; i < this.actDim; i++) {
      this.mStd[i] = 0.9 * this.mStd[i] + 0.1 * this.gLogStd[i];
      this.vStd[i] = 0.999 * this.vStd[i] + 0.001 * this.gLogStd[i] ** 2;
      this.logStd[i] -= lr * (this.mStd[i] / c1) / (Math.sqrt(this.vStd[i] / c2) + 1e-8);
      this.logStd[i] = Math.max(-3, Math.min(0.5, this.logStd[i]));
    }
  }
  toJSON() { return { mean: this.mean.toJSON(), logStd: Array.from(this.logStd) }; }
  static fromJSON(j) { const p = new GaussianPolicy(j.mean.sizes[0], j.mean.sizes[j.mean.sizes.length - 1], [], () => 0.5); p.mean = MLP.fromJSON(j.mean); p.logStd = Float64Array.from(j.logStd); return p; }
}

/**
 * steps: arrays in time order for ONE or more concatenated trajectories, each with
 * { reward, value, done (true termination), end (true if the trajectory ends here, for any reason), nextValue }.
 * nextValue is V(s') and is only used when end && !done (a timeout).
 */
export function computeGAE(steps, gamma, lambda) {
  const n = steps.length;
  const adv = new Float64Array(n), ret = new Float64Array(n);
  let next = 0;
  for (let t = n - 1; t >= 0; t--) {
    const s = steps[t];
    let nextValue, carry;
    if (s.end) { nextValue = s.done ? 0 : s.nextValue; carry = 0; } else { nextValue = steps[t + 1].value; carry = 1; }
    const delta = s.reward + gamma * nextValue - s.value;
    next = delta + gamma * lambda * carry * next;
    adv[t] = next;
    ret[t] = next + s.value;
  }
  return { adv, ret };
}

/** One PPO update over a batch: { obs[], act[], oldLogp[], adv, ret }. Returns diagnostics. */
export function ppoUpdate(policy, valueNet, batch, cfg, rng) {
  const { epochs = 8, minibatch = 256, clip = 0.2, lr = 3e-4, vfCoef = 0.5, entCoef = 0, maxGrad = 0.5 } = cfg;
  const n = batch.obs.length;
  // Normalise advantages over the whole batch.
  let mean = 0, varr = 0;
  for (const a of batch.adv) mean += a; mean /= n;
  for (const a of batch.adv) varr += (a - mean) ** 2; varr = Math.sqrt(varr / n) + 1e-8;
  const advN = Float64Array.from(batch.adv, a => (a - mean) / varr);
  const idx = Int32Array.from({ length: n }, (_, i) => i);
  let klSum = 0, clipFrac = 0, count = 0, pLoss = 0, vLoss = 0;
  const dMu = new Float64Array(policy.actDim), dV = new Float64Array(1);
  for (let epoch = 0; epoch < epochs; epoch++) {
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
    for (let start = 0; start < n; start += minibatch) {
      const end = Math.min(n, start + minibatch), m = end - start;
      policy.mean.zeroGrad(); valueNet.zeroGrad(); policy.gLogStd.fill(0);
      for (let k = start; k < end; k++) {
        const i = idx[k];
        const mu = policy.mean.forward(batch.obs[i]);
        const logp = policy.logProb(mu, batch.act[i]);
        const ratio = Math.exp(logp - batch.oldLogp[i]);
        const A = advN[i];
        const clipped = A >= 0 ? ratio > 1 + clip : ratio < 1 - clip;
        // d(-min(rA, clip(r)A))/dlogp = -A r when the unclipped branch is active, else 0.
        const dLogp = clipped ? 0 : -A * ratio / m;
        for (let d = 0; d < policy.actDim; d++) {
          const s2 = Math.exp(2 * policy.logStd[d]);
          const diff = batch.act[i][d] - mu[d];
          dMu[d] = dLogp * diff / s2;
          policy.gLogStd[d] += dLogp * (diff * diff / s2 - 1) - entCoef / m;
        }
        policy.mean.backward(dMu);
        const v = valueNet.forward(batch.obs[i])[0];
        dV[0] = vfCoef * (v - batch.ret[i]) / m;
        valueNet.backward(dV);
        klSum += (batch.oldLogp[i] - logp); clipFrac += clipped ? 1 : 0; count++;
        pLoss += -Math.min(ratio * A, Math.max(1 - clip, Math.min(1 + clip, ratio)) * A) / 1; vLoss += 0.5 * (v - batch.ret[i]) ** 2;
      }
      policy.mean.clipGrad(maxGrad); valueNet.clipGrad(maxGrad);
      policy.mean.adam(lr); valueNet.adam(lr); policy.adamStd(lr);
    }
  }
  return { approxKl: klSum / count, clipFraction: clipFrac / count, policyLoss: pLoss / count, valueLoss: vLoss / count, entropy: policy.entropy(), updates: epochs * Math.ceil(n / minibatch) };
}

/** Behaviour cloning: regress the policy mean onto (obs, action) pairs from a demonstrator. */
export function behaviourClone(policy, obs, act, { steps = 400, batch = 128, lr = 1e-3 } = {}, rng = Math.random) {
  let last = 0;
  for (let s = 0; s < steps; s++) {
    policy.mean.zeroGrad();
    let loss = 0;
    for (let k = 0; k < batch; k++) {
      const i = Math.floor(rng() * obs.length);
      const mu = policy.mean.forward(obs[i]);
      const d = new Float64Array(policy.actDim);
      for (let j = 0; j < policy.actDim; j++) { const e = mu[j] - act[i][j]; d[j] = e / batch; loss += 0.5 * e * e / batch; }
      policy.mean.backward(d);
    }
    policy.mean.clipGrad(5);
    policy.mean.adam(lr);
    last = loss;
  }
  return last;
}
