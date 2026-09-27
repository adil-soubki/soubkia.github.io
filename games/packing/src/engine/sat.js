// L3: SAT encoding of "packing-color this instance with colors 1..K", DIMACS export and
// solution import, and a compact CDCL solver specialized to the encoding.
//
// Variable x(v, c) (v = chunk vertex, 1 <= c <= K) is DIMACS variable v*K + c.
// Clauses:
//   at least one color per vertex:        x(v,1) ∨ ... ∨ x(v,K)
//   packing constraint, d*(v,u) <= c:      ¬x(v,c) ∨ ¬x(u,c)
//   self-conflict, d*(v,v) <= c:           ¬x(v,c)
//   fixed placements:                      x(v, col[v])
// A vertex set to several colors can keep any one of them (all binaries are negative).

import { NONE } from './tables.js';

export const dimacsVar = (v, c, K) => v * K + c;

export function encodingStats(inst, K) {
  let bin = 0;
  for (let v = 0; v < inst.N; v++) {
    for (let h = inst.nearStart[v]; h < inst.nearStart[v + 1]; h++) {
      const u = inst.nearIdx[h], d = inst.nearDist[h];
      if (u > v && d <= K) bin += K - d + 1;
    }
  }
  return { vars: inst.N * K, binaries: bin };
}

export function toDimacs(inst, K, fixed = null, meta = {}) {
  const lines = [];
  const clauses = [];
  const N = inst.N;
  for (let v = 0; v < N; v++) {
    const alo = [];
    for (let c = 1; c <= K; c++) alo.push(dimacsVar(v, c, K));
    clauses.push(alo.join(' ') + ' 0');
    const sd = inst.selfDist[v];
    if (sd !== NONE) for (let c = Math.max(1, sd); c <= K; c++) clauses.push(`-${dimacsVar(v, c, K)} 0`);
    if (fixed && fixed[v]) clauses.push(`${dimacsVar(v, fixed[v], K)} 0`);
  }
  for (let v = 0; v < N; v++) {
    for (let h = inst.nearStart[v]; h < inst.nearStart[v + 1]; h++) {
      const u = inst.nearIdx[h], d = inst.nearDist[h];
      if (u <= v || d > K) continue;
      for (let c = Math.max(1, d); c <= K; c++) clauses.push(`-${dimacsVar(v, c, K)} -${dimacsVar(u, c, K)} 0`);
    }
  }
  lines.push('c Packing coloring CNF (Packing Coloring Lab)');
  lines.push(`c meta ${JSON.stringify({ ...meta, N, K })}`);
  lines.push(`c variable v*K + c  <=>  chunk vertex v (0-based) has color c (1..${K})`);
  lines.push('c solve with e.g.  kissat file.cnf > out.txt   and import out.txt back into the game');
  lines.push(`p cnf ${N * K} ${clauses.length}`);
  return lines.concat(clauses).join('\n') + '\n';
}

// Parse solver output ("s SATISFIABLE" / "v 1 -2 3 ... 0" lines, or a bare list of literals).
export function parseSolution(text, N, K) {
  if (/^s\s+UNSAT/im.test(text)) return { status: 'unsat' };
  const vlines = text.split('\n').filter(l => /^v\s/.test(l));
  const body = vlines.length ? vlines.map(l => l.slice(1)).join(' ') : text.split('\n').filter(l => !/^[cs]\s|^[cs]$/.test(l)).join(' ');
  const col = new Uint8Array(N);
  let any = false;
  for (const tok of body.split(/\s+/)) {
    if (!/^-?\d+$/.test(tok)) continue;
    const x = parseInt(tok, 10);
    if (x <= 0 || x > N * K) continue;
    const v = Math.floor((x - 1) / K), c = ((x - 1) % K) + 1;
    if (!col[v]) col[v] = c;
    any = true;
  }
  if (!any) throw new Error('No positive literals found in the solver output.');
  return { status: 'sat', col };
}

// ------------------------------------------------------------------------------------------
// CDCL solver. Implicit binary clauses come straight from the d* table: when x(v,c) becomes
// true, every u with d*(v,u) <= c gets ¬x(u,c). Other clauses (at-least-one per vertex and
// learned clauses) use two watched literals. 1-UIP learning, VSIDS, Luby restarts.

