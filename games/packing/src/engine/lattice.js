// Periodic lattices and periodic chunks.
//
// A lattice is described the standard crystallographic way: a unit cell holding k sites,
// two basis vectors (world coordinates, used only for drawing), and edges of the form
// [i, j, dx, dy] meaning "site i of cell (x, y) is adjacent to site j of cell (x+dx, y+dy)".
//
// A chunk is the quotient of the lattice by a period lattice spanned by two integer
// vectors P1, P2 (in cell units). Every coloring of the chunk extends periodically to the
// infinite lattice. All validity logic uses d*(v, u): the smallest distance, in the infinite
// lattice, from chunk vertex v to any copy of chunk vertex u (for u = v: to any *other* copy).

import { NONE, packNear } from './tables.js';

export class Lattice {
  constructor({ id, name, basis, sites, edges, notes = '', alpha = null }) {
    this.id = id;
    this.alpha = alpha; // independence ratio (max density of color 1), if known
    this.name = name;
    this.notes = notes;
    this.basis = basis;
    this.sites = sites;
    this.k = sites.length;
    this.adj = Array.from({ length: this.k }, () => []);
    const seen = new Set();
    this.edges = [];
    for (const [i, j, dx, dy] of edges) {
      if (i === j && dx === 0 && dy === 0) continue;
      const a = `${i},${j},${dx},${dy}`;
      const b = `${j},${i},${-dx},${-dy}`;
      if (seen.has(a) || seen.has(b)) continue;
      seen.add(a);
      this.edges.push([i, j, dx, dy]);
      this.adj[i].push([j, dx, dy]);
      this.adj[j].push([i, -dx, -dy]);
    }
    this.reach = 1;
    for (const [, , dx, dy] of this.edges) this.reach = Math.max(this.reach, Math.abs(dx), Math.abs(dy));
    this._balls = new Map();
  }

  degree(i) { return this.adj[i].length; }

  pos(cx, cy, i) {
    const [b1, b2] = this.basis;
    const s = this.sites[i];
    return [cx * b1[0] + cy * b2[0] + s[0], cx * b1[1] + cy * b2[1] + s[1]];
  }

  // BFS ball around site i of cell (0,0), out to radius R, in the infinite lattice.
  // Entries are sorted by distance; layer[d] is the index of the first entry at distance d.
  ball(i, R) {
    const key = `${i}:${R}`;
    if (this._balls.has(key)) return this._balls.get(key);
    const off = R * this.reach;
    const W = 2 * off + 1;
    const k = this.k;
    const seen = new Uint8Array(W * W * k);
    const dx = [], dy = [], site = [], dist = [];
    const idx = (x, y, s) => ((x + off) * W + (y + off)) * k + s;
    seen[idx(0, 0, i)] = 1;
    dx.push(0); dy.push(0); site.push(i); dist.push(0);
    for (let h = 0; h < dx.length; h++) {
      const d = dist[h];
      if (d >= R) break;
      for (const [j, ex, ey] of this.adj[site[h]]) {
        const x = dx[h] + ex, y = dy[h] + ey;
        const t = idx(x, y, j);
        if (seen[t]) continue;
        seen[t] = 1;
        dx.push(x); dy.push(y); site.push(j); dist.push(d + 1);
      }
    }
    const layer = new Int32Array(R + 2).fill(dx.length);
    for (let h = dist.length - 1; h >= 0; h--) layer[dist[h]] = h;
    for (let d = R; d >= 0; d--) if (layer[d] > layer[d + 1]) layer[d] = layer[d + 1];
    const b = {
      dx: Int16Array.from(dx), dy: Int16Array.from(dy),
      site: Uint16Array.from(site), dist: Uint8Array.from(dist),
      len: dx.length, layer, R,
    };
    this._balls.set(key, b);
    return b;
  }

  toJSON() {
    return { id: this.id, name: this.name, basis: this.basis, sites: this.sites, edges: this.edges, notes: this.notes, alpha: this.alpha };
  }
}

// Build a lattice from a periodic subset of another lattice: take an n1 x n2 block of base
// cells as the new unit cell and keep the base sites for which keep(x, y, site) is true
// (x, y are base-cell coordinates within the block). Used for kagome = triangular minus holes.
export function subLattice(base, n1, n2, keep, meta) {
  const sites = [], map = new Map();
  for (let y = 0; y < n2; y++) for (let x = 0; x < n1; x++) for (let s = 0; s < base.k; s++) {
    if (!keep(x, y, s)) continue;
    map.set(`${x},${y},${s}`, sites.length);
    sites.push(base.pos(x, y, s));
  }
  const edges = [];
  for (let y = 0; y < n2; y++) for (let x = 0; x < n1; x++) for (let s = 0; s < base.k; s++) {
    const i = map.get(`${x},${y},${s}`);
    if (i === undefined) continue;
    for (const [t, ex, ey] of base.adj[s]) {
      const X = x + ex, Y = y + ey;
      const cx = Math.floor(X / n1), cy = Math.floor(Y / n2);
      const j = map.get(`${X - cx * n1},${Y - cy * n2},${t}`);
      if (j !== undefined) edges.push([i, j, cx, cy]);
    }
  }
  const [b1, b2] = base.basis;
  return new Lattice({
    ...meta,
    basis: [[b1[0] * n1, b1[1] * n1], [b2[0] * n2, b2[1] * n2]],
    sites, edges,
  });
}

