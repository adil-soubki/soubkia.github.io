// Coloring state on an instance (periodic chunk or finite graph).
//
// block[v][c] counts the reasons color c is illegal at v: colored-c vertices u != v with
// d*(v, u) <= c, plus one permanent "self" reason when v is within distance c of its own copy.
// Colored v with color c is in conflict  <=>  block[v][c] > 0.
// Candidates of v (under budget K)          =  { c <= K : block[v][c] = 0 and not eliminated }.
// Placing or erasing updates the counts incrementally in O(|ball(c)|).

import { NONE } from './tables.js';

export const ORIGIN = { NONE: 0, PLAYER: 1, AUTO: 2, SOLVER: 3, IMPORT: 4 };

export class Board {
  constructor(inst, K) {
    this.inst = inst;
    this.N = inst.N;
    this.R = inst.R;
    this.S = this.R + 1;
    this.col = new Uint8Array(this.N);
    this.origin = new Uint8Array(this.N);
    this.block = new Uint16Array(this.N * this.S);
    this.elim = new Uint8Array(this.N * this.S); // L2 eliminations (cleared on every change)
    this.elimCount = 0;
    this.keepElims = false; // set by the L2 prober while it makes trial placements
    this.candCount = new Uint8Array(this.N);
    this.conflictPairs = 0; // unordered pairs u != v, both color c, d* <= c
    this.selfConflicts = 0; // vertices colored c with a copy of themselves within c
    this.colored = 0;
    this.version = 0;
    for (let v = 0; v < this.N; v++) {
      const sd = inst.selfDist[v];
      if (sd !== NONE) for (let c = Math.max(1, sd); c <= this.R; c++) this.block[v * this.S + c] = 1;
    }
    this.history = [];
    this.future = [];
    this._step = null;
    this.setK(Math.min(K, this.R));
  }

  setK(K) {
    this.K = Math.max(1, Math.min(K, this.R));
    this._recount();
  }

  _recount() {
    const { N, S, K, block, elim } = this;
    for (let v = 0; v < N; v++) {
      let n = 0;
      for (let c = 1; c <= K; c++) if (block[v * S + c] === 0 && elim[v * S + c] === 0) n++;
      this.candCount[v] = n;
    }
  }

  isFree(v, c) { return this.block[v * this.S + c] === 0; }
  isCandidate(v, c) { const i = v * this.S + c; return c <= this.K && this.block[i] === 0 && this.elim[i] === 0; }

  candidates(v) {
    const out = [];
    for (let c = 1; c <= this.K; c++) if (this.isCandidate(v, c)) out.push(c);
    return out;
  }

  onlyCandidate(v) {
    for (let c = 1; c <= this.K; c++) if (this.isCandidate(v, c)) return c;
    return 0;
  }

  inConflict(v) { const c = this.col[v]; return c > 0 && this.block[v * this.S + c] > 0; }

  // Low-level: add (delta=+1) or remove (-1) the effect of color c at v.
  _apply(v, c, delta) {
    const { inst, block, S, K, elim, col } = this;
    const end = inst.nearStart[v + 1];
    for (let h = inst.nearStart[v]; h < end; h++) {
      if (inst.nearDist[h] > c) break;
      const u = inst.nearIdx[h];
      if (u === v) continue;
      const i = u * S + c;
      const before = block[i];
      block[i] = before + delta;
      if (c <= K && elim[i] === 0) {
        if (before === 0 && delta > 0) this.candCount[u]--;
        else if (before === 1 && delta < 0) this.candCount[u]++;
      }
      if (col[u] === c) this.conflictPairs += delta;
    }
    if (inst.selfDist[v] <= c) this.selfConflicts += delta;
  }

  // Set color of v to c (0 = erase). Records into the current step if one is open.
  set(v, c, origin = ORIGIN.PLAYER) {
    const old = this.col[v];
    if (old === c) return false;
    if (this.elimCount && !this.keepElims) this.clearElims();
    const oldOrigin = this.origin[v];
    if (old) { this._apply(v, old, -1); this.col[v] = 0; this.colored--; }
    if (c) { this.col[v] = c; this._apply(v, c, +1); this.colored++; }
    this.origin[v] = c ? origin : ORIGIN.NONE;
    this.version++;
    if (this._step) this._step.changes.push([v, old, oldOrigin, c, this.origin[v]]);
    return true;
  }

  // ---- L2 eliminations ----
  addElim(v, c) {
    const i = v * this.S + c;
    if (this.elim[i]) return;
    this.elim[i] = 1;
    this.elimCount++;
    if (c <= this.K && this.block[i] === 0) this.candCount[v]--;
  }
  removeElim(v, c) {
    const i = v * this.S + c;
    if (!this.elim[i]) return;
    this.elim[i] = 0;
    this.elimCount--;
    if (c <= this.K && this.block[i] === 0) this.candCount[v]++;
  }
  clearElims() {
    if (!this.elimCount) return;
    this.elim.fill(0);
    this.elimCount = 0;
    this._recount();
  }
  isElim(v, c) { return this.elim[v * this.S + c] === 1; }

