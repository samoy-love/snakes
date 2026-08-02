/* Преобразования и кэши цвета игроков.
   Чистые функции без состояния игры: hsl-строка -> rgb, «подсветка» hsl
   для читаемости на тёмном фоне и раскладка номера цвета в hsl.
   Кэши живут здесь же, потому что вне этих функций к ним никто не обращался. */

const rgbCache = new Map();
const boostCache = new Map();

export function hslToRgb(hsl) {
  const cached = rgbCache.get(hsl);
  if (cached) return cached;
  const m = String(hsl).match(/^hsl\((\d+)\s+(\d+)%\s+(\d+)%\)$/);
  if (!m) {
    const fallback = [200, 200, 200];
    rgbCache.set(hsl, fallback);
    return fallback;
  }
  let h = Number(m[1]) / 360;
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;

  function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }

  let r;
  let g;
  let b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const out = [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  rgbCache.set(hsl, out);
  return out;
}

export function boostHsl(hsl) {
  const key = String(hsl);
  const cached = boostCache.get(key);
  if (cached) return cached;
  const m = key.match(/^hsl\((\d+)\s+(\d+)%\s+(\d+)%\)$/);
  if (!m) return key;
  const h = Number(m[1]);
  const s = Number(m[2]);
  const l = Number(m[3]);
  const s2 = Math.max(72, Math.min(100, Math.round(s * 1.25)));
  const l2 = Math.max(48, Math.min(74, Math.round(l + 10)));
  const out = `hsl(${h} ${s2}% ${l2}%)`;
  boostCache.set(key, out);
  return out;
}

export function hueToHsl(h) {
  const COLOR_VARIANTS = [
    [78, 52],
    [78, 42],
    [78, 62],
    [90, 52],
    [66, 52],
    [90, 62]
  ];
  const code = Number(h);
  if (!Number.isFinite(code)) return 'hsl(210 78% 52%)';
  const safe = Math.max(0, Math.floor(code));
  const hue = safe % 360;
  const vi = Math.floor(safe / 360) % COLOR_VARIANTS.length;
  const v = COLOR_VARIANTS[vi] || COLOR_VARIANTS[0];
  return `hsl(${hue} ${v[0]}% ${v[1]}%)`;
}
