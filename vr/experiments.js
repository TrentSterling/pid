/**
 * Recorded-input evaluation for the public Grab Lab. This module contains no
 * neural network, optimizer, private project source, or pretrained policy.
 *
 * recordScenario() runs one Backward PD reference and captures its actual local
 * tracking inputs. replayTrace() disables scripted input and applies those same
 * samples to a fresh world for each controller. The reference workout adapts
 * its first reach to the settling cube, so recording once matters for fairness.
 *
 * Deterministic reset means a fresh, fixed scene. There is no random seed or
 * randomized reset. Determinism is within this engine/version, not a claim of
 * bit-identical results between browsers or equivalence to Unity/PhysX.
 */
import { GrabLab, MODES, SCENARIOS, LOCOMOTION_MODES, DEFAULTS } from './physics.js';

export const TRACE_FORMAT = 'tront-grab-input-trace-v1';
export const COMPARISON_FORMAT = 'tront-grab-comparison-v1';
export const ENVIRONMENT_FORMAT = 'tront-grab-environment-v1';
const MAX_FRAMES = 21600;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const vec = v => ({ x: v.x, y: v.y, z: v.z });
const quat = q => ({ x: q.x, y: q.y, z: q.z, w: q.w });
const length = v => Math.hypot(v.x, v.y, v.z);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function configOf(input = {}) {
  if (input.seed !== undefined) throw new Error('This environment uses a fixed deterministic reset, not a seeded random reset.');
  const scenario = input.scenario ?? 'workout';
  const preset = SCENARIOS.find(s => s.id === scenario);
  if (!preset) throw new Error(`Unknown scenario: ${scenario}`);
  const locomotion = input.locomotion ?? 'cast';
  if (!LOCOMOTION_MODES.some(m => m.id === locomotion)) throw new Error(`Unknown locomotion: ${locomotion}`);
  const hz = input.hz ?? 90;
  if (!Number.isInteger(hz) || hz < 30 || hz > 240) throw new Error('Physics Hz must be an integer from 30 to 240.');
  const duration = input.duration ?? preset.duration;
  if (!Number.isFinite(duration) || duration < 0.1 || duration > 90) throw new Error('Duration must be 0.1 to 90 seconds.');
  const params = {};
  for (const key of Object.keys(DEFAULTS)) {
    const value = input.params?.[key];
    if (value === undefined) continue;
    if (typeof DEFAULTS[key] === 'boolean') {
      if (typeof value !== 'boolean') throw new Error(`Invalid boolean parameter: ${key}`);
    } else if (!Number.isFinite(value)) throw new Error(`Invalid numeric parameter: ${key}`);
    params[key] = value;
  }
  const modes = input.modes ?? MODES.map(m => m.id);
  if (!Array.isArray(modes) || !modes.length || new Set(modes).size !== modes.length || modes.some(id => !MODES.some(m => m.id === id))) {
    throw new Error('Modes must be a nonempty list of distinct grab-controller IDs.');
  }
  return { scenario, locomotion, hz, duration, params, modes: [...modes], baselineMode: 'backward' };
}

function makeLab(config, mode, scripted) {
  const lab = new GrabLab({ ...config.params, mode, scripted, repeatTrial: false });
  lab.setLocomotion(config.locomotion);
  lab.setScenario(config.scenario);
  lab.repeatTrial = false;
  return lab;
}

function copyInput(input) {
  return {
    head: { position: vec(input.head.position), quaternion: quat(input.head.quaternion) },
    hands: input.hands.map(h => ({
      position: vec(h.position), quaternion: quat(h.quaternion), grip: h.grip,
      ...(h.velocity ? { velocity: vec(h.velocity) } : {}),
      ...(h.angularVelocity ? { angularVelocity: vec(h.angularVelocity) } : {}),
    })),
  };
}

function initialState(lab) {
  return {
    player: { position: vec(lab.playerBody.position), velocity: vec(lab.playerBody.velocity) },
    gravity: vec(lab.world.gravity),
    items: lab.items.filter(i => !i.isStatic).map(i => ({
      id: i.id, mass: i.body.mass, position: vec(i.body.position), quaternion: quat(i.body.quaternion),
    })),
  };
}

// A portable input fingerprint for auditing, not a cryptographic signature.
function hashText(hash, text) {
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
  return hash;
}
const hashLabel = hash => `fnv1a32-${hash.toString(16).padStart(8, '0')}`;
export function inputHash(frames) {
  let hash = 2166136261;
  for (const frame of frames) hash = hashText(hash, JSON.stringify(frame));
  return hashLabel(hash);
}