  // ---- history (a step = one user action plus everything that followed from it) ----
  begin(label) { this._step = { label, changes: [] }; return this._step; }
  end() {
    const s = this._step;
    this._step = null;
    if (s && s.changes.length) { this.history.push(s); this.future = []; }
    return s;
  }
  // Re-open the most recent step (to append an asynchronous cascade to it).
  reopen(step) {
    if (this.history[this.history.length - 1] !== step) return false;
    this.history.pop();
    this._step = step;
    return true;
  }
  canUndo() { return this.history.length > 0; }
  canRedo() { return this.future.length > 0; }
  undo() {
    const s = this.history.pop();
    if (!s) return null;
    for (let i = s.changes.length - 1; i >= 0; i--) {
      const [v, old, oldOrigin] = s.changes[i];
      this._raw(v, old, oldOrigin);
    }
    this.future.push(s);
    return s;
  }
  redo() {
    const s = this.future.pop();
    if (!s) return null;
    for (const [v, , , c, o] of s.changes) this._raw(v, c, o);
    this.history.push(s);
    return s;
  }
  _raw(v, c, origin) {
    const saved = this._step;
    this._step = null;
    this.set(v, c, origin);
    this.origin[v] = c ? origin : 0;
    this._step = saved;
  }

  // ---- queries ----
  uncolored() { const out = []; for (let v = 0; v < this.N; v++) if (!this.col[v]) out.push(v); return out; }
  deadVertices() { const out = []; for (let v = 0; v < this.N; v++) if (!this.col[v] && this.candCount[v] === 0) out.push(v); return out; }
  forcedVertices() { const out = []; for (let v = 0; v < this.N; v++) if (!this.col[v] && this.candCount[v] === 1) out.push(v); return out; }
  conflictCount() { return this.conflictPairs + this.selfConflicts; }
  maxColor() { let m = 0; for (const c of this.col) if (c > m) m = c; return m; }
  isComplete() { return this.colored === this.N; }
  isTiled() { return this.isComplete() && this.conflictCount() === 0; }

  // Conflicting pairs [v, u, c] (u === v means a self-conflict).
  conflicts(limit = Infinity) {
    const out = [];
    const { inst, col } = this;
    for (let v = 0; v < this.N && out.length < limit; v++) {
      const c = col[v];
      if (!c || this.block[v * this.S + c] === 0) continue;
      const end = inst.nearStart[v + 1];
      for (let h = inst.nearStart[v]; h < end; h++) {
        if (inst.nearDist[h] > c) break;
        const u = inst.nearIdx[h];
        if (u === v ? inst.selfDist[v] <= c : (u > v && col[u] === c)) out.push([v, u, c]);
      }
    }
    return out;
  }

  // Why is color c illegal at w? Returns colored vertices u with col c within distance c,
  // plus 'self' if w is within c of its own copy.
  blockers(w, c) {
    const out = [];
    const { inst } = this;
    if (inst.selfDist[w] <= c) out.push(w);
    const end = inst.nearStart[w + 1];
    for (let h = inst.nearStart[w]; h < end; h++) {
      if (inst.nearDist[h] > c) break;
      const u = inst.nearIdx[h];
      if (u !== w && this.col[u] === c) out.push(u);
    }
    return out;
  }

  // Vertices within distance c of v (the exclusion zone of color c at v), with distances.
  zone(v, c) {
    const out = [];
    const { inst } = this;
    const end = inst.nearStart[v + 1];
    for (let h = inst.nearStart[v]; h < end; h++) {
      if (inst.nearDist[h] > c) break;
      out.push([inst.nearIdx[h], inst.nearDist[h]]);
    }
    return out;
  }

  // Fill forced vertices (exactly one candidate) repeatedly. Returns the ordered list of
  // [v, c] placements and the first dead vertex encountered (or -1).
  cascade(origin = ORIGIN.AUTO, seeds = null) {
    const placed = [];
    const queue = seeds ? seeds.slice() : this.forcedVertices();
    let dead = -1;
    const { inst } = this;
    for (let q = 0; q < queue.length; q++) {
      const v = queue[q];
      if (this.col[v]) continue;
      const n = this.candCount[v];
      if (n === 0) { dead = v; break; }
      if (n !== 1) continue;
      const c = this.onlyCandidate(v);
      this.set(v, c, origin);
      placed.push([v, c]);
      const end = inst.nearStart[v + 1];
      for (let h = inst.nearStart[v]; h < end; h++) {
        if (inst.nearDist[h] > c) break;
        const u = inst.nearIdx[h];
        if (!this.col[u] && this.candCount[u] <= 1) queue.push(u);
      }
    }
    if (dead < 0) { const d = this.deadVertices(); if (d.length) dead = d[0]; }
    return { placed, dead };
  }

  // Seeds for a cascade after placing c at v: uncolored vertices in the zone with <= 1 option.
  zoneSeeds(v, c) {
    const out = [];
    for (const [u] of this.zone(v, c)) if (!this.col[u] && this.candCount[u] <= 1) out.push(u);
    return out;
  }

  load(col, origin = ORIGIN.IMPORT) {
    for (let v = 0; v < this.N; v++) if (this.col[v] !== (col[v] || 0)) this.set(v, col[v] || 0, origin);
  }

  counts() {
    const n = new Int32Array(this.R + 1);
    for (const c of this.col) n[c]++;
    return n;
  }
}
