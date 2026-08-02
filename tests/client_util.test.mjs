/*
 * public/client_util.js — исполняемые тесты.
 *
 * Главное здесь — не проценты, а СВЕРКА С СЕРВЕРОМ. Ник и название комнаты
 * чистит и клиент (чтобы показать ошибку до отправки), и сервер (main.go,
 * sanitizeName / sanitizeRoomName). Любое расхождение выглядит для игрока
 * одинаково паршиво: «на клиенте прошло, а на сервере обрезалось» или
 * наоборот «клиент не даёт ввести то, что сервер спокойно примет».
 *
 * Серверные правила воспроизведены ниже функциями goSanitize* — они повторяют
 * main.go построчно и, в отличие от клиента, считают длину В РУНАХ
 * (Go итерирует строку по рунам, `len(out)` — длина []rune).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clampInt,
  easeOutCubic,
  easeOutBack,
  lerp,
  normalizeMenuNickInput,
  sanitizeNameClient,
  sanitizeRoomTitleClient,
  escapeHtml,
  emojiParseSafeHtml,
  setSafeHtml,
  setSafeEmojiHtml,
  EMOJIS,
  overlayManager
} from '../public/client_util.js';

// --- эталон сервера (main.go) ----------------------------------------------

const NAME_MAX_LEN = 18; // main.go: NameMaxLen
const ROOM_NAME_MAX_LEN = 32; // main.go: RoomNameMaxLen

/* strings.TrimSpace: набор пробельных символов Go (unicode.White_Space) НЕ
   совпадает с набором JS String.trim(). Отличия ровно два и оба важны для
   сверки: U+0085 пробельный только для Go, U+FEFF — только для JS. */
const GO_SPACE = '\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const GO_TRIM_RE = new RegExp(`^[${GO_SPACE}]+|[${GO_SPACE}]+$`, 'g');
const goTrim = (s) => String(s).replace(GO_TRIM_RE, '');

/* Точный порт main.go sanitizeName/sanitizeRoomName: те же замены \r\n\t на
   пробел, тот же TrimSpace, тот же фильтр (< 0x20, '<', '>') и тот же обрыв
   по длине — но в рунах, как в Go. */
function goSanitize(name, maxRunes) {
  const raw = goTrim(String(name).replace(/[\r\n\t]/g, ' '));
  if (raw === '') return '';
  const out = [];
  for (const ch of raw) {
    if (out.length >= maxRunes) break;
    const code = ch.codePointAt(0);
    if (code < 0x20 || ch === '<' || ch === '>') continue;
    out.push(ch);
  }
  return goTrim(out.join(''));
}

const goSanitizeName = (s) => goSanitize(s, NAME_MAX_LEN);
const goSanitizeRoomName = (s) => goSanitize(s, ROOM_NAME_MAX_LEN);

const runeLen = (s) => [...s].length;

// --- числа и easing ---------------------------------------------------------

test('clampInt: округление вниз, зажим и мусор', () => {
  assert.equal(clampInt(5, 0, 10), 5);
  assert.equal(clampInt(-3, 0, 10), 0);
  assert.equal(clampInt(99, 0, 10), 10);
  assert.equal(clampInt(3.9, 0, 10), 3, 'floor, а не round');
  assert.equal(clampInt(-3.1, -10, 10), -4, 'floor у отрицательных идёт вниз');
  // Ловит: потерю `|| 0`. Без него NaN проваливался бы через оба сравнения и
  // возвращался наружу — а из clampInt берутся индексы предметов косметики.
  for (const bad of [NaN, undefined, null, 'abc', {}, []]) {
    assert.equal(clampInt(bad, 3, 7), 3, `вход ${String(bad)}`);
  }
  assert.equal(clampInt('7', 0, 10), 7);
});

