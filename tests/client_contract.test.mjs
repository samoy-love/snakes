/*
 * Контракт «сервер ↔ public/client.js»: статическая сверка фактического
 * декодера клиента с эталоном протокола (tests/golden/protocol_golden.json).
 *
 * Почему статически, а не запуском клиента. public/client.js — монолит на
 * ~490 КБ, намертво завязанный на DOM, canvas, WebSocket, localStorage и
 * twemoji; поднимать под него шим дороже и хрупче, чем разобрать сам разбор.
 * Ровно этим (сверкой `need(...)` и суммы `o += N` по каждому kind) ловили
 * все три исторических рассинхрона:
 *   - kind=12 (ContractComplete): клиент читал 11 байт вместо 3;
 *   - kind=13 (Style): обработчика не было вовсе;
 *   - новый kind без обработчика ронял весь хвост пакета.
 * Во всех трёх случаях парсер «съезжал» и молча терял киллфид, тосты,
 * обновления заданий и баланс валюты.
 *
 * Клиент разбит на модули (public/client*.js), поэтому тест склеивает их все
 * и ищет разбор в общем тексте: так проверка переживает переезд парсера в
 * другой файл и не превращается в молча зелёный тест.
 *
 * Тест разбирает исходник клиента как текст и проверяет три вещи на каждый
 * тип события:
 *   1) обработчик существует;
 *   2) охранная проверка need(...) требует ровно длину payload с сервера;
 *   3) последовательность ширин чтений (getUint8/16/32) совпадает с серверной
 *      раскладкой полей — это строже суммы и ловит подмену u16+u16 на u32.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const golden = JSON.parse(readFileSync(join(HERE, 'golden', 'protocol_golden.json'), 'utf8'));

// Все модули клиента, склеенные в один текст. Парсер протокола сейчас лежит в
// client.js, но искать его по всему клиенту дешевле, чем однажды не заметить
// переезд: тест тогда просто не нашёл бы разбор и упал, а не позеленел молча.
// SNAKES_CLIENT_JS — только для самопроверки самого теста (прогон по нарочно
// испорченной копии клиента). В CI переменная не задаётся.
function readClientSources() {
  const override = process.env.SNAKES_CLIENT_JS;
  if (override) return readFileSync(override, 'utf8');
  const dir = join(ROOT, 'public');
  const files = readdirSync(dir)
    .filter((f) => /^client.*\.js$/.test(f))
    .sort();
  // client.js первым: разбор пакетов и msgType-ветки исторически там, а порядок
  // важен только для читаемости диагностики.
  files.sort((a, b) => (a === 'client.js' ? -1 : b === 'client.js' ? 1 : 0));
  return files.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
}

const src = readClientSources();

// --- вспомогательные разборщики --------------------------------------------

// Безопасное вычисление арифметики вида "2 + 1 + 2 * 11": только цифры,
// плюс и звёздочка. eval здесь не нужен и не используется.
function evalArith(expr, where) {
  assert.match(expr, /^[\d\s+*]+$/, `${where}: неожиданное выражение в need(): ${expr}`);
  return expr
    .split('+')
    .map((term) => term.split('*').reduce((a, b) => a * Number(b.trim()), 1))
    .reduce((a, b) => a + b, 0);
}

// Регион разбора пакета событий: от `function handleEventsMessage(` (сама
// разборка вынесена из msgType === 5 в public/client_ws_handlers.js, client.js
// лишь вызывает её на месте своей ветки — как и handlePlayersMessage()/
// handleMinimapMessage() выше) до фолбэка на неизвестный тип события.
function eventsRegion() {
  const start = src.indexOf('function handleEventsMessage(');
  assert.notEqual(start, -1, 'не найден разбор пакета событий (handleEventsMessage)');
  const fallback = src.indexOf('unknownEventKindSeen.has(kind)', start);
  assert.notEqual(fallback, -1, 'не найден фолбэк на неизвестный тип события');
  return { start, fallback, text: src.slice(start, fallback) };
}

// Блоки обработчиков идут подряд, поэтому границы берём по началу следующего
// `if (kind === N) {` — это надёжнее подсчёта скобок в коде с шаблонными
// строками и юникодными комментариями.
function handlerBlocks() {
  const { text } = eventsRegion();
  const re = /if \(kind === (\d+)\) \{/g;
  const marks = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    marks.push({ kind: Number(m[1]), at: m.index, bodyAt: m.index + m[0].length });
  }
  const out = new Map();
  marks.forEach((mk, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].at : text.length;
    assert.ok(!out.has(mk.kind), `в client.js два обработчика для kind=${mk.kind}`);
    out.set(mk.kind, text.slice(mk.bodyAt, end));
  });
  return out;
}

// Ширины чтений в порядке их появления в блоке.
function readWidths(body) {
  return [...body.matchAll(/dv\.getUint(8|16|32)\(/g)].map((m) => Number(m[1]) / 8);
}

// Сумма продвижений курсора.
function cursorAdvance(body) {
  return [...body.matchAll(/\bo \+= (\d+);/g)].reduce((a, m) => a + Number(m[1]), 0);
}

function needValue(body, where) {
  // `return null;` — тот же контракт «прервать разбор без побочных эффектов»,
  // что и в handlePlayersMessage()/handleMinimapMessage() (public/client_ws_handlers.js):
  // handleEventsMessage() возвращает null при нехватке байт, а не голый `return;`,
  // потому что вызывающий код в client.js должен отличить «разбор не завершён»
  // от «разбор завершён успешно, вот обновлённые поля».
  const m = body.match(/if \(!need\(([^)]*)\)\) return(?: null)?;/);
  assert.ok(m, `${where}: нет охранной проверки need(...) — обработчик может читать за границей буфера`);
  return evalArith(m[1], where);
}

const blocks = handlerBlocks();

// ---------------------------------------------------------------------------
// 1. Все типы событий с сервера имеют обработчик на клиенте
// ---------------------------------------------------------------------------

test('каждый тип события сервера имеет обработчик в client.js', () => {
  const missing = golden.events
    .filter((e) => !blocks.has(e.kind))
    .map((e) => `${e.kind} (${e.const})`);
  assert.deepEqual(
    missing,
    [],
    'нет обработчика — клиент свалится в фолбэк «неизвестный kind», пропустит 1 байт вместо ' +
      'полного payload и потеряет весь хвост пакета событий'
  );
});

test('в client.js нет обработчиков несуществующих типов событий', () => {
  const known = new Set(golden.events.map((e) => e.kind));
  const orphan = [...blocks.keys()].filter((k) => !known.has(k));
  assert.deepEqual(orphan, [], 'обработчик есть, а события такого сервер не шлёт');
});

// ---------------------------------------------------------------------------
// 2. Длины и раскладка каждого обработчика
// ---------------------------------------------------------------------------

for (const spec of golden.events) {
  test(`client.js: kind=${spec.kind} (${spec.const}) читает ${spec.len} байт по серверной раскладке`, () => {
    const body = blocks.get(spec.kind);
    assert.ok(body, `нет обработчика kind=${spec.kind}`);
    const where = `kind=${spec.kind} (${spec.const})`;

    assert.equal(
      needValue(body, where),
      spec.len,
      `${where}: need(...) не совпадает с длиной payload на сервере`
    );

    const widths = readWidths(body);
    const wantWidths = spec.fields.map((f) => f.size);
    assert.deepEqual(
      widths,
      wantWidths,
      `${where}: последовательность ширин чтений разошлась с серверной раскладкой ` +
        `[${spec.fields.map((f) => `${f.name}:${f.size}`).join(', ')}]`
    );

    assert.equal(
      cursorAdvance(body),
      spec.len,
      `${where}: суммарный сдвиг курсора o += ... не равен длине payload — ` +
        'разбор следующего события уедет'
    );
  });
}

// ---------------------------------------------------------------------------
// 3. Заголовок пакета событий и список powerup
// ---------------------------------------------------------------------------

test('client.js: заголовок пакета событий и запись powerup', () => {
  const { text } = eventsRegion();
  const head = text.slice(0, text.indexOf('if (kind ==='));

  // Байт типа сообщения к этому моменту уже прочитан, поэтому охрана заголовка
  // на единицу меньше eventsHeaderBase.
  const headNeed = head.match(/if \(!need\(([^)]*)\)\) return(?: null)?;/);
  assert.ok(headNeed, 'нет охранной проверки заголовка пакета событий');
  assert.equal(
    evalArith(headNeed[1], 'заголовок событий'),
    golden.consts.eventsHeaderBase - 1,
    'охрана заголовка не совпадает с eventsHeaderBase сервера'
  );

  // Всё, что клиент читает до первого обработчика события:
  //   заголовок  — tick u32, mutatorType u8, mutatorUntil u32,
  //                bountyTarget u16, bountyUntil u32, powerupCount u8;
  //   запись powerup — ID u16, Type u8, X u16, Y u16, Expires u32 (11 байт);
  //   счётчик событий u16 и байт kind первого события.
  const puRecord = [2, 1, 2, 2, 4];
  assert.equal(
    puRecord.reduce((a, b) => a + b, 0),
    golden.consts.powerUpRecordLen,
    'раскладка записи powerup не даёт powerUpRecordLen'
  );
  assert.deepEqual(
    readWidths(head),
    [4, 1, 4, 2, 4, 1, ...puRecord, 2, 1],
    'раскладка заголовка пакета событий разошлась с сервером'
  );

  const puNeed = text.match(/if \(!need\(puCount \* (\d+) \+ 2\)\) return(?: null)?;/);
  assert.ok(puNeed, 'нет охранной проверки списка powerup');
  assert.equal(
    Number(puNeed[1]),
    golden.consts.powerUpRecordLen,
    'размер записи powerup на клиенте не равен серверному'
  );
});

// ---------------------------------------------------------------------------
// 4. ROI-снапшот и чанки миникарты
// ---------------------------------------------------------------------------

test('client.js: размер записи игрока в ROI совпадает с сервером', () => {
  // Раскладка размеров живёт в client_protocol.js (pickPlayerRecordSize),
  // самый новый формат — первый элемент PLAYER_RECORD_SIZES.
  const decls = [...src.matchAll(/PLAYER_RECORD_SIZES = \[(\d+)/g)].map((m) => Number(m[1]));
  assert.ok(decls.length > 0, 'не найдено объявление PLAYER_RECORD_SIZES');
  for (const v of decls) {
    assert.equal(
      v,
      golden.consts.roiPlayerRecordLen,
      'PLAYER_RECORD_SIZES[0] разошёлся с roiPlayerRecordLen — записи игроков поедут, ' +
        'а за ними rx/ry/rw/rh и дельты сетки'
    );
  }
});

test('client.js: разбор чанков миникарты', () => {
  // Разбор чанков живёт в handleMinimapMessage() (public/client_ws_handlers.js),
  // client.js лишь вызывает её на месте своей ветки msgType === 4.
  const fnStart = src.indexOf('function handleMinimapMessage(');
  assert.notEqual(fnStart, -1, 'не найден разбор чанков миникарты (handleMinimapMessage)');
  let depth = 0;
  let bodyStart = -1;
  let block = null;
  for (let i = fnStart; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') {
      if (depth === 0) bodyStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        block = src.slice(bodyStart, i + 1);
        break;
      }
    }
  }
  assert.ok(block, 'не нашли конец handleMinimapMessage()');

  // Заголовок: tick(4) + cw(1) + ch(1) + count(2) + flags(1); байт типа уже снят.
  const head = block.match(/if \(o \+ ([\d\s+*]+) > bl\) return null;/);
  assert.ok(head, 'нет охранной проверки заголовка миникарты');
  assert.equal(
    evalArith(head[1], 'заголовок миникарты') + 4,
    golden.consts.minimapHeaderLen + 3,
    'охрана заголовка миникарты разошлась с сервером'
  );

  assert.match(
    block,
    /const bytesChunk = 2 \+ chunkCells \* 2 \+ \(hasTrail \? chunkCells \* 2 : 0\);/,
    'формула размера чанка на клиенте разошлась с сервером ' +
      '(cx(1)+cy(1) + cells*u16 сетки + опционально cells*u16 следа)'
  );
  assert.match(block, /const chunkCells = cw \* ch;/, 'клиент должен брать размер чанка из заголовка, а не из константы');
});

// ---------------------------------------------------------------------------
// 5. Номера типов сообщений
// ---------------------------------------------------------------------------

test('client.js: номера типов сообщений совпадают с сервером', () => {
  for (const [name, want] of Object.entries(golden.msgTypes)) {
    assert.match(
      src,
      new RegExp(`if \\(msgType === ${want}\\) \\{`),
      `в client.js нет ветки разбора для msgType=${want} (${name})`
    );
  }
});

// Обратная сторона: ветка разбора, которой на сервере нет, — мёртвый путь.
// Легаси-тип 1 (полный снапшот) удалён вместе с серверным сериализатором;
// эта проверка не даёт ему (или любому другому призраку) вернуться.
test('client.js: нет веток разбора для типов сообщений, которых сервер не шлёт', () => {
  const known = new Set(Object.values(golden.msgTypes).map(Number));
  const found = [...src.matchAll(/if \(msgType === (\d+)\) \{/g)].map((m) => Number(m[1]));
  assert.ok(found.length > 0, 'в client.js не найдено ни одной ветки msgType');
  const orphan = [...new Set(found)].filter((v) => !known.has(v)).sort((a, b) => a - b);
  assert.deepEqual(
    orphan,
    [],
    'ветка разбора есть, а сообщения такого типа сервер не отправляет — мёртвый код протокола'
  );
});

// ---------------------------------------------------------------------------
// 6. Фолбэк на неизвестный тип события
// ---------------------------------------------------------------------------

test('client.js: неизвестный тип события пропускает ровно 1 байт и продолжает разбор', () => {
  const { fallback } = eventsRegion();
  const tail = src.slice(fallback, fallback + 600);
  assert.match(
    tail,
    /if \(!need\(1\)\) break;\s*\n\s*o \+= 1;/,
    'фолбэк должен пропускать ровно один байт-заглушку (см. default в buildEventsPooledLocked) ' +
      'и продолжать разбор, иначе старый клиент теряет весь хвост пакета'
  );
});