export function solve(inst, K, fixed = null, opts = {}) {
  const {
    timeLimitMs = Infinity, onProgress = null, shouldStop = null,
    now = () => performance.now(), seed = 1,
  } = opts;
  const t0 = now();
  const deadline = t0 + timeLimitMs;
  const N = inst.N, V = N * K;
  const { nearStart, nearIdx, nearDist, selfDist } = inst;
  const stats = { conflicts: 0, decisions: 0, propagations: 0, learned: 0, restarts: 0, bestSatisfied: 0 };

  const assign = new Int8Array(V);
  const level = new Int32Array(V);
  const reason = new Int32Array(V).fill(-1); // -1 none, >= 0 clause, <= -2 binary from var (-r-2)
  const trail = new Int32Array(V);
  let trailLen = 0, qhead = 0;
  const trailLim = [];
  const trueCount = new Uint16Array(N);
  let satisfied = 0;
  const clauses = [];
  const learned = [];
  const clauseAct = [];
  const watches = Array.from({ length: 2 * V }, () => []);
  const activity = new Float64Array(V);
  let varInc = 1, claInc = 1;
  const seen = new Uint8Array(V);
  const allowed = new Uint8Array(V); // not self-blocked

  const value = lit => { const a = assign[lit >> 1]; return (lit & 1) ? -a : a; };

  // --- heap over variables (max activity) ---
  const heap = [], hpos = new Int32Array(V).fill(-1);
  const hless = (a, b) => activity[a] > activity[b];
  function hUp(i) {
    const x = heap[i];
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!hless(x, heap[p])) break;
      heap[i] = heap[p]; hpos[heap[i]] = i; i = p;
    }
    heap[i] = x; hpos[x] = i;
  }
  function hDown(i) {
    const x = heap[i], n = heap.length;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && hless(heap[c + 1], heap[c])) c++;
      if (!hless(heap[c], x)) break;
      heap[i] = heap[c]; hpos[heap[i]] = i; i = c;
    }
    heap[i] = x; hpos[x] = i;
  }
  function hInsert(x) { if (hpos[x] >= 0) return; heap.push(x); hpos[x] = heap.length - 1; hUp(heap.length - 1); }
  function hPop() {
    const x = heap[0], last = heap.pop();
    hpos[x] = -1;
    if (heap.length) { heap[0] = last; hpos[last] = 0; hDown(0); }
    return x;
  }

  function bumpVar(x) {
    activity[x] += varInc;
    if (activity[x] > 1e100) { for (let i = 0; i < V; i++) activity[i] *= 1e-100; varInc *= 1e-100; }
    if (hpos[x] >= 0) hUp(hpos[x]);
  }
  function bumpClause(ci) {
    clauseAct[ci] += claInc;
    if (clauseAct[ci] > 1e20) { for (let i = 0; i < clauseAct.length; i++) clauseAct[i] *= 1e-20; claInc *= 1e-20; }
  }

  function enqueue(lit, why) {
    const x = lit >> 1;
    assign[x] = (lit & 1) ? -1 : 1;
    level[x] = trailLim.length;
    reason[x] = why;
    trail[trailLen++] = lit;
    if (!(lit & 1)) {
      const v = (x / K) | 0;
      if (trueCount[v]++ === 0) satisfied++;
    }
  }

  function addClause(lits, isLearned) {
    const ci = clauses.length;
    clauses.push(Int32Array.from(lits));
    learned.push(isLearned ? 1 : 0);
    clauseAct.push(0);
    watches[lits[0]].push(ci);
    watches[lits[1]].push(ci);
    return ci;
  }

  // Returns null, or an array of literals that are all false (the conflict clause).
  function propagate() {
    while (qhead < trailLen) {
      const lit = trail[qhead++];
      const x = lit >> 1;
      stats.propagations++;
      if (!(lit & 1)) {
        const v = (x / K) | 0, c = x - v * K + 1;
        const end = nearStart[v + 1];
        for (let h = nearStart[v]; h < end; h++) {
          if (nearDist[h] > c) break;
          const u = nearIdx[h];
          if (u === v) continue;
          const y = u * K + c - 1;
          const a = assign[y];
          if (a === 1) return [2 * x + 1, 2 * y + 1];
          if (a === 0) enqueue(2 * y + 1, -2 - x);
        }
      }
      const falseLit = lit ^ 1;
      const ws = watches[falseLit];
      let i = 0, j = 0;
      const n = ws.length;
      while (i < n) {
        const ci = ws[i++];
        const cl = clauses[ci];
        if (cl === null) continue; // deleted
        if (cl[0] === falseLit) { cl[0] = cl[1]; cl[1] = falseLit; }
        const first = cl[0];
        if (value(first) === 1) { ws[j++] = ci; continue; }
        let moved = false;
        for (let k = 2; k < cl.length; k++) {
          if (value(cl[k]) !== -1) {
            cl[1] = cl[k]; cl[k] = falseLit;
            watches[cl[1]].push(ci);
            moved = true;
            break;
          }
        }
        if (moved) continue;
        ws[j++] = ci;
        if (value(first) === -1) {
          while (i < n) ws[j++] = ws[i++];
          ws.length = j;
          qhead = trailLen;
          return cl;
        }
        enqueue(first, ci);
      }
      ws.length = j;
    }
    return null;
  }

  function reasonLits(x) {
    const r = reason[x];
    if (r >= 0) { if (learned[r]) bumpClause(r); return clauses[r]; }
    return [2 * x + 1, 2 * (-r - 2) + 1];
  }

  function analyze(confl) {
    const out = [0];
    let pathC = 0, p = -1, idx = trailLen - 1;
    const cur = trailLim.length;
    let lits = confl;
    for (;;) {
      for (let k = 0; k < lits.length; k++) {
        const q = lits[k], y = q >> 1;
        if (p !== -1 && y === (p >> 1)) continue;
        if (seen[y] || level[y] === 0) continue;
        seen[y] = 1;
        bumpVar(y);
        if (level[y] >= cur) pathC++;
        else out.push(q);
      }
      do { p = trail[idx--]; } while (!seen[p >> 1]);
      seen[p >> 1] = 0;
      pathC--;
      if (pathC === 0) break;
      lits = reasonLits(p >> 1);
    }
    out[0] = p ^ 1;
    // basic minimization: drop q if its reason's other literals are all seen or at level 0
    const toClear = out.slice(1);
    let j = 1;
    for (let i = 1; i < out.length; i++) {
      const y = out[i] >> 1;
      if (reason[y] === -1) { out[j++] = out[i]; continue; }
      const rl = reason[y] >= 0 ? clauses[reason[y]] : [2 * y + 1, 2 * (-reason[y] - 2) + 1];
      let keep = false;
      for (const r of rl) {
        const z = r >> 1;
        if (z !== y && !seen[z] && level[z] > 0) { keep = true; break; }
      }
      if (keep) out[j++] = out[i];
    }
    for (const q of toClear) seen[q >> 1] = 0;
    out.length = j;
    let bt = 0;
    if (out.length > 1) {
      let m = 1;
      for (let i = 2; i < out.length; i++) if (level[out[i] >> 1] > level[out[m] >> 1]) m = i;
      [out[1], out[m]] = [out[m], out[1]];
      bt = level[out[1] >> 1];
    }
    return { lits: out, bt };
  }

  const skipped = []; // [var, level] popped from the heap because their vertex was satisfied
  function backtrack(lv) {
    if (trailLim.length <= lv) return;
    const lim = trailLim[lv];
    for (let i = trailLen - 1; i >= lim; i--) {
      const lit = trail[i], x = lit >> 1;
      assign[x] = 0;
      reason[x] = -1;
      if (!(lit & 1)) { const v = (x / K) | 0; if (--trueCount[v] === 0) satisfied--; }
      if (allowed[x]) hInsert(x);
    }
    trailLen = lim;
    qhead = lim;
    trailLim.length = lv;
    while (skipped.length && skipped[skipped.length - 1][1] > lv) hInsert(skipped.pop()[0]);
  }

  function pickBranch() {
    while (heap.length) {
      const x = hPop();
      if (assign[x] !== 0) continue;
      const v = (x / K) | 0;
      if (trueCount[v] > 0) { skipped.push([x, trailLim.length]); continue; }
      return x;
    }
    return -1;
  }

  function reduceDB() {
    const cand = [];
    for (let ci = 0; ci < clauses.length; ci++) {
      const cl = clauses[ci];
      if (!learned[ci] || cl === null || cl.length <= 2) continue;
      const x = cl[0] >> 1;
      if (reason[x] === ci && value(cl[0]) === 1) continue; // locked
      cand.push(ci);
    }
    cand.sort((a, b) => clauseAct[a] - clauseAct[b]);
    for (let i = 0; i < cand.length / 2; i++) { clauses[cand[i]] = null; stats.learned--; }
  }

  const luby = (i) => {
    let size = 1, seq = 0;
    while (size < i + 1) { seq++; size = 2 * size + 1; }
    let x = i;
    while (size - 1 !== x) { size = (size - 1) >> 1; seq--; x = x % size; }
    return 2 ** seq;
  };

  const finish = (status, extra = {}) => {
    stats.timeMs = Math.round(now() - t0);
    return { status, stats, ...extra };
  };

  // --- set up ---
  let rnd = seed >>> 0 || 1;
  const rand = () => { rnd ^= rnd << 13; rnd >>>= 0; rnd ^= rnd >>> 17; rnd ^= rnd << 5; rnd >>>= 0; return rnd / 4294967296; };
  for (let v = 0; v < N; v++) {
    const sd = selfDist[v];
    for (let c = 1; c <= K; c++) {
      const x = v * K + c - 1;
      allowed[x] = sd === NONE || c < sd ? 1 : 0;
      activity[x] = (c / K) * 1e-3 + rand() * 1e-5; // prefer placing big colors first
    }
  }
  const units = [];
  for (let v = 0; v < N; v++) {
    const lits = [];
    for (let c = 1; c <= K; c++) if (allowed[v * K + c - 1]) lits.push(2 * (v * K + c - 1));
    if (!lits.length) return finish('unsat', { why: `vertex ${v} cannot take any color 1..${K} in this chunk` });
    if (lits.length === 1) units.push(lits[0]);
    else addClause(lits, false);
    const f = fixed ? fixed[v] : 0;
    if (f) {
      if (f > K || !allowed[v * K + f - 1]) return finish('unsat', { why: `fixed color ${f} at vertex ${v} is impossible here` });
      units.push(2 * (v * K + f - 1));
    }
  }
  for (let x = 0; x < V; x++) if (allowed[x]) hInsert(x);
  for (const u of units) {
    const a = value(u);
    if (a === -1) return finish('unsat', { why: 'the fixed colors conflict' });
    if (a === 0) enqueue(u, -1);
  }
  if (propagate()) return finish('unsat', { why: fixed ? 'the fixed colors conflict or cannot be extended' : 'no coloring exists' });

  // --- search ---
  let restartIdx = 0, conflictsToRestart = 100 * luby(0);
  let maxLearned = Math.max(4000, V / 2);
  let lastReport = t0;
  for (;;) {
    const confl = propagate();
    if (confl) {
      stats.conflicts++;
      if (trailLim.length === 0) return finish('unsat');
      const { lits, bt } = analyze(confl);
      backtrack(bt);
      if (lits.length === 1) enqueue(lits[0], -1);
      else {
        const ci = addClause(lits, true);
        stats.learned++;
        bumpClause(ci);
        enqueue(lits[0], ci);
      }
      varInc /= 0.95;
      claInc /= 0.999;
      if (--conflictsToRestart <= 0) {
        stats.restarts++;
        conflictsToRestart = 100 * luby(++restartIdx);
        backtrack(0);
      }
      if (stats.learned > maxLearned) { reduceDB(); maxLearned *= 1.1; }
      if ((stats.conflicts & 127) === 0) {
        const t = now();
        if (t > deadline || (shouldStop && shouldStop())) return finish('unknown');
        if (onProgress && t - lastReport > 250) { lastReport = t; onProgress({ ...stats, satisfied, N, timeMs: Math.round(t - t0) }); }
      }
    } else {
      if (satisfied > stats.bestSatisfied) stats.bestSatisfied = satisfied;
      if (satisfied === N) {
        const col = new Uint8Array(N);
        for (let x = 0; x < V; x++) if (assign[x] === 1) { const v = (x / K) | 0; if (!col[v]) col[v] = x - v * K + 1; }
        return finish('sat', { col });
      }
      const x = pickBranch();
      if (x < 0) return finish('unknown', { why: 'internal: no branch variable' });
      stats.decisions++;
      if ((stats.decisions & 1023) === 0) {
        const t = now();
        if (t > deadline || (shouldStop && shouldStop())) return finish('unknown');
        if (onProgress && t - lastReport > 250) { lastReport = t; onProgress({ ...stats, satisfied, N, timeMs: Math.round(t - t0) }); }
      }
      trailLim.push(trailLen);
      enqueue(2 * x, -1);
    }
  }
}