test('easeOutCubic / easeOutBack: концы закреплены, вход зажат', () => {
  // Ловит: незажатый p. Прогресс анимации считается как age/duration и на
  // лаге кадра легко уезжает за 1 — без зажима easeOutCubic(2) = 2, и
  // всплывающие цифры улетали бы за экран.
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.equal(easeOutCubic(-5), 0);
  assert.equal(easeOutCubic(5), 1);
  assert.ok(easeOutCubic(0.5) > 0.5, 'ease-out должен обгонять линейный');

  assert.ok(Math.abs(easeOutBack(0)) < 1e-12);
  assert.ok(Math.abs(easeOutBack(1) - 1) < 1e-12);
  assert.equal(easeOutBack(-5), easeOutBack(0));
  assert.ok(Math.abs(easeOutBack(5) - easeOutBack(1)) < 1e-12);
  // «Back» обязан перелетать за 1 и возвращаться — иначе это просто ease-out.
  let over = 0;
  for (let p = 0; p <= 1; p += 0.01) if (easeOutBack(p) > 1.0001) over++;
  assert.ok(over > 5, 'easeOutBack не перелетает за 1 — потеряна «отдача»');

  // Монотонность easeOutCubic: любой откат назад — это дёрганая анимация.
  let prev = -1;
  for (let p = 0; p <= 1.0001; p += 0.005) {
    const v = easeOutCubic(p);
    assert.ok(v >= prev, `не монотонно на p=${p}`);
    prev = v;
  }
});

test('lerp: концы, середина и экстраполяция', () => {
  assert.equal(lerp(0, 10, 0), 0);
  assert.equal(lerp(0, 10, 1), 10);
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.equal(lerp(10, 0, 0.25), 7.5);
  assert.equal(lerp(0, 10, 2), 20, 'lerp намеренно не зажимает t');
  assert.equal(lerp(-5, 5, 0.5), 0);
});

// --- ник --------------------------------------------------------------------

test('normalizeMenuNickInput: разрешённый набор символов', () => {
  assert.deepEqual(normalizeMenuNickInput('Player_1'), {
    raw: 'Player_1',
    value: 'Player_1',
    hasBadChars: false
  });
  assert.deepEqual(normalizeMenuNickInput('Ёжик-ё'), {
    raw: 'Ёжик-ё',
    value: 'Ёжик-ё',
    hasBadChars: false
  });
  // Ловит: выпадение Ё/ё из белого списка. Они лежат ВНЕ диапазона 'А'..'я'
  // (U+0401/U+0451) и перечислены отдельными условиями — при рефакторинге
  // диапазона их теряют первыми, и «Ёжик» молча превращается в «жик».
  assert.equal(normalizeMenuNickInput('Ё').value, 'Ё');
  assert.equal(normalizeMenuNickInput('ё').value, 'ё');
});

test('normalizeMenuNickInput: угловые скобки и мусор помечают hasBadChars', () => {
  // Ловит: пропуск '<'/'>' в ник. Ник рендерится в HTML таблицы лидеров;
  // именно эта пара — вектор инъекции, и её обязан ловить ещё и сервер.
  const a = normalizeMenuNickInput('<b>hi</b>');
  assert.equal(a.hasBadChars, true);
  assert.equal(a.value, 'bhib');

  const b = normalizeMenuNickInput('Игрок😀');
  assert.equal(b.hasBadChars, true, 'эмодзи не входит в белый список');
  assert.equal(b.value, 'Игрок');

  // Управляющие символы вырезаются, но hasBadChars НЕ ставят — они приходят
  // из вставки буфера обмена, а не от злого умысла.
  const c = normalizeMenuNickInput('a\u0001\u001fb');
  assert.equal(c.value, 'ab');
  assert.equal(c.hasBadChars, false);
});

test('normalizeMenuNickInput: пробелы схлопываются, длина режется по 18', () => {
  assert.equal(normalizeMenuNickInput('  a   b  ').value, 'a b');
  assert.equal(normalizeMenuNickInput('\t x \n y \r').value, 'x y');
  assert.equal(normalizeMenuNickInput('A'.repeat(30)).value, 'A'.repeat(18));
  assert.equal(normalizeMenuNickInput('Ж'.repeat(30)).value, 'Ж'.repeat(18));
  assert.equal(normalizeMenuNickInput('').value, '');
  assert.equal(normalizeMenuNickInput(null).value, '');
  assert.equal(normalizeMenuNickInput('   ').raw, '');
});

test('sanitizeNameClient: минимум 2 символа и отказ при плохих символах', () => {
  assert.equal(sanitizeNameClient('ab'), 'ab');
  assert.equal(sanitizeNameClient('a'), '', 'один символ — отказ');
  assert.equal(sanitizeNameClient(' a '), '');
  assert.equal(sanitizeNameClient('Ник'), 'Ник');
  // Ловит: «молчаливую чистку» вместо отказа. Если бы клиент просто вырезал
  // '<' и отправил остаток, игрок увидел бы в игре не тот ник, что вводил.
  assert.equal(sanitizeNameClient('<b>hi</b>'), '');
  assert.equal(sanitizeNameClient('Игрок😀'), '');
});

