/*
 * Грубый статический аудит области видимости JS-исходника без парсера.
 *
 * Зачем не настоящий парсер (acorn/espree). Единственная JS-зависимость
 * проекта — Playwright, и только для tests/visual (см. CLAUDE.md). Ставить
 * вторую ради линтера — цена выше пользы: этот файл ловит ровно один класс
 * регрессии (рефакторинг вынес/переименовал переменную и забыл поправить
 * дальнее использование) и не претендует на полноту настоящего no-undef.
 *
 * Зачем не запуск самого client.js (client_contract.test.mjs уже объясняет
 * это для разбора протокола): монолит на ~490 КБ, намертво завязанный на
 * DOM/canvas/WebSocket/localStorage/twemoji — поднимать под него шим ради
 * одной функции дороже и хрупче, чем прочитать её текст.
 *
 * Как это работает: строки/шаблонные литералы и комментарии затираются
 * пробелами (включая содержимое `${...}` внутри вложенных шаблонов — см.
 * maskNonCode ниже, она честно спускается в интерполяции, а не тупо режет
 * до следующей кавычки). Затем собираются два множества идентификаторов —
 * «объявлено» (const/let/var/function/import/параметры/деструктуризация) и
 * «использовано» (голые идентификаторы, не после `.`/`?.`, не ключ объекта
 * `key:`). Всё использованное, чего нет ни в «объявлено», ни в списке
 * известных глобалов, — кандидат в баг класса «ReferenceError на боевом коде».
 *
 * Ложноотрицательные срабатывания ожидаемы (тернарник `cond ? a : b` — `a`
 * перед двоеточием по ошибке трактуется как ключ объекта и выпадает из
 * проверки; замыкания сложнее функции/блока не различаются). Ложноположительных
 * быть не должно — если тест начал ругаться на реально объявленное имя,
 * значит извлечение declared-имён не покрыло какой-то синтаксис, чини
 * extractDeclared, а не глуши предупреждение.
 */

const RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'export', 'extends', 'false', 'finally', 'for',
  'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'null', 'of',
  'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var',
  'void', 'while', 'with', 'yield', 'async', 'await', 'static', 'get', 'set'
]);

// Глобалы браузера/JS, которых нет и не будет среди объявлений client.js.
const KNOWN_GLOBALS = new Set([
  'window', 'document', 'console', 'Math', 'Date', 'JSON', 'Object', 'Array',
  'String', 'Number', 'Boolean', 'RegExp', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'Promise', 'Symbol', 'Proxy', 'Reflect', 'Error', 'TypeError', 'RangeError',
  'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout',
  'clearTimeout', 'setInterval', 'clearInterval', 'navigator', 'localStorage',
  'sessionStorage', 'WebSocket', 'Image', 'Path2D', 'ImageData', 'globalThis',
  'self', 'undefined', 'NaN', 'Infinity', 'isNaN', 'isFinite', 'parseInt',
  'parseFloat', 'encodeURIComponent', 'decodeURIComponent', 'fetch',
  'AbortController', 'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent',
  'PointerEvent', 'TouchEvent', 'FocusEvent', 'ResizeObserver',
  'IntersectionObserver', 'MutationObserver', 'structuredClone', 'crypto',
  'requestIdleCallback', 'cancelIdleCallback', 'arguments', 'DOMException',
  'ArrayBuffer', 'DataView', 'Uint8Array', 'Uint16Array', 'Uint32Array',
  'Int8Array', 'Int16Array', 'Int32Array', 'Float32Array', 'Float64Array'
]);

const IDENT = '[A-Za-z_$][\\w$]*';

const SPACE = ' ';
const NEWLINE = '\n';

/** Затирает строковые/шаблонные литералы и комментарии пробелами (не трогая
 *  переносы строк). Шаблонные литералы умеют вкладываться
 *  (backtick ... ${cond ? backtick ... backtick : b} ... backtick), поэтому
 *  это не плоский цикл «до следующей одиночной кавычки»: `scan` рекурсивно
 *  спускается в `${...}`, считая глубину { }, и в саму вложенную шаблонную
 *  строку — иначе первый же внутренний backtick ошибочно закрывает внешний
 *  шаблон, и хвост строки читается как код. */
