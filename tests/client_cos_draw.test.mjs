/*
 * public/client_cos_draw.js — исполняемые тесты отрисовки косметики.
 *
 * Проверяем не пиксели, а ТРАССУ вызовов канваса (см. tests/helpers/canvas_mock.mjs):
 * настоящий растр потребовал бы внешней зависимости, был бы медленнее и
 * ломался бы от версии растеризатора при неизменившемся рисунке.
 *
 * Что здесь реально ловится:
 *   1) два разных предмета одной категории рисуются одинаково — в магазине их
 *      не отличить, это была живая претензия к проекту;
 *   2) вариант падает или уезжает за свой прямоугольник;
 *   3) id вне 0..7 роняет отрисовку вместо клампа;
 *   4) NaN в координатах при вырожденной клетке (cell = 0, 0.5, отрицательный);
 *   5) кэши плиток растут без ограничения — на длинной сессии это утечка.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMockCtx,
  installDomStubs,
  traceHasBadNumber,
  pointsBBox
} from './helpers/canvas_mock.mjs';

// DOM-заглушки нужны ДО импорта модуля? Нет: document читается только внутри
// функций (оффскрин-плитки), поэтому обычного статического импорта достаточно.
const dom = installDomStubs();

const D = await import('../public/client_cos_draw.js');

const HSL = 'hsl(210 78% 52%)';
const HSL2 = 'hsl(17 61% 43%)';
const IDS = [0, 1, 2, 3, 4, 5, 6, 7];

const traceOf = (fn) => {
  const ctx = createMockCtx();
  fn(ctx);
  return ctx.__trace.join('\n');
};

const runOf = (fn) => {
  const ctx = createMockCtx();
  fn(ctx);
  return ctx;
};

/* Все категории и как их вызвать. Аргументы подобраны так, чтобы сработали
   «интересные» ветки: alpha заметно больше 0.02, progress в середине
   анимации, направление движения не нулевое. */
const CATEGORIES = {
  seg: (ctx, id) => D.drawSegTile(ctx, 100, 200, 16, HSL, id, 7, 0.9, 1234),
  head: (ctx, id) => D.drawHead(ctx, 100, 200, 16, HSL, id, 1, 0, 1234),
  nameplate: (ctx, id) => D.drawNamePlate(ctx, 'Игрок', 100, 200, HSL, id, 0.95, 12, 1234),
  capturefx: (ctx, id) => D.drawCaptureFx(ctx, 100, 200, 16, HSL, id, 0.4),
  terr: (ctx, id) => D.drawTerrTile(ctx, 100, 200, 16, HSL, id, 3, 4, 0.6, 1234),
  death: (ctx, id) => D.drawDeathFx(ctx, 100, 200, 16, HSL, id, 0.4),
  frame: (ctx, id) => D.drawFrameRow(ctx, 0, 0, 200, 24, id, 1, 'Игрок', 42, true)
};

// --- cosClampId -------------------------------------------------------------

test('cosClampId: зажимает в 0..7 и не пропускает мусор', () => {
  // Ловит: пропуск id наружу. Дальше он идёт индексом в таблицы стилей —
  // COS_FRAME_STYLE[99] дал бы undefined и падение на .edge.
  for (const id of IDS) assert.equal(D.cosClampId(id), id);
  assert.equal(D.cosClampId(-1), 0);
  assert.equal(D.cosClampId(-99), 0);
  assert.equal(D.cosClampId(8), 7);
  assert.equal(D.cosClampId(1e9), 7);
  assert.equal(D.cosClampId(3.9), 3, 'дробное усекается к нулю, а не округляется');
  assert.equal(D.cosClampId(-0.5), 0);
  assert.equal(D.cosClampId('5'), 5);
  for (const bad of [NaN, Infinity, -Infinity, null, undefined, 'abc', {}, []]) {
    const v = D.cosClampId(bad);
    assert.ok(Number.isInteger(v) && v >= 0 && v <= 7, `вход ${String(bad)} -> ${v}`);
  }
});

// --- различимость вариантов -------------------------------------------------

