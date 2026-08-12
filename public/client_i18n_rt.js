/* Рантайм локализации: текущий язык, подстановка строк и оповещение о смене.

   Словари и списки имён ботов лежат в client_i18n.js — там же тесты на них.
   Здесь только то, что зависит от выбранного прямо сейчас языка.

   Раньше setLang() был списком из двадцати вызовов в try/catch — по одному на
   каждый кусок интерфейса, который собирается в JS и потому не переводится
   разметкой. Список приходилось дополнять руками при каждом новом экране, и
   он уже отставал: строка статуса магазина висела по-английски в русском
   интерфейсе (K4), вкладки магазина не пересобирались вовсе (C4).

   Теперь подписка: модуль, который рисует текст сам, объявляет об этом рядом
   со своей отрисовкой. Забыть подписаться можно, но это видно там же, где
   пишется код отрисовки, а не в чужом файле за три тысячи строк. */

import { EN, I18N, RU } from './client_i18n.js';
import { KEYS, storageGet, storageSet } from './client_storage.js';
import { formatNumber as formatNumberIntl, numberLocale as localeOf } from './client_format.js';

function storedLang() {
  const raw = storageGet(KEYS.lang);
  return raw === 'ru' || raw === 'en' ? raw : 'ru';
}

/* Язык держится в объекте, а не в экспортируемой `let`: импортёры получают
   живое значение через lang(), и ни у кого не заводится своя устаревшая
   копия — ровно та ошибка, которой болел прежний client.js. */
const state = { lang: storedLang() };

export function lang() {
  return state.lang;
}

export function isEn() {
  return state.lang === 'en';
}

/* Набор игровых описаний (пауэрапы, контракты, ачивки) на текущем языке. */
export function infoPack() {
  return state.lang === 'en' ? EN : RU;
}

export function t(key) {
  const k = String(key || '');
  const pack = I18N[state.lang] || I18N.ru;
  return pack[k] ?? I18N.ru[k] ?? k;
}

/* Подстановка в строку словаря: tfmt('bot.badge_title', {arch, tier}).
   Отдельная функция, а не параметр t(), чтобы не менять сигнатуру, на которую
   опираются ~350 существующих вызовов. */
export function tfmt(key, vars) {
  const s = t(key);
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, name) => (vars[name] === undefined ? m : String(vars[name])));
}

/* Форматирование чисел живёт в client_format.js вместе с тестами — здесь
   обёртки, подставляющие текущий язык. */
function numberLocale() {
  return localeOf(state.lang);
}

export function formatNumber(value, options) {
  return formatNumberIntl(value, state.lang, options);
}

/* Перевод статической разметки по data-атрибутам. */
function applyTranslations(root) {
  const r = root || document;
  try {
    document.documentElement.setAttribute('lang', state.lang);
  } catch {}

  for (const el of r.querySelectorAll('[data-i18n]')) {
    const v = t(el.getAttribute('data-i18n'));
    if (el.textContent !== v) el.textContent = v;
  }
  for (const [attr, dataAttr] of [
    ['placeholder', 'data-i18n-placeholder'],
    ['title', 'data-i18n-title'],
    ['aria-label', 'data-i18n-aria-label']
  ]) {
    for (const el of r.querySelectorAll(`[${dataAttr}]`)) {
      const v = t(el.getAttribute(dataAttr));
      if (el.getAttribute(attr) !== v) el.setAttribute(attr, v);
    }
  }
}

/* Подписчики на смену языка — те куски интерфейса, что собираются в JS. */
const langListeners = new Set();

export function onLangChange(fn) {
  if (typeof fn === 'function') langListeners.add(fn);
}

export function setLang(next) {
  const v = String(next || 'ru');
  if (v !== 'ru' && v !== 'en') return;
  state.lang = v;
  storageSet(KEYS.lang, v);

  updateLangToggleUi();
  applyTranslations(document);

  /* Сбой одного подписчика не должен обрывать перевод остальных: раньше ту же
     роль играли двадцать отдельных try/catch на каждый вызов. */
  for (const fn of langListeners) {
    try {
      fn(v);
    } catch (e) {
      console.warn('lang listener failed', e);
    }
  }
}

/* Флаг на кнопке переключения языка. Картинкой, а не эмодзи: Windows не
   рисует флаги символами, и кнопка показывала бы «RU»/«US» буквами. */
function updateLangToggleUi() {
  const en = isEn();
  for (const btn of document.querySelectorAll('[data-lang-toggle]')) {
    if (!btn) continue;
    btn.replaceChildren();
    const img = document.createElement('img');
    img.alt = en ? 'EN' : 'RU';
    img.width = 22;
    img.height = 22;
    img.src = en ? 'emoji-64/1f1fa-1f1f8.png' : 'emoji-64/1f1f7-1f1fa.png';
    btn.appendChild(img);
  }
}

/* Первичная раскладка языка и кнопка-переключатель. */
export function initI18n() {
  for (const el of document.querySelectorAll('[data-lang-toggle]')) {
    el?.addEventListener?.('click', () => setLang(isEn() ? 'ru' : 'en'));
  }
  updateLangToggleUi();
  applyTranslations(document);
}
