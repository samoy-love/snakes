/*
 * Состояние косметики: что куплено и что надето.
 *
 * Раньше это были четырнадцать плоских переменных, а доступ по категории —
 * две цепочки из семи `if`, каждая заканчивалась `return youCosEqFrame`.
 * То есть НЕизвестная категория молча получала данные рамок. Именно так
 * вкладка титулов открывалась с выбором, указывающим на id надетой рамки:
 * 'title' не покупается, в цепочке его нет, и она проваливалась в ветку по
 * умолчанию. Первый тест ниже сторожит ровно это.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CAT_SUFFIX,
  COS_STATE_CATS,
  applyCosPayload,
  cosPayloadOf,
  createCosState,
  eqField,
  eqOf,
  equip,
  invField,
  invOf,
  markOwned
} from '../public/client_cos_state.js';

import { COSMETICS_CATS } from '../public/client_cos_model.js';
import { DESIRED_FIELD_BY_CAT } from '../public/client_cos_desired.js';

// --- главная регрессия -------------------------------------------------------

test('неизвестная категория даёт 0, а НЕ данные рамок', () => {
  const st = createCosState();
  st.inv.frame = 0b1111;
  st.eq.frame = 3;

  for (const bad of ['title', 'нетакой', '', undefined, null]) {
    assert.equal(invOf(st, bad), 0, `инвентарь для «${String(bad)}»`);
    assert.equal(eqOf(st, bad), 0, `надетое для «${String(bad)}»`);
  }
});

// --- согласованность с остальными модулями -----------------------------------

test('категории состояния совпадают с покупаемыми категориями магазина', () => {
  assert.deepEqual([...COS_STATE_CATS].sort(), [...COSMETICS_CATS].sort());
});

test('имена полей совпадают с теми, что использует «желаемая» экипировка', () => {
  for (const cat of COS_STATE_CATS) {
    assert.equal(eqField(cat), DESIRED_FIELD_BY_CAT[cat], `поле eq для ${cat}`);
  }
});

test('имена полей выводятся из одного соответствия', () => {
  assert.equal(invField('head'), 'invHead');
  assert.equal(eqField('capturefx'), 'eqCaptureFx');
  assert.equal(invField('нетакой'), '');
  assert.equal(eqField(undefined), '');
});

test('суффиксы не повторяются: две категории не пишутся в одно поле', () => {
  const vals = Object.values(CAT_SUFFIX);
  assert.equal(vals.length, new Set(vals).size);
});

// --- пустое состояние --------------------------------------------------------

test('новое состояние: ничего не куплено, везде базовый вариант', () => {
  const st = createCosState();
  for (const cat of COS_STATE_CATS) {
    assert.equal(invOf(st, cat), 0);
    assert.equal(eqOf(st, cat), 0);
  }
});

// --- applyCosPayload: полный снимок -----------------------------------------

test('replace: категории, которых нет в снимке, обнуляются', () => {
  const st = createCosState();
  st.inv.head = 0b1111;
  st.eq.head = 2;

  applyCosPayload(st, { invSeg: 0b11, eqSeg: 1 }, 'replace');

  assert.equal(invOf(st, 'seg'), 0b11);
  assert.equal(eqOf(st, 'seg'), 1);
  assert.equal(invOf(st, 'head'), 0, 'старое значение обязано уйти: это полный снимок');
  assert.equal(eqOf(st, 'head'), 0);
});

test('patch: трогаем только присланное', () => {
  const st = createCosState();
  st.inv.head = 0b1111;
  st.eq.head = 2;

  applyCosPayload(st, { invTerr: 0b101, eqTerr: 2 }, 'patch');

  assert.equal(invOf(st, 'terr'), 0b101);
  assert.equal(eqOf(st, 'terr'), 2);
  assert.equal(invOf(st, 'head'), 0b1111, 'частичное сообщение не стирает остальное');
  assert.equal(eqOf(st, 'head'), 2);
});

test('patch: явный ноль отличается от отсутствия поля', () => {
  const st = createCosState();
  st.eq.head = 5;
  applyCosPayload(st, { eqHead: 0 }, 'patch');
  assert.equal(eqOf(st, 'head'), 0, 'снять скин — законное действие');
});

test('надетый id зажимается в границы инвентаря', () => {
  const st = createCosState();
  applyCosPayload(st, { eqHead: 99, eqSeg: -5 }, 'replace');
  assert.equal(eqOf(st, 'head'), 7);
  assert.equal(eqOf(st, 'seg'), 0);
});

test('мусор в снимке не даёт NaN', () => {
  const st = createCosState();
  applyCosPayload(st, { invHead: 'абв', eqHead: {} }, 'replace');
  assert.equal(Number.isFinite(invOf(st, 'head')), true);
  assert.equal(Number.isFinite(eqOf(st, 'head')), true);
});

test('пустой payload и null не роняют', () => {
  const st = createCosState();
  assert.doesNotThrow(() => applyCosPayload(st, null));
  assert.doesNotThrow(() => applyCosPayload(null, {}));
});

// --- cosPayloadOf: обратная дорога ------------------------------------------

test('состояние переживает круг «в кэш и обратно»', () => {
  const st = createCosState();
  applyCosPayload(st, { invHead: 0b1011, eqHead: 3, invTerr: 0b1, eqTerr: 0 }, 'replace');

  const restored = applyCosPayload(createCosState(), cosPayloadOf(st), 'replace');

  for (const cat of COS_STATE_CATS) {
    assert.equal(invOf(restored, cat), invOf(st, cat), `inv ${cat}`);
    assert.equal(eqOf(restored, cat), eqOf(st, cat), `eq ${cat}`);
  }
});

test('cosPayloadOf отдаёт поле на каждую категорию', () => {
  const out = cosPayloadOf(createCosState());
  for (const cat of COS_STATE_CATS) {
    assert.ok(invField(cat) in out, `нет ${invField(cat)}`);
    assert.ok(eqField(cat) in out, `нет ${eqField(cat)}`);
  }
});

// --- markOwned / equip -------------------------------------------------------

test('markOwned выставляет бит, не трогая остальные', () => {
  const st = createCosState();
  markOwned(st, 'head', 0);
  markOwned(st, 'head', 3);
  assert.equal(invOf(st, 'head'), 0b1001);
});

test('equip не даёт надеть некупленное — как и сервер', () => {
  const st = createCosState();
  markOwned(st, 'head', 0);
  assert.equal(equip(st, 'head', 4), false, 'предмет не куплен');
  assert.equal(eqOf(st, 'head'), 0);

  markOwned(st, 'head', 4);
  assert.equal(equip(st, 'head', 4), true);
  assert.equal(eqOf(st, 'head'), 4);
});

test('markOwned и equip отвергают неизвестную категорию', () => {
  const st = createCosState();
  assert.equal(markOwned(st, 'title', 1), false);
  assert.equal(equip(st, 'нетакой', 1), false);
});

test('equip базового варианта работает, если он куплен', () => {
  const st = createCosState();
  markOwned(st, 'seg', 0);
  markOwned(st, 'seg', 2);
  equip(st, 'seg', 2);
  assert.equal(equip(st, 'seg', 0), true, 'снять скин — законное действие');
  assert.equal(eqOf(st, 'seg'), 0);
});
