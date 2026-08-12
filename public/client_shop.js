/* Обвязка магазина косметики: состояние облика игрока, кэш в localStorage,
   строка статуса, «одна операция за раз», ярлыки/названия категорий и панель
   «Ваш облик» в меню. Вынесено из client.js — вызовы и порядок выполнения не
   менялись, только источник импорта.

   Чистая логика (цены, тиры, инвентарь, desired-состояние) — в client_cos_*.js,
   DOM-обвязка списка и превью — в client_shop_ui.js. Тот модуль импортирует
   отсюда напрямую: кольцо импортов безопасно, потому что на верхнем уровне
   обоих файлов ничего друг у друга не вызывается.

   Сокет и мета-блок меню импортом не берутся (их собирает client.js) — они
   приходят один раз через initShop(). */

import { cos, session, world } from './client_store.js';
import { KEYS, storageGetJson, storageSetJson } from './client_storage.js';
import { dom } from './client_dom.js';
import { isOverlayOpen } from './client_overlays.js';
import { escapeHtml } from './client_util.js';
import { isEn, t } from './client_i18n_rt.js';
import { fmtInt } from './client_labels.js';
import { addToast } from './client_toasts.js';
import { playBeep } from './client_sfx.js';
import { renderMetaHudImpl as renderMetaHud } from './client_hud.js';
import { handleCosmeticsMessage } from './client_ws_handlers.js';
import {
  BOT_ARCH_MAX,
  BOT_TIER_MAX,
  COS_TITLE_MAX,
  botArchByPlayer,
  cosTitleName,
  cosTitlePrefix
} from './client_identity.js';
import {
  COS_STATE_CATS,
  cosPayloadOf,
  applyCosPayload,
  createCosState,
  eqOf,
  equip as cosEquip,
  invOf
} from './client_cos_state.js';
import {
  keepUnsent,
  loadDesired,
  planDesiredApply,
  saveDesired,
  setDesired
} from './client_cos_desired.js';
import {
  COSMETICS_CATS,
  COSMETICS_MAX_ID,
  cheapestPrice,
  ownedCountFromMask
} from './client_cos_model.js';
import { cosClampId, cosPrepCanvas } from './client_cos_draw.js';
import {
  COS_SCENE,
  drawCosmeticsScene,
  hideCosmeticsOverlayImpl,
  scheduleCosmeticsPreviewAnimImpl,
  showCosmeticsOverlayImpl,
  syncCosmeticsUiImpl
} from './client_shop_ui.js';

/* Сокет и перерисовка мета-блока меню живут в client.js: net создаётся там же,
   где разбирается соединение, а renderMenuMeta собирает блок из данных, к
   магазину отношения не имеющих. Забираем их ссылками один раз.
   Ник магазин берёт из session.name сам — передавать его больше не нужно. */
let netSend = () => false;
let netOnline = () => false;
let renderMenuMeta = () => {};

export function initShop(ctx) {
  if (typeof ctx?.wsSend === 'function') netSend = ctx.wsSend;
  if (typeof ctx?.wsIsConnected === 'function') netOnline = ctx.wsIsConnected;
  if (typeof ctx?.renderMenuMeta === 'function') renderMenuMeta = ctx.renderMenuMeta;
}

export function wsSend(type, data) {
  return netSend(type, data);
}

export function wsIsConnected() {
  return netOnline();
}

/* Что куплено и что надето — по ключу-категории, а не четырнадцатью плоскими
   переменными. Модель и правила живут в client_cos_state.js.
   Категории terr и death приходят отдельным JSON-сообщением `cosExtra`
   (бинарный ROI-снапшот остаётся 21-байтным и не меняется). Сообщения может
   не быть вовсе — тогда всё по нулям и выглядит как базовый вариант. */
export const youCos = createCosState();

/* Экипировка новых категорий по номерам игроков (из cosExtra), последняя
   категория, к которой уже подскроллили ленту вкладок, и выбранный предмет
   лежат в cos (client_store.js).

   Превью показывает ВЫБРАННЫЙ предмет (клик или фокус с клавиатуры).
   Наведение мыши превью не переключает: раньше hover перебивал выбор, пока
   курсор был над списком, и клик по карточке визуально «не работал». */


