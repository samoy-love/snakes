/*
 * public/client_i18n.js — исполняемые тесты словарей.
 *
 * Почему это важнее, чем выглядит. t() устроен так:
 *     pack[k] ?? I18N.ru[k] ?? k
 * то есть отсутствующий ключ НЕ падает и НЕ логируется — он рендерится на
 * экран как сырая строка вида «cosmetics.progress_of». В этом проекте так
 * ломалось трижды. Единственный способ поймать это заранее — сверить набор
 * ключей словарей с набором ключей, реально используемых в коде и в вёрстке.
 *
 * Модуль импортируется по-настоящему (это только данные, DOM ему не нужен),
 * а использование ключей вычитывается сканом исходников — иначе пришлось бы
 * поднимать весь client.js.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { I18N, RU, EN, BOT_NAMES_RU, BOT_NAMES_EN } from '../public/client_i18n.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', 'public');

const LANGS = ['ru', 'en'];

// Плейсхолдеры подстановки tfmt(): /\{(\w+)\}/g — ровно тот же разбор.
const placeholders = (s) =>
  [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

function clientSources() {
  return readdirSync(PUBLIC)
    .filter((f) => /^client.*\.js$/.test(f))
    .sort()
    .map((f) => [f, readFileSync(join(PUBLIC, f), 'utf8')]);
}

/* Ключи, которые код действительно спрашивает у словаря:
   - t('...') и tfmt('...') в любом client*.js;
   - data-i18n / data-i18n-placeholder / data-i18n-* в index.html.
   Динамические ключи (t('cos.' + cat)) сюда не попадают — их проверить
   статически нельзя, и это честно отмечено в отчёте. */
function usedKeys() {
  const used = new Map(); // key -> где встретился
  for (const [file, src] of clientSources()) {
    for (const m of src.matchAll(/\b(?:t|tfmt)\(\s*'([^'\n]+)'/g)) {
      if (!used.has(m[1])) used.set(m[1], file);
    }
  }
  const html = readFileSync(join(PUBLIC, 'index.html'), 'utf8');
  for (const m of html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) {
    if (!used.has(m[1])) used.set(m[1], 'index.html');
  }
  return used;
}

// --- структура словарей -----------------------------------------------------

test('I18N: словари ru и en существуют и непустые', () => {
  for (const l of LANGS) {
    assert.equal(typeof I18N[l], 'object', `нет словаря ${l}`);
    assert.ok(Object.keys(I18N[l]).length > 300, `словарь ${l} подозрительно мал`);
  }
});

test('I18N: наборы ключей ru и en совпадают до одного ключа', () => {
  /* Ловит ГЛАВНУЮ регрессию модуля: ключ добавили в ru и забыли в en.
     Из-за фолбэка `?? I18N.ru[k]` английский интерфейс молча покажет
     русскую строку, и в тестах/на глаз это не видно. */
  const ru = new Set(Object.keys(I18N.ru));
  const en = new Set(Object.keys(I18N.en));
  const missEn = [...ru].filter((k) => !en.has(k));
  const missRu = [...en].filter((k) => !ru.has(k));
  assert.deepEqual(missEn, [], `есть в ru, нет в en: ${missEn.join(', ')}`);
  assert.deepEqual(missRu, [], `есть в en, нет в ru: ${missRu.join(', ')}`);
  assert.equal(ru.size, en.size);
});

test('I18N: ни одного пустого или нестрокового значения', () => {
  // Ловит: заготовку 'ключ': '' — на экране будет пустое место без всякой
  // диагностики (t() вернёт '' как валидное значение, а не провалится в фолбэк).
  const bad = [];
  for (const l of LANGS) {
    for (const [k, v] of Object.entries(I18N[l])) {
      if (typeof v !== 'string' || v.trim() === '') bad.push(`${l}:${k}`);
    }
  }
  assert.deepEqual(bad, [], `пустые значения: ${bad.join(', ')}`);
});

