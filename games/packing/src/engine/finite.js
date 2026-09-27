// Finite graphs: same interface as PeriodicInstance (N, R, near tables, selfDist), no tiling.

import { NONE, packNear } from './tables.js';

export class Graph {
  constructor(n, edges, { name = 'Graph', pos = null, id = null } = {}) {
    this.n = n;
    this.name = name;
    this.id = id;
    const seen = new Set();
    this.edges = [];
    this.adj = Array.from({ length: n }, () => []);
    for (let [u, v] of edges) {
      if (u === v || u < 0 || v < 0 || u >= n || v >= n) continue;
      if (u > v) [u, v] = [v, u];
      const key = u * n + v;
      if (seen.has(key)) continue;
      seen.add(key);
      this.edges.push([u, v]);
      this.adj[u].push(v);
      this.adj[v].push(u);
    }
    this.pos = pos || forceLayout(this);
  }
  maxDegree() { return Math.max(0, ...this.adj.map(a => a.length)); }
}

export class FiniteInstance {
  constructor(graph, R) {
    this.kind = 'finite';
    this.graph = graph;
    this.N = graph.n;
    this.R = R;
    const N = this.N, adj = graph.adj;
    const dist = new Int16Array(N);
    const queue = new Int32Array(N);
    const lists = packNear(N, Math.max(1, N - 1), (v, emit) => {
      dist.fill(-1);
      dist[v] = 0;
      let head = 0, tail = 0;
      queue[tail++] = v;
      while (head < tail) {
        const x = queue[head++];
        if (x !== v) emit(x, dist[x]);
        if (dist[x] >= R) continue;
        for (const y of adj[x]) if (dist[y] < 0) { dist[y] = dist[x] + 1; queue[tail++] = y; }
      }
    });
    this.nearStart = lists.start;
    this.nearIdx = lists.idx;
    this.nearDist = lists.dist;
    this.selfDist = new Uint8Array(N).fill(NONE);
  }
  pos(v) { return this.graph.pos[v]; }
  minSelfDist() { return NONE; }
  spec() { return { kind: 'finite', n: this.N, edges: this.graph.edges, name: this.graph.name, pos: this.graph.pos, R: this.R }; }
}

// ---------- generators ----------

const circle = (n, r, phase = -Math.PI / 2) =>
  Array.from({ length: n }, (_, i) => [r * Math.cos(phase + 2 * Math.PI * i / n), r * Math.sin(phase + 2 * Math.PI * i / n)]);

// Scale positions so the shortest edge (on average) has length ~1.6 world units.
function normalize(pos, edges, target = 1.6) {
  if (!edges.length) return pos;
  let s = 0;
  for (const [u, v] of edges) s += Math.hypot(pos[u][0] - pos[v][0], pos[u][1] - pos[v][1]);
  const f = target / (s / edges.length || 1);
  return pos.map(([x, y]) => [x * f, y * f]);
}

export function cycle(n) {
  const edges = Array.from({ length: n }, (_, i) => [i, (i + 1) % n]);
  return new Graph(n, edges, { name: `Cycle C${n}`, pos: normalize(circle(n, n / 6), edges) });
}

export function path(n) {
  const edges = Array.from({ length: n - 1 }, (_, i) => [i, i + 1]);
  return new Graph(n, edges, { name: `Path P${n}`, pos: Array.from({ length: n }, (_, i) => [i * 1.6, 0]) });
}

export function generalizedPetersen(n, k) {
  const edges = [];
  for (let i = 0; i < n; i++) {
    edges.push([i, (i + 1) % n]);
    edges.push([i, n + i]);
    edges.push([n + i, n + ((i + k) % n)]);
  }
  const pos = [...circle(n, 1), ...circle(n, 0.55)];
  const names = { '5,2': 'Petersen graph', '8,3': 'Möbius–Kantor graph', '10,3': 'Desargues graph', '12,5': 'Nauru graph', '10,2': 'Dodecahedron' };
  const name = names[`${n},${k}`] || (k === 1 ? `Prism (${n}-gonal)` : `Generalized Petersen GP(${n},${k})`);
  return new Graph(2 * n, edges, { name, pos: normalize(pos, edges, 1.8) });
}

export const petersen = () => generalizedPetersen(5, 2);

export function hypercube(d) {
  const n = 1 << d, edges = [];
  for (let v = 0; v < n; v++) for (let b = 0; b < d; b++) if (!(v & (1 << b))) edges.push([v, v | (1 << b)]);
  return new Graph(n, edges, { name: `Hypercube Q${d}` });
}

export function heawood() {
  // Incidence graph of the Fano plane: LCF [5,-5]^7.
  return lcf(14, [5, -5], 'Heawood graph');
}