/* Модель «желаемой» экипировки — в client_cos_desired.js вместе с тестами.
   Здесь остаётся только подстановка хранилища. */
export function cosmeticsSetDesiredEq(cat, id) {
  setDesired(localStorage, cat, id);
}

/* Применить сохранённый выбор к серверу. Решение «что кому отправить»
   принимает planDesiredApply в client_cos_desired.js — здесь только отправка
   и разговор с игроком. Раньше соответствие «категория -> поле» было выписано
   тут семью строками подряд, дублируя такую же цепочку в записи выбора. */
function cosmeticsApplyDesiredServer() {
  if (cos.source !== 'server') return;

  const { toSend, missing } = planDesiredApply({
    desired: loadDesired(localStorage),
    inventory: cosmeticsMaskForCat,
    equipped: cosmeticsEqForCat
  });

  const results = toSend.map((it) => ({
    ...it,
    ok: wsSend('cosmeticsEquip', { cat: it.cat, id: it.id })
  }));

  if (missing.length) {
    const names = missing.map((m) => `${cosmeticsLabel(m.cat)} — ${cosmeticsVariantName(m.cat, m.id)}`);
    setCosmeticsStatus(() => `${t('cosmetics.desired_not_applied')}: ${names.join(', ')}`, 'error');
  }

  saveDesired(localStorage, keepUnsent(results));
}

// C1: shop feedback goes into a dedicated in-overlay line (#cosmeticsStatus),
// because body.overlayActive hides #eventToasts. Falls back to a toast if the
// element is not present in the markup.
/* K4: строка статуса магазина ставилась готовым текстом один раз, и переключение
   языка её не трогало — в русском интерфейсе висело «Not confirmed by the
   server yet…». Теперь источник строки хранится: если это функция, она
   перевычисляется при каждой смене языка. */

export function setCosmeticsStatus(text, kind) {
  cos.statusSrc = typeof text === 'function' ? text : String(text || '');
  cos.statusKind = String(kind || '');
  renderCosmeticsStatus();
}

// Перерисовать статус из сохранённого источника (вызывается из setLang).
export function renderCosmeticsStatus() {
  let text = cos.statusSrc;
  if (typeof text === 'function') {
    try {
      text = text();
    } catch {
      text = '';
    }
  }
  const kind = cos.statusKind;
  const msg = String(text || '').trim();
  const k = String(kind || '');
  let el = null;
  try {
    el = document.getElementById('cosmeticsStatus');
  } catch {}
  if (!el) {
    if (msg) addToast(k === 'error' ? '⚠' : k === 'success' ? '✅' : 'ℹ', msg, null);
    return;
  }
  try {
    el.textContent = msg;
    el.classList.toggle('isError', k === 'error');
    el.classList.toggle('isSuccess', k === 'success');
    el.classList.toggle('isInfo', k === 'info');
    el.classList.toggle('hidden', !msg);
    el.setAttribute('role', k === 'error' ? 'alert' : 'status');
    el.setAttribute('aria-live', k === 'error' ? 'assertive' : 'polite');
  } catch {}
}

// C4: one in-flight shop operation at a time, with a hard timeout.
export function cosmeticsOpBegin(cat, id) {
  cos.pendingOp = { cat: String(cat || ''), id: Number(id) || 0, at: Date.now() };
  if (cos.opTimer) {
    try {
      clearTimeout(cos.opTimer);
    } catch {}
    cos.opTimer = 0;
  }
  cos.opTimer = setTimeout(() => {
    cos.opTimer = 0;
    if (!cos.pendingOp) return;
    cos.pendingOp = null;
    setCosmeticsStatus(() => t('cosmetics.op_timeout'), 'error');
    syncCosmeticsUi();
  }, 5000);
}

export function cosmeticsOpClear() {
  cos.pendingOp = null;
  if (cos.opTimer) {
    try {
      clearTimeout(cos.opTimer);
    } catch {}
    cos.opTimer = 0;
  }
}

