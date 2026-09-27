// Main controller: owns the instance, the board, the workers and the UI state.

import { PeriodicInstance } from '../engine/lattice.js';
import { PRESETS, latticeFromJSON } from '../engine/lattices.js';
import { FiniteInstance, FINITE_PRESETS, parseGraph6, parseEdgeList, subdivide, toGraph6 } from '../engine/finite.js';
import { Board, ORIGIN } from '../engine/state.js';
import { NONE } from '../engine/tables.js';
import { toDimacs, parseSolution, encodingStats } from '../engine/sat.js';
import { Renderer } from './render.js';
import { attachInput } from './input.js';
import { color } from './palette.js';
import {
  $, el, toast, openModal, closeModal, modalOpen, buildGraphPanel, syncGraphPanel,
  renderPalette, renderChips, renderStats, renderGallery,
} from './panels.js';
import { buildHash, parseHash, decodeColors, encodeColors, sourceKey, bests, gallery, prefs, download } from './storage.js';
import { celebrate } from './confetti.js';

const DEFAULT_SOURCE = { kind: 'periodic', lattice: 'kagome', P: [[8, 0], [0, 8]] };

class App {
  constructor() {
    const p = prefs.load();
    this.opts = { ghosts: p.ghosts ?? true, zone: p.zone ?? true };
    this.mode = p.mode || 'puzzle';
    this.autofill = p.autofill ?? true;
    this.lookahead = p.lookahead ?? false;
    this.K = 16;
    this.R = 30;
    this.selected = 1;
    this.tool = 'paint';
    this.hover = null;
    this.hoverBlockers = null;
    this.dragging = false;
    this.elimReasons = new Map();
    this.solving = null;
    this.deadSeen = new Set();
    this.wonVersion = -1;
    this.drawRequested = true;

    this.renderer = new Renderer($('canvas'), this);
    buildGraphPanel(this);
    this.bindUI();
    attachInput($('canvas'), this);
    this.initWorkers();

    const fromHash = this.tryHash(location.hash);
    if (!fromHash) {
      this.build(DEFAULT_SOURCE, { K: 16 });
      if (!p.seenIntro) setTimeout(() => this.about(true), 400);
    }
    window.addEventListener('hashchange', () => { if (location.hash !== this.lastHash) this.tryHash(location.hash); });
    window.addEventListener('resize', () => { this.renderer.resize(); this.requestDraw(); });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { this.renderer.readTheme(); this.requestDraw(); });
    requestAnimationFrame(t => this.frame(t));
  }

  // ------------------------------------------------------------------ building

  makeInstance(src, R) {
    if (src.kind === 'periodic') {
      const L = src.custom ? latticeFromJSON(src.custom) : PRESETS[src.lattice]?.();
      if (!L) throw new Error(`Unknown lattice ${src.lattice}`);
      const det = Math.abs(src.P[0][0] * src.P[1][1] - src.P[0][1] * src.P[1][0]);
      if (det * L.k > 20000) throw new Error(`That chunk has ${det * L.k} vertices; the limit is 20000.`);
      return new PeriodicInstance(L, src.P, R);
    }
    let g;
    if (src.g6) g = parseGraph6(src.g6, src.name);
    else if (src.edges) g = parseEdgeList(src.edges.map(e => e.join(' ')).join('\n'), src.name || 'Custom graph');
    else {
      const P = FINITE_PRESETS[src.preset];
      if (!P) throw new Error(`Unknown graph ${src.preset}`);
      g = P.make({ ...(P.params || {}), ...(src.params || {}) });
    }
    if (src.sub) g = subdivide(g, src.sub);
    return new FiniteInstance(g, R);
  }

  build(src, { K = this.K, R = this.R, colors = null, keepFrom = null, fit = true, mode = null } = {}) {
    const t0 = performance.now();
    const inst = this.makeInstance(src, R);
    this.source = src;
    this.inst = inst;
    this.R = R;
    this.K = Math.max(1, Math.min(K, R));
    if (mode) this.mode = mode;
    if (src.kind === 'periodic') this.lastPeriodicP = src.P;
    this.positions = inst.kind === 'finite' ? inst.graph.pos.map(p => p.slice()) : null;
    this._posCache = inst.kind === 'periodic' ? Array.from({ length: inst.N }, (_, v) => inst.pos(v)) : null;
    this.board = new Board(inst, this.mode === 'puzzle' ? this.K : R);
    this.elimReasons.clear();
    this.deadSeen.clear();
    this.wonVersion = -1;
    this.renderer.pops.clear(); this.renderer.ripples = []; this.renderer.flashLines = null;
    this.hover = null; this.hoverBlockers = null;

    let col = null;
    if (colors) col = colors;
    else if (keepFrom && keepFrom.inst.kind === 'periodic' && inst.kind === 'periodic' && keepFrom.inst.lattice.name === inst.lattice.name) {
      // periodic extension of the old pattern into the new chunk
      col = new Uint8Array(inst.N);
      for (let v = 0; v < inst.N; v++) {
        const [x, y, i] = inst.coords(v);
        const c = keepFrom.col[keepFrom.inst.index(x, y, i)];
        col[v] = c <= R ? c : 0;
      }
    }
    if (col && col.some(c => c)) {
      this.board.begin('load');
      for (let v = 0; v < inst.N; v++) if (col[v] && col[v] <= R) this.board.set(v, col[v], ORIGIN.IMPORT);
      this.board.end();
      this.board.history = []; // loading is not undoable
    }
    this.stats.buildMs = Math.round(performance.now() - t0);
    this.selected = Math.min(this.selected, this.K);
    this.initWorkerInstance();
    syncGraphPanel(this);
    this.syncModeUI();
    if (fit) this.renderer.fit(false);
    this.afterChange({ quiet: true });
    this.updateGraphInfo();
  }

  buildFromPanel({ source, keep }) {
    if (source.edgeText) {
      const g = parseEdgeList(source.edgeText);
      source = { kind: 'finite', sub: source.sub, g6: toGraph6(g), name: 'Custom graph' };
    }
    const keepFrom = keep && this.inst ? { inst: this.inst, col: this.board.col.slice() } : null;
    this.build(source, { keepFrom });
    closeDrawer();
  }

  updateGraphInfo() {
    const inst = this.inst;
    let info = `${inst.N} vertices`;
    const best = bests.get(sourceKey(this.source));
    if (best) info += ` · your best: ${best.score}`;
    $('graph-info').textContent = info;
    let note = '';
    if (inst.kind === 'periodic') {
      note = inst.lattice.notes || '';
      const ms = inst.minSelfDist();
      if (ms !== NONE) note += ` In this chunk colors ≥ ${ms} can never be used: some vertex is only ${ms} steps from its own copy.`;
    } else {
      const g = inst.graph;
      note = `${g.name}: ${g.n} vertices, ${g.edges.length} edges, max degree ${g.maxDegree()}.`;
    }
    $('graph-note').textContent = note.trim();
  }

  // Number of colors <= K that vertex v could take on an empty board.
  baseline(v) {
    const sd = this.inst.selfDist[v];
    return sd === NONE ? this.board.K : Math.min(this.board.K, sd - 1);
  }

  vpos(v) { return this.positions ? this.positions[v] : this._posCache[v]; }
  moveVertex(v, [x, y]) { if (this.positions) { this.positions[v] = [x, y]; this.requestDraw(); } }

  // ------------------------------------------------------------------ workers

  initWorkers() {
    const make = () => {
      const w = new Worker(new URL('../worker.js', import.meta.url), { type: 'module' });
      w.onmessage = e => this.onWorker(e.data);
      w.onerror = e => { console.error(e); toast('Worker error: ' + (e.message || 'see console'), { kind: 'bad' }); };
      return w;
    };
    this._makeWorker = make;
    this.probeWorker = make();
    this.solveWorker = make();
    this.probeId = 0;
    this.solveId = 0;
  }

  initWorkerInstance() {
    const spec = this.inst.spec();
    this.specVersion = (this.specVersion || 0) + 1;
    this.probeWorker.postMessage({ type: 'init', spec });
    this.solveWorker.postMessage({ type: 'init', spec });
    this.probeBusy = false;
    this.probeDirty = false;
    if (this.solving) this.cancelSolve(true);
  }

  onWorker(m) {
    if (m.type === 'probe') return this.onProbe(m);
    if (m.type === 'progress') return this.onSolveProgress(m);
    if (m.type === 'solve') return this.onSolve(m);
    if (m.type === 'error') {
      if (this.solving && m.id === this.solving.id) this.endSolve();
      toast('Worker: ' + m.message, { kind: 'bad' });
    }
  }

  // ------------------------------------------------------------------ L2 lookahead

  scheduleProbe() {
    clearTimeout(this.probeTimer);
    if (this.mode !== 'puzzle' || !this.lookahead) { $('lookahead-status').textContent = ''; return; }
    this.probeTimer = setTimeout(() => this.sendProbe(), 30);
  }

  sendProbe() {
    if (this.probeBusy) { this.probeDirty = true; return; }
    this.probeBusy = true;
    this.probeDirty = false;
    this.probeSent = { id: ++this.probeId, version: this.board.version, board: this.board };
    $('lookahead-status').textContent = 'Lookahead: thinking…';
    this.probeWorker.postMessage({ type: 'probe', id: this.probeId, col: this.board.col.slice(), K: this.K, timeLimitMs: 5000 });
  }

  onProbe(m) {
    this.probeBusy = false;
    const sent = this.probeSent;
    if (!sent || m.id !== sent.id) return;
    if (this.probeDirty || sent.board !== this.board || this.board.version !== sent.version || this.mode !== 'puzzle' || !this.lookahead) {
      if (this.mode === 'puzzle' && this.lookahead) this.sendProbe();
      return;
    }
    this.elimReasons.clear();
    for (const [v, c, dead, chain] of m.elims) {
      this.board.addElim(v, c);
      this.elimReasons.set(v * this.board.S + c, { dead, chain });
    }
    const n = m.elims.length;
    $('lookahead-status').textContent = n
      ? `Lookahead ruled out ${n} option${n === 1 ? '' : 's'} (hover a vertex to see why).${m.timedOut ? ' (stopped early)' : ''}`
      : `Lookahead: nothing new.${m.timedOut ? ' (stopped early)' : ''}`;
    if (n && this.autofill && this.board.forcedVertices().length) {
      const step = this.lastStep && this.board.reopen(this.lastStep) ? this.lastStep : this.board.begin('lookahead');
      const r = this.board.cascade(ORIGIN.AUTO);
      this.board.end();
      this.lastStep = step;
      this.animateCascade(r.placed, null);
      this.afterChange({ dead: r.dead });
    } else {
      this.afterChange({ fromProbe: true });
    }
  }

  // ------------------------------------------------------------------ interactions

  paletteMax() { return this.K; }

  select(c) {
    this.selected = Math.max(1, Math.min(c, this.paletteMax()));
    this.tool = 'paint';
    renderPalette(this);
    this.refreshHover();
  }

  setTool(t) { this.tool = t; renderPalette(this); this.refreshHover(); }

  click(hit) {
    if (this.tool === 'erase') return this.erase(hit);
    if (this.board.col[hit.v] === this.selected) return this.erase(hit);
    this.place(hit, this.selected);
  }

  // Instance of u nearest to the clicked instance h (for animations near the cursor).
  instanceNear(h, u) {
    const inst = this.inst;
    if (inst.kind !== 'periodic' || !h) {
      if (inst.kind === 'periodic') { const [x, y, i] = inst.coords(u); return { v: u, x, y, i }; }
      return { v: u };
    }
    const [hx, hy] = inst.coords(h.v);
    const n = inst.nearestCopy(h.v, u);
    if (!n) { const [x, y, i] = inst.coords(u); return { v: u, x, y, i }; }
    return { v: u, x: n.x + h.x - hx, y: n.y + h.y - hy, i: n.i };
  }

  place(hit, c) {
    const b = this.board, v = hit.v;
    if (this.mode === 'puzzle' && !b.isFree(v, c)) {
      this.renderer.shake(v);
      this.flashBlockers(hit, c);
      const bl = b.blockers(v, c);
      if (bl.includes(v)) toast(`${c} can never go here: this vertex is only ${this.inst.selfDist[v]} steps from its own copy.`, { kind: 'bad' });
      else toast(`${c} is blocked here by ${bl.length === 1 ? 'a' : bl.length} ${c} within distance ${c}.`, { kind: 'bad', ms: 2600 });
      this.requestDraw();
      return;
    }
    const wasElim = this.mode === 'puzzle' && b.isElim(v, c);
    const step = b.begin('place');
    b.set(v, c, ORIGIN.PLAYER);
    this.renderer.pop(v);
    this.renderer.ripple(hit, c);
    let dead = -1;
    if (this.mode === 'puzzle' && this.autofill) {
      const r = b.cascade(ORIGIN.AUTO, b.zoneSeeds(v, c));
      dead = r.dead;
      this.animateCascade(r.placed, hit);
    }
    b.end();
    this.lastStep = step;
    if (wasElim) toast('Lookahead had ruled this out; watch what follows.', { ms: 2600 });
    this.afterChange({ dead, hit });
  }

  erase(hit) {
    const b = this.board;
    if (!b.col[hit.v]) return;
    this.lastStep = b.begin('erase');
    b.set(hit.v, 0);
    b.end();
    this.renderer.pop(hit.v, 0, 200);
    this.afterChange({});
  }

  animateCascade(placed, hit) {
    const R = this.renderer;
    placed.forEach(([u, c], k) => {
      const delay = 110 + k * 75;
      R.pop(u, delay, 360);
      if (k < 14) R.ripple(this.instanceNear(hit, u), c, delay, Math.min(c, 3));
    });
    if (placed.length > 1) toast(`Chain reaction: ${placed.length} vertices were forced.`, { ms: 2200 });
  }

  flashBlockers(hit, c) {
    const lines = [];
    const a = this.renderer.instPos(hit);
    for (const u of this.board.blockers(hit.v, c)) {
      const bpos = this.renderer.copyNear(hit, u);
      if (bpos) lines.push({ a, b: bpos, color: c });
    }
    this.renderer.flash(lines);
  }

  deadLines(hit) {
    // one line per color 1..K to the nearest vertex that blocks it
    const lines = [];
    const a = this.renderer.instPos(hit);
    for (let c = 1; c <= this.K; c++) {
      const bl = this.board.blockers(hit.v, c);
      if (!bl.length) continue;
      const bpos = this.renderer.copyNear(hit, bl[0]);
      if (bpos) lines.push({ a, b: bpos, color: c });
    }
    return lines;
  }

  undo() {
    if (!this.board.undo()) return;
    this.renderer.pops.clear();
    this.lastStep = null;
    this.afterChange({ undo: true });
  }
  redo() {
    if (!this.board.redo()) return;
    this.lastStep = null;
    this.afterChange({});
  }

  clearAll() {
    const b = this.board;
    if (!b.colored) return;
    this.lastStep = b.begin('clear');
    for (let v = 0; v < b.N; v++) b.set(v, 0);
    b.end();
    this.afterChange({});
    toast('Cleared. Undo brings it back.', { action: { label: 'Undo', run: () => this.undo() } });
  }

  fillOnes() {
    const b = this.board;
    this.lastStep = b.begin('fill 1s');
    let n = 0;
    for (let v = 0; v < b.N; v++) if (!b.col[v] && b.isFree(v, 1)) { b.set(v, 1, ORIGIN.AUTO); this.renderer.pop(v, Math.min(600, n * 4)); n++; }
    b.end();
    toast(n ? `Placed ${n} ones (${((100 * b.counts()[1]) / b.N).toFixed(1)}% of vertices are now 1).` : 'No vertex can take color 1.');
    this.afterChange({});
  }

  greedyFill() {
    const b = this.board;
    this.lastStep = b.begin('greedy');
    let n = 0, fail = 0;
    for (let v = 0; v < b.N; v++) {
      if (b.col[v]) continue;
      let c = 1;
      while (c <= this.K && !b.isFree(v, c)) c++;
      if (c > this.K) { fail++; continue; }
      b.set(v, c, ORIGIN.AUTO);
      this.renderer.pop(v, Math.min(700, n * 3));
      n++;
    }
    b.end();
    toast(fail ? `Greedy placed ${n}; ${fail} vertices had no legal color ≤ ${this.K}.` : `Greedy colored ${n} vertices.`, { kind: fail ? '' : 'good' });
    this.afterChange({});
  }

  setMode(m) {
    if (m === this.mode) return;
    this.mode = m;
    this.board.clearElims();
    this.board.setK(m === 'puzzle' ? this.K : this.R);
    if (m === 'puzzle' && this.board.maxColor() > this.K) toast(`Some vertices use colors above the budget K = ${this.K}.`, { kind: 'bad' });
    this.syncModeUI();
    this.savePrefs();
    this.afterChange({ quiet: true });
  }

  setK(k) {
    k = Math.max(1, Math.min(this.R, k | 0));
    if (k === this.K) { $('k-input').value = k; return; }
    this.K = k;
    this.board.clearElims();
    if (this.mode === 'puzzle') this.board.setK(k);
    this.selected = Math.min(this.selected, k);
    $('k-input').value = k;
    this.deadSeen.clear();
    this.afterChange({ quiet: true });
  }

  setR(r) {
    r = Math.max(4, Math.min(50, r | 0));
    if (r === this.R) return;
    this.build(this.source, { R: r, K: Math.min(this.K, r), colors: this.board.col.map(c => (c <= r ? c : 0)), fit: false });
  }

  setHover(hit, px, py) {
    this.hover = hit;
    this.hoverPx = [px, py];
    this.refreshHover();
  }

  refreshHover() {
    const hit = this.hover;
    this.hoverBlockers = null;
    const tip = $('tooltip');
    if (!hit || this.dragging) { tip.hidden = true; this.requestDraw(); return; }
    const b = this.board, v = hit.v, c = b.col[v];
    const parts = [];
    if (c) {
      const who = { 1: 'you', 2: 'auto-fill', 3: 'the solver', 4: 'import' }[b.origin[v]] || '';
      parts.push(`<b>Color ${c}</b>${who ? ` · placed by ${who}` : ''}`);
      if (b.inConflict(v)) {
        const bl = b.blockers(v, c);
        parts.push(`<span class="bad">${bl.includes(v) ? `Too close to its own copy (${this.inst.selfDist[v]} steps).` : `Conflicts with ${bl.length} other ${c}${bl.length > 1 ? 's' : ''} within distance ${c}.`}</span>`);
        this.hoverBlockers = this.linesTo(hit, bl.filter(u => u !== v), c);
      }
    } else if (this.mode === 'puzzle') {
      const cands = b.candidates(v);
      if (!cands.length) {
        parts.push('<b class="bad">Dead end</b>: no color ≤ K fits here.');
        this.hoverBlockers = this.deadLines(hit);
      } else parts.push(`<b>Options:</b> ${cands.join(', ')}`);
      const elim = [];
      for (let k = 1; k <= this.K; k++) {
        const r = this.elimReasons.get(v * b.S + k);
        if (r && b.isElim(v, k)) elim.push(`${k} (forces ${r.chain.length} vert${r.chain.length === 1 ? 'ex' : 'ices'}, then a dead end)`);
      }
      if (elim.length) parts.push(`<span class="muted">Ruled out by lookahead: ${elim.join('; ')}</span>`);
    }
    if (this.tool === 'paint' && !c) {
      const s = this.selected;
      if (!b.isFree(v, s)) {
        const bl = b.blockers(v, s);
        if (bl.includes(v)) parts.push(`<span class="bad">${s} can never fit here in this chunk.</span>`);
        else parts.push(`<span class="bad">${s} is blocked by ${bl.length} vert${bl.length === 1 ? 'ex' : 'ices'}.</span>`);
        if (!this.hoverBlockers) this.hoverBlockers = this.linesTo(hit, bl.filter(u => u !== v), s);
      }
    }
    if (parts.length && this.hoverPx && this.hoverPx[0] != null) {
      tip.innerHTML = parts.join('<br>');
      tip.hidden = false;
      const st = $('stage').getBoundingClientRect();
      const [px, py] = this.hoverPx;
      tip.style.left = `${Math.min(px + 18, st.width - 310)}px`;
      tip.style.top = `${Math.max(8, py - 12 - tip.offsetHeight)}px`;
    } else tip.hidden = true;
    this.requestDraw();
  }

  linesTo(hit, us, c) {
    const a = this.renderer.instPos(hit);
    const out = [];
    for (const u of us.slice(0, 30)) { const bpos = this.renderer.copyNear(hit, u); if (bpos) out.push({ a, b: bpos, color: c }); }
    return out;
  }

  // ------------------------------------------------------------------ after every change

  afterChange({ dead = -1, hit = null, quiet = false, undo = false, fromProbe = false } = {}) {
    const b = this.board;
    renderPalette(this);
    renderChips(this);
    renderStats(this);
    this.refreshHover();
    this.scheduleHash();
    if (!fromProbe) this.scheduleProbe();

    if (this.mode === 'puzzle') {
      const deads = b.deadVertices();
      const fresh = deads.filter(v => !this.deadSeen.has(v));
      this.deadSeen = new Set(deads);
      if (fresh.length && !quiet && !undo) {
        for (const v of fresh) this.renderer.shake(v);
        const w = fresh[0];
        const h = this.instanceNear(hit, w);
        this.renderer.flash(this.deadLines(h), 3200);
        toast(fresh.length === 1 ? 'Dead end: a vertex has no color ≤ K left.' : `Dead end: ${fresh.length} vertices have no color ≤ K left.`, {
          kind: 'bad', ms: 6000,
          action: b.canUndo() ? { label: 'Undo last move', run: () => this.undo() } : null,
        });
      }
    }
    if (b.isTiled() && (this.mode !== 'puzzle' || b.maxColor() <= this.K) && this.wonVersion !== b.version && !quiet) {
      this.wonVersion = b.version;
      setTimeout(() => this.win(), 450);
    }
    this.requestDraw();
  }

  win() {
    const b = this.board;
    if (!b.isTiled()) return;
    const score = b.maxColor();
    const key = sourceKey(this.source);
    const hash = buildHash({ source: this.source, K: score, R: this.R, mode: this.mode, col: b.col });
    const newBest = bests.offer(key, { score, hash, date: Date.now() });
    gallery.add({ hash, score, title: this.describe(), date: Date.now() });
    renderGallery(this, gallery.list());
    this.updateGraphInfo();
    celebrate();
    const periodic = this.inst.kind === 'periodic';
    const what = periodic
      ? `Your chunk tiles the infinite lattice with no conflicts, so <b>χ<sub>ρ</sub>(${this.inst.lattice.name}) ≤ ${score}</b>.`
      : `This is a packing coloring of ${this.inst.graph.name} with ${score} colors, so <b>χ<sub>ρ</sub> ≤ ${score}</b>.`;
    openModal('Tiled!', `
      <div class="win-score">${score}</div>
      <p>${what}</p>
      <p>${newBest ? 'That is your best for this chunk. It has been saved to the gallery.' : 'Saved to the gallery.'}</p>`,
      [
        { label: 'Keep exploring', run: () => {} },
        { label: 'Copy link', run: () => { this.copyLink(); return false; } },
        ...(score > 1 ? [{ label: `Try ${score - 1} colors`, primary: true, run: () => this.tryFewer(score - 1) }] : []),
      ]);
  }

  tryFewer(k) {
    this.lastStep = this.board.begin('clear');
    for (let v = 0; v < this.board.N; v++) this.board.set(v, 0);
    this.board.end();
    if (this.mode !== 'puzzle') this.setMode('puzzle');
    this.setK(k);
    toast(`Budget set to ${k}. Good luck!`, { kind: 'good' });
  }

  describe() {
    const s = this.source;
    if (s.kind === 'periodic') {
      const name = this.inst.lattice.name;
      const [[p, q], [r, t]] = s.P;
      const chunk = q === 0 && r === 0 ? `${p}×${t}` : `P=(${p},${q}),(${r},${t})`;
      return `${name}, ${chunk}`;
    }
    return this.inst.graph.name;
  }

  // ------------------------------------------------------------------ solver

  startSolve(kind) {
    if (this.solving) { toast('The solver is already running.'); return; }
    const b = this.board;
    let fixed = null;
    if (kind !== 'scratch') {
      if (b.conflictCount()) { toast('Resolve the conflicts first (or use "From scratch").', { kind: 'bad' }); return; }
      if (b.maxColor() > this.K) { toast(`Some colors exceed K = ${this.K}. Raise K or erase them.`, { kind: 'bad' }); return; }
      if (b.isComplete()) { toast('Already complete!'); return; }
      fixed = b.col.slice();
    }
    const limit = +$('solver-time').value || 0;
    const id = ++this.solveId;
    this.solving = { id, kind, t0: performance.now(), version: b.version, board: b };
    $('solver-status').hidden = false;
    $('solver-text').textContent = 'Starting…';
    $('solver-result').textContent = '';
    this.solveWorker.postMessage({ type: 'solve', id, K: this.K, fixed, timeLimitMs: limit || 0, seed: (Math.random() * 1e9) | 0 });
  }

  onSolveProgress(m) {
    if (!this.solving || m.id !== this.solving.id) return;
    const s = m.stats;
    $('solver-text').textContent = `${(s.timeMs / 1000).toFixed(1)} s · ${s.conflicts.toLocaleString()} conflicts · best ${s.bestSatisfied}/${s.N}`;
  }

  endSolve() { this.solving = null; $('solver-status').hidden = true; }

  cancelSolve(silent = false) {
    if (!this.solving) return;
    this.solveWorker.terminate();
    this.solveWorker = this._makeWorker();
    this.solveWorker.postMessage({ type: 'init', spec: this.inst.spec() });
    this.endSolve();
    if (!silent) $('solver-result').textContent = 'Canceled.';
  }

  onSolve(m) {
    const job = this.solving;
    if (!job || m.id !== job.id) return;
    this.endSolve();
    const b = this.board;
    const secs = (m.stats.timeMs / 1000).toFixed(1);
    const stale = job.board !== b || b.version !== job.version;
    const K = this.K;
    const res = $('solver-result');
    if (m.status === 'unknown') {
      res.textContent = `No answer within the time limit (${secs} s, ${m.stats.conflicts.toLocaleString()} conflicts). Try a longer limit, or export the CNF for kissat.`;
      return;
    }
    if (m.status === 'unsat') {
      if (job.kind === 'scratch' || !b.colored) {
        res.innerHTML = `<b>Proved:</b> no packing coloring of this ${this.inst.kind === 'periodic' ? 'chunk' : 'graph'} uses ≤ ${K} colors (${secs} s).`;
        toast(`Proved impossible with ${K} colors.`, { kind: 'bad', ms: 5000 });
      } else {
        res.innerHTML = `<b>No completion:</b> the current position cannot be finished within K = ${K} (${secs} s). Undo some moves.`;
        toast('This position cannot be completed within the budget.', { kind: 'bad', ms: 5000, action: b.canUndo() ? { label: 'Undo', run: () => this.undo() } : null });
      }
      return;
    }
    const col = m.col;
    if (stale && job.kind !== 'scratch') { res.textContent = 'The board changed while the solver ran; run it again.'; return; }
    if (job.kind === 'check') {
      res.innerHTML = `<b>Yes:</b> this position can be completed within K = ${K} (${secs} s).`;
      toast('Yes, this can be finished.', { kind: 'good' });
    } else if (job.kind === 'hint') {
      let best = -1, bc = 99;
      for (let v = 0; v < b.N; v++) if (!b.col[v] && b.candCount[v] < bc) { bc = b.candCount[v]; best = v; }
      if (best < 0) return;
      const h = this.instanceNear(this.hover, best);
      this.lastStep = b.begin('hint');
      b.set(best, col[best], ORIGIN.SOLVER);
      let dead = -1;
      if (this.mode === 'puzzle' && this.autofill) {
        const r = b.cascade(ORIGIN.AUTO, b.zoneSeeds(best, col[best]));
        dead = r.dead;
        this.animateCascade(r.placed, h);
      }
      b.end();
      this.renderer.pop(best);
      this.renderer.ripple(h, col[best]);
      res.textContent = `Hint: color ${col[best]} at the highlighted vertex is part of a valid completion.`;
      this.afterChange({ dead, hit: h });
    } else if (job.kind === 'finish') {
      this.lastStep = b.begin('finish');
      let k = 0;
      for (let v = 0; v < b.N; v++) if (!b.col[v]) { b.set(v, col[v], ORIGIN.SOLVER); this.renderer.pop(v, Math.min(900, k++ * 6)); }
      b.end();
      res.textContent = `Finished by the solver in ${secs} s.`;
      this.afterChange({});
    } else if (job.kind === 'scratch') {
      const load = () => {
        this.lastStep = b.begin('solver');
        for (let v = 0; v < b.N; v++) b.set(v, col[v], ORIGIN.SOLVER);
        b.end();
        for (let v = 0; v < b.N; v++) this.renderer.pop(v, Math.min(900, v * 3));
        this.afterChange({});
      };
      let mx = 0; for (const c of col) mx = Math.max(mx, c);
      res.innerHTML = `<b>Found</b> a packing coloring with ${mx} colors (${secs} s).`;
      if (!b.colored) load();
      else toast(`Found a coloring with ${mx} colors.`, { kind: 'good', ms: 8000, action: { label: 'Load it', run: load } });
    }
  }

  hint() { this.startSolve('hint'); }

  // ------------------------------------------------------------------ densities

  densityBounds() {
    const inst = this.inst;
    if (inst.kind !== 'periodic') return null;
    if (this._bounds && this._bounds.inst === inst) return this._bounds.b;
    const L = inst.lattice, R = inst.R;
    const b = [0];
    for (let c = 1; c <= R; c++) {
      const r = Math.floor(c / 2);
      let m = Infinity;
      for (let i = 0; i < L.k; i++) m = Math.min(m, inst.balls[i].layer[Math.min(r, R) + 1]);
      b.push(c === 1 && L.alpha ? L.alpha : 1 / m);
    }
    this._bounds = { inst, b };
    return b;
  }

  densityLowerBound() {
    const b = this.densityBounds();
    if (!b) return null;
    let s = 0;
    for (let c = 1; c < b.length; c++) { s += b[c]; if (s >= 1 - 1e-12) return c; }
    return null;
  }

  // ------------------------------------------------------------------ save / load

  scheduleHash() {
    clearTimeout(this.hashTimer);
    this.hashTimer = setTimeout(() => {
      const h = buildHash({ source: this.source, K: this.K, R: this.R, mode: this.mode, col: this.board.col });
      this.lastHash = h;
      if (h.length < 60000) history.replaceState(null, '', h);
    }, 250);
  }

  tryHash(hash) {
    let st;
    try { st = parseHash(hash); } catch (e) { console.warn(e); return false; }
    if (!st) return false;
    try {
      const inst = this.makeInstance(st.source, st.R || this.R);
      const colors = st.colors ? decodeColors(st.colors, inst.N) : null;
      this.build(st.source, { K: st.K || this.K, R: st.R || this.R, colors, mode: st.mode === 'free' || st.mode === 'puzzle' ? st.mode : null });
      return true;
    } catch (e) {
      toast('Could not load that link: ' + e.message, { kind: 'bad' });
      return false;
    }
  }

  loadHash(h) { if (this.tryHash(h)) { closeDrawer(); toast('Loaded.'); } }
  removeFromGallery(h) { gallery.remove(h); renderGallery(this, gallery.list()); }

  copyLink() {
    const h = buildHash({ source: this.source, K: this.K, R: this.R, mode: this.mode, col: this.board.col });
    const url = location.href.split('#')[0] + h;
    const done = () => toast('Link copied to the clipboard.', { kind: 'good' });
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => this.showText('Share link', url));
    else this.showText('Share link', url);
  }

  showText(title, text) {
    const ta = el('textarea', { readonly: true }); ta.value = text;
    openModal(title, ta, [{ label: 'Close', run: () => {} }]);
    ta.select();
  }

  exportJSON() {
    const data = {
      format: 'packing-coloring-lab', version: 1,
      source: this.source, R: this.R, K: this.K, mode: this.mode,
      N: this.board.N, maxColor: this.board.maxColor(), valid: this.board.isTiled(),
      colors: Array.from(this.board.col),
      description: this.describe(),
      positions: this.positions || undefined,
    };
    download(`packing-${this.slug()}.json`, JSON.stringify(data), 'application/json');
  }

  slug() { return this.describe().toLowerCase().replace(/[^a-z0-9×]+/g, '-').replace(/×/g, 'x').replace(/^-|-$/g, ''); }

  importDialog() {
    const ta = el('textarea', { placeholder: 'Paste exported JSON or a share link' });
    const file = el('input', { type: 'file', accept: '.json,.txt' });
    file.addEventListener('change', async () => { if (file.files[0]) ta.value = await file.files[0].text(); });
    openModal('Import', el('div', {}, el('p', {}, 'Paste JSON exported from this page, or a share link.'), ta, el('p', {}, file)), [
      { label: 'Cancel', run: () => {} },
      { label: 'Import', primary: true, run: () => {
        const t = ta.value.trim();
        try {
          if (t.includes('#')) { if (!this.tryHash(t.slice(t.indexOf('#')))) throw new Error('Link not recognized'); return; }
          const d = JSON.parse(t);
          if (!d.source) throw new Error('Missing "source"');
          this.build(d.source, { K: d.K || this.K, R: d.R || this.R, colors: Uint8Array.from(d.colors || []), mode: d.mode });
          if (d.positions && this.positions && d.positions.length === this.positions.length) { this.positions = d.positions; this.renderer.fit(false); }
          toast('Imported.', { kind: 'good' });
        } catch (e) { toast('Import failed: ' + e.message, { kind: 'bad' }); return false; }
      } },
    ]);
  }

  exportCNF() {
    const fixed = $('opt-cnf-fixed').checked ? this.board.col : null;
    if (fixed && this.board.maxColor() > this.K) { toast(`Some colors exceed K = ${this.K}.`, { kind: 'bad' }); return; }
    const st = encodingStats(this.inst, this.K);
    const go = () => {
      const meta = { graph: this.describe(), source: this.source };
      const text = toDimacs(this.inst, this.K, fixed, meta);
      download(`packing-${this.slug()}-K${this.K}.cnf`, text);
      toast(`Exported ${st.vars.toLocaleString()} variables. Run e.g. "kissat file.cnf > out.txt" and import out.txt.`, { ms: 7000 });
    };
    if (st.binaries > 4e6) {
      openModal('Large CNF', `<p>This CNF has about ${(st.binaries / 1e6).toFixed(1)} million clauses (${Math.round(st.binaries * 16 / 1e6)} MB). Export anyway?</p>`,
        [{ label: 'Cancel', run: () => {} }, { label: 'Export', primary: true, run: go }]);
    } else go();
  }

  importSolutionDialog() {
    const ta = el('textarea', { placeholder: 's SATISFIABLE\nv 1 -2 -3 ... 0' });
    const file = el('input', { type: 'file' });
    file.addEventListener('change', async () => { if (file.files[0]) ta.value = await file.files[0].text(); });
    openModal('Import SAT solution', el('div', {},
      el('p', {}, `Paste the solver output for the CNF exported with the current chunk and K = ${this.K}.`), ta, el('p', {}, file)), [
      { label: 'Cancel', run: () => {} },
      { label: 'Import', primary: true, run: () => {
        try {
          const r = parseSolution(ta.value, this.board.N, this.K);
          if (r.status === 'unsat') { $('solver-result').innerHTML = `<b>External solver:</b> UNSAT, so no packing coloring with ≤ ${this.K} colors exists for this chunk.`; toast('Solver reported UNSAT.', { kind: 'bad' }); return; }
          const b = this.board;
          this.lastStep = b.begin('import');
          for (let v = 0; v < b.N; v++) b.set(v, r.col[v], ORIGIN.IMPORT);
          b.end();
          this.afterChange({});
          toast(b.isTiled() ? 'Imported a valid coloring.' : `Imported, but there are ${b.conflictCount()} conflicts. Was the CNF for this chunk and K?`, { kind: b.isTiled() ? 'good' : 'bad' });
        } catch (e) { toast('Import failed: ' + e.message, { kind: 'bad' }); return false; }
      } },
    ]);
  }

  // ------------------------------------------------------------------ UI wiring

  bindUI() {
    this.stats = {};
    $('btn-undo').onclick = () => this.undo();
    $('btn-redo').onclick = () => this.redo();
    $('btn-about').onclick = () => this.about(false);
    $('btn-drawer').onclick = () => document.body.classList.toggle('drawer-open');
    $('stage').addEventListener('pointerdown', () => closeDrawer());
    $('modal-close').onclick = closeModal;
    $('modal').addEventListener('pointerdown', e => { if (e.target === $('modal')) closeModal(); });
    for (const b of $('mode-seg').querySelectorAll('button')) b.onclick = () => this.setMode(b.dataset.mode);
    $('k-input').addEventListener('change', e => this.setK(+e.target.value));
    $('k-minus').onclick = () => this.setK(this.K - 1);
    $('k-plus').onclick = () => this.setK(this.K + 1);
    $('opt-autofill').checked = this.autofill;
    $('opt-autofill').onchange = e => {
      this.autofill = e.target.checked; this.savePrefs();
      if (this.autofill && this.mode === 'puzzle' && this.board.forcedVertices().length) {
        this.lastStep = this.board.begin('auto-fill');
        const r = this.board.cascade(ORIGIN.AUTO);
        this.board.end();
        this.animateCascade(r.placed, null);
        this.afterChange({ dead: r.dead });
      } else this.afterChange({ quiet: true });
    };
    $('opt-lookahead').checked = this.lookahead;
    $('opt-lookahead').onchange = e => {
      this.lookahead = e.target.checked; this.savePrefs();
      if (!this.lookahead) { this.board.clearElims(); this.elimReasons.clear(); }
      this.afterChange({ quiet: true });
    };
    $('btn-clear').onclick = () => this.clearAll();
    $('btn-fill1').onclick = () => this.fillOnes();
    $('btn-greedy').onclick = () => this.greedyFill();
    $('btn-hint').onclick = () => this.startSolve('hint');
    $('btn-check').onclick = () => this.startSolve('check');
    $('btn-finish').onclick = () => this.startSolve('finish');
    $('btn-scratch').onclick = () => this.startSolve('scratch');
    $('btn-cancel').onclick = () => this.cancelSolve();
    $('btn-link').onclick = () => this.copyLink();
    $('btn-json-out').onclick = () => this.exportJSON();
    $('btn-json-in').onclick = () => this.importDialog();
    $('btn-cnf').onclick = () => this.exportCNF();
    $('btn-sol-in').onclick = () => this.importSolutionDialog();
    $('opt-ghosts').checked = this.opts.ghosts;
    $('opt-ghosts').onchange = e => { this.opts.ghosts = e.target.checked; this.savePrefs(); this.requestDraw(); };
    $('opt-zone').checked = this.opts.zone;
    $('opt-zone').onchange = e => { this.opts.zone = e.target.checked; this.savePrefs(); this.requestDraw(); };
    $('r-input').addEventListener('change', e => { this.setR(+e.target.value); e.target.value = this.R; });
    $('btn-zoom-in').onclick = () => { this.renderer.zoomAt(this.renderer.W / 2, this.renderer.H / 2, 1.3); this.requestDraw(); };
    $('btn-zoom-out').onclick = () => { this.renderer.zoomAt(this.renderer.W / 2, this.renderer.H / 2, 1 / 1.3); this.requestDraw(); };
    $('btn-fit').onclick = () => { this.renderer.fit(); this.requestDraw(); };
    renderGallery(this, gallery.list());
  }

  syncModeUI() {
    document.body.classList.toggle('mode-free', this.mode === 'free');
    for (const b of $('mode-seg').querySelectorAll('button')) b.classList.toggle('on', b.dataset.mode === this.mode);
    $('k-input').value = this.K;
    $('k-input').max = this.R;
    $('r-input').value = this.R;
  }

  savePrefs() {
    prefs.save({ ...prefs.load(), ghosts: this.opts.ghosts, zone: this.opts.zone, autofill: this.autofill, lookahead: this.lookahead, mode: this.mode });
  }

  closeModal() { closeModal(); }
  modalOpen() { return modalOpen(); }

  about(first) {
    if (first) prefs.save({ ...prefs.load(), seenIntro: true });
    openModal('Packing colorings', `
      <p>Give every vertex a color 1, 2, 3, … so that <b>two vertices with the same color c are more than c steps apart</b>. Color 1 only has to avoid its neighbors; color 7 needs a clear radius of 7. Your score is the largest color you use, and lower is better.</p>
      <p>You color a <b>chunk</b> (the outlined region), and the pattern repeats forever in every direction. The faded copies around it show the repetition, and conflicts are checked across the seams. If the chunk tiles with k colors, you have proved that the packing chromatic number χ<sub>ρ</sub> of the infinite lattice is at most k.</p>
      <div class="facts">
        <span>Square grid</span><b>χρ = 15 (proved 2023)</b>
        <span>Hexagonal</span><b>χρ = 7</b>
        <span>Triangular</span><b>χρ = ∞</b>
        <span>Kagome</span><b>unknown, possibly not even finite</b>
      </div>
      <p>Kagome sits between the square and triangular lattices: its balls grow like 2.5r², against 2r² for the square grid and 3r² for the triangular lattice. Any valid kagome chunk you find is a genuine upper bound.</p>
      <p><b>Puzzle mode</b> works like Minesweeper. Choose a budget K. Every empty vertex shows how many colors it can still take; a vertex with one option is <span style="color:var(--warn)">forced</span> and a vertex with none is a <span style="color:var(--danger)">dead end</span>. Auto-fill plays forced moves in a chain reaction, and lookahead rules out options that would lead to a dead end. The solver can give hints, finish the chunk, or prove that no coloring exists.</p>
      <ul>
        <li>Click to place, right-click (or long-press) to erase; drag to pan, scroll or pinch to zoom.</li>
        <li>Keys 1–9 and 0 pick colors (type two digits for 11+), E toggles the eraser, Z / Shift+Z undo and redo, F fits the view, H asks for a hint.</li>
      </ul>`, [{ label: 'Start coloring', primary: true, run: () => {} }]);
  }

  // ------------------------------------------------------------------ frame loop

  requestDraw() { this.drawRequested = true; }

  frame(t) {
    const now = performance.now();
    const b = this.board;
    const live = this.renderer.busy(now) || (b && b.conflictCount() > 0) || (b && this.mode === 'puzzle' && this.deadSeen.size > 0);
    if (this.drawRequested || live) {
      this.drawRequested = false;
      this.renderer.draw(now);
    }
    requestAnimationFrame(t2 => this.frame(t2));
  }
}

function closeDrawer() { document.body.classList.remove('drawer-open'); }

window.app = new App();
