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
const CLIENT_SHOP_UI_JS = readFileSync(path.join(__dirname, '../public/client_shop_ui.js'), 'utf8');
const CLIENT_DRAW_JS = readFileSync(path.join(__dirname, '../public/client_draw.js'), 'utf8');
const CLIENT_ROOMS_UI_JS = readFileSync(path.join(__dirname, '../public/client_rooms_ui.js'), 'utf8');
const CLIENT_MATCH_JS = readFileSync(path.join(__dirname, '../public/client_match.js'), 'utf8');
const CLIENT_INPUT_JS = readFileSync(path.join(__dirname, '../public/client_input.js'), 'utf8');

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

// Фаза 4.2: DOM-обвязка магазина (в т.ч. renderCosmeticsSkeletonImpl) переехала
// в client_shop_ui.js — проверка идёт по её собственному верхнему уровню.
test('renderCosmeticsSkeletonImpl() не читает идентификаторы, которых нет ни в её теле, ни на верхнем уровне client_shop_ui.js', () => {
  const masked = maskNonCode(CLIENT_SHOP_UI_JS);
  const body = extractFunctionBody(masked, 'renderCosmeticsSkeletonImpl');
  const topLevel = extractDeclared(masked);

  const unknown = unknownIdentifiers(body, [...topLevel]);

  assert.deepEqual(
    unknown,
    [],
    `renderCosmeticsSkeletonImpl() читает необъявленные идентификаторы: ${unknown.join(', ')}`
  );
});

// renderCosmeticsTitlesImpl() — раздел «Титулы» магазина косметики, вынесен
// из client.js вместе с остальной DOM-обвязкой магазина (renderCosmeticsTitles
// в client.js теперь тонкая обёртка над этой функцией с deps).
test('renderCosmeticsTitlesImpl() не читает идентификаторы, которых нет ни в её теле, ни на верхнем уровне client_shop_ui.js', () => {
  const masked = maskNonCode(CLIENT_SHOP_UI_JS);
  const body = extractFunctionBody(masked, 'renderCosmeticsTitlesImpl');
  const topLevel = extractDeclared(masked);

  const unknown = unknownIdentifiers(body, [...topLevel]);

  assert.deepEqual(
    unknown,
    [],
    `renderCosmeticsTitlesImpl() читает необъявленные идентификаторы: ${unknown.join(', ')}`
  );
});

// computeDrawCamera() — вынесена из draw() (§ шаг «Камера/зум/screenBounds»).
// Живёт в своём файле и не тянет ничего из client.js через замыкание — все
// значения приходят параметром deps, поэтому её верхний уровень собственный.
test('computeDrawCamera() не читает идентификаторы, которых нет ни в её теле, ни на верхнем уровне client_draw.js', () => {
  const masked = maskNonCode(CLIENT_DRAW_JS);
  const body = extractFunctionBody(masked, 'computeDrawCamera');
  const topLevel = extractDeclared(masked);

  const unknown = unknownIdentifiers(body, [...topLevel]);

  assert.deepEqual(
    unknown,
    [],
    `computeDrawCamera() читает необъявленные идентификаторы: ${unknown.join(', ')}`
  );
});

// paintTerrain() — вынесена из draw() (§ шаг «Отрисовка сетки/территорий»).
// Как и computeDrawCamera(), не тянет ничего из client.js через замыкание —
// всё приходит параметром deps, поэтому её верхний уровень собственный.
test('paintTerrain() не читает идентификаторы, которых нет ни в её теле, ни на верхнем уровне client_draw.js', () => {
  const masked = maskNonCode(CLIENT_DRAW_JS);
  const body = extractFunctionBody(masked, 'paintTerrain');
  const topLevel = extractDeclared(masked);

  const unknown = unknownIdentifiers(body, [...topLevel]);

  assert.deepEqual(
    unknown,
    [],
    `paintTerrain() читает необъявленные идентификаторы: ${unknown.join(', ')}`
  );
});

