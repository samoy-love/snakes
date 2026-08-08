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
 * Проверка общая, а не про конкретное имя `roi`: tests/helpers/js_scope.mjs
 * статически (без исполнения кода и без парсера — см. его шапку про
 * компромиссы) находит любой идентификатор, который draw() читает, но
 * который не объявлен ни внутри draw(), ни на верхнем уровне client.js, ни
 * является известным глобалом браузера/JS. Значит эта проверка поймает
 * любой будущий рефакторинг того же класса — не только повторную порчу roi.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { maskNonCode, extractDeclared, unknownIdentifiers } from './helpers/js_scope.mjs';

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

test('draw() не читает идентификаторы, которых нет ни в её теле, ни на верхнем уровне client.js', () => {
  const masked = maskNonCode(CLIENT_JS);
  const drawBody = extractFunctionBody(masked, 'draw');

  // Верхний уровень client.js — то, что draw() видит через замыкание:
  // импорты, module-scope const/let/var/function. draw() объявлена на
  // верхнем уровне (не вложена), поэтому её доступная внешняя область — ровно
  // это множество плюс имена, объявленные внутри самой draw().
  const topLevel = extractDeclared(masked);

  const unknown = unknownIdentifiers(drawBody, [...topLevel]);

  assert.deepEqual(
    unknown,
    [],
    `draw() читает необъявленные идентификаторы: ${unknown.join(', ')} — ` +
      'скорее всего рефакторинг переименовал/вынес переменную и забыл поправить дальнее использование ' +
      '(баг такого рода на 98d7a2b: `roi` вместо `lastRoi`)'
  );
});

// syncCosmeticsUi() — тот же класс риска, что и draw() (§7 отчёта разведки от
// 2026-08-05): распил на первые чистые куски (buyButtonState, equipButtonState,
// visibleItems, renderCosmeticsSkeleton) должен оставить проводку вокруг них
// целой — вынесенная переменная, использование которой забыли поправить дальше
// по функции, ломает магазин так же тихо, как #33 сломал draw().
test('syncCosmeticsUi() не читает идентификаторы, которых нет ни в её теле, ни на верхнем уровне client.js', () => {
  const masked = maskNonCode(CLIENT_JS);
  const body = extractFunctionBody(masked, 'syncCosmeticsUi');
  const topLevel = extractDeclared(masked);

  const unknown = unknownIdentifiers(body, [...topLevel]);

  assert.deepEqual(
    unknown,
    [],
    `syncCosmeticsUi() читает необъявленные идентификаторы: ${unknown.join(', ')}`
  );
});

test('renderCosmeticsSkeleton() не читает идентификаторы, которых нет ни в её теле, ни на верхнем уровне client.js', () => {
  const masked = maskNonCode(CLIENT_JS);
  const body = extractFunctionBody(masked, 'renderCosmeticsSkeleton');
  const topLevel = extractDeclared(masked);

  const unknown = unknownIdentifiers(body, [...topLevel]);

  assert.deepEqual(
    unknown,
    [],
    `renderCosmeticsSkeleton() читает необъявленные идентификаторы: ${unknown.join(', ')}`
  );
});

// handleStateBinary() — тот же класс риска: единый курсор чтения буфера `o`
// двигается вручную по всей функции (§6.4 отчёта разведки от 2026-08-05),
// и вынос куска вроде pickPlayerRecordSize должен оставить обвязку вокруг
// него (o, bl, pc, DIR_NAMES и т.д.) нетронутой.
test('handleStateBinary() не читает идентификаторы, которых нет ни в её теле, ни на верхнем уровне client.js', () => {
  const masked = maskNonCode(CLIENT_JS);
  const body = extractFunctionBody(masked, 'handleStateBinary');
  const topLevel = extractDeclared(masked);

  const unknown = unknownIdentifiers(body, [...topLevel]);

  assert.deepEqual(
    unknown,
    [],
    `handleStateBinary() читает необъявленные идентификаторы: ${unknown.join(', ')}`
  );
});
