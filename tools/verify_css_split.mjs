/*
 * tools/verify_css_split.mjs — доказывает, что распил public/css/*.css не
 * поменял ни одного computed style. Разовый скрипт проверки, не часть
 * рантайма и не часть тестов CI (тесты по структуре — tests/style_split.test.mjs).
 *
 * Метод: поднимает index.html + актуальные CSS дважды через jsdom — один раз
 * взяв файлы из HEAD (состояние до распила), один раз из рабочего дерева
 * (после), — применяет один и тот же набор состояний (тема, модификаторы
 * карточек, открытые панели) и сравнивает getComputedStyle каждого элемента
 * по каждому CSS-свойству. Расхождение — это провал, а не предупреждение.
 *
 *   node tools/verify_css_split.mjs
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

function readAtRef(ref, relPath) {
  return execSync(`git show ${ref}:${relPath.split(path.sep).join('/')}`, { cwd: ROOT, encoding: 'utf8' });
}

function cssFilesAtRef(ref) {
  const listing = execSync(`git ls-tree -r --name-only ${ref} -- public/css`, { cwd: ROOT, encoding: 'utf8' });
  return listing
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.endsWith('.css'))
    .sort();
}

import { readFileSync, readdirSync } from 'node:fs';

function cssFilesWorkingTree() {
  return readdirSync(path.join(ROOT, 'public', 'css'))
    .filter((f) => f.endsWith('.css'))
    .sort()
    .map((f) => `public/css/${f}`);
}

/** Строит DOM с инлайнированными стилями (в порядке файлов) и applied modifiers. */
function buildDom(indexHtml, cssTexts, { theme, modifierClasses = [] } = {}) {
  const styleTags = cssTexts.map((css) => `<style>${css}</style>`).join('\n');
  const html = indexHtml.replace(
    /<link[^>]+href="\/css\/[^"]+"[^>]*\/?>/g,
    (m, offset, str) => (str.indexOf(m) === offset ? styleTags : '')
  );
  const dom = new JSDOM(html, { url: 'http://localhost/' });
  const { document } = dom.window;
  if (theme) document.documentElement.setAttribute('data-theme', theme);
  for (const cls of modifierClasses) {
    // применяем модификатор ко всем элементам с базовым классом-кандидатом,
    // чтобы правило .foo.isSelected и т.п. реально сработало хоть где-то
    for (const el of document.querySelectorAll('[class]')) el.classList.add(cls);
  }
  return dom;
}

/** Путь элемента в дереве BODY по индексам среди детей — не зависит от
 * количества инжектированных <style>/<link>, которое у старой и новой
 * разметки разное (6 файлов против 11), но одинаково для одного и того же
 * элемента body-разметки в обоих снимках. */
function domPath(el) {
  const parts = [];
  let node = el;
  while (node && node.tagName && node.tagName !== 'BODY') {
    const parent = node.parentElement;
    if (!parent) break;
    const idx = Array.prototype.indexOf.call(parent.children, node);
    parts.unshift(`${node.tagName}[${idx}]`);
    node = parent;
  }
  return parts.join('>');
}

/** Снимок computed style свойств элементов реальной разметки (head/style/link/
 * script исключены — они не часть проверяемой разметки страницы). */
function snapshot(dom) {
  const { document, getComputedStyle } = dom.window;
  const SKIP_TAGS = new Set(['STYLE', 'LINK', 'SCRIPT', 'HEAD', 'TITLE', 'META']);
  const out = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (SKIP_TAGS.has(el.tagName)) continue;
    const cs = getComputedStyle(el);
    const props = [];
    for (let p = 0; p < cs.length; p++) {
      const name = cs.item(p);
      props.push(`${name}=${cs.getPropertyValue(name)}`);
    }
    props.sort();
    out.push(`${domPath(el)} <${el.tagName} id=${el.id || ''} class="${el.className || ''}"> ${props.join('|')}`);
  }
  out.sort();
  return out.join('\n');
}

const STATES = [
  { name: 'dark-default', theme: null, modifierClasses: [] },
  { name: 'light', theme: 'light', modifierClasses: [] },
  {
    name: 'modifiers',
    theme: null,
    modifierClasses: [
      'isSelected',
      'isOwned',
      'isEquipped',
      'isLocked',
      'isActive',
      'isOn',
      'open',
      'collapsed',
      'hidden',
      'tierLegendary',
      'tierMythic',
      'deathStatRecord',
      'menuMetaRow',
      'matchRowMe',
      'topHudPhase',
    ],
  },
];

const OLD_REF = process.argv[2] || 'HEAD';

console.log(`сравниваю CSS working tree против ${OLD_REF}...`);

const oldIndexHtml = readAtRef(OLD_REF, 'public/index.html');
const oldCssFiles = cssFilesAtRef(OLD_REF);
const oldCssTexts = oldCssFiles.map((f) => readAtRef(OLD_REF, f));

const newIndexHtml = readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const newCssFiles = cssFilesWorkingTree();
const newCssTexts = newCssFiles.map((f) => readFileSync(path.join(ROOT, f), 'utf8'));

console.log(`  ${OLD_REF}: ${oldCssFiles.length} файлов — ${oldCssFiles.join(', ')}`);
console.log(`  рабочее дерево: ${newCssFiles.length} файлов — ${newCssFiles.join(', ')}`);

let failed = false;
for (const state of STATES) {
  const oldDom = buildDom(oldIndexHtml, oldCssTexts, state);
  const newDom = buildDom(newIndexHtml, newCssTexts, state);
  const oldSnap = snapshot(oldDom);
  const newSnap = snapshot(newDom);
  if (oldSnap === newSnap) {
    console.log(`  [ok] состояние "${state.name}": computed style идентичен, 0 расхождений`);
  } else {
    failed = true;
    const oldLines = oldSnap.split('\n');
    const newLines = newSnap.split('\n');
    console.log(`  [FAIL] состояние "${state.name}": снимки расходятся`);
    for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
      if (oldLines[i] !== newLines[i]) {
        console.log(`    строка ${i}:`);
        console.log(`      было:  ${(oldLines[i] || '<нет>').slice(0, 300)}`);
        console.log(`      стало: ${(newLines[i] || '<нет>').slice(0, 300)}`);
        break;
      }
    }
  }
}

if (failed) {
  console.error('\nПРОВАЛ: computed style изменился, распил CSS не эквивалентен.');
  process.exit(1);
}
console.log('\nOK: во всех проверенных состояниях computed style побайтово идентичен.');
