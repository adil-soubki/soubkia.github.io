// Background worker: L2 probing and L3 SAT search, off the main thread.

import { buildInstance } from './engine/build.js';
import { Board } from './engine/state.js';
import { probe } from './engine/probe.js';
import { solve } from './engine/sat.js';

let inst = null;

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      inst = buildInstance(m.spec);
      self.postMessage({ type: 'ready', N: inst.N });
    } else if (m.type === 'probe') {
      const b = new Board(inst, m.K);
      for (let v = 0; v < inst.N; v++) if (m.col[v]) b.set(v, m.col[v]);
      const r = probe(b, { deadline: performance.now() + (m.timeLimitMs || 4000) });
      const elims = [];
      for (const [key, why] of r.reasons) {
        const v = Math.floor(key / b.S), c = key % b.S;
        elims.push([v, c, why.dead, why.chain]);
      }
      self.postMessage({ type: 'probe', id: m.id, elims, deadVertex: r.deadVertex, timedOut: r.timedOut, trials: r.trials });
    } else if (m.type === 'solve') {
      const r = solve(inst, m.K, m.fixed, {
        timeLimitMs: m.timeLimitMs || Infinity,
        seed: m.seed || 1,
        onProgress: (s) => self.postMessage({ type: 'progress', id: m.id, stats: s }),
      });
      self.postMessage({ type: 'solve', id: m.id, status: r.status, col: r.col || null, stats: r.stats, why: r.why || null });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: String(err && err.message || err) });
  }
};