test('sanitizeNameClient: сервер НИЧЕГО не меняет в принятом клиентом нике', () => {
  /* Ключевая сверка. Всё, что клиент пропустил, сервер обязан вернуть
     побитово тем же — иначе игрок войдёт в бой под другим ником, чем видел
     в меню. Проверяем именно это направление: клиент строже сервера, так и
     задумано, а вот «клиент пропустил, сервер переделал» — баг. */
  const inputs = [
    'ab',
    'Player_1',
    'Ёжик-ё',
    'A'.repeat(30),
    'Ж'.repeat(30),
    '  a   b  ',
    'x\ty',
    'Игрок 2024',
    '---',
    '___',
    '0123456789012345678',
    'НикНик',
    'a b c d e f g h i j k'
  ];
  for (const inp of inputs) {
    const client = sanitizeNameClient(inp);
    if (!client) continue; // клиент отказал — до сервера не дойдёт
    assert.equal(goSanitizeName(client), client, `сервер переделал ник ${JSON.stringify(client)}`);
    assert.ok(runeLen(client) >= 2 && runeLen(client) <= NAME_MAX_LEN, `длина ${runeLen(client)}`);
  }
});

// --- название комнаты -------------------------------------------------------

test('sanitizeRoomTitleClient: базовая чистка совпадает с серверной', () => {
  const inputs = [
    'Комната',
    '  Комната  ',
    'a\r\nb\tc',
    '<script>',
    'a b',
    'Room #1',
    'x'.repeat(40),
    'Ж'.repeat(40),
    '',
    '   ',
    'a b'
  ];
  for (const inp of inputs) {
    assert.equal(
      sanitizeRoomTitleClient(inp),
      goSanitizeRoomName(inp),
      `расхождение с сервером на ${JSON.stringify(inp)}`
    );
  }
});

test('sanitizeRoomTitleClient: результат клиента сервер не укорачивает', () => {
  /* Слабее предыдущего теста, но переживает известное расхождение по эмодзи
     (см. ниже): важно, что сервер не отрежет ХВОСТ у уже показанного игроку
     названия. Ловит: замену maxLen на что-то больше 32 рун. */
  const inputs = [
    'x'.repeat(40),
    'Ж'.repeat(40),
    'a'.repeat(31) + '\u{1F600}',
    '\u{1F600}'.repeat(20),
    'Комната №' + '9'.repeat(40),
    'a\u{1F600}'.repeat(20)
  ];
  for (const inp of inputs) {
    const client = sanitizeRoomTitleClient(inp);
    assert.ok(runeLen(client) <= ROOM_NAME_MAX_LEN, `клиент отдал ${runeLen(client)} рун: ${client}`);
    assert.equal(
      goSanitizeRoomName(client),
      client,
      `сервер укоротил название ${JSON.stringify(client)}`
    );
  }
});

test('sanitizeRoomTitleClient: известное расхождение по длине с эмодзи', () => {
  /* ЗАФИКСИРОВАННЫЙ БАГ, а не одобрение поведения.
     client_util.js:90 считает `out.length` — это единицы UTF-16, а Go считает
     руны. Каждый астральный символ (эмодзи) на клиенте весит 2, на сервере 1,
     поэтому клиент режет название вдвое раньше сервера.
     Тест намеренно красный-по-смыслу: он ДОКУМЕНТИРУЕТ разницу и упадёт, когда
     её починят — тогда обе ветки ниже надо поменять местами. */
  const twenty = '\u{1F600}'.repeat(20);
  assert.equal(runeLen(goSanitizeRoomName(twenty)), 20, 'сервер принимает 20 эмодзи');
  assert.equal(
    runeLen(sanitizeRoomTitleClient(twenty)),
    16,
    'клиент режет по 32 единицам UTF-16 = 16 эмодзи (расхождение с сервером)'
  );
});

