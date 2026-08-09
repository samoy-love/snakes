/*
 * killfeedDirty — выставляется ровно в одном месте (pushEventFeed), а не
 * вручную следом за каждым pushEventFeed() в отдельных ветках
 * handleStateBinary по kind. Раньше это была парная связка (bumpMatchTabBadge
 * + killfeedDirty = true), написанная руками в 13 ветках — забытая строка
 * ничего не роняла видимо: событие уходило в eventFeed, но экран не
 * перерисовывался до следующего пакета, который дёрнул флаг сам.
 *
 * Тест ловит именно возврат ручной установки флага рядом с kind-веткой —
 * новая ветка протокола, вызывающая pushEventFeed(), получает разметку
 * автоматически и дублировать её незачем.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_JS = readFileSync(join(HERE, '../public/client.js'), 'utf8');

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `не нашли function ${name}() в client.js`);
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

test('killfeedDirty выставляется внутри pushEventFeed', () => {
  const body = functionBody(CLIENT_JS, 'pushEventFeed');
  const matches = body.match(/killfeedDirty\s*=\s*true/g) || [];
  assert.ok(matches.length >= 1, 'pushEventFeed() не выставляет killfeedDirty');
});

test('handleStateBinary() не выставляет killfeedDirty вручную', () => {
  const body = functionBody(CLIENT_JS, 'handleStateBinary');
  const matches = body.match(/killfeedDirty\s*=\s*true/g) || [];
  assert.deepEqual(
    matches,
    [],
    'найдена ручная установка killfeedDirty в ветке по kind — вызовите pushEventFeed(), она делает это сама'
  );
});
