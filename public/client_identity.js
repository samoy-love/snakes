/* Как игрок представлен: имя, титул и значок бота.

   Три вещи, которые раньше лежали в client.js порознь, но всегда ходят
   вместе: строку игрока рисуют таблица лидеров, килфид, плашка над головой,
   итоги матча и магазин — и каждому нужны все три. Раньше каждый из этих
   модулей получал botArchInfo/botArchBadge/cosTitleName/displayNameOf через
   deps по отдельности.

   Все три зависят от языка: имя выбирается между nm и nmEn, титул и подпись
   архетипа переводятся. Поэтому источник данных (world.nameById, cos.*) —
   общий стор, а не снимок значений. */

import { BOT_NAMES_EN, BOT_NAMES_RU } from './client_i18n.js';
import { isEn, t, tfmt } from './client_i18n_rt.js';
import { cos, world } from './client_store.js';
import { escapeHtml } from './client_util.js';

export const COS_TITLE_MAX = 12;

/* num игрока -> {arch, tier}. Только боты; человек в карту не попадает. */
export const botArchByPlayer = new Map();

/* --- C4. Значок архетипа и тира бота ---------------------------------------
   Архетипы реально различаются по поведению (агрессор убивает в разы чаще
   труса, территориальный держит вдвое больше клеток), но у игрока не было ни
   одного маркера — вся разница читалась как «боты ведут себя по-разному».
   Сервер шлёт arch/tier в `cosExtra` (только для ботов, см. cosExtraEntry).

   Разметка согласована с .botArch в style.css: глиф рисует CSS через ::before,
   тир — насыщенностью (tier0/tier1/tier2), подпись .botArchLabel скрывается на
   узких экранах и в килфиде. Для канваса (плашка над головой) есть отдельный
   путь — botArchGlyph(). */
export const BOT_ARCH_MAX = 3;
export const BOT_TIER_MAX = 2;

const BOT_ARCH_CLASS = ['archFarmer', 'archAggressor', 'archCoward', 'archTerritorial'];
// Дублирует content у .botArch::before — нужен канвасу, где CSS не работает.
const BOT_ARCH_GLYPH = ['🌾', '⚔', '🛡', '🧭'];
const BOT_ARCH_KEY = ['bot.arch_farmer', 'bot.arch_aggressor', 'bot.arch_coward', 'bot.arch_territorial'];
const BOT_TIER_KEY = ['bot.tier_easy', 'bot.tier_normal', 'bot.tier_hard'];

export function botArchInfo(playerNum) {
  const rec = botArchByPlayer.get(Number(playerNum));
  if (!rec) return null;
  const arch = Math.max(0, Math.min(BOT_ARCH_MAX, Number(rec.arch) || 0));
  const tier = Math.max(0, Math.min(BOT_TIER_MAX, Number(rec.tier) || 0));
  return { arch, tier };
}

// Один символ для канваса; пустая строка, если это не бот.
export function botArchGlyph(playerNum) {
  const info = botArchInfo(playerNum);
  return info ? BOT_ARCH_GLYPH[info.arch] : '';
}

/* Готовый DOM-бейдж или null. glyphOnly — для килфида и плашек, где колонка
   ника важнее подписи. */
export function botArchBadge(playerNum, { glyphOnly = false } = {}) {
  const info = botArchInfo(playerNum);
  if (!info) return null;
  const archName = t(BOT_ARCH_KEY[info.arch]);
  const tierName = t(BOT_TIER_KEY[info.tier]);
  const el = document.createElement('span');
  el.className = `botArch ${BOT_ARCH_CLASS[info.arch]} tier${info.tier}${glyphOnly ? ' isGlyphOnly' : ''}`;
  el.title = tfmt('bot.badge_title', { arch: archName, tier: tierName });
  el.setAttribute('aria-label', tfmt('bot.badge_aria', { arch: archName, tier: tierName }));
  const label = document.createElement('span');
  label.className = 'botArchLabel';
  label.textContent = archName;
  el.appendChild(label);
  return el;
}

/* --- TITLE: заголовок перед ником ------------------------------------------
   Титулы не продаются: сервер присылает `titleMask` (что открыто) и `titleId`
   (что надето), экипировка уходит сообщением `titleEquip`. */

