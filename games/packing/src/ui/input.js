// Pointer, wheel, pinch and keyboard handling for the stage.

export function attachInput(canvas, app) {
  const R = app.renderer;
  const pointers = new Map();
  let down = null;   // { id, x, y, button, moved, hit, dragVertex }
  let pinch = null;  // { d, mx, my }
  let longPress = null;

  const local = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  canvas.addEventListener('contextmenu', e => e.preventDefault());

  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = local(e);
    pointers.set(e.pointerId, { x, y });
    if (pointers.size === 2) {
      clearTimeout(longPress);
      down = null;
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    const hit = R.hit(x, y);
    down = { id: e.pointerId, x, y, button: e.button, moved: false, hit, dragVertex: false, type: e.pointerType };
    if (e.pointerType === 'touch' && hit) {
      clearTimeout(longPress);
      longPress = setTimeout(() => {
        if (down && !down.moved) { app.erase(hit); down = null; navigator.vibrate?.(15); }
      }, 520);
    }
  });

  canvas.addEventListener('pointermove', e => {
    const [x, y] = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x, y });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      R.panBy(mx - pinch.mx, my - pinch.my);
      R.zoomAt(mx, my, d / (pinch.d || d));
      pinch = { d, mx, my };
      app.requestDraw();
      return;
    }
    if (down && down.id === e.pointerId) {
      const dx = x - down.x, dy = y - down.y;
      if (!down.moved && Math.hypot(dx, dy) > 5) {
        down.moved = true;
        clearTimeout(longPress);
        down.dragVertex = app.inst?.kind === 'finite' && down.hit && down.button === 0;
        app.dragging = true;
        canvas.classList.toggle('panning', !down.dragVertex);
        app.setHover(null);
      }
      if (down.moved) {
        if (down.dragVertex) app.moveVertex(down.hit.v, R.toWorld(x, y));
        else R.panBy(dx, dy);
        down.x = x; down.y = y;
        app.requestDraw();
      }
      return;
    }
    if (e.pointerType === 'mouse') app.setHover(R.hit(x, y), x, y);
  });

  const end = e => {
    pointers.delete(e.pointerId);
    clearTimeout(longPress);
    if (pinch) { if (pointers.size < 2) pinch = null; return; }
    if (down && down.id === e.pointerId) {
      if (!down.moved && down.hit && e.type === 'pointerup') {
        if (down.button === 2) app.erase(down.hit);
        else if (down.button === 0) app.click(down.hit);
      }
      down = null;
      app.dragging = false;
      canvas.classList.remove('panning');
    }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !down) app.setHover(null); });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const [x, y] = local(e);
    if (e.ctrlKey || e.deltaMode === 1 || Math.abs(e.deltaY) >= 40 && Math.abs(e.deltaX) < 1) {
      // mouse wheel or trackpad pinch: zoom
      R.zoomAt(x, y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022)));
    } else {
      // two-finger trackpad scroll: pan
      R.panBy(-e.deltaX, -e.deltaY);
    }
    app.requestDraw();
    app.setHover(R.hit(x, y), x, y);
  }, { passive: false });

  // ---------- keyboard ----------
  let digitBuf = null, digitTimer = null;
  window.addEventListener('keydown', e => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'Escape') { app.closeModal(); return; }
    if (app.modalOpen()) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? app.redo() : app.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); app.redo(); return; }
    if (mod) return;
    if (/^[0-9]$/.test(e.key)) {
      const d = +e.key;
      const max = app.paletteMax();
      clearTimeout(digitTimer);
      if (digitBuf !== null && digitBuf * 10 + d <= max) {
        app.select(digitBuf * 10 + d);
        digitBuf = null;
        return;
      }
      const c = d === 0 ? 10 : d;
      if (c <= max) app.select(c);
      digitBuf = d !== 0 && d * 10 <= max ? d : null;
      digitTimer = setTimeout(() => { digitBuf = null; }, 750);
      return;
    }
    switch (e.key) {
      case 'e': case 'E': case 'Backspace': case 'Delete': app.setTool(app.tool === 'erase' ? 'paint' : 'erase'); break;
      case 'z': app.undo(); break;
      case 'Z': app.redo(); break;
      case 'f': case 'F': R.fit(); app.requestDraw(); break;
      case 'h': case 'H': app.hint(); break;
      case '[': app.select(Math.max(1, app.selected - 1)); break;
      case ']': app.select(Math.min(app.paletteMax(), app.selected + 1)); break;
      case '+': case '=': R.zoomAt(R.W / 2, R.H / 2, 1.25); app.requestDraw(); break;
      case '-': case '_': R.zoomAt(R.W / 2, R.H / 2, 0.8); app.requestDraw(); break;
      default: return;
    }
    e.preventDefault();
  });
}