export function cosmeticsOpIsPending(cat, id) {
  if (!cos.pendingOp) return false;
  return cos.pendingOp.cat === cat && Number(cos.pendingOp.id) === Number(id);
}

/* Показ/скрытие/анимация оверлея — DOM-обвязка магазина в client_shop_ui.js. */
export function showCosmeticsOverlay() {
  showCosmeticsOverlayImpl();
}

function hideCosmeticsOverlay() {
  hideCosmeticsOverlayImpl();
}


/* COSMETICS_MAX_ID, COSMETICS_CATS, запасной прайс, bitHas и лестница тиров
   переехали в client_cos_model.js — там же тесты на цены и владение. */
// Порядок вкладок магазина: сверху то, что занимает больше всего экрана.
export const COSMETICS_TABS = [...COSMETICS_CATS, 'title'];

/* Обе функции раньше были цепочками из семи if, заканчивавшимися
   `return youCosEqFrame`. На НЕизвестной категории они молча отдавали данные
   рамок — из-за этого вкладка титулов открывалась с выбором, указывающим на
   id надетой рамки: 'title' не покупается, в цепочке его нет.
   Теперь неизвестная категория честно даёт 0. */
export function cosmeticsMaskForCat(cat) {
  return invOf(youCos, cat);
}

export function cosmeticsEqForCat(cat) {
  return eqOf(youCos, cat);
}

export function cosmeticsTierLabel(tier) {
  return t(`cosmetics.tier_${String(tier || 'base')}`) || String(tier || '');
}

// Самый дешёвый платный предмет во всём магазине — крючок «до первого скина».
export function cosmeticsCheapestPrice() {
  return cheapestPrice(cos.prices);
}

export function cosmeticsOwnedCount(cat) {
  return ownedCountFromMask(cosmeticsMaskForCat(cat));
}

// Ключ i18n на категорию. Таблица индексируется COSMETICS_TABS (проверено
// тестом tests/client_cosmetics_cats_usage.test.mjs) — забытая категория
// упадёт на тесте, а не молча покажет ярлык соседней категории.
const COSMETICS_LABEL_KEY_BY_CAT = {
  terr: 'cosmetics.cat_terr',
  seg: 'cosmetics.cat_seg',
  head: 'cosmetics.cat_head',
  death: 'cosmetics.cat_death',
  capturefx: 'cosmetics.cat_capturefx',
  nameplate: 'cosmetics.cat_nameplate',
  frame: 'cosmetics.cat_frame',
  title: 'cosmetics.cat_title'
};

// Восемь текстовых вкладок не помещались в одну строку — лента скроллилась
// горизонтально, и часть категорий была не видна без прокрутки. Иконка
// компактнее подписи в любом языке, поэтому лента снова помещается целиком.
// Полная подпись никуда не делась — она в aria-label/title кнопки.
export const COSMETICS_TAB_ICON_BY_CAT = {
  terr: '🟩',
  seg: '〰️',
  head: '⚪',
  death: '💀',
  capturefx: '✨',
  nameplate: '🏷️',
  frame: '🖼️',
  title: '🏅'
};

export function cosmeticsLabel(cat) {
  return t(COSMETICS_LABEL_KEY_BY_CAT[cat] || 'cosmetics.cat_frame');
}

