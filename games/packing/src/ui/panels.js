// Sidebar, palette, chips, toasts and modals.

import { color } from './palette.js';
import { PRESET_ORDER, PRESETS } from '../engine/lattices.js';
import { FINITE_PRESETS } from '../engine/finite.js';
import { NONE } from '../engine/tables.js';

export const $ = id => document.getElementById(id);
export const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return e;
};
const fmtPct = x => (x * 100).toFixed(x < 0.1 ? 1 : 0) + '%';

// ---------------------------------------------------------------- toasts & modal

export function toast(msg, { kind = '', ms = 3800, action = null } = {}) {
  const box = $('toasts');
  const t = el('div', { class: `toast ${kind}` }, el('span', {}, msg));
  if (action) t.append(el('button', { onclick: () => { action.run(); close(); } }, action.label));
  box.append(t);
  while (box.children.length > 3) box.firstChild.remove();
  let timer = setTimeout(close, ms);
  function close() { clearTimeout(timer); t.classList.add('out'); setTimeout(() => t.remove(), 260); }
  return close;
}

export function openModal(title, body, actions = []) {
  $('modal-title').textContent = title;
  const b = $('modal-body');
  b.innerHTML = '';
  if (typeof body === 'string') b.innerHTML = body; else b.append(body);
  if (actions.length) {
    b.append(el('div', { class: 'actions' }, actions.map(a => el('button', {
      class: `btn ${a.primary ? 'primary' : ''}`,
      onclick: () => { if (a.run() !== false) closeModal(); },
    }, a.label))));
  }
  $('modal').hidden = false;
  const f = b.querySelector('textarea, input, .btn.primary');
  if (f) setTimeout(() => f.focus(), 50);
}
export function closeModal() { $('modal').hidden = true; }
export const modalOpen = () => !$('modal').hidden;

// ---------------------------------------------------------------- graph panel

const LATTICE_KEYS = PRESET_ORDER.map(id => `lat:${id}`).concat(['lat:custom']);
const FINITE_KEYS = Object.keys(FINITE_PRESETS).map(id => `fin:${id}`).concat(['fin:custom']);

const CUSTOM_LATTICE_EXAMPLE = JSON.stringify({
  name: 'Truncated square (4.8.8)',
  basis: [[2.4142135624, 0], [0, 2.4142135624]],
  sites: [[0.7071067812, 0], [0, 0.7071067812], [-0.7071067812, 0], [0, -0.7071067812]],
  edges: [[0, 1, 0, 0], [1, 2, 0, 0], [2, 3, 0, 0], [3, 0, 0, 0], [0, 2, 1, 0], [1, 3, 0, 1]],
}, null, 1);

export function buildGraphPanel(app) {
  const sel = $('graph-select');
  sel.innerHTML = '';
  const g1 = el('optgroup', { label: 'Periodic lattices' });
  for (const id of PRESET_ORDER) g1.append(el('option', { value: `lat:${id}` }, PRESETS[id]().name));
  g1.append(el('option', { value: 'lat:custom' }, 'Custom lattice (JSON)…'));
  const g2 = el('optgroup', { label: 'Finite graphs' });
  for (const [id, p] of Object.entries(FINITE_PRESETS)) g2.append(el('option', { value: `fin:${id}` }, p.name));
  g2.append(el('option', { value: 'fin:custom' }, 'Custom graph (edge list / graph6)…'));
  sel.append(g1, g2);
  sel.addEventListener('change', () => renderGraphParams(app, sel.value, null));
  $('btn-apply-graph').addEventListener('click', () => {
    try { app.buildFromPanel(readGraphParams(sel.value)); }
    catch (err) { toast(err.message, { kind: 'bad' }); }
  });
}

export function syncGraphPanel(app) {
  const src = app.source;
  let key;
  if (src.kind === 'periodic') key = src.custom ? 'lat:custom' : `lat:${src.lattice}`;
  else key = src.g6 || src.edges ? 'fin:custom' : `fin:${src.preset}`;
  $('graph-select').value = key;
  renderGraphParams(app, key, src);
}

function num(id, label, value, min, max) {
  return el('label', { class: 'field' }, el('span', {}, label),
    el('input', { type: 'number', id, value, min, max, step: 1 }));
}