function egcd(a, b) {
  // returns [g, x, y] with a*x + b*y = g = gcd(a, b) >= 0
  let [r0, r1, s0, s1, t0, t1] = [a, b, 1, 0, 0, 1];
  while (r1 !== 0) {
    const q = Math.floor(r0 / r1);
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
    [t0, t1] = [t1, t0 - q * t1];
  }
  if (r0 < 0) return [-r0, -s0, -t0];
  return [r0, s0, t0];
}

const mod = (x, m) => ((x % m) + m) % m;

// Hermite normal form of the period lattice spanned by rows P1, P2: basis (a, 0), (b, c)
// with a, c > 0 and 0 <= b < a. Fundamental domain: cells [0, a) x [0, c).
export function hermite(P) {
  const [[p, q], [r, s]] = P;
  const det = p * s - q * r;
  if (det === 0) throw new Error('Period vectors are parallel (determinant 0)');
  let A, B;
  if (q === 0 && s === 0) throw new Error('Period vectors are parallel (determinant 0)');
  const [g, u, v] = egcd(q, s);
  const q1 = q / g, s1 = s / g;
  B = [u * p + v * r, u * q + v * s]; // y = g
  A = [s1 * p - q1 * r, 0];
  let a = Math.abs(A[0]);
  let b = mod(B[0], a), c = B[1];
  return { a, b, c, det: Math.abs(det) };
}

export class PeriodicInstance {
  constructor(lattice, P, R) {
    this.kind = 'periodic';
    this.lattice = lattice;
    this.P = P.map(r => r.slice());
    const h = hermite(P);
    this.hnf = h;
    this.k = lattice.k;
    this.cells = h.a * h.c;
    this.N = this.cells * this.k;
    this.R = R;
    this._build();
  }

  reduceCell(x, y) {
    const { a, b, c } = this.hnf;
    const n = Math.floor(y / c);
    const y1 = y - n * c;
    const x1 = mod(x - n * b, a);
    return [x1, y1];
  }

  index(x, y, i) {
    const { a, b, c } = this.hnf;
    const n = Math.floor(y / c);
    const y1 = y - n * c;
    const x1 = mod(x - n * b, a);
    return (y1 * a + x1) * this.k + i;
  }

  isHome(x, y) { return x >= 0 && y >= 0 && x < this.hnf.a && y < this.hnf.c; }

  // Home coordinates of chunk vertex v.
  coords(v) {
    const i = v % this.k, cell = (v - i) / this.k;
    return [cell % this.hnf.a, Math.floor(cell / this.hnf.a), i];
  }

  pos(v) { const [x, y, i] = this.coords(v); return this.lattice.pos(x, y, i); }

  _build() {
    const { N, R, k } = this;
    const balls = [];
    for (let i = 0; i < k; i++) balls.push(this.lattice.ball(i, R));
    this.balls = balls;
    const selfDist = new Uint8Array(N).fill(NONE);
    const lists = packNear(N, Math.min(N, Math.max(...balls.map(b => b.len))), (v, emit) => {
      const [x, y, i] = this.coords(v);
      const b = balls[i];
      // entry 0 is v itself at distance 0 (the trivial copy); skip it
      for (let h = 1; h < b.len; h++) {
        const u = this.index(x + b.dx[h], y + b.dy[h], b.site[h]);
        if (emit(u, b.dist[h]) && u === v) selfDist[v] = b.dist[h];
      }
    });
    this.nearStart = lists.start;
    this.nearIdx = lists.idx;
    this.nearDist = lists.dist;
    this.selfDist = selfDist;
  }

  // Offset (in cells) from v's home cell to the copy of u nearest to v, plus that distance.
  nearestCopy(v, u) {
    const [x, y, i] = this.coords(v);
    const b = this.balls[i];
    for (let h = v === u ? 1 : 0; h < b.len; h++) {
      const X = x + b.dx[h], Y = y + b.dy[h];
      if (this.index(X, Y, b.site[h]) === u) return { x: X, y: Y, i: b.site[h], d: b.dist[h] };
    }
    return null;
  }

  // Smallest self-distance over the chunk: colors >= this can never be used anywhere.
  minSelfDist() { let m = NONE; for (const d of this.selfDist) m = Math.min(m, d); return m; }

  spec() { return { kind: 'periodic', lattice: this.lattice.toJSON(), P: this.P, R: this.R }; }
}