test('все 8 вариантов каждой категории рисуются по-разному', () => {
  /* Ключевой тест магазина. Если два варианта дают одинаковую трассу, игрок
     покупает предмет, который выглядит как уже имеющийся. Категория terr —
     единственное задокументированное исключение, см. отдельный тест ниже. */
  for (const [cat, draw] of Object.entries(CATEGORIES)) {
    if (cat === 'terr') continue;
    const byTrace = new Map();
    for (const id of IDS) {
      const t = traceOf((ctx) => draw(ctx, id));
      assert.notEqual(t, '', `${cat}[${id}] не нарисовал вообще ничего`);
      if (byTrace.has(t)) {
        assert.fail(`${cat}: варианты ${byTrace.get(t)} и ${id} рисуются одинаково`);
      }
      byTrace.set(t, id);
    }
    assert.equal(byTrace.size, 8, `${cat}: различимых вариантов ${byTrace.size} из 8`);
  }
});

test('territory: 8 вариантов дают 7 различных плиток — 0 и 5 различаются швом', () => {
  /* Задокументированное исключение. drawTerrTile для вариантов 0 («Заливка»)
     и 5 («Витраж») даёт одинаковую плоскую заливку: витраж отличается
     СВЕТЯЩИМСЯ ШВОМ по границе владения, который рисует drawTerrSeam.
     Тест фиксирует и это ограничение, и то, что остальные шесть различимы.
     Ловит: схлопывание ещё одной пары вариантов территории в одну. */
  const byTrace = new Map();
  for (const id of IDS) {
    const t = traceOf((ctx) => CATEGORIES.terr(ctx, id));
    if (!byTrace.has(t)) byTrace.set(t, []);
    byTrace.get(t).push(id);
  }
  const dupes = [...byTrace.values()].filter((g) => g.length > 1);
  assert.deepEqual(dupes, [[0, 5]], `неожиданные совпадения вариантов территории: ${JSON.stringify(dupes)}`);

  // А вот со швом «Витраж» обязан отличаться от «Заливки».
  const flat = traceOf((ctx) => D.drawTerrSeam(ctx, 100, 200, 16, HSL, 15, 0.8, false));
  const glow = traceOf((ctx) => D.drawTerrSeam(ctx, 100, 200, 16, HSL, 15, 0.8, true));
  assert.notEqual(flat, glow, 'glow-шов не отличается от обычного');
  assert.match(glow, /set shadowBlur=/, 'у витражного шва должно быть свечение');
  assert.equal(/set shadowBlur=(?!0)/.test(flat), false, 'в игре шов рисуется без тени');
});

test('различимость сохраняется при другом цвете и другом размере клетки', () => {
  // Ловит: вариант, который отличается только на конкретном сочетании
  // цвет+размер (например, из-за округления толщины линии до одинакового
  // значения на мелкой клетке).
  for (const cell of [8, 24, 48]) {
    const seen = new Map();
    for (const id of IDS) {
      const t = traceOf((ctx) => D.drawSegTile(ctx, 0, 0, cell, HSL2, id, 3, 0.85, 500));
      assert.ok(!seen.has(t), `seg: ${seen.get(t)} и ${id} совпали при cell=${cell}`);
      seen.set(t, id);
    }
    const heads = new Map();
    for (const id of IDS) {
      const t = traceOf((ctx) => D.drawHead(ctx, 0, 0, cell, HSL2, id, 0, 1, 500));
      assert.ok(!heads.has(t), `head: ${heads.get(t)} и ${id} совпали при cell=${cell}`);
      heads.set(t, id);
    }
  }
});

test('drawHead: силуэт разворачивается по направлению движения', () => {
  /* Ловит: потерю rotate(ang) у асимметричных голов (ромб, щит, стрела).
     Без разворота стрела всегда смотрит вправо — визуальный баг, который в
     статике превью магазина вообще не виден. */
  for (const id of [1, 4, 5]) {
    const right = traceOf((ctx) => D.drawHead(ctx, 0, 0, 16, HSL, id, 1, 0, 0));
    const down = traceOf((ctx) => D.drawHead(ctx, 0, 0, 16, HSL, id, 0, 1, 0));
    assert.notEqual(right, down, `head[${id}] не разворачивается по направлению`);
  }
  // Нулевое направление подменяется на «вправо», а не даёт NaN из atan2.
  const zero = traceOf((ctx) => D.drawHead(ctx, 0, 0, 16, HSL, 5, 0, 0, 0));
  const right = traceOf((ctx) => D.drawHead(ctx, 0, 0, 16, HSL, 5, 1, 0, 0));
  assert.equal(zero, right);
  const nan = traceOf((ctx) => D.drawHead(ctx, 0, 0, 16, HSL, 5, NaN, NaN, 0));
  assert.equal(nan, right);
});