test('I18N: плейсхолдеры {n} совпадают между ru и en', () => {
  /* Ловит: перевод, потерявший или переименовавший подстановку. tfmt()
     заменяет только известные имена, остальное оставляет как есть — игрок
     увидит буквальный «{cur} / {max}» вместо чисел. */
  const bad = [];
  for (const k of Object.keys(I18N.ru)) {
    if (!(k in I18N.en)) continue;
    const a = placeholders(I18N.ru[k]);
    const b = placeholders(I18N.en[k]);
    if (a !== b) bad.push(`${k}: ru{${a}} != en{${b}}`);
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('I18N: нет незакрытых или пустых фигурных скобок', () => {
  // Ловит: опечатку '{cur / {max}' — tfmt её не заменит, и подстановка
  // вылезет в интерфейс сырой.
  const bad = [];
  for (const l of LANGS) {
    for (const [k, v] of Object.entries(I18N[l])) {
      const opens = (v.match(/\{/g) || []).length;
      const closes = (v.match(/\}/g) || []).length;
      if (opens !== closes) bad.push(`${l}:${k} — скобки не сбалансированы: ${JSON.stringify(v)}`);
      if (/\{\s*\}/.test(v)) bad.push(`${l}:${k} — пустая подстановка {}`);
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

// --- сверка с кодом ---------------------------------------------------------

test('I18N: каждый используемый в коде ключ есть в ОБОИХ словарях', () => {
  /* Тот самый тест, ради которого файл написан. Отсутствующий ключ виден
     игроку как техническая строка посреди интерфейса. Проверяем оба языка:
     фолбэк на ru прячет дыру в en, поэтому «есть в ru» — недостаточно. */
  const used = usedKeys();
  assert.ok(used.size > 250, `найдено всего ${used.size} ключей — сломался сканер`);

  const missing = [];
  for (const [k, where] of used) {
    for (const l of LANGS) {
      if (!(k in I18N[l])) missing.push(`${k} (нет в ${l}, использован в ${where})`);
    }
  }
  assert.deepEqual(missing, [], `недостающие ключи:\n${missing.join('\n')}`);
});

test('I18N: подстановки в словаре покрыты вызовами tfmt, а не t', () => {
  /* Ловит: t('bot.badge_title') вместо tfmt(...). t() подстановку не делает,
     и на экран уедет «Бот: {arch}, {tier}». Ошибка визуально незаметная в
     коде и очень заметная в игре. */
  const [srcAll] = [clientSources().map(([, s]) => s).join('\n')];
  const plainT = new Set();
  for (const m of srcAll.matchAll(/(?<!tfm)\bt\(\s*'([^'\n]+)'\s*\)/g)) plainT.add(m[1]);

  const bad = [];
  for (const k of plainT) {
    const v = I18N.ru[k];
    if (typeof v === 'string' && /\{\w+\}/.test(v)) bad.push(`${k}: ${JSON.stringify(v)}`);
  }
  assert.deepEqual(bad, [], `у этих ключей есть {подстановка}, но их зовут через t():\n${bad.join('\n')}`);
});

test('I18N: в словарях нет ключей-сирот, кроме заведомо динамических', () => {
  /* Мягкая проверка: неиспользуемые ключи — это не поломка, а мусор, который
     копится и мешает читать словарь. Порог, а не ноль, потому что часть
     ключей собирается динамически (t(pref + id)) и статически не видна. */
  const used = usedKeys();
  const orphans = Object.keys(I18N.ru).filter((k) => !used.has(k));
  assert.ok(
    orphans.length < Object.keys(I18N.ru).length * 0.35,
    `слишком много неиспользуемых ключей (${orphans.length} из ${Object.keys(I18N.ru).length}): ${orphans.slice(0, 20).join(', ')}`
  );
});

// --- инфопаки RU/EN ---------------------------------------------------------

test('RU/EN: структура инфопаков совпадает по разделам и идентификаторам', () => {
  /* Ловит: описание предмета/контракта, добавленное только в один язык.
     infoPack() выбирает пак по языку и лезет в него по числовому id —
     промах даёт undefined и пустую карточку в магазине. */
  const secRu = Object.keys(RU).sort();
  const secEn = Object.keys(EN).sort();
  assert.deepEqual(secRu, secEn, 'разные разделы в RU и EN');

  const bad = [];
  for (const sec of secRu) {
    const a = Object.keys(RU[sec]).sort();
    const b = Object.keys(EN[sec]).sort();
    const onlyRu = a.filter((k) => !b.includes(k));
    const onlyEn = b.filter((k) => !a.includes(k));
    if (onlyRu.length) bad.push(`${sec}: только в RU — ${onlyRu.join(', ')}`);
    if (onlyEn.length) bad.push(`${sec}: только в EN — ${onlyEn.join(', ')}`);
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('RU/EN: у каждой записи инфопака совпадает набор полей и нет пустых строк', () => {
  // Ловит: запись с name, но без desc в одном из языков — карточка в магазине
  // получит пустое описание вместо текста.
  const bad = [];
  for (const sec of Object.keys(RU)) {
    for (const id of Object.keys(RU[sec])) {
      const a = RU[sec][id];
      const b = EN[sec]?.[id];
      if (typeof a === 'string') {
        if (typeof b !== 'string') bad.push(`${sec}.${id}: RU строка, EN — нет`);
        if (!a.trim()) bad.push(`${sec}.${id}: пустая строка в RU`);
        if (typeof b === 'string' && !b.trim()) bad.push(`${sec}.${id}: пустая строка в EN`);
        continue;
      }
      if (!a || typeof a !== 'object' || !b || typeof b !== 'object') {
        bad.push(`${sec}.${id}: несовместимые типы`);
        continue;
      }
      const fa = Object.keys(a).sort().join(',');
      const fb = Object.keys(b).sort().join(',');
      if (fa !== fb) bad.push(`${sec}.${id}: поля RU[${fa}] != EN[${fb}]`);
      for (const [lang, obj] of [['RU', a], ['EN', b]]) {
        for (const [f, v] of Object.entries(obj)) {
          if (typeof v === 'string' && !v.trim()) bad.push(`${sec}.${id}.${f}: пусто в ${lang}`);
        }
      }
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

// --- имена ботов ------------------------------------------------------------

test('BOT_NAMES: одинаковая длина списков, без дублей и в пределах лимита ника', () => {
  /* Имя бота придумывает клиент и показывает в таблице лидеров рядом с
     никами живых игроков. Ловит: (а) дубль — два бота с одним именем в одной
     комнате неотличимы; (б) имя длиннее 18 рун — сервер бы его обрезал, а
     клиент показал целиком; (в) разъехавшуюся длину списков, из-за которой
     смена языка меняла бы состав ботов. */
  assert.equal(BOT_NAMES_RU.length, BOT_NAMES_EN.length, 'списки имён ботов разной длины');
  assert.ok(BOT_NAMES_RU.length >= 16);
  for (const [name, list] of [['RU', BOT_NAMES_RU], ['EN', BOT_NAMES_EN]]) {
    assert.equal(new Set(list).size, list.length, `дубли в BOT_NAMES_${name}`);
    for (const n of list) {
      assert.equal(typeof n, 'string');
      assert.ok(n.trim() === n && n !== '', `«${n}» в BOT_NAMES_${name} с пробелами по краям`);
      assert.ok([...n].length <= 18, `«${n}» длиннее 18 символов — сервер обрежет`);
      assert.equal(/[<>]/.test(n), false, `«${n}» содержит угловые скобки`);
    }
  }
});
