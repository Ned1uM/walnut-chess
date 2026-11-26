import { reviewGame } from './game-report.mjs';

self.onmessage = ({ data }) => {
  try {
    const report = reviewGame(data.moves, (stage, done, total) => {
      self.postMessage({ kind: 'progress', stage, done, total });
    });
    self.postMessage({ kind: 'ready', report });
  } catch {
    self.postMessage({ kind: 'failed' });
  }
};