// Названия вариантов не повторяются между категориями: раньше «Лазурь/Алая/
// Золото/Аметист» стояли и в рамках, и в плашках, отчего покупка ощущалась
// как «купил цвет». Семьи названий (см. комментарий у каждой категории)
// подобраны так, чтобы различие было в форме/структуре, а не в цвете.
const COSMETICS_VARIANT_NAMES_BY_CAT = {
  capturefx: {
    en: ['Rings', 'Rays', 'Crystal', 'Spiral', 'Confetti', 'Magma', 'Vortex', 'Shards'],
    ru: ['Кольца', 'Лучи', 'Кристалл', 'Спираль', 'Конфетти', 'Магма', 'Вихрь', 'Осколки']
  },
  seg: {
    en: ['Classic', 'Neon', 'Stripes', 'Plasma', 'Sparks', 'Circuit', 'Mosaic', 'Void'],
    ru: ['Классика', 'Неон', 'Полосы', 'Плазма', 'Искры', 'Схема', 'Мозаика', 'Бездна']
  },
  // Семейство «металлы и материалы» — совпадает с классами .frame0..7 в CSS.
  frame: {
    en: ['Steel', 'Copper', 'Chrome', 'Emerald', 'Obsidian', 'Aurora', 'Golden Age', 'Prism'],
    ru: ['Сталь', 'Медь', 'Хром', 'Изумруд', 'Обсидиан', 'Северное сияние', 'Золотой век', 'Призма']
  },
  // Семейство «формы плашки» — различие в геометрии, не в цвете.
  nameplate: {
    en: ['Capsule', 'Bar', 'Bevel', 'Scroll', 'Terminal', 'Engrave', 'Gleam', 'Chevron'],
    ru: ['Капсула', 'Планка', 'Скос', 'Свиток', 'Терминал', 'Гравюра', 'Блик', 'Шеврон']
  },
  head: {
    en: ['Orb', 'Rhombus', 'Cube', 'Ring', 'Shield', 'Arrow', 'Eclipse', 'Star'],
    ru: ['Орб', 'Ромб', 'Куб', 'Кольцо', 'Щит', 'Стрела', 'Затмение', 'Звезда']
  },
  // Семейство «поверхности»: различие в структуре узора, цвет всегда ваш.
  terr: {
    en: ['Solid', 'Hatch', 'Honeycomb', 'Tide', 'Circuit', 'Stained glass', 'Rift', 'Weave'],
    ru: ['Заливка', 'Штриховка', 'Соты', 'Прилив', 'Схема', 'Витраж', 'Разлом', 'Ткань']
  },
  death: {
    en: ['Flash', 'Pixels', 'Black hole', 'Glass', 'Supernova', 'Glitch', 'Ash', 'Discharge'],
    ru: ['Вспышка', 'Пиксели', 'Чёрная дыра', 'Стекло', 'Сверхновая', 'Глитч', 'Пепел', 'Разряд']
  }
};

export function cosmeticsVariantName(cat, id) {
  const i = Math.max(0, Math.min(COSMETICS_MAX_ID, Number(id) || 0));
  if (cat === 'title') return cosTitleName(id) || t('cosmetics.title_none');
  const names = COSMETICS_VARIANT_NAMES_BY_CAT[cat];
  if (!names) return String(i + 1);
  return names[isEn() ? 'en' : 'ru'][i];
}

/* --- Титулы в магазине -----------------------------------------------------
   Отдельная вкладка: покупать нечего, поэтому вместо цены — условие открытия,
   а вместо «Купить» — «Надеть». Отправка идёт сообщением `titleEquip`.
   Вся DOM-обвязка титулов (renderCosmeticsTitlesImpl, cosTitleUnlockedImpl,
   cosTitleProgressImpl, cosFormatCountImpl, cosTitlesUnlockedCountImpl,
   cosTitleEquipImpl) — в client_shop_ui.js. Раньше здесь стояли шесть тонких
   обёрток, подставлявших deps; deps больше нет, и звать эти функции незачем
   никому, кроме самого client_shop_ui.js. */

function cosmeticsSetFilter(next) {
  const v = String(next || 'all');
  if (v !== 'all' && v !== 'owned' && v !== 'available') return;
  cos.filter = v;
  syncCosmeticsUi();
}

// C15: only the price here — the balance already lives in the shop header.
export function cosmeticsFormatCost(price) {
  const p = Math.max(0, Number(price) || 0);
  const pTxt = escapeHtml(fmtInt(p));
  const unit = escapeHtml(t('cosmetics.style_points'));
  return `<span class="num">${pTxt}</span> ${unit}`;
}