export function maskNonCode(source) {
  const out = [];
  const n = source.length;

  function scan(startIndex, mode) {
    let i = startIndex;
    while (i < n) {
      const c = source[i];
      const c2 = source[i + 1];

      if (mode === 'template') {
        if (c === '\\') { out.push(SPACE, SPACE); i += 2; continue; }
        if (c === '`') { out.push(SPACE); return i + 1; }
        if (c === '$' && c2 === '{') {
          out.push(SPACE, SPACE);
          i = scan(i + 2, 'expr');
          continue;
        }
        out.push(c === NEWLINE ? NEWLINE : SPACE);
        i++;
        continue;
      }

      if (mode === 'expr' && c === '}') {
        out.push(SPACE);
        return i + 1;
      }

      if (c === '/' && c2 === '/') {
        while (i < n && source[i] !== NEWLINE) { out.push(SPACE); i++; }
        continue;
      }
      if (c === '/' && c2 === '*') {
        out.push(SPACE, SPACE);
        i += 2;
        while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
          out.push(source[i] === NEWLINE ? NEWLINE : SPACE);
          i++;
        }
        out.push(SPACE, SPACE);
        i += 2;
        continue;
      }
      if (c === '"' || c === "'") {
        const quote = c;
        out.push(SPACE);
        i++;
        while (i < n && source[i] !== quote) {
          if (source[i] === '\\') { out.push(SPACE, SPACE); i += 2; continue; }
          out.push(source[i] === NEWLINE ? NEWLINE : SPACE);
          i++;
        }
        out.push(SPACE);
        i++;
        continue;
      }
      if (c === '`') {
        out.push(SPACE);
        i = scan(i + 1, 'template');
        continue;
      }
      if (mode === 'expr' && c === '{') {
        // Вложенный объектный литерал/блок внутри интерполяции — глубину {}
        // считает сам рекурсивный вызов (возврат в режим 'expr' закрывается
        // на ЕГО собственной парной `}`), иначе первая же `}` объекта
        // закрыла бы интерполяцию раньше времени.
        out.push(SPACE);
        i = scan(i + 1, 'expr');
        continue;
      }

      out.push(c);
      i++;
    }
    return i;
  }

  scan(0, 'top');
  return out.join('');
}

function declaratorNames(fragment) {
  // fragment: то, что между `const/let/var` и завершающим `;`/концом строки —
  // может быть списком через запятую с деструктуризацией и инициализаторами.
  // Разбиваем СТРОГО по индексам верхнеуровневых запятых (не split(' ') —
  // в инициализаторе `cell = cellSizeFor({ cw, viewH })` пробелов и так
  // достаточно, чтобы раздробить один declarator на мусорные «слова»).
  const names = [];
  let depth = 0;
  let partStart = 0;
  const parts = [];
  for (let i = 0; i < fragment.length; i++) {
    const ch = fragment[i];
    if ('{[('.includes(ch)) depth++;
    else if ('}])'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      parts.push(fragment.slice(partStart, i));
      partStart = i + 1;
    }
  }
  parts.push(fragment.slice(partStart));

  for (const part of parts) {
    let decl = part;
    // Срезаем инициализатор верхнего уровня (первый `=` не часть `==`/`=>`/`<=`/`>=`).
    let d = 0;
    for (let i = 0; i < decl.length; i++) {
      const ch = decl[i];
      if ('{[('.includes(ch)) d++;
      else if ('}])'.includes(ch)) d--;
      if (ch === '=' && d === 0 && decl[i + 1] !== '=' && decl[i - 1] !== '=' && decl[i - 1] !== '!' &&
          decl[i - 1] !== '<' && decl[i - 1] !== '>' && decl[i + 1] !== '>') {
        decl = decl.slice(0, i);
        break;
      }
    }
    decl = decl.trim();
    if (!decl) continue;
    if (decl[0] === '{' || decl[0] === '[') {
      // Деструктуризация: имена — это простые идентификаторы на этом уровне,
      // включая переименования `a: renamed` (берём renamed) и `...rest`.
      const inner = decl.slice(1, -1);
      const re = new RegExp(`(?:^|[,{[:])\\s*(?:\\.\\.\\.)?(${IDENT})\\s*(?=[,}\\]]|$)`, 'g');
      let m;
      while ((m = re.exec(inner))) names.push(m[1]);
    } else {
      const m = decl.match(new RegExp(`^(${IDENT})`));
      if (m) names.push(m[1]);
    }
  }
  return names;
}

/** Собирает имена, объявленные в куске исходника (уже без строк/комментариев):
 *  const/let/var (с деструктуризацией), function name(...), параметры функций
 *  и стрелочных функций, import {..} from. */
