/*
 * public/client_color.js — исполняемые тесты.
 *
 * Модуль чистый: hsl-строка -> rgb, «подсветка» hsl и раскладка номера цвета.
 * Его результат уходит в КАЖДЫЙ rgba(...) на канвасе (след, территория,
 * плашки, эффекты), поэтому тихая порча здесь красит пол-экрана в серый
 * цвет-заглушку [200,200,200] и выглядит как «баг рендера», а не как баг цвета.
 *
 * Каждый нетривиальный тест подписан: какую поломку он ловит.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { hslToRgb, boostHsl, hueToHsl } from '../public/client_color.js';

// --- hslToRgb ---------------------------------------------------------------

test('hslToRgb: опорные цвета переводятся точно', () => {
  // Ловит: подмену формулы hue2rgb (перепутанные ветки 1/6, 1/2, 2/3) —
  // именно она даёт «почти правильный, но не тот» цвет, который глазами в
  // игре не отличить, а в магазине предметы разъезжаются с игрой.
  assert.deepEqual(hslToRgb('hsl(0 100% 50%)'), [255, 0, 0]);
  assert.deepEqual(hslToRgb('hsl(120 100% 50%)'), [0, 255, 0]);
  assert.deepEqual(hslToRgb('hsl(240 100% 50%)'), [0, 0, 255]);
  assert.deepEqual(hslToRgb('hsl(60 100% 50%)'), [255, 255, 0]);
  assert.deepEqual(hslToRgb('hsl(180 100% 50%)'), [0, 255, 255]);
  assert.deepEqual(hslToRgb('hsl(300 100% 50%)'), [255, 0, 255]);
});

test('hslToRgb: границы светлоты и нулевая насыщенность', () => {
  // Ловит: потерю ветки s === 0 (серые цвета) и неверный расчёт q при l < 0.5.
  assert.deepEqual(hslToRgb('hsl(210 0% 0%)'), [0, 0, 0]);
  assert.deepEqual(hslToRgb('hsl(210 0% 100%)'), [255, 255, 255]);
  assert.deepEqual(hslToRgb('hsl(210 0% 50%)'), [128, 128, 128]);
  assert.deepEqual(hslToRgb('hsl(999 100% 0%)'), [0, 0, 0]);
  assert.deepEqual(hslToRgb('hsl(999 100% 100%)'), [255, 255, 255]);
});

test('hslToRgb: hue 0 и hue 360 дают один цвет', () => {
  // Ловит: обрыв на границе круга — h/360 = 1 должен свернуться в 0
  // (за это отвечает `if (t > 1) t -= 1` внутри hue2rgb).
  assert.deepEqual(hslToRgb('hsl(360 78% 52%)'), hslToRgb('hsl(0 78% 52%)'));
});

test('hslToRgb: любой мусор даёт серую заглушку, а не исключение', () => {
  // Ловит: падение отрисовки на неожиданном формате цвета. Цвет приходит из
  // hueToHsl, но drawSegTile/drawTerrTile зовут hslToRgb и из превью магазина,
  // куда hsl может прийти строкой из вёрстки.
  const grey = [200, 200, 200];
  for (const bad of [
    '',
    'red',
    '#ff0000',
    'hsl(210,78%,52%)', // с запятыми — старый формат
    'hsl(210 78 52)', // без процентов
    'hsl(-10 78% 52%)', // regex требует \d+, минус не пройдёт
    'hsl(210.5 78% 52%)',
    ' hsl(210 78% 52%)',
    null,
    undefined,
    123,
    {}
  ]) {
    assert.deepEqual(hslToRgb(bad), grey, `вход: ${String(bad)}`);
  }
});

test('hslToRgb: кэш возвращает тот же самый массив', () => {
  // Ловит: потерю кэша. Функция зовётся до нескольких тысяч раз за кадр;
  // без кэша это столько же аллокаций массива на кадр. Проверяем именно
  // идентичность объекта — равенство значений кэш не доказывает.
  const a = hslToRgb('hsl(17 61% 43%)');
  const b = hslToRgb('hsl(17 61% 43%)');
  assert.equal(a, b);

  const c = hslToRgb('!мусор-для-кэша!');
  const d = hslToRgb('!мусор-для-кэша!');
  assert.equal(c, d, 'заглушка тоже должна кэшироваться');
});

// --- boostHsl ---------------------------------------------------------------

test('boostHsl: насыщенность и светлота зажимаются в читаемый диапазон', () => {
  // Ловит: съехавшие границы. Смысл boost — гарантировать читаемость ника и
  // плашек на тёмном фоне: s в [72..100], l в [48..74] при ЛЮБОМ входе.
  const cases = [
    ['hsl(210 0% 0%)', 'hsl(210 72% 48%)'], // всё уехало вниз -> нижние границы
    ['hsl(210 100% 100%)', 'hsl(210 100% 74%)'], // всё вверх -> верхние
    ['hsl(210 78% 52%)', 'hsl(210 98% 62%)'], // 78*1.25=97.5 -> 98; 52+10=62
    ['hsl(0 40% 30%)', 'hsl(0 72% 48%)'] // 40*1.25=50 -> зажато до 72
  ];
  for (const [inp, want] of cases) {
    assert.equal(boostHsl(inp), want, `вход: ${inp}`);
  }

  // Инвариант, а не отдельные числа: он переживёт правку коэффициентов,
  // но упадёт от правки границ.
  for (let h = 0; h < 360; h += 7) {
    for (const s of [0, 33, 66, 100]) {
      for (const l of [0, 25, 50, 75, 100]) {
        const m = boostHsl(`hsl(${h} ${s}% ${l}%)`).match(/^hsl\((\d+) (\d+)% (\d+)%\)$/);
        assert.ok(m, `boostHsl вернул не hsl для hsl(${h} ${s}% ${l}%)`);
        assert.equal(Number(m[1]), h, 'hue меняться не должен');
        assert.ok(Number(m[2]) >= 72 && Number(m[2]) <= 100, `s вне [72..100]: ${m[2]}`);
        assert.ok(Number(m[3]) >= 48 && Number(m[3]) <= 74, `l вне [48..74]: ${m[3]}`);
      }
    }
  }
});

test('boostHsl: неразобранный вход возвращается как есть', () => {
  // Ловит: превращение мусора в 'hsl(NaN NaN% NaN%)' — такой fillStyle канвас
  // молча игнорирует, и элемент просто не рисуется.
  assert.equal(boostHsl('red'), 'red');
  assert.equal(boostHsl(''), '');
  assert.equal(boostHsl(null), 'null');
  assert.equal(boostHsl(undefined), 'undefined');
});

test('boostHsl: кэш отдаёт ту же строку и не путает соседние ключи', () => {
  const a = boostHsl('hsl(11 31% 41%)');
  const b = boostHsl('hsl(11 31% 41%)');
  assert.equal(a, b);
  // Ловит: кэш с ключом только по hue (тогда второй вызов вернул бы первый цвет).
  assert.notEqual(boostHsl('hsl(11 90% 20%)'), a);
});

// --- hueToHsl ---------------------------------------------------------------

test('hueToHsl: код цвета раскладывается на hue и вариант', () => {
  // Ловит: смену раскладки «код -> (hue, вариант)». Код игрока приходит с
  // сервера; если клиент разложит его иначе, у одного игрока в игре и в
  // таблице лидеров окажутся разные цвета.
  assert.equal(hueToHsl(0), 'hsl(0 78% 52%)');
  assert.equal(hueToHsl(210), 'hsl(210 78% 52%)');
  assert.equal(hueToHsl(359), 'hsl(359 78% 52%)');
  assert.equal(hueToHsl(360), 'hsl(0 78% 42%)'); // вариант 1
  assert.equal(hueToHsl(720), 'hsl(0 78% 62%)'); // вариант 2
  assert.equal(hueToHsl(1080), 'hsl(0 90% 52%)'); // вариант 3
  assert.equal(hueToHsl(1440), 'hsl(0 66% 52%)'); // вариант 4
  assert.equal(hueToHsl(1800), 'hsl(0 90% 62%)'); // вариант 5
  assert.equal(hueToHsl(2160), 'hsl(0 78% 52%)'); // 6 вариантов -> цикл
});

test('hueToHsl: 6 вариантов × 360 hue дают 2160 различных цветов', () => {
  // Ловит: коллизии в раскладке (например `% 6` не там) — два игрока
  // получили бы буквально один цвет и стали неразличимы на поле.
  const seen = new Set();
  for (let code = 0; code < 2160; code++) seen.add(hueToHsl(code));
  assert.equal(seen.size, 2160);
  // И цикл: код 2160 обязан совпасть с кодом 0.
  for (let code = 0; code < 50; code++) {
    assert.equal(hueToHsl(code + 2160), hueToHsl(code));
  }
});

test('hueToHsl: отрицательные и дробные коды не ломают строку', () => {
  // Ловит: NaN/минус внутри hsl(...). Такой fillStyle канвас игнорирует —
  // змейка стала бы невидимой вместо «цвет по умолчанию».
  assert.equal(hueToHsl(-1), 'hsl(0 78% 52%)');
  assert.equal(hueToHsl(-1000), 'hsl(0 78% 52%)');
  assert.equal(hueToHsl(210.9), 'hsl(210 78% 52%)');
  assert.equal(hueToHsl('210'), 'hsl(210 78% 52%)');
  for (const bad of [NaN, Infinity, -Infinity, 'abc', null, undefined, {}, []]) {
    const out = hueToHsl(bad);
    assert.match(out, /^hsl\(\d+ \d+% \d+%\)$/, `вход ${String(bad)} дал "${out}"`);
  }
  assert.equal(hueToHsl('abc'), 'hsl(210 78% 52%)');
});

test('hueToHsl: результат всегда разбирается hslToRgb (не серая заглушка)', () => {
  // Сквозная проверка контракта двух функций: hueToHsl -> hslToRgb. Ловит
  // расхождение форматов (запятые/пробелы/дробные) — оно превратило бы ВСЕ
  // цвета игроков в [200,200,200], и весь экран стал бы серым.
  for (let code = 0; code < 2160; code += 13) {
    const hsl = hueToHsl(code);
    const rgb = hslToRgb(hsl);
    assert.ok(Array.isArray(rgb) && rgb.length === 3, `не rgb для ${hsl}`);
    assert.notDeepEqual(rgb, [200, 200, 200], `${hsl} не разобрался hslToRgb`);
    for (const v of rgb) assert.ok(Number.isInteger(v) && v >= 0 && v <= 255, `${hsl} -> ${rgb}`);
  }
});

test('hueToHsl: результат всегда разбирается boostHsl', () => {
  // Тот же контракт для «подсветки»: если boostHsl не разберёт формат, он
  // вернёт вход как есть — и подсветка тихо перестанет работать.
  for (let code = 0; code < 2160; code += 37) {
    const hsl = hueToHsl(code);
    assert.notEqual(boostHsl(hsl), hsl, `boostHsl не изменил ${hsl}`);
  }
});