// C7: keep the shop in sync whenever the currency balance changes.
export function setYouStyle(v) {
  const next = Math.max(0, Math.floor(Number(v) || 0));
  if (next === cos.style) return;
  cos.style = next;
  try {
    cosmeticsCacheSave();
  } catch {}
  if (cos.open) {
    try {
      syncCosmeticsUi();
    } catch {}
  }
  // Прогресс «до первого скина» на экране меню считается от баланса.
  try {
    renderMenuMeta();
  } catch {}
}

function cosmeticsGetStateObject() {
  return {
    style: Math.max(0, Math.floor(Number(cos.style) || 0)),
    // Имена полей выводит cosPayloadOf из того же соответствия, по которому
    // разбирается сообщение сервера: разъехаться они не могут.
    ...cosPayloadOf(youCos),
    titleId: Number(cos.titleId) || 0,
    titleMask: Number(cos.titleMask) || 0
  };
}

function cosmeticsApplyStateObject(s) {
  if (!s || typeof s !== 'object') return;
  // C3: the balance is part of the cache, otherwise the shop always shows 0 before a match.
  const st = Number(s.style);
  if (Number.isFinite(st)) cos.style = Math.max(0, Math.floor(st));
  applyCosPayload(youCos, s, 'replace');
  cos.titleId = Number(s.titleId) || 0;
  cos.titleMask = Number(s.titleMask) || 0;
}

function cosmeticsCacheLoad() {
  return storageGetJson(KEYS.cosmeticsCache);
}

export function cosmeticsCacheSave() {
  storageSetJson(KEYS.cosmeticsCache, cosmeticsGetStateObject());
}

export function cosmeticsEnsureLocalReady() {
  if (cos.loaded) return;
  const cached = cosmeticsCacheLoad();
  if (cached) {
    cosmeticsApplyStateObject(cached);
  } else {
    cos.style = 0;
    cos.titleId = 0;
    cos.titleMask = 0;
    // Без кэша: базовый вариант (id 0) есть у всех и он же надет.
    for (const cat of COS_STATE_CATS) {
      youCos.inv[cat] = 1;
      youCos.eq[cat] = 0;
    }
  }
  cos.source = 'cache';
  cos.loaded = true;
}

// C2: purchases work outside a room (profile-scoped on the server), so `session.started`
// must not gate the shop. What we do need is a live socket and server-confirmed state.
export function cosmeticsServerReady() {
  return wsIsConnected() && cos.source === 'server';
}

export function cosmeticsBuyLocal(cat, id) {
  // C1/C2: no server -> explain why the purchase cannot go through, inside the overlay.
  setCosmeticsStatus(() => (wsIsConnected() ? t('cosmetics.unconfirmed_hint') : t('cosmetics.no_connection')), 'error');
}

export function cosmeticsEquipLocal(cat, id) {
  const c = String(cat || '').trim().toLowerCase();
  const itemId = cosClampId(id);
  const bit = 1 << itemId;
  const mask = cosmeticsMaskForCat(c);
  if ((mask & bit) === 0) return;
  cosEquip(youCos, c, itemId);
  if (session.you) {
    if (c === 'terr') cos.terrByPlayer.set(session.you, itemId);
    if (c === 'death') cos.deathByPlayer.set(session.you, itemId);
  }
  cosmeticsSetDesiredEq(c, itemId);
  cosmeticsCacheSave();
  syncCosmeticsUi();
}

/* C3 — #menuSkinPreview -----------------------------------------------------
   Панель «Ваш облик» в меню висела пустым канвасом: имя элемента не
   встречалось в JS ни разу, 0 непрозрачных пикселей. Рисуем экипированный
   облик теми же примитивами, что и игра с магазином (drawTerrTile через
   drawCosmeticsZone, drawSegTile, drawHead, drawNamePlate, drawCaptureFx),
   поэтому расхождений между меню, магазином и полем быть не может. */
let menuSkinAnimRaf = 0;
let menuSkinAnimAt = 0;

function menuSkinPreviewVisible() {
  if (!dom.menuSkinPreview) return false;
  if (!isOverlayOpen('menu')) return false;
  // Панель может быть скрыта по ширине экрана — тогда рисовать нечего.
  return dom.menuSkinPreview.clientWidth > 0 && dom.menuSkinPreview.clientHeight > 0;
}

