import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MODES } from '../physics.js';
import { recordScenario, replayTrace, compareControllers, inputHash, validateTrace, GrabEnvironment, ACTION_SCHEMA, OBSERVATION_SCHEMA } from '../experiments.js';

test('fixed scene records deterministically and identical replay preserves the input fingerprint', () => {
  const config = { scenario: 'workout', locomotion: 'off', hz: 60, duration: 3 };
  const a = recordScenario(config), b = recordScenario(config);
  assert.deepEqual(a, b);
  const first = replayTrace(a, 'backward'), second = replayTrace(a, 'backward');
  assert.deepEqual(first, second);
  assert.equal(first.inputHash, a.inputHash);
  assert.ok(first.heldSamples > 0);
  assert.ok(first.rmsGapCm > 0);
});

test('all grab controllers receive exactly the same recorded body-local input', () => {
  const result = compareControllers({ scenario: 'workout', locomotion: 'cast', hz: 90 });
  assert.equal(result.rows.length, MODES.length);
  assert.equal(result.learning, false);
  for (const row of result.rows) {
    assert.equal(row.inputHash, result.trace.inputHash, row.modeId);
    assert.equal(row.terminated, false);
    assert.ok(row.heldGivenGripFraction > 0.8, `${row.modeId} missed its requested grab`);
  }
});

test('a no-grab scenario has null tracking scores and zero hold coverage', () => {
  const trace = recordScenario({ scenario: 'airborne', locomotion: 'off', duration: 1, hz: 72 });
  const row = replayTrace(trace, 'relative');
  assert.equal(row.heldFraction, 0);
  assert.equal(row.heldGivenGripFraction, null);
  assert.equal(row.rmsGapCm, null);
  assert.equal(row.peakGapCm, null);
  assert.equal(row.capFraction, null);
  assert.ok(row.driftM < 1e-8);
});

test('force-limit saturation is measured over held samples rather than empty-hand time', () => {
  const trace = recordScenario({ scenario: 'wall', locomotion: 'off', duration: 3, hz: 60, params: { maxForce: 1 } });
  const row = replayTrace(trace, 'relative');
  assert.ok(row.heldSamples > 0);
  assert.ok(row.capFraction > 0.5 && row.capFraction <= 1);
  assert.ok(row.heldFraction < 1);
});

test('the scheduled shove occurs once during recorded-input replay', () => {
  const trace = recordScenario({ scenario: 'shove', locomotion: 'off', duration: 3, hz: 60 });
  const row = replayTrace(trace, 'oneway');
  assert.equal(row.trial.summary.externalImpulseNs, 90);
  assert.ok(row.driftM > 0.1);
  assert.equal(row.inputHash, trace.inputHash);
});

test('trace validation rejects corrupted inputs and unbounded runs', () => {
  const trace = recordScenario({ duration: 0.2, hz: 60 });
  const corrupt = structuredClone(trace);
  corrupt.frames[0].hands[0].position.x += 0.01;
  assert.throws(() => validateTrace(corrupt), /fingerprint/);
  corrupt.inputHash = inputHash(corrupt.frames);
  corrupt.frames[0].head.position.y = NaN;
  assert.throws(() => validateTrace(corrupt), /invalid/);
  assert.throws(() => recordScenario({ hz: 1000 }), /Hz/);
  assert.throws(() => recordScenario({ seed: 123 }), /fixed deterministic/);
});

test('public environment has eight validated actions, a stable 30-value observation and explicit time-limit truncation', () => {
  assert.equal(ACTION_SCHEMA.length, 8);
  assert.equal(OBSERVATION_SCHEMA.length, 30);
  const env = new GrabEnvironment({ scenario: 'airborne', locomotion: 'off', hz: 60, duration: 0.1 });
  const initial = env.observe();
  assert.equal(initial.values.length, 30);
  const action = [-0.1, -0.1, -0.3, -1, 0.1, -0.1, -0.3, -1];
  assert.throws(() => env.step([NaN, 0]), /eight finite/);
  let state;
  for (let i = 0; i < 6; i++) state = env.step(action);
  assert.equal(state.terminated, false);
  assert.equal(state.truncated, true);
  assert.equal(state.reward, null);
  assert.ok(state.observation.values.every(Number.isFinite));
  assert.throws(() => env.step(action), /Episode ended/);
  assert.deepEqual(env.reset(), initial);
  env.dispose();
});
