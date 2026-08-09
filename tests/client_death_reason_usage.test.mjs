/*
 * Нумерация причин смерти (1..4) — одно место (client_death.js), а не три
 * независимые цепочки reason === N внутри client.js (разбор бинарного
 * пакета, deathReasonText, deathReasonHint).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_JS = readFileSync(join(HERE, '../public/client.js'), 'utf8');

test('client.js не хранит собственную цепочку reason === N -> death.reason.*', () => {
  const manualChain = /reason\s*===\s*[1-4][\s\S]{0,40}\?\s*t\(['"]death\.reason\./g;
  const matches = CLIENT_JS.match(manualChain) || [];
  assert.deepEqual(
    matches,
    [],
    'найдена ручная цепочка причин смерти — используйте deathReasonSuffix()/deathReasonLabel() из client_death.js'
  );
});

test('client.js импортирует DEATH_REASON/deathReasonSuffix из client_death.js', () => {
  assert.match(CLIENT_JS, /from ['"]\.\/client_death\.js['"]/);
});