test('sanitizeRoomTitleClient: известное расхождение по пробельным символам', () => {
  /* ЗАФИКСИРОВАННЫЙ БАГ. JS String.trim() и Go strings.TrimSpace обрезают
     РАЗНЫЕ наборы: U+0085 (NEL) пробельный для Go и нет для JS, U+FEFF —
     наоборот. Практических последствий мало, но расхождение реальное. */
  // U+0085 (NEL): пробельный для Go, обычный символ для JS.
  assert.equal(goSanitizeRoomName('\u0085abc'), 'abc', 'сервер срезает NEL');
  assert.equal(sanitizeRoomTitleClient('\u0085abc'), '\u0085abc', 'клиент оставляет NEL');

  // U+FEFF (BOM): пробельный для JS, обычный символ для Go.
  assert.equal(goSanitizeRoomName('\ufeffabc'), '\ufeffabc', 'сервер оставляет BOM');
  assert.equal(sanitizeRoomTitleClient('\ufeffabc'), 'abc', 'клиент срезает BOM');
});

// --- HTML и эмодзи ----------------------------------------------------------

test('escapeHtml: экранирует все пять символов и не двоит амперсанд', () => {
  // Ловит: перестановку .replace(/&/) не в начало — тогда '<' стал бы '&amp;lt;'
  // и в таблице лидеров вместо ника отображался бы сырой '&lt;'.
  assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
  assert.equal(escapeHtml('"q"'), '&quot;q&quot;');
  assert.equal(escapeHtml("it's"), 'it&#39;s');
  assert.equal(escapeHtml('&lt;'), '&amp;lt;', 'амперсанд экранируется первым');
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(escapeHtml(null), 'null');
  assert.equal(escapeHtml(42), '42');
  // В экранированной строке не должно остаться ни одного «живого» символа.
  const out = escapeHtml(`<>&"'`);
  assert.equal(/[<>"']/.test(out), false);
});

test('emojiParseSafeHtml: без эмодзи twemoji не зовётся вовсе', () => {
  // Ловит: обязательный вызов twemoji на каждой строке — это regexp по всему
  // тексту на каждый ник в таблице лидеров каждый кадр.
  let called = 0;
  const prev = globalThis.twemoji;
  globalThis.twemoji = {
    parse(s) {
      called++;
      return s;
    }
  };
  try {
    assert.equal(emojiParseSafeHtml('<b>hi</b>'), '&lt;b&gt;hi&lt;/b&gt;');
    assert.equal(called, 0);
    assert.equal(emojiParseSafeHtml('привет 123'), 'привет 123');
    assert.equal(called, 0);
  } finally {
    if (prev === undefined) delete globalThis.twemoji;
    else globalThis.twemoji = prev;
  }
});

test('emojiParseSafeHtml: экранирование идёт ДО twemoji', () => {
  /* Ловит самую опасную регрессию модуля: если поменять порядок и скормить
     twemoji сырой текст, `<img>` из ника переживёт подстановку и уедет в
     innerHTML как настоящий тег. Проверяем, что twemoji получает уже
     экранированную строку. */
  let seen = null;
  let opts = null;
  const prev = globalThis.twemoji;
  globalThis.twemoji = {
    parse(s, o) {
      seen = s;
      opts = o;
      return s + '|parsed';
    }
  };
  try {
    const out = emojiParseSafeHtml('<img src=x>\u{1F600}');
    assert.equal(seen, '&lt;img src=x&gt;\u{1F600}');
    assert.equal(out, '&lt;img src=x&gt;\u{1F600}|parsed');
    assert.equal(/<img/.test(out), false);

    // Опции подстановки: локальные PNG, а не CDN, и -fe0f отбрасывается.
    assert.equal(opts.className, 'emoji');
    assert.equal(opts.callback('1f44b'), '/emoji-64/1f44b.png');
    assert.equal(opts.callback('203C-FE0F'), '/emoji-64/203c.png');
    assert.deepEqual(opts.attributes(), { loading: 'lazy', decoding: 'async' });
  } finally {
    if (prev === undefined) delete globalThis.twemoji;
    else globalThis.twemoji = prev;
  }
});

test('emojiParseSafeHtml: без twemoji возвращает экранированный текст', () => {
  const prev = globalThis.twemoji;
  delete globalThis.twemoji;
  try {
    assert.equal(emojiParseSafeHtml('<b>\u{1F600}'), '&lt;b&gt;\u{1F600}');
    globalThis.twemoji = { parse: 'не функция' };
    assert.equal(emojiParseSafeHtml('<b>\u{1F600}'), '&lt;b&gt;\u{1F600}');
  } finally {
    if (prev === undefined) delete globalThis.twemoji;
    else globalThis.twemoji = prev;
  }
});

test('EMOJIS: набор быстрых эмодзи без дублей и с локальной картинкой', () => {
  // Ловит: дубль в панели быстрых эмодзи (две одинаковые кнопки) и попадание
  // туда символа, для которого нет файла в public/emoji-64.
  assert.equal(new Set(EMOJIS).size, EMOJIS.length, 'в EMOJIS есть дубли');
  assert.ok(EMOJIS.length >= 8);
  for (const e of EMOJIS) {
    assert.equal(typeof e, 'string');
    assert.ok(/\p{Extended_Pictographic}/u.test(e), `не эмодзи: ${JSON.stringify(e)}`);
  }
});

test('setSafeHtml / setSafeEmojiHtml: null-элемент не роняет', () => {
  // Ловит: снятие охраны `if (!el) return`. Обе функции зовутся по результату
  // getElementById, который на части экранов возвращает null.
  assert.doesNotThrow(() => setSafeHtml(null, 'x'));
  assert.doesNotThrow(() => setSafeEmojiHtml(undefined, 'x'));

  const el = {};
  setSafeHtml(el, '<b>ok</b>');
  assert.equal(el.innerHTML, '<b>ok</b>', 'setSafeHtml не экранирует — это by design');
  setSafeHtml(el, null);
  assert.equal(el.innerHTML, '');

  const el2 = {};
  setSafeEmojiHtml(el2, '<b>ok</b>');
  assert.equal(el2.innerHTML, '&lt;b&gt;ok&lt;/b&gt;', 'setSafeEmojiHtml обязан экранировать');
});

// --- overlayManager ---------------------------------------------------------

test('overlayManager: стек открытых оверлеев без дублей', () => {
  const om = overlayManager;
  om.register('a', { close() {} });
  om.register('b', { close() {} });

  assert.equal(om.getTop(), null, 'стек должен начинаться пустым');
  om.open('a');
  assert.equal(om.getTop(), 'a');
  assert.equal(om.isOpen('a'), true);
  assert.equal(om.isOpen('b'), false);

  om.open('b');
  assert.equal(om.getTop(), 'b');

  // Ловит: повторный open, кладущий второй экземпляр в стек. Тогда одно
  // нажатие Esc закрывало бы оверлей «наполовину» — он оставался бы в стеке.
  om.open('a');
  assert.equal(om.getTop(), 'a');
  om.close('a');
  assert.equal(om.getTop(), 'b', 'после close(a) сверху должен остаться b');
  assert.equal(om.isOpen('a'), false);

  om.close('b');
  assert.equal(om.getTop(), null);

  // Пустые id игнорируются, а не кладутся в стек как ''.
  om.open('');
  om.open('   ');
  om.open(null);
  assert.equal(om.getTop(), null);
  assert.equal(om.isOpen(''), false);
  om.close('нет-такого'); // не должно бросать
});

test('overlayManager: id нормализуется по пробелам', () => {
  const om = overlayManager;
  om.register('  pad  ', { close() {} });
  om.open('pad');
  assert.equal(om.isOpen('  pad  '), true);
  om.close('  pad  ');
  assert.equal(om.isOpen('pad'), false);
});

test('overlayManager: closeTop зовёт close только у верхнего и уважает closable:false', () => {
  const om = overlayManager;
  const hits = [];
  om.register('lower', { close: () => hits.push('lower') });
  om.register('upper', { close: () => hits.push('upper') });
  om.register('locked', { closable: false, close: () => hits.push('locked') });

  assert.equal(om.closeTop(), false, 'пустой стек — закрывать нечего');

  om.open('lower');
  om.open('upper');
  assert.equal(om.closeTop(), true);
  // Ловит: closeTop, закрывающий нижний оверлей — по Esc пропадал бы не тот экран.
  assert.deepEqual(hits, ['upper']);
  // closeTop не выталкивает из стека сам: это делает обработчик через close(id).
  om.close('upper');
  om.close('lower');

  // Ловит: потерю флага closable — модалка «матч завершён» закрывалась бы по Esc.
  om.open('locked');
  assert.equal(om.closeTop(), false);
  assert.deepEqual(hits, ['upper']);
  om.close('locked');

  // Исключение внутри close() не должно всплывать наружу.
  om.register('boom', {
    close() {
      throw new Error('boom');
    }
  });
  om.open('boom');
  assert.equal(om.closeTop(), true);
  om.close('boom');
});

test('overlayManager: trapFocus гоняет фокус по кругу внутри верхнего оверлея', () => {
  const om = overlayManager;
  const mkEl = (name) => ({
    name,
    disabled: false,
    tabIndex: 0,
    focused: 0,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 10, height: 10 }),
    focus() {
      this.focused++;
    }
  });
  const first = mkEl('first');
  const mid = mkEl('mid');
  const last = mkEl('last');
  const hidden = mkEl('hidden');
  hidden.getAttribute = (k) => (k === 'aria-hidden' ? 'true' : null);
  const off = mkEl('off');
  off.tabIndex = -1;
  const gone = mkEl('gone');
  gone.getBoundingClientRect = () => ({ width: 0, height: 0 });
  const dis = mkEl('dis');
  dis.disabled = true;

  const all = [first, dis, hidden, off, gone, mid, last];
  const root = {
    querySelectorAll: () => all,
    contains: (el) => all.includes(el)
  };
  om.register('trapped', { root, close() {} });

  const prevDoc = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    assert.equal(om.trapFocus({ shiftKey: false, preventDefault() {} }), false, 'пустой стек — не трогаем фокус');

    om.open('trapped');

    // Tab с последнего элемента -> на первый.
    globalThis.document.activeElement = last;
    let prevented = 0;
    assert.equal(om.trapFocus({ shiftKey: false, preventDefault: () => prevented++ }), true);
    assert.equal(first.focused, 1);
    assert.equal(prevented, 1);

    // Shift+Tab с первого -> на последний.
    globalThis.document.activeElement = first;
    om.trapFocus({ shiftKey: true, preventDefault() {} });
    assert.equal(last.focused, 1);

    /* Ловит: попадание в список невидимых/выключенных/aria-hidden элементов.
       Фокус бы «проваливался» в скрытую кнопку, и с клавиатуры оверлей
       становился непроходимым. */
    globalThis.document.activeElement = mid;
    const before = { f: first.focused, l: last.focused };
    om.trapFocus({ shiftKey: false, preventDefault() {} });
    assert.deepEqual({ f: first.focused, l: last.focused }, before, 'из середины фокус не двигают');

    // trap: false выключает ловушку целиком.
    om.close('trapped');
    om.register('free', { root, trap: false, close() {} });
    om.open('free');
    assert.equal(om.trapFocus({ shiftKey: false, preventDefault() {} }), false);
    om.close('free');

    // Оверлей без root — тоже не ловушка, а не исключение.
    om.register('rootless', { close() {} });
    om.open('rootless');
    assert.equal(om.trapFocus({ shiftKey: false, preventDefault() {} }), false);
    om.close('rootless');
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
  }
});