export function renderMenuSkinPreview() {
  if (!menuSkinPreviewVisible()) return;
  const cssW = Math.max(180, Math.round(dom.menuSkinPreview.clientWidth || 320));
  const cssH = Math.max(120, Math.round(dom.menuSkinPreview.clientHeight || 200));
  // DPR учитывается внутри cosPrepCanvas — тот же путь, что и у превью магазина.
  const c = cosPrepCanvas(dom.menuSkinPreview, cssW, cssH);
  if (!c) return;

  const reduceMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const now = reduceMotion ? 0 : performance.now();

  // Ник берём живой: поле ввода рядом может быть уже отредактировано, а в
  // session.name лежит последнее подтверждённое имя.
  const liveName = (dom.menuNameInput?.value || '').trim() || world.nameById.get(session.you) || session.name;

  /* Та же сцена, что и в магазине. Раньше здесь была своя, третья композиция
     со своим масштабом и своим положением зоны — меню и магазин показывали
     один и тот же облик по-разному, и совпадение приходилось поддерживать
     руками. Пунктира нет: в меню ничего не выбирают, показывать нечего. */
  const pad = Math.round(Math.min(cssW, cssH) * COS_SCENE.pad);
  drawCosmeticsScene(
    c,
    { x: pad, y: pad, w: cssW - pad * 2, h: cssH - pad * 2 },
    {
      cat: '',
      label: `${cosTitlePrefix(cos.titleId)}${liveName || t('cosmetics.balance_you')}`,
      now,
      reduceMotion,
      highlight: false,
      ids: {
        head: youCos.eq.head,
        seg: youCos.eq.seg,
        nameplate: youCos.eq.nameplate,
        capturefx: youCos.eq.capturefx,
        terr: youCos.eq.terr,
        death: youCos.eq.death
      }
    }
  );
}

function menuSkinPreviewTick(ts) {
  menuSkinAnimRaf = 0;
  if (!menuSkinPreviewVisible()) return;
  // ~24 fps: панель декоративная, гнать её на 60 незачем.
  if (!menuSkinAnimAt || ts - menuSkinAnimAt >= 40) {
    menuSkinAnimAt = ts;
    try {
      renderMenuSkinPreview();
    } catch {}
  }
  menuSkinAnimRaf = requestAnimationFrame(menuSkinPreviewTick);
}

export function scheduleMenuSkinPreview() {
  if (!menuSkinPreviewVisible()) return;
  try {
    renderMenuSkinPreview();
  } catch {}
  if (menuSkinAnimRaf) return;
  const reduceMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  if (reduceMotion) return;
  menuSkinAnimRaf = requestAnimationFrame(menuSkinPreviewTick);
}

export function stopMenuSkinPreview() {
  if (!menuSkinAnimRaf) return;
  try {
    cancelAnimationFrame(menuSkinAnimRaf);
  } catch {}
  menuSkinAnimRaf = 0;
}

/* Панель могла остаться пустой навсегда.
   scheduleMenuSkinPreview() выходит, если канвас ещё нулевого размера, а
   menuSkinPreviewTick() в этом случае гасит цикл — и никто не пробовал
   заново. Достаточно было, чтобы первый показ меню случился до того, как
   раскладка устоялась (или пока панель скрыта по ширине экрана), и облик
   не рисовался до перезагрузки страницы.
   Наблюдатель размера будит отрисовку ровно тогда, когда у панели появляется
   ширина: ни таймеров, ни попыток «на всякий случай» каждый кадр. */
if (dom.menuSkinPreview && typeof ResizeObserver === 'function') {
  try {
    new ResizeObserver(() => {
      if (menuSkinAnimRaf) return;
      scheduleMenuSkinPreview();
    }).observe(dom.menuSkinPreview);
  } catch {}
}