test('анимированные варианты действительно зависят от времени и фазы', () => {
  /* Ловит: «замороженную» анимацию — потерянный аргумент timeMs/progress.
     Для игрока это выглядит как «предмет купил, а он не двигается». */
  // Плазма (seg 3), Искры (seg 4), Схема (seg 5) и Звезда (head 7) — по времени.
  for (const [label, a, b] of [
    ['seg[3] плазма', traceOf((c) => D.drawSegTile(c, 0, 0, 16, HSL, 3, 1, 1, 0)), traceOf((c) => D.drawSegTile(c, 0, 0, 16, HSL, 3, 1, 1, 800))],
    ['seg[4] искры', traceOf((c) => D.drawSegTile(c, 0, 0, 16, HSL, 4, 1, 1, 0)), traceOf((c) => D.drawSegTile(c, 0, 0, 16, HSL, 4, 1, 1, 800))],
    ['head[7] звезда', traceOf((c) => D.drawHead(c, 0, 0, 16, HSL, 7, 1, 0, 0)), traceOf((c) => D.drawHead(c, 0, 0, 16, HSL, 7, 1, 0, 5000))]
  ]) {
    assert.notEqual(a, b, `${label} не анимируется по времени`);
  }
  // Все эффекты захвата и смерти обязаны меняться по фазе.
  for (const id of IDS) {
    const p1 = traceOf((c) => D.drawCaptureFx(c, 0, 0, 16, HSL, id, 0.1));
    const p2 = traceOf((c) => D.drawCaptureFx(c, 0, 0, 16, HSL, id, 0.7));
    assert.notEqual(p1, p2, `capturefx[${id}] не зависит от progress`);
    const d1 = traceOf((c) => D.drawDeathFx(c, 0, 0, 16, HSL, id, 0.1));
    const d2 = traceOf((c) => D.drawDeathFx(c, 0, 0, 16, HSL, id, 0.7));
    assert.notEqual(d1, d2, `deathfx[${id}] не зависит от progress`);
  }
});

// --- устойчивость -----------------------------------------------------------

test('id вне 0..7 не роняет отрисовку и совпадает с зажатым', () => {
  // Ловит: обращение к таблице стилей без клампа. Id косметики приходит с
  // сервера и из localStorage — обе стороны могут прислать что угодно.
  for (const [cat, draw] of Object.entries(CATEGORIES)) {
    const lo = traceOf((ctx) => draw(ctx, 0));
    const hi = traceOf((ctx) => draw(ctx, 7));
    assert.equal(traceOf((ctx) => draw(ctx, -1)), lo, `${cat}: id=-1 не зажался в 0`);
    assert.equal(traceOf((ctx) => draw(ctx, -1e6)), lo, `${cat}: id=-1e6 не зажался в 0`);
    assert.equal(traceOf((ctx) => draw(ctx, 8)), hi, `${cat}: id=8 не зажался в 7`);
    assert.equal(traceOf((ctx) => draw(ctx, 1e6)), hi, `${cat}: id=1e6 не зажался в 7`);
    for (const bad of [NaN, Infinity, null, undefined, 'abc', {}, []]) {
      assert.doesNotThrow(() => traceOf((ctx) => draw(ctx, bad)), `${cat}: id=${String(bad)} уронил отрисовку`);
    }
  }
});

test('вырожденный размер клетки не даёт NaN в координатах', () => {
  /* Ловит: деление на cell или Math.max с обратным порядком аргументов.
     Клетка сжимается до единиц пикселей на большой карте и на мини-карте;
     NaN в fillRect канвас проглатывает молча — предмет просто исчезает,
     и найти это в проде уже нечем. */
  for (const cell of [0, 0.5, 1, 2, -5, 7]) {
    for (const [cat, draw] of Object.entries(CATEGORIES)) {
      for (const id of IDS) {
        const ctx = createMockCtx();
        assert.doesNotThrow(
          () => (cat === 'frame' ? D.drawFrameRow(ctx, 0, 0, Math.abs(cell) * 6 + 1, Math.abs(cell) + 1, id, 1, 'x', 1, true) : draw(ctx, id)),
          `${cat}[${id}] упал при cell=${cell}`
        );
        const bad = traceHasBadNumber(ctx.__trace);
        assert.equal(bad, null, `${cat}[${id}] при cell=${cell} нарисовал ${bad}`);
      }
    }
  }
});

