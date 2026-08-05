/*
 * Разрезанные стили: каскад держится на ПОРЯДКЕ файлов, а не на !important.
 *
 * Пока стили были одним файлом на 6519 строк, порядок гарантировался сам
 * собой. После разреза его гарантирует только шапка index.html, и любая из
 * трёх ошибок — переставили <link>, забыли подключить новый файл, пропустили
 * номер — ломает внешний вид молча: страница откроется, просто часть правил
 * перестанет перекрывать то, что должна.
 *
 * Здесь же — проверки, которые раньше не делал никто:
 *   - скобки в каждом файле сбалансированы (разрез не разорвал правило);
 *   - каждая используемая CSS-переменная где-то определена;
 *   - классы модификаторов, на которые CSS рассчитывает, действительно
 *     навешиваются клиентом. Последнее — не теория: лестница редкости
 *     (.cosmeticsItem.tierLegendary и соседи) была написана в CSS полностью,
 *     а класс тира на карточку не вешался вовсе, и весь блок не рисовался.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CSS_DIR = join(ROOT, 'public', 'css');

const cssFiles = readdirSync(CSS_DIR)
  .filter((f) => f.endsWith('.css'))
  .sort();

const indexHtml = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');

const readCss = (f) => readFileSync(join(CSS_DIR, f), 'utf8');
const allCss = cssFiles.map(readCss).join('\n');

/** Порядок, в котором стили реально подключены в index.html. */
function linkedOrder() {
  const out = [];
  const re = /<link[^>]+href="\/css\/([^"?]+)/g;
  let m;
  while ((m = re.exec(indexHtml)) !== null) out.push(m[1]);
  return out;
}

/** Вырезать комментарии — иначе примеры из них попадают в разбор как код. */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

// --- порядок подключения -----------------------------------------------------

test('каждый файл из public/css подключён в index.html', () => {
  const linked = linkedOrder();
  for (const f of cssFiles) {
    assert.ok(linked.includes(f), `${f} лежит в public/css, но не подключён — его правила не поедут`);
  }
});

test('в index.html не подключено ничего лишнего', () => {
  for (const f of linkedOrder()) {
    assert.ok(cssFiles.includes(f), `index.html ссылается на /css/${f}, которого нет — будет 404`);
  }
});

test('порядок подключения строго по номеру: каскад держится на нём', () => {
  const linked = linkedOrder();
  assert.deepEqual(linked, [...linked].sort(), 'файлы подключены не по возрастанию номера');
  assert.deepEqual(linked, cssFiles, 'порядок в index.html разошёлся с порядком файлов');
});

test('нумерация без дыр и без повторов', () => {
  const nums = cssFiles.map((f) => Number(f.slice(0, 2)));
  assert.deepEqual(nums, [...new Set(nums)], 'два файла с одним номером — порядок между ними не определён');
  for (let i = 0; i < nums.length; i++) {
    assert.equal(nums[i], i + 1, `после ${String(i).padStart(2, '0')} ожидался номер ${i + 1}, а не ${nums[i]}`);
  }
});

test('каждая ссылка на стиль несёт ?v=__BUILD__', () => {
  const re = /<link[^>]+href="\/css\/([^"]+)"/g;
  let m;
  let n = 0;
  while ((m = re.exec(indexHtml)) !== null) {
    n++;
    assert.match(m[1], /\?v=__BUILD__$/, `у /css/${m[1]} нет версии — файл не получит immutable`);
  }
  assert.ok(n > 0, 'в index.html не нашлось ни одной ссылки на стили');
});

// --- целостность разреза -----------------------------------------------------

test('в каждом файле скобки сбалансированы — разрез не разорвал правило', () => {
  for (const f of cssFiles) {
    const src = stripComments(readCss(f));
    let depth = 0;
    for (const ch of src) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      assert.ok(depth >= 0, `${f}: лишняя закрывающая скобка — файл начат с середины правила`);
    }
    assert.equal(depth, 0, `${f}: не закрыто ${depth} скобок — правило разрезано пополам`);
  }
});

