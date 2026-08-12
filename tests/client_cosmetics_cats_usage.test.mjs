/*
 * Категория косметики -> подпись/превью — раньше четыре независимых
 * цепочки if в client.js (cosmeticsLabel, cosmeticsVariantName,
 * drawMiniCosmeticPreview, drawCosmeticsScene) описывали один и тот же
 * набор из 8 категорий. Добавление новой категории требовало правки в
 * четырёх местах, и забыть одно из них ничего не роняло — просто вместо
 * нужной подписи/иконки бралась заглушка соседней категории или дефолт.
 *
 * cosmeticsLabel/cosmeticsVariantName/drawMiniCosmeticPreview теперь читают
 * COSMETICS_CATS-таблицы вместо цепочек if. Этот тест — статическая
 * проверка (client.js не импортируется напрямую: верхний уровень модуля
 * трогает DOM), что каждая из трёх таблиц перечисляет все категории.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { COSMETICS_CATS } from '../public/client_cos_model.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// MINI_COSMETIC_PREVIEW_BY_CAT переехала в client_shop_ui.js, а таблицы
// подписей и названий вариантов — в client_shop.js вместе с остальной
// обвязкой магазина. Таблицы ищем во всех трёх файлах.
const CLIENT_JS =
  readFileSync(join(HERE, '../public/client.js'), 'utf8') +
  '\n' +
  readFileSync(join(HERE, '../public/client_shop.js'), 'utf8') +
  '\n' +
  readFileSync(join(HERE, '../public/client_shop_ui.js'), 'utf8');

const ALL_TABS = [...COSMETICS_CATS, 'title'];

function objectLiteralBody(source, constName) {
  const marker = `const ${constName} = {`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `не нашли ${constName} в исходниках клиента`);
  const braceStart = start + marker.length - 1;
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  throw new Error(`не нашли конец ${constName}`);
}

/**
 * Верхнеуровневые ключи объектного литерала. Записи разделены запятыми на
 * глубине 1, имя — первый идентификатор перед `:` (обычное свойство) или
 * `(` (метод-шорткат вроде `frame(c, opts) { ... }`).
 */
function topLevelKeys(objectSource) {
  const keys = [];
  // Строчные комментарии могут содержать запятые («…геометрии, не в
  // цвете.») — считать глубину/разделители по ним нельзя. Гасим их до
  // конца строки, сохраняя переносы, чтобы позиции остального текста не
  // сдвинулись.
  const inner = objectSource
    .slice(1, -1)
    .replace(/\/\/[^\n]*/g, '');
  let d = 0;
  let entryStart = 0;
  const entries = [];
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '{' || ch === '(' || ch === '[') d++;
    else if (ch === '}' || ch === ')' || ch === ']') d--;
    else if (ch === ',' && d === 0) {
      entries.push(inner.slice(entryStart, i));
      entryStart = i + 1;
    }
  }
  entries.push(inner.slice(entryStart));
  for (const entry of entries) {
    const m = entry.match(/^\s*([A-Za-z_$][\w$]*)\s*[:(]/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

for (const [constName, tabs] of [
  ['COSMETICS_LABEL_KEY_BY_CAT', ALL_TABS],
  ['COSMETICS_VARIANT_NAMES_BY_CAT', COSMETICS_CATS],
  ['MINI_COSMETIC_PREVIEW_BY_CAT', ALL_TABS]
]) {
  test(`${constName} перечисляет все категории косметики`, () => {
    const keys = topLevelKeys(objectLiteralBody(CLIENT_JS, constName));
    const missing = tabs.filter((cat) => !keys.includes(cat));
    assert.deepEqual(missing, [], `${constName} не описывает категории: ${missing.join(', ')}`);
  });
}