test('нулевая и отрицательная альфа гасят отрисовку целиком', () => {
  /* Ловит: потерю раннего выхода. Клетки следа рисуются тысячами за кадр, и
     без отсечки по альфе полностью прозрачные клетки всё равно уходили бы в
     канвас — это была одна из горячих точек профиля. */
  for (const a of [0, -1, 0.01, 0.02, NaN]) {
    assert.equal(traceOf((c) => D.drawSegTile(c, 0, 0, 16, HSL, 3, 1, a, 0)), '', `seg рисует при alpha=${a}`);
  }
  assert.notEqual(traceOf((c) => D.drawSegTile(c, 0, 0, 16, HSL, 3, 1, 0.03, 0)), '');

  // Территория: 0 и 5 плоские, их гасит та же отсечка.
  assert.equal(traceOf((c) => D.drawTerrTile(c, 0, 0, 16, HSL, 0, 0, 0, 0, 0)), '');
  // Эффект захвата гаснет к концу проигрывания.
  assert.equal(traceOf((c) => D.drawCaptureFx(c, 0, 0, 16, HSL, 0, 1)), '');
  // Пустая плашка ника — не рисуем совсем.
  assert.equal(traceOf((c) => D.drawNamePlate(c, '', 0, 0, HSL, 0, 1, 12, 0)), '');
  assert.equal(traceOf((c) => D.drawNamePlate(c, null, 0, 0, HSL, 0, 1, 12, 0)), '');
  // Шов без рёбер — не рисуем совсем.
  assert.equal(traceOf((c) => D.drawTerrSeam(c, 0, 0, 16, HSL, 0, 1, false)), '');
});

// --- геометрия --------------------------------------------------------------

test('drawHead: силуэт держится внутри своей клетки', () => {
  /* Правило модуля: декоративные кольца головы строго внутри 0.44 клетки,
     поверх игра рисует кольца щита (0.50) и скорости (0.64). Ловит: голову,
     раздутую за пределы клетки — она бы перекрывала кольца бустов и
     соседние клетки следа. */
  const cell = 32;
  const cx = 500;
  const cy = 400;
  // 0.46 (ромб/стрела) + запас на nose 0.26+0.18 = 0.44 -> берём 0.5 клетки.
  const limit = cell * 0.5 + 0.001;
  for (const id of IDS) {
    const ctx = runOf((c) => D.drawHead(c, cx, cy, cell, HSL, id, 1, 0, 1234));
    const bb = pointsBBox(ctx.__points);
    assert.ok(bb, `head[${id}] не нарисовал ни одной точки`);
    assert.ok(bb.minX >= cx - limit, `head[${id}] уехал влево: ${bb.minX} < ${cx - limit}`);
    assert.ok(bb.maxX <= cx + limit, `head[${id}] уехал вправо: ${bb.maxX} > ${cx + limit}`);
    assert.ok(bb.minY >= cy - limit, `head[${id}] уехал вверх: ${bb.minY}`);
    assert.ok(bb.maxY <= cy + limit, `head[${id}] уехал вниз: ${bb.maxY}`);
  }
});

test('drawTerrTile: заливка занимает ровно свою клетку', () => {
  // Ловит: сдвиг или расползание территории — соседние владения начали бы
  // залезать друг на друга по границе.
  const cell = 20;
  for (const id of IDS) {
    const ctx = runOf((c) => D.drawTerrTile(c, 140, 60, cell, HSL, id, 7, 3, 0.7, 1234));
    const rects = ctx.__trace.filter((l) => l.startsWith('fillRect('));
    assert.deepEqual(rects, ['fillRect(140,60,20,20)'], `terr[${id}] залил ${JSON.stringify(rects)}`);
  }
});

