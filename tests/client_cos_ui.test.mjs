/*
 * client_cos_ui.js — первый чистый кусок, вынесенный из syncCosmeticsUi()
 * (client.js, ~420 строк): список предметов вкладки и состояния кнопок
 * «Купить»/«Экипировать» отделены от сборки DOM.
 *
 * visibleItems() сверяется с прежней инлайновой логикой (сортировка по цене,
 * фильтр по владению/доступности) на сетке значений — так же, как field-math
 * сверялась формулой со старой геометрией вида (PR #33).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { COSMETICS_MAX_ID, priceOf } from '../public/client_cos_model.js';
import { buyButtonState, equipButtonState, visibleItems } from '../public/client_cos_ui.js';

// Старая инлайновая реализация из syncCosmeticsUi() до выноса — эталон для сверки.
function oldVisibleItems(cat, filter, balance, mask, eq, prices) {
  const order = [];
  for (let id = 0; id <= COSMETICS_MAX_ID; id++) {
    order.push({ id, price: priceOf(cat, id, prices) });
  }
  order.sort((x, y) => x.price - y.price || x.id - y.id);

  const bal = Math.max(0, Math.floor(Number(balance) || 0));
  const items = [];
  for (const entry of order) {
    const { id, price } = entry;
    const owned = (Number(mask) & (1 << id)) !== 0;
    if (filter === 'owned' && !owned) continue;
    if (filter === 'available' && (owned || bal < price)) continue;
    items.push({ id, price, owned, equipped: Number(eq) === id });
  }
  return items;
}

test('visibleItems сверяется со старой сортировкой/фильтрацией на сетке значений', () => {
  const cats = ['frame', 'nameplate', 'seg', 'head', 'capturefx', 'terr', 'death'];
  const filters = ['all', 'owned', 'available'];
  const masks = [0, 0b1, 0b101, 0b11111111];
  const balances = [0, 1, 30, 200, 1000];
  const eqIds = [0, 3, 7];

  for (const cat of cats) {
    for (const filter of filters) {
      for (const mask of masks) {
        for (const balance of balances) {
          for (const eq of eqIds) {
            const got = visibleItems(cat, filter, balance, mask, eq, null, COSMETICS_MAX_ID);
            const want = oldVisibleItems(cat, filter, balance, mask, eq, null);
            assert.deepEqual(
              got.map((x) => ({ id: x.id, price: x.price, owned: x.owned, equipped: x.equipped })),
              want,
              `расхождение для cat=${cat} filter=${filter} mask=${mask} balance=${balance} eq=${eq}`
            );
          }
        }
      }
    }
  }
});

test('visibleItems: базовый вариант (id 0) бесплатный и владение читается из бита маски', () => {
  const items = visibleItems('frame', 'all', 0, 0b1, 0, null, COSMETICS_MAX_ID);
  const base = items.find((x) => x.id === 0);
  assert.equal(base.owned, true);
  assert.equal(base.price, 0);
});

test('visibleItems: фильтр "available" не показывает уже купленные', () => {
  const items = visibleItems('frame', 'available', 1000, 0b1, 0, null, COSMETICS_MAX_ID);
  assert.ok(!items.some((x) => x.id === 0));
});

test('buyButtonState: недостаток валюты не блокирует кнопку, только красит вторичным цветом', () => {
  const s = buyButtonState({ pending: false, online: true, confirmed: true, pendingOtherOp: false, poor: true });
  assert.equal(s.disabled, false);
  assert.equal(s.className, 'btnSecondary');
  assert.equal(s.titleKind, 'need_more');
});

test('buyButtonState: офлайн блокирует кнопку и приоритетнее остальных причин', () => {
  const s = buyButtonState({ pending: false, online: false, confirmed: true, pendingOtherOp: false, poor: true });
  assert.equal(s.disabled, true);
  assert.equal(s.titleKind, 'no_connection');
});

test('buyButtonState: неподтверждённый инвентарь блокирует, если онлайн', () => {
  const s = buyButtonState({ pending: false, online: true, confirmed: false, pendingOtherOp: false, poor: false });
  assert.equal(s.disabled, true);
  assert.equal(s.titleKind, 'unconfirmed_hint');
});

test('buyButtonState: занятая операция по другому предмету тоже блокирует', () => {
  const s = buyButtonState({ pending: false, online: true, confirmed: true, pendingOtherOp: true, poor: false });
  assert.equal(s.disabled, true);
});

test('equipButtonState: надетый небазовый предмет даёт кнопку "снять"', () => {
  const s = equipButtonState({ equipped: true, id: 3 });
  assert.equal(s.kind, 'remove');
  assert.equal(s.className, 'btnSecondary');
  assert.equal(s.disabled, false);
});

test('equipButtonState: базовый вариант нельзя "снять", даже если он надет', () => {
  const s = equipButtonState({ equipped: true, id: 0 });
  assert.equal(s.kind, 'equipped');
  assert.equal(s.disabled, true);
});

test('equipButtonState: ненадетый предмет даёт активную кнопку "надеть"', () => {
  const s = equipButtonState({ equipped: false, id: 5 });
  assert.equal(s.kind, 'wear');
  assert.equal(s.className, 'btnPrimary');
  assert.equal(s.disabled, false);
});
