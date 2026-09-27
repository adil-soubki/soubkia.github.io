// Preset lattices. Edge length is 1 in world units for all of them.

import { Lattice, subLattice } from './lattice.js';

const S3 = Math.sqrt(3);

export const square = () => new Lattice({
  id: 'square', name: 'Square grid', alpha: 1 / 2,
  basis: [[1, 0], [0, 1]], sites: [[0, 0]],
  edges: [[0, 0, 1, 0], [0, 0, 0, 1]],
  notes: 'χρ = 15 (Subercaseaux & Heule, 2023).',
});

// Triangular lattice in the (a, b) coordinates of the handoff: neighbors
// (a±1, b), (a, b±1), (a+1, b−1), (a−1, b+1); world position (a + b/2, b·√3/2).
export const triangular = () => new Lattice({
  id: 'triangular', name: 'Triangular lattice', alpha: 1 / 3,
  basis: [[1, 0], [0.5, S3 / 2]], sites: [[0, 0]],
  edges: [[0, 0, 1, 0], [0, 0, 0, 1], [0, 0, 1, -1]],
  notes: 'χρ = ∞ (Finbow & Rall, 2010): no finite palette works.',
});

export const honeycomb = () => new Lattice({
  id: 'honeycomb', name: 'Hexagonal (honeycomb)', alpha: 1 / 2,
  basis: [[S3, 0], [S3 / 2, 1.5]], sites: [[0, 0], [0, 1]],
  edges: [[0, 1, 0, 0], [0, 1, 0, -1], [0, 1, 1, -1]],
  notes: 'χρ = 7.',
});

// Kagome = triangular lattice minus the points with a and b both even (hexagon centers).
// Unit cell = 2x2 block of triangular cells, sites (1,0), (0,1), (1,1).
export const kagome = () => subLattice(triangular(), 2, 2, (x, y) => !(x % 2 === 0 && y % 2 === 0), {
  id: 'kagome', name: 'Kagome lattice', alpha: 1 / 3,
  notes: 'χρ unknown: every vertex lies in 2 triangles and 2 hexagons. Density bound: ≥ 9 colors.',
});

export const king = () => new Lattice({
  id: 'king', name: "King's graph", alpha: 1 / 4,
  basis: [[1, 0], [0, 1]], sites: [[0, 0]],
  edges: [[0, 0, 1, 0], [0, 0, 0, 1], [0, 0, 1, 1], [0, 0, 1, -1]],
  notes: 'Square grid plus diagonals (degree 8).',
});

export const PRESETS = { kagome, square, triangular, honeycomb, king };
export const PRESET_ORDER = ['kagome', 'square', 'triangular', 'honeycomb', 'king'];

export function latticeFromJSON(o) {
  if (o.id && PRESETS[o.id] && !o.edges) return PRESETS[o.id]();
  return new Lattice(o);
}
