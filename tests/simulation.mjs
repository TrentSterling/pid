import assert from 'node:assert/strict';
import { GymSimulation, CONTROLLERS, EXERCISES, DEFAULTS } from '../sim.js';

const run = (sim, seconds, observe = () => {}) => {
  const dt = 1 / sim.params.hz;
  for (let step = 0; step < Math.round(seconds / dt); step++) {
    sim.step(dt);
    observe(sim);
  }
};

assert.equal(CONTROLLERS.length, 8);
assert.equal(EXERCISES.length, 7);
const first = new GymSimulation({ trackingNoise: true });
const second = new GymSimulation({ trackingNoise: true });
run(first, 5);
// Rendering can run at a different rate without changing the fixed-step inputs.
for (let frame = 0; frame < 150; frame++) for (let tick = 0; tick < 3; tick++) second.step(1 / 90);
assert.deepEqual(first.players, second.players);
assert.equal(first.time, second.time);
console.log('PASS: deterministic inputs and state across different render groupings');

for (const exercise of ['floor', 'wall', 'climb', 'pressure', 'ceiling']) {
  const sim = new GymSimulation();
  sim.setExercise(exercise);
  const touched = Array(8).fill(false);
  run(sim, 6, s => s.players.forEach((player, index) => { touched[index] ||= player.stats.contacts > 0; }));
  assert.ok(touched.every(Boolean), `${exercise}: every lane must reach its test surface`);
  if (exercise === 'floor') assert.ok(sim.players.every(player => player.stats.peakHeight > 1), 'floor pushes must visibly lift every player');
}
console.log('PASS: default contact exercises reach the intended surfaces; floor pushes lift all eight players');

const resting = new GymSimulation({ inputSpeed: 0 });
resting.setExercise('air');
const hand = resting.players[3].hands[0];
hand.position.x += 0.2;
let previousError = 0.2;
run(resting, 2, () => {
  const error = Math.abs(hand.position.x - hand.target.x);
  assert.ok(error <= previousError + 1e-12, 'critically damped backward correction should decay without rebound');
  previousError = error;
});
assert.ok(previousError < 1e-5);
console.log('PASS: a displaced backward-PD hand settles against a stationary reference without rebound');

const longRun = new GymSimulation({ frequency: 30, damping: 0.05, maxAccel: 1000, hz: 30, trackingNoise: true });
run(longRun, 180, sim => {
  for (const player of sim.players) {
    assert.ok([player.body.x, player.body.y, player.body.z, player.stats.error, player.stats.rms, player.stats.force].every(Number.isFinite));
    for (const h of player.hands) assert.ok([h.position.x, h.position.y, h.position.z, h.velocity.x, h.velocity.y, h.velocity.z].every(Number.isFinite));
    assert.ok(player.history.length <= 360);
    assert.ok(player.history.length === 0 || player.history[0][0] >= sim.time - 12 - 1e-8);
  }
});
console.log('PASS: three-minute high-gain stress run stays finite with bounded telemetry (this is not a stability proof)');

const validated = new GymSimulation();
validated.setParams({ frequency: Infinity, damping: NaN, bodyMass: -10, startDistance: 100, hz: '120', trackingNoise: true });
assert.equal(validated.params.frequency, DEFAULTS.frequency);
assert.equal(validated.params.damping, DEFAULTS.damping);
assert.equal(validated.params.bodyMass, 20);
assert.equal(validated.params.startDistance, 3);
assert.equal(validated.params.hz, 120);
assert.equal(validated.params.trackingNoise, true);
validated.step(NaN); validated.step(-1);
assert.equal(validated.time, 0);
validated.setParams({ startDistance: 2 });
assert.equal(validated.players[0].body.z, -0.5);
console.log('PASS: invalid numeric controls are contained; starting distance applies to the active exercise');
