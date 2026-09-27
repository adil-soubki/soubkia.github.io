// Colors for 1..50: OKLCH hues spaced by the golden angle with a repeating lightness
// pattern, so neighboring numbers look clearly different. Every disc also shows its number.

function oklchToRgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
  return lin.map(x => {
    const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(Math.max(x, 0), 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  });
}

function inGamut(L, C, h) {
  // reduce chroma until the color fits in sRGB
  for (let c = C; c > 0; c -= 0.005) {
    const hRad = (h * Math.PI) / 180;
    const a = c * Math.cos(hRad), b = c * Math.sin(hRad);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
    const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const bb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
    if (r >= -1e-4 && r <= 1.0001 && g >= -1e-4 && g <= 1.0001 && bb >= -1e-4 && bb <= 1.0001) return c;
  }
  return 0;
}

const LIGHTNESS = [0.80, 0.66, 0.73, 0.59, 0.86];
const hex = rgb => '#' + rgb.map(x => x.toString(16).padStart(2, '0')).join('');

function luminance([r, g, b]) {
  const f = x => { x /= 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export const COLORS = [null];
for (let c = 1; c <= 60; c++) {
  const h = (255 + (c - 1) * 137.508) % 360;
  const L = c === 1 ? 0.83 : LIGHTNESS[(c - 1) % LIGHTNESS.length];
  const C = inGamut(L, c === 1 ? 0.075 : 0.13, h);
  const rgb = oklchToRgb(L, C, h);
  const lum = luminance(rgb);
  COLORS.push({
    fill: hex(rgb),
    rgb,
    text: lum > 0.36 ? '#1d1f25' : '#ffffff',
    ring: hex(oklchToRgb(Math.max(0.25, L - 0.22), Math.min(C + 0.02, 0.2), h)),
  });
}

export const color = c => COLORS[Math.min(c, COLORS.length - 1)];
export const rgba = (c, a) => { const [r, g, b] = color(c).rgb; return `rgba(${r},${g},${b},${a})`; };
