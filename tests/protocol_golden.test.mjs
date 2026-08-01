/*
 * Клиентские тесты бинарного протокола: эталонный декодер против золотых
 * буферов, снятых с боевых Go-сериализаторов.
 *
 * Запуск (нужен только Node 22+, никаких зависимостей и никакого Go):
 *   node --test tests/
 *
 * Эталон tests/golden/protocol_golden.json генерируется из Go:
 *   UPDATE_GOLDEN=1 go test -run TestProtocolGoldenExport .
 * и проверяется на актуальность обычным `go test ./...` — если сериализатор
 * изменился, а эталон нет, падает Go-тест; если изменился эталон, а клиент
 * нет, падает этот тест и tests/client_contract.test.mjs.
 *
 * Декодер ниже — НЕЗАВИСИМАЯ реализация формата (а не импорт client.js):
 * смещения выписаны заново по спецификации. Совпадение двух независимых
 * реализаций на побайтовых эталонах — это и есть проверка.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(HERE, 'golden', 'protocol_golden.json'), 'utf8'));

const caseByName = new Map(golden.cases.map((c) => [c.name, c]));

function bytesOf(name) {
  const c = caseByName.get(name);
  assert.ok(c, `в эталоне нет кейса ${name}`);
  const buf = Buffer.from(c.bytes, 'base64');
  // Копия в отдельный ArrayBuffer: Buffer из пула делит память с соседями.
  const ab = new ArrayBuffer(buf.length);
  new Uint8Array(ab).set(buf);
  return ab;
}

// ---------------------------------------------------------------------------
// Эталонный курсор
// ---------------------------------------------------------------------------

class Cursor {
  constructor(ab) {
    this.dv = new DataView(ab);
    this.o = 0;
    this.len = ab.byteLength;
  }
  u8() {
    assert.ok(this.o + 1 <= this.len, `u8 за границей буфера на ${this.o}/${this.len}`);
    return this.dv.getUint8(this.o++);
  }
  u16() {
    assert.ok(this.o + 2 <= this.len, `u16 за границей буфера на ${this.o}/${this.len}`);
    const v = this.dv.getUint16(this.o, true);
    this.o += 2;
    return v;
  }
  u32() {
    assert.ok(this.o + 4 <= this.len, `u32 за границей буфера на ${this.o}/${this.len}`);
    const v = this.dv.getUint32(this.o, true);
    this.o += 4;
    return v;
  }
  read(size) {
    if (size === 1) return this.u8();
    if (size === 2) return this.u16();
    if (size === 4) return this.u32();
    throw new Error(`недопустимая ширина поля ${size}`);
  }
  atEnd() {
    return this.o === this.len;
  }
}

// ---------------------------------------------------------------------------
// Раскладка событий — независимая копия спецификации.
// Порядок и ширины выписаны вручную; тест ниже сверяет её с эталоном из Go.
// ---------------------------------------------------------------------------

const EVENT_LAYOUT = {
  1: { name: 'Kill', fields: [['A', 2], ['B', 2], ['D', 1], ['X', 2], ['Y', 2]] },
  2: { name: 'Streak', fields: [['A', 2], ['D', 1]] },
  3: { name: 'BountyAssign', fields: [['A', 2], ['C', 4]] },
  4: { name: 'BountyClaim', fields: [['A', 2], ['B', 2]] },
  5: { name: 'PowerupSpawn', fields: [['A', 2], ['D', 1], ['X', 2], ['Y', 2], ['C', 4]] },
  6: { name: 'PowerupPickup', fields: [['A', 2], ['B', 2], ['D', 1], ['X', 2], ['Y', 2]] },
  7: { name: 'MutatorStart', fields: [['D', 1], ['C', 4]] },
  8: { name: 'MutatorEnd', fields: [['D', 1]] },
  9: { name: 'PowerupUse', fields: [['A', 2], ['D', 1], ['X', 2], ['Y', 2]] },
  10: { name: 'ContractAssign', fields: [['A', 2], ['D', 1], ['B', 2], ['C', 4]] },
  11: { name: 'ContractProgress', fields: [['A', 2], ['D', 1], ['B', 2]] },
  12: { name: 'ContractComplete', fields: [['A', 2], ['D', 1]] },
  13: { name: 'Style', fields: [['A', 2], ['B', 2], ['C', 4], ['D', 1]] },
  14: { name: 'Revenge', fields: [['A', 2], ['B', 2]] },
  15: { name: 'DailyAssign', fields: [['A', 2], ['D', 1], ['B', 2], ['C', 4]] },
  16: { name: 'DailyProgress', fields: [['A', 2], ['D', 1], ['B', 2]] },
  17: { name: 'DailyComplete', fields: [['A', 2], ['D', 1]] },
  18: { name: 'Achievement', fields: [['A', 2], ['D', 1]] },
  19: { name: 'Capture', fields: [['A', 2], ['X', 2], ['Y', 2], ['C', 4], ['D', 1]] },
  20: { name: 'Reclaim', fields: [['A', 2], ['B', 2], ['X', 2], ['Y', 2]] },
  21: { name: 'CoolBatch', fields: [['A', 2], ['B', 2], ['C', 4]] }
};

// Эталонный разбор пакета событий (msgType 5).
function decodeEvents(ab) {
  const c = new Cursor(ab);
  const msgType = c.u8();
  assert.equal(msgType, golden.msgTypes.events, 'тип сообщения');
  const out = {
    tick: c.u32(),
    mutatorType: c.u8(),
    mutatorUntil: c.u32(),
    bountyTarget: c.u16(),
    bountyUntil: c.u32(),
    powerUps: [],
    events: [],
    unknownKinds: []
  };
  const puCount = c.u8();
  for (let i = 0; i < puCount; i++) {
    out.powerUps.push({
      id: c.u16(),
      type: c.u8(),
      x: c.u16(),
      y: c.u16(),
      expires: c.u32()
    });
  }
  const evCount = c.u16();
  for (let i = 0; i < evCount; i++) {
    const kind = c.u8();
    const spec = EVENT_LAYOUT[kind];
    if (!spec) {
      // Сервер пишет для неизвестного типа ровно один байт-заглушку.
      out.unknownKinds.push(kind);
      c.u8();
      continue;
    }
    const ev = { kind, name: spec.name };
    for (const [field, size] of spec.fields) ev[field] = c.read(size);
    out.events.push(ev);
  }
  assert.ok(c.atEnd(), `после разбора остался хвост ${c.len - c.o} байт`);
  return out;
}

// Эталонный разбор ROI (msgType 2).
function decodeROI(ab) {
  const c = new Cursor(ab);
  assert.equal(c.u8(), golden.msgTypes.roi, 'тип сообщения');
  const tick = c.u32();
  const pc = c.u16();
  const players = [];
  for (let i = 0; i < pc; i++) {
    const start = c.o;
    const p = {
      n: c.u16(),
      x: c.u16(),
      y: c.u16(),
      dir: c.u8(),
      alive: c.u8(),
      score: c.u16(),
      points: c.u16(),
      hue: c.u16(),
      shield: c.u8(),
      bot: c.u8(),
      cosCaptureFx: c.u8(),
      cosHead: c.u8(),
      cosSeg: c.u8(),
      cosNameplate: c.u8(),
      cosFrame: c.u8()
    };
    assert.equal(c.o - start, golden.consts.roiPlayerRecordLen, 'размер записи игрока');
    players.push(p);
  }
  const roi = { rx: c.u16(), ry: c.u16(), rw: c.u16(), rh: c.u16() };
  const lenDG = c.u32();
  const lenDT = c.u32();
  assert.equal(c.o + lenDG + lenDT, c.len, 'длины дельт не сходятся с длиной буфера');
  const dg = new Uint32Array(ab.slice(c.o, c.o + lenDG));
  const dt = new Uint32Array(ab.slice(c.o + lenDG, c.o + lenDG + lenDT));
  return { tick, players, roi, dg, dt };
}

// Эталонный разбор чанков миникарты (msgType 4).
function decodeMinimap(ab) {
  const c = new Cursor(ab);
  assert.equal(c.u8(), golden.msgTypes.minimapChunk, 'тип сообщения');
  const tick = c.u32();
  const cw = c.u8();
  const ch = c.u8();
  const count = c.u16();
  const flags = c.u8();
  assert.equal(c.o, golden.consts.minimapHeaderLen, 'размер заголовка миникарты');
  const hasTrail = (flags & 1) === 1;
  const cells = cw * ch;
  const chunks = [];
  for (let k = 0; k < count; k++) {
    const cx = c.u8();
    const cy = c.u8();
    const grid = new Array(cells);
    for (let i = 0; i < cells; i++) grid[i] = c.u16();
    if (hasTrail) for (let i = 0; i < cells; i++) c.u16();
    chunks.push({ cx, cy, grid });
  }
  assert.ok(c.atEnd(), `после разбора миникарты остался хвост ${c.len - c.o} байт`);
  return { tick, cw, ch, count, flags, hasTrail, chunks };
}

// ---------------------------------------------------------------------------
// 1. Раскладка событий из Go совпадает с раскладкой этого декодера
// ---------------------------------------------------------------------------

test('раскладка всех 21 типов событий совпадает с серверной', () => {
  assert.equal(golden.events.length, 21, 'в эталоне должен быть 21 тип события');
  for (const spec of golden.events) {
    const mine = EVENT_LAYOUT[spec.kind];
    assert.ok(mine, `в клиентском декодере нет типа ${spec.kind} (${spec.const})`);
    const mineFields = mine.fields.map(([n, s]) => `${n}:${s}`).join(',');
    const goldFields = spec.fields.map((f) => `${f.name}:${f.size}`).join(',');
    assert.equal(mineFields, goldFields, `раскладка kind=${spec.kind} (${spec.const})`);
    const sum = mine.fields.reduce((a, [, s]) => a + s, 0);
    assert.equal(sum, spec.len, `суммарная длина payload kind=${spec.kind}`);
  }
});

// ---------------------------------------------------------------------------
// 2. Побайтовый разбор эталонного пакета на каждый тип события
// ---------------------------------------------------------------------------

for (const spec of golden.events) {
  test(`декодирование события kind=${spec.kind} (${spec.const})`, () => {
    const out = decodeEvents(bytesOf(`events_kind_${spec.const}`));
    assert.equal(out.tick, 7);
    assert.equal(out.powerUps.length, 0);
    assert.equal(out.events.length, 1, 'ожидалось ровно одно событие');
    const ev = out.events[0];
    assert.equal(ev.kind, spec.kind);
    for (const f of spec.fields) {
      const want = f.size === 4 ? golden.sample[f.name] : golden.sample[f.name] & ((1 << (8 * f.size)) - 1);
      assert.equal(
        ev[f.name],
        want >>> 0,
        `поле ${f.name} (${f.size} байт) типа ${spec.const}: смещения разъехались`
      );
    }
  });
}

// ---------------------------------------------------------------------------
// 3. Заголовок пакета, список powerup, все типы подряд, неизвестный тип
// ---------------------------------------------------------------------------

test('заголовок пакета: мутатор, баунти и список powerup', () => {
  const out = decodeEvents(bytesOf('events_header_powerups'));
  assert.equal(out.tick, 4242);
  assert.equal(out.mutatorType, 3);
  assert.equal(out.mutatorUntil, 5000);
  assert.equal(out.bountyTarget, 17);
  assert.equal(out.bountyUntil, 4999);
  assert.equal(out.powerUps.length, 5);
  out.powerUps.forEach((pu, i) => {
    assert.deepEqual(pu, {
      id: i + 1,
      type: (i % 4) + 1,
      x: 10 + i,
      y: 20 + i * 2,
      expires: 9000 + i
    });
  });
  assert.equal(out.events.length, 2);
  assert.deepEqual(out.events[0], { kind: 2, name: 'Streak', A: 17, D: 5 });
  assert.deepEqual(out.events[1], { kind: 8, name: 'MutatorEnd', D: 3 });
});

test('все 21 типов в одном пакете разбираются по порядку и без сдвига', () => {
  const out = decodeEvents(bytesOf('events_all_kinds'));
  assert.equal(out.tick, 100500);
  assert.equal(out.events.length, 21, 'ни одно событие не должно потеряться');
  out.events.forEach((ev, i) => {
    assert.equal(ev.kind, i + 1, `событие ${i}: сдвиг курсора`);
  });
});

test('неизвестный тип события — 1 байт-заглушка, хвост пакета не теряется', () => {
  const out = decodeEvents(bytesOf('events_unknown_kind'));
  assert.deepEqual(out.unknownKinds, [250]);
  assert.equal(out.events.length, 1, 'событие после неизвестного типа должно уцелеть');
  assert.equal(out.events[0].kind, 2);
  assert.equal(out.events[0].A, golden.sample.A);
});

// ---------------------------------------------------------------------------
// 4. ROI-снапшот
// ---------------------------------------------------------------------------

test('ROI: запись игрока 21 байт, два игрока, пустые дельты', () => {
  const out = decodeROI(bytesOf('roi_fast_two_players'));
  assert.equal(out.tick, 99);
  assert.equal(out.players.length, 2);
  assert.deepEqual(out.players[0], {
    n: 5, x: 30, y: 40, dir: 3, alive: 1, score: 111, points: 222,
    hue: 120, shield: 1, bot: 0,
    cosCaptureFx: 1, cosHead: 2, cosSeg: 3, cosNameplate: 4, cosFrame: 0
  });
  assert.deepEqual(out.players[1], {
    n: 9, x: 31, y: 41, dir: 3, alive: 0, score: 333, points: 444,
    hue: 300, shield: 0, bot: 1,
    cosCaptureFx: 1, cosHead: 2, cosSeg: 3, cosNameplate: 4, cosFrame: 0
  });
  assert.deepEqual(out.roi, { rx: 0, ry: 0, rw: 8, rh: 8 });
  assert.equal(out.dg.length, 0);
  assert.equal(out.dt.length, 0);
});

test('ROI: полный скан региона 4x3 даёт 12 клеток сетки', () => {
  const out = decodeROI(bytesOf('roi_scan_full'));
  assert.equal(out.tick, 55);
  assert.deepEqual(out.roi, { rx: 4, ry: 6, rw: 4, rh: 3 });
  assert.equal(out.dg.length, 12, 'при full=true сервер шлёт каждую клетку региона');
  // Дельта пакуется как (index << 16) | value — проверяем и индексы, и значения.
  const W = golden.consts.W;
  const seen = new Map();
  for (const packed of out.dg) {
    seen.set(packed >>> 16, packed & 0xffff);
  }
  for (let y = 6; y < 9; y++) {
    for (let x = 4; x < 8; x++) {
      assert.equal(seen.get(y * W + x), x + y, `клетка (${x},${y})`);
    }
  }
  assert.equal(out.dt.length, 12);
});

// ---------------------------------------------------------------------------
// 5. Чанки миникарты
// ---------------------------------------------------------------------------

test('миникарта: дельта в один чанк', () => {
  const out = decodeMinimap(bytesOf('minimap_delta_one_chunk'));
  assert.equal(out.tick, 3);
  assert.equal(out.cw, golden.consts.minimapChunkW);
  assert.equal(out.ch, golden.consts.minimapChunkH);
  assert.equal(out.count, 1);
  assert.equal(out.hasTrail, false);
  assert.deepEqual({ cx: out.chunks[0].cx, cy: out.chunks[0].cy }, { cx: 1, cy: 0 });
  assert.equal(out.chunks[0].grid.length, golden.consts.minimapChunkW * golden.consts.minimapChunkH);
  assert.equal(out.chunks[0].grid[0], 5, 'клетка (10,0) внутри чанка (1,0)');
  assert.equal(out.chunks[0].grid[1], 5);
});

test('миникарта: full — первая страница чанков, ограниченная лимитом', () => {
  const out = decodeMinimap(bytesOf('minimap_full_page1'));
  assert.equal(out.tick, 12);
  const total = golden.consts.minimapChunksX * golden.consts.minimapChunksY;
  const want = Math.min(total, golden.consts.minimapMaxChunksPerMsg);
  assert.equal(out.count, want, 'full-выдача пагинируется');
  assert.equal(out.chunks[0].cx, 0);
  assert.equal(out.chunks[0].cy, 0);
  assert.equal(out.chunks[0].grid[0], 77);
  const c11 = out.chunks.find((c) => c.cx === 1 && c.cy === 1);
  assert.ok(c11, 'чанк (1,1) должен попасть в первую страницу');
  assert.equal(c11.grid[0], 88);
});
