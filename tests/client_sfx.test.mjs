/*
 * public/client_sfx.js — исполняемые тесты палитры.
 *
 * Движок (client_audio.js) проверяется отдельно; здесь проверяется то, что
 * слышит игрок. Дорогих поломок две:
 *
 *  1) ПОТОЛОК. Серия захватов подряд когда-то поднималась «на два полутона
 *     за шаг» и упиралась в предел: с четырнадцатого звена цепочки звук
 *     переставал меняться вовсе, и рекордная серия матча звучала как
 *     средняя. Потолок по высоте неизбежен, поэтому дальше расти обязаны
 *     плотность и хвост — а значит, соседние ступени должны отличаться.
 *  2) ТИШИНА И МУСОР. Каждое событие палитры приходит из сети: номер шага,
 *     громкость метки, панорама. Ни одно из этих чисел не проверено на той
 *     стороне, и любое из них может прийти дробным, отрицательным или NaN.
 *
 * Стенд ставится ОДИН РАЗ на весь файл, а не на тест. Палитра — синглтон:
 * модуль держит свой AudioContext до конца сессии, и мок, снятый между
 * тестами, оставил бы его указывающим в мёртвый контекст. Поэтому тесты
 * читают не «весь лог», а свой срез лога — см. since().
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { installFakeTimers, installRandom, installAudioEnv, badAudioNumbers } from './helpers/env_mock.mjs';

const timers = installFakeTimers(100_000);
const rnd = installRandom([0.5]);
const env = installAudioEnv({ sampleRate: 64 });

const { settings } = await import('../public/client_store.js');
const { sfx } = await import('../public/client_sfx.js');

settings.soundEnabled = true;
settings.soundMutedByBlur = false;
settings.soundVolume = 1;
settings.fxPreset = 'normal';

process.on('exit', () => {
  env.restore();
  rnd.restore();
  timers.restore();
});

const log = () => env.ctx()?.__log ?? [];
const nodeCount = () => env.ctx()?.__nodes.length ?? 0;

/** Частоты осцилляторов — «отпечаток» того, как событие звучит. */
function freqsSince(mark) {
  return log()
    .slice(mark)
    .filter((e) => e.op === 'param' && e.kind === 'osc' && e.name === 'frequency' && e.call === 'setValueAtTime')
    .map((e) => Math.round(e.v));
}

/** Проигрывает событие и возвращает его отпечаток. */
function fingerprint(play) {
  const mark = log().length;
  play();
  // Лимитер считает события, а не голоса: между ступенями ждём окно.
  timers.advance(300);
  return freqsSince(mark);
}

test('ступень комбо меняется на каждом шаге и не упирается в потолок', () => {
  // Ловит: возврат к линейному подъёму с обрезкой. Именно так игра и
  // звучала до этого теста: пятнадцатый захват подряд и тридцатый были
  // неразличимы.
  const seen = [];
  for (let i = 0; i < 40; i++) seen.push(fingerprint(() => sfx.comboStep(i)).join(','));

  for (let i = 1; i < seen.length; i++) {
    assert.notEqual(seen[i], seen[i - 1], `ступени ${i - 1} и ${i} звучат одинаково`);
  }
  assert.ok(new Set(seen).size >= 30, `слишком мало различимых ступеней: ${new Set(seen).size} из 40`);
});

test('комбо: высота остаётся в слышимой полосе, а плотность растёт витками', () => {
  // Ловит: «бесконечный подъём» — самое простое решение потолка и самое
  // плохое: к тридцатому шагу звук уходит в свист под 8 кГц.
  const first = fingerprint(() => sfx.comboStep(0));
  const late = fingerprint(() => sfx.comboStep(35));
  assert.ok(Math.max(...first, ...late) <= 5000, `слишком высоко: ${Math.max(...first, ...late)} Гц`);
  assert.ok(late.length > first.length, `плотность должна расти: было ${first.length} слоёв, стало ${late.length}`);
});

test('комбо: обрыв цепочки падает с той ступени, на которой оборвался', () => {
  // Ловит: обрыв «всегда одинаковой» нотой. Тогда длинная серия и короткая
  // заканчиваются неотличимо, хотя терять их — совсем разная потеря.
  const short = fingerprint(() => sfx.comboBreak(0)).join(',');
  const long = fingerprint(() => sfx.comboBreak(24)).join(',');
  assert.notEqual(short, long);
});

test('серия убийств тоже не упирается в потолок', () => {
  const seen = [];
  for (let i = 0; i < 20; i++) seen.push(fingerprint(() => sfx.streak(i)).join(','));
  for (let i = 1; i < seen.length; i++) {
    assert.notEqual(seen[i], seen[i - 1], `серии ${i - 1} и ${i} звучат одинаково`);
  }
});

test('каждое событие палитры звучит и остаётся одним событием лимитера', () => {
  // Ловит: немое событие. Опечатка в имени примитива глушит звук целиком, а
  // заметить это на слух можно только в редком сценарии — джекпот или
  // реванш случаются не каждый матч.
  for (const name of Object.keys(sfx)) {
    const before = nodeCount();
    sfx[name](1);
    assert.ok(nodeCount() > before, `${name}: не создал ни одного узла`);
    timers.advance(300);
  }
});

test('палитра переживает мусорные аргументы из сети', () => {
  // Ловит: NaN, доехавший до setValueAtTime. Номер шага, громкость метки и
  // панорама приходят снаружи; после NaN голос не звучит вовсе, а в консоли
  // пусто — исключение съедает внешний catch.
  const mark = log().length;
  const junk = [undefined, null, NaN, Infinity, -Infinity, -5, 1e9, 'abc', {}, [], true, 2.7];
  for (const j of junk) {
    for (const name of Object.keys(sfx)) {
      assert.doesNotThrow(() => sfx[name](j), `${name}(${String(j)})`);
      timers.advance(300);
    }
  }
  const bad = badAudioNumbers(log().slice(mark));
  assert.deepEqual(bad, [], `нечисловые аргументы: ${JSON.stringify(bad.slice(0, 3))}`);
});

test('выключенный звук: палитра не строит ни одного узла', () => {
  // Ловит: событие в обход gate() — например, просадку громкости первой
  // строкой. Контекст к этому моменту уже создан (см. шапку файла), поэтому
  // проверяется именно то, что новых узлов не появляется.
  settings.soundEnabled = true;
  const before = nodeCount();
  try {
    settings.soundEnabled = false;
    for (const name of Object.keys(sfx)) {
      sfx[name](1);
      timers.advance(300);
    }
    assert.equal(nodeCount(), before);
  } finally {
    settings.soundEnabled = true;
  }
});
