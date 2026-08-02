/* Отрисовка косметики — единый источник правды.
   На каждую категорию (seg/head/nameplate/capturefx/terr/death/frame) ровно
   одна функция, её зовёт и игровой цикл draw(), и превью магазина. Здесь же
   живут их кэши плиток, заливок и градиентов. Состояния игры модуль не знает:
   всё — цвет, id предмета, размер клетки, фаза анимации — приходит аргументами. */

import { hslToRgb } from './client_color.js';

/* ==========================================================================
   КОСМЕТИКА: ЕДИНЫЙ ИСТОЧНИК ПРАВДЫ
   --------------------------------------------------------------------------
   На каждую категорию — ровно ОДНА функция отрисовки. Её вызывает и игровой
   цикл draw(), и мини-иконка карточки магазина, и большое превью. Отличаются
   вызовы только параметрами (размер клетки, alpha, фаза анимации, направление).
   Поэтому расхождение «в магазине одно, в игре другое» структурно невозможно.

   Правило палитры: цвет редкости живёт ТОЛЬКО в UI магазина (полоска карточки,
   бейдж тира, цена). Сам предмет красится цветом игрока и различается
   СТРУКТУРОЙ и ДВИЖЕНИЕМ. Исключение — capturefx 5..7: у них своя палитра.
   ========================================================================== */

export const COS_FONT = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';

export function cosClampId(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(7, n | 0));
}

// Кэш градиентов «Плазмы». Ключ — цвет + размер клетки, хранилище привязано к
// конкретному контексту (градиент нельзя переносить между канвасами).
// Без кэша createLinearGradient звался бы на каждую клетку следа каждый кадр.
const cosGradCache = new WeakMap();

function cosCachedGradient(ctx, key, make) {
  let m = cosGradCache.get(ctx);
  if (!m) {
    m = new Map();
    cosGradCache.set(ctx, m);
  }
  let g = m.get(key);
  if (g) return g;
  g = make();
  if (m.size > 48) m.clear();
  m.set(key, g);
  return g;
}

/* K6: строки `rgba(...)` собирались на КАЖДУЮ клетку следа каждый кадр — до
   3.6к аллокаций за кадр на мобильном. Кэш повторяет приём getOwnerFillStyle:
   квантованная альфа + цвет как ключ. Ключом здесь служит hsl, а не номер
   игрока, потому что drawSegTile зовётся ещё и из превью магазина, где номера
   игрока нет вовсе. */
const COS_ALPHA_STEPS = 24;
const cosFillCache = new Map();

function cosQuantA(a) {
  const v = Math.max(0, Math.min(1, Number(a) || 0));
  return Math.round(v * COS_ALPHA_STEPS);
}

