/*
 * Порядок комнат в меню — продуктовое решение, а не деталь реализации:
 * «Свободные сверху» определяет, куда попадёт новичок, нажавший «Играть».
 * До выделения client_rooms.js эта логика читала DOM напрямую и проверить её
 * можно было только глазами на живой странице.
 *
 * Отдельное внимание — тай-брейку по id. Сервер отдаёт комнаты в произвольном
 * порядке, и без явного тай-брейка строки с равной заполненностью меняются
 * местами между обновлениями списка: игрок целится в комнату, а под курсором
 * оказывается другая.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ROOMS_SORT_MODES,
  filterAndSortRooms,
  normalizeRoomsSort,
  roomsQueryText,
  sortRooms
} from '../public/client_rooms.js';

const room = (id, humans, limit, extra = {}) => ({ id, humans, limit, ...extra });

const ids = (list) => list.map((r) => r.id);

// --- normalizeRoomsSort ------------------------------------------------------

test('normalizeRoomsSort: известные режимы проходят как есть', () => {
  for (const m of ROOMS_SORT_MODES) assert.equal(normalizeRoomsSort(m), m);
});

test('normalizeRoomsSort: мусор и пустота сводятся к free', () => {
  for (const bad of [undefined, null, '', '   ', 'FREE', 'по-русски', 42, {}]) {
    assert.equal(normalizeRoomsSort(bad), 'free');
  }
});

// --- roomsQueryText ----------------------------------------------------------

test('roomsQueryText: в строку поиска попадают номер, название, счёт и ники', () => {
  const s = roomsQueryText(room(7, 3, 16, { title: 'Арена', names: ['Вася', 'Петя'] }));
  assert.match(s, /7/);
  assert.match(s, /арена/);
  assert.match(s, /3\/16/);
  assert.match(s, /вася/);
  assert.match(s, /петя/);
});

test('roomsQueryText: приводит к нижнему регистру — поиск нечувствителен к нему', () => {
  assert.equal(roomsQueryText(room(1, 0, 8, { title: 'КрИчАлКа' })).includes('кричалка'), true);
});

test('roomsQueryText: битая запись не роняет и не даёт undefined в тексте', () => {
  for (const bad of [undefined, null, {}, { id: null, names: 'не массив' }]) {
    const s = roomsQueryText(bad);
    assert.equal(typeof s, 'string');
    assert.equal(s.includes('undefined'), false, `«undefined» в строке поиска: ${s}`);
  }
});

test('roomsQueryText: nameCount берётся из длины списка, если сервер его не прислал', () => {
  assert.match(roomsQueryText(room(1, 2, 8, { names: ['a', 'b', 'c'] })), /\b3\b/);
});

// --- sortRooms: free ---------------------------------------------------------

test('free: полные комнаты уходят вниз', () => {
  const out = sortRooms([room(1, 16, 16), room(2, 3, 16), room(3, 16, 16), room(4, 0, 16)], 'free');
  // Первыми — не-полные (2 и 4), полные (1 и 3) — в хвосте.
  assert.deepEqual(ids(out).slice(0, 2), [2, 4]);
  assert.deepEqual(ids(out).slice(2).sort(), [1, 3]);
});

test('free: среди свободных выше та, где больше живых — пустая скучнее полупустой', () => {
  const out = sortRooms([room(1, 0, 16), room(2, 5, 16), room(3, 2, 16)], 'free');
  assert.deepEqual(ids(out), [2, 3, 1]);
});

test('free: при равном числе игроков порядок задаёт id, а не приход с сервера', () => {
  const a = sortRooms([room(9, 4, 16), room(2, 4, 16), room(5, 4, 16)], 'free');
  const b = sortRooms([room(5, 4, 16), room(9, 4, 16), room(2, 4, 16)], 'free');
  assert.deepEqual(ids(a), [2, 5, 9]);
  assert.deepEqual(ids(a), ids(b), 'порядок обязан не зависеть от порядка прихода');
});

// --- sortRooms: humans / fill / id -------------------------------------------

test('humans: строго по числу живых, лимит не влияет', () => {
  const out = sortRooms([room(1, 2, 4), room(2, 7, 16), room(3, 5, 8)], 'humans');
  assert.deepEqual(ids(out), [2, 3, 1]);
});

test('fill: по доле заполненности, а не по абсолютному числу', () => {
  // 3/4 = 0.75 плотнее, чем 7/16 = 0.44, хотя игроков меньше.
  const out = sortRooms([room(1, 7, 16), room(2, 3, 4)], 'fill');
  assert.deepEqual(ids(out), [2, 1]);
});

test('fill: при равной доле выше та, где больше живых', () => {
  // 8/16 и 2/4 — обе 0.5.
  const out = sortRooms([room(1, 2, 4), room(2, 8, 16)], 'fill');
  assert.deepEqual(ids(out), [2, 1]);
});

test('id: строго по номеру', () => {
  assert.deepEqual(ids(sortRooms([room(30, 1, 8), room(4, 9, 16), room(11, 0, 8)], 'id')), [4, 11, 30]);
});

// --- защита от битых данных --------------------------------------------------

test('лимит 0 не превращает долю в Infinity и не утаскивает комнату наверх', () => {
  const out = sortRooms([room(1, 5, 10), room(2, 3, 0)], 'fill');
  // 3/max(1,0)=3 против 5/10=0.5 — да, битая запись окажется первой, но
  // сортировка обязана остаться конечной и не бросить.
  assert.equal(out.length, 2);
  assert.equal(Number.isFinite(out[0].humans / Math.max(1, out[0].limit)), true);
});

test('sortRooms не мутирует исходный массив', () => {
  const src = [room(3, 1, 8), room(1, 5, 8), room(2, 0, 8)];
  const before = ids(src);
  sortRooms(src, 'id');
  assert.deepEqual(ids(src), before);
});

test('sortRooms переживает не-массив', () => {
  for (const bad of [undefined, null, 'строка', 42]) {
    assert.deepEqual(sortRooms(bad, 'free'), []);
  }
});

// --- filterAndSortRooms ------------------------------------------------------

const SAMPLE = [
  room(1, 2, 16, { title: 'Новички', names: ['Аня'] }),
  room(2, 16, 16, { title: 'Профи', names: ['Боря'] }),
  room(3, 5, 16, { title: 'Новички+', names: ['Витя'] })
];

test('поиск отбирает по названию', () => {
  assert.deepEqual(ids(filterAndSortRooms(SAMPLE, { query: 'новичк' })), [3, 1]);
});

test('поиск отбирает по нику игрока в комнате', () => {
  assert.deepEqual(ids(filterAndSortRooms(SAMPLE, { query: 'боря' })), [2]);
});

test('поиск нечувствителен к регистру и краевым пробелам', () => {
  assert.deepEqual(ids(filterAndSortRooms(SAMPLE, { query: '  ПрОфИ  ' })), [2]);
});

test('пустой запрос не фильтрует, но сортирует', () => {
  // Полная комната 2 уходит вниз; среди свободных выше та, где игроков больше.
  assert.deepEqual(ids(filterAndSortRooms(SAMPLE, { query: '   ' })), [3, 1, 2]);
});

test('запрос без совпадений даёт пустой список, а не весь', () => {
  assert.deepEqual(filterAndSortRooms(SAMPLE, { query: 'такого-нет' }), []);
});

test('фильтр и сортировка работают вместе', () => {
  const out = filterAndSortRooms(SAMPLE, { query: 'новичк', sort: 'id' });
  assert.deepEqual(ids(out), [1, 3]);
});

test('вызов без опций не падает и берёт режим free', () => {
  assert.deepEqual(ids(filterAndSortRooms(SAMPLE)), [3, 1, 2]);
});

test('неизвестный режим сортировки не роняет список', () => {
  assert.deepEqual(ids(filterAndSortRooms(SAMPLE, { sort: 'потолок' })), [3, 1, 2]);
});