function validPose(pose) {
  if (!pose?.position || !pose?.quaternion) return false;
  if (!['x', 'y', 'z'].every(a => Number.isFinite(pose.position[a]) && Math.abs(pose.position[a]) <= 10)) return false;
  if (!['x', 'y', 'z', 'w'].every(a => Number.isFinite(pose.quaternion[a]))) return false;
  const qn = Math.hypot(...['x', 'y', 'z', 'w'].map(a => pose.quaternion[a]));
  return Math.abs(qn - 1) < 1e-4;
}

export function validateTrace(trace) {
  if (trace?.format !== TRACE_FORMAT) throw new Error('Unrecognized tracking-trace format.');
  const config = configOf(trace.config);
  if (!Array.isArray(trace.frames) || !trace.frames.length || trace.frames.length > MAX_FRAMES) throw new Error('Trace has an invalid frame count.');
  if (trace.frames.length !== Math.round(config.duration * config.hz)) throw new Error('Trace duration and sample count differ.');
  for (const frame of trace.frames) {
    if (!validPose(frame.head) || !Array.isArray(frame.hands) || frame.hands.length !== 2) throw new Error('Trace contains an invalid head or hand pose.');
    for (const hand of frame.hands) {
      if (!validPose(hand) || typeof hand.grip !== 'boolean') throw new Error('Trace contains an invalid hand pose or grip.');
      for (const key of ['velocity', 'angularVelocity']) if (hand[key] && !['x', 'y', 'z'].every(a => Number.isFinite(hand[key][a]))) {
        throw new Error('Trace contains a nonfinite tracking velocity.');
      }
    }
  }
  if (inputHash(trace.frames) !== trace.inputHash) throw new Error('Trace input fingerprint does not match its samples.');
  return config;
}

function progressEvery(i, count) {
  return i === count - 1 || i % Math.max(1, Math.floor(count / 25)) === 0;
}

export function recordScenario(input = {}, onProgress = () => {}) {
  const config = configOf(input);
  const lab = makeLab(config, config.baselineMode, true);
  config.params = { ...lab.params };
  const frames = [];
  const count = Math.round(config.duration * config.hz);
  const start = initialState(lab);
  try {
    for (let i = 0; i < count; i++) {
      lab.step(1 / config.hz);
      frames.push(copyInput(lab.input));
      if (progressEvery(i, count)) onProgress({ phase: 'record', modeId: config.baselineMode, completed: i + 1, total: count });
    }
  } finally { lab.dispose(); }
  return {
    format: TRACE_FORMAT,
    coordinateFrame: 'Tracking-origin-local positions and orientations; metres, seconds; +Y up, -Z forward.',
    timing: 'Each input is applied before one fixed physics step. Head and hand samples include grip state.',
    reset: 'Fresh fixed scene, no randomization. Scenario setup and its scheduled external events are part of the environment.',
    scenarioEvents: config.scenario === 'shove' ? [{ type: 'playerImpulse', atSeconds: 2, impulseNs: [90, 0, 0], owner: 'GrabLab scenario, applied once independently of scripted input' }] : [],
    config, initialState: start, frames, inputHash: inputHash(frames),
  };
}

function simulationFailure(lab) {
  const b = lab.playerBody;
  for (const body of lab.world.bodies) {
    if (![body.position.x, body.position.y, body.position.z, body.velocity.x, body.velocity.y, body.velocity.z,
      body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w,
      body.angularVelocity.x, body.angularVelocity.y, body.angularVelocity.z].every(Number.isFinite)) return 'Nonfinite rigidbody state';
  }
  if (b.position.y < -10 || Math.abs(b.position.x) > 100 || Math.abs(b.position.z) > 100 || b.position.y > 100) return 'Player left the evaluation bounds';
  return null;
}

