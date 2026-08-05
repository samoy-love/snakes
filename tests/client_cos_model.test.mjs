/*
 * Модель магазина: цены, тиры редкости и владение.
 *
 * Почему это стоит тестов. Здесь считается всё, что игрок видит рядом с
 * кнопкой «Купить»: сколько стоит, какая редкость, сколько уже есть и сколько
 * не хватает. Ошибка тут не роняет страницу — она показывает неверное число
 * там, где игрок принимает решение потратить заработанное.
 *
 * Владение хранится битовой маской (бит id = предмет куплен), id 0 — базовый
 * вариант: он есть у всех и стоит 0.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COSMETICS_CATS,
  COSMETICS_FALLBACK_PRICES,
  COSMETICS_MAX_ID,
  TIER_TOP,
  bitHas,
  cheapestPrice,
  missingFor,
  ownedCountFromMask,
  priceOf,
  tierClass,
  tierOf
} from '../public/client_cos_model.js';

// --- инварианты самих данных -------------------------------------------------

test('у каждой покупаемой категории есть запасной прайс', () => {
  for (const cat of COSMETICS_CATS) {
    assert.ok(Array.isArray(COSMETICS_FALLBACK_PRICES[cat]), `нет прайса для ${cat}`);
  }
});

test('в каждом прайсе ровно COSMETICS_MAX_ID+1 позиций', () => {
  for (const cat of COSMETICS_CATS) {
    assert.equal(
      COSMETICS_FALLBACK_PRICES[cat].length,
      COSMETICS_MAX_ID + 1,
      `${cat}: маска инвентаря — uint8, слотов должно быть ровно 8`
    );
  }
});

test('базовый вариант бесплатен во всех категориях', () => {
  for (const cat of COSMETICS_CATS) {
    assert.equal(COSMETICS_FALLBACK_PRICES[cat][0], 0, `${cat}: id 0 обязан быть бесплатным`);
  }
});

test('титулы не входят в покупаемые категории — они выдаются за ачивку', () => {
  assert.equal(COSMETICS_CATS.includes('title'), false);
});

// --- bitHas ------------------------------------------------------------------

test('bitHas: читает нужный бит', () => {
  //         id: 76543210
  const mask = 0b10010001;
  assert.equal(bitHas(mask, 0), true);
  assert.equal(bitHas(mask, 4), true);
  assert.equal(bitHas(mask, 7), true);
  assert.equal(bitHas(mask, 1), false);
  assert.equal(bitHas(mask, 5), false);
});

test('bitHas: пустая маска — ничего не куплено', () => {
  for (let id = 0; id <= COSMETICS_MAX_ID; id++) {
    assert.equal(bitHas(0, id), false);
  }
});

test('bitHas: отрицательный и заоблачный id не заворачиваются в бит 0', () => {
  // 1 << 32 === 1 в JS: без явной границы id=32 читался бы как id=0,
  // и базовый вариант выглядел бы купленным у всех.
  assert.equal(bitHas(0b1, 32), false);
  assert.equal(bitHas(0b1, 64), false);
  assert.equal(bitHas(0b1, -1), false);
});

test('bitHas: битая маска не роняет', () => {
  for (const bad of [undefined, null, NaN, 'абв', {}]) {
    assert.equal(bitHas(bad, 3), false);
  }
});

// --- ownedCountFromMask ------------------------------------------------------

test('ownedCountFromMask: считает включая базовый', () => {
  assert.equal(ownedCountFromMask(0b1), 1, 'только базовый');
  assert.equal(ownedCountFromMask(0b1011), 3);
  assert.equal(ownedCountFromMask(0b11111111), 8, 'все восемь слотов');
});

test('ownedCountFromMask: биты выше потолка id не считаются', () => {
  // Девятый бит — не предмет: маска инвентаря uint8.
  assert.equal(ownedCountFromMask(0b1_00000000), 0);
});

// --- priceOf: прайс с сервера ------------------------------------------------

test('priceOf: массив цен с сервера имеет приоритет над запасным', () => {
  const prices = { frame: [0, 11, 22, 33, 44, 55, 66, 77] };
  assert.equal(priceOf('frame', 2, prices), 22);
  assert.notEqual(priceOf('frame', 2, prices), COSMETICS_FALLBACK_PRICES.frame[2]);
});

test('priceOf: одно число на категорию — старый формат, базовый остаётся бесплатным', () => {
  const prices = { frame: 90 };
  assert.equal(priceOf('frame', 0, prices), 0, 'иначе игрок «покупает» то, что уже есть');
  assert.equal(priceOf('frame', 1, prices), 90);
  assert.equal(priceOf('frame', 7, prices), 90);
});

test('priceOf: без прайса с сервера берётся запасной', () => {
  assert.equal(priceOf('frame', 1, null), COSMETICS_FALLBACK_PRICES.frame[1]);
  assert.equal(priceOf('terr', 3, undefined), COSMETICS_FALLBACK_PRICES.terr[3]);
});

test('priceOf: отрицательная и нечисловая цена с сервера игнорируется', () => {
  assert.equal(priceOf('frame', 1, { frame: [0, -5, 0, 0, 0, 0, 0, 0] }), COSMETICS_FALLBACK_PRICES.frame[1]);
  assert.equal(priceOf('frame', 1, { frame: [0, 'дорого', 0, 0, 0, 0, 0, 0] }), COSMETICS_FALLBACK_PRICES.frame[1]);
});

test('priceOf: id зажимается в границы, а не уходит за прайс', () => {
  assert.equal(priceOf('frame', 999, null), COSMETICS_FALLBACK_PRICES.frame[COSMETICS_MAX_ID]);
  assert.equal(priceOf('frame', -3, null), COSMETICS_FALLBACK_PRICES.frame[0]);
});

test('priceOf: неизвестная категория деградирует к прайсу рамок, а не к NaN', () => {
  assert.equal(priceOf('такой-категории-нет', 2, null), COSMETICS_FALLBACK_PRICES.frame[2]);
  assert.equal(Number.isFinite(priceOf(undefined, 2, null)), true);
});

// --- tierOf ------------------------------------------------------------------

test('tierOf: границы лестницы редкости', () => {
  assert.equal(tierOf(0), 'base');
  assert.equal(tierOf(1), 'common');
  assert.equal(tierOf(100), 'common');
  assert.equal(tierOf(101), 'rare');
  assert.equal(tierOf(250), 'rare');
  assert.equal(tierOf(251), 'epic');
  assert.equal(tierOf(450), 'epic');
  assert.equal(tierOf(451), 'legendary');
  assert.equal(tierOf(700), 'legendary');
  assert.equal(tierOf(701), TIER_TOP);
});

test('tierOf: отрицательное и нечисло — базовый тир, а не undefined', () => {
  assert.equal(tierOf(-50), 'base');
  assert.equal(tierOf(NaN), 'base');
  assert.equal(tierOf(undefined), 'base');
  assert.equal(tierOf('дорого'), 'base');
});

test('tierOf: у каждого предмета запасного прайса определён тир', () => {
  for (const cat of COSMETICS_CATS) {
    for (const p of COSMETICS_FALLBACK_PRICES[cat]) {
      assert.equal(typeof tierOf(p), 'string');
      assert.notEqual(tierOf(p), '');
    }
  }
});

// --- cheapestPrice -----------------------------------------------------------

test('cheapestPrice: самый дешёвый ПЛАТНЫЙ предмет, бесплатные не считаются', () => {
  const best = cheapestPrice(null);
  assert.ok(best > 0, 'ноль означал бы, что первый скин уже «куплен»');
  // По запасному прайсу дешевле всего рамка за 30.
  assert.equal(best, 30);
});

test('cheapestPrice: учитывает прайс с сервера', () => {
  const prices = {};
  for (const cat of COSMETICS_CATS) prices[cat] = [0, 5, 5, 5, 5, 5, 5, 5];
  assert.equal(cheapestPrice(prices), 5);
});

test('cheapestPrice: если всё бесплатно — возвращает 0, а не Infinity', () => {
  const prices = {};
  for (const cat of COSMETICS_CATS) prices[cat] = [0, 0, 0, 0, 0, 0, 0, 0];
  assert.equal(cheapestPrice(prices), 0);
});

// --- missingFor --------------------------------------------------------------

test('missingFor: сколько ещё копить', () => {
  assert.equal(missingFor(100, 30), 70);
  assert.equal(missingFor(100, 0), 100);
});

test('missingFor: хватает — ноль, а не отрицательное «-40 ✨»', () => {
  assert.equal(missingFor(100, 100), 0);
  assert.equal(missingFor(100, 140), 0);
});

test('missingFor: дробный баланс округляется вверх — «осталось 0» при нехватке недопустимо', () => {
  assert.equal(missingFor(100, 99.5), 1);
});

test('missingFor: битые входы дают конечное неотрицательное число', () => {
  for (const [p, b] of [
    [undefined, undefined],
    [NaN, 10],
    ['абв', 'где']
  ]) {
    const v = missingFor(p, b);
    assert.equal(Number.isFinite(v), true);
    assert.ok(v >= 0);
  }
});

// --- tierClass ---------------------------------------------------------------

test('tierClass: имя CSS-класса из имени тира', () => {
  assert.equal(tierClass('base'), 'tierBase');
  assert.equal(tierClass('common'), 'tierCommon');
  assert.equal(tierClass('rare'), 'tierRare');
  assert.equal(tierClass('epic'), 'tierEpic');
  assert.equal(tierClass('legendary'), 'tierLegendary');
  assert.equal(tierClass('mythic'), 'tierMythic');
});

test('tierClass: пустое и битое имя даёт базовый класс, а не «tierundefined»', () => {
  assert.equal(tierClass(undefined), 'tierBase');
  assert.equal(tierClass(null), 'tierBase');
  assert.equal(tierClass(''), 'tierBase');
});

test('tierClass покрывает все тиры, которые может вернуть tierOf', () => {
  // Если появится новый тир, а класс для него забудут — тест это покажет.
  const seen = new Set();
  for (const price of [0, 50, 150, 300, 500, 900]) seen.add(tierOf(price));
  for (const tier of seen) {
    assert.match(tierClass(tier), /^tier[A-Z]/, `нет класса для тира ${tier}`);
  }
  assert.equal(seen.size, 6, 'ожидаются все шесть ступеней лестницы');
});
