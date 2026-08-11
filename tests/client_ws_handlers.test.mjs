/*
 * handlePlayersMessage() — вынесена из handleStateBinary() (msgType === 2,
 * ROI/players) в public/client_ws_handlers.js. Тот же класс риска, что и
 * handleStateBinary() в client.js: единый курсор буфера `o` двигается
 * вручную, и вынос должен оставить обвязку вокруг него нетронутой. Функция
 * принимает зависимости через ctx-объект, поэтому её верхний уровень —
 * собственный (client_ws_handlers.js), а поля ctx.foo — часть контракта
 * функции, не скрытая проводка через замыкание.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { maskNonCode, extractDeclared, unknownIdentifiers } from './helpers/js_scope.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_WS_HANDLERS_JS = readFileSync(path.join(__dirname, '../public/client_ws_handlers.js'), 'utf8');

function extractFunctionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `не нашли function ${name}() в client_ws_handlers.js`);
  let depth = 0;
  let bodyStart = -1;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') {
      if (depth === 0) bodyStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(bodyStart, i + 1);
    }
  }
  throw new Error(`не нашли конец function ${name}()`);
}

test('handlePlayersMessage() не читает идентификаторы, которых нет ни в её теле, ни на верхнем уровне client_ws_handlers.js', () => {
  const masked = maskNonCode(CLIENT_WS_HANDLERS_JS);
  const body = extractFunctionBody(masked, 'handlePlayersMessage');
  const topLevel = extractDeclared(masked);

  const unknown = unknownIdentifiers(body, [...topLevel]);

  assert.deepEqual(
    unknown,
    [],
    `handlePlayersMessage() читает необъявленные идентификаторы: ${unknown.join(', ')}`
  );
});
