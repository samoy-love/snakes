/*
 * Чат: client_chat.js.
 *
 * Тестируется единственный чистый гейт модуля — getChatCollapsedDefault().
 * Он решает, увидит ли игрок чат при заходе на страницу, и ошибка здесь не
 * падает, а тихо разворачивает панель поверх поля на телефоне (или прячет её
 * у игрока, который её явно раскрыл). Всё остальное в модуле — обвязка над
 * живой разметкой, её проверяют скриншотные тесты.
 *
 * Приоритет сохранённого выбора важнее эвристики размера: раньше значение из
 * localStorage читалось после проверки ширины, и на узком экране явно
 * раскрытый чат всё равно схлопывался при каждой перезагрузке.
 *
 * Модуль на импорте лезет в разметку через client_dom.js, поэтому заглушки
 * document/localStorage/window ставятся ДО динамического импорта. Отсутствующий
 * узел для dom — это null, так что пустого getElementById достаточно.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

let storeRaw = null;
let storeThrows = false;

globalThis.localStorage = {
  getItem: () => {
    if (storeThrows) throw new Error('storage disabled');
    return storeRaw;
  },
  setItem: () => {},
  removeItem: () => {}
};

globalThis.document = {
  getElementById: () => null,
  documentElement: { setAttribute: () => {} },
  querySelectorAll: () => []
};

globalThis.window = { innerWidth: 1920, innerHeight: 1080 };

const { getChatCollapsedDefault } = await import('../public/client_chat.js');

function setScreen(w, h) {
  globalThis.window.innerWidth = w;
  globalThis.window.innerHeight = h;
}

test('сохранённый выбор игрока сильнее размера экрана', () => {
  storeThrows = false;
  setScreen(1920, 1080);
  storeRaw = '1';
  assert.equal(getChatCollapsedDefault(), true);

  setScreen(375, 812);
  storeRaw = '0';
  assert.equal(getChatCollapsedDefault(), false);
});

test('мусор в хранилище не считается выбором', () => {
  storeThrows = false;
  storeRaw = 'yes';
  setScreen(1920, 1080);
  assert.equal(getChatCollapsedDefault(), false);
});

test('без сохранённого выбора решает размер экрана', () => {
  storeThrows = false;
  storeRaw = null;

  setScreen(1920, 1080);
  assert.equal(getChatCollapsedDefault(), false, 'на десктопе чат раскрыт');

  setScreen(375, 812);
  assert.equal(getChatCollapsedDefault(), true, 'узкий экран — свёрнут');

  setScreen(1400, 820);
  assert.equal(getChatCollapsedDefault(), true, 'граница «низкого» окна включительно');

  setScreen(1401, 820);
  assert.equal(getChatCollapsedDefault(), false, 'за границей по ширине — раскрыт');

  setScreen(720, 1200);
  assert.equal(getChatCollapsedDefault(), true, 'ширина 720 сворачивает при любой высоте');
});

test('сломанное хранилище не роняет старт, а падает в эвристику', () => {
  storeThrows = true;
  setScreen(1920, 1080);
  assert.equal(getChatCollapsedDefault(), false);
  setScreen(375, 812);
  assert.equal(getChatCollapsedDefault(), true);
  storeThrows = false;
});