// Идентификаторы и порядок совпадают с таблицей titleRules на сервере (12 шт.).
// Сервер дополнительно шлёт свой список в `hello.titles` — он используется как
// подстраховка, если серверный набор титулов вырастет раньше клиента.
/* C3: id ачивки, которая открывает титул (hello.titles[].achv). Без этой
   таблицы прогресс не к чему привязать — идентификаторы титулов и ачивок
   не совпадают. Старый сервер поля не шлёт — карта останется пустой, и
   прогресс просто не будет рисоваться, как и раньше. */
/* C3: накопленная статистика по ещё не открытым ачивкам:
   achvId -> {cur, max} из `cosmetics.achvProgress`. */

export function cosTitleName(id) {
  const i = Math.max(0, Number(id) || 0);
  if (i === 0) return '';
  const en = isEn();
  const list = en
    ? ['', 'Fighter', 'Crusher', 'Legend', 'Landlord', 'Cartographer', 'Avenger',
       'Contractor', 'Executor', 'Bounty Hunter', 'Trendsetter', 'Regular', 'Devoted']
    : ['', 'Боец', 'Нагибатор', 'Легенда', 'Землевладелец', 'Картограф', 'Мститель',
       'Подрядчик', 'Исполнитель', 'Охотник за головами', 'Модник', 'Завсегдатай', 'Преданный'];
  // Запасной вариант для титула, которого клиент ещё не знает: сервер шлёт оба
  // имени, берём то, на котором сейчас интерфейс (R5).
  const srv = cos.titleServerNames.get(i);
  return list[i] || (srv ? (en ? srv.en : srv.ru) : '') || '';
}

export function cosTitleReq(id) {
  const i = Math.max(0, Number(id) || 0);
  const en = isEn();
  const list = en
    ? ['', '10 kills', '100 kills', '1000 kills', '10 000 cells captured', '100 000 cells captured',
       '15 revenge kills', '25 contracts completed', '100 contracts completed', '15 bounties claimed',
       '10 000 Style earned', '7-day play streak', '30-day play streak']
    : ['', '10 убийств', '100 убийств', '1000 убийств', '10 000 захваченных клеток',
       '100 000 захваченных клеток', '15 убийств мести', '25 выполненных контрактов',
       '100 выполненных контрактов', '15 собранных наград', '10 000 заработанного стиля',
       'Серия из 7 дней', 'Серия из 30 дней'];
  return list[i] || '';
}

// Титул перед ником: «⟨Охотник⟩ Вася». Возвращает готовую строку для плашки
// в канвасе, где никакой разметки быть не может.
export function cosTitlePrefix(titleId) {
  const nm = cosTitleName(titleId);
  return nm ? `«${nm}» ` : '';
}

// В HTML-таблицах титул — отдельный элемент .playerTitle первым потомком
// ячейки имени, а не часть текста: у него своя вёрстка и своё усечение.
export function playerTitleHtml(titleId) {
  const nm = cosTitleName(titleId);
  return nm ? `<span class="playerTitle">${escapeHtml(nm)}</span>` : '';
}

export function displayNameOf(id, fallback) {
  const n = Number(id);
  if (isEn()) {
    const en = world.nameEnById.get(n);
    if (en) return en;
  }
  const ru = world.nameById.get(n);
  if (ru) return ru;
  return fallback != null ? fallback : String(id);
}

// Имя из произвольной записи сервера ({nm, nmEn}) — итоги матча, снапшот.
export function displayNameFrom(rec, id, fallback) {
  if (rec) {
    const en = typeof rec.nmEn === 'string' ? rec.nmEn.trim() : '';
    const ru = typeof rec.nm === 'string' ? rec.nm.trim() : '';
    if (isEn() && en) return en;
    if (ru) return ru;
    if (en) return en;
  }
  return displayNameOf(id, fallback);
}


export function botDisplayName(id) {
  const n = Number(id) || 0;
  const seed = (Math.imul(n, 1103515245) + 12345) >>> 0;
  const list = isEn() ? BOT_NAMES_EN : BOT_NAMES_RU;
  const base = list[seed % list.length] || t('name.bot_fallback');
  return `${base}#${(seed % 99) + 1}`;
}

export function refreshBotNames() {
  if (!world.botIds || world.botIds.size === 0) return;
  // G15: серверные ники ботов («Лютый Пельмень») не трогаем — локальный
  // генератор нужен только там, где имени с сервера ещё нет.
  for (const id of world.botIds) {
    const cur = world.nameById.get(id);
    if (typeof cur === 'string' && cur.trim()) continue;
    world.nameById.set(id, botDisplayName(id));
  }
}

