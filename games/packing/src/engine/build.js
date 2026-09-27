// Build an instance from a serialisable spec (used by the page and by the worker, so both
// get identical vertex numbering).

import { Lattice, PeriodicInstance } from './lattice.js';
import { FiniteInstance, Graph } from './finite.js';

export function buildInstance(spec) {
  if (spec.kind === 'periodic') return new PeriodicInstance(new Lattice(spec.lattice), spec.P, spec.R);
  if (spec.kind === 'finite') return new FiniteInstance(new Graph(spec.n, spec.edges, { name: spec.name, pos: spec.pos }), spec.R);
  throw new Error('unknown instance kind ' + spec.kind);
}
