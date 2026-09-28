// Share links, JSON files and local storage (personal bests, gallery).

// Colors 0..52 as one character each ('.' = uncolored, a–z = 1–26, A–Z = 27–52),
// runs written as <char><count> when count > 1.
const ALPH = '.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function encodeColors(col) {
  let out = '';
  for (let i = 0; i < col.length;) {
    let j = i;
    while (j < col.length && col[j] === col[i]) j++;
    out += ALPH[Math.min(col[i], 52)] + (j - i > 1 ? String(j - i) : '');
    i = j;
  }
  return out;
}

export function decodeColors(s, N) {
  const col = new Uint8Array(N);
  let p = 0, i = 0;
  while (i < s.length && p < N) {
    const c = ALPH.indexOf(s[i++]);
    if (c < 0) throw new Error('Bad color string');
    let n = '';
    while (i < s.length && s[i] >= '0' && s[i] <= '9') n += s[i++];
    const k = n ? parseInt(n, 10) : 1;
    for (let t = 0; t < k && p < N; t++) col[p++] = c;
  }
  return col;
}

const b64 = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

export function sourceToParams(src) {
  const p = new URLSearchParams();
  if (src.kind === 'periodic') {
    if (src.custom) p.set('lat', b64(JSON.stringify(src.custom)));
    else p.set('g', src.lattice);
    p.set('P', src.P.flat().join('.'));
  } else {
    if (src.g6) p.set('g6', src.g6);
    else if (src.edges) p.set('el', b64(JSON.stringify([src.n, src.edges])));
    else {
      p.set('f', src.preset);
      if (src.params && Object.keys(src.params).length) p.set('fp', Object.entries(src.params).map(([k, v]) => `${k}${v}`).join('.'));
    }
    if (src.sub) p.set('sub', String(src.sub));
    if (src.name && (src.g6 || src.edges)) p.set('name', src.name);
  }
  return p;
}

export function paramsToSource(p) {
  if (p.has('g') || p.has('lat')) {
    const P = (p.get('P') || '6.0.0.6').split('.').map(Number);
    const src = { kind: 'periodic', P: [[P[0], P[1]], [P[2], P[3]]] };
    if (p.has('lat')) src.custom = JSON.parse(unb64(p.get('lat')));
    else src.lattice = p.get('g');
    return src;
  }
  if (p.has('f') || p.has('g6') || p.has('el')) {
    const src = { kind: 'finite', sub: +(p.get('sub') || 0) };
    if (p.has('g6')) src.g6 = p.get('g6');
    else if (p.has('el')) { const [n, edges] = JSON.parse(unb64(p.get('el'))); src.n = n; src.edges = edges; }
    else {
      src.preset = p.get('f');
      src.params = {};
      if (p.get('fp')) for (const kv of p.get('fp').split('.')) { const m = kv.match(/^([a-z]+)(-?\d+)$/i); if (m) src.params[m[1]] = +m[2]; }
    }
    if (p.has('name')) src.name = p.get('name');
    return src;
  }
  return null;
}

export function sourceKey(src) { return sourceToParams(src).toString(); }

export function buildHash(state) {
  const p = sourceToParams(state.source);
  p.set('K', String(state.K));
  if (state.R !== 30) p.set('R', String(state.R));
  p.set('m', state.mode);
  if (state.col && state.col.some(c => c)) p.set('c', encodeColors(state.col));
  return '#' + p.toString();
}

export function parseHash(hash) {
  if (!hash || hash.length < 2) return null;
  const p = new URLSearchParams(hash.slice(1));
  const source = paramsToSource(p);
  if (!source) return null;
  return {
    source,
    K: p.has('K') ? +p.get('K') : null,
    R: p.has('R') ? +p.get('R') : null,
    mode: p.get('m') || null,
    colors: p.get('c') || null,
  };
}

// ---------- local storage (never required for the page to work) ----------
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};

export const prefs = {
  load() { return LS.get('pcl.prefs', {}); },
  save(p) { LS.set('pcl.prefs', p); },
};

// The last board this browser had open (a share-link hash), reopened on the next visit.
export const lastBoard = {
  load() { try { return localStorage.getItem('pcl.last') || ''; } catch { return ''; } },
  save(h) { try { localStorage.setItem('pcl.last', h); } catch { /* ignore */ } },
};

export const bests = {
  get(key) { return LS.get('pcl.best', {})[key] || null; },
  offer(key, entry) {
    const all = LS.get('pcl.best', {});
    const cur = all[key];
    if (cur && cur.score <= entry.score) return false;
    all[key] = entry;
    LS.set('pcl.best', all);
    return true;
  },
};

export const gallery = {
  list() { return LS.get('pcl.gallery', []); },
  add(entry) {
    const all = gallery.list();
    if (all.some(e => e.hash === entry.hash)) return false;
    all.unshift(entry);
    LS.set('pcl.gallery', all.slice(0, 60));
    return true;
  },
  remove(hash) { LS.set('pcl.gallery', gallery.list().filter(e => e.hash !== hash)); },
};

export function download(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
