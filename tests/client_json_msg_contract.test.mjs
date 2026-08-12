/*
 * Контракт «сервер → клиент» для JSON-сообщений.
 *
 * Бинарный протокол уже сверяется с эталоном (client_contract.test.mjs), а
 * JSON-сообщения не проверял никто: диспетчер клиента — это цепочка
 * `else if (t === '...')` по строковым литералам, и опечатка в литерале не
 * ломает ничего видимого. Сообщение просто проваливается в конец цепочки и
 * молча теряется.
 *
 * Ровно это и случилось при переносе состояния в client_store.js: массовое
 * переименование `matchPhase` -> `match.phase` зацепило СТРОКОВЫЙ ЛИТЕРАЛ в
 * диспетчере, и ветка стала `t === 'match.phase'`. Сервер продолжал слать
 * "matchPhase" (internal/game/room.go), клиент перестал его слышать — арка
 * матча (смена фаз, баннер «ФИНАЛ ×2», удвоение очков за захват в финале)
 * тихо выключилась. Ни один тест этого не заметил: юнит-тесты не трогают
 * диспетчер, а визуальные снимают экраны до наступления финальной фазы.
 *
 * Проверка идёт в обе стороны:
 *   - каждый тип, который сервер шлёт, у клиента разбирается;
 *   - каждый тип, который клиент разбирает, сервер действительно шлёт
 *     (иначе это мёртвая ветка — след переименования на сервере).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

/* Go-исходники сервера: рекурсивно internal/ плюс корневые *.go. */
function goSources(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) goSources(full, acc);
    else if (name.endsWith('.go')) acc.push(readFileSync(full, 'utf8'));
  }
  return acc;
}

const GO = [
  ...goSources(path.join(ROOT, 'internal')),
  ...readdirSync(ROOT)
    .filter((f) => f.endsWith('.go'))
    .map((f) => readFileSync(path.join(ROOT, f), 'utf8'))
].join('\n');

/* Клиент склеивается целиком: диспетчер может переехать в другой модуль, и
   тест не должен от этого позеленеть впустую. */
const CLIENT = readdirSync(path.join(ROOT, 'public'))
  .filter((f) => /^client.*\.js$/.test(f))
  .map((f) => readFileSync(path.join(ROOT, 'public', f), 'utf8'))
  .join('\n');

/* Тип сообщения — второй аргумент отправляющих функций сервера.
   Поиск намеренно ограничен одной строкой ([^"\n]*): без запрета на перевод
   строки регексп проскакивал вызов без литерала и цеплял первое попавшееся
   слово в кавычках ниже по файлу — например «free» из комментария
   `// Prefer "free" space` в room.go. */
function serverMessageTypes() {
  const out = new Set();
  const re = /(?:broadcastJSON|sendJSON|writeJSON|pushJSON)\s*\([^"\n]*"([a-zA-Z]+)"/g;
  for (const m of GO.matchAll(re)) out.add(m[1]);
  return out;
}

/* Ветки диспетчера клиента. */
function clientHandledTypes() {
  const out = new Set();
  for (const m of CLIENT.matchAll(/\bt === '([a-zA-Z]+)'/g)) out.add(m[1]);
  return out;
}

/* Служебные сравнения того же вида, но не про протокол: typeof x === 'number'
   и разбор вкладок правой колонки. Держим списком, чтобы новая ветка
   диспетчера не смогла спрятаться за «наверное, это тоже служебное». */
const NOT_PROTOCOL = new Set(['number', 'string', 'object', 'function', 'boolean', 'undefined', 'match', 'team', 'chat']);

test('каждый JSON-тип, который шлёт сервер, разбирается клиентом', () => {
  const server = serverMessageTypes();
  const client = clientHandledTypes();

  assert.ok(server.size >= 10, `подозрительно мало типов у сервера (${server.size}) — сломался разбор Go-исходников`);

  const missing = [...server].filter((t) => !client.has(t)).sort();
  assert.deepEqual(
    missing,
    [],
    `сервер шлёт эти типы, а клиент их не слушает: ${missing.join(', ')} — ` +
      'сообщение молча проваливается в конец цепочки else if и теряется целиком'
  );
});

test('клиент не разбирает JSON-типов, которых сервер не шлёт', () => {
  const server = serverMessageTypes();
  const client = clientHandledTypes();

  const dead = [...client].filter((t) => !server.has(t) && !NOT_PROTOCOL.has(t)).sort();
  assert.deepEqual(
    dead,
    [],
    `клиент слушает типы, которых сервер не отправляет: ${dead.join(', ')} — ` +
      'мёртвая ветка: либо опечатка в литерале, либо тип переименовали на сервере'
  );
});