// paintEntities() — вынесена из draw() (§ шаг «Отрисовка игроков/следов/
// меток»). Как и computeDrawCamera()/paintTerrain(), не тянет ничего из
// client.js через замыкание — всё приходит параметром state, поэтому её
// верхний уровень собственный.
test('paintEntities() не читает идентификаторы, которых нет ни в её теле, ни на верхнем уровне client_draw.js', () => {
  const masked = maskNonCode(CLIENT_DRAW_JS);
  const body = extractFunctionBody(masked, 'paintEntities');
  const topLevel = extractDeclared(masked);

  const unknown = unknownIdentifiers(body, [...topLevel]);

  assert.deepEqual(
    unknown,
    [],
    `paintEntities() читает необъявленные идентификаторы: ${unknown.join(', ')}`
  );
});

// paintFieldFx() — вынесена из draw() (§ шаг «Отрисовка FX-частиц/вспышек
// поверх поля»). Как и computeDrawCamera()/paintTerrain()/paintEntities(), не
// тянет ничего из client.js через замыкание — всё приходит параметром deps,
// поэтому её верхний уровень собственный.
test('paintFieldFx() не читает идентификаторы, которых нет ни в её теле, ни на верхнем уровне client_draw.js', () => {
  const masked = maskNonCode(CLIENT_DRAW_JS);
  const body = extractFunctionBody(masked, 'paintFieldFx');
  const topLevel = extractDeclared(masked);

  const unknown = unknownIdentifiers(body, [...topLevel]);

  assert.deepEqual(
    unknown,
    [],
    `paintFieldFx() читает необъявленные идентификаторы: ${unknown.join(', ')}`
  );
});

// paintPowerUps() — вынесена из draw() (§ шаг «Отрисовка пауэрапов поля»).
// Как и остальные paint*() этого файла, не тянет ничего из client.js через
// замыкание — powerUps/approxNowTick/OFFSCREEN_MARGIN_CELLS приходят deps.
test('paintPowerUps() не читает идентификаторы, которых нет ни в её теле, ни на верхнем уровне client_draw.js', () => {
  const masked = maskNonCode(CLIENT_DRAW_JS);
  const body = extractFunctionBody(masked, 'paintPowerUps');
  const topLevel = extractDeclared(masked);

  const unknown = unknownIdentifiers(body, [...topLevel]);

  assert.deepEqual(
    unknown,
    [],
    `paintPowerUps() читает необъявленные идентификаторы: ${unknown.join(', ')}`
  );
});

// paintBursts() — вынесена из draw() (§ шаг «Отрисовка всплесков fxBursts»).
// Как и остальные paint*() этого файла, не тянет ничего из client.js через
// замыкание — bursts/цвета/хелперы рисования приходят deps.
test('paintBursts() не читает идентификаторы, которых нет ни в её теле, ни на верхнем уровне client_draw.js', () => {
  const masked = maskNonCode(CLIENT_DRAW_JS);
  const body = extractFunctionBody(masked, 'paintBursts');
  const topLevel = extractDeclared(masked);

  const unknown = unknownIdentifiers(body, [...topLevel]);

  assert.deepEqual(
    unknown,
    [],
    `paintBursts() читает необъявленные идентификаторы: ${unknown.join(', ')}`
  );
});

