import { search } from './engine.mjs';

self.onmessage = ({ data }) => {
  try {
    self.postMessage({ result: search(data) });
  } catch {
    self.postMessage({ error: true });
  }
};
