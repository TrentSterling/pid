#!/usr/bin/env node
// Trains the shipped Monke PPO brain with the same Trainer the page's worker uses.
//   node scripts/train-monke.mjs --seed 1 --minutes 5 --out gtag/ppo/brain.json
import { writeFile } from 'node:fs/promises';
import { Trainer, evaluate } from '../gtag/rl/trainer.js';
import { LEVELS } from '../gtag/rl/task.js';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const seed = Number(arg('seed', 1)), minutes = Number(arg('minutes', 5)), out = arg('out', '');
const trainer = new Trainer({ seed });
const started = Date.now();
let stats;
while ((Date.now() - started) / 60000 < minutes) {
  stats = trainer.iterate();
  if (stats.promoted || stats.iterations % 20 === 0) console.log(`${stats.iterations}\t${(stats.decisions / 1000).toFixed(0)}k\t${Math.round((Date.now() - started) / 1000)}s\tpad ${LEVELS[stats.level]} m\treturn ${stats.meanReturn.toFixed(1)}\tsuccess ${(stats.successRate * 100).toFixed(0)}%${stats.promoted ? '\tPROMOTED' : ''}`);
}
const brain = trainer.brain({ source: 'shipped', threads: 1 });
const score = d => evaluate(brain, { episodes: 100, deterministic: d });
const mean = score(true), sampled = score(false), wide = evaluate(brain, { episodes: 100, spawnJitter: 0.6 });
console.log('held-out, mean action:', mean, '\nheld-out, sampled:', sampled, '\nheld-out, double spawn jitter:', wide);
brain.meta.evalEpisodes = mean.episodes; brain.meta.evalSuccess = mean.successRate; brain.meta.evalSuccessWide = wide.successRate; brain.meta.evalMeanSeconds = mean.meanSuccessSeconds;
if (out) { await writeFile(out, JSON.stringify(brain)); console.log('wrote', out); }