// renderPerfPanel() — вынесена из конца draw() (§ шаг «Панель #perf в конце
// draw()»). Как и остальные функции этого файла, не тянет ничего из
// client.js через замыкание — метрики и t() приходят параметрами.
test('renderPerfPanel() не читает идентификаторы, которых нет ни в её теле, ни на верхнем уровне client_draw.js', () => {
  const masked = maskNonCode(CLIENT_DRAW_JS);
  const body = extractFunctionBody(masked, 'renderPerfPanel');
  const topLevel = extractDeclared(masked);

  const unknown = unknownIdentifiers(body, [...topLevel]);

  assert.deepEqual(
    unknown,
    [],
    `renderPerfPanel() читает необъявленные идентификаторы: ${unknown.join(', ')}`
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

// updateRoomsUi() и связанная orchestration-логика панели «Комнаты» переехали
// в client_rooms_ui.js (updateRoomsUiImpl и т.д.) — тот же класс риска, что и
// draw()/syncCosmeticsUi(): изменяемое состояние client.js (lastRooms,
// selectedRoomId, roomsCreateOpen...) приходит через геттеры/сеттеры в deps,
// а не через замыкание, поэтому верхний уровень у этих функций свой,
// собственный (client_rooms_ui.js), без доступа к client.js.
for (const fn of [
  'syncRoomsSearchClearUiImpl',
  'clearRoomsSearchImpl',
  'attemptJoinRoomImpl',
  'setRoomsCreateOpenImpl',
  'updateRoomsCreateUiImpl',
  'applyRoomsFilterSortImpl',
  'updateRoomsUiImpl',
  'updateRoomInfoImpl'
]) {
  test(`${fn}() не читает идентификаторы, которых нет ни в её теле, ни на верхнем уровне client_rooms_ui.js`, () => {
    const masked = maskNonCode(CLIENT_ROOMS_UI_JS);
    const body = extractFunctionBody(masked, fn);
    const topLevel = extractDeclared(masked);

    const unknown = unknownIdentifiers(body, [...topLevel]);

    assert.deepEqual(
      unknown,
      [],
      `${fn}() читает необъявленные идентификаторы: ${unknown.join(', ')}`
    );
  });
}

// Жизненный цикл матча (applyMatchPhase/onMatchStart/onMatchEnd/
// resetClientForNewMatch/updateMatchCountdown/runMatchResultsCascade)
// переехал в client_match.js — тот же класс риска, что и у остальных Impl-
// функций: изменяемое состояние client.js (matchPhase, botIds, powerUps...)
// приходит через deps и возвращается объектом res, который тонкая обёртка в
// client.js раскладывает обратно по переменным, поэтому верхний уровень у
// этих функций собственный (client_match.js), без доступа к client.js.
for (const fn of [
  'applyMatchPhaseImpl',
  'updateMatchCountdownImpl',
  'resetClientForNewMatchImpl',
  'onMatchEndImpl',
  'onMatchStartImpl',
  'runMatchResultsCascadeImpl'
]) {
  test(`${fn}() не читает идентификаторы, которых нет ни в её теле, ни на верхнем уровне client_match.js`, () => {
    const masked = maskNonCode(CLIENT_MATCH_JS);
    const body = extractFunctionBody(masked, fn);
    const topLevel = extractDeclared(masked);

    const unknown = unknownIdentifiers(body, [...topLevel]);

    assert.deepEqual(
      unknown,
      [],
      `${fn}() читает необъявленные идентификаторы: ${unknown.join(', ')}`
    );
  });
}

// Управление змейкой (setDir/движение клавиатурой/свайпы на канвасе)
// переехало в client_input.js — тот же класс риска, что и у остальных Impl-
// функций: изменяемое состояние client.js (lastDirSent, swipeActive,
// swipeX0/Y0, swipePointerId, swipeIndicatorEl) приходит через deps и
// возвращается объектом res, который тонкая обёртка в client.js раскладывает
// обратно по переменным, поэтому верхний уровень у этих функций собственный
// (client_input.js), без доступа к client.js.
for (const fn of [
  'setDirImpl',
  'handleMovementKeydownImpl',
  'getSwipeIndicatorImpl',
  'showSwipeIndicatorImpl',
  'moveSwipeIndicatorImpl',
  'hideSwipeIndicatorImpl',
  'handleSwipePointerDownImpl',
  'handleSwipePointerMoveImpl',
  'endSwipeImpl'
]) {
  test(`${fn}() не читает идентификаторы, которых нет ни в её теле, ни на верхнем уровне client_input.js`, () => {
    const masked = maskNonCode(CLIENT_INPUT_JS);
    const body = extractFunctionBody(masked, fn);
    const topLevel = extractDeclared(masked);

    const unknown = unknownIdentifiers(body, [...topLevel]);

    assert.deepEqual(
      unknown,
      [],
      `${fn}() читает необъявленные идентификаторы: ${unknown.join(', ')}`
    );
  });
}