test('drawSegTile: клетка следа не выходит за пределы клетки (кроме свечения Неона)', () => {
  /* Вариант 1 «Неон» намеренно шире клетки — у него свечение. Остальные
     обязаны укладываться в клетку. Полосы (id 2) рисуют длинные диагонали,
     но обрезают их clip() — поэтому их считаем по обрезанному прямоугольнику.
     Ловит: след, залезающий на соседние клетки. */
  const cell = 20;
  const px = 300;
  const py = 100;
  for (const id of IDS) {
    if (id === 1) continue; // Неон: свечение по определению выходит за клетку
    const ctx = runOf((c) => D.drawSegTile(c, px, py, cell, HSL, id, 5, 0.9, 1234));
    const clipped = ctx.__trace.some((l) => l.startsWith('clip('));
    const pts = clipped
      ? ctx.__points.filter(([, , op]) => op === 'fillRect' || op === 'rect' || op === 'drawImage')
      : ctx.__points;
    const bb = pointsBBox(pts);
    assert.ok(bb, `seg[${id}] ничего не нарисовал`);
    assert.ok(bb.minX >= px - 0.001 && bb.maxX <= px + cell + 0.001, `seg[${id}] по X: ${bb.minX}..${bb.maxX}`);
    assert.ok(bb.minY >= py - 0.001 && bb.maxY <= py + cell + 0.001, `seg[${id}] по Y: ${bb.minY}..${bb.maxY}`);
  }
});

test('drawFrameRow: варианты 0..6 не рисуют за пределами строки', () => {
  /* Вариант 7 исключён намеренно — у него штриховка выходит за строку на
     высоту строки в обе стороны и НЕ обрезается clip(). Это отдельно описано
     в отчёте как найденный дефект; тест фиксирует, что остальные семь
     вариантов ведут себя правильно, и упадёт, если такая же штриховка
     появится ещё где-то. */
  const [x, y, w, h] = [40, 12, 220, 26];
  for (const id of [0, 1, 2, 3, 4, 5, 6]) {
    const ctx = runOf((c) => D.drawFrameRow(c, x, y, w, h, id, 3, 'Игрок', 100, true));
    const bb = pointsBBox(ctx.__points);
    assert.ok(bb.minX >= x - 0.001, `frame[${id}] слева: ${bb.minX}`);
    assert.ok(bb.maxX <= x + w + 0.001, `frame[${id}] справа: ${bb.maxX}`);
    assert.ok(bb.minY >= y - 0.001 && bb.maxY <= y + h + 0.001, `frame[${id}] по Y: ${bb.minY}..${bb.maxY}`);
  }
  // Зафиксированный дефект варианта 7.
  const bad = pointsBBox(runOf((c) => D.drawFrameRow(c, x, y, w, h, 7, 3, 'Игрок', 100, true)).__points);
  assert.ok(bad.minX < x, 'frame[7] перестал вылезать за строку — обнови тест и отчёт');
});

test('drawFrameRow: без highlight рамка не рисуется', () => {
  // Ловит: рамку, видимую у всех строк таблицы — она задумана как выделение
  // собственной строки игрока.
  const plain = new Set();
  for (const id of IDS) plain.add(traceOf((c) => D.drawFrameRow(c, 0, 0, 200, 24, id, 1, 'Игрок', 5, false)));
  assert.equal(plain.size, 1, 'невыделенные строки не должны зависеть от рамки');
});

test('drawNamePlate: ширина плашки растёт с длиной ника и с кеглем', () => {
  // Ловит: плашку фиксированной ширины — длинный ник вылезал бы за неё.
  const widthOf = (label, fontPx) => {
    const ctx = runOf((c) => D.drawNamePlate(c, label, 0, 0, HSL, 0, 1, fontPx, 0));
    const bb = pointsBBox(ctx.__points);
    return bb.maxX - bb.minX;
  };
  assert.ok(widthOf('Длинный ник игрока', 12) > widthOf('Ко', 12));
  assert.ok(widthOf('Игрок', 24) > widthOf('Игрок', 12));
  // Кегль не опускается ниже 9 px — иначе ник на мини-карте нечитаем.
  const tiny = traceOf((c) => D.drawNamePlate(c, 'Игрок', 0, 0, HSL, 0, 1, 1, 0));
  assert.match(tiny, /set font=9px /);
  const nofont = traceOf((c) => D.drawNamePlate(c, 'Игрок', 0, 0, HSL, 0, 1, 0, 0));
  assert.match(nofont, /set font=12px /, 'без кегля должен быть дефолт 12');
});

