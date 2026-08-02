/*
 * Мок canvas 2D-контекста для тестов отрисовки косметики.
 *
 * Зачем не настоящий растр. Функции public/client_cos_draw.js — это
 * последовательности вызовов канваса; ровно её и надо проверять. Сравнение
 * пикселей потребовало бы @napi-rs/canvas (внешняя зависимость, запрещена),
 * было бы медленнее и ломалось бы от смены версии растеризатора при
 * неизменившемся рисунке. Трасса вызовов — детерминированный и точный
 * отпечаток: любая правка геометрии её меняет, а любое «одинаково рисуем два
 * разных предмета» видно как совпадение трасс.
 *
 * Мок сам считает аффинное преобразование (save/restore/translate/rotate/
 * setTransform), поэтому каждая точка записывается ещё и в «экранных»
 * координатах — без этого проверить границы рисунка после ctx.translate()
 * было бы нечем.
 *
 * Зависимостей нет: только встроенный JS.
 */

// --- аффинная матрица [a b c d e f] (как в CanvasRenderingContext2D) --------

function matMul(m, n) {
  // Результат: применить n, затем m (canvas-семантика ctx.transform).
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5]
  ];
}

function matApply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

// Числа в трассе округляем: иначе 1e-16 от rotate() делает трассу зависимой от
// порядка операций с плавающей точкой, а не от рисунка.
function num(v) {
  if (typeof v !== 'number') return v;
  if (!Number.isFinite(v)) return String(v);
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
}

function fmtArg(v) {
  if (v && typeof v === 'object') {
    if (v.__kind) return v.__kind;
    return 'obj';
  }
  if (typeof v === 'number') return String(num(v));
  return String(v);
}

/* Отпечаток содержимого оффскрин-плитки. Без него все плитки 64×64 выглядели
   бы в трассе одинаково («canvas(64x64)»), и тест «все 8 вариантов территории
   различимы» позеленел бы на любом узоре — включая полностью одинаковый. */
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function canvasTag(img) {
  if (!img || img.__kind !== 'canvas') return 'img';
  const inner = img.__ctx ? fnv1a(img.__ctx.__trace.join('\n')) : 'empty';
  return `canvas(${img.width}x${img.height}#${inner})`;
}

// Свойства контекста, за присваиванием которых следим (влияют на картинку).
const TRACKED_PROPS = [
  'fillStyle',
  'strokeStyle',
  'lineWidth',
  'lineCap',
  'lineJoin',
  'globalAlpha',
  'globalCompositeOperation',
  'shadowColor',
  'shadowBlur',
  'font',
  'textAlign',
  'textBaseline'
];

