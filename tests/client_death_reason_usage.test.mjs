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
// Тексты причин смерти уехали из client.js в client_labels.js — сторож едет за ними.
const LABELS_JS = readFileSync(join(HERE, '../public/client_labels.js'), 'utf8');

test('клиент не хранит собственную цепочку reason === N -> death.reason.*', () => {
  const manualChain = /reason\s*===\s*[1-4][\s\S]{0,40}\?\s*t\(['"]death\.reason\./g;
  for (const [name, src] of [['client.js', CLIENT_JS], ['client_labels.js', LABELS_JS]]) {
    assert.deepEqual(
      src.match(manualChain) || [],
      [],
      `${name}: найдена ручная цепочка причин смерти — используйте deathReasonSuffix()/deathReasonLabel() из client_death.js`
    );
  }
});

test('client_labels.js импортирует DEATH_REASON/deathReasonSuffix из client_death.js', () => {
  assert.match(LABELS_JS, /from ['"]\.\/client_death\.js['"]/);
});
