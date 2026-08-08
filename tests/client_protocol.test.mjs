/*
 * pickPlayerRecordSize() — первый чистый кусок, вынесенный из
 * handleStateBinary() (client.js, ~827 строк, msgType === 2): выбор размера
 * записи игрока среди 4 версий протокола по тому, сколько байт реально
 * осталось в буфере. Раньше это была ручная лестница вложенных if
 * (client.js:8570-8582 до выноса), проверявшаяся только грепом исходника —
 * см. §6.4 отчёта разведки от 2026-08-05.
 *
 * Сверяется со старой инлайновой логикой на сетке значений — тем же приёмом,
 * что и field-math (PR #33, 363 комбинации, 0 расхождений).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { PLAYER_RECORD_SIZES, ROI_TAIL_BYTES, pickPlayerRecordSize } from '../public/client_protocol.js';

// Старая инлайновая реализация из handleStateBinary() до выноса — эталон для
// сверки. o/bl здесь абстрактны: availableBytes = bl - o.
function oldPickPlayerRecordSize(availableBytes, pc) {
  const perPlayerV4 = 21;
  const perPlayerV3 = 20;
  const perPlayerV2 = 15;
  const perPlayerV1 = 14;
  let perPlayer = perPlayerV4;
  if (availableBytes < pc * perPlayerV4 + 8 + 8) perPlayer = perPlayerV3;
  if (availableBytes < pc * perPlayer + 8 + 8) {
    perPlayer = perPlayerV2;
    if (availableBytes < pc * perPlayerV2 + 8 + 8) {
      perPlayer = perPlayerV1;
      if (availableBytes < pc * perPlayerV1 + 8 + 8) return null;
    }
  }
  return perPlayer;
}

test('константы протокола не разъехались', () => {
  assert.deepEqual(PLAYER_RECORD_SIZES, [21, 20, 15, 14]);
  assert.equal(ROI_TAIL_BYTES, 16);
});

test('pickPlayerRecordSize сверяется со старой лестницей if на сетке значений', () => {
  for (let pc = 0; pc <= 20; pc++) {
    for (let avail = 0; avail <= 21 * 20 + 32; avail++) {
      const got = pickPlayerRecordSize(avail, pc);
      const want = oldPickPlayerRecordSize(avail, pc);
      assert.equal(got, want, `расхождение при pc=${pc} avail=${avail}`);
    }
  }
});

test('выбирает самый новый формат (v4=21), если он влезает', () => {
  assert.equal(pickPlayerRecordSize(3 * 21 + 16, 3), 21);
});

test('деградирует до v1=14, если новые форматы не влезают', () => {
  assert.equal(pickPlayerRecordSize(3 * 14 + 16, 3), 14);
});

test('null, если даже v1 не влезает — кадр обрезан', () => {
  assert.equal(pickPlayerRecordSize(3 * 14 + 15, 3), null);
});

test('без игроков хватает одного хвоста (rx/ry/rw/rh + lenDG/lenDT)', () => {
  assert.equal(pickPlayerRecordSize(16, 0), 21);
  assert.equal(pickPlayerRecordSize(15, 0), null);
});