export function lcf(n, jumps, name = null) {
  const edges = [];
  for (let i = 0; i < n; i++) {
    edges.push([i, (i + 1) % n]);
    const j = jumps[i % jumps.length];
    edges.push([i, (((i + j) % n) + n) % n]);
  }
  return new Graph(n, edges, { name: name || `LCF [${jumps.join(',')}]^${n / jumps.length}`, pos: normalize(circle(n, 1), edges) });
}

export function grid(w, h) {
  const edges = [], pos = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = y * w + x;
    pos.push([x * 1.6, y * 1.6]);
    if (x + 1 < w) edges.push([v, v + 1]);
    if (y + 1 < h) edges.push([v, v + w]);
  }
  return new Graph(w * h, edges, { name: `Grid ${w}×${h}`, pos });
}

export function completeBinaryTree(depth) {
  const n = (1 << (depth + 1)) - 1, edges = [], pos = [];
  for (let v = 0; v < n; v++) {
    const level = Math.floor(Math.log2(v + 1));
    const idx = v + 1 - (1 << level);
    const width = 1 << level;
    pos.push([((idx + 0.5) / width - 0.5) * (1 << depth) * 1.8, level * 1.8]);
    if (v > 0) edges.push([v, (v - 1) >> 1]);
  }
  return new Graph(n, edges, { name: `Binary tree (depth ${depth})`, pos });
}

// Uniform-ish random cubic graph via the pairing model (retry until simple).
export function randomCubic(n, seed = 1) {
  if (n % 2) n++;
  let rnd = mulberry32(seed);
  for (let attempt = 0; attempt < 1000; attempt++) {
    const pts = [];
    for (let v = 0; v < n; v++) pts.push(v, v, v);
    for (let i = pts.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pts[i], pts[j]] = [pts[j], pts[i]]; }
    const set = new Set(), edges = [];
    let ok = true;
    for (let i = 0; i < pts.length; i += 2) {
      let [u, v] = [pts[i], pts[i + 1]];
      if (u === v) { ok = false; break; }
      if (u > v) [u, v] = [v, u];
      if (set.has(u * n + v)) { ok = false; break; }
      set.add(u * n + v);
      edges.push([u, v]);
    }
    if (ok) return new Graph(n, edges, { name: `Random cubic (n=${n}, seed ${seed})` });
  }
  throw new Error('Could not generate a simple cubic graph');
}

// Replace every edge by a path with t new internal vertices (t = 1: the subdivision S(G)).
export function subdivide(g, t = 1) {
  if (t <= 0) return g;
  const edges = [], pos = g.pos.map(p => p.slice());
  let n = g.n;
  for (const [u, v] of g.edges) {
    let prev = u;
    for (let s = 1; s <= t; s++) {
      const f = s / (t + 1);
      pos.push([g.pos[u][0] * (1 - f) + g.pos[v][0] * f, g.pos[u][1] * (1 - f) + g.pos[v][1] * f]);
      edges.push([prev, n]);
      prev = n++;
    }
    edges.push([prev, v]);
  }
  const name = t === 1 ? `S(${g.name})` : `S${t}(${g.name})`;
  return new Graph(n, edges, { name, pos: normalize(pos, edges, 1.4) });
}

// ---------- parsers ----------

