/*
 * Сиюминутные эффекты: client_fx_rt.js.
 *
 * Тестируется то, что осталось чистой арифметикой поверх стора. Основное —
 * hitstopLostMs(): она вычитается из времени интерполяции змеек, и любая
 * ошибка в пересечении окон даёт не исключение, а рывок или залипание
 * картинки — глазами такое ловится плохо, а на снимках вообще никак.
 *
 * Выбор «баннер или тост» в celebrateFirstCapture() чистым не является:
 * showBigBanner() читает разметку и решение зависит от неё, а не от
 * аргументов. Здесь проверяется предшествующий ему чистый гейт —
 * hasFirstCapture(), включая fail-safe при недоступном localStorage:
 * праздник должен пропасть, а не повториться на каждом захвате.
 *
 * Модуль тянет client_i18n_rt.js, а тот на импорте читает localStorage —
 * поэтому заглушки ставятся до динамического импорта, а не после.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

let storeThrows = false;
const storage = new Map();

globalThis.localStorage = {
  getItem(k) {
    if (storeThrows) throw new Error('приватный режим');
    return storage.has(k) ? storage.get(k) : null;
  },
  setItem(k, v) {
    if (storeThrows) throw new Error('приватный режим');
    storage.set(k, String(v));
  },
  removeItem(k) {
    storage.delete(k);
  }
};

globalThis.document = {
  documentElement: { setAttribute: () => {} },
  querySelectorAll: () => [],
  getElementById: () => null
};

const { FIRST_CAPTURE_KEY, HITSTOP_TIME_SCALE, hasFirstCapture, hitstopLostMs, shakeDirFrom } =
  await import('../public/client_fx_rt.js');
const { fxRt, session, world } = await import('../public/client_store.js');

function setHitstop(from, until) {
  fxRt.hitstop.from = from;
  fxRt.hitstop.until = until;
}

test('без активного hitstop потери нулевые', () => {
  setHitstop(0, 0);
  assert.equal(hitstopLostMs(0, 1000), 0);
});

test('окно целиком внутри hitstop теряет свою долю', () => {
  setHitstop(1000, 1200);
  // 100 мс замедления при множителе 0.15 съедают 85 мс.
  assert.equal(hitstopLostMs(1050, 1150), 100 * (1 - HITSTOP_TIME_SCALE));
});

test('учитывается только пересечение окна с hitstop', () => {
  setHitstop(1000, 1200);
  // Запрос шире hitstop — вычитается ровно длительность hitstop.
  assert.equal(hitstopLostMs(500, 2000), 200 * (1 - HITSTOP_TIME_SCALE));
  // Хвост запроса выходит за конец hitstop.
  assert.equal(hitstopLostMs(1100, 2000), 100 * (1 - HITSTOP_TIME_SCALE));
  // Начало запроса раньше начала hitstop.
  assert.equal(hitstopLostMs(500, 1100), 100 * (1 - HITSTOP_TIME_SCALE));
});

test('окно вне hitstop ничего не теряет', () => {
  setHitstop(1000, 1200);
  assert.equal(hitstopLostMs(1300, 1400), 0);
  assert.equal(hitstopLostMs(500, 900), 0);
  // Касание границы — не пересечение.
  assert.equal(hitstopLostMs(1200, 1400), 0);
});

test('мусор во since считается нулём, а не NaN', () => {
  setHitstop(1000, 1200);
  assert.equal(hitstopLostMs(undefined, 1100), 100 * (1 - HITSTOP_TIME_SCALE));
  assert.equal(hitstopLostMs('нет', 1100), 100 * (1 - HITSTOP_TIME_SCALE));
});

test('первый захват празднуется ровно один раз', () => {
  storeThrows = false;
  storage.delete(FIRST_CAPTURE_KEY);
  assert.equal(hasFirstCapture(), false);
  storage.set(FIRST_CAPTURE_KEY, '1');
  assert.equal(hasFirstCapture(), true);
});

test('недоступное хранилище гасит праздник, а не повторяет его', () => {
  storeThrows = true;
  assert.equal(hasFirstCapture(), true);
  storeThrows = false;
});

test('вектор тряски направлен от события к своей голове', () => {
  session.you = 7;
  world.currPlayers = new Map([[7, { x: 10, y: 20 }]]);
  assert.deepEqual(shakeDirFrom(4, 20), [6, 0]);
  // Событие точно под головой — толкать некуда.
  assert.deepEqual(shakeDirFrom(10, 20), [0, 0]);
  // Своей змейки нет в кадре — тоже некуда.
  world.currPlayers = new Map();
  assert.deepEqual(shakeDirFrom(0, 0), [0, 0]);
});
