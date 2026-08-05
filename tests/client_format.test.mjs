/*
 * Форматирование чисел, долей, времени и обратного отсчёта.
 *
 * Почему это стоит тестов. Все эти функции пишут прямо в HUD и в оверлеи, и
 * ошибка в них не падает, а показывает игроку «NaN%», «-0:03» или «undefined».
 * Раньше формулы читали язык и тики из состояния client.js, поэтому проверить
 * их можно было только глазами на живой странице.
 *
 * Отдельный тест — на разделитель разрядов: это узкий неразрывный пробел
 * U+202F, глазами неотличимый от обычного. При переносе кода в модуль его уже
 * однажды подменили обычным пробелом, и «100 000» начинает рваться переносом
 * строки посреди числа. Сверяем код точки, а не вид символа.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GROUP_SEPARATOR,
  approxTickNow,
  formatClock,
  formatGroupedCount,
  formatInt,
  formatNumber,
  formatPct1,
  formatRate,
  formatRemainMs,
  numberLocale,
  remainMsToTick
} from '../public/client_format.js';

// --- numberLocale ------------------------------------------------------------

test('numberLocale: en → en-US, всё остальное → ru-RU', () => {
  assert.equal(numberLocale('en'), 'en-US');
  assert.equal(numberLocale('ru'), 'ru-RU');
  assert.equal(numberLocale(undefined), 'ru-RU');
  assert.equal(numberLocale(null), 'ru-RU');
  assert.equal(numberLocale('EN'), 'ru-RU', 'регистр значим: язык хранится строчным');
});

// --- formatInt ---------------------------------------------------------------

test('formatInt: округляет к ближайшему целому', () => {
  assert.equal(formatInt(4.4, 'en'), '4');
  assert.equal(formatInt(4.5, 'en'), '5');
  assert.equal(formatInt(-4.5, 'en'), '-4', 'Math.round(-4.5) === -4');
});

test('formatInt: нечисло даёт «0», а не «NaN» на экране', () => {
  for (const bad of [undefined, null, NaN, Infinity, -Infinity, 'абв', {}]) {
    assert.equal(formatInt(bad, 'ru'), '0', `на входе ${String(bad)}`);
  }
});

test('formatInt: пустая строка и false — это 0 по Number(), а не «0» по ветке нечисла', () => {
  assert.equal(formatInt('', 'en'), '0');
  assert.equal(formatInt(false, 'en'), '0');
});

test('formatInt: разряды разделяются по локали', () => {
  assert.equal(formatInt(1234567, 'en'), '1,234,567');
  // В ru-RU Intl ставит неразрывный пробел — проверяем цифры, а не вид пробела.
  assert.match(formatInt(1234567, 'ru').replace(/\s/g, ''), /^1234567$/);
});

// --- formatPct1 --------------------------------------------------------------

test('formatPct1: один знак после запятой', () => {
  assert.equal(formatPct1(12.34, 'en'), '12.3%');
  assert.equal(formatPct1(12.35, 'en'), '12.4%');
  assert.equal(formatPct1(0, 'en'), '0.0%');
});

test('formatPct1: русская локаль ставит запятую', () => {
  assert.equal(formatPct1(12.4, 'ru'), '12,4%');
});

test('formatPct1: нечисло даёт нулевую долю в правильной локали, а не «NaN%»', () => {
  assert.equal(formatPct1(NaN, 'ru'), '0,0%');
  assert.equal(formatPct1(NaN, 'en'), '0.0%');
  assert.equal(formatPct1(undefined, 'ru'), '0,0%');
});

// --- formatNumber ------------------------------------------------------------

test('formatNumber: пробрасывает опции Intl', () => {
  assert.equal(formatNumber(0.5, 'en', { style: 'percent' }), '50%');
});

test('formatNumber: нечисло возвращается как строка, а не «NaN»', () => {
  assert.equal(formatNumber('привет', 'ru'), 'привет');
  assert.equal(formatNumber(undefined, 'ru'), '');
  // null — это НЕ «нечисло»: Number(null) === 0, и на экран уйдёт «0».
  // Квирк приведения, а не опечатка: фиксируем его тестом, чтобы следующая
  // правка не «починила» его в пустую строку и не убрала нолики из HUD.
  assert.equal(formatNumber(null, 'ru'), '0');
});

test('formatNumber: битые опции не роняют — есть запасной путь', () => {
  assert.equal(formatNumber(42, 'ru', { style: 'нет-такого-стиля' }), '42');
});

// --- formatGroupedCount ------------------------------------------------------

test('разделитель разрядов — именно U+202F (узкий неразрывный пробел)', () => {
  assert.equal(GROUP_SEPARATOR.codePointAt(0), 0x202f);
  assert.equal(GROUP_SEPARATOR.length, 1);
  assert.notEqual(GROUP_SEPARATOR, ' ', 'обычный пробел рвёт число переносом строки');
});

test('formatGroupedCount: группы по три с U+202F', () => {
  assert.equal(formatGroupedCount(100000), `100${GROUP_SEPARATOR}000`);
  assert.equal(formatGroupedCount(1234567), `1${GROUP_SEPARATOR}234${GROUP_SEPARATOR}567`);
  assert.equal(formatGroupedCount(999), '999', 'до тысячи разделителя нет');
});

test('formatGroupedCount: отрицательное и дробное сводятся к неотрицательному целому', () => {
  assert.equal(formatGroupedCount(-5), '0');
  assert.equal(formatGroupedCount(12.9), '12');
  assert.equal(formatGroupedCount(undefined), '0');
  assert.equal(formatGroupedCount('абв'), '0');
});

// --- formatClock -------------------------------------------------------------

test('formatClock: часы и минуты с ведущими нулями', () => {
  const d = new Date(2026, 0, 2, 3, 4);
  assert.equal(formatClock(d.getTime()), '03:04');
});

test('formatClock: полночь и конец суток', () => {
  assert.equal(formatClock(new Date(2026, 0, 2, 0, 0).getTime()), '00:00');
  assert.equal(formatClock(new Date(2026, 0, 2, 23, 59).getTime()), '23:59');
});

test('formatClock: битая дата не даёт «NaN:NaN» в строке чата', () => {
  assert.equal(formatClock(NaN), '--:--');
  assert.equal(formatClock('не дата'), '--:--');
});

// --- formatRate --------------------------------------------------------------

test('formatRate: килобайты и мегабайты', () => {
  assert.equal(formatRate(1024), '1.0KB/s');
  assert.equal(formatRate(1024 * 1024), '1.0MB/s');
  assert.equal(formatRate(0), '0.0KB/s');
});

test('formatRate: отрицательное и нечисло — многоточие, а не «-1.0KB/s»', () => {
  assert.equal(formatRate(-1), '…');
  assert.equal(formatRate(NaN), '…');
  assert.equal(formatRate(undefined), '…');
});

// --- remainMsToTick / formatRemainMs ----------------------------------------

test('remainMsToTick: обычный случай', () => {
  // до тика 100 при текущем 40, тик = 100 мс → 6000 мс
  assert.equal(remainMsToTick(100, 40, 100), 6000);
});

test('remainMsToTick: прошедший срок срезается в ноль, а не уходит в минус', () => {
  assert.equal(remainMsToTick(40, 100, 100), 0);
});

test('remainMsToTick: без цели, без длины тика или без «сейчас» — null', () => {
  assert.equal(remainMsToTick(0, 40, 100), null, 'цели нет');
  assert.equal(remainMsToTick(100, 40, 0), null, 'длина тика неизвестна');
  assert.equal(remainMsToTick(100, null, 100), null, '«сейчас» неизвестно');
  assert.equal(remainMsToTick(100, NaN, 100), null);
});

test('formatRemainMs: минуты и секунды с ведущим нулём', () => {
  assert.equal(formatRemainMs(0), '0:00');
  assert.equal(formatRemainMs(1), '0:01', 'округление вверх: остаток есть — секунда есть');
  assert.equal(formatRemainMs(59_000), '0:59');
  assert.equal(formatRemainMs(60_000), '1:00');
  assert.equal(formatRemainMs(125_000), '2:05');
});

test('formatRemainMs: null и нечисло дают пустую строку, а не «NaN:NaN»', () => {
  assert.equal(formatRemainMs(null), '');
  assert.equal(formatRemainMs(undefined), '');
  assert.equal(formatRemainMs(NaN), '');
});

test('связка: конец матча показывает 0:00, а не отрицательное время', () => {
  assert.equal(formatRemainMs(remainMsToTick(10, 999, 100)), '0:00');
});

// --- approxTickNow -----------------------------------------------------------

test('approxTickNow: линейная экстраполяция от последнего события', () => {
  // последнее событие: тик 50 в момент 1000 мс; тик = 100 мс; сейчас 1500 мс
  // прошло 500 мс = 5 тиков → 55
  assert.equal(approxTickNow({ tickMs: 100, lastEventsTick: 50, lastEventsAt: 1000, nowMs: 1500 }), 55);
});

test('approxTickNow: время назад не откатывает тик в прошлое', () => {
  const t = approxTickNow({ tickMs: 100, lastEventsTick: 50, lastEventsAt: 2000, nowMs: 1000 });
  assert.equal(t, 50, 'отрицательная дельта срезается в ноль');
});

test('approxTickNow: без длины тика или без события — null', () => {
  assert.equal(approxTickNow({ tickMs: 0, lastEventsTick: 50, lastEventsAt: 1000, nowMs: 1500 }), null);
  assert.equal(approxTickNow({ tickMs: 100, lastEventsTick: 0, lastEventsAt: 1000, nowMs: 1500 }), null);
  assert.equal(approxTickNow({ tickMs: 100, lastEventsTick: 50, lastEventsAt: 0, nowMs: 1500 }), null);
});

test('approxTickNow: битое «сейчас» не даёт NaN-тик', () => {
  assert.equal(approxTickNow({ tickMs: 100, lastEventsTick: 50, lastEventsAt: 1000, nowMs: NaN }), null);
});