// --- террито-хелперы --------------------------------------------------------

test('cosTerrIsPattern / cosTerrIsAdditive: набор узорных и аддитивных вариантов', () => {
  /* Ловит: рассинхрон между списком узорных вариантов и реальной отрисовкой.
     Если cosTerrIsPattern соврёт, cosTerrFillStyle вернёт null, и узорная
     территория станет плоской заливкой — молча, без единой ошибки. */
  assert.deepEqual(IDS.filter((i) => D.cosTerrIsPattern(i)), [1, 2, 4, 6, 7]);
  assert.deepEqual(IDS.filter((i) => D.cosTerrIsAdditive(i)), [6]);
  // Кламп работает и здесь.
  assert.equal(D.cosTerrIsPattern(-5), D.cosTerrIsPattern(0));
  assert.equal(D.cosTerrIsPattern(99), D.cosTerrIsPattern(7));
  assert.equal(D.cosTerrIsAdditive('6'), true);

  // Сверка утверждения с фактической отрисовкой: узорные обязаны звать
  // createPattern, а аддитивный — выставлять globalCompositeOperation.
  for (const id of IDS) {
    const t = traceOf((c) => D.drawTerrTile(c, 0, 0, 16, HSL, id, 0, 0, 0.8, 0));
    assert.equal(
      /set fillStyle=pattern\(/.test(t),
      D.cosTerrIsPattern(id),
      `terr[${id}]: cosTerrIsPattern врёт про узор`
    );
    assert.equal(
      /globalCompositeOperation=lighter/.test(t),
      D.cosTerrIsAdditive(id),
      `terr[${id}]: cosTerrIsAdditive врёт про режим наложения`
    );
  }
});

test('cosTerrAlphaMod: модуляция только у 3 и 4 и всегда в разумных пределах', () => {
  // Ловит: модуляцию, уводящую альфу в минус или выше 1 — территория мигала
  // бы до полной прозрачности или до непрозрачного пятна.
  for (const id of IDS) {
    let min = Infinity;
    let max = -Infinity;
    for (let gx = 0; gx < 12; gx++) {
      for (let gy = 0; gy < 12; gy++) {
        for (const t of [0, 250, 1000, 12345, 999999]) {
          const v = D.cosTerrAlphaMod(id, gx, gy, t);
          assert.ok(Number.isFinite(v), `terr[${id}] alphaMod = ${v}`);
          min = Math.min(min, v);
          max = Math.max(max, v);
        }
      }
    }
    if (id === 3 || id === 4) {
      assert.ok(max > 0.01, `terr[${id}] должен модулировать альфу, а max=${max}`);
    } else {
      assert.equal(min, 0);
      assert.equal(max, 0);
    }
    assert.ok(min >= -0.25 && max <= 0.25, `terr[${id}] модуляция вне ±0.25: ${min}..${max}`);
  }
});

test('cosTerrFillStyle: не-узорные варианты возвращают null, паттерн кэшируется по контексту', () => {
  const ctx = createMockCtx();
  for (const id of [0, 3, 5]) {
    assert.equal(D.cosTerrFillStyle(ctx, HSL, id, 0, 0, 16), null, `terr[${id}] не должен давать паттерн`);
  }
  const a = D.cosTerrFillStyle(ctx, HSL, 1, 0, 0, 16);
  const b = D.cosTerrFillStyle(ctx, HSL, 1, 32, 32, 16);
  // Ловит: пересоздание CanvasPattern на каждый кадр — самая дорогая операция
  // в отрисовке территории, ради её отсутствия и написан кэш.
  assert.equal(a, b, 'паттерн не кэшируется в пределах одного контекста');
  assert.equal(ctx.__trace.filter((l) => l.startsWith('createPattern(')).length, 1);

  // Паттерн привязан к контексту: другой канвас обязан получить свой.
  const ctx2 = createMockCtx();
  assert.notEqual(D.cosTerrFillStyle(ctx2, HSL, 1, 0, 0, 16), a);
});

// --- кэши -------------------------------------------------------------------

test('кэш плиток территории ограничен и не растёт бесконечно', () => {
  /* Ловит: снятие лимита. Плитка — оффскрин-канвас 64×64; ключ содержит цвет
     игрока, а цветов 2160. Без лимита длинная сессия с ротацией игроков
     утекала бы десятками мегабайт видеопамяти.
     Наблюдаемый признак: после переполнения кэш очищается, и первый цвет
     приходится создавать заново — это видно по новому document.createElement. */
  const countCanvases = () => dom.created.length;

  const first = 'hsl(1 50% 50%)';
  D.cosTerrFillStyle(createMockCtx(), first, 1, 0, 0, 16);
  const afterFirst = countCanvases();
  // Повторный запрос того же цвета не создаёт новый канвас.
  D.cosTerrFillStyle(createMockCtx(), first, 1, 0, 0, 16);
  assert.equal(countCanvases(), afterFirst, 'плитка территории не кэшируется вовсе');

  // Переполняем кэш заведомо (лимит в коде — 96 записей).
  for (let i = 0; i < 200; i++) {
    D.cosTerrFillStyle(createMockCtx(), `hsl(${100 + i} 50% 50%)`, 1, 0, 0, 16);
  }
  const afterFlood = countCanvases();
  assert.ok(afterFlood - afterFirst <= 210, 'на каждый цвет должно уходить не больше одной плитки');

  // Первый цвет вытеснили — значит лимит существует.
  D.cosTerrFillStyle(createMockCtx(), first, 1, 0, 0, 16);
  assert.equal(countCanvases(), afterFlood + 1, 'кэш плиток территории не ограничен сверху');
});

test('кэш плиток следа ограничен по числу цветов', () => {
  /* То же самое для Неона/Полос (seg 1 и 2): лимит в коде — 32 цвета.
     Ловит: рост кэша до бесконечности на публичных серверах, где через
     комнату проходят сотни разных цветов игроков. */
  const base = dom.created.length;
  const first = 'hsl(300 44% 44%)';
  D.drawSegTile(createMockCtx(), 0, 0, 16, first, 1, 1, 1, 0);
  const afterFirst = dom.created.length;
  assert.ok(afterFirst > base, 'плитка следа не создалась');

  D.drawSegTile(createMockCtx(), 0, 0, 16, first, 1, 1, 1, 0);
  assert.equal(dom.created.length, afterFirst, 'плитка следа не кэшируется');

  for (let i = 0; i < 80; i++) {
    D.drawSegTile(createMockCtx(), 0, 0, 16, `hsl(${i} 33% 33%)`, 1, 1, 1, 0);
  }
  const afterFlood = dom.created.length;
  D.drawSegTile(createMockCtx(), 0, 0, 16, first, 1, 1, 1, 0);
  assert.equal(dom.created.length, afterFlood + 1, 'кэш плиток следа не ограничен сверху');
});

test('кэш градиентов привязан к контексту и переиспользуется', () => {
  /* Градиент canvas нельзя переносить между канвасами — отсюда WeakMap по ctx.
     Ловит: общий кэш на все контексты (в браузере это тихо ломает отрисовку
     превью магазина) и потерю кэша (createLinearGradient на каждую клетку). */
  const ctx = createMockCtx();
  for (let i = 0; i < 20; i++) D.drawSegTile(ctx, 0, 0, 16, HSL, 3, i, 1, i * 100);
  const made = ctx.__trace.filter((l) => l.startsWith('createLinearGradient(')).length;
  assert.equal(made, 1, `градиент пересоздан ${made} раз вместо одного`);

  const ctx2 = createMockCtx();
  D.drawSegTile(ctx2, 0, 0, 16, HSL, 3, 1, 1, 0);
  assert.equal(
    ctx2.__trace.filter((l) => l.startsWith('createLinearGradient(')).length,
    1,
    'второй контекст должен получить свой градиент'
  );
});

test('плитка следа переиспользуется при повторной отрисовке той же клетки', () => {
  // Ловит: потерю быстрого пути — вместо одного drawImage вернулся бы
  // медленный путь с save/shadowBlur на каждую клетку (это был кадровый
  // бюджет целиком на мобильном).
  const ctx = createMockCtx();
  for (let i = 0; i < 50; i++) D.drawSegTile(ctx, i * 16, 0, 16, HSL, 1, i, 0.9, 0);
  const draws = ctx.__trace.filter((l) => l.startsWith('drawImage(')).length;
  assert.equal(draws, 50, 'быстрый путь плитки не сработал');
  assert.equal(ctx.__trace.filter((l) => l.startsWith('set shadowBlur=')).length, 0, 'shadowBlur вернулся в горячий путь');
});

// --- прочее -----------------------------------------------------------------

test('COS_DEATH_MS и COS_FONT — стабильные константы', () => {
  assert.equal(D.COS_DEATH_MS, 900);
  assert.match(D.COS_FONT, /system-ui/);
});

test('cosPrepCanvas: backing store умножается на devicePixelRatio и зажат в 1..3', () => {
  /* Ловит: иконку магазина, отрисованную в CSS-пикселях — на retina она
     мылится. И зажим сверху: dpr=4 на дешёвом телефоне даёт вчетверо больший
     буфер под каждую из десятков карточек. */
  const cases = [
    [1, 100, 50, 100, 50],
    [2, 100, 50, 200, 100],
    [3, 40, 40, 120, 120],
    [4, 40, 40, 120, 120], // зажим сверху
    [0.5, 40, 40, 40, 40], // зажим снизу
    [NaN, 40, 40, 40, 40]
  ];
  for (const [dpr, w, h, bw, bh] of cases) {
    const stub = installDomStubs({ dpr });
    try {
      const el = globalThis.document.createElement('canvas');
      const c = D.cosPrepCanvas(el, w, h);
      assert.ok(c, `нет контекста при dpr=${dpr}`);
      assert.equal(el.width, bw, `dpr=${dpr}: width`);
      assert.equal(el.height, bh, `dpr=${dpr}: height`);
      assert.ok(c.__trace.includes(`setTransform(${Math.max(1, Math.min(3, Number(dpr) || 1))},0,0,${Math.max(1, Math.min(3, Number(dpr) || 1))},0,0)`),
        `dpr=${dpr}: не выставлен transform, трасса ${JSON.stringify(c.__trace)}`);
      assert.ok(c.__trace.some((l) => l.startsWith('clearRect(')), 'канвас не очищен перед отрисовкой');
    } finally {
      stub.restore();
    }
  }
  // Восстанавливаем общие заглушки для остальных тестов файла.
  installDomStubs();
});

test('cosPrepCanvas: канвас без 2d-контекста возвращает null, а не падает', () => {
  const el = { width: 0, height: 0, getContext: () => null };
  const stub = installDomStubs();
  try {
    assert.equal(D.cosPrepCanvas(el, 10, 10), null);
  } finally {
    stub.restore();
  }
  installDomStubs();
});

test('отрисовка не падает без document (плитки уходят в медленный путь)', () => {
  /* Ловит: снятие try/catch вокруг document.createElement. Модуль зовётся и
     из воркера превью, и до готовности DOM — падение здесь уронило бы весь
     игровой цикл. */
  const prevDoc = globalThis.document;
  delete globalThis.document;
  try {
    const ctx = createMockCtx();
    assert.doesNotThrow(() => D.drawSegTile(ctx, 0, 0, 16, 'hsl(11 22% 33%)', 1, 1, 0.9, 0));
    assert.ok(ctx.__trace.length > 0, 'медленный путь ничего не нарисовал');
    assert.equal(ctx.__trace.filter((l) => l.startsWith('drawImage(')).length, 0);
    assert.ok(ctx.__trace.some((l) => l.startsWith('set shadowBlur=')), 'у Неона должно остаться свечение');
  } finally {
    globalThis.document = prevDoc;
  }
});

test('drawTerrSeam: рисует ровно запрошенные рёбра', () => {
  // Ловит: перепутанные биты маски (1 верх, 2 право, 4 низ, 8 лево) — швы
  // владения поехали бы по не тем сторонам и рисунок границы развалился.
  const [px, py, cell] = [100, 200, 20];
  const seg = (edges) =>
    runOf((c) => D.drawTerrSeam(c, px, py, cell, HSL, edges, 0.9, false)).__trace.filter((l) => l.startsWith('moveTo('));
  assert.deepEqual(seg(1), ['moveTo(100,200.5)']);
  assert.deepEqual(seg(2), ['moveTo(119.5,200)']);
  assert.deepEqual(seg(4), ['moveTo(100,219.5)']);
  assert.deepEqual(seg(8), ['moveTo(100.5,200)']);
  assert.equal(seg(15).length, 4, 'маска 15 должна дать все четыре ребра');
  assert.equal(seg(5).length, 2);
});
