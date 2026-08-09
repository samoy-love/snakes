/*
 * Тир -> CSS-класс — одна функция (tierClass, client_cos_model.js), а не
 * строка, вписанная руками. Лестница редкости уже один раз не рисовалась
 * из-за этого класса ошибки (см. комментарий в tierClass) — карточка и
 * разделитель групп были склеены раздельно, и один из двух забыли.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_JS = readFileSync(join(HERE, '../public/client.js'), 'utf8');

test('client.js не вписывает класс tierXxx строкой руками', () => {
  const manualTierClass = /['"`]\s*tier[A-Z]\w*['"`]/g;
  const matches = CLIENT_JS.match(manualTierClass) || [];
  assert.deepEqual(
    matches,
    [],
    `найден захардкоженный класс тира (${matches.join(', ')}) — используйте tierClass() из client_cos_model.js`
  );
});
