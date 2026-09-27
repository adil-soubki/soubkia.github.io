// L2: failed-literal probing ("what if?"). For every uncolored vertex v and candidate c,
// tentatively place c at v and run L1 (fill forced singles). If that ends with some vertex
// having no candidates, then c can never go at v in a completion within budget K, so it is
// eliminated. Repeat until nothing changes. Every elimination keeps its explanation.

import { ORIGIN } from './state.js';

// Placing c at v can only start a cascade if some zone vertex has c as a candidate and at
// most 2 candidates (it would drop to 1 or 0).
function mightFail(board, v, c) {
  const { inst, col, candCount } = board;
  const end = inst.nearStart[v + 1];
  for (let h = inst.nearStart[v]; h < end; h++) {
    if (inst.nearDist[h] > c) break;
    const u = inst.nearIdx[h];
    if (u !== v && !col[u] && candCount[u] <= 2 && board.isCandidate(u, c)) return true;
  }
  return false;
}

function trial(board, v, c) {
  const { inst, col } = board;
  const trail = [v];
  const chain = [];
  board.set(v, c, ORIGIN.AUTO);
  const queue = board.zoneSeeds(v, c);
  let dead = -1;
  for (let q = 0; q < queue.length; q++) {
    const u = queue[q];
    if (col[u]) continue;
    const n = board.candCount[u];
    if (n === 0) { dead = u; break; }
    if (n !== 1) continue;
    const d = board.onlyCandidate(u);
    board.set(u, d, ORIGIN.AUTO);
    trail.push(u);
    chain.push([u, d]);
    const end = inst.nearStart[u + 1];
    for (let h = inst.nearStart[u]; h < end; h++) {
      if (inst.nearDist[h] > d) break;
      const w = inst.nearIdx[h];
      if (!col[w] && board.candCount[w] <= 1) queue.push(w);
    }
  }
  for (let i = trail.length - 1; i >= 0; i--) board.set(trail[i], 0);
  return dead >= 0 ? { chain, dead } : null;
}

// Runs to a fixpoint (or until deadline, a performance.now() timestamp). Eliminations are
// written into the board (board.addElim); reasons maps v * board.S + c -> { chain, dead }.
export function probe(board, { deadline = Infinity, now = () => performance.now() } = {}) {
  const reasons = new Map();
  const { N, K, S } = board;
  if (board._step) throw new Error('probe() must not run inside an open history step');
  board.keepElims = true;
  let changed = true, rounds = 0, timedOut = false, deadVertex = -1, trials = 0;
  try {
    outer: while (changed) {
      changed = false;
      rounds++;
      for (let v = 0; v < N; v++) {
        if (board.col[v]) continue;
        if (board.candCount[v] === 0) { deadVertex = v; break outer; }
        for (let c = 1; c <= K; c++) {
          if (!board.isCandidate(v, c) || !mightFail(board, v, c)) continue;
          trials++;
          const r = trial(board, v, c);
          if (r) {
            board.addElim(v, c);
            reasons.set(v * S + c, r);
            changed = true;
            if (board.candCount[v] === 0) { deadVertex = v; break outer; }
          }
          if ((trials & 63) === 0 && now() > deadline) { timedOut = true; break outer; }
        }
      }
    }
  } finally {
    board.keepElims = false;
  }
  return { reasons, deadVertex, rounds, trials, timedOut };
}
