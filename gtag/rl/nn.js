/*
 * A small multilayer perceptron with hand-written backpropagation and Adam.
 * No libraries. tanh hidden layers, linear output. Float64 so tests can use
 * finite-difference gradient checks. Written for this project's PPO demo.
 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class MLP {
  /** sizes e.g. [33, 64, 64, 8]. outScale shrinks the last layer's initial weights. */
  constructor(sizes, rng = Math.random, outScale = 0.01) {
    this.sizes = sizes.slice();
    this.layers = [];
    for (let l = 0; l < sizes.length - 1; l++) {
      const nIn = sizes[l], nOut = sizes[l + 1];
      const last = l === sizes.length - 2;
      const scale = (last ? outScale : 1) * Math.sqrt(1 / nIn);
      const W = new Float64Array(nIn * nOut);
      for (let i = 0; i < W.length; i++) W[i] = gaussian(rng) * scale;
      this.layers.push({ nIn, nOut, W, b: new Float64Array(nOut), gW: new Float64Array(nIn * nOut), gb: new Float64Array(nOut), mW: new Float64Array(nIn * nOut), vW: new Float64Array(nIn * nOut), mb: new Float64Array(nOut), vb: new Float64Array(nOut) });
    }
    this.t = 0;
  }

  /**
   * x: array of nIn numbers. Returns the output buffer, which is reused by the next call:
   * read it (or copy it) before calling forward() again. Activations are kept for backward().
   */
  forward(x) {
    let a = x;
    this.input = x;
    for (let l = 0; l < this.layers.length; l++) {
      const L = this.layers[l], { nIn, nOut, W, b } = L;
      const out = L.out || (L.out = new Float64Array(nOut));
      const hidden = l < this.layers.length - 1;
      for (let o = 0; o < nOut; o++) {
        let s = b[o];
        const base = o * nIn;
        for (let i = 0; i < nIn; i++) s += W[base + i] * a[i];
        out[o] = hidden ? Math.tanh(s) : s;
      }
      a = out;
    }
    return a;
  }

  /** Accumulate gradients for the most recent forward() given dLoss/dOutput. */
  backward(dOut) {
    let d = dOut;
    for (let l = this.layers.length - 1; l >= 0; l--) {
      const L = this.layers[l];
      const aIn = l === 0 ? this.input : this.layers[l - 1].out, aOut = L.out;
      const dz = L.dz || (L.dz = new Float64Array(L.nOut));
      if (l < this.layers.length - 1) for (let o = 0; o < L.nOut; o++) dz[o] = d[o] * (1 - aOut[o] * aOut[o]);
      else for (let o = 0; o < L.nOut; o++) dz[o] = d[o];
      const dIn = L.dIn || (L.dIn = new Float64Array(L.nIn));
      if (l > 0) dIn.fill(0);
      for (let o = 0; o < L.nOut; o++) {
        const g = dz[o];
        if (g === 0) continue;
        L.gb[o] += g;
        const base = o * L.nIn;
        if (l > 0) for (let i = 0; i < L.nIn; i++) { L.gW[base + i] += g * aIn[i]; dIn[i] += g * L.W[base + i]; }
        else for (let i = 0; i < L.nIn; i++) L.gW[base + i] += g * aIn[i];
      }
      d = dIn;
    }
  }

  zeroGrad() { for (const L of this.layers) { L.gW.fill(0); L.gb.fill(0); } }

  gradNorm() {
    let s = 0;
    for (const L of this.layers) { for (const g of L.gW) s += g * g; for (const g of L.gb) s += g * g; }
    return Math.sqrt(s);
  }

  /** Scale gradients so the global norm is at most maxNorm. */
  clipGrad(maxNorm) {
    const n = this.gradNorm();
    if (n > maxNorm) { const k = maxNorm / n; for (const L of this.layers) { for (let i = 0; i < L.gW.length; i++) L.gW[i] *= k; for (let i = 0; i < L.gb.length; i++) L.gb[i] *= k; } }
    return n;
  }

  adam(lr, b1 = 0.9, b2 = 0.999, eps = 1e-8) {
    this.t++;
    const c1 = 1 - b1 ** this.t, c2 = 1 - b2 ** this.t;
    const apply = (p, g, m, v) => {
      for (let i = 0; i < p.length; i++) {
        m[i] = b1 * m[i] + (1 - b1) * g[i];
        v[i] = b2 * v[i] + (1 - b2) * g[i] * g[i];
        p[i] -= lr * (m[i] / c1) / (Math.sqrt(v[i] / c2) + eps);
      }
    };
    for (const L of this.layers) { apply(L.W, L.gW, L.mW, L.vW); apply(L.b, L.gb, L.mb, L.vb); }
  }

  toJSON() { return { sizes: this.sizes, layers: this.layers.map(L => ({ W: Array.from(L.W), b: Array.from(L.b) })) }; }
  static fromJSON(j) {
    const m = new MLP(j.sizes, () => 0.5, 0);
    j.layers.forEach((l, i) => { m.layers[i].W.set(l.W); m.layers[i].b.set(l.b); });
    return m;
  }
  copyFrom(other) { this.layers.forEach((L, i) => { L.W.set(other.layers[i].W); L.b.set(other.layers[i].b); }); }
}

/** Running mean / variance for observation normalisation (Welford, batched). */
export class RunningNorm {
  constructor(n) { this.n = n; this.count = 1e-4; this.mean = new Float64Array(n); this.m2 = new Float64Array(n).fill(1e-4); }
  update(batch) {
    for (const x of batch) {
      this.count++;
      for (let i = 0; i < this.n; i++) { const d = x[i] - this.mean[i]; this.mean[i] += d / this.count; this.m2[i] += d * (x[i] - this.mean[i]); }
    }
  }
  std(i) { return Math.sqrt(this.m2[i] / this.count) + 1e-6; }
  apply(x) { const out = new Float64Array(this.n); for (let i = 0; i < this.n; i++) out[i] = Math.max(-10, Math.min(10, (x[i] - this.mean[i]) / this.std(i))); return out; }
  toJSON() { return { count: this.count, mean: Array.from(this.mean), m2: Array.from(this.m2) }; }
  static fromJSON(j) { const r = new RunningNorm(j.mean.length); r.count = j.count; r.mean.set(j.mean); r.m2.set(j.m2); return r; }
}