export function createMockCtx(opts = {}) {
  const trace = [];
  // Все точки в экранных координатах: [x, y, opName].
  const points = [];
  // Ширина текста фиксирована и линейна по длине — иначе тесты плашки ника
  // зависели бы от шрифтовых метрик, которых в Node нет.
  const charW = opts.charW == null ? 7 : opts.charW;

  let mat = [1, 0, 0, 1, 0, 0];
  const matStack = [];
  const propStack = [];

  const state = {
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    shadowColor: 'rgba(0,0,0,0)',
    shadowBlur: 0,
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic'
  };

  const log = (op, ...args) => {
    trace.push(args.length ? `${op}(${args.map(fmtArg).join(',')})` : `${op}()`);
  };

  const pt = (op, x, y) => {
    const [sx, sy] = matApply(mat, x, y);
    points.push([sx, sy, op]);
  };

  // Прямоугольник даёт четыре угла — иначе проверка границ пропустила бы
  // fillRect с отрицательной шириной.
  const rectPts = (op, x, y, w, h) => {
    pt(op, x, y);
    pt(op, x + w, y);
    pt(op, x, y + h);
    pt(op, x + w, y + h);
  };

  const ctx = {
    __kind: 'ctx',

    // --- пути ---
    beginPath() {
      log('beginPath');
    },
    closePath() {
      log('closePath');
    },
    moveTo(x, y) {
      log('moveTo', x, y);
      pt('moveTo', x, y);
    },
    lineTo(x, y) {
      log('lineTo', x, y);
      pt('lineTo', x, y);
    },
    arc(x, y, r, a0, a1, ccw) {
      log('arc', x, y, r, a0, a1, ccw === undefined ? false : ccw);
      // Габарит дуги — окружность радиуса r: для проверки границ этого достаточно
      // и это консервативнее, чем сама дуга.
      rectPts('arc', x - Math.abs(r), y - Math.abs(r), Math.abs(r) * 2, Math.abs(r) * 2);
    },
    arcTo(x1, y1, x2, y2, r) {
      log('arcTo', x1, y1, x2, y2, r);
      pt('arcTo', x1, y1);
      pt('arcTo', x2, y2);
    },
    rect(x, y, w, h) {
      log('rect', x, y, w, h);
      rectPts('rect', x, y, w, h);
    },
    fill(rule) {
      log('fill', rule === undefined ? 'nonzero' : rule);
    },
    stroke() {
      log('stroke');
    },
    clip(rule) {
      log('clip', rule === undefined ? 'nonzero' : rule);
    },

    // --- примитивы ---
    fillRect(x, y, w, h) {
      log('fillRect', x, y, w, h);
      rectPts('fillRect', x, y, w, h);
    },
    strokeRect(x, y, w, h) {
      log('strokeRect', x, y, w, h);
      rectPts('strokeRect', x, y, w, h);
    },
    clearRect(x, y, w, h) {
      log('clearRect', x, y, w, h);
    },
    fillText(s, x, y) {
      log('fillText', String(s), x, y);
      pt('fillText', x, y);
    },
    strokeText(s, x, y) {
      log('strokeText', String(s), x, y);
      pt('strokeText', x, y);
    },
    drawImage(img, x, y) {
      const tag = canvasTag(img);
      log('drawImage', tag, x, y);
      pt('drawImage', x, y);
      if (img && img.__kind === 'canvas') pt('drawImage', x + img.width, y + img.height);
    },

    // --- состояние и трансформ ---
    save() {
      log('save');
      matStack.push(mat.slice());
      propStack.push({ ...state });
    },
    restore() {
      log('restore');
      const m = matStack.pop();
      if (m) mat = m;
      const p = propStack.pop();
      if (p) Object.assign(state, p);
    },
    translate(x, y) {
      log('translate', x, y);
      mat = matMul(mat, [1, 0, 0, 1, x, y]);
    },
    rotate(a) {
      log('rotate', a);
      const c = Math.cos(a);
      const s = Math.sin(a);
      mat = matMul(mat, [c, s, -s, c, 0, 0]);
    },
    scale(x, y) {
      log('scale', x, y);
      mat = matMul(mat, [x, 0, 0, y, 0, 0]);
    },
    setTransform(a, b, c, d, e, f) {
      log('setTransform', a, b, c, d, e, f);
      mat = [a, b, c, d, e, f];
    },
    setLineDash(arr) {
      log('setLineDash', Array.isArray(arr) ? arr.map(num).join('|') : String(arr));
    },
    getLineDash() {
      return [];
    },

    // --- фабрики стилей ---
    createLinearGradient(x0, y0, x1, y1) {
      log('createLinearGradient', x0, y0, x1, y1);
      const stops = [];
      return {
        __kind: `grad[${num(x0)},${num(y0)},${num(x1)},${num(y1)}]`,
        stops,
        addColorStop(o, c) {
          stops.push(`${num(o)}:${c}`);
          this.__kind = `grad[${num(x0)},${num(y0)},${num(x1)},${num(y1)}|${stops.join(';')}]`;
        }
      };
    },
    createRadialGradient(x0, y0, r0, x1, y1, r1) {
      log('createRadialGradient', x0, y0, r0, x1, y1, r1);
      const stops = [];
      return {
        __kind: 'rgrad',
        stops,
        addColorStop(o, c) {
          stops.push(`${num(o)}:${c}`);
          this.__kind = `rgrad[${stops.join(';')}]`;
        }
      };
    },
    createPattern(img, rep) {
      const tag = canvasTag(img);
      log('createPattern', tag, rep);
      return {
        __kind: `pattern(${tag},${rep})`,
        transforms: [],
        setTransform(m) {
          this.transforms.push(m);
        }
      };
    },
    measureText(s) {
      const w = String(s).length * charW;
      log('measureText', String(s));
      return { width: w };
    },

    // --- отладочные хвосты для тестов ---
    __trace: trace,
    __points: points,
    __matrix: () => mat.slice(),
    __reset() {
      trace.length = 0;
      points.length = 0;
      mat = [1, 0, 0, 1, 0, 0];
      matStack.length = 0;
      propStack.length = 0;
    }
  };

  for (const p of TRACKED_PROPS) {
    Object.defineProperty(ctx, p, {
      get: () => state[p],
      set: (v) => {
        state[p] = v;
        trace.push(`set ${p}=${fmtArg(v)}`);
      },
      enumerable: true,
      configurable: true
    });
  }

  return ctx;
}