test('ни один файл не пуст', () => {
  for (const f of cssFiles) {
    assert.ok(stripComments(readCss(f)).trim().length > 0, `${f} пуст`);
  }
});

/* Классы, которые CSS красит, а навешивает их клиент. Если класс перестанут
   навешивать, правило станет мёртвым и никто этого не заметит: страница
   выглядит «просто попроще». Ровно так пропала вся лестница редкости. */
const CLIENT_JS = readdirSync(join(ROOT, 'public'))
  .filter((f) => /^client.*\.js$/.test(f))
  .map((f) => readFileSync(join(ROOT, 'public', f), 'utf8'))
  .join('\n');

// --- переменные --------------------------------------------------------------

test('каждая используемая CSS-переменная где-то определена', () => {
  const src = stripComments(allCss);

  const defined = new Set();
  for (const m of src.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);

  // Часть переменных задаётся не в стилях, а клиентом в рантайме
  // (element.style.setProperty). Это законное определение: например --p —
  // доля заполнения строки прогресса, её знает только JS.
  for (const m of CLIENT_JS.matchAll(/setProperty\(\s*['"`](--[\w-]+)/g)) defined.add(m[1]);

  const used = new Set();
  for (const m of src.matchAll(/var\(\s*(--[\w-]+)/g)) used.add(m[1]);

  const missing = [...used].filter((v) => !defined.has(v));
  assert.deepEqual(
    missing,
    [],
    `переменные используются, но нигде не заданы — ни в CSS, ни через setProperty: ${missing.join(', ')}`
  );
});

test('переменные темы заданы до первого использования по каскаду', () => {
  // :root в 01-base.css — единственное место, где живёт база токенов.
  const base = stripComments(readCss(cssFiles[0]));
  for (const v of ['--bg', '--text', '--panel', '--border', '--control-h']) {
    assert.match(base, new RegExp(`${v}\\s*:`), `${v} обязан быть определён в ${cssFiles[0]}`);
  }
});

// --- живость модификаторов ---------------------------------------------------

const MODIFIERS = [
  'tierBase',
  'tierCommon',
  'tierRare',
  'tierEpic',
  'tierLegendary',
  'tierMythic',
  'isSelected',
  'isOwned',
  'isEquipped',
  'isLocked',
  'deathStatRecord',
  'menuMetaRow',
  'matchRowMe',
  'topHudPhase'
];

test('модификаторы, описанные в CSS, действительно навешиваются клиентом', () => {
  const css = stripComments(allCss);
  const dead = [];
  for (const cls of MODIFIERS) {
    const inCss = css.includes(`.${cls}`);
    // Класс может собираться шаблоном (`tier${...}`), поэтому ищем и имя целиком,
    // и его «хвост» после заглавной — так ловится сборка через tierClass().
    const inJs = CLIENT_JS.includes(cls) || CLIENT_JS.includes(cls.replace(/^tier/, ''));
    if (inCss && !inJs) dead.push(cls);
  }
  assert.deepEqual(dead, [], `CSS красит классы, которых клиент не ставит: ${dead.join(', ')}`);
});

test('лестница редкости навешивается на саму карточку, а не только на разделитель', () => {
  // Регрессия, ради которой этот тест и написан: класс тира ставился только на
  // .cosmeticsTierSep, поэтому .cosmeticsItem.tierLegendary/.tierMythic и цвет
  // цены по тиру не срабатывали ни разу.
  assert.match(
    CLIENT_JS,
    /cosmeticsItem \$\{tierClass\(/,
    'на .cosmeticsItem не вешается класс тира — блок D11 в CSS снова станет мёртвым'
  );
});

/* --- Наслоения: сколько раз один селектор объявлен ---------------------------
   Файл вырос из десяти «волн», где каждая правка не редактировала правило, а
   дописывала новое поверх. Так #topHud оказался объявлен в пяти местах трёх
   файлов, и понять итоговую раскладку можно было только в devtools.

   Тест не запрещает повторы совсем — у медиазапросов они законны, — а держит
   потолок. Если он падает, правильный ответ не «поднять число», а сложить
   объявления в одно место. */

function parseRules(src) {
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const out = [];
  const walk = (text, media) => {
    let i = 0, start = 0;
    while (i < text.length) {
      if (text[i] === '{') {
        const head = text.slice(start, i).trim().replace(/\s+/g, ' ');
        let depth = 1, j = i + 1;
        while (j < text.length && depth) {
          if (text[j] === '{') depth++;
          else if (text[j] === '}') depth--;
          j++;
        }
        const body = text.slice(i + 1, j - 1);
        if (head.startsWith('@')) {
          const at = head.split(/\s+/)[0].toLowerCase();
          // keyframes: внутри «from/to/50%», а не селекторы
          if (!['@keyframes', '@-webkit-keyframes', '@font-face', '@property'].includes(at)) {
            walk(body, media.concat(head));
          }
        } else if (head) {
          out.push({ sel: head, media });
        }
        i = j;
        start = i;
        continue;
      }
      i++;
    }
  };
  walk(clean, []);
  return out;
}

const allRules = cssFiles.flatMap((f) => parseRules(readCss(f)));

/* :root исключён намеренно: это контейнер токенов, а не компонент. Каждое
   его объявление — набор переменных для своего медиазапроса или темы, и
   «сложить их в одно место» нельзя по определению. */
const LAYER_CAP = 5;

test(`ни один селектор, кроме :root, не объявлен больше ${LAYER_CAP} раз`, () => {
  const counts = new Map();
  for (const r of allRules) {
    if (r.sel === ':root' || r.sel.startsWith('html[data-theme')) continue;
    counts.set(r.sel, (counts.get(r.sel) || 0) + 1);
  }
  const worst = [...counts.entries()].filter(([, n]) => n > LAYER_CAP).sort((a, b) => b[1] - a[1]);
  assert.deepEqual(
    worst,
    [],
    'селекторы размазаны по файлам — сложите их в одно место: ' +
      worst.map(([s, n]) => `${s} (${n}×)`).join('; ')
  );
});

test('повторные объявления одного селектора различаются медиазапросом', () => {
  // Два объявления в ОДНОМ медиаконтексте — это уже не вариант под экран, а
  // забытая правка поверх старой: именно так копился монолит.
  const byKey = new Map();
  for (const r of allRules) {
    if (r.sel === ':root' || r.sel.startsWith('html[data-theme')) continue;
    const k = JSON.stringify([r.media, r.sel]);
    byKey.set(k, (byKey.get(k) || 0) + 1);
  }
  const dup = [...byKey.entries()].filter(([, n]) => n > 2);
  assert.deepEqual(
    dup,
    [],
    'один селектор объявлен 3+ раз в одном медиаконтексте: ' +
      dup.map(([k, n]) => JSON.parse(k)[1] + ` (${n}×)`).join('; ')
  );
});

test('нет пустых @media-блоков', () => {
  for (const f of cssFiles) {
    const src = stripComments(readCss(f));
    assert.equal(
      /@(?:media|supports)[^{]*\{\s*\}/.test(src),
      false,
      `${f}: пустой @media — остался от удалённого правила`
    );
  }
});

test('grid-свойства не назначаются элементам, переведённым в flex', () => {
  // Регрессия из разбора: .topHudRow переведён в display:flex, но в трёх
  // местах ему и его детям продолжали задавать grid-template-columns и
  // grid-column — объявления инертны и только маскировали реальную раскладку.
  const css = stripComments(allCss);
  const flexRow = /\.topHudRow\s*\{[^}]*display:\s*flex/.test(css);
  if (!flexRow) return; // раскладку сменили — тест неактуален
  assert.equal(
    /\.topHudRow\s*\{[^}]*grid-template-columns/.test(css),
    false,
    '.topHudRow выложен flex-ом — grid-template-columns на нём не действует'
  );
});