export function extractDeclared(maskedSource) {
  const declared = new Set();

  const declRe = new RegExp(`\\b(?:const|let|var)\\s+([^;\\n]+)`, 'g');
  let m;
  while ((m = declRe.exec(maskedSource))) {
    for (const name of declaratorNames(m[1])) declared.add(name);
  }

  const fnRe = new RegExp(`\\bfunction\\s*(?:${IDENT})?\\s*\\(([^)]*)\\)`, 'g');
  while ((m = fnRe.exec(maskedSource))) {
    for (const p of paramNames(m[1])) declared.add(p);
  }
  const fnNameRe = new RegExp(`\\bfunction\\s+(${IDENT})`, 'g');
  while ((m = fnNameRe.exec(maskedSource))) declared.add(m[1]);

  // Стрелочные функции: (a, b) => или a =>
  const arrowParenRe = new RegExp(`\\(([^()]*)\\)\\s*=>`, 'g');
  while ((m = arrowParenRe.exec(maskedSource))) {
    for (const p of paramNames(m[1])) declared.add(p);
  }
  const arrowBareRe = new RegExp(`(?:^|[^\\w$])(${IDENT})\\s*=>`, 'g');
  while ((m = arrowBareRe.exec(maskedSource))) {
    if (!RESERVED.has(m[1])) declared.add(m[1]);
  }

  // catch (e)
  const catchRe = new RegExp(`\\bcatch\\s*\\(([^)]*)\\)`, 'g');
  while ((m = catchRe.exec(maskedSource))) {
    for (const p of paramNames(m[1])) declared.add(p);
  }

  // import Default, { a, b as c } from '...'
  const importRe = /\bimport\s+([^;]+?)\s+from\b/g;
  while ((m = importRe.exec(maskedSource))) {
    const clause = m[1];
    const braceMatch = clause.match(/\{([^}]*)\}/);
    const before = braceMatch ? clause.slice(0, braceMatch.index) : clause;
    const defaultName = before.replace(/\*\s*as\s+\S+/, '').split(',')[0].trim();
    if (defaultName && new RegExp(`^${IDENT}$`).test(defaultName)) declared.add(defaultName);
    if (braceMatch) {
      for (const raw of braceMatch[1].split(',')) {
        const piece = raw.trim();
        if (!piece) continue;
        const asMatch = piece.match(new RegExp(`^${IDENT}\\s+as\\s+(${IDENT})$`));
        declared.add(asMatch ? asMatch[1] : piece);
      }
    }
    const nsMatch = clause.match(new RegExp(`\\*\\s*as\\s+(${IDENT})`));
    if (nsMatch) declared.add(nsMatch[1]);
  }

  return declared;
}

function paramNames(paramsSrc) {
  const names = [];
  let depth = 0;
  let cur = '';
  const parts = [];
  for (const ch of paramsSrc) {
    if ('{[('.includes(ch)) depth++;
    else if ('}])'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  for (const part of parts) {
    let p = part.replace(/^\.\.\./, '').trim();
    // Срезаем значение по умолчанию.
    let d = 0;
    for (let i = 0; i < p.length; i++) {
      if ('{[('.includes(p[i])) d++;
      else if ('}])'.includes(p[i])) d--;
      if (p[i] === '=' && d === 0) { p = p.slice(0, i); break; }
    }
    p = p.trim();
    if (!p) continue;
    if (p[0] === '{' || p[0] === '[') {
      for (const nm of declaratorNames(p)) names.push(nm);
    } else {
      const m = p.match(new RegExp(`^(${IDENT})`));
      if (m) names.push(m[1]);
    }
  }
  return names;
}

/** Голые идентификаторы-«прочтения»: не после `.`, не ключ объекта `x:`,
 *  не зарезервированное слово. */
export function extractUsed(maskedSource) {
  const used = [];
  const re = new RegExp(`(?<![.\\w$])(${IDENT})(?![\\w$])`, 'g');
  let m;
  while ((m = re.exec(maskedSource))) {
    const name = m[1];
    if (RESERVED.has(name)) continue;
    const after = maskedSource.slice(m.index + name.length).match(/^\s*/)[0].length;
    if (maskedSource[m.index + name.length + after] === ':') continue; // ключ объекта / case-подобное
    used.push(name);
  }
  return used;
}

export function unknownIdentifiers(maskedFragment, knownExtra = []) {
  const declared = extractDeclared(maskedFragment);
  const known = new Set([...RESERVED, ...KNOWN_GLOBALS, ...declared, ...knownExtra]);
  const used = extractUsed(maskedFragment);
  const unknown = [];
  for (const name of used) {
    if (!known.has(name)) unknown.push(name);
  }
  return [...new Set(unknown)];
}
