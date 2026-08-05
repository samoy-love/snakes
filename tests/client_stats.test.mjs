/*
 * Итоговые цифры игрока: порядок в таблице и личный рекорд.
 *
 * Рекорд — единственная хорошая новость на экране проигрыша, и его логика
 * содержит два неочевидных правила, которые легко «починить» в неправильную
 * сторону:
 *   1) первый в жизни результат — НЕ «новый рекорд»: сравнивать не с чем;
 *   2) прирост меньше порога рекордом не считается, иначе каждая смерть на
 *      стартовых 3x3 клетках объявлялась бы достижением.
 * Оба зафиксированы тестами.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BEST_PCT_EPSILON,
  BEST_PCT_KEY,
  commitBestPct,
  placeLabel,
  readBestPct,
  sortPlayersByScore,
  zonePct
} from '../public/client_stats.js';

/** Хранилище в памяти — подделка localStorage для тестов. */
function memStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    _dump: () => Object.fromEntries(map)
  };
}

/** Хранилище, которое бросает на любой операции — приватный режим браузера. */
const hostileStorage = {
  getItem() {
    throw new Error('SecurityError');
  },
  setItem() {
    throw new Error('QuotaExceededError');
  }
};

const player = (n, p, s) => ({ n, p, s });

// --- sortPlayersByScore ------------------------------------------------------

test('порядок: по очкам убыванием', () => {
  const out = sortPlayersByScore([player(1, 10, 0), player(2, 50, 0), player(3, 30, 0)]);
  assert.deepEqual(out.map((p) => p.n), [2, 3, 1]);
});

test('порядок: при равных очках выше тот, у кого больше клеток', () => {
  const out = sortPlayersByScore([player(1, 10, 5), player(2, 10, 90), player(3, 10, 40)]);
  assert.deepEqual(out.map((p) => p.n), [2, 3, 1]);
});

test('порядок: не мутирует исходный массив', () => {
  const src = [player(1, 10, 0), player(2, 50, 0)];
  sortPlayersByScore(src);
  assert.deepEqual(src.map((p) => p.n), [1, 2]);
});

test('порядок: переживает пустоту и не-массив', () => {
  for (const bad of [undefined, null, 'строка', 42, []]) {
    assert.deepEqual(sortPlayersByScore(bad), []);
  }
});

test('порядок: игроки без очков не ломают сортировку', () => {
  const out = sortPlayersByScore([{ n: 1 }, player(2, 5, 0), { n: 3, p: null }]);
  assert.equal(out[0].n, 2);
  assert.equal(out.length, 3);
});

// --- placeLabel --------------------------------------------------------------

test('место: «N/M» по позиции в отсортированной таблице', () => {
  const players = [player(1, 10, 0), player(2, 50, 0), player(3, 30, 0)];
  assert.equal(placeLabel(players, 2), '1/3');
  assert.equal(placeLabel(players, 3), '2/3');
  assert.equal(placeLabel(players, 1), '3/3');
});

test('место: игрока нет в таблице — прочерк, а не «0/N»', () => {
  assert.equal(placeLabel([player(1, 10, 0)], 99), '—');
  assert.equal(placeLabel([], 1), '—');
});

// --- zonePct -----------------------------------------------------------------

test('доля карты: обычный расчёт', () => {
  assert.equal(zonePct(50, 200), 25);
  assert.equal(zonePct(0, 200), 0);
});

test('доля карты: неизвестный размер карты даёт 0, а не Infinity или NaN', () => {
  assert.equal(zonePct(50, 0), 0);
  assert.equal(zonePct(50, undefined), 0);
  assert.equal(zonePct(50, -1), 0);
});

// --- readBestPct -------------------------------------------------------------

test('чтение рекорда: нет записи — ноль', () => {
  assert.equal(readBestPct(memStorage()), 0);
});

