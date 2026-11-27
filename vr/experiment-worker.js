// Terminate this worker to cancel a run. The main UI never executes the batch.
import { compareControllers } from './experiments.js';

self.onmessage = ({ data }) => {
  if (data?.type !== 'compare') return;
  const requestId = data.requestId ?? null;
  try {
    const result = compareControllers(data.config ?? {}, progress => {
      self.postMessage({ type: 'progress', requestId, ...progress });
    });
    self.postMessage({ type: 'result', requestId, result });
  } catch (error) {
    self.postMessage({ type: 'error', requestId, message: error instanceof Error ? error.message : String(error) });
  }
};