export function replayTrace(trace, modeId, onProgress = () => {}) {
  const config = validateTrace(trace);
  const mode = MODES.find(m => m.id === modeId);
  if (!mode) throw new Error(`Unknown grab controller: ${modeId}`);
  const lab = makeLab(config, modeId, false);
  if (JSON.stringify(initialState(lab)) !== JSON.stringify(trace.initialState)) {
    lab.dispose();
    throw new Error('The current environment reset differs from this trace. Record a fresh trace.');
  }
  const origin = vec(lab.playerBody.position);
  let heldSamples = 0, requestedSamples = 0, limitedSamples = 0, squared = 0, peakGap = 0;
  let peakDrift = 0, peakSpeed = 0, peakLaunch = 0, completed = 0, hash = 2166136261;
  let terminated = false, terminationReason = null;
  const heldObjects = new Set();
  try {
    for (let i = 0; i < trace.frames.length; i++) {
      const input = trace.frames[i];
      // Fingerprint the exact command passed to every controller. setInput()
      // normalizes quaternion copies, which can change a final floating-point
      // bit on a second normalization without changing the supplied command.
      hash = hashText(hash, JSON.stringify(input));
      lab.setInput(input);
      lab.step(1 / config.hz);
      completed++;
      terminationReason = simulationFailure(lab);
      if (terminationReason) { terminated = true; break; }
      for (let h = 0; h < 2; h++) {
        const hand = lab.hands[h];
        if (input.hands[h].grip) requestedSamples++;
        if (!hand.grab) continue;
        heldSamples++;
        heldObjects.add(hand.heldId);
        const gap = distance(hand.target, hand.physical) * 100;
        squared += gap * gap;
        peakGap = Math.max(peakGap, gap);
        if (hand.limited) limitedSamples++;
      }
      peakDrift = Math.max(peakDrift, distance(lab.playerBody.position, origin));
      peakSpeed = Math.max(peakSpeed, length(lab.playerBody.velocity));
      peakLaunch = Math.max(peakLaunch, lab.metrics.launchSpeed || 0);
      if (progressEvery(i, trace.frames.length)) onProgress({ phase: 'replay', modeId, completed: i + 1, total: trace.frames.length });
    }
    const slots = completed * 2;
    return {
      modeId, name: mode.name, color: mode.color,
      inputHash: hashLabel(hash), expectedInputHash: trace.inputHash,
      samples: completed, simulatedSeconds: completed / config.hz,
      heldSamples, requestedSamples,
      heldFraction: slots ? heldSamples / slots : 0,
      gripRequestedFraction: slots ? requestedSamples / slots : 0,
      heldGivenGripFraction: requestedSamples ? heldSamples / requestedSamples : null,
      rmsGapCm: heldSamples ? Math.sqrt(squared / heldSamples) : null,
      peakGapCm: heldSamples ? peakGap : null,
      capFraction: heldSamples ? limitedSamples / heldSamples : null,
      driftM: distance(lab.playerBody.position, origin), peakDriftM: peakDrift,
      finalSpeedMps: length(lab.playerBody.velocity), peakSpeedMps: peakSpeed, peakLaunchSpeedMps: peakLaunch,
      heldObjectIds: [...heldObjects], terminated, terminationReason,
      trial: lab.exportTrial(),
    };
  } finally { lab.dispose(); }
}

export function compareControllers(input = {}, onProgress = () => {}) {
  const config = configOf(input);
  const phases = config.modes.length + 1;
  const trace = recordScenario(config, p => onProgress({ ...p, fraction: (p.completed / p.total) / phases }));
  const rows = config.modes.map((modeId, index) => replayTrace(trace, modeId, p => onProgress({ ...p, fraction: (1 + index + p.completed / p.total) / phases })));
  return {
    format: COMPARISON_FORMAT, createdAt: new Date().toISOString(), config: trace.config, trace, rows,
    learning: false,
    notes: [
      'Recorded-input physics evaluation. No neural model is trained or evaluated.',
      'One Backward PD reference records the body-local tracking sequence. Every controller replays those exact samples from a fresh scene.',
      'The recorded reference is one test trajectory, not an optimal policy for every motor. Body and prop trajectories can diverge.',
      'RMS and peak gaps include only held hand samples. No held samples produce null, never a winning zero. Read hold coverage with error.',
      'Held fraction uses both hand slots on every completed step. Held-given-grip fraction measures successful holding during requested grips.',
      'Cap fraction uses held hand samples. Cannon point-joint caps apply per axis; other grab caps apply to vector magnitude.',
      'Drift is displacement from the initial player origin. In locomotion tests it can be intentional movement, not automatically a defect.',
      'Scenario events, including the external shove, remain enabled during replay. This teaching environment is not PhysX or FireBlast source.',
    ],
  };
}

/** A small public input seam for future policies. Eight actions in [-1, 1]:
 * L xyz/grip, R xyz/grip. XYZ requests shoulder-relative hand offset in units of
 * maxArmLength, projected onto the unit ball. grip > 0 closes, otherwise opens.
 * Head stays at the reset pose; hand rotations are identity. This interface does
 * not claim compatibility with any existing 36-observation climbing brain.
 */
