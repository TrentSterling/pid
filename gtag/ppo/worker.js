// Training thread. Runs the same Trainer the Node tests use and reports after every update.
import { Trainer } from '../rl/trainer.js';

let trainer = null, running = false, token = 0;

function report(stats) {
  postMessage({ type: 'stats', stats, brain: trainer.brain({ source: 'live' }) });
}

function loop(mine) {
  if (!running || mine !== token) return;
  const stats = trainer.iterate();
  report(stats);
  setTimeout(() => loop(mine), 0); // yield so pause / reset messages get through
}

onmessage = ({ data }) => {
  try {
    if (data.type === 'init') {
      running = false; token++;
      trainer = new Trainer({ seed: data.seed, brain: data.brain || undefined });
      report(trainer.stats());
    } else if (data.type === 'start' && trainer) {
      if (!running) { running = true; token++; loop(token); }
    } else if (data.type === 'pause') {
      running = false; token++;
    }
  } catch (error) {
    postMessage({ type: 'error', message: String(error?.message || error) });
  }
};
postMessage({ type: 'ready' });
