// A short burst of palette-colored confetti for a win.

import { color } from './palette.js';

export function celebrate() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cv = document.getElementById('confetti');
  const ctx = cv.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = innerWidth, H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const parts = [];
  for (let i = 0; i < 160; i++) {
    const side = i % 2 ? 1 : -1;
    parts.push({
      x: W / 2 + side * W * 0.18, y: H * 0.62,
      vx: side * -(2 + Math.random() * 7) + (Math.random() - 0.5) * 3, vy: -(7 + Math.random() * 9),
      r: 3 + Math.random() * 4, c: color(1 + Math.floor(Math.random() * 16)).fill,
      rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, shape: Math.random() < 0.5,
    });
  }
  const t0 = performance.now();
  const step = (t) => {
    const k = (t - t0) / 1000;
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.28; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - k / 2.6);
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      if (p.shape) { ctx.beginPath(); ctx.arc(0, 0, p.r, 0, Math.PI * 2); ctx.fill(); }
      else ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
      ctx.restore();
    }
    if (k < 2.6) requestAnimationFrame(step); else ctx.clearRect(0, 0, W, H);
  };
  requestAnimationFrame(step);
}