// Accepts "0 1", "0-1", "0,1", one or several pairs per line; # comments. Vertices are
// relabeled 0..n-1 in order of first appearance unless they are all integers.
export function parseEdgeList(text, name = 'Custom graph') {
  const tokens = [];
  for (const line of text.split(/\n/)) {
    const l = line.replace(/#.*/, '').trim();
    if (!l) continue;
    for (const m of l.matchAll(/([^\s,;\-–:()[\]]+)\s*[-–,:\s]\s*([^\s,;\-–:()[\]]+)/g)) tokens.push([m[1], m[2]]);
  }
  if (!tokens.length) throw new Error('No edges found. Use one "u v" pair per line.');
  const allInt = tokens.every(([a, b]) => /^\d+$/.test(a) && /^\d+$/.test(b));
  let n, edges;
  if (allInt) {
    edges = tokens.map(([a, b]) => [+a, +b]);
    const min = Math.min(...edges.flat());
    edges = edges.map(([a, b]) => [a - min, b - min]);
    n = Math.max(...edges.flat()) + 1;
  } else {
    const id = new Map();
    const get = s => { if (!id.has(s)) id.set(s, id.size); return id.get(s); };
    edges = tokens.map(([a, b]) => [get(a), get(b)]);
    n = id.size;
  }
  if (n > 5000) throw new Error('Graph too large (max 5000 vertices).');
  return new Graph(n, edges, { name });
}

export function parseGraph6(s, name = null) {
  s = s.trim();
  if (s.startsWith('>>graph6<<')) s = s.slice(10);
  const bytes = [...s].map(ch => ch.charCodeAt(0) - 63);
  if (bytes.some(b => b < 0 || b > 63)) throw new Error('Not a graph6 string.');
  let n, p;
  if (bytes[0] < 63) { n = bytes[0]; p = 1; }
  else if (bytes[1] < 63) { n = (bytes[1] << 12) | (bytes[2] << 6) | bytes[3]; p = 4; }
  else throw new Error('graph6 graphs this large are not supported.');
  if (n > 5000) throw new Error('Graph too large (max 5000 vertices).');
  const edges = [];
  let bit = 0;
  const get = () => {
    const b = bytes[p + Math.floor(bit / 6)];
    const r = b === undefined ? 0 : (b >> (5 - (bit % 6))) & 1;
    bit++;
    return r;
  };
  for (let j = 1; j < n; j++) for (let i = 0; i < j; i++) if (get()) edges.push([i, j]);
  return new Graph(n, edges, { name: name || `graph6 ${s.length > 16 ? s.slice(0, 14) + '…' : s}` });
}

export function toGraph6(g) {
  const n = g.n;
  const out = [];
  if (n < 63) out.push(n + 63);
  else out.push(126, ((n >> 12) & 63) + 63, ((n >> 6) & 63) + 63, (n & 63) + 63);
  const adj = new Set(g.edges.map(([u, v]) => u * n + v));
  let cur = 0, k = 0;
  for (let j = 1; j < n; j++) for (let i = 0; i < j; i++) {
    cur = (cur << 1) | (adj.has(i * n + j) ? 1 : 0);
    if (++k === 6) { out.push(cur + 63); cur = 0; k = 0; }
  }
  if (k) out.push((cur << (6 - k)) + 63);
  return String.fromCharCode(...out);
}

// ---------- layout ----------

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic force-directed layout (Fruchterman–Reingold with cooling).
export function forceLayout(g, iters = 400) {
  const n = g.n;
  if (n === 0) return [];
  const rnd = mulberry32(12345);
  const P = circle(n, Math.sqrt(n)).map(([x, y]) => [x + rnd() * 0.1, y + rnd() * 0.1]);
  const k = 1.6;
  let temp = Math.sqrt(n);
  const disp = Array.from({ length: n }, () => [0, 0]);
  const heavy = n > 600;
  for (let it = 0; it < iters; it++) {
    for (const d of disp) { d[0] = 0; d[1] = 0; }
    if (!heavy || it % 2 === 0) {
      for (let u = 0; u < n; u++) for (let v = u + 1; v < n; v++) {
        let dx = P[u][0] - P[v][0], dy = P[u][1] - P[v][1];
        let d2 = dx * dx + dy * dy;
        if (d2 < 1e-6) { dx = rnd() - 0.5; dy = rnd() - 0.5; d2 = 0.01; }
        if (heavy && d2 > 36 * k * k) continue;
        const f = (k * k) / d2;
        disp[u][0] += dx * f; disp[u][1] += dy * f;
        disp[v][0] -= dx * f; disp[v][1] -= dy * f;
      }
    }
    for (const [u, v] of g.edges) {
      const dx = P[u][0] - P[v][0], dy = P[u][1] - P[v][1];
      const d = Math.hypot(dx, dy) || 1e-3;
      const f = d / k;
      disp[u][0] -= dx * f; disp[u][1] -= dy * f;
      disp[v][0] += dx * f; disp[v][1] += dy * f;
    }
    for (let v = 0; v < n; v++) {
      // weak gravity keeps components together
      disp[v][0] -= P[v][0] * 0.01; disp[v][1] -= P[v][1] * 0.01;
      const d = Math.hypot(disp[v][0], disp[v][1]) || 1;
      const m = Math.min(d, temp);
      P[v][0] += (disp[v][0] / d) * m;
      P[v][1] += (disp[v][1] / d) * m;
    }
    temp = Math.max(0.01, temp * 0.985);
  }
  return normalize(P, g.edges);
}

export const FINITE_PRESETS = {
  petersen: { name: 'Petersen graph', make: () => petersen() },
  gp: { name: 'Generalized Petersen GP(n,k)', params: { n: 8, k: 3 }, make: ({ n, k }) => generalizedPetersen(n, k) },
  prism: { name: 'Prism', params: { n: 6 }, make: ({ n }) => generalizedPetersen(n, 1) },
  heawood: { name: 'Heawood graph', make: () => heawood() },
  cube: { name: 'Hypercube Qd', params: { d: 3 }, make: ({ d }) => hypercube(d) },
  cycle: { name: 'Cycle', params: { n: 12 }, make: ({ n }) => cycle(n) },
  grid: { name: 'Grid', params: { w: 6, h: 6 }, make: ({ w, h }) => grid(w, h) },
  tree: { name: 'Complete binary tree', params: { depth: 4 }, make: ({ depth }) => completeBinaryTree(depth) },
  cubic: { name: 'Random cubic graph', params: { n: 30, seed: 1 }, make: ({ n, seed }) => randomCubic(n, seed) },
};