test('overlayManager: focusDefault выбирает defaultFocus, иначе первый фокусируемый', () => {
  const om = overlayManager;
  const mk = () => ({
    focused: 0,
    disabled: false,
    tabIndex: 0,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 5, height: 5 }),
    focus() {
      this.focused++;
    }
  });
  const btn = mk();
  const named = mk();
  const root = {
    querySelectorAll: () => [btn],
    querySelector: (sel) => (sel === '#named' ? named : null),
    contains: () => true
  };

  const prevRaf = globalThis.requestAnimationFrame;
  const jobs = [];
  globalThis.requestAnimationFrame = (fn) => jobs.push(fn);
  try {
    om.register('df_none', { root, close() {} });
    om.focusDefault('df_none');
    jobs.splice(0).forEach((f) => f());
    assert.equal(btn.focused, 1, 'без defaultFocus фокус идёт на первый элемент');

    // Селектор строкой.
    om.register('df_sel', { root, defaultFocus: '#named', close() {} });
    om.focusDefault('df_sel');
    jobs.splice(0).forEach((f) => f());
    assert.equal(named.focused, 1);

    // Функция-геттер (root тоже может быть функцией).
    const fnEl = mk();
    om.register('df_fn', { root: () => root, defaultFocus: () => fnEl, close() {} });
    om.focusDefault('df_fn');
    jobs.splice(0).forEach((f) => f());
    assert.equal(fnEl.focused, 1);

    // Незарегистрированный id и оверлей без единого фокусируемого — молча ничего.
    assert.doesNotThrow(() => om.focusDefault('нет-такого'));
    om.register('df_empty', { root: { querySelectorAll: () => [] }, close() {} });
    assert.doesNotThrow(() => om.focusDefault('df_empty'));
    assert.equal(jobs.length, 0);
  } finally {
    if (prevRaf === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = prevRaf;
  }
});