function cosSegFill(hsl, a) {
  const ai = cosQuantA(a);
  const key = `${hsl}|${ai}`;
  let v = cosFillCache.get(key);
  if (v) return v;
  const rgb = hslToRgb(hsl);
  v = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(ai / COS_ALPHA_STEPS).toFixed(3)})`;
  if (cosFillCache.size > 640) cosFillCache.clear();
  cosFillCache.set(key, v);
  return v;
}

const cosWhiteCache = new Map();

function cosWhiteFill(a) {
  const ai = cosQuantA(a);
  let v = cosWhiteCache.get(ai);
  if (v) return v;
  v = `rgba(255,255,255,${(ai / COS_ALPHA_STEPS).toFixed(3)})`;
  cosWhiteCache.set(ai, v);
  return v;
}

// «Бездна» (id 7) заливается фиксированным тёмным цветом — ему свой кэш.
const cosVoidCache = new Map();

function cosVoidFill(a) {
  const ai = cosQuantA(a);
  let v = cosVoidCache.get(ai);
  if (v) return v;
  v = `rgba(4,6,10,${(ai / COS_ALPHA_STEPS).toFixed(3)})`;
  cosVoidCache.set(ai, v);
  return v;
}

/* K6: «Неон» (id 1) и «Полосы» (id 2) — единственные варианты следа, чей
   рисунок не зависит ни от времени, ни от seed, и одновременно самые дорогие в
   цикле: у Неона был save/restore + shadowBlur НА КЛЕТКУ (4.23 мс на 300
   клеток на десктопе, 20-35 мс на телефоне — один кадровый бюджет целиком), у
   Полос — save + clip() + ~4 stroke() на клетку (2.09 мс).
   Тот же приём, что уже применён к территории: рисуем плитку один раз в
   оффскрин на пару (цвет, размер клетки), а в цикле остаётся один drawImage.
   Альфа не запекается — она накладывается через globalAlpha, иначе кэш
   размножился бы на каждый шаг пульсации собственного следа.
   У Неона свечение выходит за границы клетки, поэтому плитка шире на pad. */
const cosSegTileCache = new Map();

function cosSegTile(hsl, segId, cell) {
  const id = cosClampId(segId);
  if (id !== 1 && id !== 2) return null;
  const c = Math.max(1, Math.round(cell));
  /* C10: раньше ключ склеивался строкой на КАЖДУЮ клетку следа каждый кадр.
     Теперь два уровня: по цвету (готовая строка, без склейки) и по числовому
     ключу id/размера. */
  let byColor = cosSegTileCache.get(hsl);
  if (!byColor) {
    if (cosSegTileCache.size > 32) cosSegTileCache.clear();
    byColor = new Map();
    cosSegTileCache.set(hsl, byColor);
  }
  const key = id * 4096 + c;
  const hit = byColor.get(key);
  if (hit) return hit;

  const blur = Math.max(6, c * 0.55);
  const pad = id === 1 ? Math.ceil(blur) + 2 : 0;
  const size = c + pad * 2;
  let cv = null;
  let g = null;
  try {
    cv = document.createElement('canvas');
    cv.width = size;
    cv.height = size;
    g = cv.getContext('2d');
  } catch {
    return null;
  }
  if (!g) return null;

  // Координаты внутри плитки повторяют геометрию исходного кода: отступ 1 px
  // от края клетки, сторона cell-2.
  const x = pad + 1;
  const y = pad + 1;
  const w = Math.max(1, c - 2);
  const h = Math.max(1, c - 2);

  if (id === 1) {
    g.shadowColor = hsl;
    g.shadowBlur = blur;
    g.fillStyle = cosSegFill(hsl, 1);
    g.fillRect(x, y, w, h);
  } else {
    g.fillStyle = cosSegFill(hsl, 0.92);
    g.fillRect(x, y, w, h);
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    g.globalAlpha = 0.45;
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = Math.max(2, c * 0.10);
    const step = Math.max(4, (c * 0.55) | 0);
    for (let k = -c; k <= c * 2; k += step) {
      g.beginPath();
      g.moveTo(pad + k, pad - 2);
      g.lineTo(pad + k + c, pad + c + 2);
      g.stroke();
    }
  }

  const rec = { cv, pad };
  if (byColor.size > 16) byColor.clear();
  byColor.set(key, rec);
  return rec;
}

/* --- SEG: одна клетка следа ------------------------------------------------
   px,py — левый верхний угол клетки; cell — сторона клетки в пикселях.
   seed — стабильное число клетки (в игре из x,y), timeMs — время для анимации.
   Вызывается для каждой клетки следа каждый кадр: внутри нет аллокаций,
   единственный градиент кэшируется. */
export function drawSegTile(ctx, px, py, cell, hsl, segId, seed, alpha, timeMs) {
  const a = Math.max(0, Math.min(1, Number(alpha)));
  if (!(a > 0.02)) return;
  const id = cosClampId(segId);

  const x = px + 1;
  const y = py + 1;
  const w = Math.max(1, cell - 2);
  const h = Math.max(1, cell - 2);

  // K6: Неон и Полосы — из готовой оффскрин-плитки, один drawImage на клетку.
  // C10: hslToRgb считался ДО этой ветки, и её результат в ней не нужен —
  // на самом горячем пути игры это была лишняя работа на каждую клетку следа.
  if (id === 1 || id === 2) {
    const tile = cosSegTile(hsl, id, cell);
    if (tile) {
      const ga = ctx.globalAlpha;
      ctx.globalAlpha = ga * a;
      ctx.drawImage(tile.cv, Math.round(px) - tile.pad, Math.round(py) - tile.pad);
      ctx.globalAlpha = ga;
      return;
    }
    // Плитку не удалось создать (нет canvas) — падаем в честный медленный путь.
    if (id === 1) {
      ctx.save();
      ctx.shadowColor = hsl;
      ctx.shadowBlur = Math.max(6, cell * 0.55);
      ctx.fillStyle = cosSegFill(hsl, a);
      ctx.fillRect(x, y, w, h);
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.fillStyle = cosSegFill(hsl, a * 0.92);
    ctx.fillRect(x, y, w, h);
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = Math.max(2, cell * 0.10);
    const step = Math.max(4, (cell * 0.55) | 0);
    for (let k = -cell; k <= cell * 2; k += step) {
      ctx.beginPath();
      ctx.moveTo(px + k, py - 2);
      ctx.lineTo(px + k + cell, py + cell + 2);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  const rgb = hslToRgb(hsl);
  const r = rgb[0];
  const g = rgb[1];
  const b = rgb[2];
  const now = Number(timeMs) || 0;
  const s = Number(seed) || 0;

  if (id === 3) {
    // Плазма: диагональный градиент + бегущая волна яркости.
    const key = `p|${r},${g},${b}|${cell | 0}`;
    const grad = cosCachedGradient(ctx, key, () => {
      const gg = ctx.createLinearGradient(0, 0, cell, cell);
      gg.addColorStop(0, `rgb(${r},${g},${b})`);
      gg.addColorStop(0.5, 'rgba(255,255,255,0.55)');
      gg.addColorStop(1, 'rgba(0,0,0,0.85)');
      return gg;
    });
    const wv = 0.5 + 0.5 * Math.sin(now * 0.004 + s * 0.35);
    ctx.save();
    ctx.translate(px, py);
    ctx.globalAlpha = a * (0.72 + 0.28 * wv);
    ctx.fillStyle = grad;
    ctx.fillRect(1, 1, w, h);
    ctx.restore();
    return;
  }

  if (id === 4) {
    // Искры: заливка + одна белая искра, прыгающая по клетке.
    // Старая формула `h % (cell - 8)` при cell=9 давала `% 1` — искра всегда
    // в одной точке и мерцания не было вовсе. Считаем позицию долей стороны.
    ctx.fillStyle = cosSegFill(hsl, a * 0.92);
    ctx.fillRect(x, y, w, h);
    const hsh = (((s * 73856093) >>> 0) ^ (((now / 90) | 0) * 19349663)) >>> 0;
    const sz = Math.max(1.5, cell * 0.18);
    const sx = x + (w - sz) * ((hsh & 1023) / 1023);
    const sy = y + (h - sz) * (((hsh >>> 10) & 1023) / 1023);
    ctx.fillStyle = cosWhiteFill(0.90 * a);
    ctx.fillRect(sx, sy, sz, sz);
    return;
  }

  if (id === 5) {
    // Схема: тёмная подложка, яркие дорожки крестом и бегущий вдоль хвоста
    // импульс — узел вспыхивает белым, волна идёт от головы к хвосту.
    ctx.fillStyle = cosSegFill(hsl, a * 0.34);
    ctx.fillRect(x, y, w, h);
    const tw = Math.max(1, Math.round(cell * 0.24));
    ctx.fillStyle = cosSegFill(hsl, a);
    ctx.fillRect(x, y + (h - tw) / 2, w, tw);
    ctx.fillRect(x + (w - tw) / 2, y, tw, h * 0.5);
    const ph = (((s - ((now / 90) | 0)) % 6) + 6) % 6;
    if (ph === 0) {
      ctx.fillStyle = cosWhiteFill(0.92 * a);
      const nr = Math.max(1.4, cell * 0.20);
      ctx.fillRect(x + w / 2 - nr, y + h / 2 - nr, nr * 2, nr * 2);
    }
    return;
  }

  if (id === 6) {
    // Мозаика: четыре плитки со швом — шахматка читается даже на 7px.
    const hw = Math.max(1, (w - 1) / 2);
    const hh = Math.max(1, (h - 1) / 2);
    ctx.fillStyle = cosSegFill(hsl, a);
    ctx.fillRect(x, y, hw, hh);
    ctx.fillRect(x + hw + 1, y + hh + 1, hw, hh);
    ctx.fillStyle = cosSegFill(hsl, a * 0.42);
    ctx.fillRect(x + hw + 1, y, hw, hh);
    ctx.fillRect(x, y + hh + 1, hw, hh);
    return;
  }

  if (id === 7) {
    // Бездна: тёмная дыра в яркой рамке — единственный «полый» след.
    const lw = Math.max(1.5, cell * 0.20);
    ctx.fillStyle = cosVoidFill(0.72 * a);
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = cosSegFill(hsl, a);
    ctx.lineWidth = lw;
    ctx.strokeRect(x + lw / 2, y + lw / 2, Math.max(0.5, w - lw), Math.max(0.5, h - lw));
    return;
  }

  // 0 — Классика.
  ctx.fillStyle = cosSegFill(hsl, a);
  ctx.fillRect(x, y, w, h);
}

/* --- HEAD: голова змейки ---------------------------------------------------
   cx,cy — центр клетки; dirX,dirY — вектор движения (асимметричные силуэты
   разворачиваются по нему). Поверх головы игра рисует кольца щита (~0.46-0.50
   клетки) и скорости (~0.60-0.64), поэтому декоративные кольца головы держим
   строго внутри 0.44. */
export function drawHead(ctx, cx, cy, cell, hsl, headId, dirX, dirY, timeMs) {
  const id = cosClampId(headId);
  let dx = Number(dirX);
  let dy = Number(dirY);
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) {
    dx = 1;
    dy = 0;
  }
  const ang = Math.atan2(dy, dx);
  const now = Number(timeMs) || 0;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, cell * 0.07);
  ctx.fillStyle = hsl;
  ctx.strokeStyle = 'rgba(0,0,0,0.40)';

  if (id === 1) {
    // Ромб: вытянут по ходу движения.
    ctx.rotate(ang);
    const r = cell * 0.46;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(0, -r * 0.66);
    ctx.lineTo(-r, 0);
    ctx.lineTo(0, r * 0.66);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (id === 2) {
    // Куб: намеренно самый мелкий и «жёсткий» силуэт.
    const r = cell * 0.29;
    ctx.beginPath();
    ctx.rect(-r, -r, r * 2, r * 2);
    ctx.fill();
    ctx.stroke();
  } else if (id === 3) {
    // Кольцо: единственный силуэт с дыркой — опознаётся мгновенно.
    const ro = cell * 0.42;
    const ri = cell * 0.21;
    ctx.beginPath();
    ctx.arc(0, 0, ro, 0, Math.PI * 2, false);
    ctx.arc(0, 0, ri, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.beginPath();
    ctx.arc(0, 0, ro, 0, Math.PI * 2);
    ctx.stroke();
  } else if (id === 4) {
    // Щит: плоская корма, острый лоб по ходу движения.
    ctx.rotate(ang);
    const r = cell * 0.42;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(r * 0.24, -r * 0.80);
    ctx.lineTo(-r * 0.78, -r * 0.66);
    ctx.lineTo(-r * 0.78, r * 0.66);
    ctx.lineTo(r * 0.24, r * 0.80);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (id === 5) {
    // Стрела: самый крупный и самый асимметричный силуэт.
    ctx.rotate(ang);
    const r = cell * 0.46;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(-r * 0.62, -r * 0.78);
    ctx.lineTo(-r * 0.28, 0);
    ctx.lineTo(-r * 0.62, r * 0.78);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (id === 6) {
    // Затмение: единственная тёмная голова в игре, узнаётся по яркому ободку.
    const r = cell * 0.37;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(6,8,12,0.95)';
    ctx.fill();
    ctx.strokeStyle = hsl;
    ctx.lineWidth = Math.max(1.5, cell * 0.13);
    ctx.stroke();
  } else if (id === 7) {
    // Звезда: пятилучевой силуэт, медленно вращается.
    ctx.rotate(ang * 0.35 + now * 0.0006);
    const ro = cell * 0.44;
    const ri = cell * 0.19;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? ro : ri;
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    // 0 — Орб.
    ctx.beginPath();
    ctx.arc(0, 0, cell * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();

  // Направляющий «нос» — единый для всех вариантов, и в игре, и в превью.
  const noseX = cx + dx * cell * 0.26;
  const noseY = cy + dy * cell * 0.26;
  const noseW = cell * 0.18;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.moveTo(noseX, noseY);
  ctx.lineTo(noseX - dy * noseW, noseY + dx * noseW);
  ctx.lineTo(noseX + dy * noseW, noseY - dx * noseW);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/* --- NAMEPLATE: плашка ника ------------------------------------------------
   x — центр по горизонтали, y — нижняя граница плашки. Варианты отличаются
   ГЕОМЕТРИЕЙ пути, а не альфой заливки. */
export function drawNamePlate(ctx, label, x, y, hsl, plateId, alpha, fontPx, timeMs) {
  const txt = String(label == null ? '' : label);
  if (!txt) return;
  const id = cosClampId(plateId);
  const fs = Math.max(9, Math.round(Number(fontPx) || 12));
  const a = Math.max(0, Math.min(1, Number(alpha == null ? 0.95 : alpha)));
  const now = Number(timeMs) || 0;
  const rgb = hslToRgb(hsl);
  const acc = (aa) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${aa})`;

  ctx.save();
  ctx.font = `${fs}px ${COS_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const h = Math.round(fs * 1.5);
  const basePad = Math.round(fs * 0.62);
  const extraPad = id === 1 ? Math.round(fs * 0.55) : id === 3 ? Math.round(fs * 0.5) : id === 7 ? Math.round(fs * 0.45) : 0;
  const w = Math.ceil(ctx.measureText(txt).width + basePad * 2 + extraPad);
  const px = Math.round(x - w / 2);
  const py = Math.round(y - h);
  const cyy = py + h / 2;
  let textX = px + w / 2;

  ctx.globalAlpha = a;
  ctx.lineWidth = 1;

  if (id === 1) {
    // Планка: прямой прямоугольник + цветная полоса слева.
    const bw = Math.max(3, Math.round(fs * 0.32));
    ctx.fillStyle = 'rgba(0,0,0,0.52)';
    ctx.fillRect(px, py, w, h);
    ctx.fillStyle = acc(0.95);
    ctx.fillRect(px, py, bw, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.strokeRect(px + 0.5, py + 0.5, w - 1, h - 1);
    textX = px + bw + (w - bw) / 2;
  } else if (id === 2) {
    // Скос: срезанные углы.
    const c = Math.round(h * 0.34);
    ctx.beginPath();
    ctx.moveTo(px + c, py);
    ctx.lineTo(px + w - c, py);
    ctx.lineTo(px + w, py + c);
    ctx.lineTo(px + w, py + h - c);
    ctx.lineTo(px + w - c, py + h);
    ctx.lineTo(px + c, py + h);
    ctx.lineTo(px, py + h - c);
    ctx.lineTo(px, py + c);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,0.50)';
    ctx.fill();
    ctx.strokeStyle = acc(0.75);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else if (id === 3) {
    // Свиток: треугольные хвосты по бокам.
    const tl = Math.round(h * 0.42);
    ctx.beginPath();
    ctx.moveTo(px + tl, py);
    ctx.lineTo(px + w - tl, py);
    ctx.lineTo(px + w, py + h / 2);
    ctx.lineTo(px + w - tl, py + h);
    ctx.lineTo(px + tl, py + h);
    ctx.lineTo(px, py + h / 2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,0.48)';
    ctx.fill();
    ctx.strokeStyle = acc(0.68);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else if (id === 4) {
    // Терминал: пунктирная рамка и угловые засечки.
    ctx.fillStyle = 'rgba(0,0,0,0.58)';
    ctx.fillRect(px, py, w, h);
    ctx.save();
    ctx.setLineDash([Math.max(2, fs * 0.22), Math.max(2, fs * 0.18)]);
    ctx.strokeStyle = acc(0.80);
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, w - 1, h - 1);
    ctx.restore();
    const tk = Math.max(3, Math.round(fs * 0.34));
    ctx.strokeStyle = acc(0.95);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, py + tk); ctx.lineTo(px, py); ctx.lineTo(px + tk, py);
    ctx.moveTo(px + w - tk, py); ctx.lineTo(px + w, py); ctx.lineTo(px + w, py + tk);
    ctx.moveTo(px + w, py + h - tk); ctx.lineTo(px + w, py + h); ctx.lineTo(px + w - tk, py + h);
    ctx.moveTo(px + tk, py + h); ctx.lineTo(px, py + h); ctx.lineTo(px, py + h - tk);
    ctx.stroke();
  } else if (id === 5) {
    // Гравюра: фаска — светлая линия сверху-слева, тёмная снизу-справа,
    // текст рисуется дважды со сдвигом (выдавленные буквы).
    ctx.fillStyle = 'rgba(0,0,0,0.60)';
    ctx.fillRect(px, py, w, h);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.34)';
    ctx.beginPath();
    ctx.moveTo(px + 0.5, py + h - 1); ctx.lineTo(px + 0.5, py + 0.5); ctx.lineTo(px + w - 1, py + 0.5);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.beginPath();
    ctx.moveTo(px + w - 0.5, py + 1); ctx.lineTo(px + w - 0.5, py + h - 0.5); ctx.lineTo(px + 1, py + h - 0.5);
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillText(txt, textX + 1, cyy + 1.5);
    ctx.fillStyle = acc(0.98);
    ctx.fillText(txt, textX, cyy + 0.5);
    ctx.restore();
    return;
  } else if (id === 6) {
    // Блик: капсула с бегущей диагональной подсветкой.
    const r = h / 2;
    ctx.beginPath();
    ctx.moveTo(px + r, py);
    ctx.arcTo(px + w, py, px + w, py + h, r);
    ctx.arcTo(px + w, py + h, px, py + h, r);
    ctx.arcTo(px, py + h, px, py, r);
    ctx.arcTo(px, py, px + w, py, r);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,0.46)';
    ctx.fill();
    ctx.strokeStyle = acc(0.45);
    ctx.stroke();
    ctx.save();
    ctx.clip();
    const period = 2200;
    const t01 = ((now % period) / period);
    const bx = px - h + (w + h * 2) * t01;
    ctx.globalAlpha = a * 0.55;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.moveTo(bx, py + h);
    ctx.lineTo(bx + h * 0.55, py);
    ctx.lineTo(bx + h * 1.05, py);
    ctx.lineTo(bx + h * 0.50, py + h);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  } else if (id === 7) {
    // Шеврон: параллелограмм со стрелкой по левому краю.
    const sk = Math.round(h * 0.36);
    ctx.beginPath();
    ctx.moveTo(px + sk, py);
    ctx.lineTo(px + w, py);
    ctx.lineTo(px + w - sk, py + h);
    ctx.lineTo(px, py + h);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,0.50)';
    ctx.fill();
    ctx.strokeStyle = acc(0.70);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px + sk * 0.5, py + h * 0.5);
    ctx.lineTo(px + sk * 1.5, py + 1);
    ctx.lineTo(px + sk * 1.15, py + h * 0.5);
    ctx.lineTo(px + sk * 1.5, py + h - 1);
    ctx.closePath();
    ctx.fillStyle = acc(0.95);
    ctx.fill();
    textX = px + sk + (w - sk) / 2;
  } else {
    // 0 — Капсула.
    const r = h / 2;
    ctx.beginPath();
    ctx.moveTo(px + r, py);
    ctx.arcTo(px + w, py, px + w, py + h, r);
    ctx.arcTo(px + w, py + h, px, py + h, r);
    ctx.arcTo(px, py + h, px, py, r);
    ctx.arcTo(px, py, px + w, py, r);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.stroke();
  }

  ctx.globalAlpha = Math.min(1, a + 0.18);
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.fillText(txt, textX, cyy + 0.5);
  ctx.restore();
}

/* --- CAPTUREFX: вспышка в момент захвата -----------------------------------
   progress 0..1 — фаза одного проигрывания. В игре это age/650мс, в магазине —
   зацикленная фаза. Варианты 0..4 красятся цветом игрока (раньше они дублировали
   палитру рамок и плашек), 5..7 имеют собственную яркую палитру. */
const COS_FX_PALETTE = {
  5: [255, 122, 24],   // магма
  6: [20, 224, 200],   // бирюза
  7: [255, 92, 225]    // магента
};

function cosFxRgb(fxId, hsl) {
  const id = cosClampId(fxId);
  return COS_FX_PALETTE[id] || hslToRgb(hsl);
}

export function drawCaptureFx(ctx, cx, cy, cell, hsl, fxId, progress) {
  const id = cosClampId(fxId);
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  const rgb = cosFxRgb(id, hsl);
  const col = (aa) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${aa})`;
  const base = cell * 1.05;
  const r = base * (0.35 + 1.25 * p);
  const a = Math.max(0, 1 - p) * 0.92;
  if (a <= 0.01) return;

  ctx.save();
  ctx.globalAlpha = a;
  ctx.strokeStyle = col(0.95);
  ctx.fillStyle = col(0.95);
  ctx.lineWidth = Math.max(1, cell * 0.10);

  if (id === 0) {
    // Кольца.
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = a * 0.55;
    ctx.lineWidth = Math.max(1, cell * 0.06);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
    ctx.stroke();
  } else if (id === 1) {
    // Лучи.
    ctx.lineWidth = Math.max(2, cell * 0.08);
    for (let k = 0; k < 12; k++) {
      const ang = p * 2.4 + (k * Math.PI * 2) / 12;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r * 0.35, cy + Math.sin(ang) * r * 0.35);
      ctx.lineTo(cx + Math.cos(ang) * r * 1.10, cy + Math.sin(ang) * r * 1.10);
      ctx.stroke();
    }
  } else if (id === 2) {
    // Кристалл: вложенные ромбы.
    ctx.lineWidth = Math.max(2, cell * 0.08);
    const rr = r * (0.85 + 0.10 * Math.sin(p * Math.PI * 2));
    for (let k = 0; k < 2; k++) {
      const q = rr * (k === 0 ? 1 : 0.55);
      ctx.beginPath();
      ctx.moveTo(cx, cy - q);
      ctx.lineTo(cx + q * 0.72, cy);
      ctx.lineTo(cx, cy + q);
      ctx.lineTo(cx - q * 0.72, cy);
      ctx.closePath();
      ctx.stroke();
    }
  } else if (id === 3) {
    // Спираль: одна непрерывная линия (именно так, как в игре).
    ctx.lineWidth = Math.max(2, cell * 0.08);
    const rot = p * 8.0;
    ctx.beginPath();
    for (let s = 0; s <= 1.001; s += 0.045) {
      const ang = rot + s * Math.PI * 6.2;
      const rr = r * (0.12 + 0.90 * s);
      const x = cx + Math.cos(ang) * rr;
      const y = cy + Math.sin(ang) * rr;
      if (s === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  } else if (id === 4) {
    // Конфетти.
    const extra = ['rgba(255,255,255,0.92)', col(0.92), 'rgba(255,215,0,0.92)', 'rgba(120,255,200,0.92)'];
    ctx.globalAlpha = a * (0.75 + 0.25 * (1 - p));
    for (let k = 0; k < 26; k++) {
      const seed = ((k + 1) * 2654435761) >>> 0;
      const u = (seed & 1023) / 1023;
      const v = ((seed >>> 10) & 1023) / 1023;
      const ang = u * Math.PI * 2 + p * 1.2;
      const sp = 0.25 + 0.95 * v;
      const rr = r * (0.05 + p * 1.45 * sp);
      const x = cx + Math.cos(ang) * rr;
      const y = cy + Math.sin(ang) * rr;
      const sz = Math.max(2, (cell * (0.10 + 0.14 * (((seed >>> 20) & 3) / 3))) | 0);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((p * 10.0 + u * 6.0) % (Math.PI * 2));
      ctx.fillStyle = extra[seed % extra.length];
      if ((seed & 1) === 0) {
        ctx.beginPath();
        ctx.moveTo(0, -sz);
        ctx.lineTo(sz, 0);
        ctx.lineTo(0, sz);
        ctx.lineTo(-sz, 0);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillRect(-sz / 2, -sz / 2, sz, sz);
      }
      ctx.restore();
    }
  } else if (id === 5) {
    // Магма: рваная корона, расходящаяся вспышкой.
    ctx.lineWidth = Math.max(2, cell * 0.12);
    ctx.beginPath();
    const n = 14;
    for (let k = 0; k <= n; k++) {
      const ang = (k * Math.PI * 2) / n;
      const jag = k % 2 === 0 ? 1 : 0.62;
      const rr = r * jag * (0.9 + 0.12 * Math.sin(p * 6 + k));
      const x = cx + Math.cos(ang) * rr;
      const y = cy + Math.sin(ang) * rr;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.globalAlpha = a * 0.28;
    ctx.fill();
  } else if (id === 6) {
    // Вихрь: три закрученные дуги с хвостами.
    ctx.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      const a0 = p * 9.0 + (k * Math.PI * 2) / 3;
      ctx.globalAlpha = a * (1 - k * 0.22);
      ctx.lineWidth = Math.max(1.5, cell * (0.12 - k * 0.025));
      ctx.beginPath();
      ctx.arc(cx, cy, r * (0.55 + 0.22 * k), a0, a0 + Math.PI * 0.85);
      ctx.stroke();
    }
  } else {
    // 7 — Осколки: треугольные обломки, разлетающиеся и вращающиеся.
    for (let k = 0; k < 9; k++) {
      const ang = (k * Math.PI * 2) / 9 + p * 0.8;
      const rr = r * (0.25 + 0.95 * p);
      const x = cx + Math.cos(ang) * rr;
      const y = cy + Math.sin(ang) * rr;
      const sz = Math.max(2.5, cell * 0.30 * (1 - p * 0.55));
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang + p * 5.0);
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.moveTo(sz, 0);
      ctx.lineTo(-sz * 0.6, -sz * 0.75);
      ctx.lineTo(-sz * 0.6, sz * 0.75);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
}

/* --- TERR: заливка территории ----------------------------------------------
   Самая большая вещь на экране (до 40% площади) — и до этой волны она вообще
   не продавалась. Заливка зовётся для КАЖДОЙ видимой клетки КАЖДЫЙ кадр
   (до 40×28 = 1120 вызовов), поэтому здесь нет ни одного createPattern или
   createLinearGradient внутри цикла: узор один раз рисуется в оффскрин-канвас
   64×64, из него один раз за кадр делается CanvasPattern, а на клетку остаётся
   ровно один fillRect.

   Цвет — всегда цвет игрока. Варианты различаются структурой узора. */

const COS_TERR_TILE = 64;

// Ключ — `hsl|id`; хранит оффскрин-канвасы 64×64, независимые от контекста.
const cosTerrTileCache = new Map();

// Пер-контекстный кэш CanvasPattern: паттерн привязан к своему ctx.
const cosTerrPatternCache = new WeakMap();

// Какие варианты вообще узорные. 0 (Заливка), 3 (Прилив) и 5 (Витраж)
// рисуются плоско — их отличие в модуляции альфы и в швах по границе.
export function cosTerrIsPattern(id) {
  const i = cosClampId(id);
  return i === 1 || i === 2 || i === 4 || i === 6 || i === 7;
}

// Вариант 6 «Разлом» рисуется аддитивно.
export function cosTerrIsAdditive(id) {
  return cosClampId(id) === 6;
}

function cosTerrTile(hsl, terrId) {
  const id = cosClampId(terrId);
  const key = `${hsl}|${id}`;
  const hit = cosTerrTileCache.get(key);
  if (hit) return hit;

  const S = COS_TERR_TILE;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const c = cv.getContext('2d');
  const rgb = hslToRgb(hsl);
  const r = rgb[0];
  const g = rgb[1];
  const b = rgb[2];
  const col = (a) => `rgba(${r},${g},${b},${a})`;

  if (id === 1) {
    // Штриховка: диагональные тёмные полосы поверх заливки.
    c.fillStyle = col(1);
    c.fillRect(0, 0, S, S);
    c.strokeStyle = 'rgba(0,0,0,0.55)';
    c.lineWidth = 7;
    for (let k = -S; k <= S * 2; k += 16) {
      c.beginPath();
      c.moveTo(k, -2);
      c.lineTo(k + S + 2, S + 2);
      c.stroke();
    }
    c.strokeStyle = 'rgba(255,255,255,0.16)';
    c.lineWidth = 2;
    for (let k = -S; k <= S * 2; k += 16) {
      c.beginPath();
      c.moveTo(k + 5, -2);
      c.lineTo(k + S + 7, S + 2);
      c.stroke();
    }
  } else if (id === 2) {
    // Соты: шестиугольная решётка со светлыми швами. Гексы слегка сплюснуты,
    // чтобы период узора был ровно 32×64 и плитка стыковалась без шва.
    c.fillStyle = col(0.55);
    c.fillRect(0, 0, S, S);
    const hw = 32;
    const hh = 42.67;
    c.lineWidth = 3;
    c.strokeStyle = col(1);
    c.lineJoin = 'round';
    for (let j = -1; j <= 3; j++) {
      const cy = j * 32;
      const off = (((j % 2) + 2) % 2) * (hw / 2);
      for (let i = -1; i <= 3; i++) {
        const cx = i * hw + off;
        c.beginPath();
        c.moveTo(cx, cy - hh / 2);
        c.lineTo(cx + hw / 2, cy - hh / 4);
        c.lineTo(cx + hw / 2, cy + hh / 4);
        c.lineTo(cx, cy + hh / 2);
        c.lineTo(cx - hw / 2, cy + hh / 4);
        c.lineTo(cx - hw / 2, cy - hh / 4);
        c.closePath();
        c.stroke();
      }
    }
  } else if (id === 4) {
    // Схема: тёмная подложка и яркие дорожки с контактными площадками.
    c.fillStyle = col(0.34);
    c.fillRect(0, 0, S, S);
    c.strokeStyle = col(1);
    c.lineWidth = 5;
    c.beginPath();
    c.moveTo(0, 32);
    c.lineTo(S, 32);
    c.moveTo(32, 0);
    c.lineTo(32, S);
    c.stroke();
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(0, 8);
    c.lineTo(16, 8);
    c.lineTo(16, 32);
    c.moveTo(S, 56);
    c.lineTo(48, 56);
    c.lineTo(48, 32);
    c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.fillRect(28, 28, 8, 8);
    c.fillRect(12, 4, 8, 8);
    c.fillRect(44, 52, 8, 8);
  } else if (id === 6) {
    // Разлом: тёмная порода с раскалёнными трещинами. Рисуется аддитивно,
    // поэтому базу держим тёмной — иначе территория выжжется в белый.
    c.fillStyle = `rgba(${(r * 0.30) | 0},${(g * 0.30) | 0},${(b * 0.30) | 0},1)`;
    c.fillRect(0, 0, S, S);
    c.lineCap = 'round';
    const cracks = [
      [0, 12, 20, 26, 40, 18, S, 30],
      [14, S, 26, 44, 44, 50, 58, 0],
      [S, 58, 40, 60, 24, S]
    ];
    for (const path of cracks) {
      c.beginPath();
      c.moveTo(path[0], path[1]);
      for (let k = 2; k < path.length; k += 2) c.lineTo(path[k], path[k + 1]);
      c.strokeStyle = col(0.85);
      c.lineWidth = 5;
      c.stroke();
      c.strokeStyle = 'rgba(255,255,255,0.75)';
      c.lineWidth = 1.6;
      c.stroke();
    }
  } else if (id === 7) {
    // Ткань: переплетение полос — единственный вариант с ощущением объёма.
    c.fillStyle = col(0.85);
    c.fillRect(0, 0, S, S);
    const pitch = 16;
    for (let y = 0; y < S; y += pitch) {
      for (let x = 0; x < S; x += pitch) {
        const over = ((x / pitch) + (y / pitch)) % 2 === 0;
        c.fillStyle = over ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.34)';
        if (over) c.fillRect(x, y + 2, pitch, pitch - 4);
        else c.fillRect(x + 2, y, pitch - 4, pitch);
      }
    }
    c.strokeStyle = 'rgba(0,0,0,0.28)';
    c.lineWidth = 1;
    for (let k = 0; k <= S; k += pitch) {
      c.beginPath();
      c.moveTo(k + 0.5, 0);
      c.lineTo(k + 0.5, S);
      c.moveTo(0, k + 0.5);
      c.lineTo(S, k + 0.5);
      c.stroke();
    }
  } else {
    // 0/3/5 — плоская база (в игре они плоские и различаются иначе).
    c.fillStyle = col(1);
    c.fillRect(0, 0, S, S);
  }

  if (cosTerrTileCache.size > 96) cosTerrTileCache.clear();
  cosTerrTileCache.set(key, cv);
  return cv;
}

/* Возвращает fillStyle для территории. Зовётся ОДИН раз на владельца за кадр,
   не на клетку. originX/originY — экранные координаты клетки (0,0) поля,
   cell — сторона клетки: по ним паттерн выравнивается по сетке, поэтому в
   каждой клетке узор выглядит одинаково. */
export function cosTerrFillStyle(ctx, hsl, terrId, originX, originY, cell) {
  const id = cosClampId(terrId);
  if (!cosTerrIsPattern(id)) return null;
  let m = cosTerrPatternCache.get(ctx);
  if (!m) {
    m = new Map();
    cosTerrPatternCache.set(ctx, m);
  }
  const key = `${hsl}|${id}`;
  let pat = m.get(key);
  if (!pat) {
    pat = ctx.createPattern(cosTerrTile(hsl, id), 'repeat');
    if (!pat) return null;
    if (m.size > 48) m.clear();
    m.set(key, pat);
  }
  const k = cell / COS_TERR_TILE;
  try {
    pat.setTransform(new DOMMatrix([k, 0, 0, k, originX, originY]));
  } catch {}
  return pat;
}

/* Модуляция альфы для вариантов без узора. gx,gy — координаты клетки. */
export function cosTerrAlphaMod(terrId, gx, gy, timeMs) {
  const id = cosClampId(terrId);
  if (id === 3) {
    // Прилив: медленная волна яркости через всю территорию.
    return 0.22 * (0.5 + 0.5 * Math.sin((gx * 0.85 + gy * 1.15) * 0.55 - timeMs * 0.0022));
  }
  if (id === 4) {
    // Схема: импульс, бегущий по диагонали от захвата к краю зоны.
    const w = Math.sin(timeMs * 0.006 - (gx + gy) * 0.6);
    return 0.16 * Math.max(0, w) * Math.max(0, w);
  }
  return 0;
}

/* Одна клетка территории — используется превью магазина и любым кодом,
   которому не нужен горячий путь. В игре тот же узор приходит через
   cosTerrFillStyle, поэтому расхождение невозможно. */
export function drawTerrTile(ctx, px, py, cell, hsl, terrId, gx, gy, alpha, timeMs) {
  const id = cosClampId(terrId);
  const a = Math.max(0, Math.min(1, Number(alpha) + cosTerrAlphaMod(id, gx, gy, Number(timeMs) || 0)));
  if (!(a > 0.02)) return;
  ctx.save();
  ctx.globalAlpha = a;
  if (cosTerrIsAdditive(id)) ctx.globalCompositeOperation = 'lighter';
  const pat = cosTerrFillStyle(ctx, hsl, id, px - gx * cell, py - gy * cell, cell);
  if (pat) {
    ctx.fillStyle = pat;
  } else {
    const rgb = hslToRgb(hsl);
    ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  }
  ctx.fillRect(px, py, cell, cell);
  ctx.restore();
}

/* Витраж: светящийся шов по внешней границе владения. Зовётся только для
   пограничных клеток, поэтому дешёв. `edges` — битовая маска: 1 верх,
   2 право, 4 низ, 8 лево. */
export function drawTerrSeam(ctx, px, py, cell, hsl, edges, alpha, glow) {
  if (!edges) return;
  const rgb = hslToRgb(hsl);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.strokeStyle = `rgba(255,255,255,0.85)`;
  // shadowBlur зовётся только в магазине: в игре шов рисуется до сотни раз за
  // кадр по периметру владения, а тень — самая дорогая операция канваса.
  if (glow) {
    ctx.shadowColor = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    ctx.shadowBlur = Math.max(4, cell * 0.55);
  }
  ctx.lineWidth = Math.max(1.5, cell * 0.16);
  ctx.beginPath();
  if (edges & 1) {
    ctx.moveTo(px, py + 0.5);
    ctx.lineTo(px + cell, py + 0.5);
  }
  if (edges & 2) {
    ctx.moveTo(px + cell - 0.5, py);
    ctx.lineTo(px + cell - 0.5, py + cell);
  }
  if (edges & 4) {
    ctx.moveTo(px, py + cell - 0.5);
    ctx.lineTo(px + cell, py + cell - 0.5);
  }
  if (edges & 8) {
    ctx.moveTo(px + 0.5, py);
    ctx.lineTo(px + 0.5, py + cell);
  }
  ctx.stroke();
  ctx.restore();
}

/* --- DEATH: эффект гибели --------------------------------------------------
   Смерть видят все, а обратной связи до этой волны не было вовсе. Длительность
   бурста — параметр (COS_DEATH_MS), progress 0..1. Цвет — цвет погибшего. */

export const COS_DEATH_MS = 900;

export function drawDeathFx(ctx, cx, cy, cell, hsl, deathId, progress) {
  const id = cosClampId(deathId);
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  const rgb = hslToRgb(hsl);
  const col = (a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
  const fade = Math.max(0, 1 - p);
  if (fade <= 0.01) return;
  const R = cell * 1.6;

  ctx.save();
  ctx.globalAlpha = fade;

  if (id === 1) {
    // Осыпание в пиксели: сетка квадратов разлетается и падает вниз.
    const n = 5;
    const sz = Math.max(1.5, cell * 0.22);
    for (let iy = 0; iy < n; iy++) {
      for (let ix = 0; ix < n; ix++) {
        const seed = ((ix * 73856093) ^ (iy * 19349663)) >>> 0;
        const jx = ((seed & 255) / 255 - 0.5) * 2;
        const ox = (ix - (n - 1) / 2) * cell * 0.30;
        const oy = (iy - (n - 1) / 2) * cell * 0.30;
        const x = cx + ox + jx * R * 0.55 * p;
        const y = cy + oy + (R * 0.9 * p * p) - R * 0.15 * p;
        ctx.fillStyle = col(0.95);
        ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
      }
    }
  } else if (id === 2) {
    // Чёрная дыра: кольца стягиваются внутрь, в центре растёт пустота.
    for (let k = 0; k < 3; k++) {
      const q = Math.max(0, Math.min(1, p * 1.2 - k * 0.14));
      const rr = R * (1.15 - q) * (1 - k * 0.16);
      if (rr <= 0.5) continue;
      ctx.strokeStyle = col(0.9 - k * 0.22);
      ctx.lineWidth = Math.max(1, cell * (0.14 - k * 0.03));
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = fade * 0.95;
    ctx.fillStyle = 'rgba(2,3,6,1)';
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.42 * Math.min(1, p * 2.2), 0, Math.PI * 2);
    ctx.fill();
  } else if (id === 3) {
    // Стеклянный разлёт: треугольные осколки, каждый со своей осью вращения.
    for (let k = 0; k < 10; k++) {
      const seed = ((k + 3) * 2654435761) >>> 0;
      const ang = ((seed & 1023) / 1023) * Math.PI * 2;
      const sp = 0.45 + ((seed >>> 10) & 511) / 511;
      const rr = R * p * sp;
      const sz = Math.max(2, cell * 0.34 * (1 - p * 0.5));
      ctx.save();
      ctx.translate(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr);
      ctx.rotate(ang + p * 4.5 * (seed & 1 ? 1 : -1));
      ctx.fillStyle = col(0.55);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(sz, 0);
      ctx.lineTo(-sz * 0.55, -sz * 0.8);
      ctx.lineTo(-sz * 0.3, sz * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  } else if (id === 4) {
    // Сверхновая: белое ядро, ударная волна и лучи.
    const rr = R * (0.15 + 1.5 * p);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = Math.max(1.5, cell * 0.22 * (1 - p));
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = col(0.9);
    ctx.lineWidth = Math.max(1.5, cell * 0.14);
    for (let k = 0; k < 8; k++) {
      const ang = (k * Math.PI * 2) / 8 + p * 0.5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * rr * 0.35, cy + Math.sin(ang) * rr * 0.35);
      ctx.lineTo(cx + Math.cos(ang) * rr * 1.25, cy + Math.sin(ang) * rr * 1.25);
      ctx.stroke();
    }
    ctx.globalAlpha = fade * Math.max(0, 1 - p * 2);
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.55 * (1 - p), 0, Math.PI * 2);
    ctx.fill();
  } else if (id === 5) {
    // Глитч-развал: горизонтальные полосы уезжают в стороны.
    const bars = 7;
    const bh = (cell * 1.5) / bars;
    for (let k = 0; k < bars; k++) {
      const seed = ((k * 2246822519) ^ 0x9e3779b9) >>> 0;
      const dir = seed & 1 ? 1 : -1;
      const amt = ((seed >>> 4) & 255) / 255;
      const x = cx + dir * R * amt * p * 1.1;
      const y = cy - cell * 0.75 + k * bh;
      ctx.fillStyle = k % 3 === 0 ? 'rgba(255,255,255,0.85)' : col(0.9);
      ctx.fillRect(x - cell * 0.55, y, cell * 1.1, Math.max(1, bh - 1));
    }
  } else if (id === 6) {
    // Пепел: искры медленно всплывают и гаснут.
    for (let k = 0; k < 14; k++) {
      const seed = ((k + 7) * 40503) >>> 0;
      const u = (seed & 1023) / 1023;
      const v = ((seed >>> 10) & 1023) / 1023;
      const x = cx + (u - 0.5) * R * (0.6 + p * 0.9);
      const y = cy - R * p * (0.4 + v * 0.9);
      const sz = Math.max(1, cell * 0.11 * (1 - p * 0.6));
      ctx.globalAlpha = fade * (0.35 + 0.65 * v);
      ctx.fillStyle = k % 4 === 0 ? 'rgba(255,235,190,0.95)' : col(0.9);
      ctx.beginPath();
      ctx.arc(x, y, sz, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (id === 7) {
    // Разряд: ломаные молнии во все стороны.
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let k = 0; k < 6; k++) {
      const base = (k * Math.PI * 2) / 6 + p * 0.4;
      ctx.strokeStyle = k % 2 ? 'rgba(255,255,255,0.9)' : col(0.95);
      ctx.lineWidth = Math.max(1.2, cell * 0.11 * (1 - p * 0.5));
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      let ang = base;
      let rr = 0;
      for (let s = 0; s < 4; s++) {
        rr += (R * 1.2 * p) / 4;
        ang += ((((k * 7 + s * 13) % 11) / 11) - 0.5) * 1.1;
        ctx.lineTo(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr);
      }
      ctx.stroke();
    }
  } else {
    // 0 — Вспышка: базовый бесплатный вариант.
    const rr = R * (0.2 + 1.1 * p);
    ctx.strokeStyle = col(0.95);
    ctx.lineWidth = Math.max(1.5, cell * 0.18 * (1 - p * 0.6));
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = fade * Math.max(0, 1 - p * 1.6);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.4 * (1 - p), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/* --- FRAME: рамка профиля --------------------------------------------------
   Единственная чисто CSS-категория: классы .frame0..frame7 навешиваются на
   строки таблицы лидеров и итогов матча. В канвасе рисуется только имитация
   этой строки — та же логика цвета берётся из одной таблицы. */
const COS_FRAME_STYLE = [
  { edge: '#6b7280', wash: 'rgba(107,114,128,0.16)', name: 'rgba(229,231,235,0.92)' },
  { edge: '#b87333', wash: 'rgba(184,115,51,0.20)', name: 'rgba(255,224,196,0.95)' },
  { edge: '#c9d1d9', wash: 'rgba(201,209,217,0.18)', name: 'rgba(255,255,255,0.96)' },
  { edge: '#34d399', wash: 'rgba(52,211,153,0.20)', name: 'rgba(209,250,229,0.96)' },
  { edge: '#4c1d95', wash: 'rgba(76,29,149,0.42)', name: 'rgba(237,233,254,0.96)' },
  { edge: '#e5e7eb', wash: 'rgba(229,231,235,0.14)', name: 'rgba(255,255,255,0.96)' },
  { edge: '#d4a017', wash: 'rgba(212,160,23,0.22)', name: 'rgba(255,243,205,0.96)' },
  { edge: '#1f2937', wash: 'rgba(31,41,55,0.55)', name: 'rgba(203,213,225,0.96)' }
];

function cosFrameStyle(frId) {
  return COS_FRAME_STYLE[cosClampId(frId)] || COS_FRAME_STYLE[0];
}

// Строка таблицы лидеров с рамкой — ровно то место, где рамка видна в игре.
export function drawFrameRow(ctx, x, y, w, h, frId, rank, name, score, highlight) {
  const st = cosFrameStyle(frId);
  const fs = Math.max(10, Math.round(h * 0.46));
  ctx.save();
  ctx.fillStyle = highlight ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.025)';
  ctx.fillRect(x, y, w, h);
  if (highlight) {
    const g = ctx.createLinearGradient(x, y, x + w * 0.7, y);
    g.addColorStop(0, st.wash);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = st.edge;
    ctx.fillRect(x, y, 3, h);
    const fr = cosClampId(frId);
    if (fr === 2 || fr === 5) {
      ctx.fillStyle = 'rgba(255,255,255,0.20)';
      ctx.fillRect(x, y, w, 1);
    }
    if (fr === 7) {
      ctx.strokeStyle = 'rgba(148,163,184,0.35)';
      ctx.lineWidth = 1;
      for (let k = -h; k < w; k += 6) {
        ctx.beginPath();
        ctx.moveTo(x + k, y + h);
        ctx.lineTo(x + k + h, y);
        ctx.stroke();
      }
    }
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(x, y, 3, h);
  }
  ctx.font = `${fs}px ${COS_FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = highlight ? st.name : 'rgba(229,231,235,0.62)';
  ctx.fillText(String(rank), x + 12, y + h / 2);
  if (highlight && (cosClampId(frId) === 3 || cosClampId(frId) === 6)) {
    ctx.save();
    ctx.shadowColor = st.edge;
    ctx.shadowBlur = 8;
    ctx.fillText(String(name), x + 34, y + h / 2);
    ctx.restore();
  } else {
    ctx.fillText(String(name), x + 34, y + h / 2);
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = highlight ? 'rgba(255,255,255,0.88)' : 'rgba(229,231,235,0.55)';
  ctx.fillText(String(score), x + w - 12, y + h / 2);
  ctx.restore();
}

/* --- Мини-иконка карточки магазина ----------------------------------------
   Использует ровно те же функции, что и игра. Backing store умножается на
   devicePixelRatio, иначе иконка мылится на retina и на мобильном. */
export function cosPrepCanvas(canvasEl, cssW, cssH) {
  const dpr = Math.max(1, Math.min(3, Number(window.devicePixelRatio) || 1));
  const bw = Math.max(1, Math.round(cssW * dpr));
  const bh = Math.max(1, Math.round(cssH * dpr));
  // Размер на экране задаёт CSS; здесь только backing store под devicePixelRatio.
  if (canvasEl.width !== bw) canvasEl.width = bw;
  if (canvasEl.height !== bh) canvasEl.height = bh;
  const c = canvasEl.getContext('2d');
  if (!c) return null;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, cssW, cssH);
  return c;
}