export function createMockCanvas(opts = {}) {
  const el = {
    __kind: 'canvas',
    width: 300,
    height: 150,
    style: {},
    getContext(kind) {
      if (kind !== '2d') return null;
      if (!el.__ctx) el.__ctx = createMockCtx(opts);
      return el.__ctx;
    },
    getBoundingClientRect() {
      return { x: 0, y: 0, width: el.width, height: el.height, top: 0, left: 0 };
    }
  };
  return el;
}

/* Ставит минимальные глобалы, нужные client_cos_draw.js: document.createElement
   ('canvas') для оффскрин-плиток и window.devicePixelRatio для cosPrepCanvas.
   Возвращает функцию отката, чтобы тесты не протекали друг в друга. */
export function installDomStubs(opts = {}) {
  const created = [];
  const prevDocument = globalThis.document;
  const prevWindow = globalThis.window;
  const hadDocument = 'document' in globalThis;
  const hadWindow = 'window' in globalThis;

  globalThis.document = {
    createElement(tag) {
      if (String(tag).toLowerCase() !== 'canvas') return { __kind: 'el', tagName: String(tag).toUpperCase(), style: {} };
      const c = createMockCanvas(opts);
      created.push(c);
      return c;
    }
  };
  globalThis.window = { devicePixelRatio: opts.dpr == null ? 1 : opts.dpr };

  return {
    created,
    restore() {
      if (hadDocument) globalThis.document = prevDocument;
      else delete globalThis.document;
      if (hadWindow) globalThis.window = prevWindow;
      else delete globalThis.window;
    }
  };
}

/* Числовые аргументы всех вызовов трассы — для проверки «нет NaN/Infinity в
   координатах». Строки-стили пропускаем: NaN внутри `rgba(...)` ловится
   отдельной проверкой по подстроке. */
export function traceNumbers(trace) {
  const out = [];
  for (const line of trace) {
    const i = line.indexOf('(');
    if (i < 0) continue;
    const args = line.slice(i + 1, line.lastIndexOf(')')).split(',');
    for (const a of args) {
      const n = Number(a);
      if (a.trim() !== '' && !Number.isNaN(n)) out.push(n);
      else if (/^(NaN|Infinity|-Infinity)$/.test(a.trim())) out.push(a.trim() === 'NaN' ? NaN : Infinity);
    }
  }
  return out;
}

/* Есть ли в трассе «плохое» число — как аргумент или внутри строки стиля. */
export function traceHasBadNumber(trace) {
  for (const line of trace) {
    if (/\b(NaN|Infinity|-Infinity)\b/.test(line)) return line;
  }
  return null;
}

export function pointsBBox(points) {
  if (!points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}