function renderGraphParams(app, key, src) {
  const box = $('graph-params');
  box.innerHTML = '';
  box.dataset.key = key;
  const [kind, id] = key.split(':');
  if (kind === 'lat') {
    const P = src && src.kind === 'periodic' ? src.P : app.lastPeriodicP || [[6, 0], [0, 6]];
    const diag = P[0][1] === 0 && P[1][0] === 0;
    if (id === 'custom') {
      const ta = el('textarea', { id: 'gp-lattice', spellcheck: 'false' });
      ta.value = src && src.custom ? JSON.stringify(src.custom, null, 1) : CUSTOM_LATTICE_EXAMPLE;
      box.append(el('label', { class: 'field' }, el('span', {}, 'Lattice: basis vectors, sites and edges [i, j, dx, dy] (site i in cell (x,y) ~ site j in cell (x+dx, y+dy))'), ta));
    }
    box.append(el('div', { class: 'params' },
      num('gp-n', 'Chunk width n', diag ? P[0][0] : 6, 1, 60),
      num('gp-m', 'Chunk height m', diag ? P[1][1] : 6, 1, 60)));
    const adv = el('details', { class: 'adv', ...(diag ? {} : { open: true }) },
      el('summary', {}, 'Skewed periods (advanced)'),
      el('label', { class: 'toggle' }, el('input', { type: 'checkbox', id: 'gp-skew', ...(diag ? {} : { checked: true }) }), el('span', {}, 'Use the period vectors below')),
      el('div', { class: 'matrix' },
        el('span', {}, 'P₁ ='), el('input', { type: 'number', id: 'gp-p11', value: P[0][0] }), el('input', { type: 'number', id: 'gp-p12', value: P[0][1] }),
        el('span', {}, 'P₂ ='), el('input', { type: 'number', id: 'gp-p21', value: P[1][0] }), el('input', { type: 'number', id: 'gp-p22', value: P[1][1] })),
      el('p', { class: 'note small' }, 'The coloring repeats under translations by P₁ and P₂ (in unit cells). n × m is P₁ = (n, 0), P₂ = (0, m).'));
    box.append(adv);
    box.append(el('label', { class: 'toggle' }, el('input', { type: 'checkbox', id: 'gp-keep', checked: true }), el('span', {}, 'Keep the current pattern when resizing')));
  } else {
    if (id === 'custom') {
      const ta = el('textarea', { id: 'gp-text', spellcheck: 'false', placeholder: 'One edge per line, e.g.\n0 1\n1 2\n2 0\n\nor a graph6 string, e.g. IheA@GUAo' });
      if (src && src.g6) ta.value = src.g6;
      else if (src && src.edges) ta.value = src.edges.map(e => e.join(' ')).join('\n');
      box.append(el('label', { class: 'field' }, el('span', {}, 'Edge list or graph6'), ta));
    } else {
      const P = FINITE_PRESETS[id];
      const vals = { ...(P.params || {}), ...(src && src.preset === id ? src.params : {}) };
      if (P.params) box.append(el('div', { class: 'params' }, Object.keys(P.params).map(k => num(`gp-f-${k}`, k, vals[k], 0, 2000))));
    }
    const sub = src && src.kind === 'finite' ? src.sub || 0 : 0;
    box.append(el('div', { class: 'params' }, num('gp-sub', 'Subdivide edges', sub, 0, 5)));
    box.append(el('p', { class: 'note small' }, 'Subdivide 1 builds S(G): every edge becomes a path of length 2. Drag vertices to rearrange.'));
  }
}

function readGraphParams(key) {
  const [kind, id] = key.split(':');
  const v = i => { const e = $(i); return e ? parseInt(e.value, 10) : NaN; };
  if (kind === 'lat') {
    let P;
    if ($('gp-skew') && $('gp-skew').checked) P = [[v('gp-p11'), v('gp-p12')], [v('gp-p21'), v('gp-p22')]];
    else P = [[v('gp-n'), 0], [0, v('gp-m')]];
    if (P.flat().some(x => !Number.isFinite(x))) throw new Error('Period entries must be integers.');
    const det = Math.abs(P[0][0] * P[1][1] - P[0][1] * P[1][0]);
    if (!det) throw new Error('The period vectors are parallel.');
    const src = { kind: 'periodic', P };
    if (id === 'custom') {
      try { src.custom = JSON.parse($('gp-lattice').value); } catch { throw new Error('Lattice JSON does not parse.'); }
      if (!src.custom.sites || !src.custom.edges || !src.custom.basis) throw new Error('Lattice JSON needs basis, sites and edges.');
    } else src.lattice = id;
    return { source: src, keep: $('gp-keep')?.checked ?? true };
  }
  const src = { kind: 'finite', sub: Math.max(0, v('gp-sub') || 0) };
  if (id === 'custom') {
    const text = $('gp-text').value.trim();
    if (!text) throw new Error('Paste an edge list or a graph6 string.');
    if (/^(>>graph6<<)?[?-~]+$/.test(text) && !/\s/.test(text) && !/^\d+$/.test(text)) src.g6 = text.replace(/^>>graph6<</, '');
    else src.edgeText = text;
  } else {
    src.preset = id;
    src.params = {};
    for (const k of Object.keys(FINITE_PRESETS[id].params || {})) src.params[k] = v(`gp-f-${k}`);
  }
  return { source: src, keep: false };
}

// ---------------------------------------------------------------- palette