export const ACTION_SCHEMA = Object.freeze(['left.x', 'left.y', 'left.z', 'left.grip', 'right.x', 'right.y', 'right.z', 'right.grip']);
const axisFields = (name, scale, unit) => ['x', 'y', 'z'].map(axis => ({ name: `${name}.${axis}`, scale, unit }));
export const OBSERVATION_SCHEMA = Object.freeze([
  ...axisFields('player.displacement', 5, 'm'), ...axisFields('player.velocity', 10, 'm/s'),
  ...['left', 'right'].flatMap(side => [
    ...axisFields(`${side}.localTarget`, 2, 'm'), ...axisFields(`${side}.localVelocity`, 10, 'm/s'),
    { name: `${side}.held`, scale: 1, unit: 'boolean' }, { name: `${side}.contact`, scale: 1, unit: 'boolean' },
    { name: `${side}.heldGap`, scale: 1, unit: 'm' },
  ]),
  ...axisFields('cube.relativePosition', 5, 'm'), ...axisFields('cube.velocity', 10, 'm/s'),
].map(Object.freeze));

export class GrabEnvironment {
  constructor(config = {}) { this.reset(config); }
  reset(patch = {}) {
    this.lab?.dispose();
    this.config = configOf({ ...this.config, ...patch });
    this.mode = patch.mode ?? this.mode ?? 'backward';
    if (!MODES.some(m => m.id === this.mode)) throw new Error(`Unknown grab controller: ${this.mode}`);
    this.lab = makeLab(this.config, this.mode, false);
    this.origin = vec(this.lab.playerBody.position);
    this.steps = 0;
    this.finished = false;
    return this.observe();
  }
  observe() {
    const lab = this.lab, raw = [];
    const push = v => raw.push(v.x, v.y, v.z);
    push({ x: lab.rigPosition.x - this.origin.x, y: lab.rigPosition.y - this.origin.y, z: lab.rigPosition.z - this.origin.z });
    push(lab.playerBody.velocity);
    for (const hand of lab.hands) {
      push(hand.localPosition); push(hand.localVelocity);
      raw.push(Number(Boolean(hand.grab)), Number(hand.contact), hand.grab ? distance(hand.target, hand.physical) : 0);
    }
    const cube = lab.items.find(i => i.id === 'cube');
    push(cube ? { x: cube.body.position.x - lab.rigPosition.x, y: cube.body.position.y - lab.rigPosition.y, z: cube.body.position.z - lab.rigPosition.z } : { x: 0, y: 0, z: 0 });
    push(cube?.body.velocity ?? { x: 0, y: 0, z: 0 });
    return { schema: ENVIRONMENT_FORMAT, raw, values: raw.map((v, i) => clamp(v / OBSERVATION_SCHEMA[i].scale, -5, 5)), time: lab.time };
  }
  step(action) {
    if (this.finished) throw new Error('Episode ended. Call reset() before another action.');
    if (!action || action.length !== 8 || !Array.from(action).every(v => Number.isFinite(v) && v >= -1 && v <= 1)) throw new Error('Action must contain eight finite values in [-1, 1].');
    const head = this.lab.input.head.position;
    const hands = [0, 1].map(i => {
      const off = i * 4, radius = Math.max(1, Math.hypot(action[off], action[off + 1], action[off + 2]));
      const scale = this.lab.params.maxArmLength / radius;
      return { position: { x: head.x + (i ? 0.18 : -0.18) + action[off] * scale, y: head.y - 0.25 + action[off + 1] * scale, z: head.z + action[off + 2] * scale }, quaternion: { x: 0, y: 0, z: 0, w: 1 }, grip: action[off + 3] > 0 };
    });
    this.lab.setInput({ hands });
    this.lab.step(1 / this.config.hz);
    this.steps++;
    const reason = simulationFailure(this.lab);
    const terminated = Boolean(reason);
    const truncated = !terminated && this.steps >= Math.round(this.config.duration * this.config.hz);
    this.finished = terminated || truncated;
    return {
      observation: this.observe(), reward: null, terminated, truncated,
      info: { reason: reason ?? (truncated ? 'Time limit' : null), rewardDefinition: 'No task reward assigned. Define and validate a task-specific objective before training.', metrics: { ...this.lab.metrics } },
    };
  }
  dispose() { this.lab?.dispose(); this.lab = null; this.finished = true; }
}
