// Shared "near" tables: for every vertex v, the list of vertices u with d*(v, u) <= R, sorted
// by distance. Stored flat: entries nearStart[v] .. nearStart[v+1]-1 of nearIdx / nearDist.

export const NONE = 255; // "no copy within R"

// fill(v, emit) must call emit(u, d) in nondecreasing order of d; emit returns true the first
// time a given u is seen for this v (later, larger distances are ignored).
export function packNear(N, maxPer, fill) {
  const cap = Math.max(1, N * maxPer);
  const idx = N <= 65535 ? new Uint16Array(cap) : new Uint32Array(cap);
  const dist = new Uint8Array(cap);
  const start = new Int32Array(N + 1);
  const stamp = new Int32Array(N).fill(-1);
  let n = 0;
  for (let v = 0; v < N; v++) {
    start[v] = n;
    fill(v, (u, d) => {
      if (stamp[u] === v) return false;
      stamp[u] = v;
      idx[n] = u; dist[n] = d; n++;
      return true;
    });
  }
  start[N] = n;
  return { start, idx: idx.slice(0, n), dist: dist.slice(0, n) };
}

// d*(v, u), or NONE if greater than R. Linear scan; use only outside hot loops.
export function dstar(inst, v, u) {
  for (let h = inst.nearStart[v]; h < inst.nearStart[v + 1]; h++) if (inst.nearIdx[h] === u) return inst.nearDist[h];
  return NONE;
}