test('чтение рекорда: мусор в хранилище читается как «рекорда нет»', () => {
  for (const bad of ['абв', '', 'NaN', '-5', '0']) {
    assert.equal(readBestPct(memStorage({ [BEST_PCT_KEY]: bad })), 0, `на входе ${JSON.stringify(bad)}`);
  }
});

test('чтение рекорда: недоступное хранилище не роняет игру', () => {
  assert.equal(readBestPct(hostileStorage), 0);
  assert.equal(readBestPct(undefined), 0);
  assert.equal(readBestPct(null), 0);
});

// --- commitBestPct: главные правила -----------------------------------------

test('первый результат сохраняется, но «новым рекордом» НЕ объявляется', () => {
  const st = memStorage();
  const r = commitBestPct(2.5, st);
  assert.equal(r.best, 2.5);
  assert.equal(r.isRecord, false, 'сравнивать не с чем — это ещё не рекорд');
  assert.equal(st._dump()[BEST_PCT_KEY], '2.5', 'но запомнить обязаны');
});

test('побитый рекорд объявляется рекордом и переписывает хранилище', () => {
  const st = memStorage({ [BEST_PCT_KEY]: '2.5' });
  const r = commitBestPct(7.1, st);
  assert.equal(r.best, 7.1);
  assert.equal(r.isRecord, true);
  assert.equal(st._dump()[BEST_PCT_KEY], '7.1');
});

test('результат хуже рекорда его не трогает', () => {
  const st = memStorage({ [BEST_PCT_KEY]: '7.1' });
  const r = commitBestPct(1.2, st);
  assert.equal(r.best, 7.1, 'показываем прежний рекорд');
  assert.equal(r.isRecord, false);
  assert.equal(st._dump()[BEST_PCT_KEY], '7.1', 'хранилище не переписано');
});

test('прирост меньше порога рекордом не считается', () => {
  const st = memStorage({ [BEST_PCT_KEY]: '5' });
  const r = commitBestPct(5 + BEST_PCT_EPSILON / 2, st);
  assert.equal(r.isRecord, false, 'иначе смерть на спавне = «новый рекорд»');
  assert.equal(r.best, 5);
  assert.equal(st._dump()[BEST_PCT_KEY], '5');
});

test('прирост ровно на порог — ещё не рекорд, строго больше — уже рекорд', () => {
  const exactly = commitBestPct(5 + BEST_PCT_EPSILON, memStorage({ [BEST_PCT_KEY]: '5' }));
  assert.equal(exactly.isRecord, false, 'граница исключающая');

  const over = commitBestPct(5 + BEST_PCT_EPSILON + 0.001, memStorage({ [BEST_PCT_KEY]: '5' }));
  assert.equal(over.isRecord, true);
});

test('серия забегов: рекорд объявляется ровно один раз на улучшение', () => {
  const st = memStorage();
  const flags = [2.0, 1.0, 5.5, 5.52, 9.0].map((p) => commitBestPct(p, st).isRecord);
  assert.deepEqual(flags, [false, false, true, false, true]);
  assert.equal(readBestPct(st), 9.0);
});

test('нулевой и отрицательный забег не создают рекорд', () => {
  const st = memStorage();
  assert.equal(commitBestPct(0, st).isRecord, false);
  assert.equal(commitBestPct(-3, st).isRecord, false);
  assert.equal(readBestPct(st), 0);
});

test('нечисловой забег не портит уже сохранённый рекорд', () => {
  const st = memStorage({ [BEST_PCT_KEY]: '4' });
  const r = commitBestPct(NaN, st);
  assert.equal(r.best, 4);
  assert.equal(r.isRecord, false);
  assert.equal(st._dump()[BEST_PCT_KEY], '4');
});

test('недоступное хранилище: рекорд не сохраняется, но игра не падает', () => {
  const r = commitBestPct(9.9, hostileStorage);
  assert.equal(r.best, 9.9, 'в текущей сессии значение всё равно показываем');
  assert.equal(r.isRecord, false, 'прежнего рекорда прочитать не удалось');
});