export function onCosmetics(msg) {
  handleCosmeticsMessage(msg, {
    COSMETICS_MAX_ID,
    COS_TITLE_MAX,
    addToast,
    applyCosPayload,
    cosmeticsApplyDesiredServer,
    cosmeticsCacheSave,
    cosmeticsLabel,
    cosmeticsOpClear,
    cosmeticsVariantName,
    playBeep,
    renderMenuSkinPreview,
    renderMetaHud,
    setCosmeticsStatus,
    syncCosmeticsUi,
    t,
    youCos
  });
}

/* Новые косметические категории приходят отдельным JSON-сообщением, потому что
   бинарный ROI-снапшот остаётся 21-байтным и не расширяется:
   {"players":[{"n":12,"terr":3,"death":1,"title":7}, ...]}
   Сообщения может не быть (старый сервер) — тогда карты пусты и всё рисуется
   базовыми вариантами. */
export function onCosExtra(m) {
  const arr = Array.isArray(m?.players) ? m.players : null;
  if (!arr) return;
  cos.terrByPlayer.clear();
  cos.deathByPlayer.clear();
  cos.titleByPlayer.clear();
  // C4: bot identity. Полная пересборка — сообщение всегда содержит всю комнату.
  botArchByPlayer.clear();
  for (const it of arr) {
    const n = Number(it?.n);
    if (!Number.isFinite(n)) continue;
    const terr = cosClampId(it?.terr);
    const death = cosClampId(it?.death);
    const title = Math.max(0, Math.min(COS_TITLE_MAX, Number(it?.title) || 0));
    if (terr) cos.terrByPlayer.set(n, terr);
    if (death) cos.deathByPlayer.set(n, death);
    if (title) cos.titleByPlayer.set(n, title);
    /* C4: арх/тир осмысленны только у бота — у человека сервер шлёт нули, и
       без флага bot первый архетип («Фермер») налипал бы на всех живых. */
    if (it?.bot === true) {
      const arch = Number(it?.arch);
      const tier = Number(it?.tier);
      botArchByPlayer.set(n, {
        arch: Number.isFinite(arch) ? Math.max(0, Math.min(BOT_ARCH_MAX, arch)) : 0,
        tier: Number.isFinite(tier) ? Math.max(0, Math.min(BOT_TIER_MAX, tier)) : 0,
      });
    }
    if (n === session.you) {
      youCos.eq.terr = terr;
      youCos.eq.death = death;
      cos.titleId = title;
    }
  }
  try {
    if (cos.open) syncCosmeticsUi();
  } catch {}
  // C3: экипировка изменилась — обновляем панель «Ваш облик» в меню.
  try {
    renderMenuSkinPreview();
  } catch {}
}

/* Синхронизация списка/шапки/превью магазина — DOM-обвязка в
   client_shop_ui.js. Выбор предмета (cosmeticsSelectItemImpl) зовётся только
   изнутри той же обвязки, поэтому обёртки для него здесь нет. */
export function syncCosmeticsUi() {
  syncCosmeticsUiImpl();
}

export function bindCosmeticsUi() {
  dom.cosmeticsBtn?.addEventListener('click', () => {
    showCosmeticsOverlay();
  });
  dom.cosmeticsMenuBtn?.addEventListener('click', () => {
    showCosmeticsOverlay();
  });
  dom.cosmeticsCloseBtn?.addEventListener('click', () => {
    hideCosmeticsOverlay();
  });
  dom.cosmeticsOverlay?.addEventListener('click', (e) => {
    if (e.target === dom.cosmeticsOverlay) {
      hideCosmeticsOverlay();
    }
  });

  dom.cosmeticsStyleInfoBtn?.addEventListener('click', (e) => {
    e?.preventDefault?.();
    cos.earnExpanded = !cos.earnExpanded;
    syncCosmeticsUi();
    try {
      dom.cosmeticsEarnStyle?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    } catch {}
  });

  dom.cosmeticsFilterAllBtn?.addEventListener('click', () => cosmeticsSetFilter('all'));
  dom.cosmeticsFilterOwnedBtn?.addEventListener('click', () => cosmeticsSetFilter('owned'));
  dom.cosmeticsFilterAvailableBtn?.addEventListener('click', () => cosmeticsSetFilter('available'));
}
