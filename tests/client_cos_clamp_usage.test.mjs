/*
 * Зажим id косметики в 0..7 — одна функция (cosClampId, client_cos_draw.js),
 * а не переписанная руками формула в каждом месте, где нужен безопасный id.
 *
 * Раньше `Math.max(0, Math.min(7, ...))` было расписано вручную в шести
 * местах client.js рядом с местами, уже вызывающими cosClampId — новая
 * категория id (например расширение диапазона) требовала бы правки во всех
 * копиях сразу, и половину из них легко забыть. Тест ловит именно возврат
 * такой копии, а не конкретную старую строку.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_JS = readFileSync(join(HERE, '../public/client.js'), 'utf8');

test('client.js не переписывает формулу cosClampId руками', () => {
  // Единственное легитимное совпадение — темп спавна частиц по dt (не id
  // косметики), диапазон 0..7 у него общий с cosClampId чисто случайно.
  const manualClamp = /Math\.max\(0,\s*Math\.min\(7,\s*([^)]*)/g;
  const offenders = [];
  for (const m of CLIENT_JS.matchAll(manualClamp)) {
    if (!m[1].startsWith('Math.round')) offenders.push(m[0]);
  }
  assert.deepEqual(
    offenders,
    [],
    `найдена ручная копия зажима 0..7 (${offenders.length}) — используйте cosClampId() из client_cos_draw.js`
  );
});

test('client.js импортирует cosClampId', () => {
  assert.match(CLIENT_JS, /\bcosClampId\b[\s\S]*from ['"]\.\/client_cos_draw\.js['"]/);
});
