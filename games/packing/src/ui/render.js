// Canvas renderer. World units: lattice edge length = 1. Screen y points down, world y up.

import { color, rgba } from './palette.js';
import { ORIGIN } from '../engine/state.js';

const VR = 0.31;          // vertex radius in world units
const MAX_VISIBLE = 45000; // vertices drawn per frame, at most

const easeOutBack = t => { const c1 = 1.6, c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; };
const clamp01 = t => Math.max(0, Math.min(1, t));

export class Renderer {
  constructor(canvas, app) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.app = app;
    this.view = { cx: 0, cy: 0, s: 40 };
    this.W = 1; this.H = 1; this.dpr = 1;
    this.pops = new Map();   // v -> { t0, dur }
    this.ripples = [];       // { center, c, t0 }
    this.shakes = new Map(); // v -> t0
    this.flashLines = null;  // { lines, until }
    this.theme = {};
    this.readTheme();
    this.resize();
  }

  readTheme() {
    const cs = getComputedStyle(document.documentElement);
    const g = n => cs.getPropertyValue(n).trim();
    this.theme = {
      stage: g('--stage'), ink: g('--ink'), ink2: g('--ink-2'), muted: g('--muted'), line: g('--line'), line2: g('--line-2'),
      accent: g('--accent'), danger: g('--danger'), warn: g('--warn'), panel: g('--panel'), panel2: g('--panel-2'),
      dark: matchMedia('(prefers-color-scheme: dark)').matches,
      font: getComputedStyle(document.body).fontFamily,
    };
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
  }

  // ---------- coordinates ----------
  toScreen(x, y) { const v = this.view; return [(x - v.cx) * v.s + this.W / 2, this.H / 2 - (y - v.cy) * v.s]; }
  toWorld(px, py) { const v = this.view; return [(px - this.W / 2) / v.s + v.cx, v.cy - (py - this.H / 2) / v.s]; }

  minScale() {
    const inst = this.app.inst;
    if (!inst || inst.kind !== 'periodic') return 2;
    const [b1, b2] = inst.lattice.basis;
    const area = Math.abs(b1[0] * b2[1] - b1[1] * b2[0]) || 1;
    return Math.sqrt((this.W * this.H * inst.k) / (area * MAX_VISIBLE));
  }

  zoomAt(px, py, f) {
    const [wx, wy] = this.toWorld(px, py);
    const s = Math.max(this.minScale(), Math.min(220, this.view.s * f));
    this.view.s = s;
    // keep the world point under the cursor fixed
    this.view.cx = wx - (px - this.W / 2) / s;
    this.view.cy = wy + (py - this.H / 2) / s;
  }

  panBy(dx, dy) { this.view.cx -= dx / this.view.s; this.view.cy += dy / this.view.s; }

  // Bounding box of the home chunk (or finite graph) in world coordinates.
  homeBox() {
    const inst = this.app.inst;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let v = 0; v < inst.N; v++) {
      const [x, y] = this.app.vpos(v);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (!isFinite(x0)) return [0, 0, 1, 1];
    return [x0, y0, x1, y1];
  }

  fit(animate = true) {
    const [x0, y0, x1, y1] = this.homeBox();
    const padX = 60, padTop = 50, padBottom = 110;
    const sx = (this.W - 2 * padX) / Math.max(1, x1 - x0 + 1);
    const sy = (this.H - padTop - padBottom) / Math.max(1, y1 - y0 + 1);
    const s = Math.max(this.minScale(), Math.min(90, sx, sy));
    const target = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 - (padBottom - padTop) / 2 / s, s };
    if (!animate) { this.view = target; return; }
    const from = { ...this.view }, t0 = performance.now();
    this.viewAnim = { from, target, t0, dur: 420 };
  }

  // ---------- hit testing ----------
  // Returns { v, x, y, i } (periodic: infinite-lattice cell + site) or { v } (finite), or null.
  hit(px, py) {
    const inst = this.app.inst;
    if (!inst) return null;
    const [wx, wy] = this.toWorld(px, py);
    const lim = Math.max(0.5, 14 / this.view.s);
    let best = null, bd = lim * lim;
    if (inst.kind === 'periodic') {
      const L = inst.lattice;
      const [cu, cv] = this.cellOf(wx, wy);
      for (let y = Math.floor(cv) - 2; y <= Math.floor(cv) + 2; y++) for (let x = Math.floor(cu) - 2; x <= Math.floor(cu) + 2; x++) {
        for (let i = 0; i < L.k; i++) {
          const [px2, py2] = L.pos(x, y, i);
          const d = (px2 - wx) ** 2 + (py2 - wy) ** 2;
          if (d < bd) { bd = d; best = { v: inst.index(x, y, i), x, y, i }; }
        }
      }
    } else {
      for (let v = 0; v < inst.N; v++) {
        const [x, y] = this.app.vpos(v);
        const d = (x - wx) ** 2 + (y - wy) ** 2;
        if (d < bd) { bd = d; best = { v }; }
      }
    }
    return best;
  }

  cellOf(wx, wy) {
    const [b1, b2] = this.app.inst.lattice.basis;
    const det = b1[0] * b2[1] - b1[1] * b2[0];
    return [(wx * b2[1] - wy * b2[0]) / det, (b1[0] * wy - b1[1] * wx) / det];
  }

  // World position of a "placement instance": periodic { x, y, i } or finite { v }.
  instPos(h) {
    const inst = this.app.inst;
    if (inst.kind === 'periodic') return inst.lattice.pos(h.x, h.y, h.i);
    return this.app.vpos(h.v);
  }

  // World position of the copy of u nearest to the given instance of v.
  copyNear(h, u) {
    const inst = this.app.inst;
    if (inst.kind !== 'periodic') return this.app.vpos(u);
    const [hx, hy] = inst.coords(h.v);
    const n = inst.nearestCopy(h.v, u);
    if (!n) return null;
    return inst.lattice.pos(n.x + (h.x - hx), n.y + (h.y - hy), n.i);
  }

  // ---------- animations ----------
  pop(v, delay = 0, dur = 380) { this.pops.set(v, { t0: performance.now() + delay, dur }); }
  ripple(h, c, delay = 0, rings = null) { this.ripples.push({ h: { ...h }, c, t0: performance.now() + delay, rings: rings ?? c }); }
  shake(v) { this.shakes.set(v, performance.now()); }
  flash(lines, ms = 2600) { this.flashLines = { lines, until: performance.now() + ms, t0: performance.now() }; }
  busy(now) {
    if (this.viewAnim) return true;
    for (const p of this.pops.values()) if (now < p.t0 + p.dur) return true;
    if (this.ripples.length) return true;
    if (this.shakes.size) return true;
    if (this.flashLines && now < this.flashLines.until) return true;
    return false;
  }

  // ---------- drawing ----------
  draw(now) {
    const { ctx, app, theme } = this;
    const inst = app.inst, board = app.board;
    if (this.viewAnim) {
      const a = this.viewAnim, t = clamp01((now - a.t0) / a.dur), e = 1 - (1 - t) ** 3;
      // interpolate zoom geometrically
      this.view.s = a.from.s * Math.pow(a.target.s / a.from.s, e);
      this.view.cx = a.from.cx + (a.target.cx - a.from.cx) * e;
      this.view.cy = a.from.cy + (a.target.cy - a.from.cy) * e;
      if (t >= 1) this.viewAnim = null;
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = theme.stage;
    ctx.fillRect(0, 0, this.W, this.H);
    if (!inst || !board) return;

    const s = this.view.s;
    const r = VR * s;
    const items = this.collect();
    this.lastItems = items;

    if (inst.kind === 'periodic') this.drawChunkRegions();
    this.drawEdges(items);
    this.drawZones(now, items);
    this.drawConflictLines(now);
    this.drawVertices(now, items, r);
    this.drawOverlays(now, r);

    // expire finished animations
    for (const [v, p] of this.pops) if (now > p.t0 + p.dur) this.pops.delete(v);
    this.ripples = this.ripples.filter(q => now < q.t0 + q.rings * 45 + 900);
    for (const [v, t0] of this.shakes) if (now > t0 + 600) this.shakes.delete(v);
  }

  // Visible vertex instances: arrays of screen x, y, chunk index, home flag, cell/site.
  collect() {
    const inst = this.app.inst;
    const out = { n: 0, x: [], y: [], v: [], home: [], cx: [], cy: [], site: [] };
    const push = (sx, sy, v, home, cx, cy, i) => {
      out.x.push(sx); out.y.push(sy); out.v.push(v); out.home.push(home); out.cx.push(cx); out.cy.push(cy); out.site.push(i); out.n++;
    };
    const m = VR * this.view.s + 4;
    if (inst.kind === 'finite') {
      for (let v = 0; v < inst.N; v++) {
        const [x, y] = this.app.vpos(v);
        const [sx, sy] = this.toScreen(x, y);
        push(sx, sy, v, true, 0, 0, 0);
      }
      return out;
    }
    const L = inst.lattice;
    const ghosts = this.app.opts.ghosts;
    const corners = [[0, 0], [this.W, 0], [0, this.H], [this.W, this.H]].map(([px, py]) => this.cellOf(...this.toWorld(px, py)));
    let u0 = Math.floor(Math.min(...corners.map(c => c[0]))) - 1, u1 = Math.ceil(Math.max(...corners.map(c => c[0]))) + 1;
    let v0 = Math.floor(Math.min(...corners.map(c => c[1]))) - 1, v1 = Math.ceil(Math.max(...corners.map(c => c[1]))) + 1;
    if (!ghosts) {
      const { a, c } = inst.hnf;
      u0 = Math.max(u0, 0); v0 = Math.max(v0, 0); u1 = Math.min(u1, a - 1); v1 = Math.min(v1, c - 1);
    }
    for (let cy = v0; cy <= v1; cy++) for (let cx = u0; cx <= u1; cx++) {
      const home = inst.isHome(cx, cy);
      for (let i = 0; i < L.k; i++) {
        const [wx, wy] = L.pos(cx, cy, i);
        const [sx, sy] = this.toScreen(wx, wy);
        if (sx < -m || sy < -m || sx > this.W + m || sy > this.H + m) continue;
        push(sx, sy, inst.index(cx, cy, i), home, cx, cy, i);
      }
    }
    return out;
  }

  drawChunkRegions() {
    const { ctx, theme } = this;
    const inst = this.app.inst, L = inst.lattice;
    const { a, b, c } = inst.hnf;
    const [b1, b2] = L.basis;
    // shift the parallelogram so that it is centerd on the sites of a cell
    let mx = 0, my = 0;
    for (const [x, y] of L.sites) { mx += x; my += y; }
    mx /= L.k; my /= L.k;
    const ox = mx - (b1[0] + b2[0]) / 2, oy = my - (b1[1] + b2[1]) / 2;
    const corner = (u, v) => this.toScreen(u * b1[0] + v * b2[0] + ox, u * b1[1] + v * b2[1] + oy);
    const poly = (du, dv) => {
      // domain [0,a) x [0,c) translated by du*(a,0) + dv*(b,c)
      const U = du * a + dv * b, V = dv * c;
      const p = [corner(U, V), corner(U + a, V), corner(U + a, V + c), corner(U, V + c)];
      ctx.beginPath();
      ctx.moveTo(...p[0]); for (let k = 1; k < 4; k++) ctx.lineTo(...p[k]); ctx.closePath();
    };
    ctx.save();
    poly(0, 0);
    ctx.fillStyle = theme.dark ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.9)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = theme.accent;
    ctx.globalAlpha = 0.55;
    ctx.setLineDash([6, 5]);
    ctx.stroke();
    if (this.app.opts.ghosts) {
      ctx.globalAlpha = 0.18;
      ctx.lineWidth = 1;
      for (let dv = -2; dv <= 2; dv++) for (let du = -3; du <= 3; du++) if (du || dv) { poly(du, dv); ctx.stroke(); }
    }
    ctx.restore();
  }

  drawEdges(items) {
    const { ctx, theme } = this;
    const inst = this.app.inst;
    const s = this.view.s;
    if (s < 5) return;
    ctx.save();
    ctx.lineCap = 'round';
    const lw = Math.max(0.6, Math.min(1.6, s / 28));
    if (inst.kind === 'finite') {
      ctx.strokeStyle = theme.line2; ctx.lineWidth = lw * 1.1;
      ctx.beginPath();
      for (const [u, v] of inst.graph.edges) {
        ctx.moveTo(items.x[u], items.y[u]); ctx.lineTo(items.x[v], items.y[v]);
      }
      ctx.stroke();
      ctx.restore();
      return;
    }
    const L = inst.lattice;
    const home = new Path2D(), ghost = new Path2D();
    const seen = new Set();
    for (let h = 0; h < items.n; h++) {
      const i = items.site[h];
      const key = items.cx[h] * 65536 + items.cy[h];
      if (seen.has(key * 16 + i)) continue;
      seen.add(key * 16 + i);
      for (const [a, b, dx, dy] of L.edges) {
        if (a !== i) continue;
        const [x2, y2] = this.toScreen(...L.pos(items.cx[h] + dx, items.cy[h] + dy, b));
        const p = items.home[h] && inst.isHome(items.cx[h] + dx, items.cy[h] + dy) ? home : ghost;
        p.moveTo(items.x[h], items.y[h]); p.lineTo(x2, y2);
      }
    }
    ctx.lineWidth = lw;
    ctx.strokeStyle = theme.line2;
    ctx.globalAlpha = this.app.opts.ghosts ? 0.55 : 0;
    ctx.stroke(ghost);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = theme.line2;
    ctx.lineWidth = lw * 1.15;
    ctx.stroke(home);
    ctx.restore();
  }

  zonePositions(h, c) {
    // [ [wx, wy, d], ... ] for all infinite-lattice vertices within distance c of instance h
    const inst = this.app.inst;
    const out = [];
    if (inst.kind === 'periodic') {
      const b = inst.balls[h.i];
      const end = b.layer[Math.min(c, b.R) + 1];
      for (let k = 1; k < end; k++) {
        const [x, y] = inst.lattice.pos(h.x + b.dx[k], h.y + b.dy[k], b.site[k]);
        out.push([x, y, b.dist[k]]);
      }
    } else {
      for (const [u, d] of this.app.board.zone(h.v, c)) { const [x, y] = this.app.vpos(u); out.push([x, y, d]); }
    }
    return out;
  }

  drawZones(now, items) {
    const { ctx } = this;
    const app = this.app;
    const s = this.view.s;
    const rr = VR * s * 1.55;
    ctx.save();
    // ripples from recent placements: ring d lights up at t0 + 45ms * d, then fades
    for (const q of this.ripples) {
      if (now < q.t0) continue;
      const zs = this.zonePositions(q.h, q.rings);
      ctx.fillStyle = rgba(q.c, 1);
      for (const [x, y, d] of zs) {
        const t = (now - q.t0 - d * 45) / 800;
        if (t < 0 || t > 1) continue;
        const a = 0.45 * (1 - t) * (t < 0.12 ? t / 0.12 : 1);
        const [sx, sy] = this.toScreen(x, y);
        ctx.globalAlpha = a;
        ctx.beginPath(); ctx.arc(sx, sy, rr * (0.75 + 0.35 * t), 0, Math.PI * 2); ctx.fill();
      }
    }
    // hover preview: exclusion zone of the selected color
    const hv = app.hover;
    if (hv && app.opts.zone && app.tool === 'paint' && !app.dragging) {
      const c = app.selected;
      const zs = this.zonePositions(hv, c);
      const legal = app.board.isFree(hv.v, c);
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = legal ? rgba(c, 1) : this.theme.danger;
      for (const [x, y] of zs) {
        const [sx, sy] = this.toScreen(x, y);
        ctx.beginPath(); ctx.arc(sx, sy, rr, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  drawConflictLines(now) {
    const { ctx, theme } = this;
    const app = this.app, board = app.board, inst = app.inst;
    if (!board.conflictCount() && !this.flashLines && !(app.hover && app.hoverBlockers)) return;
    ctx.save();
    ctx.lineCap = 'round';
    const pulse = 0.55 + 0.45 * Math.sin(now / 180);
    if (board.conflictCount()) {
      ctx.strokeStyle = theme.danger;
      ctx.lineWidth = Math.max(1.5, this.view.s / 18);
      ctx.globalAlpha = 0.5 + 0.4 * pulse;
      ctx.setLineDash([Math.max(3, this.view.s / 6), Math.max(3, this.view.s / 8)]);
      ctx.beginPath();
      for (const [v, u] of board.conflicts(400)) {
        const h = inst.kind === 'periodic' ? { v, ...this.homeCoords(v) } : { v };
        const a = this.instPos(h), b = this.copyNear(h, u);
        if (!b) continue;
        const [x1, y1] = this.toScreen(...a), [x2, y2] = this.toScreen(...b);
        if (u === v) { this.arrow(ctx, x1, y1, x2, y2); continue; }
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const drawLines = (lines, alpha) => {
      ctx.globalAlpha = alpha;
      for (const L of lines) {
        ctx.strokeStyle = L.color ? rgba(L.color, 1) : theme.danger;
        ctx.lineWidth = Math.max(1.5, this.view.s / 16);
        const [x1, y1] = this.toScreen(...L.a), [x2, y2] = this.toScreen(...L.b);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.beginPath(); ctx.arc(x2, y2, VR * this.view.s * 1.35, 0, Math.PI * 2); ctx.stroke();
      }
    };
    if (this.flashLines) {
      const f = this.flashLines;
      const t = (now - f.t0) / (f.until - f.t0);
      if (t <= 1) drawLines(f.lines, 0.9 * (t < 0.8 ? 1 : (1 - t) / 0.2));
      else this.flashLines = null;
    }
    if (app.hover && app.hoverBlockers) drawLines(app.hoverBlockers, 0.85);
    ctx.restore();
  }

  arrow(ctx, x1, y1, x2, y2) {
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    const ang = Math.atan2(y2 - y1, x2 - x1), L = 8;
    ctx.moveTo(x2, y2); ctx.lineTo(x2 - L * Math.cos(ang - 0.4), y2 - L * Math.sin(ang - 0.4));
    ctx.moveTo(x2, y2); ctx.lineTo(x2 - L * Math.cos(ang + 0.4), y2 - L * Math.sin(ang + 0.4));
  }

  homeCoords(v) { const [x, y, i] = this.app.inst.coords(v); return { x, y, i }; }

  drawVertices(now, items, r) {
    const { ctx, theme } = this;
    const app = this.app, board = app.board;
    const puzzle = app.mode === 'puzzle';
    const K = board.K;
    const showNums = r >= 6.5;
    const ghostAlpha = 0.34;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // pass 1: uncolored
    for (let h = 0; h < items.n; h++) {
      const v = items.v[h];
      const pop = this.pops.get(v);
      const c = board.col[v];
      if (c && !(pop && now < pop.t0)) continue;
      let { x, y } = { x: items.x[h], y: items.y[h] };
      const sh = this.shakes.get(v);
      if (sh) x += Math.sin((now - sh) / 22) * 5 * (1 - (now - sh) / 600);
      const home = items.home[h];
      ctx.globalAlpha = home ? 1 : ghostAlpha;
      if (puzzle) this.drawCandidates(v, x, y, r, home, now);
      else {
        ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, r * 0.55), 0, Math.PI * 2);
        ctx.fillStyle = theme.panel; ctx.fill();
        ctx.lineWidth = Math.max(1, r / 9); ctx.strokeStyle = theme.line2; ctx.stroke();
      }
    }

    // pass 2: colored discs
    const conflictPulse = 0.5 + 0.5 * Math.sin(now / 160);
    for (let h = 0; h < items.n; h++) {
      const v = items.v[h];
      const c = board.col[v];
      if (!c) continue;
      const pop = this.pops.get(v);
      let k = 1;
      if (pop) { if (now < pop.t0) continue; k = easeOutBack(clamp01((now - pop.t0) / pop.dur)); }
      let x = items.x[h], y = items.y[h];
      const sh = this.shakes.get(v);
      if (sh) x += Math.sin((now - sh) / 22) * 5 * (1 - (now - sh) / 600);
      const home = items.home[h];
      const col = color(c);
      const rad = r * k;
      ctx.globalAlpha = home ? 1 : ghostAlpha;
      if (board.inConflict(v)) {
        ctx.beginPath(); ctx.arc(x, y, rad * (1.45 + 0.25 * conflictPulse), 0, Math.PI * 2);
        ctx.fillStyle = theme.danger; ctx.globalAlpha *= 0.28 + 0.22 * conflictPulse; ctx.fill();
        ctx.globalAlpha = home ? 1 : ghostAlpha;
      }
      ctx.beginPath(); ctx.arc(x, y, Math.max(1.2, rad), 0, Math.PI * 2);
      ctx.fillStyle = col.fill; ctx.fill();
      if (r > 4) {
        const o = board.origin[v];
        ctx.lineWidth = Math.max(0.8, r / 12);
        ctx.strokeStyle = col.ring;
        ctx.stroke();
        if (o !== ORIGIN.PLAYER && r > 9) {
          // auto-filled / solver / imported: inner ring
          ctx.beginPath(); ctx.arc(x, y, rad * 0.78, 0, Math.PI * 2);
          ctx.strokeStyle = col.text === '#ffffff' ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.22)';
          ctx.lineWidth = Math.max(0.8, r / 14);
          ctx.setLineDash(o === ORIGIN.AUTO ? [] : [r / 5, r / 7]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      if (showNums && k > 0.5) {
        ctx.fillStyle = col.text;
        ctx.font = `${c >= 10 ? 650 : 700} ${Math.round(r * (c >= 10 ? 0.92 : 1.05))}px ${this.theme.font}`;
        ctx.fillText(String(c), x, y + r * 0.04);
      }
    }
    ctx.restore();
  }

  drawCandidates(v, x, y, r, home, now) {
    const { ctx, theme } = this;
    const board = this.app.board;
    const n = board.candCount[v];
    const base = this.app.baseline(v);
    const fontF = this.theme.font;
    if (n >= base && n > 2) {
      // untouched by any placement: a quiet empty vertex
      ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, r * 0.5), 0, Math.PI * 2);
      ctx.fillStyle = theme.panel; ctx.fill();
      ctx.lineWidth = Math.max(1, r / 9); ctx.strokeStyle = theme.line2; ctx.stroke();
      return;
    }
    let fill = theme.panel, stroke = theme.line2, txt = theme.muted;
    if (n === 0) { stroke = color(2).ring; txt = theme.ink; } // the deep red of the color-2 ring
    else if (n === 1) { txt = color(board.onlyCandidate(v)).ring; }
    else if (n === 2) { stroke = theme.warn; txt = theme.ink2; }
    else if (n <= 4) { txt = theme.ink2; }
    const pulse = n === 0 ? 1 + 0.12 * Math.sin(now / 140) : 1;
    const marks = home && r >= 18 && n >= 1 && n <= 6;
    const rad = marks || (n === 0 && home && r >= 18) ? r * 0.98 : r * 0.8;
    ctx.beginPath(); ctx.arc(x, y, Math.max(1.8, rad * pulse), 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.globalAlpha = home ? 1 : 0.34;
    ctx.lineWidth = Math.max(1, r / (n === 0 || n === 2 ? 6 : 10));
    ctx.strokeStyle = stroke; ctx.stroke();
    if (!home || r < 7) return;
    if (marks) {
      // pencil marks: the remaining options, in rows of three
      const cands = board.candidates(v);
      const rows = cands.length <= 3 ? 1 : 2, per = Math.ceil(cands.length / rows);
      const fs = Math.round(r * (per === 1 ? 0.8 : rows === 1 && per <= 2 ? 0.62 : 0.5));
      ctx.font = `700 ${fs}px ${fontF}`;
      const dx = r * 0.58, dy = r * 0.52;
      cands.forEach((c, k) => {
        const row = Math.floor(k / per), cnt = row === rows - 1 ? cands.length - row * per : per, col = k - row * per;
        const px = x + (col - (cnt - 1) / 2) * dx, py = y + (row - (rows - 1) / 2) * dy;
        ctx.fillStyle = color(c).ring;
        ctx.fillText(String(c), px, py + 0.5);
      });
      return;
    }
    ctx.fillStyle = txt;
    ctx.font = `${n === 1 ? 700 : 650} ${Math.round(r * 0.78)}px ${fontF}`;
    ctx.fillText(n === 1 ? String(board.onlyCandidate(v)) : String(n), x, y + r * 0.04);
  }

  drawOverlays(now, r) {
    const { ctx, theme } = this;
    const app = this.app;
    const hv = app.hover;
    if (!hv) return;
    const [x, y] = this.toScreen(...this.instPos(hv));
    ctx.save();
    ctx.lineWidth = 2;
    const legal = app.tool === 'erase' || app.board.isFree(hv.v, app.selected);
    ctx.strokeStyle = legal ? theme.ink : theme.danger;
    ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.arc(x, y, r * 1.3 + 2, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}
