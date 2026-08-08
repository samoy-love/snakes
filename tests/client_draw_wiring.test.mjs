/*
 * draw() — статическая проверка проводки, а не арифметики.
 *
 * #33 вынес геометрию вида в client_field_view.js и заодно удалил локальную
 * const roi = lastRoi (она была нужна для gMinX/gMinY через clampToRoi), но
 * использование `roi` в тумане за пределами ROI (ниже по той же функции)
 * поправить забыли. Юнит-тесты на вынесенные функции (cellSizeFor,
 * visibleBounds, clampToRoi) это не ловят — они зелёные на сломанном коде,
 * потому что сами функции корректны, а сломана проводка ВОКРУГ них: draw()
 * падал на первом же кадре с матчем (ReferenceError: roi is not defined),
 * и всё, что рисуется в функции ПОСЛЕ места падения — миникарта, стрелка на
 * свою зону, часть эффектов — переставало появляться на экране НАВСЕГДА,
 * при этом console.error реально печатался (installErrorLogging его ловит),
 * просто на это никто не смотрел на живом матче.
 *
 * Проверка находит границы function draw() { ... } в исходнике и грепает
 * тело на голый идентификатор `roi` — единственная легитимная форма после
 * #33 это `lastRoi`, `roiGrant`, `roiCaps`, `roiW`, `roiH` (соседние слова,
 * не отдельный токен) или `.roi` (доступ к полю чужого объекта).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_JS = readFileSync(path.join(__dirname, '../public/client.js'), 'utf8');

function extractFunctionBody(source, name) {
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

test('draw() не ссылается на голую переменную roi — только на lastRoi', () => {
  const body = extractFunctionBody(CLIENT_JS, 'draw');

  // Голый токен roi: не .roi (доступ к полю), не часть более длинного слова
  // (lastRoi, roiGrant, roiCaps, roiW, roiH) и не ключ объекта (`roi: lastRoi`
  // в вызове cellSizeFor — легитимное переименование при передаче, не чтение
  // переменной roi).
  const bareRoi = body.match(/(?<![.\w])roi\b(?!\w)(?!\s*:)/g) || [];

  assert.deepEqual(
    bareRoi,
    [],
    `draw() ссылается на необъявленную переменную roi ${bareRoi.length} раз(а) — ` +
      'после #33 локальной "const roi = lastRoi" в функции больше нет, используйте lastRoi'
  );
});