export function renderPalette(app) {
  const box = $('palette');
  box.innerHTML = '';
  const K = app.paletteMax();
  const counts = app.board.counts();
  const minSelf = app.inst.minSelfDist();
  for (let c = 1; c <= K; c++) {
    const col = color(c);
    const b = el('button', {
      class: `swatch ${app.tool === 'paint' && app.selected === c ? 'on' : ''} ${minSelf !== NONE && c >= minSelf ? 'dim' : ''}`,
      title: minSelf !== NONE && c >= minSelf ? `Color ${c} never fits in this chunk (vertices are within ${c} of their own copies)` : `Color ${c}${c <= 10 ? ` (key ${c % 10})` : ''}`,
      style: `background:${col.fill};color:${col.text}`,
      onclick: () => app.select(c),
    }, String(c));
    if (counts[c]) b.append(el('span', { class: 'count' }, counts[c]));
    box.append(b);
  }
  box.append(el('span', { class: 'sep' }));
  box.append(el('button', {
    class: `swatch eraser ${app.tool === 'erase' ? 'on' : ''}`, title: 'Eraser (E) · right-click or long-press also erases',
    onclick: () => app.setTool(app.tool === 'erase' ? 'paint' : 'erase'),
  }, '⌫'));
}

// ---------------------------------------------------------------- chips & stats

export function renderChips(app) {
  const b = app.board, N = b.N;
  const conf = b.conflictCount();
  const chips = [];
  chips.push(el('span', { class: `chip ${b.isTiled() ? 'good' : ''}` }, 'Colored ', el('b', {}, `${b.colored}/${N}`)));
  chips.push(el('span', { class: `chip ${conf ? 'bad' : ''}` }, 'Conflicts ', el('b', {}, conf)));
  chips.push(el('span', { class: 'chip opt' }, 'Max ', el('b', {}, b.maxColor() || '–')));
  if (app.mode === 'puzzle') {
    const dead = b.deadVertices().length;
    chips.push(el('span', { class: 'chip opt' }, 'Budget ', el('b', {}, app.K)));
    if (dead) chips.push(el('span', { class: 'chip bad' }, 'Dead ends ', el('b', {}, dead)));
    else {
      const forced = b.forcedVertices().length;
      if (forced && !app.autofill) chips.push(el('span', { class: 'chip warn' }, 'Forced ', el('b', {}, forced)));
    }
  }
  $('chips').replaceChildren(...chips);
  $('btn-undo').disabled = !b.canUndo();
  $('btn-redo').disabled = !b.canRedo();
}

export function renderStats(app) {
  const b = app.board, inst = app.inst, N = b.N;
  $('progress-fill').style.width = `${(100 * b.colored) / N}%`;
  const conf = b.conflictCount();
  const rows = [
    ['Vertices', N],
    ['Colored', `${b.colored} (${fmtPct(b.colored / N)})`],
    ['Conflicts', conf, conf ? 'bad' : ''],
    ['Largest color', b.maxColor() || '–'],
  ];
  if (app.mode === 'puzzle') {
    rows.push(['Forced', b.forcedVertices().length]);
    const dead = b.deadVertices().length;
    rows.push(['Dead ends', dead, dead ? 'bad' : '']);
  }
  $('stat-grid').replaceChildren(...rows.map(([k, v, cls]) => el('div', { class: `stat ${cls || ''}` }, el('span', {}, k), el('b', {}, v))));

  const counts = b.counts();
  const bounds = app.densityBounds();
  const dist = [];
  for (let c = 1; c <= Math.max(b.maxColor(), 0); c++) {
    if (!counts[c]) continue;
    const f = counts[c] / N;
    const col = color(c);
    const bar = el('div', { class: 'dist-bar' }, el('i', { style: `width:${Math.min(100, f * 100 * 2)}%;background:${col.fill}` }));
    if (bounds && bounds[c] && bounds[c] < 0.5) bar.append(el('s', { style: `left:${bounds[c] * 200}%`, title: `density bound ${fmtPct(bounds[c])}` }));
    dist.push(el('div', { class: 'dist-row', title: `${counts[c]} vertices` },
      el('span', { class: 'dist-sw', style: `background:${col.fill};color:${col.text}` }, c), bar, el('span', {}, fmtPct(f))));
  }
  $('dist').replaceChildren(...dist);

  let note = '';
  if (inst.kind === 'periodic') {
    const L = inst.lattice;
    if (L.alpha) note += `Color 1 can cover at most ${fmtPct(L.alpha)} of ${L.name.replace(/ lattice$/, '')}${L.id === 'kagome' ? ' (each vertex lies in exactly one up-triangle, and a triangle holds at most one 1)' : ''}. `;
    note += 'Tick marks show the ball-packing bound 1/|B(⌊c/2⌋)| for each color. ';
    const lb = app.densityLowerBound();
    if (lb) note += `Summing the bounds, any packing coloring needs at least ${lb} colors.`;
  }
  $('stat-note').textContent = note;
}

// ---------------------------------------------------------------- gallery

export function renderGallery(app, items) {
  const box = $('gallery');
  if (!items.length) { box.replaceChildren(el('div', { class: 'gallery-empty' }, 'Valid colorings you find are saved here.')); return; }
  box.replaceChildren(...items.slice(0, 20).map(it => el('div', { class: 'gallery-item' },
    el('span', {}, el('b', {}, it.score), ` colors · ${it.title}`),
    el('button', { class: 'btn small', onclick: () => app.loadHash(it.hash) }, 'Load'),
    el('button', { class: 'btn ghost small', title: 'Remove', onclick: () => app.removeFromGallery(it.hash) }, '×'))));
}
