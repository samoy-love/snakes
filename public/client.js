import { clientState } from './client_state.js';
import {
  ensureLeaderboardDom,
  resetLeaderboardUi,
  updateLeaderboard as renderLeaderboard
} from './client_leaderboard.js';
import { createChatUi } from './client_chat_ui.js';
import { installErrorLogging } from './client_errors.js';
import { createAudioModule } from './client_audio.js';
import { createFxModule } from './client_fx.js';
import { createNetModule } from './client_net.js';
import { BOT_NAMES_EN, BOT_NAMES_RU, EN, I18N, RU } from './client_i18n.js';
import { boostHsl, hslToRgb, hueToHsl } from './client_color.js';
import { filterAndSortRooms } from './client_rooms.js';
import { renderRoomsList, renderRoomsEmpty, updateRoomsStats } from './client_rooms_ui.js';
import { PLAYER_RECORD_SIZES, pickPlayerRecordSize } from './client_protocol.js';
import { trailVisualState } from './client_trail_style.js';
import { DEATH_REASON, deathReasonSuffix } from './client_death.js';
import { commitBestPct as commitBest, sortPlayersByScore } from './client_stats.js';
import {
  renderDeathReasonImpl,
  renderDeathStatsImpl,
  renderMatchResultsImpl,
  showDeathOverlayImpl,
  updateDeathZoomImpl
} from './client_death_ui.js';
import {
  ROI_MARGIN_CELLS,
  VIEW_CELLS_X,
  VIEW_CELLS_Y,
  cellSizeFor,
  clampToRoi,
  decayShake,
  dirVec,
  followCamera,
  viewRectOf,
  visibleBounds
} from './client_field_view.js';
import {
  COS_STATE_CATS,
  applyCosPayload,
  cosPayloadOf,
  createCosState,
  eqOf,
  equip as cosEquip,
  invOf,
  markOwned
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
  missingFor,
  tierClass,
  ownedCountFromMask
} from './client_cos_model.js';
import { buyButtonState, equipButtonState, visibleItems } from './client_cos_ui.js';
import { renderMenuMetaImpl, showMenuOverlayImpl, updateMenuNameUiImpl } from './client_menu_ui.js';
import {
  COS_SCENE,
  cosmeticsSelectItemImpl,
  drawCosmeticsScene,
  drawMiniCosmeticPreview as drawMiniCosmeticPreviewImpl,
  hideCosmeticsOverlayImpl,
  scheduleCosmeticsPreviewAnimImpl,
  showCosmeticsOverlayImpl,
  syncCosmeticsUiImpl
} from './client_shop_ui.js';
import {
  approxTickNow,
  formatClock,
  formatGroupedCount,
  formatInt,
  formatNumber as formatNumberIntl,
  formatPct1,
  formatRate as formatRateOf,
  formatRemainMs,
  numberLocale as localeOf,
  remainMsToTick
} from './client_format.js';
import {
  COS_DEATH_MS,
  COS_FONT,
  cosClampId,
  cosPrepCanvas,
  cosTerrAlphaMod,
  cosTerrFillStyle,
  cosTerrIsAdditive,
  cosTerrIsPattern,
  drawCaptureFx,
  drawDeathFx,
  drawFrameRow,
  drawHead,
  drawNamePlate,
  drawSegTile,
  drawTerrSeam,
  drawTerrTile
} from './client_cos_draw.js';
import { drawMinimap as drawMinimapImpl, setMinimapPixel } from './client_minimap.js';
import {
  EMOJIS,
  clampInt,
  easeOutBack,
  easeOutCubic,
  emojiParseSafeHtml,
  escapeHtml,
  lerp,
  normalizeMenuNickInput,
  overlayManager,
  sanitizeNameClient,
  sanitizeRoomTitleClient,
  setSafeEmojiHtml,
  setSafeHtml
} from './client_util.js';
import { renderMetaHudImpl, renderTeamHudImpl, renderTopHudImpl } from './client_hud.js';

installErrorLogging();

const I18N_LANG_KEY = 'lang';

// Зоны/пины миникарты — в clientState (public/client_state.js), сама логика
// расчёта зон и отрисовка — в public/client_minimap.js.

const HUD_DENSITY_KEY = 'hudDensity';

function infoPack() {
  return lang === 'en' ? EN : RU;
}

function getLangDefault() {
  try {
    const raw = localStorage.getItem(I18N_LANG_KEY);
    if (raw === 'ru' || raw === 'en') return raw;
  } catch {}
  return 'ru';
}

let lang = getLangDefault();

const PROFILE_TOKEN_KEY = 'snakes_profile_token_v1';
let profileToken = '';

function getProfileToken() {
  if (profileToken) return profileToken;
  try {
    const cached = localStorage.getItem(PROFILE_TOKEN_KEY);
    if (cached && typeof cached === 'string' && cached.length >= 8 && cached.length <= 1024) {
      profileToken = cached;
    }
  } catch {}
  return profileToken;
}

function setProfileToken(tok) {
  const s = typeof tok === 'string' ? tok.trim() : '';
  if (!s || s.length > 1024) return;
  profileToken = s;
  try {
    localStorage.setItem(PROFILE_TOKEN_KEY, s);
  } catch {}
}

function t(key) {
  const k = String(key || '');
  const pack = I18N[lang] || I18N.ru;
  return pack[k] ?? I18N.ru[k] ?? k;
}

/* Подстановка в строку словаря: t('bot.badge_title', {arch, tier}).
   Отдельная функция, а не параметр t(), чтобы не менять сигнатуру, на которую
   опираются ~350 существующих вызовов. */
function tfmt(key, vars) {
  const s = t(key);
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, name) => (vars[name] === undefined ? m : String(vars[name])));
}

/* Форматирование переехало в client_format.js вместе с тестами. Здесь —
   обёртки, подставляющие текущий язык: так все вызовы по файлу остались как
   были, а формулы стали проверяемыми. */
function numberLocale() {
  return localeOf(lang);
}

function formatNumber(value, options) {
  return formatNumberIntl(value, lang, options);
}

function applyTranslations(root) {
  const r = root || document;
  try {
    document.documentElement.setAttribute('lang', lang);
  } catch {}

  const setText = (el, key) => {
    if (!el) return;
    const v = t(key);
    if (el.textContent !== v) el.textContent = v;
  };

  for (const el of r.querySelectorAll('[data-i18n]')) {
    setText(el, el.getAttribute('data-i18n'));
  }
  for (const el of r.querySelectorAll('[data-i18n-placeholder]')) {
    const v = t(el.getAttribute('data-i18n-placeholder'));
    if (el.getAttribute('placeholder') !== v) el.setAttribute('placeholder', v);
  }
  for (const el of r.querySelectorAll('[data-i18n-title]')) {
    const v = t(el.getAttribute('data-i18n-title'));
    if (el.getAttribute('title') !== v) el.setAttribute('title', v);
  }
  for (const el of r.querySelectorAll('[data-i18n-aria-label]')) {
    const v = t(el.getAttribute('data-i18n-aria-label'));
    if (el.getAttribute('aria-label') !== v) el.setAttribute('aria-label', v);
  }
}

function updateLangToggleUi() {
  const isRu = lang === 'ru';
  const btns = document.querySelectorAll('[data-lang-toggle]');
  if (!btns || !btns.length) return;
  for (const btn of btns) {
    if (!btn) continue;
    btn.replaceChildren();
    const img = document.createElement('img');
    img.alt = isRu ? 'RU' : 'EN';
    img.width = 22;
    img.height = 22;
    img.src = isRu ? 'emoji-64/1f1f7-1f1fa.png' : 'emoji-64/1f1fa-1f1f8.png';
    btn.appendChild(img);
  }
}

function setLang(next) {
  const v = String(next || 'ru');
  if (v !== 'ru' && v !== 'en') return;
  lang = v;
  try {
    localStorage.setItem(I18N_LANG_KEY, lang);
  } catch {}
  updateLangToggleUi();
  applyTranslations(document);

  // Обновляем динамические куски интерфейса, которые собираются в JS.
  try {
    updateMenuNameUi();
  } catch {}
  try {
    updateRoomsUi();
  } catch {}
  try {
    updateRoomInfo();
  } catch {}
  try {
    syncMatchOverlayActions();
  } catch {}
  try {
    ensureFxPresetControl();
  } catch {}
  try {
    updateMatchCountdown();
  } catch {}
  try {
    renderDeathStats();
  } catch {}
  // C3: подпись под облик (титул + ник) зависит от языка.
  try {
    renderMenuSkinPreview();
  } catch {}
  /* C4: магазин собирается в JS и на смену языка не пересобирался — вкладки,
     «где это видно» и названия предметов оставались на прежнем языке прямо
     посреди переведённого интерфейса. */
  try {
    if (cosmeticsOpen) syncCosmeticsUi();
  } catch {}
  // K4: обе строки собираются в JS и раньше оставались на прежнем языке.
  try {
    renderDeathReason();
  } catch {}
  try {
    renderCosmeticsStatus();
  } catch {}
  try {
    renderTeamHud();
  } catch {}
  try {
    renderTopHud();
  } catch {}
  try {
    ensureLeaderboardDom(statsEl, t);
  } catch {}
  try {
    updateLeaderboard();
  } catch {}
  try {
    syncCosmeticsUi();
  } catch {}
  try {
    renderMetaHud();
  } catch {}
  try {
    updateMinimapLegend();
  } catch {}

  try {
    updateChatHeaderStatus();
  } catch {}
  try {
    syncChatCollapseButtonUi();
  } catch {}
  try {
    updateRightI18n();
  } catch {}

  try {
    refreshBotNames();
  } catch {}
}

for (const el of document.querySelectorAll('[data-lang-toggle]')) {
  el?.addEventListener?.('click', () => {
    setLang(lang === 'ru' ? 'en' : 'ru');
  });
}

updateLangToggleUi();
applyTranslations(document);

let net = null;

/* F5 «Реклейм»: сервер отдаёт остывающую территорию тем же полем сетки, но со
   старшим битом 0x8000 — значение читается как «клетка ничья, но её ещё может
   вернуть игрок (v & 0x7FFF)». Обе функции ниже обязаны снимать флаг, иначе
   0x8000|n читается как несуществующий игрок и клетка становится серой. */
const COOL_OWNER_FLAG = 0x8000;

function gridCellOwner(v) {
  return (Number(v) || 0) & 0x7fff;
}

function gridCellIsCooling(v) {
  return ((Number(v) || 0) & COOL_OWNER_FLAG) !== 0;
}

// Вспышка захвата конкретного игрока — берём из последнего снапшота.
function cosCaptureFxByPlayer(pid) {
  const list = clientState.lastState?.players;
  if (!Array.isArray(list)) return 0;
  for (const p of list) {
    if (p?.n === pid) return Number(p.cosCaptureFx) || 0;
  }
  return 0;
}

// Отрисовка одного пикселя миникарты вынесена в public/client_minimap.js.

/* --- C4. Значок архетипа и тира бота ---------------------------------------
   Архетипы реально различаются по поведению (агрессор убивает в разы чаще
   труса, территориальный держит вдвое больше клеток), но у игрока не было ни
   одного маркера — вся разница читалась как «боты ведут себя по-разному».
   Сервер шлёт arch/tier в `cosExtra` (только для ботов, см. cosExtraEntry).

   Разметка согласована с .botArch в style.css: глиф рисует CSS через ::before,
   тир — насыщенностью (tier0/tier1/tier2), подпись .botArchLabel скрывается на
   узких экранах и в килфиде. Для канваса (плашка над головой) есть отдельный
   путь — botArchGlyph(). */
const BOT_ARCH_MAX = 3;
const BOT_TIER_MAX = 2;
// num игрока -> {arch, tier}. Только боты; человек в карту не попадает.
const botArchByPlayer = new Map();

const BOT_ARCH_CLASS = ['archFarmer', 'archAggressor', 'archCoward', 'archTerritorial'];
// Дублирует content у .botArch::before — нужен канвасу, где CSS не работает.
const BOT_ARCH_GLYPH = ['🌾', '⚔', '🛡', '🧭'];
const BOT_ARCH_KEY = ['bot.arch_farmer', 'bot.arch_aggressor', 'bot.arch_coward', 'bot.arch_territorial'];
const BOT_TIER_KEY = ['bot.tier_easy', 'bot.tier_normal', 'bot.tier_hard'];

function botArchInfo(playerNum) {
  const rec = botArchByPlayer.get(Number(playerNum));
  if (!rec) return null;
  const arch = Math.max(0, Math.min(BOT_ARCH_MAX, Number(rec.arch) || 0));
  const tier = Math.max(0, Math.min(BOT_TIER_MAX, Number(rec.tier) || 0));
  return { arch, tier };
}

// Один символ для канваса; пустая строка, если это не бот.
function botArchGlyph(playerNum) {
  const info = botArchInfo(playerNum);
  return info ? BOT_ARCH_GLYPH[info.arch] : '';
}

/* Готовый DOM-бейдж или null. glyphOnly — для килфида и плашек, где колонка
   ника важнее подписи. */
function botArchBadge(playerNum, { glyphOnly = false } = {}) {
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
const COS_TITLE_MAX = 12;
const cosTitleServerNames = new Map();
/* C3: id ачивки, которая открывает титул (hello.titles[].achv). Без этой
   таблицы прогресс не к чему привязать — идентификаторы титулов и ачивок
   не совпадают. Старый сервер поля не шлёт — карта останется пустой, и
   прогресс просто не будет рисоваться, как и раньше. */
const cosTitleAchvById = new Map();
/* C3: накопленная статистика по ещё не открытым ачивкам:
   achvId -> {cur, max} из `cosmetics.achvProgress`. */
const achvProgressById = new Map();

function cosTitleName(id) {
  const i = Math.max(0, Number(id) || 0);
  if (i === 0) return '';
  const en = lang === 'en';
  const list = en
    ? ['', 'Fighter', 'Crusher', 'Legend', 'Landlord', 'Cartographer', 'Avenger',
       'Contractor', 'Executor', 'Bounty Hunter', 'Trendsetter', 'Regular', 'Devoted']
    : ['', 'Боец', 'Нагибатор', 'Легенда', 'Землевладелец', 'Картограф', 'Мститель',
       'Подрядчик', 'Исполнитель', 'Охотник за головами', 'Модник', 'Завсегдатай', 'Преданный'];
  // Запасной вариант для титула, которого клиент ещё не знает: сервер шлёт оба
  // имени, берём то, на котором сейчас интерфейс (R5).
  const srv = cosTitleServerNames.get(i);
  return list[i] || (srv ? (en ? srv.en : srv.ru) : '') || '';
}

function cosTitleReq(id) {
  const i = Math.max(0, Number(id) || 0);
  const en = lang === 'en';
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
function cosTitlePrefix(titleId) {
  const nm = cosTitleName(titleId);
  return nm ? `«${nm}» ` : '';
}

// В HTML-таблицах титул — отдельный элемент .playerTitle первым потомком
// ячейки имени, а не часть текста: у него своя вёрстка и своё усечение.
function playerTitleHtml(titleId) {
  const nm = cosTitleName(titleId);
  return nm ? `<span class="playerTitle">${escapeHtml(nm)}</span>` : '';
}

/* Мини-превью в карточке списка — DOM-обвязка магазина в client_shop_ui.js. */
function drawMiniCosmeticPreview(canvasEl, cat, id) {
  drawMiniCosmeticPreviewImpl(canvasEl, cat, id, shopUiDeps());
}

function wsSend(type, data) {
  return net.send(type, data) !== false;
}

function wsIsConnected() {
  try {
    return net?.isConnected?.() === true;
  } catch {
    return false;
  }
}

function wsStatusSuffix() {
  return net.statusSuffix();
}

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const statsEl = document.getElementById('stats');

 ctx.imageSmoothingEnabled = true;
 ctx.imageSmoothingQuality = 'high';

const nameInput = document.getElementById('nameInput');
const nameBtn = document.getElementById('nameBtn');
const minimap = document.getElementById('minimap');
const mmCtx = minimap.getContext('2d');
const chat = document.getElementById('chat');

 mmCtx.imageSmoothingEnabled = true;
 mmCtx.imageSmoothingQuality = 'high';
const chatHeader = document.getElementById('chatHeader');
const chatLog = document.getElementById('chatLog');
const chatForm = document.getElementById('chatForm');
let chatInput = document.getElementById('chatInput');
const chatInputOverlay = document.getElementById('chatInputOverlay');
const emojiBtn = document.getElementById('emojiBtn');
const chatBtn = document.getElementById('chatBtn');
const emojiPanel = document.getElementById('emojiPanel');
const emojiCloseBtn = document.getElementById('emojiCloseBtn');
const emojiRecent = document.getElementById('emojiRecent');
const emojiGrid = document.getElementById('emojiGrid');
const perfEl = document.getElementById('perf');
const roomInfoEl = document.getElementById('roomInfo');
const chatUnreadEl = document.getElementById('chatUnread');
const chatHeaderHintEl = document.getElementById('chatHeaderHint');

const hudEl = document.getElementById('hud');
const lbBtn = document.getElementById('lbBtn');

const topHudEl = document.getElementById('topHud');
const topHudCellsEl = document.getElementById('topHudCells');
const topHudPctEl = document.getElementById('topHudPct');
const topHudTimeEl = document.getElementById('topHudTime');
const topHudKillsEl = document.getElementById('topHudKills');
const topHudContractEl = document.getElementById('topHudContract');
const topHudBarFillEl = document.getElementById('topHudBarFill');

const metaHudEl = document.getElementById('metaHud');
const teamHudEl = document.getElementById('teamHud');
const killfeedEl = document.getElementById('killfeed');
const eventToastsEl = document.getElementById('eventToasts');
const settingsBtn = document.getElementById('settingsBtn');
const settingsOverlay = document.getElementById('settingsOverlay');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const fxEnabledInput = document.getElementById('fxEnabled');
const fxIntensityInput = document.getElementById('fxIntensity');
const shakeIntensityInput = document.getElementById('shakeIntensity');
const perfEnabledInput = document.getElementById('perfEnabled');
const perfCompactInput = document.getElementById('perfCompact');
const soundEnabledInput = document.getElementById('soundEnabled');
const soundVolumeInput = document.getElementById('soundVolume');
const muteOnBlurInput = document.getElementById('muteOnBlur');
const hapticsInput = document.getElementById('hapticsEnabled');
const testBeepBtn = document.getElementById('testBeepBtn');
const resetSettingsBtn = document.getElementById('resetSettingsBtn');

const hudBrightnessInput = document.getElementById('hudBrightness');
const hudContrastInput = document.getElementById('hudContrast');
const hudPanelOpacityInput = document.getElementById('hudPanelOpacity');

const menuOverlay = document.getElementById('menuOverlay');

const menuNameInput = document.getElementById('menuNameInput');
const menuNameError = document.getElementById('menuNameError');
const menuNameRandomBtn = document.getElementById('menuNameRandomBtn');
const menuOnboarding = document.getElementById('menuOnboarding');

const playBtn = document.getElementById('playBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const toggleCreateRoomBtn = document.getElementById('toggleCreateRoomBtn');
const refreshRoomsBtn = document.getElementById('refreshRoomsBtn');

const roomsStatsEl = document.getElementById('roomsStats');
const roomsListEl = document.getElementById('roomsList');
const roomsSearchInput = document.getElementById('roomsSearchInput');
const roomsSearchClearBtn = document.getElementById('roomsSearchClearBtn');
const roomsSortSelect = document.getElementById('roomsSortSelect');
const roomsCreateEl = document.getElementById('roomsCreate');
const roomsCreateNameInput = document.getElementById('roomsCreateNameInput');
const roomsCreateError = document.getElementById('roomsCreateError');
const createRoomBtn = document.getElementById('createRoomBtn');
const leaveBtn = document.getElementById('leaveBtn');
const langToggleGlobal = document.getElementById('langToggleGlobal');
/* Общая обёртка-подложка для #deathOverlay/#matchOverlay: смерть с респауном
   и итоги матча — теперь два режима одного экрана (см. комментарий в
   index.html). Видимость самой обёртки выводится из видимости режимов в
   syncOverlayUiState(), отдельного show/hide для неё нет. */
const endOverlay = document.getElementById('endOverlay');
const deathOverlay = document.getElementById('deathOverlay');
const restartBtn = document.getElementById('restartBtn');
const deathMenuBtn = document.getElementById('deathMenuBtn');
const deathReasonEl = document.getElementById('deathReason');
const deathStatsEl = document.getElementById('deathStats');

const matchOverlay = document.getElementById('matchOverlay');
const matchResultsEl = document.getElementById('matchResults');
const matchCountdownEl = document.getElementById('matchCountdown');
const matchContinueBtn = document.getElementById('matchContinueBtn');
const matchMenuBtn = document.getElementById('matchMenuBtn');
const matchActionsEl = matchOverlay?.querySelector?.('.matchActions') || null;

const cosmeticsBtn = document.getElementById('cosmeticsBtn');
const cosmeticsMenuBtn = document.getElementById('cosmeticsMenuBtn');
const cosmeticsOverlay = document.getElementById('cosmeticsOverlay');
const cosmeticsCloseBtn = document.getElementById('cosmeticsCloseBtn');
const cosmeticsStyleEl = document.getElementById('cosmeticsStyle');
const cosmeticsEarnStyleEl = document.getElementById('cosmeticsEarnStyle');
const cosmeticsTabsEl = document.getElementById('cosmeticsTabs');
const cosmeticsItemsEl = document.getElementById('cosmeticsItems');
const cosmeticsPreview = document.getElementById('cosmeticsPreview');
const cosmeticsHintEl = document.getElementById('cosmeticsHint');
const cosmeticsWhereEl = document.getElementById('cosmeticsWhere');
// C3: канвас панели «Ваш облик» в меню.
const menuSkinPreviewEl = document.getElementById('menuSkinPreview');

const cosmeticsStyleInfoBtn = document.getElementById('cosmeticsStyleInfoBtn');
const cosmeticsFilterAllBtn = document.getElementById('cosmeticsFilterAll');
const cosmeticsFilterOwnedBtn = document.getElementById('cosmeticsFilterOwned');
const cosmeticsFilterAvailableBtn = document.getElementById('cosmeticsFilterAvailable');

const rightSidebarEl = document.getElementById('rightSidebar');
const rightInfoEl = document.getElementById('rightInfo');
const rightMatchDetailsEl = document.getElementById('rightMatchDetails');
const rightTeamDetailsEl = document.getElementById('rightTeamDetails');

overlayManager.register('menu', {
  root: () => menuOverlay,
  defaultFocus: () => menuNameInput,
  close: () => hideMenuOverlay(),
  closable: false
});
overlayManager.register('settings', {
  root: () => settingsOverlay,
  defaultFocus: () => closeSettingsBtn || settingsOverlay?.querySelector('input, select, button'),
  close: () => hideSettingsOverlay()
});
overlayManager.register('cosmetics', {
  root: () => cosmeticsOverlay,
  defaultFocus: () => cosmeticsCloseBtn,
  close: () => hideCosmeticsOverlay()
});
overlayManager.register('match', {
  root: () => matchOverlay,
  defaultFocus: () => (!matchContinueBtn?.disabled ? matchContinueBtn : matchMenuBtn),
  close: () => matchMenuBtn?.click?.()
});
overlayManager.register('death', {
  root: () => deathOverlay,
  defaultFocus: () => restartBtn,
  close: () => deathMenuBtn?.click?.()
});

try {
  if (menuOverlay && !menuOverlay.classList.contains('hidden')) overlayManager.open('menu');
  if (settingsOverlay && !settingsOverlay.classList.contains('hidden')) overlayManager.open('settings');
  if (cosmeticsOverlay && !cosmeticsOverlay.classList.contains('hidden')) overlayManager.open('cosmetics');
  if (matchOverlay && !matchOverlay.classList.contains('hidden')) overlayManager.open('match');
  if (deathOverlay && !deathOverlay.classList.contains('hidden')) overlayManager.open('death');
} catch {}

function ensureChatTextarea() {
  if (!chatInput || chatInput.tagName === 'TEXTAREA') return;
  const prev = chatInput;
  const ta = document.createElement('textarea');
  ta.id = prev.id;
  ta.placeholder = prev.getAttribute('placeholder') || '';
  ta.maxLength = prev.maxLength;
  ta.autocomplete = prev.autocomplete;
  ta.autocapitalize = prev.autocapitalize;
  ta.autocorrect = prev.getAttribute('autocorrect') || '';
  ta.spellcheck = prev.spellcheck;
  ta.rows = 1;
  ta.value = prev.value || '';
  for (const a of prev.getAttributeNames()) {
    if (a === 'id') continue;
    if (a === 'value') continue;
    if (a === 'placeholder') continue;
    try {
      if (!ta.hasAttribute(a)) ta.setAttribute(a, prev.getAttribute(a) || '');
    } catch {}
  }
  try {
    prev.replaceWith(ta);
  } catch {
    return;
  }
  chatInput = ta;
}

ensureChatTextarea();

try {
  if (emojiBtn) emojiBtn.classList.add('iconBtn');
  if (chatBtn) {
    chatBtn.classList.add('iconBtn');
    chatBtn.replaceChildren();
    const s = document.createElement('span');
    s.setAttribute('aria-hidden', 'true');
    s.textContent = '➤';
    chatBtn.appendChild(s);
  }
} catch {}

let W = 0;
let H = 0;
let N = 0;
let you = 0;
let tickMs = 100;
let mapCells = 0;
let roomId = null;

/* K7 «Реконнект». roomId комнаты, в которую нужно вернуться после разрыва:
   ставится в onClose, гасится после успешного onInit или явного выхода.
   userLeftRoom отличает «игрок нажал Выйти» от «сеть отвалилась». */
let rejoinRoomId = null;
let rejoinPending = false;
let userLeftRoom = false;
/* C9: у ожидания возврата не было таймаута, а разбирались только ответы
   room_not_found / room_full. При любом другом ответе (или проглоченном join)
   игрок навсегда оставался на замороженном игровом экране. */
let rejoinTimeoutTimer = 0;
const REJOIN_TIMEOUT_MS = 6000;

function rejoinFinish() {
  rejoinPending = false;
  if (rejoinTimeoutTimer) {
    clearTimeout(rejoinTimeoutTimer);
    rejoinTimeoutTimer = 0;
  }
}

// Возврат не состоялся: уводим в меню вместо замороженного игрового экрана.
function rejoinGiveUp(msg) {
  rejoinFinish();
  rejoinRoomId = null;
  roomId = null;
  roomLimit = null;
  started = false;
  try {
    document.body.classList.remove('inGame');
  } catch {}
  try {
    updateRoomInfo();
  } catch {}
  try {
    showMenuOverlay();
  } catch {}
  try {
    addToast('⚠', msg || t('net.rejoin_failed'), null, null, { key: 'net_reconnect' });
  } catch {}
}

function rejoinBegin() {
  rejoinPending = true;
  if (rejoinTimeoutTimer) clearTimeout(rejoinTimeoutTimer);
  rejoinTimeoutTimer = setTimeout(() => {
    rejoinTimeoutTimer = 0;
    if (!rejoinPending) return;
    rejoinGiveUp(null);
  }, REJOIN_TIMEOUT_MS);
}

/* Клик «Играть»/«Войти» до того, как сокет успел открыться (обычно —
   в первые доли секунды после загрузки страницы), раньше просто гасился
   тостом «офлайн»: само намерение войти в игру нигде не запоминалось, и
   игроку приходилось жать кнопку заново, пока клик не попадал в момент,
   когда соединение уже установлено. Здесь то же решение, что и у
   rejoinRoomId для обрыва связи посреди матча — намерение переживает
   соединение и посылается один раз, как только оно откроется. */
let pendingQuickJoin = null;
let roomLimit = null;

let matchSeq = 0;
let matchEndTick = 0;

/* C2: арка матча (сервер, F4/G24). Фаза приезжает в init/matchStart и
   отдельным JSON-сообщением matchPhase на каждой границе. До этого клиент
   её не читал вовсе, и удвоение очков за захват в финале было невидимым. */
const PHASE_EXPANSION = 0;
const PHASE_CONFLICT = 1;
const PHASE_FINAL = 2;
let matchPhase = PHASE_EXPANSION;
let matchPhaseUntil = 0;
// Множитель очков за захват в финале. Сервер сообщает его в hello (finalMult).
let matchFinalMult = 2;
// Чтобы баннер «ФИНАЛ ×2» не повторялся при повторной доставке того же события.
let matchPhaseBannerSeq = -1;

function phaseKey(ph) {
  return ph === PHASE_FINAL ? 'final' : ph === PHASE_CONFLICT ? 'conflict' : 'expansion';
}

function phaseLabel(ph) {
  return t(`phase.${phaseKey(ph)}`);
}

function phaseDesc(ph) {
  return t(`phase.${phaseKey(ph)}_desc`);
}

function phaseIcon(ph) {
  return ph === PHASE_FINAL ? '🔥' : ph === PHASE_CONFLICT ? '⚔' : '🌱';
}

/* Применяет фазу. announce=true только для реальной смены фазы по ходу матча —
   при входе в комнату посреди финала баннер не нужен. */
function applyMatchPhase(ph, until, announce, seq) {
  const next = Math.max(0, Math.min(2, Number(ph) || 0));
  const prev = matchPhase;
  matchPhase = next;
  matchPhaseUntil = Math.max(0, Number(until) || 0);

  if (announce && next === PHASE_FINAL && prev !== PHASE_FINAL && started) {
    const s = Number.isFinite(Number(seq)) ? Number(seq) : matchSeq;
    if (matchPhaseBannerSeq !== s) {
      matchPhaseBannerSeq = s;
      const title = t('phase.final_banner').replace('×2', `×${matchFinalMult}`);
      if (!showBigBanner('🔥', title, phaseDesc(PHASE_FINAL), 'jackpot')) {
        addToast('🔥', title, 'big', phaseDesc(PHASE_FINAL), {
          tab: 'match',
          key: 'match_phase_final',
          prio: 'jackpot'
        });
      }
      try {
        sfx.jackpot?.();
      } catch {}
    }
  } else if (announce && next !== prev && started) {
    addToast(phaseIcon(next), `${t('phase.label')}: ${phaseLabel(next)}`, null, phaseDesc(next), {
      tab: 'match',
      key: 'match_phase',
      prio: 'important'
    });
  }

  try {
    renderTopHud();
  } catch {}
}

function onMatchPhase(d) {
  if (!d || typeof d !== 'object') return;
  applyMatchPhase(d.phase, d.until, true, d.seq);
}
let matchEnded = false;
let matchResetAt = 0;

let matchStyleEarned = 0;

let matchContinuePending = false;
let matchContinueTimeout = 0;
let matchAutoJoin = localStorage.getItem('matchAutoJoin') !== '0';
let lastMatchResults = null;

let mutatorType = 0;
let mutatorUntil = 0;
let bountyTarget = 0;
let bountyUntil = 0;
let powerUps = new Map();
// C14: экран-координаты нарисованных бонусов — для подсказки эффекта по
// наведению мыши (у канвас-объектов нет нативного title). Заполняется в draw().
let powerUpScreenPos = [];

let youKills = 0;
let youStreak = 0;

const eventFeed = [];
// C10: дедуп предупреждений о неизвестных типах событий.
const unknownEventKindSeen = new Set();

const toastByKey = new Map();
const toastQueue = [];
const MAX_EVENT_TOASTS = 3;

// J19: приоритеты вместо чистого FIFO — иначе ачивка ждёт за тремя «+15 Стиля».
const TOAST_PRIO = { minor: 0, important: 1, jackpot: 2 };

function toastPrioValue(name) {
  return TOAST_PRIO[String(name || 'minor')] ?? 0;
}

function toastDrain() {
  if (!eventToastsEl) return;
  while (eventToastsEl.children.length < MAX_EVENT_TOASTS && toastQueue.length) {
    // Берём самый приоритетный, при равенстве — самый старый.
    let best = -1;
    let bestPrio = -1;
    for (let i = 0; i < toastQueue.length; i++) {
      const it = toastByKey.get(toastQueue[i]);
      if (!it || it.el) continue;
      const pv = toastPrioValue(it.prio);
      if (pv > bestPrio) {
        bestPrio = pv;
        best = i;
      }
    }
    if (best < 0) {
      toastQueue.length = 0;
      return;
    }
    const nextKey = toastQueue.splice(best, 1)[0];
    const next = toastByKey.get(nextKey);
    if (!next || next.el) continue;
    toastMount(next);
  }
}

// Смонтированный тост с наименьшим приоритетом — кандидат на вытеснение.
function toastLowestMounted() {
  let worst = null;
  let worstPrio = Infinity;
  for (const it of toastByKey.values()) {
    if (!it?.el) continue;
    const pv = toastPrioValue(it.prio);
    if (pv < worstPrio) {
      worstPrio = pv;
      worst = it;
    }
  }
  return worst;
}

function toastUnmount(item) {
  if (!item) return;
  try {
    if (item.timer) clearTimeout(item.timer);
  } catch {}
  item.timer = 0;
  try {
    item.el?.remove?.();
  } catch {}
  item.el = null;
  item.textEl = null;
  toastByKey.delete(item.key);
}

// J7: пульс при повторе события — с рефлоу-сбросом, иначе анимация не рестартует.
function toastBump(el) {
  if (!el) return;
  try {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  } catch {}
}

// UX18: тосты активных модификаторов раунда ("Раунд: ...") теряют смысл,
// когда игрок уже смотрит на экран смерти/результатов — убираем их вместе
// с открытием оверлея, сам механизм тостов не трогаем.
function dismissRoundModToasts() {
  for (const item of Array.from(toastByKey.values())) {
    if (String(item.key || '').startsWith('mutator_') && item.el) {
      toastUnmount(item);
    }
  }
}

function toastMount(item) {
  if (!eventToastsEl || !item) return;
  const wrap = document.createElement('div');
  wrap.className = item.variant === 'big' ? 'eventToast eventToastBig' : 'eventToast';

  const ic = document.createElement('div');
  ic.className = 'eventToastIcon';
  ic.textContent = String(item.icon || '★');

  const body = document.createElement('div');
  body.style.display = 'grid';
  body.style.gap = '2px';

  const tx = document.createElement('div');
  tx.className = 'eventToastText';
  const baseText = String(item.baseText || item.text || '');
  tx.textContent = item.count > 1 ? `${baseText} x${item.count}` : baseText;
  body.appendChild(tx);

  const sub = String(item.subtext || '').trim();
  if (sub) {
    const subEl = document.createElement('div');
    subEl.className = 'eventToastSub';
    subEl.textContent = sub;
    body.appendChild(subEl);
  }

  wrap.appendChild(ic);
  wrap.appendChild(body);

  if (item.action && typeof item.action === 'object') {
    wrap.classList.add('eventToastAction');
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'button');
    wrap.setAttribute('aria-label', baseText);
    const run = () => {
      const tab = String(item.action?.tab || '');
      if (tab === 'match' || tab === 'team' || tab === 'chat') setRightTab(tab, true);
    };
    wrap.addEventListener('click', (e) => {
      e?.preventDefault?.();
      run();
    });
    wrap.addEventListener('keydown', (e) => {
      if (e.key === ' ') {
        e.preventDefault();
        run();
      }
    });
  }

  eventToastsEl.prepend(wrap);
  item.el = wrap;
  item.textEl = tx;

  const ttl = item.variant === 'big' ? 8200 : 2200;
  if (item.variant === 'big') {
    bigToastCooldownUntil = performance.now() + 2500;
    // J21: класс .eventToastBig раньше снимался через 2100 мс при живущем
    // 8200 мс тосте — 3/4 времени «крупный» тост выглядел обычным.
    // Теперь модификатор держится всю жизнь тоста.
  }

  item.timer = setTimeout(() => {
    try {
      wrap.remove();
    } catch {}
    toastByKey.delete(item.key);
    toastDrain();
  }, ttl);
}

let lastEventsTick = 0;
let lastEventsAt = 0;

let bigToastCooldownUntil = 0;

let youShield = false;
let youSpeedUntilTick = 0;
let youSpeedType = 0;

let youStyle = 0;
/* Что куплено и что надето — по ключу-категории, а не четырнадцатью плоскими
   переменными. Модель и правила живут в client_cos_state.js.
   Категории terr и death приходят отдельным JSON-сообщением `cosExtra`
   (бинарный ROI-снапшот остаётся 21-байтным и не меняется). Сообщения может
   не быть вовсе — тогда всё по нулям и выглядит как базовый вариант. */
const youCos = createCosState();
let youTitleId = 0;
let youTitleMask = 0;

// Экипировка новых категорий по номерам игроков (из cosExtra).
const cosTerrByPlayer = new Map();
const cosDeathByPlayer = new Map();
const cosTitleByPlayer = new Map();

let cosmeticsOpen = false;
let cosmeticsCat = 'terr';
let cosmeticsSelId = 0;

// Последняя категория, к которой уже подскроллили ленту вкладок.
let cosmeticsTabsScrolledCat = '';

let cosmeticsFilter = 'all';
let cosmeticsEarnExpanded = false;

let cosmeticsLoaded = false;

let cosmeticsSource = 'server';

let cosmeticsPrices = null;

let cosmeticsPreviewRaf = 0;

let cosmeticsPreviewLastAt = 0;

// Превью показывает ВЫБРАННЫЙ предмет (клик или фокус с клавиатуры).
// Наведение мыши превью не переключает: раньше hover перебивал выбор, пока
// курсор был над списком, и клик по карточке визуально «не работал».

let pendingCosmeticsOp = null;
let cosmeticsOpTimer = 0;

const COSMETICS_CACHE_KEY = 'snakes_cosmetics_cache_v1';

let styleToastAcc = 0;
let styleToastReason = 0;
let styleToastCount = 0;
let styleToastTimer = 0;
let youContractType = 0;
let youContractGoal = 0;
let youContractProgress = 0;
let youContractUntil = 0;

/* C7: слотов ежедневок у сервера три (sendDailyStateToPlayer шлёт 1, 2, 3), а
   клиент знал только про два: `if (slot === 1) ... else ...` затирал второй
   слот третьим, прогресс двух разных квестов писался в одни переменные и
   скакал. Теперь хранилище по номеру слота — число слотов задаёт сервер. */
const youDailies = new Map();

function dailySlots() {
  return Array.from(youDailies.keys()).sort((a, b) => a - b);
}

function dailySetAssign(slot, type, goal, prog) {
  const s = Number(slot) || 0;
  if (s <= 0) return;
  youDailies.set(s, { type: Number(type) || 0, goal: Number(goal) || 0, prog: Number(prog) || 0 });
  // Дейлики видны и на экране меню — держим блок в актуальном состоянии.
  try {
    renderMenuMeta();
  } catch {}
}

function dailySetProgress(slot, prog) {
  const s = Number(slot) || 0;
  const it = youDailies.get(s);
  if (!it) {
    // Прогресс раньше назначения (перезаход в комнату) — не теряем его.
    youDailies.set(s, { type: 0, goal: 0, prog: Number(prog) || 0 });
    return;
  }
  it.prog = Number(prog) || 0;
  try {
    renderMenuMeta();
  } catch {}
}

let fxEnabled = true;
let fxIntensity = 0.85;
let shakeIntensity = 0.55;
let perfEnabled = false;
let perfCompact = false;
let soundEnabled = true;
let soundVolume = 0.7;
let muteOnBlur = true;
/* Тактильный отклик. По умолчанию включён, но реально срабатывает только там,
   где navigator.vibrate поддержан (Android/Chrome); iOS Safari его не знает —
   там настройка просто ничего не делает и в UI не показывается. */
let hapticsEnabled = true;
let hudBrightness = 1;
let hudContrast = 1;
let hudPanelOpacity = 0.82;

let hudDensity = 'comfy';

let soundMutedByBlur = false;

const fxBursts = [];
const fxParticles = [];
let shakeX = 0;
let shakeY = 0;
let shakeVelX = 0;
let shakeVelY = 0;

const audio = createAudioModule();
const fx = createFxModule();

function audioState() {
  return {
    soundEnabled: soundEnabled && !soundMutedByBlur,
    soundVolume: Math.max(0, Math.min(1, (Number(soundVolume) || 0) * fxVolumeScale()))
  };
}

audio.configure(audioState);

function playBeep(freq, ms, vol) {
  audio.playBeep(freq, ms, vol, audioState);
}

function applyHudSettings() {
  const b = document.body;
  if (!b) return;
  try {
    b.style.setProperty('--hud-brightness', String(hudBrightness));
    b.style.setProperty('--hud-contrast', String(hudContrast));
    b.style.setProperty('--hud-panel-alpha', String(hudPanelOpacity));
  } catch {}
}

function getHudDensityDefault() {
  try {
    const raw = localStorage.getItem(HUD_DENSITY_KEY);
    if (raw === 'comfy' || raw === 'compact') return raw;
  } catch {}
  return 'comfy';
}

function applyHudDensity(next) {
  const v = String(next || 'comfy');
  if (v !== 'comfy' && v !== 'compact') return;
  hudDensity = v;
  try {
    document.body.dataset.hudDensity = hudDensity;
  } catch {}
  try {
    localStorage.setItem(HUD_DENSITY_KEY, hudDensity);
  } catch {}
}

function applyPerfUi() {
  if (perfEl) perfEl.classList.toggle('perfCompact', !!perfCompact);
}

/* --- Тактильный отклик ------------------------------------------------------
   navigator.vibrate есть только на части устройств (Android/Chrome), и на
   десктопе он бессмысленен. Строку настройки показываем лишь там, где API
   реально существует, — иначе игрок щёлкает выключателем в пустоту. */
function hapticsSupported() {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
    // Desktop Chrome объявляет vibrate и молча ничего не делает — по одному
    // наличию метода строка настройки вылезала бы на десктопе. Требуем ещё и
    // признак тач-устройства.
    const coarse = !!window.matchMedia?.('(pointer: coarse)')?.matches;
    const touch = Number(navigator.maxTouchPoints) > 0;
    return coarse && touch;
  } catch {
    return false;
  }
}

function syncHapticsRowUi() {
  const row = document.getElementById('hapticsRow');
  if (row) row.classList.toggle('hidden', !hapticsSupported());
}

function vibrate(pattern) {
  if (!hapticsEnabled) return;
  if (prefersReducedMotion()) return;
  if (!hapticsSupported()) return;
  try {
    navigator.vibrate(pattern);
  } catch {}
}

function addFxBurst(x, y, kind, extra) {
  fx.addFxBurst(x, y, kind, () => ({ fxEnabled, fxBursts, shakeIntensity, addShakeVel }), extra);
}

function addShake(amount, dirX, dirY) {
  fx.addShake(amount, () => ({ shakeIntensity, addShakeVel }), dirX, dirY);
}

function addShakeVel(dx, dy) {
  shakeVelX += dx;
  shakeVelY += dy;
}

/* ==========================================================================
 * J22 — пресеты эффектов
 * ======================================================================== */

const FX_PRESETS = {
  calm: { shake: 0, flash: 0, particles: 0.35, hitstop: 0, countUp: false, volume: 0.6, banner: true },
  normal: { shake: 1, flash: 1, particles: 1, hitstop: 1, countUp: true, volume: 1, banner: true },
  casino: { shake: 1.45, flash: 1.25, particles: 1.4, hitstop: 1.3, countUp: true, volume: 1.1, banner: true }
};

let fxPreset = 'normal';
// Ручное переопределение авто-падения в «Спокойно» при prefers-reduced-motion.
let fxPresetUserSet = false;

function prefersReducedMotion() {
  try {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  } catch {}
  return false;
}

function fxPresetDef() {
  return FX_PRESETS[fxPreset] || FX_PRESETS.normal;
}

function fxShakeScale() {
  // K7: единственная из пяти fx-функций, которая не уважала системный запрет
  // анимаций. Тряска экрана — ровно то, что prefers-reduced-motion выключает.
  if (prefersReducedMotion()) return 0;
  return Math.max(0, fxPresetDef().shake);
}

// J9: вспышки жёстко выключены при системном запрете анимаций и в «Спокойно».
function fxFlashScale() {
  if (prefersReducedMotion()) return 0;
  return Math.max(0, fxPresetDef().flash);
}

function fxParticleScale() {
  return Math.max(0, fxPresetDef().particles);
}

function fxHitstopScale() {
  if (prefersReducedMotion()) return 0;
  return Math.max(0, fxPresetDef().hitstop);
}

function fxCountUpEnabled() {
  if (prefersReducedMotion()) return false;
  return !!fxPresetDef().countUp;
}

function fxBannerEnabled() {
  return !!fxPresetDef().banner;
}

function fxVolumeScale() {
  return Math.max(0, fxPresetDef().volume);
}

/* ==========================================================================
 * J12 — hitstop
 *
 * На джекпот-события интерполяция игроков идёт с множителем 0.15 в течение
 * 90-140 мс. Эффекты (вспышки, бурсты, тосты) живут по реальному времени —
 * замедляется только движение змеек, поэтому удар «звенит», а не тормозит UI.
 * В пресете «Спокойно» hitstop равен 0 и весь механизм выключен.
 * ======================================================================== */

const HITSTOP_TIME_SCALE = 0.15;

let hitstopFrom = 0;
let hitstopUntil = 0;

function triggerHitstop(ms) {
  const k = fxHitstopScale();
  if (k <= 0) return;
  const dur = Math.max(0, Number(ms) || 0) * k;
  if (dur <= 0) return;
  const now = performance.now();
  if (now < hitstopUntil) {
    hitstopUntil = Math.max(hitstopUntil, now + dur);
    return;
  }
  hitstopFrom = now;
  hitstopUntil = now + dur;
}

// Сколько «съел» hitstop из окна [since, now]. Вычитается из времени
// интерполяции, поэтому змейки в эти миллисекунды почти стоят.
function hitstopLostMs(since, now) {
  if (!hitstopUntil) return 0;
  const s = Math.max(hitstopFrom, Number(since) || 0);
  const e = Math.min(now, hitstopUntil);
  if (e <= s) return 0;
  return (e - s) * (1 - HITSTOP_TIME_SCALE);
}

function normalizeFxPreset(v) {
  const s = String(v || '').trim();
  return FX_PRESETS[s] ? s : '';
}

function applyFxPreset(next, fromUser) {
  const v = normalizeFxPreset(next);
  if (!v) return;
  fxPreset = v;
  if (fromUser) fxPresetUserSet = true;
  try {
    document.body.dataset.fxPreset = fxPreset;
  } catch {}
  const sel = document.getElementById('fxPresetSelect');
  if (sel) {
    try {
      sel.value = fxPreset;
    } catch {}
  }
}

/* ==========================================================================
 * J6 — count-up чисел
 * ======================================================================== */

const numberAnims = new WeakMap();

function cancelNumberAnim(el) {
  const prev = numberAnims.get(el);
  if (!prev) return;
  try {
    if (prev.raf) cancelAnimationFrame(prev.raf);
  } catch {}
  try {
    if (prev.to) clearTimeout(prev.to);
  } catch {}
  numberAnims.delete(el);
  try {
    el.classList.remove('counting');
  } catch {}
}

// animateNumber(el, from, to, ms, { delay, prefix, suffix, format, onDone })
function animateNumber(el, from, to, ms, opts) {
  if (!el) return;
  const o = opts || {};
  const fmt = typeof o.format === 'function' ? o.format : (v) => fmtInt(v);
  const pre = String(o.prefix ?? '');
  const suf = String(o.suffix ?? '');
  const a = Number(from) || 0;
  const b = Number(to) || 0;
  const dur = Math.max(0, Number(ms) || 0);
  const delay = Math.max(0, Number(o.delay) || 0);

  cancelNumberAnim(el);

  const write = (v) => {
    try {
      el.textContent = `${pre}${fmt(v)}${suf}`;
    } catch {}
  };

  const finish = () => {
    write(b);
    try {
      el.classList.remove('counting');
    } catch {}
    numberAnims.delete(el);
    try {
      o.onDone?.();
    } catch {}
  };

  const wide = Math.abs(b - a) > 5;
  const animated = dur > 0 && wide && fxCountUpEnabled();

  if (!animated) {
    if (delay > 0) {
      numberAnims.set(el, { raf: 0, to: setTimeout(finish, delay) });
    } else {
      finish();
    }
    return;
  }

  write(a);

  const start = () => {
    const rec = numberAnims.get(el) || { raf: 0, to: 0 };
    rec.to = 0;
    try {
      el.classList.add('counting');
    } catch {}
    const t0 = performance.now();
    const step = () => {
      const p = dur > 0 ? (performance.now() - t0) / dur : 1;
      if (p >= 1) {
        finish();
        return;
      }
      write(a + (b - a) * easeOutCubic(p));
      rec.raf = requestAnimationFrame(step);
      numberAnims.set(el, rec);
    };
    rec.raf = requestAnimationFrame(step);
    numberAnims.set(el, rec);
  };

  if (delay > 0) {
    numberAnims.set(el, { raf: 0, to: setTimeout(start, delay) });
  } else {
    start();
  }
}

/* ==========================================================================
 * J9 — полноэкранная вспышка (#fxFlash)
 * ======================================================================== */

const FX_FLASH_MIN_INTERVAL_MS = 400; // не чаще 2.5 Гц
const FX_FLASH_PEAK_ALPHA = 0.35;
const FX_FLASH_DUR_MS = 280;
const FX_FLASH_RISE_MS = 90;

let fxFlashLastAt = 0;
let fxFlashRaf = 0;

function clampByte(v) {
  const n = Math.round(Number(v) || 0);
  return Math.max(0, Math.min(255, n));
}

// Красный канал не должен мигать изолированно: подтягиваем G/B под R.
function safeFlashRgb(rgb) {
  let r = clampByte(rgb?.[0]);
  let g = clampByte(rgb?.[1]);
  let b = clampByte(rgb?.[2]);
  const floor = Math.round(r * 0.45);
  if (g < floor) g = floor;
  if (b < floor) b = floor;
  return [r, g, b];
}

function fxFlashScreen(rgb, strength) {
  if (!fxEnabled) return;
  const scale = fxFlashScale();
  if (scale <= 0) return;
  const el = document.getElementById('fxFlash');
  if (!el) return;

  const now = performance.now();
  if (now - fxFlashLastAt < FX_FLASH_MIN_INTERVAL_MS) return;
  fxFlashLastAt = now;

  const [r, g, b] = safeFlashRgb(rgb);
  const s = Math.max(0, Math.min(1, Number(strength ?? 1)));
  const peak = Math.min(FX_FLASH_PEAK_ALPHA, FX_FLASH_PEAK_ALPHA * s * scale);
  if (peak <= 0.005) return;

  try {
    if (fxFlashRaf) cancelAnimationFrame(fxFlashRaf);
  } catch {}
  fxFlashRaf = 0;

  try {
    el.style.transition = 'none';
    el.style.background = `radial-gradient(circle at 50% 50%, rgba(${r},${g},${b},0.90) 0%, rgba(${r},${g},${b},0.42) 42%, rgba(${r},${g},${b},0) 72%)`;
    el.style.opacity = '0';
    el.classList.add('isOn');
  } catch {
    return;
  }

  const t0 = performance.now();
  const step = () => {
    const age = performance.now() - t0;
    if (age >= FX_FLASH_DUR_MS) {
      try {
        el.style.opacity = '0';
        el.classList.remove('isOn');
      } catch {}
      fxFlashRaf = 0;
      return;
    }
    const a =
      age < FX_FLASH_RISE_MS
        ? (age / FX_FLASH_RISE_MS) * peak
        : peak * (1 - (age - FX_FLASH_RISE_MS) / (FX_FLASH_DUR_MS - FX_FLASH_RISE_MS));
    try {
      el.style.opacity = Math.max(0, a).toFixed(3);
    } catch {}
    fxFlashRaf = requestAnimationFrame(step);
  };
  fxFlashRaf = requestAnimationFrame(step);
}

/* ==========================================================================
 * J13 — центральный баннер крупных событий (#bigBanner)
 * ======================================================================== */

const BIG_BANNER_MIN_INTERVAL_MS = 3000;
const BIG_BANNER_TTL_MS = 2600;

let bigBannerLastAt = 0;
let bigBannerTimer = 0;

// Возвращает true, если баннер показан. Иначе вызывающий откатывается на тост.
function showBigBanner(icon, title, sub, mod) {
  if (!fxBannerEnabled()) return false;
  const el = document.getElementById('bigBanner');
  if (!el) return false;

  const now = performance.now();
  if (now - bigBannerLastAt < BIG_BANNER_MIN_INTERVAL_MS) return false;
  bigBannerLastAt = now;

  try {
    if (bigBannerTimer) clearTimeout(bigBannerTimer);
  } catch {}
  bigBannerTimer = 0;

  try {
    el.classList.remove('bannerJackpot', 'bannerDanger');
    const m = String(mod || '');
    if (m === 'jackpot') el.classList.add('bannerJackpot');
    else if (m === 'danger') el.classList.add('bannerDanger');

    const wrap = document.createElement('div');
    wrap.className = 'bigBannerInner';

    const ic = document.createElement('div');
    ic.className = 'bigBannerIcon';
    ic.textContent = String(icon || '★');

    const tt = document.createElement('div');
    tt.className = 'bigBannerTitle';
    tt.textContent = String(title || '');

    wrap.appendChild(ic);
    wrap.appendChild(tt);

    const s = String(sub || '').trim();
    if (s) {
      const se = document.createElement('div');
      se.className = 'bigBannerSub';
      se.textContent = s;
      wrap.appendChild(se);
    }

    el.replaceChildren(wrap);
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    // Перезапуск анимации: снимаем класс, форсируем рефлоу, ставим обратно.
    el.classList.remove('isOn');
    void el.offsetWidth;
    el.classList.add('isOn');
  } catch {
    return false;
  }

  bigBannerTimer = setTimeout(() => {
    bigBannerTimer = 0;
    try {
      el.classList.remove('isOn');
    } catch {}
  }, BIG_BANNER_TTL_MS);
  return true;
}

/* ==========================================================================
 * J14 — классы тряски
 * ======================================================================== */

const SHAKE_CLASSES = { micro: 0.08, small: 0.2, medium: 0.4, large: 0.7 };

function addShakeClass(kind, dirX, dirY) {
  const amt = SHAKE_CLASSES[String(kind || '')] ?? SHAKE_CLASSES.small;
  const scaled = amt * fxShakeScale();
  if (scaled <= 0) return;
  addShake(scaled, dirX, dirY);
}

// Вектор «от точки события к моей голове» — толчок в сторону игрока.
function shakeDirFrom(ex, ey) {
  const me = currPlayers?.get?.(you);
  if (!me) return [0, 0];
  const dx = (Number(me.x) || 0) - (Number(ex) || 0);
  const dy = (Number(me.y) || 0) - (Number(ey) || 0);
  if (!dx && !dy) return [0, 0];
  return [dx, dy];
}

/* ==========================================================================
 * J5 — всплывающие числа над точкой захвата
 * ======================================================================== */

const SCORE_POPUP_MS = 900;
const CAPTURE_JACKPOT_CELLS = 250;

/* F14 — первый захват в жизни игрока празднуется отдельно. */
const FIRST_CAPTURE_KEY = 'snakes_first_capture_v1';

function hasFirstCapture() {
  try {
    return localStorage.getItem(FIRST_CAPTURE_KEY) === '1';
  } catch {}
  return true;
}

function celebrateFirstCapture(delta) {
  if (hasFirstCapture()) return;
  try {
    localStorage.setItem(FIRST_CAPTURE_KEY, '1');
  } catch {}
  trackEvent('first_capture');
  sfx.firstCapture();
  fxFlashScreen([170, 255, 210], 1);
  // J12: момент озарения тоже заслуживает hitstop.
  triggerHitstop(120);
  const sub = `+${fmtInt(delta)} · ${t('banner.first_capture_sub')}`;
  if (!showBigBanner('🎉', t('banner.first_capture'), sub, 'jackpot')) {
    addToast('🎉', t('banner.first_capture'), 'big', sub, { key: 'first_capture', prio: 'jackpot' });
  }
}

function addScorePopup(x, y, value) {
  const v = Math.max(0, Math.round(Number(value) || 0));
  if (!v) return;
  addFxBurst(x, y, 'score', { value: v });
}

/* ==========================================================================
 * J10 — комбо с растущим тоном
 * ======================================================================== */

const COMBO_WINDOW_MS = 3000;
let comboCount = 0;
let comboLastAt = 0;
let comboTimer = 0;

let comboHudSig = '';

function renderComboHud() {
  const el = document.getElementById('hudCombo');
  if (!el) return;
  // renderTopHud вызывается каждый кадр — пересобираем DOM только при изменении.
  const sig = started ? `${youKills}|${comboCount}` : '';
  if (sig === comboHudSig) return;
  comboHudSig = sig;

  const showCombo = comboCount >= 2;
  if (!started) {
    el.classList.remove('isOn');
    el.replaceChildren();
    return;
  }
  try {
    const kills = document.createElement('span');
    kills.className = 'hudComboKills';
    kills.textContent = `⚔ ${youKills}`;

    el.replaceChildren(kills);

    if (showCombo) {
      const c = document.createElement('span');
      c.className = 'hudComboValue';
      c.textContent = `x${comboCount}`;
      const grow = Math.min(2.0, 1 + (comboCount - 2) * 0.14);
      c.style.fontSize = `${(100 * grow).toFixed(0)}%`;
      el.appendChild(c);
    }
    el.classList.toggle('isOn', showCombo || youKills > 0);
  } catch {}
}

function comboBump() {
  const now = performance.now();
  if (now - comboLastAt > COMBO_WINDOW_MS) comboCount = 0;
  comboLastAt = now;
  comboCount++;

  if (comboCount >= 2) {
    // +2 полутона за шаг цепочки.
    const semis = Math.min(24, (comboCount - 2) * 2);
    sfx.comboStep(semis);
  }
  renderComboHud();

  try {
    if (comboTimer) clearTimeout(comboTimer);
  } catch {}
  comboTimer = setTimeout(comboBreak, COMBO_WINDOW_MS + 40);
}

function comboBreak() {
  comboTimer = 0;
  const had = comboCount;
  comboCount = 0;
  renderComboHud();
  if (had >= 2) sfx.comboBreak();
}

function comboReset() {
  try {
    if (comboTimer) clearTimeout(comboTimer);
  } catch {}
  comboTimer = 0;
  comboCount = 0;
  comboLastAt = 0;
  comboHudSig = '';
  renderComboHud();
}

/* ==========================================================================
 * J16-J18 — звуковая палитра
 * ======================================================================== */

// Ноты (Гц)
const NOTE = {
  C3: 130.81,
  E3: 164.81,
  G3: 196.0,
  A3: 220.0,
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  F4: 349.23,
  G4: 392.0,
  A4: 440.0,
  B4: 493.88,
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
  G5: 783.99,
  A5: 880.0,
  C6: 1046.5,
  E6: 1318.51,
  G6: 1567.98,
  C7: 2093.0,
  E7: 2637.02
};

const sfx = {
  // ——— низ 70-350 Гц: опасность ———
  death() {
    audio.sweep(330, 82, 750, 'sawtooth', {
      vol: 0.9,
      attack: 0.012,
      decay: 0.72,
      filter: { type: 'lowpass', freq: 1400, freq2: 160, q: 1.2 },
      prio: 5
    });
    audio.noiseBurst(240, 'lowpass', 420, { vol: 0.35, attack: 0.004, decay: 0.22, prio: 4 });
  },
  kill() {
    audio.noiseBurst(160, 'lowpass', 900, { vol: 0.45, attack: 0.003, decay: 0.14, prio: 4 });
    audio.sweep(180, 70, 220, 'sawtooth', { vol: 0.55, attack: 0.004, decay: 0.2, prio: 4 });
  },
  revenge() {
    audio.sweep(220, 96, 380, 'sawtooth', { vol: 0.7, attack: 0.006, decay: 0.34, prio: 4 });
    audio.tone({ type: 'triangle', freq: NOTE.E3, dur: 260, vol: 0.4, delay: 120, prio: 3 });
  },
  explode() {
    audio.noiseBurst(320, 'lowpass', 700, { vol: 0.55, cutoff2: 140, attack: 0.002, decay: 0.3, prio: 4 });
    audio.sweep(140, 62, 300, 'sawtooth', { vol: 0.5, prio: 3 });
  },

  // ——— середина 350-700 Гц, triangle: прогресс ———
  captureSmall() {
    audio.tone({ type: 'triangle', freq: NOTE.C5, dur: 100, vol: 0.28, attack: 0.004, prio: 1 });
  },
  captureBig() {
    audio.arp([NOTE.C4, NOTE.E4, NOTE.G4, NOTE.C5], 62, { type: 'triangle', vol: 0.5, dur: 150, prio: 3 });
  },
  contractAssigned() {
    audio.arp([NOTE.D4, NOTE.G4], 90, { type: 'triangle', vol: 0.45, dur: 190, prio: 2 });
  },
  contractDone() {
    audio.arp([NOTE.G4, NOTE.B4, NOTE.D5], 70, { type: 'triangle', vol: 0.5, dur: 200, prio: 3 });
  },
  dailyAssigned() {
    audio.arp([NOTE.C4, NOTE.F4], 100, { type: 'triangle', vol: 0.4, dur: 200, prio: 2 });
  },
  dailyDone() {
    audio.arp([NOTE.F4, NOTE.A4, NOTE.C5], 72, { type: 'triangle', vol: 0.5, dur: 200, prio: 3 });
  },
  bountyAssigned(vol) {
    audio.tone({ type: 'triangle', freq: NOTE.E4, dur: 150, vol: 0.42 * (vol ?? 1), prio: 2 });
    audio.tone({ type: 'triangle', freq: NOTE.A4, dur: 190, vol: 0.38 * (vol ?? 1), delay: 110, prio: 2 });
  },
  bountyClaimed() {
    audio.arp([NOTE.A4, NOTE.C5, NOTE.E5, NOTE.A5], 66, { type: 'triangle', vol: 0.55, dur: 200, prio: 4 });
  },
  pickup() {
    audio.tone({ type: 'triangle', freq: NOTE.G4, dur: 90, vol: 0.35, prio: 1 });
    audio.tone({ type: 'triangle', freq: NOTE.D5, dur: 110, vol: 0.3, delay: 55, prio: 1 });
  },
  powerUsed() {
    audio.tone({ type: 'square', freq: NOTE.E4, dur: 120, vol: 0.3, filter: { type: 'lowpass', freq: 1600 }, prio: 2 });
  },
  streak(step) {
    const n = Math.max(0, Math.min(10, Number(step) || 0));
    audio.tone({ type: 'triangle', freq: 440 * Math.pow(2, n / 12), dur: 110, vol: 0.42, prio: 2 });
  },

  // ——— верх 700-1400 Гц, sine/аккорды: награды ———
  achievement() {
    audio.chord([NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6], 520, { type: 'sine', vol: 0.7, spread: 22, prio: 5 });
    audio.tone({ type: 'sine', freq: NOTE.E7, dur: 220, vol: 0.22, delay: 150, attack: 0.004, prio: 3 });
  },
  jackpot() {
    audio.arp([NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.E6], 58, { type: 'triangle', vol: 0.55, dur: 200, prio: 5 });
    audio.chord([NOTE.C5, NOTE.G5, NOTE.C6], 620, { type: 'sine', vol: 0.55, delay: 300, prio: 4 });
  },
  victory() {
    audio.arp([NOTE.C5, NOTE.D5, NOTE.E5, NOTE.G5, NOTE.A5, NOTE.C6], 130, {
      type: 'triangle',
      vol: 0.5,
      dur: 240,
      prio: 6
    });
    audio.chord([NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6], 780, { type: 'sine', vol: 0.65, delay: 820, prio: 6 });
  },
  defeat() {
    audio.arp([NOTE.A4, NOTE.G4, NOTE.F4, NOTE.E4], 150, { type: 'triangle', vol: 0.45, dur: 300, prio: 6 });
    audio.chord([NOTE.A3, NOTE.C4, NOTE.E4], 700, { type: 'sine', vol: 0.5, delay: 620, prio: 5 });
  },
  firstCapture() {
    audio.arp([NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6], 90, { type: 'triangle', vol: 0.55, dur: 260, prio: 6 });
    audio.tone({ type: 'sine', freq: NOTE.E7, dur: 260, vol: 0.2, delay: 320, prio: 4 });
  },
  styleGain() {
    audio.tone({ type: 'sine', freq: NOTE.C6, dur: 120, vol: 0.24, prio: 1 });
  },

  // ——— свипы: временные состояния ———
  mutatorOn(vol) {
    audio.sweep(240, 720, 340, 'sawtooth', {
      vol: 0.45 * (vol ?? 1),
      filter: { type: 'lowpass', freq: 700, freq2: 2600 },
      prio: 2
    });
  },
  mutatorOff(vol) {
    audio.sweep(620, 220, 300, 'triangle', { vol: 0.35 * (vol ?? 1), prio: 1 });
  },
  speedOn() {
    audio.sweep(420, 980, 260, 'triangle', { vol: 0.4, prio: 2 });
  },

  // ——— комбо ———
  comboStep(semis) {
    const s = Math.max(0, Math.min(28, Number(semis) || 0));
    audio.tone({ type: 'triangle', freq: 392 * Math.pow(2, s / 12), dur: 110, vol: 0.34, prio: 2 });
  },
  comboBreak() {
    audio.sweep(520, 180, 260, 'sine', { vol: 0.28, prio: 1 });
  },

  ui() {
    audio.tone({ type: 'sine', freq: NOTE.A5, dur: 70, vol: 0.2, prio: 0 });
  },

  // J6: восходящий бип каскада результатов.
  countStep(i) {
    const n = Math.max(0, Math.min(8, Number(i) || 0));
    audio.tone({ type: 'sine', freq: 523.25 * Math.pow(2, (n * 2) / 12), dur: 110, vol: 0.26, prio: 2 });
  }
};

let started = false;
let youAlive = false;

let lastRooms = [];

let roomsLoading = false;
let roomsLoadError = '';
let roomsLoadTimeout = 0;

let selectedRoomId = null;

let roomsCreateOpen = false;
let createRoomPending = false;

let roomsAutoRefreshAt = 0;

/* Счётчики шагов до игры: нажал «Играть», создал комнату, обновил список.
   Игровые события (заходы, убийства, захват) считает сервер сам — здесь
   только то, что происходит ДО подключения и потому серверу не видно.

   Вместе с серверным snakes_joins_total это даёт воронку: сколько нажало
   «Играть» против того, сколько реально подключилось. Расхождение между
   ними — сорвавшиеся подключения, и увидеть его больше негде.

   Что уходит: пустой POST на /e/<имя>. Ни тела, ни параметров, ни cookie,
   ни идентификатора. Сервер отвечает 204 и пишет строку без IP и
   User-Agent — их нет в log_format. Связать два события одного игрока
   не по чему.

   Список имён закрыт на стороне экспортёра (nginxlog.yml в
   metrics.samoy.love): незнакомое сворачивается в ряд "other". Добавляя
   событие здесь, добавьте его и там.

   Запись в localStorage осталась от прежней версии: она никем не читается —
   ни здесь, ни на сервере, — но и не мешает, а на отладке в консоли иногда
   удобна. */
/* Счётчик пользовательских событий.
   Раньше отсюда же уходил sendBeacon на /e/<событие>. Такого маршрута на
   сервере нет и никогда не было (см. main.go: mux знает только /ws, /healthz,
   /readyz, /metrics и статику), поэтому каждый «Играть» и «Обновить» давал
   404: пять ошибок в консоли за сессию, лишние запросы через nginx и мусор в
   его логах. Продуктовая аналитика в проекте живёт в Prometheus на стороне
   сервера, отдельный клиентский канал ей не нужен.
   Локальные счётчики оставлены: они бесплатны и полезны при разборе жалоб
   («сколько раз игрок вообще жал Играть») — читать их можно из консоли. */
function trackEvent(name) {
  const ev = String(name || '').trim();
  if (!ev) return;

  try {
    const key = `an_${ev}`;
    const cur = Number(localStorage.getItem(key)) || 0;
    localStorage.setItem(key, String(cur + 1));
  } catch {
    // Приватный режим, переполненное хранилище — счётчик не важнее игры.
  }
}

// lastState теперь в clientState.lastState (public/client_state.js)
let gridOwner = null;
let trailOwner = null;

let minimapGridOwner = null;

let gridFillAt = null;

/* F5 «Реклейм»: точный момент истечения приходит с сервера в EventCoolBatch
   (kind 21, поле C — тик исчезновения), и отсчёт ведётся по нему. Константа
   ниже — только запасной вариант на те кадры, когда клетка уже пришла с флагом
   остывания, а событие с дедлайном ещё нет, плюс потолок на приходящее
   значение. Держать её в соответствии с ReclaimTicks в internal/game/grid.go:
   150 тиков по 100 мс = 15 секунд. Расхождение здесь не ломает игру, но
   заставляет полосу отсчёта врать до прихода события. */
const RECLAIM_WINDOW_MS = 15000;
let coolSeenAt = null;

/* Окно реклейма, как его назвал сервер в hello (reclaimTicks). Нужно тексту
   подсказки на экране смерти: вписанное в словарь число уже один раз пережило
   изменение константы на сервере. Пусто — старый сервер, работает встроенное
   значение. */
let reclaimTicksFromServer = 0;

function reclaimWindowSec() {
  const ticks = Number(reclaimTicksFromServer) || 0;
  const ms = ticks > 0 ? ticks * (Number(tickMs) || 100) : RECLAIM_WINDOW_MS;
  return Math.round(ms / 1000);
}

// Бывший владелец -> момент (performance.now), когда его остывающая земля
// исчезнет окончательно. Приходит событием EventCoolBatch (21).
const coolDeadlineByOwner = new Map();

// Точка замыкания петли по игроку — из неё расходится волна заливки (J15).
const captureAnchorByOwner = new Map();

let prevPlayers = new Map();
let currPlayers = new Map();
let lastPacketAt = performance.now();

// camX/camY теперь в clientState (public/client_state.js)

/* VIEW_CELLS_X/Y и ROI_MARGIN_CELLS переехали в client_field_view.js —
   там же вся геометрия вида и тесты на неё. Здесь они только импортируются:
   расчёт запрашиваемого ROI обязан идти от тех же чисел, что и масштаб
   отрисовки, иначе окно и экран разъедутся. */
/* Камера жёстко привязана к игроку и никуда не ведётся: смещение по ходу
   движения заказчик отверг — взгляд уезжал на каждом повороте. Смещения
   остаются нулями, чтобы не разносить эту правку по всему draw(); окно ROI
   сервер тоже центрирует на голове (roiLookahead в protocol.go возвращает 0),
   поэтому вьюпорт лежит внутри окна по построению. */
// camLeadX/camLeadY теперь в clientState (public/client_state.js)
/* C1: запас, который вычитается из фактического ROI при подборе масштаба.
   Сервер снапит окно по 8 клеток (main.go ROIStep) и сдвигает его на 12 клеток
   вперёд по направлению движения (ROILookahead), то есть относительно игрока
   окно гуляет на ~20 клеток. Полный запас (20) зажал бы телефон до 16 клеток
   по ширине; 14 — компромисс между «поле видно» и «туман не лезет».
   Значение живёт в client_field_view.js. */

/* C2 «Адаптивный ROI». Раньше окно ROI на сервере было жёстко 80×56, и на
   портретном телефоне экран физически не влезал в него: масштаб приходилось
   зажимать снизу (см. draw()), а после резкого разворота внизу всё равно
   оставалась полоса тумана. Теперь сервер принимает сообщение
   `viewport {w,h}` — размер окна В КЛЕТКАХ, который клиент реально способен
   нарисовать, — и подтверждает выданный размер тем же типом сообщения.

   Контракт (ws.go, case "viewport" + hello.roi):
     → {"type":"viewport","data":{"w":46,"h":94}}
     ← {"type":"viewport","data":{"w":46,"h":94}}   // фактически выданное
   Границы приходят в hello.roi {w,h,minW,minH,maxW,maxH,maxArea,step}.

   Всё написано защищённо: если сервер старый — hello.roi нет, ack не придёт,
   сообщение молча проигнорируется, и клиент работает ровно как раньше на
   дефолтных 80×56. */
const roiCaps = {
  w: 80,
  h: 56,
  minW: 40,
  minH: 28,
  maxW: 120,
  maxH: 120,
  maxArea: 6000,
  step: 8,
};
// Поддержку подтверждаем только по факту ack — до него доверяем lastRoi.
let roiGrant = null;
let viewportSentW = 0;
let viewportSentH = 0;
let viewportTimer = 0;

function applyRoiCaps(src) {
  if (!src || typeof src !== 'object') return;
  for (const k of ['w', 'h', 'minW', 'minH', 'maxW', 'maxH', 'maxArea', 'step']) {
    const v = Number(src[k]);
    if (Number.isFinite(v) && v > 0) roiCaps[k] = Math.floor(v);
  }
}

/* Сколько клеток нужно, чтобы закрыть текущий вьюпорт. Базовый масштаб тот же,
   что в draw() (до клэмпа по ROI), плюс ROI_MARGIN_CELLS на гуляние окна:
   сервер снапит его по ROIStep и смещает вперёд по ходу движения. */
function computeViewportCells() {
  const cw = Math.max(1, Number(window.innerWidth) || 1);
  const chh = Math.max(1, Number(window.innerHeight) || 1);
  const cell = Math.max(6, Math.floor(Math.min(cw / VIEW_CELLS_X, chh / VIEW_CELLS_Y)));
  let w = Math.ceil(cw / cell) + ROI_MARGIN_CELLS;
  let h = Math.ceil(chh / cell) + ROI_MARGIN_CELLS;
  w = Math.max(roiCaps.minW, Math.min(roiCaps.maxW, w));
  h = Math.max(roiCaps.minH, Math.min(roiCaps.maxH, h));
  // Тот же порядок, что в clampViewport() на сервере: пропорционально, потом
  // подрезаем длинную сторону. Иначе наш «ожидаемый» размер разойдётся с
  // выданным и камера будет считать не по тому окну.
  if (w * h > roiCaps.maxArea) {
    const f = Math.sqrt(roiCaps.maxArea / (w * h));
    w = Math.max(roiCaps.minW, Math.floor(w * f));
    h = Math.max(roiCaps.minH, Math.floor(h * f));
    let guard = 4096;
    while (w * h > roiCaps.maxArea && guard-- > 0) {
      if (w - roiCaps.minW >= h - roiCaps.minH && w > roiCaps.minW) w--;
      else if (h > roiCaps.minH) h--;
      else break;
    }
  }
  return { w, h };
}

function sendViewportNow() {
  let want;
  try {
    want = computeViewportCells();
  } catch {
    return;
  }
  if (want.w === viewportSentW && want.h === viewportSentH) return;
  // Не отправлено — не запоминаем: иначе после реконнекта сервер останется на
  // дефолте, а клиент будет думать, что попросил.
  if (!wsSend('viewport', { w: want.w, h: want.h })) return;
  viewportSentW = want.w;
  viewportSentH = want.h;
}

/* Дебаунс: поворот экрана и сворачивание адресной строки на iOS дают серию
   событий подряд, а каждое из них — это перестройка ROI на сервере. */
function scheduleViewportSend(delayMs = 250) {
  if (viewportTimer) clearTimeout(viewportTimer);
  viewportTimer = setTimeout(() => {
    viewportTimer = 0;
    sendViewportNow();
  }, Math.max(0, delayMs));
}

// C10: переиспользуемая карта Path2D под пунктир остывающей территории.
const coolEdgePaths = new Map();
// C10: градиенты фона кадра зависят только от размеров вьюпорта.
let bgGradCacheKey = '';
let bgGradLinear = null;
let bgGradVignette = null;

let chatOpenUntil = 0;

const CHAT_AUTO_OPEN_MS = 6500;

function bumpChatVisibility(ms, focusInput) {
  if (!chat) return;
  if (menuOverlay && !menuOverlay.classList.contains('hidden')) return;
  if (settingsOverlay && !settingsOverlay.classList.contains('hidden')) return;
  if (cosmeticsOverlay && !cosmeticsOverlay.classList.contains('hidden')) return;
  if (matchOverlay && !matchOverlay.classList.contains('hidden')) return;

  if (chat.classList.contains('collapsed')) setChatCollapsed(false);
  const now = performance.now();
  const d = Math.max(0, Number(ms) || 0);
  chatOpenUntil = Math.max(chatOpenUntil, now + d);
  if (focusInput && chatInput) {
    try {
      chatInput.focus();
    } catch {}
  }
}

let unreadCount = 0;

function updateUnreadBadge() {
  if (!chatUnreadEl) return;
  const n = Math.max(0, Number(unreadCount) || 0);
  if (n <= 0) {
    chatUnreadEl.classList.add('hidden');
    chatUnreadEl.textContent = '';
    return;
  }
  chatUnreadEl.classList.remove('hidden');
  chatUnreadEl.textContent = n > 99 ? '99+' : String(n);
}

updateUnreadBadge();

function updateChatLayout() {
  if (!chat || !chatLog) return;
  const count = clientState.chatMessages.length;
  chat.classList.toggle('chatEmpty', count <= 0);
  let max = 320;
  if (count <= 0) max = 80;
  if (count <= 2) max = 140;
  if (count <= 6) max = 220;
  try {
    chat.style.setProperty('--chat-log-max', `${max}px`);
  } catch {}
}

const colors = new Map();

const minimapOwnerRgbCache = new Map();

const ownerFillStyleCache = new Map();
const ALPHA_STEPS = 64;

const fillAnimMs = 480;
const fillDelayMod = 170;
const waveSpeed = 0.0042;
const waveScale = 0.55;
const waveAlpha = 0.10;
const wavePeriodMs = (Math.PI * 2) / waveSpeed;

// chatMessages теперь в clientState.chatMessages (public/client_state.js)
const nameById = new Map();
/* C5: сервер шлёт английский вариант имени (nmEn) в nameUpdate и matchResult —
   клиент его никогда не читал, и в EN топ-5 выглядел кириллицей. Единая точка
   выбора имени: displayNameOf(). */
const nameEnById = new Map();

function displayNameOf(id, fallback) {
  const n = Number(id);
  if (lang === 'en') {
    const en = nameEnById.get(n);
    if (en) return en;
  }
  const ru = nameById.get(n);
  if (ru) return ru;
  return fallback != null ? fallback : String(id);
}

// Имя из произвольной записи сервера ({nm, nmEn}) — итоги матча, снапшот.
function displayNameFrom(rec, id, fallback) {
  if (rec) {
    const en = typeof rec.nmEn === 'string' ? rec.nmEn.trim() : '';
    const ru = typeof rec.nm === 'string' ? rec.nm.trim() : '';
    if (lang === 'en' && en) return en;
    if (ru) return ru;
    if (en) return en;
  }
  return displayNameOf(id, fallback);
}

let botIds = new Set();

function botDisplayName(id) {
  const n = Number(id) || 0;
  const seed = (Math.imul(n, 1103515245) + 12345) >>> 0;
  const list = lang === 'en' ? BOT_NAMES_EN : BOT_NAMES_RU;
  const base = list[seed % list.length] || t('name.bot_fallback');
  return `${base}#${(seed % 99) + 1}`;
}

function refreshBotNames() {
  if (!botIds || botIds.size === 0) return;
  // G15: серверные ники ботов («Лютый Пельмень») не трогаем — локальный
  // генератор нужен только там, где имени с сервера ещё нет.
  for (const id of botIds) {
    const cur = nameById.get(id);
    if (typeof cur === 'string' && cur.trim()) continue;
    nameById.set(id, botDisplayName(id));
  }
}

let chatDirty = false;

function notifyChatUnread() {
  unreadCount = Math.min(999, unreadCount + 1);
  updateUnreadBadge();
}

function bumpChatOpenUntilBy(ms) {
  chatOpenUntil = performance.now() + (Number(ms) || 0);
}

const chatUi = createChatUi({
  chat,
  chatLog,
  chatInput,
  emojiBtn,
  emojiPanel,
  emojiCloseBtn,
  emojiRecent,
  emojiGrid,
  EMOJIS,
  setSafeEmojiHtml,
  displayNameOf,
  formatTime,
  getYou: () => you,
  updateChatLayout,
  bumpChatVisibility,
  CHAT_AUTO_OPEN_MS,
  notifyUnread: notifyChatUnread,
  setChatCollapsed: (v) => setChatCollapsed(v),
  bumpChatOpenUntil: bumpChatOpenUntilBy,
  scheduleChatInputOverlayRender: () => scheduleChatInputOverlayRender()
});

function buildChatLineElement(m) {
  return chatUi.buildChatLineElement(m);
}

function renderChat() {
  chatUi.renderChat();
}

function addChatLine(msg) {
  chatUi.addChatLine(msg);
}

function onChatInit(history) {
  chatUi.onChatInit(history);
  chatDirty = false;
}

function toggleEmojiPanel(open) {
  chatUi.toggleEmojiPanel(open);
}

const minimapLegendEl = document.getElementById('minimapLegend');
const minimapOverlayEl = document.getElementById('minimapOverlay');
const minimapOverlayCloseBtn = document.getElementById('minimapOverlayCloseBtn');
const minimapOverlayCanvas = document.getElementById('minimapOverlayCanvas');

let minimapOverlayOpen = false;
let minimapOverlayCtx = null;

/* УХ33: у миникарты не было легенды для точек-иконок — жёлтая рамка топ-1 и
   красная у баунти читались только методом тыка. Три строки: своя точка,
   боты, остальные игроки — с теми же значками/цветами, что рисует
   drawMinimap()/setMinimapPixel(). */
function updateMinimapLegend() {
  if (!minimapLegendEl) return;
  const rows = [
    { swatch: 'minimapLegendMe', label: t('minimap.legend_me') },
    { swatch: 'minimapLegendPlayer', label: t('minimap.legend_player') },
    { swatch: 'minimapLegendBot', label: t('minimap.legend_bot') }
  ];
  const items = rows.map((r) => {
    const row = document.createElement('div');
    row.className = 'minimapLegendRow';
    const sw = document.createElement('span');
    sw.className = `minimapLegendSwatch ${r.swatch}`;
    row.append(sw, document.createTextNode(r.label));
    return row;
  });
  try {
    minimapLegendEl.replaceChildren(...items);
  } catch {}
  try {
    minimapLegendEl.classList.remove('hidden');
  } catch {}
  try {
    minimapLegendEl.setAttribute('aria-hidden', 'false');
  } catch {}
}

function ensureMinimapOverlayCanvas() {
  if (!minimapOverlayCanvas) return;
  const ctx = minimapOverlayCanvas.getContext('2d');
  if (!ctx) return;
  minimapOverlayCtx = ctx;
  const w = (minimap?.width || 0) * 2;
  const h = (minimap?.height || 0) * 2;
  if (w > 0 && h > 0) {
    if (minimapOverlayCanvas.width !== w) minimapOverlayCanvas.width = w;
    if (minimapOverlayCanvas.height !== h) minimapOverlayCanvas.height = h;
  }
  minimapOverlayCtx.imageSmoothingEnabled = false;
}

function syncMinimapOverlayCanvas() {
  if (!minimapOverlayOpen) return;
  if (!minimapOverlayCanvas || !minimap || !minimapOverlayCtx) return;
  if (minimapOverlayCanvas.width !== minimap.width * 2 || minimapOverlayCanvas.height !== minimap.height * 2) {
    ensureMinimapOverlayCanvas();
  }
  minimapOverlayCtx.clearRect(0, 0, minimapOverlayCanvas.width, minimapOverlayCanvas.height);
  minimapOverlayCtx.drawImage(
    minimap,
    0,
    0,
    minimap.width,
    minimap.height,
    0,
    0,
    minimapOverlayCanvas.width,
    minimapOverlayCanvas.height
  );
}

function showMinimapOverlay() {
  if (!minimapOverlayEl) return;
  minimapOverlayOpen = true;
  minimapOverlayEl.classList.remove('hidden');
  overlayManager.open('minimap');
  syncOverlayUiState();
  ensureMinimapOverlayCanvas();
  syncMinimapOverlayCanvas();
  overlayManager.focusDefault('minimap');
}

function hideMinimapOverlay() {
  if (!minimapOverlayEl) return;
  minimapOverlayOpen = false;
  minimapOverlayEl.classList.add('hidden');
  overlayManager.close('minimap');
  syncOverlayUiState();
}

function toggleMinimapOverlay() {
  if (minimapOverlayOpen) hideMinimapOverlay();
  else showMinimapOverlay();
}

overlayManager.register('minimap', {
  root: () => minimapOverlayEl,
  defaultFocus: () => minimapOverlayCloseBtn,
  close: () => hideMinimapOverlay()
});

minimapOverlayCloseBtn?.addEventListener('click', (e) => {
  e?.preventDefault?.();
  hideMinimapOverlay();
});

// Тач-доступ к карте: на мобильном #minimapPanel скрыт, а клавиши M нет,
// поэтому без этой кнопки игрок в игре про захват территории играет вслепую.
document.getElementById('minimapMobileBtn')?.addEventListener('click', (e) => {
  e?.preventDefault?.();
  toggleMinimapOverlay();
});

minimapOverlayEl?.addEventListener('click', (e) => {
  if (e.target === minimapOverlayEl) {
    hideMinimapOverlay();
  }
});

try {
  updateMinimapLegend();
} catch {}

let minimapImage = null;
let minimapDirty = true;

let minimapHadChunkUpdate = false;

const MINIMAP_REFRESH_MS = 200;

let lastMinimapDrawAt = 0;

let viewMinX = 0;
let viewMinY = 0;
let viewMaxX = 0;
let viewMaxY = 0;

/* K1 «Туман войны». Сервер шлёт дельту сетки только для прямоугольника ROI
   (сейчас 80×56 клеток) и присылает его границы в каждом снапшоте. Экран же на
   портретном телефоне выше: cell считается по ширине (375/40 ≈ 9 px), и по
   вертикали в кадр влезает ~79 строк. Разница (верхние и нижние ~11 строк)
   никогда не обновлялась — там оставались нули или данные многолетней
   давности, то есть игрок видел «свободную» землю ровно по курсу движения.
   Теперь всё, что вне последнего полученного ROI, не рисуется из gridOwner и
   закрашивается туманом: честное «не знаю» вместо уверенного вранья. */
let lastRoi = null;

let fps = 0;
let fpsLast = performance.now();
let fpsFrames = 0;

let pingMs = null;

let bytesInTotal = 0;
let bytesOutTotal = 0;
let bytesInSample = 0;
let bytesOutSample = 0;
let bytesSampleAt = null;
let downBps = null;
let upBps = null;

let tickrate = 0;
// lastStateAt теперь в clientState.lastStateAt (public/client_state.js)

let headIndexByOwner = new Map();

// Рендер и состояние таблицы лидеров — в public/client_leaderboard.js.
// leaderboardRowsById остаётся в clientState.leaderboardRowsById (public/client_state.js)

let lastDeathStatsAt = 0;

let lastDeathInfo = null;

let lastYouStats = null;

// Запас в клетках при отсечении «объект вне экрана, пропустить отрисовку» —
// один допуск на пауэрапы, частицы и бурсты эффектов. Раньше был продублирован
// с разными значениями (±1 у пауэрапов, ±2 у частиц и бурстов) — объект у
// самого края экрана пропадал/появлялся на клетку раньше, чем остальные.
const OFFSCREEN_MARGIN_CELLS = 2;

/* I2/F18: геометрия «своего» — длина следа и ближайшая своя клетка. */
const TRAIL_PULSE_FROM = 22;
let youTrailLen = 0;
let youInOwnZone = true;
let youNearestHomeX = -1;
let youNearestHomeY = -1;
let youNearestHomeAt = 0;
let ownGeometryAt = 0;

// Полный проход по сетке дешевле, чем кажется (200x140), и вызывается 5 раз в
// секунду вне кадрового цикла: считает длину своего следа и ближайшую свою
// клетку, если её не нашлось в видимой области.
function refreshOwnGeometry(force) {
  if (!gridOwner || !trailOwner || !you || !W || !H) return;
  const now = performance.now();
  if (!force && now - ownGeometryAt < 200) return;
  ownGeometryAt = now;

  const me = currPlayers.get(you);
  if (!me || !me.a) {
    youTrailLen = 0;
    youInOwnZone = true;
    youNearestHomeX = -1;
    youNearestHomeY = -1;
    return;
  }

  const hx = Number(me.x) || 0;
  const hy = Number(me.y) || 0;
  const hi = hy * W + hx;
  youInOwnZone = hi >= 0 && hi < gridOwner.length ? gridOwner[hi] === you : false;

  const staleHome = now - youNearestHomeAt > 400;
  let len = 0;
  let bestD = Infinity;
  let bx = -1;
  let by = -1;
  let i = 0;
  for (let y = 0; y < H; y++) {
    const dy = y - hy;
    const dy2 = dy * dy;
    for (let x = 0; x < W; x++, i++) {
      if (trailOwner[i] === you) len++;
      if (staleHome && gridOwner[i] === you) {
        const dx = x - hx;
        const d = dx * dx + dy2;
        if (d < bestD) {
          bestD = d;
          bx = x;
          by = y;
        }
      }
    }
  }
  youTrailLen = len;
  if (staleHome) {
    youNearestHomeX = bx;
    youNearestHomeY = by;
    youNearestHomeAt = bx >= 0 ? now : 0;
  }
}

function fmtInt(n) {
  return formatInt(n, lang);
}

function fmtPct1(n) {
  return formatPct1(n, lang);
}

function deathReasonLabel(reason) {
  const suffix = deathReasonSuffix(reason);
  return suffix ? t(`death.reason.${suffix}`) : '';
}

function deathReasonText(info) {
  const killer = Number(info?.killer) || 0;
  const killerName = String(info?.killerName || '').trim();
  const rs = deathReasonLabel(info?.reason);
  if (killer && killer === you) return rs ? `${t('death.reason_prefix')}: ${rs}` : '';
  if (killer && killerName) return rs ? `${t('death.killed_by')}: ${killerName} (${rs})` : `${t('death.killed_by')}: ${killerName}`;
  return rs ? `${t('death.reason_prefix')}: ${rs}` : '';
}

// F15: сухое «Разрез следа» ничего не объясняет новичку. Даём правило игры.
function deathReasonHint(info) {
  const reason = Number(info?.reason) || 0;
  const killerName = String(info?.killerName || '').trim();
  if (reason === DEATH_REASON.CUT && killerName) {
    return lang === 'en'
      ? `${killerName} crossed your trail. Until the loop is closed you are vulnerable.`
      : `${killerName} пересёк твой след. Пока след не замкнут — ты уязвим.`;
  }
  const suffix = deathReasonSuffix(reason);
  return suffix ? t(`death.hint.${suffix}`) : t('death.hint.generic');
}

const storedName = localStorage.getItem('name') || '';
nameInput.value = storedName;
if (menuNameInput) menuNameInput.value = storedName;

const MENU_CONTROLS_SEEN_KEY = 'menuControlsSeen';

function getMenuControlsSeen() {
  try {
    return localStorage.getItem(MENU_CONTROLS_SEEN_KEY) === '1';
  } catch {}
  return false;
}

function setMenuControlsSeen() {
  try {
    localStorage.setItem(MENU_CONTROLS_SEEN_KEY, '1');
  } catch {}
}

function syncMenuOnboardingUi() {
  if (!menuOnboarding) return;
  menuOnboarding.classList.toggle('hidden', getMenuControlsSeen());
}

function updateMenuNameUi() {
  updateMenuNameUiImpl({ menuNameInput, normalizeMenuNickInput, playBtn, menuNameError, t });
}

// Гарантирует непустой ник перед стартом: пустое поле заполняется случайным.
function ensureNickBeforePlay() {
  if (!menuNameInput) return true;
  const v = normalizeMenuNickInput(menuNameInput.value);
  if (!v.raw) {
    menuNameInput.value = randomNickValue();
    updateMenuNameUi();
  }
  return !playBtn || !playBtn.disabled;
}

function randomNickValue() {
  const prefix = t('menu.nick_random_prefix');
  const n = Math.floor(1000 + Math.random() * 9000);
  return `${prefix} ${n}`;
}

function applyRandomNick() {
  if (!menuNameInput) return;
  menuNameInput.value = randomNickValue();
  updateMenuNameUi();
  try {
    menuNameInput.focus();
  } catch {}
}

function syncRoomsSearchClearUi() {
  if (!roomsSearchClearBtn) return;
  const q = String(roomsSearchInput?.value || '').trim();
  roomsSearchClearBtn.classList.toggle('hidden', !q);
}

function clearRoomsSearch() {
  if (!roomsSearchInput) return;
  roomsSearchInput.value = '';
  syncRoomsSearchClearUi();
  updateRoomsUi();
  try {
    roomsSearchInput.focus();
  } catch {}
}

function attemptJoinRoom(rid) {
  const roomId = rid == null ? null : Number(rid);
  if (roomId == null) return;
  const nm = submitNameFromInput(menuNameInput);
  if (!nm) {
    updateMenuNameUi();
    menuNameInput?.focus();
    return;
  }
  trackEvent('join_room');
  wsSend('join', { roomId, mode: 'id' });
}

function setRoomsCreateOpen(v) {
  const on = !!v;
  roomsCreateOpen = on;
  if (roomsCreateEl) roomsCreateEl.classList.toggle('hidden', !on);
  if (toggleCreateRoomBtn) {
    toggleCreateRoomBtn.textContent = on ? t('rooms.hide') : t('rooms.create');
    toggleCreateRoomBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
  }
  if (on) {
    try {
      roomsCreateNameInput?.focus();
    } catch {}
  }
  updateRoomsCreateUi();
}

function updateRoomsCreateUi(errMsg) {
  if (!roomsCreateOpen) {
    if (roomsCreateError) roomsCreateError.textContent = '';
    if (createRoomBtn) createRoomBtn.disabled = true;
    return;
  }

  const title = sanitizeRoomTitleClient(roomsCreateNameInput?.value);
  const ok = !!title;
  const err = String(errMsg || '').trim();
  if (roomsCreateError) roomsCreateError.textContent = err ? err : ok ? '' : t('rooms.name_placeholder');
  if (createRoomBtn) createRoomBtn.disabled = !ok || createRoomPending;
}

function onError(d) {
  const code = String(d?.message || '').trim();
  createRoomPending = false;
  updateRoomsCreateUi();

  if (code === 'room_title_invalid') {
    setRoomsCreateOpen(true);
    updateRoomsCreateUi(t('rooms.invalid_title'));
    try {
      roomsCreateNameInput?.focus();
    } catch {}
    return;
  }

  const msgFor = () =>
    code === 'room_full'
      ? t('rooms.full')
      : code === 'room_not_found'
        ? t('rooms.not_found')
        : code === 'cosmetics_invalid_id'
          ? t('cosmetics.err_invalid_id')
          : code === 'cosmetics_invalid_cat'
            ? t('cosmetics.err_invalid_cat')
            : code === 'cosmetics_not_owned'
              ? t('cosmetics.err_not_owned')
              : code === 'cosmetics_not_enough_style'
                ? t('cosmetics.err_not_enough_style')
                : code === 'cosmetics_unavailable'
                  ? t('cosmetics.err_unavailable')
        : t('common.error');
  const msg = msgFor();

  // K7: если не удалось вернуться в свою комнату после обрыва — комнаты уже
  // нет или она заполнилась. Тогда честно отправляем в меню.
  // C9: любая ошибка во время ожидания возврата — повод честно уйти в меню,
  // а не только room_not_found / room_full.
  if (rejoinPending) {
    rejoinGiveUp(msg);
    return;
  }

  // C1/C4: shop errors must land inside the overlay — toasts are hidden while it is open.
  if (code.startsWith('cosmetics_')) {
    cosmeticsOpClear();
    if (cosmeticsOpen) {
      setCosmeticsStatus(msgFor, 'error');
      syncCosmeticsUi();
      return;
    }
  }

  addToast('⚠', msg, null);
}

updateMenuNameUi();

const LB_PIN_KEY = 'lbPinned';

function setLeaderboardPinned(v) {
  if (!hudEl) return;
  const on = !!v;
  if (on) hudEl.classList.add('lbPinned');
  else hudEl.classList.remove('lbPinned');
  try {
    localStorage.setItem(LB_PIN_KEY, on ? '1' : '0');
  } catch {
    // ignore
  }

  if (started) {
    renderTeamHud();
  }
}

function getLeaderboardPinnedDefault() {
  try {
    const raw = localStorage.getItem(LB_PIN_KEY);
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch {
    // ignore
  }
  return false;
}

lbBtn?.addEventListener('click', () => {
  if (!hudEl) return;
  setLeaderboardPinned(!hudEl.classList.contains('lbPinned'));
});

matchContinueBtn?.addEventListener('click', () => {
  if (matchEnded) {
    matchContinuePending = true;
    syncMatchOverlayActions();
    if (matchContinueTimeout) {
      clearTimeout(matchContinueTimeout);
      matchContinueTimeout = 0;
    }
    matchContinueTimeout = setTimeout(() => {
      matchContinueTimeout = 0;
      if (matchEnded && matchContinuePending) {
        matchContinuePending = false;
        syncMatchOverlayActions();
      }
    }, 4000);
    wsSend('matchContinue', {});
    return;
  }
  hideMatchOverlay();
});

matchMenuBtn?.addEventListener('click', (e) => {
  e?.preventDefault?.();
  hideMatchOverlay();
  if (matchContinueTimeout) {
    clearTimeout(matchContinueTimeout);
    matchContinueTimeout = 0;
  }
  matchContinuePending = false;
  leaveBtn?.click();
});

toggleCreateRoomBtn?.addEventListener('click', () => {
  setRoomsCreateOpen(!roomsCreateOpen);
});

roomsCreateNameInput?.addEventListener('input', () => {
  updateRoomsCreateUi();
});

createRoomBtn?.addEventListener('click', () => {
  const nm = submitNameFromInput(menuNameInput);
  if (!nm) {
    updateMenuNameUi();
    menuNameInput?.focus();
    return;
  }

  const title = sanitizeRoomTitleClient(roomsCreateNameInput?.value);
  if (!title) {
    updateRoomsCreateUi();
    roomsCreateNameInput?.focus();
    return;
  }

  createRoomPending = true;
  updateRoomsCreateUi();
  trackEvent('create_room');
  wsSend('createRoom', { title });
});

setLeaderboardPinned(getLeaderboardPinnedDefault());

const RIGHT_MATCH_OPEN_KEY = 'rightMatchOpen';
const RIGHT_TEAM_OPEN_KEY = 'rightTeamOpen';

function initRightDetailsState() {
  // Раньше обе панели по умолчанию открывались одновременно (open = true у
  // обеих) и постоянно съедали место у миникарты — переключателя между ними
  // (data-tab) не было, а он и не работал. На десктопе (min-width: 721px,
  // тот же брейкпоинт, что и в CSS-раскладке сайдбара) места достаточно —
  // «Матч» и «Игроки» открыты одновременно по умолчанию. На мобильном
  // раскрытой по умолчанию остаётся только «Матч», «Команда» — по явному
  // клику, как и раньше.
  const isDesktop = window.matchMedia('(min-width: 721px)').matches;
  const initOne = (el, key, defaultOpen) => {
    if (!el) return;
    let open = defaultOpen;
    try {
      const raw = localStorage.getItem(key);
      if (raw === '0') open = false;
      if (raw === '1') open = true;
    } catch {
      // ignore
    }
    el.open = open;
    el.addEventListener('toggle', () => {
      try {
        localStorage.setItem(key, el.open ? '1' : '0');
      } catch {
        // ignore
      }
    });
  };

  initOne(rightMatchDetailsEl, RIGHT_MATCH_OPEN_KEY, true);
  initOne(rightTeamDetailsEl, RIGHT_TEAM_OPEN_KEY, isDesktop);
}

initRightDetailsState();

const RIGHT_TAB_KEY = 'rightTab';
let rightTab = 'match';

function setRightTab(tab, fromUser) {
  const t = String(tab || 'match');
  if (t !== 'match' && t !== 'team' && t !== 'chat') return;
  rightTab = t;
  if (t === 'chat') {
    if (chat.classList.contains('collapsed')) setChatCollapsed(false);
    chatOpenUntil = performance.now() + 12000;
    if (chatInput && document.activeElement !== chatInput) {
      try {
        chatInput.focus();
      } catch {}
    }
    return;
  }

  const target = t === 'team' ? teamHudEl : metaHudEl;
  if (rightInfoEl && target) {
    const top = Math.max(0, (target.offsetTop || 0) - 6);
    try {
      rightInfoEl.scrollTo({ top, behavior: fromUser ? 'smooth' : 'auto' });
    } catch {
      rightInfoEl.scrollTop = top;
    }
  }
}

function bumpMatchTabBadge() {
  if (!rightInfoEl) return;
  rightInfoEl.classList.add('rightInfoPulse');
  window.clearTimeout(bumpMatchTabBadge._t);
  bumpMatchTabBadge._t = window.setTimeout(() => {
    rightInfoEl.classList.remove('rightInfoPulse');
  }, 550);

  try {
    if (rightMatchDetailsEl && !rightMatchDetailsEl.open) {
      const now = performance.now();
      if (!bumpMatchTabBadge._u || now - bumpMatchTabBadge._u > 1200) {
        bumpMatchTabBadge._u = now;
        matchUnreadCount = Math.min(999, matchUnreadCount + 1);
        setBadgeCount(rightMatchBadgeEl, matchUnreadCount);
      }
    }
  } catch {}
}

bumpMatchTabBadge._t = 0;
bumpMatchTabBadge._u = 0;

function getRightTabDefault() {
  try {
    const raw = localStorage.getItem(RIGHT_TAB_KEY);
    if (raw === 'match' || raw === 'team' || raw === 'chat') return raw;
  } catch {
    // ignore
  }
  return 'match';
}

setRightTab(getRightTabDefault(), false);

function hudDeps() {
  return {
    topHudEl,
    metaHudEl,
    teamHudEl,
    topHudCellsEl,
    topHudPctEl,
    topHudKillsEl,
    topHudTimeEl,
    topHudContractEl,
    topHudBarFillEl,
    cosmeticsBtn,
    started,
    clientState,
    you,
    mapCells,
    lastPacketAt,
    lang,
    matchPhase,
    matchEnded,
    matchFinalMult,
    matchPhaseUntil,
    matchEndTick,
    bountyTarget,
    bountyUntil,
    youKills,
    youContractType,
    youContractGoal,
    youContractProgress,
    youContractUntil,
    youStreak,
    youShield,
    youSpeedUntilTick,
    lastEventsTick,
    youSpeedType,
    youStyle,
    youDailies,
    cosTitleByPlayer,
    PHASE_FINAL,
    PHASE_CONFLICT,
    obTick,
    obUnlocked,
    obSecondMatchPlus,
    animateNumber,
    computeTopSorted,
    t,
    phaseIcon,
    phaseLabel,
    phaseDesc,
    tickRemainSeconds,
    formatTickRemain,
    renderComboHud,
    displayNameOf,
    contractLabel,
    infoPack,
    infoName,
    powerupLabel,
    dailySlots,
    dailyLabel,
    playerTitleHtml,
    syncRightEmptyStates
  };
}

function renderTopHud() {
  renderTopHudImpl(hudDeps());
}

function renderMetaHud() {
  renderMetaHudImpl(hudDeps());
}

function renderTeamHud() {
  renderTeamHudImpl(hudDeps());
}

net = createNetModule({
  t,
  wsQuery: () => {
    // A1: identity is a signed token issued by the server. No token yet -> no param at all.
    const tok = getProfileToken();
    if (!tok) return '';
    return `t=${encodeURIComponent(tok)}`;
  },
  onBytesIn: (n) => {
    bytesInTotal += Number(n) || 0;
  },
  onBytesOut: (n) => {
    bytesOutTotal += Number(n) || 0;
  },
  onStatusChange: () => {
    updateRoomsUi();
  },
  onOpen: ({ send }) => {
    if (storedName) send('setName', { name: storedName });
    refreshRoomsBtn?.click();
    updateRoomsUi();
    // K7: обрыв связи (блокировка экрана, Wi-Fi → LTE) выбрасывал игрока из
    // матча в меню. Соединение восстанавливается само — возвращаемся в ту же
    // комнату, а не заставляем искать её руками.
    if (rejoinRoomId != null) {
      const rid = rejoinRoomId;
      // Стоило и то, и другое сразу — приоритет у возврата в матч, где игрок
      // уже был; отложенный вход из меню тогда не имеет смысла и не должен
      // выстрелить позже, на каком-то не связанном с ним переподключении.
      pendingQuickJoin = null;
      rejoinBegin();
      send('join', { roomId: rid, mode: 'id' });
    } else if (pendingQuickJoin != null) {
      const pj = pendingQuickJoin;
      pendingQuickJoin = null;
      userLeftRoom = false;
      trackEvent(pj.event);
      send('join', pj.params);
    }
  },
  onClose: () => {
    createRoomPending = false;
    updateRoomsCreateUi();
    roomsLoading = false;
    roomsLoadError = t('net.offline');
    if (roomsLoadTimeout) {
      clearTimeout(roomsLoadTimeout);
      roomsLoadTimeout = 0;
    }
    if (refreshRoomsBtn) {
      refreshRoomsBtn.disabled = false;
      refreshRoomsBtn.classList.remove('isLoading');
      refreshRoomsBtn.textContent = t('rooms.refresh');
    }
    // K7: если игрок был в комнате и не уходил сам — запоминаем комнату и
    // держим игровой экран, вместо того чтобы швырять в меню.
    if (roomId != null && !userLeftRoom) {
      rejoinRoomId = roomId;
      addToast('📶', t('net.reconnecting'), null, t('net.rejoin_hint'), { key: 'net_reconnect' });
      updateRoomsUi();
      return;
    }
    rejoinRoomId = null;
    showMenuOverlay();
    updateRoomsUi();
  },
  onTextMsg: (t, d) => {
    if (t === 'hello') {
      // A1: the server re-issues the profile token on every connect.
      if (typeof d?.token === 'string') setProfileToken(d.token);
      if (typeof d?.roomLimit === 'number') roomLimit = d.roomLimit;
      /* C2: границы адаптивного ROI. Старый сервер их не шлёт — тогда
         остаются встроенные значения и просьба всё равно будет валидной. */
      applyRoiCaps(d?.roi);
      // Просим окно до входа в комнату: первый же ROI после join придёт нужного
      // размера, и стартовой полосы тумана не будет вовсе.
      viewportSentW = 0;
      viewportSentH = 0;
      sendViewportNow();
      // C9: соединение доказано на прикладном уровне — можно сбрасывать backoff.
      try {
        net.markHealthy?.();
      } catch {}
      // C2: параметры арки матча.
      if (Number.isFinite(Number(d?.finalMult)) && Number(d.finalMult) > 0) {
        matchFinalMult = Number(d.finalMult);
      }
      if (d?.cosmeticsPrices && typeof d.cosmeticsPrices === 'object') {
        cosmeticsPrices = d.cosmeticsPrices;
      }
      // F5: окно реклейма словами сервера, см. reclaimWindowSec().
      if (Number.isFinite(Number(d?.reclaimTicks)) && Number(d.reclaimTicks) > 0) {
        reclaimTicksFromServer = Number(d.reclaimTicks);
      }
      // Таблица титулов с сервера: страховка на случай, когда серверный набор
      // шире клиентского — тогда имя берётся оттуда, а не рисуется пустым.
      if (Array.isArray(d?.titles)) {
        cosTitleServerNames.clear();
        cosTitleAchvById.clear();
        for (const it of d.titles) {
          const id = Number(it?.id);
          const nm = typeof it?.name === 'string' ? it.name.trim() : '';
          // R5: язык выбирается в момент отрисовки, а не здесь — иначе смена
          // языка на лету оставила бы подставленные имена от старого.
          const nmEn = typeof it?.nameEn === 'string' ? it.nameEn.trim() : '';
          if (Number.isFinite(id) && id > 0 && nm) {
            cosTitleServerNames.set(id, { ru: nm, en: nmEn || nm });
          }
          // C3: связка «титул → ачивка», без неё прогресс не найти.
          const av = Number(it?.achv);
          if (Number.isFinite(id) && id > 0 && Number.isFinite(av) && av >= 0) {
            cosTitleAchvById.set(id, av);
          }
        }
      }
      updateRoomInfo();
    } else if (t === 'rooms') {
      onRooms(d);
    } else if (t === 'init') {
      onInit(d);
    } else if (t === 'cosmetics') {
      onCosmetics(d);
    } else if (t === 'cosExtra') {
      onCosExtra(d);
    } else if (t === 'matchEnd') {
      onMatchEnd(d);
    } else if (t === 'matchStart') {
      onMatchStart(d);
    } else if (t === 'matchPhase') {
      // C2: арка матча. Раньше сообщение молча проваливалось в конец цепочки.
      onMatchPhase(d);
    } else if (t === 'error') {
      onError(d);
    } else if (t === 'chatInit') {
      onChatInit(d);
    } else if (t === 'chat') {
      onChat(d);
    } else if (t === 'nameUpdate') {
      onNameUpdate(d);
    } else if (t === 'nameUpdateBatch') {
      onNameUpdateBatch(d);
    } else if (t === 'left') {
      onLeft(d);
    } else if (t === 'rttPong') {
      onRttPong(d);
    } else if (t === 'viewport') {
      /* C2: сервер подтверждает фактически выданное окно. Оно может быть
         меньше запрошенного (потолок по площади), и считать масштаб/камеру
         надо именно по нему, а не по тому, что мы просили. */
      const gw = Number(d?.w);
      const gh = Number(d?.h);
      if (Number.isFinite(gw) && gw > 0 && Number.isFinite(gh) && gh > 0) {
        roiGrant = { w: Math.floor(gw), h: Math.floor(gh) };
      }
    }
  },
  onBinaryMsg: (buf) => {
    handleStateBinary(buf);
  }
});

function submitName() {
  const nm = sanitizeNameClient(nameInput.value);
  if (!nm) return;
  localStorage.setItem('name', nm);
  if (menuNameInput) menuNameInput.value = nm;
  wsSend('setName', { name: nm });
}

function submitNameFromInput(el) {
  const nm = sanitizeNameClient(el?.value);
  if (!nm) return null;
  localStorage.setItem('name', nm);
  nameInput.value = nm;
  if (menuNameInput) menuNameInput.value = nm;
  wsSend('setName', { name: nm });
  updateMenuNameUi();
  return nm;
}

/* Итог по рекорду за ЭТУ смерть: считается один раз при показе оверлея,
   иначе повторные renderDeathStats() затирали бы «Новый рекорд». */
let deathBestShown = null;

/* Пауза между гибелью и оверлеем: игрок должен увидеть кадр, в котором его
   убили. Длительность идёт через тот же fx-пресет, что и остальная «сочность»,
   и полностью выключается при «Спокойно» / prefers-reduced-motion. */
const DEATH_SLOWMO_MS = 480;
let deathSlowMoTimer = 0;

function beginDeathSlowMo() {
  if (deathSlowMoTimer) {
    clearTimeout(deathSlowMoTimer);
    deathSlowMoTimer = 0;
  }
  const k = fxHitstopScale();
  const dur = Math.round(DEATH_SLOWMO_MS * k);
  if (dur <= 0) {
    showDeathOverlay();
    return;
  }
  triggerHitstop(DEATH_SLOWMO_MS);
  vibrate([40, 60, 90]);
  deathSlowMoTimer = setTimeout(() => {
    deathSlowMoTimer = 0;
    showDeathOverlay();
  }, dur);
}

/* Матч может закончиться (или игрок — выйти) прямо во время паузы: тогда
   оверлей смерти уже не нужен, и таймер обязан быть снят. */
function cancelDeathSlowMo() {
  releaseDeathZoom();
  if (!deathSlowMoTimer) return;
  clearTimeout(deathSlowMoTimer);
  deathSlowMoTimer = 0;
}

/* Драматический наезд камеры на точку гибели.
   Чисто визуальный эффект: не трогает cellSizeFor()/computeViewportCells() и
   то, что клиент запрашивает у сервера — только финальный масштаб отрисовки
   в draw(), уже после cellSizeFor(). Камера на время наезда центрируется на
   голове в момент смерти, а не на текущей цели followCamera. Уважает
   prefers-reduced-motion / пресет «Спокойно» через fxHitstopScale(): при 0
   зум не срабатывает вовсе. */
const DEATH_ZOOM_MAX = 1.45;
const DEATH_ZOOM_IN_MS = 900;
const DEATH_ZOOM_OUT_MS = 600;

let deathZoomActive = false;
let deathZoomAnchorX = 0;
let deathZoomAnchorY = 0;
let deathZoomStartAt = 0;
let deathZoomReleaseAt = 0;
let deathZoomAtRelease = 1;
let deathZoomCurrent = 1;

function beginDeathZoom(x, y) {
  deathZoomAnchorX = Number(x) || 0;
  deathZoomAnchorY = Number(y) || 0;
  deathZoomActive = true;
  deathZoomStartAt = performance.now();
}

/* Плавный откат к обычному масштабу: респавн, выход в меню, конец матча. */
function releaseDeathZoom() {
  if (!deathZoomActive) return;
  deathZoomActive = false;
  deathZoomAtRelease = deathZoomCurrent;
  deathZoomReleaseAt = performance.now();
}

/* Вызывается каждый кадр из draw(). Возвращает { zoom, mixToAnchor } —
   текущий множитель клетки и долю [0..1], на которую камера должна
   сместиться от обычной цели к точке гибели. */
function updateDeathZoom(now) {
  return updateDeathZoomImpl(now, {
    prefersReducedMotion,
    fxHitstopScale,
    easeOutCubic,
    DEATH_ZOOM_MAX,
    DEATH_ZOOM_IN_MS,
    DEATH_ZOOM_OUT_MS,
    getActive: () => deathZoomActive,
    setActive: (v) => {
      deathZoomActive = v;
    },
    getCurrent: () => deathZoomCurrent,
    setCurrent: (v) => {
      deathZoomCurrent = v;
    },
    getStartAt: () => deathZoomStartAt,
    getReleaseAt: () => deathZoomReleaseAt,
    getAtRelease: () => deathZoomAtRelease
  });
}

function showDeathOverlay() {
  showDeathOverlayImpl({
    deathOverlay,
    overlayManager,
    dismissRoundModToasts,
    syncOverlayUiState,
    setChatCollapsed,
    toggleEmojiPanel,
    setDeathBestShown: (v) => {
      deathBestShown = v;
    },
    renderDeathStats,
    setLastDeathStatsAt: (v) => {
      lastDeathStatsAt = v;
    },
    sfx,
    comboBreak,
    obDeathsSeen,
    obBumpDeaths,
    setDeathReasonDeathsSeen: (v) => {
      deathReasonDeathsSeen = v;
    },
    renderDeathReason
  });
}

/* K4: раньше подсказка в оверлее смерти собиралась только внутри
   showDeathOverlay(), и setLang() её не трогал — в английском интерфейсе
   висело «Выйди из своей зоны, обведи участок…». Теперь это отдельная функция,
   которую зовёт и показ оверлея, и смена языка. */
let deathReasonDeathsSeen = 99;

function renderDeathReason() {
  renderDeathReasonImpl({
    deathReasonEl,
    getDeathReasonDeathsSeen: () => deathReasonDeathsSeen,
    lastDeathInfo,
    deathReasonText,
    deathReasonHint,
    tfmt,
    reclaimWindowSec,
    document
  });
}

function syncOverlayUiState() {
  const menuOpen = !!(menuOverlay && !menuOverlay.classList.contains('hidden'));
  const settingsOpen = !!(settingsOverlay && !settingsOverlay.classList.contains('hidden'));
  const matchOpen = !!(matchOverlay && !matchOverlay.classList.contains('hidden'));
  const cosmeticsIsOpen = !!(cosmeticsOverlay && !cosmeticsOverlay.classList.contains('hidden'));
  const deathOpen = !!(deathOverlay && !deathOverlay.classList.contains('hidden'));
  const minimapOpen = !!(minimapOverlayEl && !minimapOverlayEl.classList.contains('hidden'));
  const anyOverlayOpen = menuOpen || settingsOpen || matchOpen || cosmeticsIsOpen || deathOpen || minimapOpen;
  document.body.classList.toggle('overlayActive', anyOverlayOpen);
  if (langToggleGlobal) langToggleGlobal.classList.toggle('hidden', !anyOverlayOpen);

  // Общая подложка #endOverlay видна, если открыт хоть один из двух режимов
  // (death/match); режимы взаимоисключающие по игровой логике (matchEnd
  // всегда гасит смерть через hideOverlays() перед показом итогов), но здесь
  // это не предполагается, а выводится из фактического DOM-состояния — на
  // случай гонки оба класса просто ORятся.
  if (endOverlay) {
    endOverlay.classList.toggle('hidden', !(matchOpen || deathOpen));
    if (deathOpen) endOverlay.setAttribute('aria-labelledby', 'deathTitle');
    else if (matchOpen) endOverlay.setAttribute('aria-labelledby', 'matchTitle');
  }
}

function syncMatchOverlayActions() {
  if (!matchContinueBtn) return;
  const waiting = !!matchContinuePending;
  matchContinueBtn.disabled = waiting;
  matchContinueBtn.setAttribute('aria-disabled', waiting ? 'true' : 'false');
  matchContinueBtn.textContent = waiting ? t('match.starting') : t('match.play_on');
}

function showMatchOverlay() {
  cancelDeathSlowMo();
  if (matchOverlay) matchOverlay.classList.remove('hidden');
  if (matchActionsEl) matchActionsEl.classList.add('hidden');
  overlayManager.open('match');
  syncOverlayUiState();
  syncMatchOverlayActions();

  // J16: конец матча был беззвучным.
  comboReset();
  const rows = Array.isArray(lastMatchResults) ? lastMatchResults : [];
  const meIdx = rows.findIndex((r) => (Number(r?.n) || 0) === you);
  if (meIdx === 0) sfx.victory();
  else sfx.defeat();

  runMatchResultsCascade();
  overlayManager.focusDefault('match');
}

function hideMatchOverlay() {
  if (matchOverlay) matchOverlay.classList.add('hidden');
  overlayManager.close('match');
  syncOverlayUiState();
}

// Поля Pk/Avg/D появились в matchResult позже; читаем терпимо к регистру ключа
// и откатываемся на мгновенный снимок, если сервер их ещё не шлёт.
function resultPeak(r) {
  const v = Number(r?.pk ?? r?.Pk);
  if (Number.isFinite(v) && v > 0) return v;
  return Number(r?.cells) || 0;
}

function resultAvg(r) {
  const v = Number(r?.avg ?? r?.Avg);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

function resultDeaths(r) {
  const v = Number(r?.d ?? r?.D);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

const FIRST_MATCH_KEY = 'snakes_matches_played_v1';

function matchesPlayed() {
  try {
    return Math.max(0, Number(localStorage.getItem(FIRST_MATCH_KEY)) || 0);
  } catch {}
  return 0;
}

function bumpMatchesPlayed() {
  try {
    localStorage.setItem(FIRST_MATCH_KEY, String(matchesPlayed() + 1));
  } catch {}
}

/* ==========================================================================
 * F15/F17 — мягкая первая сессия
 *
 * Новичок видит шесть мета-систем одновременно поверх непонятой базовой
 * механики. В первом матче они открываются по одной, а путь домой
 * подсвечивается стрелкой, пока игрок ни разу не замкнул петлю.
 * ======================================================================== */

const OB_DEATHS_KEY = 'snakes_deaths_seen_v1';
const OB_STAGE_KEY = 'snakes_onboarding_stages_v1';

// Пороги подобраны так, чтобы первый захват (15-20 с) успел случиться раньше
// любой мета-системы: сначала правило игры, потом надстройки над ним.
/* K5: ступени онбординга висели на секундомере ПЕРВОГО матча (105/135/165 с),
   а `obUnlocked()` открывал всё сразу после двух сыгранных матчей. Новичок,
   умерший дважды за первые две минуты (типичный сценарий), не видел ни одной
   ступени и на второй жизни получал сразу весь HUD.
   Теперь ступень привязана к событию — к моменту, когда механика впервые
   становится осмысленной. Таймер остался только страховкой для игрока, который
   за все эти секунды так ничего и не сделал. */
const OB_STAGES = [
  // Захватил первый участок — теперь имеет смысл рассказать, что по дороге
  // домой валяются бонусы.
  { id: 'bonus', at: 105000, on: 'capture', icon: '🎁', title: 'onb.bonus_title', desc: 'onb.bonus_desc' },
  // Первое убийство — игрок понял, что за действия платят; контракт как раз про это.
  { id: 'contract', at: 135000, on: 'kill', icon: '📜', title: 'onb.contract_title', desc: 'onb.contract_desc' },
  // Первая смерть — теперь ясно, что охотятся и на него; здесь и про баунти.
  { id: 'bounty', at: 165000, on: 'death', icon: '🎯', title: 'onb.bounty_title', desc: 'onb.bounty_desc' }
];

let obMatchStartAt = 0;
let obStagesShown = null;

function obLoadStages() {
  if (obStagesShown) return obStagesShown;
  obStagesShown = new Set();
  try {
    const raw = localStorage.getItem(OB_STAGE_KEY);
    if (raw) for (const s of String(raw).split(',')) if (s) obStagesShown.add(s);
  } catch {}
  return obStagesShown;
}

function obMarkStageShown(id) {
  const set = obLoadStages();
  if (set.has(id)) return;
  set.add(id);
  try {
    localStorage.setItem(OB_STAGE_KEY, Array.from(set).join(','));
  } catch {}
}

// Первый матч в жизни игрока: только в нём мета-системы придерживаются.
function obFirstMatch() {
  return obMatchesEntered() <= 1;
}

// Второй и дальше — ежедневки и магазин уже показываем.
function obSecondMatchPlus() {
  return obMatchesEntered() >= 2;
}

function obDeathsSeen() {
  try {
    return Math.max(0, Number(localStorage.getItem(OB_DEATHS_KEY)) || 0);
  } catch {}
  return 99;
}

function obBumpDeaths() {
  try {
    localStorage.setItem(OB_DEATHS_KEY, String(obDeathsSeen() + 1));
  } catch {}
}

function obMatchElapsed() {
  if (!obMatchStartAt) return 0;
  return performance.now() - obMatchStartAt;
}

/* Отдельный счётчик «сколько матчей игрок начал». FIRST_MATCH_KEY растёт только
   в onMatchEnd, а тот приходит не всегда (умер и досидел до конца в оверлее
   смерти — экран итогов не показывается). Онбординг на таком счётчике завис бы
   в режиме «первый матч» навсегда, поэтому у него свой, по входам. */
const OB_ENTERED_KEY = 'snakes_ob_matches_v1';

/* C10: значение читалось из localStorage по 3-4 раза за кадр (obTick +
   obUnlocked + obSecondMatchPlus в renderTopHud) — ~180 синхронных чтений в
   секунду. Кэшируем в памяти: писать в ключ может только этот же модуль. */
let obEnteredCache = null;

function obMatchesEntered() {
  if (obEnteredCache != null) return obEnteredCache;
  try {
    obEnteredCache = Math.max(0, Number(localStorage.getItem(OB_ENTERED_KEY)) || 0);
    return obEnteredCache;
  } catch {}
  return 99;
}

function obBumpMatchesEntered() {
  const next = obMatchesEntered() + 1;
  obEnteredCache = next;
  try {
    localStorage.setItem(OB_ENTERED_KEY, String(next));
  } catch {}
}

// Разблокирована ли мета-система. Вне первого матча — всё открыто.
function obUnlocked(id) {
  if (!obFirstMatch()) return true;
  const st = OB_STAGES.find((s) => s.id === id);
  if (!st) return true;
  // K5: ступень, уже показанная по событию, остаётся открытой — в том числе
  // после смерти и респавна в том же матче.
  if (obLoadStages().has(st.id)) return true;
  return obMatchElapsed() >= st.at;
}

// K5: показать ступень (один раз за всю жизнь профиля).
function obShowStage(st) {
  if (!st) return;
  const set = obLoadStages();
  if (set.has(st.id)) return;
  obMarkStageShown(st.id);
  addToast(st.icon, t(st.title), 'big', t(st.desc), { key: `onb_${st.id}`, prio: 'important' });
}

/* K5: событийный триггер. kind — 'capture' | 'kill' | 'death'.
   Молчит у ветеранов (больше трёх входов в матч) — им объяснять нечего. */
function obFireEvent(kind) {
  if (obMatchesEntered() > 3) return;
  for (const st of OB_STAGES) {
    if (st.on !== kind) continue;
    obShowStage(st);
  }
}

// F15: стрелка домой живёт, пока игрок ни разу не замкнул петлю.
function obGuideActive() {
  return !hasFirstCapture() && obMatchesEntered() <= 2;
}

/* C9: возврат после обрыва связи — не «новый матч». Раньше два разрыва Wi-Fi
   у новичка досрочно выключали весь онбординг. */
function obResetMatch(countEntry = true) {
  obMatchStartAt = performance.now();
  if (countEntry) obBumpMatchesEntered();
}

// Вызывается из renderTopHud (каждый кадр), поэтому дешёвая: сравнение чисел.
function obTick() {
  if (!started || !obMatchStartAt || obMatchesEntered() > 2) return;
  const el = obMatchElapsed();
  for (const st of OB_STAGES) {
    // K5: таймер теперь только страховка — событие обычно срабатывает раньше.
    if (el < st.at) continue;
    obShowStage(st);
  }
}

// Магазин и ежедневки — со второго матча, одним тостом и один раз.
function obAnnounceShop() {
  if (!obSecondMatchPlus()) return;
  if (obMatchesEntered() > 3) return;
  const set = obLoadStages();
  if (set.has('shop')) return;
  obMarkStageShown('shop');
  setTimeout(() => {
    addToast('🎨', t('onb.shop_title'), 'big', t('onb.shop_desc'), { key: 'onb_shop', prio: 'important' });
  }, 2500);
}

// F16: крючок «до первого скина N ✨» на экране результатов первого матча.
function firstSkinHookHtml() {
  if (matchesPlayed() > 1) return '';
  let owned = 0;
  for (const cat of COSMETICS_CATS) owned += Math.max(0, cosmeticsOwnedCount(cat) - 1);
  if (owned > 0) return '';

  const price = cosmeticsCheapestPrice();
  if (price <= 0) return '';
  const have = Math.max(0, Math.floor(Number(youStyle) || 0));
  const left = missingFor(price, have);
  const pct = Math.max(0, Math.min(100, (have / price) * 100));

  return `
      <div class="matchFirstSkin">
        <div class="matchFirstSkinTop">
          <span class="matchFirstSkinLabel">${escapeHtml(t('match.first_skin'))}</span>
          <span class="matchFirstSkinValue">${left > 0 ? `${escapeHtml(t('cosmetics.missing_prefix'))} ${fmtInt(left)} ✨` : '✨ ' + escapeHtml(t('cosmetics.buy'))}</span>
        </div>
        <div class="matchFirstSkinBar"><div class="matchFirstSkinFill" style="width:${pct.toFixed(1)}%"></div></div>
        <div class="matchFirstSkinSub">${escapeHtml(t('match.first_skin_sub'))}</div>
      </div>`;
}

// J6: каскад чисел — место → очки → зона → киллы → награда,
// по 250 мс со сдвигом 180 мс, каждое со своим восходящим бипом.
const MATCH_CASCADE_ORDER = ['place', 'points', 'zone', 'kills', 'reward'];

function runMatchResultsCascade() {
  if (!matchResultsEl) return;
  if (!fxCountUpEnabled()) return;
  let step = 0;
  for (const key of MATCH_CASCADE_ORDER) {
    const el = matchResultsEl.querySelector(`[data-count="${key}"]`);
    if (!el) continue;
    const to = Number(el.dataset.to) || 0;
    if (to <= 0) continue;
    const prefix = String(el.dataset.prefix || '');
    const delay = step * 180;
    animateNumber(el, 0, to, 250, {
      delay,
      prefix,
      onDone: () => {}
    });
    const i = step;
    setTimeout(() => sfx.countStep(i), delay);
    step++;
  }
}

function renderMatchResults(results) {
  renderMatchResultsImpl({
    results,
    matchResultsEl,
    you,
    escapeHtml,
    setSafeHtml,
    t,
    fmtInt,
    resultPeak,
    resultAvg,
    resultDeaths,
    displayNameFrom,
    cosClampId,
    playerTitleHtml,
    cosTitleByPlayer,
    contractLabel,
    pointsBreakdownText,
    styleBreakdownText,
    firstSkinHookHtml,
    matchAutoJoin,
    matchContinueBtn,
    matchMenuBtn,
    hideMatchOverlay,
    showCosmeticsOverlay,
    setMatchAutoJoin: (v) => {
      matchAutoJoin = v;
    },
    localStorage
  });
}

function pointsBreakdownText(pb) {
  const arr = Array.isArray(pb) ? pb : [];
  const parts = [];
  const vKill = Number(arr[1]) || 0;
  const vRev = Number(arr[2]) || 0;
  const vBounty = Number(arr[3]) || 0;
  const vContract = Number(arr[4]) || 0;
  const vDaily = Number(arr[5]) || 0;
  const vCap = Number(arr[6]) || 0;
  if (vKill) parts.push(`${t('match.points_kill')}: ${fmtInt(vKill)}`);
  if (vRev) parts.push(`${t('match.points_revenge')}: ${fmtInt(vRev)}`);
  if (vBounty) parts.push(`${t('match.points_bounty')}: ${fmtInt(vBounty)}`);
  if (vContract) parts.push(`${t('match.points_contract')}: ${fmtInt(vContract)}`);
  if (vDaily) parts.push(`${t('match.points_daily')}: ${fmtInt(vDaily)}`);
  if (vCap) parts.push(`${t('match.points_capture')}: ${fmtInt(vCap)}`);
  return parts.length ? parts.join(' · ') : '—';
}

function styleBreakdownText(sb) {
  const arr = Array.isArray(sb) ? sb : [];
  const parts = [];
  for (let i = 1; i <= 7; i++) {
    const v = Number(arr[i]) || 0;
    if (!v) continue;
    parts.push(`${styleLabel(i)}: ${fmtInt(v)}`);
  }
  return parts.length ? parts.join(' · ') : '—';
}

function updateMatchCountdown() {
  if (!matchCountdownEl) return;
  if (!matchEnded || !matchResetAt) {
    matchCountdownEl.textContent = '—';
    syncMatchOverlayActions();
    return;
  }
  const nt = approxNowTick();
  if (nt == null) {
    matchCountdownEl.textContent = '—';
    syncMatchOverlayActions();
    return;
  }
  const remTicks = Math.max(0, matchResetAt - nt);
  const remMs = tickMs ? remTicks * tickMs : 0;
  const sec = Math.max(0, Math.ceil(remMs / 1000));
  matchCountdownEl.textContent = `${sec}s`;
  syncMatchOverlayActions();
}

function resetClientForNewMatch() {
  matchContinuePending = false;
  if (matchContinueTimeout) {
    clearTimeout(matchContinueTimeout);
    matchContinueTimeout = 0;
  }

  matchStyleEarned = 0;

  // K2: номера игроков в новом матче раздаются заново — кэши по номеру нужно
  // обнулить, иначе враг ещё несколько минут рисуется цветом прошлого хозяина
  // номера, а два игрока могут оказаться одного цвета.
  colors.clear();
  ownerFillStyleCache.clear();
  minimapOwnerRgbCache.clear();
  botIds = new Set();
  coolDeadlineByOwner.clear();
  lastRoi = null;
  /* C7: карты «по номеру игрока» здесь НЕ чистятся намеренно. Сервер при
     matchStart не пересылает ни nameUpdateBatch, ни cosExtra (main.go: обе
     рассылки привязаны к входу в комнату), поэтому очистка оставила бы всех
     без имён и косметики до следующего события. Номера внутри комнаты между
     матчами не переигрываются — переигрываются они при входе, там очистка и
     стоит (см. onInit). Ограничены по размеру: ключ — номер игрока, а их в
     комнате не больше roomLimit + ботов. */
  captureAnchorByOwner.clear();

  eventFeed.length = 0;
  lastEventsTick = 0;
  lastEventsAt = 0;
  bigToastCooldownUntil = 0;

  try {
    for (const it of toastByKey.values()) {
      if (it?.timer) clearTimeout(it.timer);
    }
  } catch {}
  toastByKey.clear();
  toastQueue.length = 0;

  lastDeathInfo = null;
  lastYouStats = null;

  mutatorType = 0;
  mutatorUntil = 0;
  bountyTarget = 0;
  bountyUntil = 0;
  powerUps = new Map();

  youKills = 0;
  youStreak = 0;
  youTrailLen = 0;
  youInOwnZone = true;
  youNearestHomeX = -1;
  youNearestHomeY = -1;
  youNearestHomeAt = 0;
  comboReset();
  youContractType = 0;
  youContractGoal = 0;
  youContractProgress = 0;
  youContractUntil = 0;
  youShield = false;
  youSpeedUntilTick = 0;
  youSpeedType = 0;
  // keep youStyle; it is a persistent currency, not match-scoped

  try {
    if (killfeedEl) killfeedEl.replaceChildren();
    if (eventToastsEl) eventToastsEl.replaceChildren();
  } catch {}
  // C8: DOM киллфида очищен вручную — подпись обязана протухнуть.
  renderKillfeed._sig = null;
  // C7: у мета-панели теперь такая же подпись — сбрасываем по той же причине.
  renderMetaHudImpl._sig = null;
  renderTopHudImpl._placeSig = null;

  clientState.lastState = null;
  prevPlayers = new Map();
  currPlayers = new Map();
  headIndexByOwner = new Map();
  lastPacketAt = performance.now();
  clientState.camX = null;
  clientState.camY = null;
  clientState.camLeadX = 0;
  clientState.camLeadY = 0;

  shakeX = 0;
  shakeY = 0;
  shakeVelX = 0;
  shakeVelY = 0;

  minimapDirty = true;
  minimapHadChunkUpdate = false;
  lastMinimapDrawAt = 0;

  resetLeaderboardUi();

  renderKillfeed();
  renderMetaHud();
  renderTopHud();
  syncMatchOverlayActions();
}

function onMatchEnd(d) {
  if (typeof d?.tick === 'number' && Number.isFinite(d.tick)) {
    lastEventsTick = d.tick;
    lastEventsAt = Date.now();
  }
  matchSeq = Number(d?.seq) || matchSeq;
  matchEndTick = Number(d?.endTick) || matchEndTick;
  matchResetAt = Number(d?.resetAt) || 0;
  matchEnded = true;

  matchContinuePending = false;
  if (matchContinueTimeout) {
    clearTimeout(matchContinueTimeout);
    matchContinueTimeout = 0;
  }

  youAlive = false;
  lastDirSent = null;
  started = false;

  hideOverlays();

  lastMatchResults = d?.results || null;

  bumpMatchesPlayed();
  renderMatchResults(lastMatchResults);
  updateMatchCountdown();
  showMatchOverlay();
}

function onMatchStart(d) {
  if (typeof d?.tick === 'number' && Number.isFinite(d.tick)) {
    lastEventsTick = d.tick;
    lastEventsAt = Date.now();
  }
  matchSeq = Number(d?.seq) || matchSeq;
  matchEndTick = Number(d?.endTick) || 0;
  matchResetAt = 0;
  matchEnded = false;
  // C2: новый матч всегда начинается с фазы расширения; сервер дублирует её в
  // payload matchStart.
  matchPhaseBannerSeq = -1;
  applyMatchPhase(d?.phase ?? PHASE_EXPANSION, d?.phaseUntil, false, matchSeq);

  matchContinuePending = false;
  if (matchContinueTimeout) {
    clearTimeout(matchContinueTimeout);
    matchContinueTimeout = 0;
  }

  youAlive = false;
  lastDirSent = null;

  if (matchAutoJoin) {
    resetClientForNewMatch();
    hideMatchOverlay();
    hideOverlays();
    toggleEmojiPanel(false);
    syncMatchOverlayActions();
    started = true;
    obResetMatch();
    obAnnounceShop();
    try {
      document.body.classList.add('inGame');
    } catch {}
  } else {
    // stay in results overlay until user clicks "Играть дальше"
    started = false;
    updateMatchCountdown();
    showMatchOverlay();
  }
}

function hideOverlays() {
  // Пауза перед оверлеем смерти могла «выстрелить» уже после конца матча —
  // тогда экран смерти всплывал поверх итогов. Снимаем таймер вместе с ними.
  cancelDeathSlowMo();
  // K7: флаг залипал — оверлей магазина скрыт, а cosmeticsOpen остаётся true,
  // и каждое начисление Стиля запускало полную пересборку DOM скрытого
  // магазина (замер 3.3 мс на начисление).
  cosmeticsOpen = false;
  if (menuOverlay) menuOverlay.classList.add('hidden');
  if (settingsOverlay) settingsOverlay.classList.add('hidden');
  if (matchOverlay) matchOverlay.classList.add('hidden');
  if (deathOverlay) deathOverlay.classList.add('hidden');
  if (cosmeticsOverlay) cosmeticsOverlay.classList.add('hidden');
  if (minimapOverlayEl) minimapOverlayEl.classList.add('hidden');
  overlayManager.close('menu');
  overlayManager.close('settings');
  overlayManager.close('match');
  overlayManager.close('death');
  overlayManager.close('cosmetics');
  overlayManager.close('minimap');
  syncOverlayUiState();
}

restartBtn?.addEventListener('click', () => {
  wsSend('respawn', { rejoin: true });
  hideOverlays();
  started = true;
  youStreak = 0;
  lastDeathInfo = null;
  lastYouStats = null;
});

deathMenuBtn?.addEventListener('click', () => {
  leaveBtn?.click();
});

function showMenuOverlay() {
  showMenuOverlayImpl({
    cancelDeathSlowMo,
    menuOverlay,
    deathOverlay,
    overlayManager,
    setStarted: (v) => {
      started = v;
    },
    setYouAlive: (v) => {
      youAlive = v;
    },
    updateMenuNameUi,
    syncMenuOnboardingUi,
    setCreateRoomPending: (v) => {
      createRoomPending = v;
    },
    updateRoomsCreateUi,
    setLastYouStats: (v) => {
      lastYouStats = v;
    },
    getRoomsLoadTimeout: () => roomsLoadTimeout,
    setRoomsLoadTimeout: (v) => {
      roomsLoadTimeout = v;
    },
    getRoomsLoading: () => roomsLoading,
    setRoomsLoading: (v) => {
      roomsLoading = v;
    },
    getLastRooms: () => lastRooms,
    topHudEl,
    setYouStreak: (v) => {
      youStreak = v;
    },
    syncOverlayUiState,
    scheduleMenuSkinPreview,
    renderMenuMeta
  });
}

function hideMenuOverlay() {
  if (menuOverlay) menuOverlay.classList.add('hidden');
  stopMenuSkinPreview();
  overlayManager.close('menu');
  syncOverlayUiState();
}

/* Мета-крючок на экране меню: активные дейлики и прогресс до первого скина.
   Блок пустой (и скрыт CSS-ом), пока сервер не прислал ни задач, ни баланса —
   на первом экране новичка он ничего не должен обещать. */
const menuMetaEl = document.getElementById('menuMeta');

function renderMenuMeta() {
  renderMenuMetaImpl({
    menuMetaEl,
    menuOverlay,
    dailySlots,
    youDailies,
    dailyLabel,
    escapeHtml,
    t,
    fmtInt,
    COSMETICS_CATS,
    cosmeticsOwnedCount,
    cosmeticsCheapestPrice,
    missingFor,
    getYouStyle: () => youStyle,
    setSafeHtml
  });
}

leaveBtn?.addEventListener('click', () => {
  // K7: явный выход — реконнект в эту комнату больше не нужен.
  userLeftRoom = true;
  rejoinRoomId = null;
  rejoinFinish();
  wsSend('leave', {});
  roomId = null;
  roomLimit = null;
  updateRoomInfo();
  showMenuOverlay();
});

function renderRoomsListLocal(rooms, emptyMessage) {
  renderRoomsList(roomsListEl, rooms, {
    t,
    selectedRoomId,
    emptyMessage,
    onSelect: (rid) => {
      selectedRoomId = rid;
      if (joinRoomBtn) joinRoomBtn.disabled = selectedRoomId == null;
      updateRoomsStatsLocal(lastRooms);
    },
    onJoin: (rid) => attemptJoinRoom(rid)
  });
}

function renderRoomsEmptyLocal(kind, message) {
  renderRoomsEmpty(roomsListEl, kind, message, {
    t,
    onRetry: () => refreshRoomsBtn?.click(),
    onCreateRoom: () => setRoomsCreateOpen(true),
    onResetSearch: () => {
      if (roomsSearchInput) roomsSearchInput.value = '';
      updateRoomsUi();
      try {
        roomsSearchInput?.focus();
      } catch {}
    }
  });
}

function updateRoomsStatsLocal(rawRooms) {
  updateRoomsStats(
    rawRooms,
    {
      statsEl: roomsStatsEl,
      onlineEl: document.getElementById('menuOnlineCount'),
      badgeEl: document.getElementById('menuOnlineBadge')
    },
    { t, formatNumber, wsStatusSuffix, loading: roomsLoading, error: roomsLoadError }
  );
}

/* Порядок и отбор комнат переехали в client_rooms.js — вместе с тестами.
   Здесь остаётся единственное, что действительно принадлежит этому файлу:
   откуда взять режим сортировки и строку поиска. */
function applyRoomsFilterSort() {
  return filterAndSortRooms(lastRooms, {
    query: roomsSearchInput?.value,
    sort: roomsSortSelect?.value
  });
}

function updateRoomsUi() {
  syncRoomsSearchClearUi();
  const rawAll = Array.isArray(lastRooms) ? lastRooms : [];
  if (selectedRoomId != null) {
    const exists = rawAll.some((r) => Number(r?.id) === Number(selectedRoomId));
    if (!exists) selectedRoomId = null;
  }

  if (joinRoomBtn) {
    joinRoomBtn.disabled = selectedRoomId == null;
  }
  updateRoomsStatsLocal(lastRooms);
  const raw = Array.isArray(lastRooms) ? lastRooms : [];
  const filtered = applyRoomsFilterSort();

  if (roomsLoading && raw.length === 0) {
    renderRoomsEmptyLocal('loading');
    return;
  }
  if (roomsLoadError && raw.length === 0) {
    renderRoomsEmptyLocal('error', roomsLoadError);
    return;
  }
  if (raw.length === 0) {
    renderRoomsEmptyLocal('empty');
    return;
  }
  if (filtered.length === 0) {
    renderRoomsEmptyLocal('noMatch');
    return;
  }
  renderRoomsListLocal(filtered);
}

playBtn?.addEventListener('click', () => {
  markJoinFunnelStart('auto');
  // Пустой ник не должен быть барьером: подставляем случайный и стартуем.
  ensureNickBeforePlay();
  const nm = submitNameFromInput(menuNameInput);
  if (!nm) {
    updateMenuNameUi();
    menuNameInput?.focus();
    return;
  }
  // Без соединения join раньше молча проглатывался — кнопка «не работала»,
  // и клик приходилось повторять, пока он не попадёт в момент, когда сокет
  // уже открыт. Теперь намерение сохраняется и уходит само по onOpen.
  if (!wsIsConnected()) {
    pendingQuickJoin = { event: 'quick_start', params: { mode: 'auto' } };
    addToast('📡', t('net.join_offline'), null, null, { key: 'join_offline' });
    connectWs();
    return;
  }
  userLeftRoom = false;
  trackEvent('quick_start');
  wsSend('join', { mode: 'auto' });
});

joinRoomBtn?.addEventListener('click', () => {
  if (selectedRoomId == null) return;
  markJoinFunnelStart('room');
  const nm = submitNameFromInput(menuNameInput);
  if (!nm) {
    updateMenuNameUi();
    menuNameInput?.focus();
    return;
  }
  if (!wsIsConnected()) {
    pendingQuickJoin = { event: 'join_room', params: { roomId: selectedRoomId, mode: 'id' } };
    addToast('📡', t('net.join_offline'), null, null, { key: 'join_offline' });
    connectWs();
    return;
  }
  userLeftRoom = false;
  trackEvent('join_room');
  wsSend('join', { roomId: selectedRoomId, mode: 'id' });
});

menuNameInput?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  // H5: Enter в поле ника запускает игру — привычный для жанра паттерн.
  // Раньше нажатие просто гасилось, и клавиатурный путь «ввёл ник → Enter» не работал.
  e.preventDefault();
  playBtn?.click();
});

menuNameInput?.addEventListener('input', () => {
  updateMenuNameUi();
});

menuNameRandomBtn?.addEventListener('click', (e) => {
  e?.preventDefault?.();
  applyRandomNick();
});

roomsSearchInput?.addEventListener('input', () => {
  syncRoomsSearchClearUi();
});

roomsSearchClearBtn?.addEventListener('click', (e) => {
  e?.preventDefault?.();
  clearRoomsSearch();
});

refreshRoomsBtn?.addEventListener('click', () => {
  if (roomsLoading) return;
  if (roomsLoadTimeout) {
    clearTimeout(roomsLoadTimeout);
    roomsLoadTimeout = 0;
  }

  roomsLoading = true;
  roomsLoadError = '';
  trackEvent('refresh_rooms');
  if (refreshRoomsBtn) {
    refreshRoomsBtn.disabled = true;
    refreshRoomsBtn.classList.add('isLoading');
    refreshRoomsBtn.textContent = t('rooms.loading');
  }
  updateRoomsUi();
  wsSend('rooms', {});

  roomsLoadTimeout = setTimeout(() => {
    roomsLoadTimeout = 0;
    if (!roomsLoading) return;
    roomsLoading = false;
    roomsLoadError = t('rooms.timeout');
    if (refreshRoomsBtn) {
      refreshRoomsBtn.disabled = false;
      refreshRoomsBtn.classList.remove('isLoading');
      refreshRoomsBtn.textContent = t('rooms.refresh');
    }
    updateRoomsUi();
  }, 4000);
});

roomsSearchInput?.addEventListener('input', () => {
  updateRoomsUi();
});

roomsSortSelect?.addEventListener('change', () => {
  updateRoomsUi();
});

function updateRoomInfo() {
  if (!roomInfoEl) return;
  const rid = roomId == null ? '…' : String(roomId);
  const lim = roomLimit == null ? '' : ` / ${roomLimit}`;
  roomInfoEl.textContent = `${t('perf.room')}: ${rid}${lim}${wsStatusSuffix()}`;
  try {
    updateChatHeaderStatus();
  } catch {}
}

function computeTopSorted(players) {
  return sortPlayersByScore(players);
}

/* Личный рекорд по доле карты живёт в client_stats.js вместе с тестами.
   Здесь остаётся только подстановка хранилища. */
function commitBestPct(pct) {
  return commitBest(pct, localStorage);
}

function renderDeathStats() {
  renderDeathStatsImpl({
    deathStatsEl,
    clientState,
    you,
    lastYouStats,
    mapCells,
    youContractType,
    youContractProgress,
    youContractGoal,
    contractLabel,
    infoPack,
    computeTopSorted,
    cosClampId,
    playerTitleHtml,
    cosTitleByPlayer,
    escapeHtml,
    getDeathBestShown: () => deathBestShown,
    setDeathBestShown: (v) => {
      deathBestShown = v;
    },
    commitBestPct,
    setSafeHtml,
    t,
    fmtInt,
    fmtPct1,
    youKills,
    rightTeamDetailsEl,
    renderTeamHudState: renderTeamHud,
    teamUnreadCount: () => teamUnreadCount,
    setTeamUnreadCount: (v) => {
      teamUnreadCount = v;
    },
    setBadgeCount,
    rightTeamBadgeEl,
    syncRightEmptyStates
  });
}

renderTeamHud._u = 0;
renderTeamHud._at = 0;

function updateLeaderboard() {
  renderLeaderboard(clientState.lastState, {
    you,
    mapCells,
    statsEl,
    t,
    cosTitleByPlayer,
    botArchInfo,
    botArchBadge,
    cosTitleName,
    lang
  });
}

function syncChatInputOverlayScroll() {
  if (!chatInputOverlay || !chatInput) return;
  chatInputOverlay.scrollLeft = chatInput.scrollLeft;
}

let chatInputOverlayRaf = 0;
function renderChatInputOverlayNow() {
  chatInputOverlayRaf = 0;
  if (!chatInputOverlay || !chatInput) return;
  const v = chatInput.value || '';
  setSafeHtml(chatInputOverlay, v ? `<span class="chatInputText">${emojiParseSafeHtml(v)}</span>` : '<span class="chatInputText"></span>');
  requestAnimationFrame(syncChatInputOverlayScroll);
}

function scheduleChatInputOverlayRender() {
  if (chatInputOverlayRaf) return;
  chatInputOverlayRaf = requestAnimationFrame(renderChatInputOverlayNow);
}

function insertAtCursor(el, text) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const before = el.value.slice(0, start);
  const after = el.value.slice(end);
  el.value = `${before}${text}${after}`;
  const pos = start + text.length;
  el.selectionStart = pos;
  el.selectionEnd = pos;
  el.focus();
  if (el === chatInput) scheduleChatInputOverlayRender();
}

chatInput?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.shiftKey) {
    chatOpenUntil = performance.now() + 12000;
    return;
  }
  e.preventDefault();
  try {
    chatForm?.requestSubmit?.();
  } catch {
    try {
      chatForm?.dispatchEvent?.(new Event('submit', { cancelable: true }));
    } catch {}
  }
});

function setChatCollapsed(v) {
  chat.classList.toggle('collapsed', v);
  if (v) toggleEmojiPanel(false);
  if (!v) {
    unreadCount = 0;
    updateUnreadBadge();
    if (chatDirty) {
      renderChat();
      chatDirty = false;
    }
  }

  try {
    localStorage.setItem('chatCollapsed', v ? '1' : '0');
  } catch {
    // ignore
  }
}

function getChatCollapsedDefault() {
  try {
    const raw = localStorage.getItem('chatCollapsed');
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch {
    // ignore
  }
  const small = (window.innerWidth <= 1400 && window.innerHeight <= 820) || window.innerWidth <= 720;
  return small;
}

const CHAT_ENTER_HINT_KEY = 'chatEnterHintDismissed';
let chatEnterHintTimer = 0;
let chatEnterHintDismissed = false;

function hideChatEnterHint() {
  if (!chatHeaderHintEl || chatEnterHintDismissed) return;
  chatEnterHintDismissed = true;
  chatHeaderHintEl.classList.add('hidden');
  if (chatEnterHintTimer) {
    clearTimeout(chatEnterHintTimer);
    chatEnterHintTimer = 0;
  }
  try {
    localStorage.setItem(CHAT_ENTER_HINT_KEY, '1');
  } catch {
    // ignore
  }
}

function initChatEnterHint() {
  if (!chatHeaderHintEl) return;
  let dismissed = false;
  try {
    dismissed = localStorage.getItem(CHAT_ENTER_HINT_KEY) === '1';
  } catch {
    // ignore
  }
  if (dismissed) {
    chatEnterHintDismissed = true;
    chatHeaderHintEl.classList.add('hidden');
    return;
  }
  chatHeaderHintEl.classList.remove('hidden');
  if (chatEnterHintTimer) clearTimeout(chatEnterHintTimer);
  chatEnterHintTimer = setTimeout(() => {
    hideChatEnterHint();
  }, 12000);
}

setChatCollapsed(getChatCollapsedDefault());
initChatEnterHint();

const chatHeaderStatusEl = (() => {
  if (!chatHeader) return null;
  const left = document.getElementById('chatHeaderLeft');
  if (!left) return null;
  const el = document.createElement('span');
  el.id = 'chatHeaderStatus';
  el.className = 'chatHeaderStatus';
  left.appendChild(el);
  return el;
})();

const chatCollapseBtnEl = (() => {
  if (!chatHeader) return null;
  const right = document.getElementById('chatHeaderRight');
  if (!right) return null;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'iconBtn chatCollapseBtn';
  b.setAttribute('data-role', 'chatCollapse');
  b.appendChild(document.createTextNode('▾'));
  right.appendChild(b);
  return b;
})();

function updateChatHeaderStatus() {
  if (!chatHeaderStatusEl) return;
  const inRoom = roomId != null;
  const suf = wsStatusSuffix();
  const base = inRoom ? `${t('chat.status_room')} ${roomId}` : t('chat.status_lobby');
  chatHeaderStatusEl.textContent = `${base}${suf ? ` ${suf}` : ''}`;
}

function updateRightI18n() {
  try {
    const sum = rightEventsDetailsEl?.querySelector?.('.rightDetailsSummary');
    if (sum) {
      const badge = sum.querySelector('.badge');
      sum.replaceChildren();
      sum.appendChild(document.createTextNode(t('right.events')));
      if (badge) sum.appendChild(badge);
    }
  } catch {}
  try {
    if (rightMatchEmptyEl) {
      const tt = rightMatchEmptyEl.querySelector('.rightEmptyTitle');
      const dd = rightMatchEmptyEl.querySelector('.rightEmptyDesc');
      if (tt) tt.textContent = t('right.match_empty_title');
      if (dd) dd.textContent = t('right.match_empty_desc');
    }
    if (rightTeamEmptyEl) {
      const tt = rightTeamEmptyEl.querySelector('.rightEmptyTitle');
      const dd = rightTeamEmptyEl.querySelector('.rightEmptyDesc');
      if (tt) tt.textContent = t('right.team_empty_title');
      if (dd) dd.textContent = t('right.team_empty_desc');
    }
    if (rightEventsEmptyEl) {
      const tt = rightEventsEmptyEl.querySelector('.rightEmptyTitle');
      const dd = rightEventsEmptyEl.querySelector('.rightEmptyDesc');
      if (tt) tt.textContent = t('right.events_empty_title');
      if (dd) dd.textContent = t('right.events_empty_desc');
    }
  } catch {}
}

function syncChatCollapseButtonUi() {
  if (!chatCollapseBtnEl) return;
  const collapsed = chat.classList.contains('collapsed');
  chatCollapseBtnEl.textContent = collapsed ? '▸' : '▾';
  chatCollapseBtnEl.setAttribute('aria-label', collapsed ? t('chat.expand') : t('chat.collapse'));
}

syncChatCollapseButtonUi();
updateChatHeaderStatus();

try {
  if (chatHeader) {
    chatHeader.tabIndex = 0;
    chatHeader.setAttribute('role', 'button');
  }
} catch {}

chatHeader.addEventListener('click', (e) => {
  const role = String(e?.target?.getAttribute?.('data-role') || '');
  if (role === 'chatCollapse') {
    const isCollapsed = chat.classList.contains('collapsed');
    if (isCollapsed) {
      setChatCollapsed(false);
      chatOpenUntil = performance.now() + 12000;
      try {
        chatInput?.focus?.();
      } catch {}
    } else {
      setChatCollapsed(true);
    }
    syncChatCollapseButtonUi();
    e?.preventDefault?.();
    e?.stopPropagation?.();
    return;
  }
  const isCollapsed = chat.classList.contains('collapsed');
  if (isCollapsed) {
    setChatCollapsed(false);
    chatOpenUntil = performance.now() + 12000;
    chatInput.focus();
    e?.preventDefault?.();
  } else {
    setChatCollapsed(true);
  }
  syncChatCollapseButtonUi();
});

chatHeader.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    const role = String(e?.target?.getAttribute?.('data-role') || '');
    if (role === 'chatCollapse') return;
    e.preventDefault();
    chatHeader.click();
  }
});

nameBtn.addEventListener('click', (e) => {
  e.preventDefault();
  submitName();
});

nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') e.preventDefault();
});

function formatTime(t) {
  return formatClock(t);
}

chatInput?.addEventListener('input', () => {
  scheduleChatInputOverlayRender();
  if (chatInput && String(chatInput.value || '').trim()) hideChatEnterHint();
});
chatInput?.addEventListener('scroll', syncChatInputOverlayScroll);
chatInput?.addEventListener('click', syncChatInputOverlayScroll);
chatInput?.addEventListener('keyup', syncChatInputOverlayScroll);
scheduleChatInputOverlayRender();

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = String(chatInput.value || '').trim();
  if (!text) return;
  wsSend('chat', { text });
  hideChatEnterHint();
  chatInput.value = '';
  scheduleChatInputOverlayRender();
  chatOpenUntil = performance.now() + 12000;
  unreadCount = 0;
  updateUnreadBadge();
});

let matchUnreadCount = 0;
let teamUnreadCount = 0;
let eventsUnreadCount = 0;

function createSummaryBadge(detailsEl) {
  const sum = detailsEl?.querySelector?.('.rightDetailsSummary');
  if (!sum) return null;
  const el = document.createElement('span');
  el.className = 'badge hidden';
  el.setAttribute('aria-hidden', 'true');
  sum.appendChild(el);
  return el;
}

function setBadgeCount(el, n) {
  if (!el) return;
  const v = Math.max(0, Number(n) || 0);
  el.textContent = v > 99 ? '99+' : String(v);
  el.classList.toggle('hidden', v <= 0);
}

const rightMatchBadgeEl = createSummaryBadge(rightMatchDetailsEl);
const rightTeamBadgeEl = createSummaryBadge(rightTeamDetailsEl);

const rightEventsDetailsEl = (() => {
  if (!rightInfoEl || !killfeedEl) return null;
  if (document.getElementById('rightEventsDetails')) return document.getElementById('rightEventsDetails');
  const det = document.createElement('details');
  det.id = 'rightEventsDetails';
  det.className = 'rightDetails';
  det.open = true;
  const sum = document.createElement('summary');
  sum.className = 'rightDetailsSummary';
  sum.textContent = t('right.events');
  det.appendChild(sum);
  try {
    killfeedEl.parentElement?.removeChild?.(killfeedEl);
  } catch {}
  det.appendChild(killfeedEl);
  rightInfoEl.appendChild(det);
  return det;
})();

const rightEventsBadgeEl = createSummaryBadge(rightEventsDetailsEl);

function createRightEmpty(detailsEl, titleKey, descKey) {
  if (!detailsEl) return null;
  const el = document.createElement('div');
  el.className = 'rightEmpty hidden';
  const tEl = document.createElement('div');
  tEl.className = 'rightEmptyTitle';
  tEl.textContent = t(titleKey);
  const dEl = document.createElement('div');
  dEl.className = 'rightEmptyDesc';
  dEl.textContent = t(descKey);
  el.appendChild(tEl);
  el.appendChild(dEl);
  detailsEl.appendChild(el);
  return el;
}

const rightMatchEmptyEl = createRightEmpty(rightMatchDetailsEl, 'right.match_empty_title', 'right.match_empty_desc');
const rightTeamEmptyEl = createRightEmpty(rightTeamDetailsEl, 'right.team_empty_title', 'right.team_empty_desc');
const rightEventsEmptyEl = createRightEmpty(rightEventsDetailsEl, 'right.events_empty_title', 'right.events_empty_desc');

function syncRightEmptyStates() {
  const matchEmpty = !started || !metaHudEl || metaHudEl.style.display === 'none' || metaHudEl.childElementCount === 0;
  const teamEmpty = !started || !teamHudEl || !String(teamHudEl.textContent || '').trim();
  const eventsEmpty = !started || !killfeedEl || killfeedEl.childElementCount === 0;
  if (rightMatchEmptyEl) rightMatchEmptyEl.classList.toggle('hidden', !matchEmpty);
  if (rightTeamEmptyEl) rightTeamEmptyEl.classList.toggle('hidden', !teamEmpty);
  if (rightEventsEmptyEl) rightEventsEmptyEl.classList.toggle('hidden', !eventsEmpty);
}

rightMatchDetailsEl?.addEventListener?.('toggle', () => {
  if (rightMatchDetailsEl.open) {
    matchUnreadCount = 0;
    setBadgeCount(rightMatchBadgeEl, matchUnreadCount);
  }
});

rightTeamDetailsEl?.addEventListener?.('toggle', () => {
  if (rightTeamDetailsEl.open) {
    teamUnreadCount = 0;
    setBadgeCount(rightTeamBadgeEl, teamUnreadCount);
  }
});

rightEventsDetailsEl?.addEventListener?.('toggle', () => {
  if (rightEventsDetailsEl.open) {
    eventsUnreadCount = 0;
    setBadgeCount(rightEventsBadgeEl, eventsUnreadCount);
  }
});

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
}

let resizeRaf = 0;

// C5: общий хвост пересчёта — и для отложенного, и для немедленного пути.
function afterResize() {
  // C3: панель «Ваш облик» тянется по ширине колонки меню.
  try {
    renderMenuSkinPreview();
  } catch {}
  // C2: новый размер вьюпорта — новая просьба к серверу, с дебаунсом.
  scheduleViewportSend();
}

function scheduleResize() {
  if (resizeRaf) return;
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = 0;
    resize();
    afterResize();
  });
}

/* C5: `resize` откладывался до следующего кадра, а на iOS Safari при повороте
   экрана и при сворачивании/разворачивании адресной строки следующий кадр
   может не прийти вовсе (страница успевает уйти в фон) — канвас оставался в
   старом размере, и поле рисовалось с обрезанным или растянутым краем.
   Поворот и visualViewport пересчитываем немедленно, а отложенный путь
   отменяем, чтобы он не перезаписал результат теми же числами. */
function resizeNow() {
  if (resizeRaf) {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = 0;
  }
  resize();
  afterResize();
}

window.addEventListener('resize', scheduleResize);
window.addEventListener('orientationchange', () => {
  resizeNow();
  /* На части устройств innerWidth/innerHeight на момент orientationchange ещё
     старые — добираем повторным пересчётом после того, как браузер применит
     новую метрику. Оба вызова идемпотентны. */
  setTimeout(resizeNow, 60);
  setTimeout(resizeNow, 300);
});
try {
  // Клавиатура и сворачивание адресной строки меняют visualViewport, но не
  // всегда дают window.resize.
  window.visualViewport?.addEventListener?.('resize', resizeNow);
  window.screen?.orientation?.addEventListener?.('change', resizeNow);
} catch {}
resize();

let lastDirSent = null;

function setDir(dir) {
  if (!youAlive) return;
  if (dir === lastDirSent) return;
  // F13: подсказка про управление гаснет по факту действия, а не по факту входа.
  if (!getMenuControlsSeen()) {
    setMenuControlsSeen();
    syncMenuOnboardingUi();
  }
  lastDirSent = dir;
  wsSend('input', { dir });
}

window.addEventListener(
  'keydown',
  (e) => {
    if (deathOverlay && !deathOverlay.classList.contains('hidden')) {
      const isSpace =
        e.code === 'Space' ||
        e.key === ' ' ||
        e.key === 'Space' ||
        e.code === 'Spacebar' ||
        e.key === 'Spacebar' ||
        e.keyCode === 32 ||
        e.which === 32;

      if (e.key === 'Enter') {
        bumpChatVisibility(12000, true);
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (isSpace) {
        restartBtn?.click();
        e.preventDefault();
        e.stopPropagation();
      }
    }
  },
  { capture: true }
);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    if (overlayManager.trapFocus(e)) return;
  }

  if (e.code === 'KeyM') {
    const ae = document.activeElement;
    if (ae && (ae === nameInput || ae === menuNameInput || chat.contains(ae))) return;
    if (menuOverlay && !menuOverlay.classList.contains('hidden')) return;
    if (settingsOverlay && !settingsOverlay.classList.contains('hidden')) return;
    if (cosmeticsOverlay && !cosmeticsOverlay.classList.contains('hidden')) return;
    if (matchOverlay && !matchOverlay.classList.contains('hidden')) return;
    if (deathOverlay && !deathOverlay.classList.contains('hidden')) return;
    toggleMinimapOverlay();
    e.preventDefault();
    return;
  }

  if (e.code === 'KeyP') {
    const ae = document.activeElement;
    if (ae && (ae === nameInput || ae === menuNameInput || chat.contains(ae))) return;
    if (menuOverlay && !menuOverlay.classList.contains('hidden')) return;
    if (settingsOverlay && !settingsOverlay.classList.contains('hidden')) return;
    if (deathOverlay && !deathOverlay.classList.contains('hidden')) return;
    perfEnabled = !perfEnabled;
    if (perfEnabledInput) perfEnabledInput.checked = !!perfEnabled;
    if (perfEl) perfEl.style.display = perfEnabled ? '' : 'none';
    saveSettingsState();
    e.preventDefault();
    return;
  }

  if (e.key === 'Escape' || e.key === 'Esc') {
    if (overlayManager.closeTop()) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (chat && !chat.classList.contains('collapsed')) {
      setChatCollapsed(true);
      try {
        document.activeElement?.blur?.();
      } catch {}
      e.preventDefault();
      return;
    }
  }

  if (e.key === 'Enter') {
    const ae = document.activeElement;
    if (ae && chat.contains(ae)) return;
    if (menuOverlay && !menuOverlay.classList.contains('hidden')) {
      e.preventDefault();
      return;
    }
    if (settingsOverlay && !settingsOverlay.classList.contains('hidden')) {
      e.preventDefault();
      return;
    }
    if (cosmeticsOverlay && !cosmeticsOverlay.classList.contains('hidden')) {
      e.preventDefault();
      return;
    }
    if (matchOverlay && !matchOverlay.classList.contains('hidden')) {
      e.preventDefault();
      return;
    }

    bumpChatVisibility(12000, true);
    e.preventDefault();
    return;
  }

  // C6: never steer the snake while an overlay is on top of the game.
  if (overlayManager.getTop()) return;

  const ae = document.activeElement;
  if (ae && (ae === nameInput || chat.contains(ae))) return;
  if (e.code === 'ArrowUp' || e.code === 'KeyW') setDir('up');
  else if (e.code === 'ArrowDown' || e.code === 'KeyS') setDir('down');
  else if (e.code === 'ArrowLeft' || e.code === 'KeyA') setDir('left');
  else if (e.code === 'ArrowRight' || e.code === 'KeyD') setDir('right');
});

// Mobile / touch: swipe on the canvas to change direction
try {
  canvas.style.touchAction = 'none';
} catch {
  // ignore
}

let swipeActive = false;
let swipeX0 = 0;
let swipeY0 = 0;
let swipePointerId = null;
const SWIPE_PX = 22;

// Визуальный индикатор свайпа (только тач): показывает точку отсчёта жеста,
// deadzone-порог SWIPE_PX и текущее накопленное смещение пальца. Раньше
// точка отсчёта переустанавливалась молча — игрок не видел, где проходит
// граница срабатывания, и терял змейку на "случайных" срабатываниях.
let swipeIndicatorEl = null;
function getSwipeIndicator() {
  if (swipeIndicatorEl) return swipeIndicatorEl;
  const el = document.createElement('div');
  el.id = 'swipeIndicator';
  el.setAttribute('aria-hidden', 'true');
  const dead = document.createElement('div');
  dead.className = 'swipeIndicator-deadzone';
  const dot = document.createElement('div');
  dot.className = 'swipeIndicator-dot';
  el.appendChild(dead);
  el.appendChild(dot);
  document.body.appendChild(el);
  swipeIndicatorEl = el;
  return el;
}
function showSwipeIndicator(x0, y0) {
  const el = getSwipeIndicator();
  el.style.left = `${x0}px`;
  el.style.top = `${y0}px`;
  el.classList.add('isOn');
}
function moveSwipeIndicator(dx, dy) {
  if (!swipeIndicatorEl) return;
  const dot = swipeIndicatorEl.querySelector('.swipeIndicator-dot');
  if (dot) dot.style.transform = `translate(${dx}px, ${dy}px)`;
}
function hideSwipeIndicator() {
  if (!swipeIndicatorEl) return;
  swipeIndicatorEl.classList.remove('isOn');
  const dot = swipeIndicatorEl.querySelector('.swipeIndicator-dot');
  if (dot) dot.style.transform = 'translate(0, 0)';
}

function swipeDir(dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

canvas.addEventListener(
  'pointerdown',
  (e) => {
    if (!youAlive) return;
    if (e.pointerType !== 'touch') return;
    swipeActive = true;
    swipePointerId = e.pointerId;
    swipeX0 = e.clientX;
    swipeY0 = e.clientY;
    showSwipeIndicator(swipeX0, swipeY0);
    try {
      canvas.setPointerCapture?.(e.pointerId);
    } catch {
      // Захват — оптимизация: свайп работает и без него, а setPointerCapture
      // кидает NotFoundError, если указатель уже отпущен.
    }
    e.preventDefault();
  },
  { passive: false }
);

canvas.addEventListener(
  'pointermove',
  (e) => {
    if (!swipeActive) return;
    if (swipePointerId != null && e.pointerId !== swipePointerId) return;
    const dx = e.clientX - swipeX0;
    const dy = e.clientY - swipeY0;
    moveSwipeIndicator(dx, dy);
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return;
    setDir(swipeDir(dx, dy));
    swipeX0 = e.clientX;
    swipeY0 = e.clientY;
    showSwipeIndicator(swipeX0, swipeY0);
    e.preventDefault();
  },
  { passive: false }
);

function endSwipe(e) {
  if (swipePointerId != null && e.pointerId !== swipePointerId) return;
  swipeActive = false;
  swipePointerId = null;
  hideSwipeIndicator();
}

canvas.addEventListener('pointerup', endSwipe);
canvas.addEventListener('pointercancel', endSwipe);

// C14: у бонусов на канвасе нет нативного title — маленькая подсказка рядом
// с курсором при наведении на иконку подсказывает эффект без лишней вёрстки.
let powerUpTooltipEl = null;
function powerUpTooltip() {
  if (!powerUpTooltipEl) {
    powerUpTooltipEl = document.createElement('div');
    powerUpTooltipEl.className = 'powerupTooltip hidden';
    document.body.appendChild(powerUpTooltipEl);
  }
  return powerUpTooltipEl;
}
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;
  if (!powerUpScreenPos.length) {
    if (powerUpTooltipEl) powerUpTooltipEl.classList.add('hidden');
    return;
  }
  const mx = e.clientX;
  const my = e.clientY;
  let hit = null;
  let bestD = Infinity;
  for (const p of powerUpScreenPos) {
    const dx = mx - p.cx;
    const dy = my - p.cy;
    const d = dx * dx + dy * dy;
    const rr = (p.r * 1.6) * (p.r * 1.6);
    if (d <= rr && d < bestD) {
      bestD = d;
      hit = p;
    }
  }
  const el = powerUpTooltip();
  if (!hit) {
    el.classList.add('hidden');
    return;
  }
  el.textContent = powerupLabel(hit.type);
  el.style.left = `${mx + 14}px`;
  el.style.top = `${my + 14}px`;
  el.classList.remove('hidden');
});
canvas.addEventListener('pointerleave', () => {
  if (powerUpTooltipEl) powerUpTooltipEl.classList.add('hidden');
});

// Zoom disabled: fixed visible area regardless of screen size

/* G-lag: диагностика жалобы «поле рисуется, а движение долго не начинается».
   Три контрольные точки одной воронки: клик «Играть»/«Войти» → сервер прислал
   init (сама команда join обработана) → пришёл первый бинарный снапшот
   состояния ПОСЛЕ init (клиент реально может отрисовать живых игроков).
   Считаем именно от клика, а не от отправки join: если сокет ещё
   переподключается, эта задержка тоже часть того, что видит игрок. */
let joinFunnelAt = 0;
let joinFunnelMode = '';
let joinFunnelInitAt = 0;
let joinFunnelAwaitingFirstState = false;

function markJoinFunnelStart(mode) {
  joinFunnelAt = performance.now();
  joinFunnelMode = mode;
  joinFunnelInitAt = 0;
  joinFunnelAwaitingFirstState = false;
}

function markJoinFunnelInit() {
  if (!joinFunnelAt) return;
  joinFunnelInitAt = performance.now();
  joinFunnelAwaitingFirstState = true;
}

function markJoinFunnelFirstState() {
  if (!joinFunnelAwaitingFirstState || !joinFunnelAt) return;
  joinFunnelAwaitingFirstState = false;
  const now = performance.now();
  const toInitMs = Math.round(joinFunnelInitAt - joinFunnelAt);
  const toStateMs = Math.round(now - joinFunnelAt);
  try {
    console.log(`[join_funnel] mode=${joinFunnelMode} click_to_init_ms=${toInitMs} click_to_first_state_ms=${toStateMs}`);
  } catch {}
  // Только заметно медленные случаи шлём на сервер — иначе обычная игра
  // превращается в лог-спам на каждый вход. 800мс — за пределами того, что
  // ощущается как «мгновенно», но не срабатывает на обычный пинг.
  if (toStateMs > 800) {
    wsSend('clientTiming', { kind: 'join_funnel', mode: joinFunnelMode, toInitMs, toStateMs });
  }
  joinFunnelAt = 0;
}

function onInit(msg) {
  markJoinFunnelInit();
  W = msg.w;
  H = msg.h;
  N = W * H;
  tickMs = msg.tickMs;
  if (typeof msg?.tick === 'number' && Number.isFinite(msg.tick)) {
    lastEventsTick = msg.tick;
    lastEventsAt = Date.now();
  }
  you = Number(msg.you) || 0;
  mapCells = msg.mapCells || N;
  roomId = msg.room ?? null;
  roomLimit = msg.roomLimit ?? null;

  // K7: вход в комнату состоялся — реконнект-цель обновлена, флаг «ушёл сам» снят.
  rejoinRoomId = roomId;
  userLeftRoom = false;
  const wasRejoin = rejoinPending;
  if (rejoinPending) {
    rejoinFinish();
    addToast('✅', t('net.rejoined'), null, null, { key: 'net_reconnect' });
  }

  matchSeq = Number(msg?.matchSeq) || 0;
  matchEndTick = Number(msg?.matchEnd) || 0;
  matchEnded = !!msg?.matchEnded;
  matchResetAt = Number(msg?.matchReset) || 0;
  // C2: фаза приходит прямо в init — при входе посреди матча баннер не нужен.
  matchPhaseBannerSeq = Number(msg?.phase) === PHASE_FINAL ? matchSeq : -1;
  applyMatchPhase(msg?.phase, msg?.phaseUntil, false, matchSeq);
  updateRoomInfo();

  matchContinuePending = false;
  if (matchContinueTimeout) {
    clearTimeout(matchContinueTimeout);
    matchContinueTimeout = 0;
  }
  if (matchEnded) {
    if (msg?.matchResults) {
      lastMatchResults = msg.matchResults;
      renderMatchResults(lastMatchResults);
    }
    updateMatchCountdown();
    showMatchOverlay();
  } else {
    resetClientForNewMatch();
    hideMatchOverlay();
  }

  createRoomPending = false;
  setRoomsCreateOpen(false);
  updateRoomsCreateUi();
  selectedRoomId = null;

  hideMenuOverlay();
  hideOverlays();

  started = true;
  // F13: раньше подсказка гасилась прямо здесь, ещё до того как игрок её прочитал.
  // Теперь её снимает первое реальное действие (см. setDir).
  syncMenuOnboardingUi();
  // C9: реконнект не считается новым входом в матч.
  obResetMatch(!wasRejoin);
  obAnnounceShop();
  try {
    document.body.classList.add('inGame');
  } catch {}

  gridOwner = new Uint16Array(N);
  trailOwner = new Uint16Array(N);

  minimapGridOwner = new Uint16Array(N);

  // K2: вход в комнату — новый набор номеров игроков. Всё, что кэшируется по
  // номеру, обязано умереть здесь, иначе чужие цвета и «ботовость» приезжают
  // из прошлой комнаты.
  colors.clear();
  ownerFillStyleCache.clear();
  minimapOwnerRgbCache.clear();
  botIds = new Set();
  lastRoi = null;
  // C7: то же самое при входе в комнату — см. комментарий в onMatchStart.
  nameById.clear();
  nameEnById.clear();
  cosTerrByPlayer.clear();
  cosDeathByPlayer.clear();
  cosTitleByPlayer.clear();
  botArchByPlayer.clear();

  gridFillAt = new Float32Array(N);
  coolSeenAt = new Float32Array(N);
  captureAnchorByOwner.clear();
  coolDeadlineByOwner.clear();

  minimap.width = W;
  minimap.height = H;
  minimapImage = mmCtx.createImageData(W, H);
  // minimap is updated by server-sent chunk updates

  mmCtx.imageSmoothingEnabled = true;
  mmCtx.imageSmoothingQuality = 'high';

  if (storedName) {
    wsSend('setName', { name: storedName });
  }

  // Spawn in the current room (no rejoin). Without this the player stays dead and cannot move.
  wsSend('respawn', {});

  youKills = 0;
  youStreak = 0;

  if (msg?.cosmetics) {
    onCosmetics(msg.cosmetics);
  }
  renderTopHud();
}

function onCosmetics(msg) {
  // C4: remember the previous inventory so we can detect what was just bought.
  const prevInv = {
    capturefx: Number(youCos.inv.capturefx) || 0,
    head: Number(youCos.inv.head) || 0,
    seg: Number(youCos.inv.seg) || 0,
    nameplate: Number(youCos.inv.nameplate) || 0,
    frame: Number(youCos.inv.frame) || 0,
    terr: Number(youCos.inv.terr) || 0,
    death: Number(youCos.inv.death) || 0
  };
  const hadServerState = cosmeticsSource === 'server';

  const st = Number(msg?.style);
  if (Number.isFinite(st)) youStyle = Math.max(0, st);

  cosmeticsLoaded = true;
  cosmeticsSource = 'server';

  // Полный снимок: категории, которых в сообщении нет, обнуляются.
  applyCosPayload(youCos, msg, 'replace');


  // Новые категории и титулы: сервер может их ещё не присылать. В этом случае
  // поля undefined -> нули, магазин показывает только базовый вариант, а
  // «Титулы» честно сообщают, что список пока недоступен.
  // Частичное сообщение: трогаем только присланное.
  applyCosPayload(youCos, msg, 'patch');
  if (msg?.titleMask !== undefined) youTitleMask = Number(msg.titleMask) || 0;
  if (msg?.titleId !== undefined) youTitleId = Math.max(0, Math.min(COS_TITLE_MAX, Number(msg.titleId) || 0));
  /* C3: прогресс по незакрытым ачивкам. Массив содержит ТОЛЬКО закрытые ещё
     ачивки — открытые сервер опускает, они и так видны по titleMask. Поле
     может отсутствовать (старый сервер) — тогда карту не трогаем вовсе,
     чтобы не стереть уже показанный прогресс. */
  if (Array.isArray(msg?.achvProgress)) {
    achvProgressById.clear();
    for (const it of msg.achvProgress) {
      const id = Number(it?.id);
      const cur = Number(it?.cur);
      const max = Number(it?.max);
      if (!Number.isFinite(id) || id < 0) continue;
      if (!Number.isFinite(max) || max <= 0) continue;
      achvProgressById.set(id, {
        cur: Math.max(0, Math.min(max, Number.isFinite(cur) ? cur : 0)),
        max,
      });
    }
  }
  // Базовый вариант всегда доступен — иначе магазин выглядит полностью пустым.
  youCos.inv.terr |= 1;
  youCos.inv.death |= 1;

  cosmeticsCacheSave();

  // C4: report the purchase that just landed.
  const pending = pendingCosmeticsOp;
  cosmeticsOpClear();

  if (hadServerState) {
    const nextInv = {
      capturefx: Number(youCos.inv.capturefx) || 0,
      head: Number(youCos.inv.head) || 0,
      seg: Number(youCos.inv.seg) || 0,
      nameplate: Number(youCos.inv.nameplate) || 0,
      frame: Number(youCos.inv.frame) || 0,
      terr: Number(youCos.inv.terr) || 0,
      death: Number(youCos.inv.death) || 0
    };
    let boughtCat = '';
    let boughtId = -1;
    for (const cat of Object.keys(nextInv)) {
      const added = nextInv[cat] & ~prevInv[cat];
      if (!added) continue;
      for (let id = 0; id <= COSMETICS_MAX_ID; id++) {
        if (added & (1 << id)) {
          boughtCat = cat;
          boughtId = id;
          break;
        }
      }
      if (boughtCat) break;
    }
    if (!boughtCat && pending) {
      // Server confirmed but nothing new appeared (already owned).
      boughtCat = '';
    }
    if (boughtCat) {
      const bc = boughtCat;
      const bi = boughtId;
      const boughtText = () => `${t('cosmetics.bought_prefix')}: ${cosmeticsLabel(bc)} — ${cosmeticsVariantName(bc, bi)}`;
      setCosmeticsStatus(boughtText, 'success');
      addToast('✨', boughtText(), null);
      playBeep(880, 150, 0.9);
    } else if (pending) {
      setCosmeticsStatus('', '');
    }
  } else if (cosmeticsOpen) {
    // Магазин был открыт ещё без серверного подтверждения (см. showCosmeticsOverlay)
    // и статус-строка застыла на «не подтверждено» — теперь оно пришло, гасим подсказку.
    setCosmeticsStatus('', '');
  }

  cosmeticsApplyDesiredServer();

  syncCosmeticsUi();

  renderMetaHud();
  // C3: инвентарь/экипировка обновились — перерисовываем «Ваш облик».
  try {
    renderMenuSkinPreview();
  } catch {}
}

/* Модель «желаемой» экипировки — в client_cos_desired.js вместе с тестами.
   Здесь остаётся только подстановка хранилища. */
function cosmeticsSetDesiredEq(cat, id) {
  setDesired(localStorage, cat, id);
}

/* Применить сохранённый выбор к серверу. Решение «что кому отправить»
   принимает planDesiredApply в client_cos_desired.js — здесь только отправка
   и разговор с игроком. Раньше соответствие «категория -> поле» было выписано
   тут семью строками подряд, дублируя такую же цепочку в записи выбора. */
function cosmeticsApplyDesiredServer() {
  if (cosmeticsSource !== 'server') return;

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
let cosmeticsStatusSrc = '';
let cosmeticsStatusKind = '';

function setCosmeticsStatus(text, kind) {
  cosmeticsStatusSrc = typeof text === 'function' ? text : String(text || '');
  cosmeticsStatusKind = String(kind || '');
  renderCosmeticsStatus();
}

// Перерисовать статус из сохранённого источника (вызывается из setLang).
function renderCosmeticsStatus() {
  let text = cosmeticsStatusSrc;
  if (typeof text === 'function') {
    try {
      text = text();
    } catch {
      text = '';
    }
  }
  const kind = cosmeticsStatusKind;
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
function cosmeticsOpBegin(cat, id) {
  pendingCosmeticsOp = { cat: String(cat || ''), id: Number(id) || 0, at: Date.now() };
  if (cosmeticsOpTimer) {
    try {
      clearTimeout(cosmeticsOpTimer);
    } catch {}
    cosmeticsOpTimer = 0;
  }
  cosmeticsOpTimer = setTimeout(() => {
    cosmeticsOpTimer = 0;
    if (!pendingCosmeticsOp) return;
    pendingCosmeticsOp = null;
    setCosmeticsStatus(() => t('cosmetics.op_timeout'), 'error');
    syncCosmeticsUi();
  }, 5000);
}

function cosmeticsOpClear() {
  pendingCosmeticsOp = null;
  if (cosmeticsOpTimer) {
    try {
      clearTimeout(cosmeticsOpTimer);
    } catch {}
    cosmeticsOpTimer = 0;
  }
}

function cosmeticsOpIsPending(cat, id) {
  if (!pendingCosmeticsOp) return false;
  return pendingCosmeticsOp.cat === cat && Number(pendingCosmeticsOp.id) === Number(id);
}

/* Показ/скрытие/анимация оверлея — DOM-обвязка магазина в client_shop_ui.js. */
function showCosmeticsOverlay() {
  showCosmeticsOverlayImpl(shopUiDeps());
}

function hideCosmeticsOverlay() {
  hideCosmeticsOverlayImpl(shopUiDeps());
}

function scheduleCosmeticsPreviewAnim() {
  scheduleCosmeticsPreviewAnimImpl(shopUiDeps());
}

/* COSMETICS_MAX_ID, COSMETICS_CATS, запасной прайс, bitHas и лестница тиров
   переехали в client_cos_model.js — там же тесты на цены и владение. */
// Порядок вкладок магазина: сверху то, что занимает больше всего экрана.
const COSMETICS_TABS = [...COSMETICS_CATS, 'title'];

/* Обе функции раньше были цепочками из семи if, заканчивавшимися
   `return youCosEqFrame`. На НЕизвестной категории они молча отдавали данные
   рамок — из-за этого вкладка титулов открывалась с выбором, указывающим на
   id надетой рамки: 'title' не покупается, в цепочке его нет.
   Теперь неизвестная категория честно даёт 0. */
function cosmeticsMaskForCat(cat) {
  return invOf(youCos, cat);
}

function cosmeticsEqForCat(cat) {
  return eqOf(youCos, cat);
}

function cosmeticsTierLabel(tier) {
  return t(`cosmetics.tier_${String(tier || 'base')}`) || String(tier || '');
}

// Самый дешёвый платный предмет во всём магазине — крючок «до первого скина».
function cosmeticsCheapestPrice() {
  return cheapestPrice(cosmeticsPrices);
}

function cosmeticsOwnedCount(cat) {
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
const COSMETICS_TAB_ICON_BY_CAT = {
  terr: '🟩',
  seg: '〰️',
  head: '⚪',
  death: '💀',
  capturefx: '✨',
  nameplate: '🏷️',
  frame: '🖼️',
  title: '🏅'
};

function cosmeticsLabel(cat) {
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

function cosmeticsVariantName(cat, id) {
  const i = Math.max(0, Math.min(COSMETICS_MAX_ID, Number(id) || 0));
  if (cat === 'title') return cosTitleName(id) || t('cosmetics.title_none');
  const names = COSMETICS_VARIANT_NAMES_BY_CAT[cat];
  if (!names) return String(i + 1);
  return names[lang === 'en' ? 'en' : 'ru'][i];
}

/* --- Титулы в магазине -----------------------------------------------------
   Отдельная вкладка: покупать нечего, поэтому вместо цены — условие открытия,
   а вместо «Купить» — «Надеть». Отправка идёт сообщением `titleEquip`. */

function cosTitleUnlocked(id) {
  const i = Math.max(0, Math.min(COS_TITLE_MAX, Number(id) || 0));
  if (i === 0) return true;
  return (Number(youTitleMask) & (1 << i)) !== 0;
}

/* C3: прогресс к титулу. Возвращает {frac, cur, max} либо null, если данных
   нет. Открытый титул — {frac:1}, без счётчика: сервер не присылает прогресс
   по уже закрытым ачивкам, и придумывать «10/10» было бы враньём. */
function cosTitleProgress(id) {
  const i = Math.max(0, Math.min(COS_TITLE_MAX, Number(id) || 0));
  if (i === 0) return null;
  if (cosTitleUnlocked(i)) return { frac: 1, cur: 0, max: 0 };
  const achv = cosTitleAchvById.get(i);
  if (achv == null) return null;
  const p = achvProgressById.get(achv);
  if (!p || !(p.max > 0)) return null;
  return { frac: Math.max(0, Math.min(1, p.cur / p.max)), cur: p.cur, max: p.max };
}

/* C3: «37/100», «0/100 000» — разряды через УЗКИЙ НЕРАЗРЫВНЫЙ пробел (U+202F).
   Сама группировка и константа разделителя — в client_format.js. */
function cosFormatCount(n) {
  return formatGroupedCount(n);
}

function cosTitlesUnlockedCount() {
  let n = 0;
  for (let i = 1; i <= COS_TITLE_MAX; i++) {
    if (cosTitleUnlocked(i)) n++;
  }
  return n;
}

function cosTitleEquip(id) {
  const i = Math.max(0, Math.min(COS_TITLE_MAX, Number(id) || 0));
  if (!cosTitleUnlocked(i)) return;
  youTitleId = i;
  if (you) {
    if (i) cosTitleByPlayer.set(you, i);
    else cosTitleByPlayer.delete(you);
  }
  cosmeticsCacheSave();
  if (!wsSend('titleEquip', { id: i })) {
    setCosmeticsStatus(() => (wsIsConnected() ? t('cosmetics.unconfirmed_hint') : t('cosmetics.no_connection')), 'info');
  }
  syncCosmeticsUi();
}

function renderCosmeticsTitles() {
  if (!cosmeticsItemsEl) return;
  const items = [];

  const hint = document.createElement('div');
  hint.className = `cosmeticsTierSep ${tierClass()}`;
  hint.textContent = t('cosmetics.title_free_hint');
  items.push(hint);

  if (!youTitleMask && cosmeticsSource !== 'server') {
    const note = document.createElement('div');
    note.className = 'cosmeticsItemWhere';
    note.textContent = t('cosmetics.titles_unavailable');
    items.push(note);
  }

  for (let id = 0; id <= COS_TITLE_MAX; id++) {
    const unlocked = cosTitleUnlocked(id);
    const worn = Number(youTitleId) === id;
    if (cosmeticsFilter === 'owned' && !unlocked) continue;
    if (cosmeticsFilter === 'available' && unlocked) continue;

    // Разметка карточки титула согласована с вёрсткой (.titleItem): медаль
    // вместо превью-канваса, условие получения вместо цены, никакой валюты.
    const card = document.createElement('div');
    card.className = 'titleItem' + (cosmeticsSelId === id ? ' isSelected' : '');
    // K7: тот же приём, что и для карточек предметов — выбор не пересобирает
    // список и не роняет фокус.
    card.dataset.cosid = String(id);
    card.classList.toggle('isUnlocked', unlocked);
    card.classList.toggle('isEquipped', worn);
    card.classList.toggle('isLocked', !unlocked);
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.addEventListener('click', () => {
      cosmeticsSelectItem(id);
    });
    // Фокус с клавиатуры равен выбору: Tab по списку сразу меняет превью.
    card.addEventListener('focus', () => cosmeticsSelectItem(id));

    const medal = document.createElement('span');
    medal.className = 'titleMedal';
    medal.setAttribute('aria-hidden', 'true');
    medal.textContent = id === 0 ? '—' : '🏅';

    const left = document.createElement('div');
    left.className = 'titleItemLeft';

    const nameEl = document.createElement('div');
    nameEl.className = 'titleName';
    nameEl.textContent = id === 0 ? t('cosmetics.title_none') : `«${cosTitleName(id)}»`;
    left.appendChild(nameEl);

    if (unlocked) {
      const desc = document.createElement('div');
      desc.className = 'titleDesc';
      desc.textContent =
        id === 0 ? t('cosmetics.title_none_desc') : `${t('cosmetics.title_earned_for')}: ${cosTitleReq(id)}`;
      left.appendChild(desc);
    } else {
      const req = document.createElement('div');
      req.className = 'titleReq';
      req.textContent = cosTitleReq(id) || t('cosmetics.title_locked');
      left.appendChild(req);
    }

    /* C3: реальный прогресс к ачивке. Сервер присылает накопленные счётчики
       в `cosmetics.achvProgress` (только по НЕ открытым ачивкам). У открытого
       титула счётчика нет — там полная полоса без подписи. Если сервер старый
       или связка «титул → ачивка» не пришла, cosTitleProgress() вернёт null и
       блок просто не рисуется, как и раньше. */
    const prog = cosTitleProgress(id);
    if (prog != null) {
      const row = document.createElement('div');
      row.className = 'cosmeticsProgressRow';
      const bar = document.createElement('div');
      bar.className = 'cosmeticsItemProgress';
      const fill = document.createElement('span');
      fill.style.width = `${Math.round(Math.max(0, Math.min(1, prog.frac)) * 100)}%`;
      bar.appendChild(fill);
      row.appendChild(bar);
      if (prog.max > 0) {
        const lab = document.createElement('span');
        lab.className = 'cosmeticsItemProgressLabel';
        lab.textContent = tfmt('cosmetics.progress_of', {
          cur: cosFormatCount(prog.cur),
          max: cosFormatCount(prog.max),
        });
        row.appendChild(lab);
      }
      left.appendChild(row);
    }

    const right = document.createElement('div');
    right.className = 'titleItemRight';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btnSecondary';
    if (!unlocked) {
      btn.disabled = true;
      btn.textContent = t('cosmetics.locked');
    } else if (worn) {
      btn.disabled = true;
      btn.textContent = t('cosmetics.title_equipped');
    } else {
      btn.textContent = t('cosmetics.wear');
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        cosTitleEquip(id);
      });
    }
    right.appendChild(btn);

    card.appendChild(medal);
    card.appendChild(left);
    card.appendChild(right);
    items.push(card);
  }

  // Контейнер несёт --title-accent для вкладки титулов (см. .cosmeticsItems.isTitles).
  cosmeticsItemsEl.classList.add('isTitles');

  if (items.length <= 1) {
    setSafeHtml(
      cosmeticsItemsEl,
      `
      <div class="roomsEmpty">
        <div class="roomsEmptyTitle">${escapeHtml(t('cosmetics.empty_title'))}</div>
        <div class="roomsEmptyDesc">${escapeHtml(t('cosmetics.empty_desc'))}</div>
      </div>
      `
    );
    return;
  }
  cosmeticsItemsEl.replaceChildren(...items);
}

function cosmeticsSetFilter(next) {
  const v = String(next || 'all');
  if (v !== 'all' && v !== 'owned' && v !== 'available') return;
  cosmeticsFilter = v;
  syncCosmeticsUi();
}

// C15: only the price here — the balance already lives in the shop header.
function cosmeticsFormatCost(price) {
  const p = Math.max(0, Number(price) || 0);
  const pTxt = escapeHtml(fmtInt(p));
  const unit = escapeHtml(t('cosmetics.style_points'));
  return `<span class="num">${pTxt}</span> ${unit}`;
}

// C7: keep the shop in sync whenever the currency balance changes.
function setYouStyle(v) {
  const next = Math.max(0, Math.floor(Number(v) || 0));
  if (next === youStyle) return;
  youStyle = next;
  try {
    cosmeticsCacheSave();
  } catch {}
  if (cosmeticsOpen) {
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
    style: Math.max(0, Math.floor(Number(youStyle) || 0)),
    // Имена полей выводит cosPayloadOf из того же соответствия, по которому
    // разбирается сообщение сервера: разъехаться они не могут.
    ...cosPayloadOf(youCos),
    titleId: Number(youTitleId) || 0,
    titleMask: Number(youTitleMask) || 0
  };
}

function cosmeticsApplyStateObject(s) {
  if (!s || typeof s !== 'object') return;
  // C3: the balance is part of the cache, otherwise the shop always shows 0 before a match.
  const st = Number(s.style);
  if (Number.isFinite(st)) youStyle = Math.max(0, Math.floor(st));
  applyCosPayload(youCos, s, 'replace');
  youTitleId = Number(s.titleId) || 0;
  youTitleMask = Number(s.titleMask) || 0;
}

function cosmeticsCacheLoad() {
  try {
    const raw = localStorage.getItem(COSMETICS_CACHE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object') return null;
    return s;
  } catch {
    return null;
  }
}

function cosmeticsCacheSave() {
  try {
    localStorage.setItem(COSMETICS_CACHE_KEY, JSON.stringify(cosmeticsGetStateObject()));
  } catch {}
}

function cosmeticsEnsureLocalReady() {
  if (cosmeticsLoaded) return;
  const cached = cosmeticsCacheLoad();
  if (cached) {
    cosmeticsApplyStateObject(cached);
  } else {
    youStyle = 0;
    youTitleId = 0;
    youTitleMask = 0;
    // Без кэша: базовый вариант (id 0) есть у всех и он же надет.
    for (const cat of COS_STATE_CATS) {
      youCos.inv[cat] = 1;
      youCos.eq[cat] = 0;
    }
  }
  cosmeticsSource = 'cache';
  cosmeticsLoaded = true;
}

// C2: purchases work outside a room (profile-scoped on the server), so `started`
// must not gate the shop. What we do need is a live socket and server-confirmed state.
function cosmeticsServerReady() {
  return wsIsConnected() && cosmeticsSource === 'server';
}

function cosmeticsBuyLocal(cat, id) {
  // C1/C2: no server -> explain why the purchase cannot go through, inside the overlay.
  setCosmeticsStatus(() => (wsIsConnected() ? t('cosmetics.unconfirmed_hint') : t('cosmetics.no_connection')), 'error');
}

function cosmeticsEquipLocal(cat, id) {
  const c = String(cat || '').trim().toLowerCase();
  const itemId = cosClampId(id);
  const bit = 1 << itemId;
  const mask = cosmeticsMaskForCat(c);
  if ((mask & bit) === 0) return;
  cosEquip(youCos, c, itemId);
  if (you) {
    if (c === 'terr') cosTerrByPlayer.set(you, itemId);
    if (c === 'death') cosDeathByPlayer.set(you, itemId);
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
  if (!menuSkinPreviewEl) return false;
  if (!menuOverlay || menuOverlay.classList.contains('hidden')) return false;
  // Панель может быть скрыта по ширине экрана — тогда рисовать нечего.
  return menuSkinPreviewEl.clientWidth > 0 && menuSkinPreviewEl.clientHeight > 0;
}

function renderMenuSkinPreview() {
  if (!menuSkinPreviewVisible()) return;
  const cssW = Math.max(180, Math.round(menuSkinPreviewEl.clientWidth || 320));
  const cssH = Math.max(120, Math.round(menuSkinPreviewEl.clientHeight || 200));
  // DPR учитывается внутри cosPrepCanvas — тот же путь, что и у превью магазина.
  const c = cosPrepCanvas(menuSkinPreviewEl, cssW, cssH);
  if (!c) return;

  const reduceMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const now = reduceMotion ? 0 : performance.now();

  // Ник берём живой: storedName снимается один раз при загрузке модуля и
  // отстаёт, если игрок только что поменял имя в поле рядом.
  const liveName = (menuNameInput?.value || '').trim() || nameById.get(you) || storedName;

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
      label: `${cosTitlePrefix(youTitleId)}${liveName || t('cosmetics.balance_you')}`,
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
    },
    shopUiDeps()
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

function scheduleMenuSkinPreview() {
  if (!menuSkinPreviewVisible()) return;
  try {
    renderMenuSkinPreview();
  } catch {}
  if (menuSkinAnimRaf) return;
  const reduceMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  if (reduceMotion) return;
  menuSkinAnimRaf = requestAnimationFrame(menuSkinPreviewTick);
}

function stopMenuSkinPreview() {
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
if (menuSkinPreviewEl && typeof ResizeObserver === 'function') {
  try {
    new ResizeObserver(() => {
      if (menuSkinAnimRaf) return;
      scheduleMenuSkinPreview();
    }).observe(menuSkinPreviewEl);
  } catch {}
}

const DIR_NAMES = ['up', 'down', 'left', 'right'];

function infoName(map, type, fallback) {
  const it = map && map[type];
  return it?.name || fallback || '';
}

function infoDesc(map, type, fallback) {
  const it = map && map[type];
  return it?.desc || fallback || '';
}

function powerupLabel(type) {
  const p = infoPack();
  return infoName(p.powerups, type, t('name.item_fallback'));
}

function mutatorLabel(type) {
  const p = infoPack();
  return infoName(p.mutators, type, '');
}

function contractLabel(type) {
  const p = infoPack();
  return infoName(p.contracts, type, '');
}

function dailyLabel(type) {
  const p = infoPack();
  return infoName(p.dailies, type, t('name.daily_fallback'));
}

function achvLabel(type) {
  const p = infoPack();
  return infoName(p.achv, type, lang === 'en' ? `Achievement ${type}` : `Достижение ${type}`);
}

function styleLabel(type) {
  const p = infoPack();
  return infoName(p.style, type, p.labels.style);
}

// J19: мелкие начисления Стиля агрегируются в один тост «+N Стиля ×3».
function flushStyleToast() {
  styleToastTimer = 0;
  const delta = styleToastAcc;
  if (!delta) return;
  const reason = styleToastReason;
  const count = Math.max(1, styleToastCount);
  styleToastAcc = 0;
  styleToastReason = 0;
  styleToastCount = 0;
  const suffix = count > 1 ? ` ×${count}` : '';
  addToast('✨', `+${delta} ${t('cosmetics.style_points')}${suffix}`, null, styleLabel(reason), {
    tab: 'match',
    key: `style_small_${reason}`,
    prio: 'minor'
  });
}

/* Обратный отсчёт: арифметика — в client_format.js, здесь только чтение
   состояния (tickMs, последний известный тик и когда он пришёл). */
function approxNowTick() {
  return approxTickNow({ tickMs, lastEventsTick, lastEventsAt, nowMs: Date.now() });
}

function formatTickRemain(untilTick) {
  return formatRemainMs(remainMsToTick(untilTick, approxNowTick(), tickMs));
}

function tickRemainSeconds(untilTick) {
  const ms = remainMsToTick(untilTick, approxNowTick(), tickMs);
  return ms == null ? null : ms / 1000;
}

function ensureSettingsState() {
  try {
    const raw = localStorage.getItem('snakes_settings_v1');
    if (raw) {
      const s = JSON.parse(raw);
      fxEnabled = s.fxEnabled ?? fxEnabled;
      fxIntensity = s.fxIntensity ?? fxIntensity;
      shakeIntensity = s.shakeIntensity ?? shakeIntensity;
      perfEnabled = s.perfEnabled ?? perfEnabled;
      perfCompact = s.perfCompact ?? perfCompact;
      soundEnabled = s.soundEnabled ?? soundEnabled;
      soundVolume = s.soundVolume ?? soundVolume;
      muteOnBlur = s.muteOnBlur ?? muteOnBlur;
      hapticsEnabled = s.hapticsEnabled ?? hapticsEnabled;
      hudBrightness = s.hudBrightness ?? hudBrightness;
      hudContrast = s.hudContrast ?? hudContrast;
      hudPanelOpacity = s.hudPanelOpacity ?? hudPanelOpacity;
      const p = normalizeFxPreset(s.fxPreset);
      if (p) {
        fxPreset = p;
        fxPresetUserSet = !!s.fxPresetUserSet;
      }
    }
  } catch {}

  // J22: без явного выбора пользователя уважаем системный запрет анимаций.
  if (!fxPresetUserSet && prefersReducedMotion()) fxPreset = 'calm';
  applyFxPreset(fxPreset, false);

  if (fxEnabledInput) fxEnabledInput.checked = !!fxEnabled;
  if (fxIntensityInput) fxIntensityInput.value = String(fxIntensity);
  if (shakeIntensityInput) shakeIntensityInput.value = String(shakeIntensity);
  if (perfEnabledInput) perfEnabledInput.checked = !!perfEnabled;
  if (perfCompactInput) perfCompactInput.checked = !!perfCompact;
  if (soundEnabledInput) soundEnabledInput.checked = !!soundEnabled;
  if (soundVolumeInput) soundVolumeInput.value = String(soundVolume);
  if (muteOnBlurInput) muteOnBlurInput.checked = !!muteOnBlur;
  if (hapticsInput) hapticsInput.checked = !!hapticsEnabled;
  if (hudBrightnessInput) hudBrightnessInput.value = String(hudBrightness);
  if (hudContrastInput) hudContrastInput.value = String(hudContrast);
  if (hudPanelOpacityInput) hudPanelOpacityInput.value = String(hudPanelOpacity);

  syncHapticsRowUi();

  if (perfEl) perfEl.style.display = perfEnabled ? '' : 'none';
  applyPerfUi();
  applyHudSettings();

  applyHudDensity(getHudDensityDefault());
}

function saveSettingsState() {
  try {
    localStorage.setItem(
      'snakes_settings_v1',
      JSON.stringify({
        fxEnabled,
        fxIntensity,
        shakeIntensity,
        perfEnabled,
        perfCompact,
        soundEnabled,
        soundVolume,
        muteOnBlur,
        hapticsEnabled,
        hudBrightness,
        hudContrast,
        hudPanelOpacity,
        fxPreset,
        fxPresetUserSet
      })
    );
  } catch {}
}

function resetSettingsState() {
  fxEnabled = true;
  fxIntensity = 0.85;
  shakeIntensity = 0.55;
  perfEnabled = false;
  perfCompact = false;
  soundEnabled = true;
  soundVolume = 0.7;
  muteOnBlur = true;
  hapticsEnabled = true;
  hudBrightness = 1;
  hudContrast = 1;
  hudPanelOpacity = 0.82;
  soundMutedByBlur = false;
  fxPresetUserSet = false;
  applyFxPreset(prefersReducedMotion() ? 'calm' : 'normal', false);

  if (fxEnabledInput) fxEnabledInput.checked = !!fxEnabled;
  if (fxIntensityInput) fxIntensityInput.value = String(fxIntensity);
  if (shakeIntensityInput) shakeIntensityInput.value = String(shakeIntensity);
  if (perfEnabledInput) perfEnabledInput.checked = !!perfEnabled;
  if (perfCompactInput) perfCompactInput.checked = !!perfCompact;
  if (soundEnabledInput) soundEnabledInput.checked = !!soundEnabled;
  if (soundVolumeInput) soundVolumeInput.value = String(soundVolume);
  if (muteOnBlurInput) muteOnBlurInput.checked = !!muteOnBlur;
  if (hapticsInput) hapticsInput.checked = !!hapticsEnabled;
  if (hudBrightnessInput) hudBrightnessInput.value = String(hudBrightness);
  if (hudContrastInput) hudContrastInput.value = String(hudContrast);
  if (hudPanelOpacityInput) hudPanelOpacityInput.value = String(hudPanelOpacity);

  if (perfEl) perfEl.style.display = perfEnabled ? '' : 'none';
  applyPerfUi();
  applyHudSettings();
  saveSettingsState();
}

function showSettingsOverlay() {
  if (settingsOverlay) settingsOverlay.classList.remove('hidden');
  overlayManager.open('settings');
  syncOverlayUiState();
  overlayManager.focusDefault('settings');
}

function hideSettingsOverlay() {
  if (settingsOverlay) settingsOverlay.classList.add('hidden');
  overlayManager.close('settings');
  syncOverlayUiState();
}

// J22: тумблер пресета. Разметку добавляет вёрсточный агент (#fxPresetSelect);
// пока её нет — создаём поле сами, чтобы настройка была доступна.
function ensureFxPresetControl() {
  let sel = document.getElementById('fxPresetSelect');
  if (!sel) {
    const anchor = fxEnabledInput?.closest?.('.fieldInline') || null;
    const host = anchor?.parentElement || null;
    if (!host) return null;
    try {
      const label = document.createElement('label');
      label.className = 'fieldInline';
      const span = document.createElement('span');
      span.className = 'fieldLabel';
      span.setAttribute('data-i18n', 'settings.fx_preset');
      span.textContent = t('settings.fx_preset');
      sel = document.createElement('select');
      sel.id = 'fxPresetSelect';
      label.appendChild(span);
      label.appendChild(sel);

      const hint = document.createElement('div');
      hint.className = 'fieldHint';
      hint.setAttribute('data-i18n', 'settings.fx_preset_hint');
      hint.textContent = t('settings.fx_preset_hint');

      host.insertBefore(label, anchor);
      host.insertBefore(hint, anchor);
    } catch {
      return null;
    }
  }

  try {
    const opts = [
      ['calm', t('settings.fx_preset_calm')],
      ['normal', t('settings.fx_preset_normal')],
      ['casino', t('settings.fx_preset_casino')]
    ];
    const need = sel.options?.length !== opts.length;
    if (need) sel.replaceChildren();
    for (let i = 0; i < opts.length; i++) {
      let op = sel.options?.[i];
      if (!op) {
        op = document.createElement('option');
        sel.appendChild(op);
      }
      op.value = opts[i][0];
      op.textContent = opts[i][1];
    }
    sel.value = fxPreset;
  } catch {}
  return sel;
}

function bindSettingsUi() {
  ensureSettingsState();

  const fxPresetSelect = ensureFxPresetControl();
  fxPresetSelect?.addEventListener('change', () => {
    applyFxPreset(fxPresetSelect.value, true);
    saveSettingsState();
    sfx.ui();
  });

  settingsBtn?.addEventListener('click', () => {
    showSettingsOverlay();
  });
  closeSettingsBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    hideSettingsOverlay();
  });

  settingsOverlay?.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) {
      hideSettingsOverlay();
    }
  });

  fxEnabledInput?.addEventListener('change', () => {
    fxEnabled = !!fxEnabledInput.checked;
    saveSettingsState();
  });
  fxIntensityInput?.addEventListener('input', () => {
    fxIntensity = Math.max(0, Math.min(1, Number(fxIntensityInput.value) || 0));
    saveSettingsState();
  });
  shakeIntensityInput?.addEventListener('input', () => {
    shakeIntensity = Math.max(0, Math.min(1, Number(shakeIntensityInput.value) || 0));
    saveSettingsState();
  });
  perfEnabledInput?.addEventListener('change', () => {
    perfEnabled = !!perfEnabledInput.checked;
    if (perfEl) perfEl.style.display = perfEnabled ? '' : 'none';
    saveSettingsState();
  });
  perfCompactInput?.addEventListener('change', () => {
    perfCompact = !!perfCompactInput.checked;
    applyPerfUi();
    saveSettingsState();
  });
  soundEnabledInput?.addEventListener('change', () => {
    soundEnabled = !!soundEnabledInput.checked;
    saveSettingsState();
  });
  soundVolumeInput?.addEventListener('input', () => {
    soundVolume = Math.max(0, Math.min(1, Number(soundVolumeInput.value) || 0));
    saveSettingsState();
  });

  muteOnBlurInput?.addEventListener('change', () => {
    muteOnBlur = !!muteOnBlurInput.checked;
    if (!muteOnBlur) soundMutedByBlur = false;
    saveSettingsState();
  });

  hapticsInput?.addEventListener('change', () => {
    hapticsEnabled = !!hapticsInput.checked;
    saveSettingsState();
    // Отклик на сам переключатель: игрок сразу чувствует, что именно включил.
    if (hapticsEnabled) vibrate(30);
  });

  hudBrightnessInput?.addEventListener('input', () => {
    hudBrightness = Math.max(0.5, Math.min(2, Number(hudBrightnessInput.value) || 1));
    applyHudSettings();
    saveSettingsState();
  });
  hudContrastInput?.addEventListener('input', () => {
    hudContrast = Math.max(0.5, Math.min(2, Number(hudContrastInput.value) || 1));
    applyHudSettings();
    saveSettingsState();
  });
  hudPanelOpacityInput?.addEventListener('input', () => {
    hudPanelOpacity = Math.max(0.3, Math.min(1, Number(hudPanelOpacityInput.value) || 0.82));
    applyHudSettings();
    saveSettingsState();
  });

  testBeepBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    playBeep(660, 120, 1);
  });

  resetSettingsBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    resetSettingsState();
  });

  window.addEventListener('blur', () => {
    if (!muteOnBlur) return;
    soundMutedByBlur = true;
  });
  window.addEventListener('focus', () => {
    soundMutedByBlur = false;
  });
}

/* Общий набор геттеров/сеттеров и ссылок для DOM-функций магазина в
   client_shop_ui.js. Построен как функция (не как объект один раз), потому
   что часть переменных состояния (cosmeticsCat, cosmeticsSelId и т.д.)
   переприсваивается — деп должен читать/писать их актуальные значения. */
function shopUiDeps() {
  return {
    // DOM-узлы
    cosmeticsOverlay,
    cosmeticsEarnStyleEl,
    cosmeticsTabsEl,
    cosmeticsItemsEl,
    cosmeticsHintEl,
    cosmeticsWhereEl,
    cosmeticsPreview,
    cosmeticsStyleEl,
    cosmeticsFilterAllBtn,
    cosmeticsFilterOwnedBtn,
    cosmeticsFilterAvailableBtn,
    overlayManager,
    // Геттеры/сеттеры изменяемого состояния client.js
    getCosmeticsLoaded: () => cosmeticsLoaded,
    getCosmeticsSource: () => cosmeticsSource,
    getCosmeticsOpen: () => cosmeticsOpen,
    setCosmeticsOpen: (v) => { cosmeticsOpen = v; },
    getCosmeticsCat: () => cosmeticsCat,
    setCosmeticsCat: (v) => { cosmeticsCat = v; },
    getCosmeticsSelId: () => cosmeticsSelId,
    setCosmeticsSelId: (v) => { cosmeticsSelId = v; },
    getCosmeticsFilter: () => cosmeticsFilter,
    getCosmeticsEarnExpanded: () => cosmeticsEarnExpanded,
    setCosmeticsEarnExpanded: (v) => { cosmeticsEarnExpanded = v; },
    getCosmeticsTabsScrolledCat: () => cosmeticsTabsScrolledCat,
    setCosmeticsTabsScrolledCat: (v) => { cosmeticsTabsScrolledCat = v; },
    getCosmeticsPreviewRaf: () => cosmeticsPreviewRaf,
    setCosmeticsPreviewRaf: (v) => { cosmeticsPreviewRaf = v; },
    getCosmeticsPreviewLastAt: () => cosmeticsPreviewLastAt,
    setCosmeticsPreviewLastAt: (v) => { cosmeticsPreviewLastAt = v; },
    getYouStyle: () => youStyle,
    getYouTitleId: () => youTitleId,
    getPendingCosmeticsOp: () => pendingCosmeticsOp,
    youCos,
    // Функции/таблицы, общие с остальным client.js
    t,
    tfmt,
    fmtInt,
    escapeHtml,
    setSafeHtml,
    cosTitlePrefix,
    cosmeticsEnsureLocalReady,
    cosmeticsServerReady,
    cosmeticsBuyLocal,
    cosmeticsEquipLocal,
    cosmeticsSetDesiredEq,
    cosmeticsOpBegin,
    cosmeticsOpClear,
    cosmeticsOpIsPending,
    setCosmeticsStatus,
    wsIsConnected,
    wsSend,
    syncOverlayUiState,
    scheduleMenuSkinPreview,
    cosmeticsMaskForCat,
    cosmeticsEqForCat,
    cosmeticsLabel,
    cosmeticsVariantName,
    cosmeticsTierLabel,
    cosmeticsFormatCost,
    cosmeticsOwnedCount,
    renderCosmeticsTitles,
    cosTitlesUnlockedCount,
    tierClass,
    visibleItems,
    cosmeticsPrices,
    buyButtonState,
    equipButtonState,
    COSMETICS_TABS,
    COSMETICS_TAB_ICON_BY_CAT,
    COSMETICS_MAX_ID,
    COS_TITLE_MAX,
    cosClampId,
    colors,
    boostHsl,
    hslToRgb,
    you,
    drawTerrTile,
    drawTerrSeam,
    drawSegTile,
    drawHead,
    drawNamePlate,
    drawCaptureFx,
    drawDeathFx,
    drawFrameRow,
    COS_DEATH_MS,
    COS_FONT,
    cosPrepCanvas,
    syncCosmeticsUi,
    drawMiniCosmeticPreview: drawMiniCosmeticPreviewImpl
  };
}

/* Синхронизация списка/шапки/превью магазина и выбор предмета — DOM-обвязка
   в client_shop_ui.js. */
function syncCosmeticsUi() {
  syncCosmeticsUiImpl(shopUiDeps());
}

function cosmeticsSelectItem(id) {
  cosmeticsSelectItemImpl(id, shopUiDeps());
}

function bindCosmeticsUi() {
  cosmeticsBtn?.addEventListener('click', () => {
    showCosmeticsOverlay();
  });
  cosmeticsMenuBtn?.addEventListener('click', () => {
    showCosmeticsOverlay();
  });
  cosmeticsCloseBtn?.addEventListener('click', () => {
    hideCosmeticsOverlay();
  });
  cosmeticsOverlay?.addEventListener('click', (e) => {
    if (e.target === cosmeticsOverlay) {
      hideCosmeticsOverlay();
    }
  });

  cosmeticsStyleInfoBtn?.addEventListener('click', (e) => {
    e?.preventDefault?.();
    cosmeticsEarnExpanded = !cosmeticsEarnExpanded;
    syncCosmeticsUi();
    try {
      cosmeticsEarnStyleEl?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    } catch {}
  });

  cosmeticsFilterAllBtn?.addEventListener('click', () => cosmeticsSetFilter('all'));
  cosmeticsFilterOwnedBtn?.addEventListener('click', () => cosmeticsSetFilter('owned'));
  cosmeticsFilterAvailableBtn?.addEventListener('click', () => cosmeticsSetFilter('available'));
}

function addToast(icon, text, variant, subtext, action) {
  if (!eventToastsEl) return;
  const now = performance.now();
  let v = String(variant || '');
  if (v === 'big' && now < bigToastCooldownUntil) v = '';

  let st = subtext;
  let act = action;
  if (!act && st && typeof st === 'object') {
    act = st;
    st = '';
  }

  // J20: ключ не включает вариант. Раньше `v` даунгрейдился с 'big' на '' при
  // активном кулдауне, из-за чего одно событие получало два разных ключа и
  // вместо счётчика «x2» появлялся второй тост.
  const key = String(act?.key || `${String(icon || '')}|${String(text || '')}|${String(st || '')}`);
  const prio = String(act?.prio || (String(variant || '') === 'big' ? 'important' : 'minor'));

  const prev = toastByKey.get(key);
  if (prev && prev.el) {
    prev.at = now;
    prev.count = (prev.count || 1) + 1;
    if (toastPrioValue(prio) > toastPrioValue(prev.prio)) prev.prio = prio;
    try {
      const bt = String(prev.baseText || prev.text || '');
      if (prev.textEl) prev.textEl.textContent = `${bt} x${prev.count}`;
      toastBump(prev.el);
      if (prev.timer) clearTimeout(prev.timer);
      prev.timer = setTimeout(() => {
        try {
          prev.el?.remove?.();
        } catch {}
        toastByKey.delete(key);
        toastDrain();
      }, (prev.variant || v) === 'big' ? 8200 : 2200);
    } catch {}
    return;
  }

  if (prev && !prev.el) {
    prev.at = now;
    prev.count = (prev.count || 1) + 1;
    if (toastPrioValue(prio) > toastPrioValue(prev.prio)) prev.prio = prio;
    return;
  }

  const item = {
    key,
    icon,
    text: String(text || ''),
    baseText: String(text || ''),
    variant: v,
    prio,
    subtext: String(st || ''),
    action: act,
    at: now,
    count: 1,
    el: null,
    textEl: null,
    timer: 0,
  };

  toastByKey.set(key, item);
  if (eventToastsEl.children.length >= MAX_EVENT_TOASTS) {
    // J19: важное событие вытесняет самый незначительный тост на экране.
    const worst = toastLowestMounted();
    if (worst && toastPrioValue(item.prio) > toastPrioValue(worst.prio)) {
      toastUnmount(worst);
      toastMount(item);
      return;
    }
    toastQueue.push(key);
    return;
  }

  toastMount(item);
  return;
}

/* C6: порог, ниже которого ЧУЖОЙ захват в ленту не идёт. Домашний квадрат на
   старте — 9x9 = 81 клетка, типовая петля бота даёт 20-40; 48 отсекает
   рутину и оставляет заметные события. Свои захваты, киллы, баунти,
   контракты и ачивки фильтром не затрагиваются. */
const FEED_FOREIGN_CAPTURE_MIN = 48;

/* actorNum (необязательный) — номер игрока, чьё это событие. Нужен только
   для значка архетипа бота (C4); на текст и схлопывание не влияет. */
// K7/#8: флаг «киллфид нужно перерисовать» — гасится один раз в конце пакета
// разбора событий (handleStateBinary). Раньше выставлялся вручную следом за
// каждым pushEventFeed() в 12 разных ветках по kind — обе строки нужно было
// не забыть написать вместе, а забытая просто не роняла ничего видимо: текст
// уходил в eventFeed, но экран до следующего дёрнувшего дефолт-редрей пакета
// не перерисовывался. Теперь pushEventFeed() сама метит флаг на каждом пути,
// где feed реально меняется — новую ветку разбора протокола дублировать
// нечего, звать нужно только сам pushEventFeed().
let killfeedDirty = false;

function pushEventFeed(text, kind, actorNum) {
  const t = performance.now();
  const s = String(text || '').trim();
  if (!s) return;
  const k = String(kind || '');
  const a = Number.isFinite(Number(actorNum)) ? Number(actorNum) : null;
  /* C8: подряд идущие одинаковые строки читались как зависший лог. Схлопываем
     их в одну с множителем ×N (окно 10 с — дальше строка всё равно истечёт). */
  const head = eventFeed[0];
  if (head && head.text === s && head.k === k && t - head.t < 10000) {
    head.n = (head.n || 1) + 1;
    head.t = t;
    killfeedDirty = true;
    return;
  }
  /* UX15: однотипные события одного игрока подряд (например "захватил +N зоны")
     схлопываем в одну строку с суммой, а не плодим повторы — сравниваем текст
     без хвостового числа, чтобы разные +N всё равно объединялись. */
  if (head && head.k === k && head.a === a && a != null && t - head.t < 10000) {
    const m = /^(.*\+)(\d+)(\D*)$/.exec(s);
    const hm = head.text ? /^(.*\+)(\d+)(\D*)$/.exec(head.text) : null;
    if (m && hm && m[1] === hm[1] && m[3] === hm[3]) {
      head.text = `${hm[1]}${Number(hm[2]) + Number(m[2])}${hm[3]}`;
      head.t = t;
      killfeedDirty = true;
      return;
    }
  }
  eventFeed.unshift({ t, text: s, k, n: 1, a });
  if (eventFeed.length > 64) eventFeed.length = 64;
  killfeedDirty = true;
}

function renderKillfeed() {
  if (!killfeedEl) return;
  const now = performance.now();
  const small = window.innerWidth <= 720;
  const maxAge = small ? 8000 : 12000;
  const maxLines = small ? 4 : 6;
  const visible = eventFeed.filter((e) => now - e.t < maxAge).slice(0, maxLines);
  /* C8: замер до правки — 195 узлов за 12 с. Половина пересборок приходилась на
     пакеты, где видимый текст не менялся вообще: killfeedDirty выставляется на
     любое событие, а строк на экране всего 4-6. Сверяем подпись и не трогаем
     DOM, когда рисовать нечего нового. */
  // C4: значок бота входит в подпись — иначе приход cosExtra не перерисует ленту.
  const sig =
    visible.map((e) => `${e.k}${e.text}${e.n || 1}${botArchInfo(e.a) ? `b${e.a}` : ''}${e.a === you ? 'm' : ''}`).join('') + lang;
  if (renderKillfeed._sig === sig) return;
  renderKillfeed._sig = sig;

  const lines = visible.map((e) => {
    const div = document.createElement('div');
    const k = String(e?.k || '').trim();
    div.className = k ? `killLine killLine${k}` : 'killLine';
    // УХ31: отличаем свои события от чужих цветом левой полосы/фона.
    if (you && e?.a != null && Number(e.a) === you) div.classList.add('killLineMine');
    else if (e?.a != null) div.classList.add('killLineOther');
    // C8: множитель схлопнутых повторов.
    const rep = Number(e?.n) || 1;
    const txt = rep > 1 ? `${e.text} ×${rep}` : e.text;
    // C4: в килфиде колонка узкая — оставляем только глиф, без подписи архетипа.
    const badge = botArchBadge(e.a, { glyphOnly: true });
    if (badge) div.replaceChildren(badge, document.createTextNode(txt));
    else div.textContent = txt;
    return div;
  });
  killfeedEl.replaceChildren(...lines);

  try {
    if (rightEventsDetailsEl && !rightEventsDetailsEl.open && lines.length) {
      if (!renderKillfeed._u || now - renderKillfeed._u > 1200) {
        renderKillfeed._u = now;
        eventsUnreadCount = Math.min(999, eventsUnreadCount + 1);
        setBadgeCount(rightEventsBadgeEl, eventsUnreadCount);
      }
    }
  } catch {}
  try {
    syncRightEmptyStates();
  } catch {}
}

renderKillfeed._u = 0;

}

// ...

function handleStateBinary(buf) {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength < 1) return;
  markJoinFunnelFirstState();
  try {
    const dv = new DataView(buf);
    const bl = dv.byteLength;
    let o = 0;
    const msgType = dv.getUint8(o);
    o += 1;

  // ROI update: type(1)=2, tick(4), players, rx/ry/rw/rh, dg, dt
  if (msgType === 2) {
    if (o + 4 + 2 > bl) return;
    const tick = dv.getUint32(o, true);
    o += 4;
    const pc = dv.getUint16(o, true);
    o += 2;

    const [perPlayerV4, perPlayerV3, perPlayerV2] = PLAYER_RECORD_SIZES;
    const perPlayer = pickPlayerRecordSize(bl - o, pc);
    if (perPlayer === null) return;
    const players = [];
    for (let k = 0; k < pc; k++) {
      const n = dv.getUint16(o, true);
      o += 2;
      const x = dv.getUint16(o, true);
      o += 2;
      const y = dv.getUint16(o, true);
      o += 2;
      const d = dv.getUint8(o);
      o += 1;
      const a = dv.getUint8(o) === 1;
      o += 1;
      const s = dv.getUint16(o, true);
      o += 2;
      const p = dv.getUint16(o, true);
      o += 2;
      const hue = dv.getUint16(o, true);
      o += 2;
      let sh = 0;
      let bot = 0;
      let cosCaptureFx = 0;
      let cosHead = 0;
      let cosSeg = 0;
      let cosNameplate = 0;
      let cosFrame = 0;
      if (perPlayer === perPlayerV2 || perPlayer === perPlayerV3) {
        sh = dv.getUint8(o);
        o += 1;
      }
      if (perPlayer === perPlayerV4) {
        sh = dv.getUint8(o);
        o += 1;
      }
      if (perPlayer === perPlayerV4) {
        bot = dv.getUint8(o);
        o += 1;
      }
      if (perPlayer === perPlayerV3 || perPlayer === perPlayerV4) {
        cosCaptureFx = dv.getUint8(o);
        o += 1;
        cosHead = dv.getUint8(o);
        o += 1;
        cosSeg = dv.getUint8(o);
        o += 1;
        cosNameplate = dv.getUint8(o);
        o += 1;
        cosFrame = dv.getUint8(o);
        o += 1;
      }
      const c = hueToHsl(hue);
      if (bot) botIds.add(n);
      players.push({
        n,
        x,
        y,
        d: DIR_NAMES[d] || 'right',
        a,
        c,
        s,
        p,
        sh,
        cosCaptureFx,
        cosHead,
        cosSeg,
        cosNameplate,
        cosFrame,
        nm: displayNameOf(n, bot ? botDisplayName(n) : `${t('leaderboard.player')} ${n}`),
        b: 0
      });
    }
    const rx = dv.getUint16(o, true);
    o += 2;
    const ry = dv.getUint16(o, true);
    o += 2;
    const rw = dv.getUint16(o, true);
    o += 2;
    const rh = dv.getUint16(o, true);
    o += 2;
    const lenDG = dv.getUint32(o, true);
    o += 4;
    const lenDT = dv.getUint32(o, true);
    o += 4;
    if (o + lenDG + lenDT > bl) return;
    const dg = buf.slice(o, o + lenDG);
    o += lenDG;
    const dt = buf.slice(o, o + lenDT);
    onState({ full: false, tick, t: Date.now(), players, dg, dt, roi: { rx, ry, rw, rh } });
    return;
  }

  // Minimap chunks: type(1)=4, tick(4), cw(1), ch(1), count(2), chunks...
  if (msgType === 4) {
    if (o + 4 + 1 + 1 + 2 + 1 > bl) return;
    o += 4;
    const cw = dv.getUint8(o);
    o += 1;
    const ch = dv.getUint8(o);
    o += 1;
    if (!cw || !ch) return;
    const count = dv.getUint16(o, true);
    o += 2;
    const flags = dv.getUint8(o);
    o += 1;
    const hasTrail = (flags & 1) === 1;
    const chunkCells = cw * ch;
    for (let k = 0; k < count; k++) {
      const bytesChunk = 2 + chunkCells * 2 + (hasTrail ? chunkCells * 2 : 0);
      if (o + bytesChunk > bl) return;
      const cx = dv.getUint8(o);
      o += 1;
      const cy = dv.getUint8(o);
      o += 1;
      const x0 = cx * cw;
      const y0 = cy * ch;
      for (let n = 0; n < chunkCells; n++) {
        const v = dv.getUint16(o, true);
        o += 2;
        const xx = n % cw;
        const yy = (n / cw) | 0;
        const i = (y0 + yy) * W + (x0 + xx);
        if (i >= 0 && i < N && minimapGridOwner) minimapGridOwner[i] = v;
      }
      if (hasTrail) {
        for (let n = 0; n < chunkCells; n++) {
          o += 2;
        }
      }

      // update pixels for this chunk only
      for (let yy = 0; yy < ch; yy++) {
        const row = (y0 + yy) * W + x0;
        for (let xx = 0; xx < cw; xx++) {
          const i = row + xx;
          if (i >= 0 && i < N) {
            setMinimapPixel(i, { minimapImage, minimapGridOwner, you, colors, minimapOwnerRgbCache, gridCellOwner, gridCellIsCooling });
          }
        }
      }
    }
    minimapHadChunkUpdate = true;
    return;
  }

  if (msgType === 5) {
    const need = (n) => o+n <= bl;
    if (!need(4 + 1 + 4 + 2 + 4 + 1)) return;
    const tick = dv.getUint32(o, true);
    o += 4;

    lastEventsTick = tick;
    lastEventsAt = Date.now();

    mutatorType = dv.getUint8(o);
    o += 1;
    mutatorUntil = dv.getUint32(o, true);
    o += 4;

    bountyTarget = dv.getUint16(o, true);
    o += 2;
    bountyUntil = dv.getUint32(o, true);
    o += 4;

    const puCount = dv.getUint8(o);
    o += 1;
    const nextPU = new Map();
    if (!need(puCount * 11 + 2)) return;
    for (let k = 0; k < puCount; k++) {
      const id = dv.getUint16(o, true);
      o += 2;
      const type = dv.getUint8(o);
      o += 1;
      const x = dv.getUint16(o, true);
      o += 2;
      const y = dv.getUint16(o, true);
      o += 2;
      const expires = dv.getUint32(o, true);
      o += 4;
      nextPU.set(id, { id, type, x, y, expires });
    }
    powerUps = nextPU;

    const evCount = dv.getUint16(o, true);
    o += 2;
    for (let k = 0; k < evCount; k++) {
      if (!need(1)) return;
      const kind = dv.getUint8(o);
      o += 1;

      if (kind === 1) {
        if (!need(9)) return;
        const victim = dv.getUint16(o, true);
        o += 2;
        const killer = dv.getUint16(o, true);
        o += 2;
        const reason = dv.getUint8(o);
        o += 1;
        const ex = dv.getUint16(o, true);
        o += 2;
        const ey = dv.getUint16(o, true);
        o += 2;
        const vn = displayNameOf(victim);
        const kn = killer ? displayNameOf(killer) : '';

        if (victim === you) {
          lastDeathInfo = { killer, killerName: kn, reason };
        }

        const rs = deathReasonLabel(reason);
        // Эффект гибели жертвы — его видят все, а не только убийца.
        // Стиль берём из cosExtra; без сообщения это базовая вспышка (0).
        addFxBurst(ex, ey, `die${cosClampId(cosDeathByPlayer.get(victim) || 0)}`, {
          pid: victim,
          life: COS_DEATH_MS
        });

        if (killer) pushEventFeed(`${kn} -> ${vn}${rs ? ` (${rs})` : ''}`, 'Kill', killer);
        else pushEventFeed(`${vn} ${t('feed.died')}${rs ? ` (${rs})` : ''}`, 'Death', victim);

        if (killer && killer === you) {
          youKills++;
          addFxBurst(ex, ey, 'kill');
          addShakeClass('medium', ...shakeDirFrom(ex, ey));
          sfx.kill();
          fxFlashScreen([255, 96, 96], 0.75);
          comboBump();
          vibrate(35);
          // K5: первое убийство — открываем контракты.
          obFireEvent('kill');
        }
        if (victim === you) {
          // J2: отклик на собственную смерть — не на чужую.
          addShakeClass('large', ...shakeDirFrom(ex, ey));
          fxFlashScreen([255, 80, 80], 1);
          comboBreak();
          // K5: первая смерть — теперь понятно, зачем баунти и киллы.
          obFireEvent('death');
        }
        continue;
      }

      if (kind === 19) {
        if (!need(2 + 2 + 2 + 4 + 1)) return;
        const pid = dv.getUint16(o, true);
        o += 2;
        const ex = dv.getUint16(o, true);
        o += 2;
        const ey = dv.getUint16(o, true);
        o += 2;
        const delta = dv.getUint32(o, true);
        o += 4;
        const fxId = dv.getUint8(o);
        o += 1;
        const pn = displayNameOf(pid);
        /* C6: 13 ботов делают по ~66 захватов за матч — это ~2 строки в
           секунду, лента читалась как зависший лог и в ней тонули киллы.
           Свой захват идёт в ленту всегда (это ответ на твоё действие),
           чужой — только если он крупный: порог примерно равен половине
           типового домашнего квадрата, ниже него событие не несёт
           информации о раскладе на карте. */
        if (pid === you || delta >= FEED_FOREIGN_CAPTURE_MIN) {
          pushEventFeed(
            `${pn} ${t('feed.captured')} +${delta} ${t('feed.zone')}`,
            'Capture',
            pid
          );
        }
        addFxBurst(ex, ey, `cap${cosClampId(fxId)}`, { pid });
        if (pid === you) {
          // J5: самое частое приятное действие теперь показывает число.
          addScorePopup(ex, ey, delta);
          comboBump();

          const jackpot = delta >= CAPTURE_JACKPOT_CELLS;
          if (jackpot) {
            addShakeClass('large', ...shakeDirFrom(ex, ey));
            fxFlashScreen([255, 215, 120], 1);
            // J12: 140 мс на самом жирном событии игры.
            triggerHitstop(140);
            sfx.jackpot();
            bumpMatchTabBadge();
            if (!showBigBanner('💎', t('banner.jackpot'), `+${fmtInt(delta)} · ${t('banner.jackpot_sub')}`, 'jackpot')) {
              addToast('💎', `${t('banner.jackpot')} +${fmtInt(delta)}`, 'big', t('banner.jackpot_sub'), {
                tab: 'match',
                key: 'capture_jackpot',
                prio: 'jackpot'
              });
            }
          } else {
            addShakeClass('small', ...shakeDirFrom(ex, ey));
            // J17: раньше захват меньше 40 клеток звучал как ничто.
            if (delta >= 40) sfx.captureBig();
            else sfx.captureSmall();
          }

          celebrateFirstCapture(delta);
          // K5: первый захват — момент, когда про бонусы уже есть смысл рассказать.
          obFireEvent('capture');
        }
        continue;
      }

      // F5 «Реклейм»: игрок вернул свою остывающую территорию.
      // A=игрок, B=клетки, X/Y=точка возврата. Без разбора этого kind весь
      // остаток пакета событий терялся бы (парсер ломается на неизвестном kind).
      if (kind === 20) {
        if (!need(2 + 2 + 2 + 2)) return;
        const pid = dv.getUint16(o, true);
        o += 2;
        const cells = dv.getUint16(o, true);
        o += 2;
        const ex = dv.getUint16(o, true);
        o += 2;
        const ey = dv.getUint16(o, true);
        o += 2;
        const pn = displayNameOf(pid);
        // C6: тот же порог, что и у захвата — чужой возврат мелочи в ленте
        // такой же шум, как и чужой мелкий захват. Свой — всегда.
        if (pid === you || cells >= FEED_FOREIGN_CAPTURE_MIN) {
          pushEventFeed(`${pn} ${t('feed.reclaimed')} +${cells}`, 'Reclaim', pid);
        }
        addFxBurst(ex, ey, `cap${cosClampId(cosCaptureFxByPlayer(pid))}`, { pid });
        if (pid === you && cells > 0) {
          addScorePopup(ex, ey, cells);
          // F5: возврат своей земли должен читаться иначе, чем обычный захват —
          // это отыгранная назад потеря, а не прирост.
          addFxBurst(ex, ey, 'reclaim', { life: 900 });
          addShakeClass(cells >= 120 ? 'medium' : 'small', ...shakeDirFrom(ex, ey));
          fxFlashScreen([120, 220, 255], Math.min(1, 0.35 + cells / 400));
          sfx.bountyClaimed();
          addToast('♻', t('reclaim.toast'), cells >= 120 ? 'big' : '', `+${fmtInt(cells)} · ${t('reclaim.toast_desc')}`, {
            key: 'reclaim',
            prio: cells >= 120 ? 'jackpot' : 'important'
          });
          if (cells >= 120) triggerHitstop(110);
        }
        coolDeadlineByOwner.delete(pid);
        continue;
      }

      // F5 «Реклейм»: EventCoolBatch (21) — территория погибшего пошла остывать.
      // A=бывший владелец, B=клетки, C=тик окончательного исчезновения.
      // Даёт честное время истечения вместо клиентской оценки по первому кадру.
      if (kind === 21) {
        if (!need(2 + 2 + 4)) return;
        const pid = dv.getUint16(o, true);
        o += 2;
        const cells = dv.getUint16(o, true);
        o += 2;
        const untilTick = dv.getUint32(o, true);
        o += 4;
        if (cells > 0) {
          const nt = approxNowTick();
          const remMs = nt != null && tickMs ? Math.max(0, (untilTick - nt) * tickMs) : RECLAIM_WINDOW_MS;
          coolDeadlineByOwner.set(pid, performance.now() + Math.min(RECLAIM_WINDOW_MS * 1.5, remMs));
        }
        continue;
      }

      if (kind === 15) {
        if (!need(2 + 1 + 2 + 4)) return;
        const pid = dv.getUint16(o, true);
        o += 2;
        const slot = dv.getUint8(o);
        o += 1;
        const goal = dv.getUint16(o, true);
        o += 2;
        const packed = dv.getUint32(o, true);
        o += 4;
        // K7: раньше здесь объявлялась `const t`, перекрывавшая функцию перевода
        // на весь блок. Переименовано в `type`.
        const type = (packed >>> 16) & 0xffff;
        const prog = packed & 0xffff;
        if (pid === you) {
          dailySetAssign(slot, type, goal, prog);
          bumpMatchTabBadge();
          // J16: назначение ежедневки было беззвучным.
          sfx.dailyAssigned();
          // C7: ключ тоста включает слот — иначе два слота с одним типом
          // схлопывались в один тост и одно из заданий оставалось невидимым.
          addToast('📅', `${infoPack().labels.daily}: ${dailyLabel(type)}`, 'big', infoDesc(infoPack().dailies, type, ''), { tab: 'match', key: `daily_assign_${slot}_${type}`, prio: 'important' });
        }
        continue;
      }

      if (kind === 16) {
        if (!need(2 + 1 + 2)) return;
        const pid = dv.getUint16(o, true);
        o += 2;
        const slot = dv.getUint8(o);
        o += 1;
        const prog = dv.getUint16(o, true);
        o += 2;
        if (pid === you) {
          dailySetProgress(slot, prog);
        }
        continue;
      }

      if (kind === 17) {
        if (!need(2 + 1)) return;
        const pid = dv.getUint16(o, true);
        o += 2;
        const slot = dv.getUint8(o);
        o += 1;
        if (pid === you) {
          bumpMatchTabBadge();
          // C7: тост называет конкретное задание и различает слоты.
          const doneIt = youDailies.get(Number(slot) || 0);
          if (doneIt) doneIt.prog = doneIt.goal || doneIt.prog;
          const doneName = doneIt?.type ? dailyLabel(doneIt.type) : '';
          addToast('🏁', infoPack().labels.dailyComplete, 'big', doneName, { tab: 'match', key: `daily_complete_${slot}`, prio: 'important' });
          sfx.dailyDone();
          comboBump();
        }
        continue;
      }

      if (kind === 18) {
        if (!need(2 + 1)) return;
        const pid = dv.getUint16(o, true);
        o += 2;
        const achv = dv.getUint8(o);
        o += 1;
        const pn = displayNameOf(pid);
        pushEventFeed(`${pn} — ${infoPack().labels.achievement}: ${achvLabel(achv)}`, 'Achv', pid);
        if (pid === you) {
          bumpMatchTabBadge();
          sfx.achievement();
          fxFlashScreen([255, 225, 150], 0.8);
          triggerHitstop(90);
          // J13: ачивка идёт в центральный баннер, а не тонет за тремя мелкими тостами.
          if (!showBigBanner('🏅', achvLabel(achv), infoDesc(infoPack().achv, achv, ''), 'jackpot')) {
            addToast('🏅', `${infoPack().labels.achievement}: ${achvLabel(achv)}`, 'big', infoDesc(infoPack().achv, achv, ''), { tab: 'match', key: `achv_${achv}`, prio: 'jackpot' });
          }
        }
        continue;
      }

      if (kind === 10) {
        if (!need(2 + 1 + 2 + 4)) return;
        const pid = dv.getUint16(o, true);
        o += 2;
        const type = dv.getUint8(o);
        o += 1;
        const goal = dv.getUint16(o, true);
        o += 2;
        const until = dv.getUint32(o, true);
        o += 4;
        const pn = displayNameOf(pid);
        pushEventFeed(`${pn} — ${infoPack().labels.contract}: ${contractLabel(type) || type} ${goal}`, 'Contract', pid);
        if (pid === you) {
          youContractType = type;
          youContractGoal = goal;
          youContractProgress = 0;
          youContractUntil = until;
          bumpMatchTabBadge();
          // J16: назначение контракта было беззвучным.
          sfx.contractAssigned();
          addToast('📜', `${infoPack().labels.contract}: ${contractLabel(type) || type}`, 'big', infoDesc(infoPack().contracts, type, ''), { tab: 'match', key: `contract_assign_${type}`, prio: 'important' });
        }
        continue;
      }

      if (kind === 11) {
        if (!need(2 + 1 + 2)) return;
        const pid = dv.getUint16(o, true);
        o += 2;
        const type = dv.getUint8(o);
        o += 1;
        const prog = dv.getUint16(o, true);
        o += 2;
        if (pid === you) {
          youContractType = type;
          youContractProgress = prog;
        }
        continue;
      }

      if (kind === 12) {
        if (!need(2 + 1)) return;
        const pid = dv.getUint16(o, true);
        o += 2;
        const type = dv.getUint8(o);
        o += 1;
        const pn = displayNameOf(pid);
        pushEventFeed(`${pn} — ${infoPack().labels.contractComplete}: ${contractLabel(type) || type}`, 'Contract', pid);
        if (pid === you) {
          youContractProgress = youContractGoal;
          bumpMatchTabBadge();
          addToast('✅', `${infoPack().labels.contractComplete}: ${contractLabel(type) || type}`, 'big', infoDesc(infoPack().contracts, type, ''), { tab: 'match', key: `contract_complete_${type}`, prio: 'important' });
          sfx.contractDone();
          comboBump();
        }
        continue;
      }

      if (kind === 13) {
        if (!need(2 + 2 + 4 + 1)) return;
        const pid = dv.getUint16(o, true);
        o += 2;
        const delta = dv.getUint16(o, true);
        o += 2;
        const total = dv.getUint32(o, true);
        o += 4;
        const reason = dv.getUint8(o);
        o += 1;
        /* C8: начисления Стиля чужих игроков давали вторую строку на каждый
           захват бота — при одном человеке в комнате это ~16 строк/с про чужую
           валюту, ценности для игрока ноль. В ленту идёт только свой Стиль. */
        if (pid === you) {
          pushEventFeed(`+${delta} ${t('cosmetics.style_points')} (${styleLabel(reason)})`, 'Style');
          if (delta > 0) matchStyleEarned += delta;
          setYouStyle(total);
          bumpMatchTabBadge();
          if (delta >= 20) {
            if (styleToastTimer) {
              try {
                clearTimeout(styleToastTimer);
              } catch {}
              styleToastTimer = 0;
              styleToastAcc = 0;
              styleToastReason = 0;
              styleToastCount = 0;
            }
            addToast('✨', `+${delta} ${t('cosmetics.style_points')}`, 'big', styleLabel(reason), { tab: 'match', key: `style_${reason}_${delta}` });
          } else if (delta > 0) {
            if (styleToastAcc && styleToastReason && styleToastReason !== reason) {
              flushStyleToast();
            }
            styleToastAcc += delta;
            styleToastReason = reason;
            styleToastCount++;
            if (!styleToastTimer) {
              styleToastTimer = setTimeout(flushStyleToast, 650);
            }
          }
        }
        continue;
      }

      if (kind === 14) {
        if (!need(2 + 2)) return;
        const killer = dv.getUint16(o, true);
        o += 2;
        const victim = dv.getUint16(o, true);
        o += 2;
        const kn = displayNameOf(killer);
        const vn = displayNameOf(victim);
        pushEventFeed(`${t('feed.revenge')}: ${kn} -> ${vn}`, 'Revenge', killer);
        if (killer === you) {
          bumpMatchTabBadge();
          sfx.revenge();
          fxFlashScreen([255, 110, 110], 0.85);
          if (!showBigBanner('😈', t('banner.revenge'), t('banner.revenge_sub'), 'danger')) {
            addToast('😈', t('banner.revenge'), 'big', t('banner.revenge_sub'), { tab: 'match', key: 'revenge', prio: 'jackpot' });
          }
        }
        continue;
      }

      if (kind === 2) {
        if (!need(2 + 1)) return;
        const pid = dv.getUint16(o, true);
        o += 2;
        const streak = dv.getUint8(o);
        o += 1;
        const pn = displayNameOf(pid);
        pushEventFeed(`${pn} — ${t('event.streak')} x${streak}`, 'Streak', pid);
        if (pid === you) {
          youStreak = streak;
          // J3: раньше бип стоял вне этой проверки — в комнате с 14 ботами
          // получался метроном.
          sfx.streak(Math.max(0, streak - 2));
          if (streak === 3) {
            bumpMatchTabBadge();
            addToast('🔥', `${t('toast.streak')} x${streak}`, null, t('toast.streak_3'), { tab: 'match', key: `streak_${streak}`, prio: 'important' });
          }
          if (streak >= 5) {
            bumpMatchTabBadge();
            fxFlashScreen([255, 170, 90], 0.8);
            if (!showBigBanner('🔥', `${t('banner.streak')} x${streak}`, t('toast.streak_5'), 'jackpot')) {
              addToast('🔥', `${t('toast.streak')} x${streak}`, 'big', t('toast.streak_5'), { tab: 'match', key: `streak_${streak}`, prio: 'jackpot' });
            }
          }
        }
        continue;
      }

      if (kind === 3) {
        if (!need(2 + 4)) return;
        const target = dv.getUint16(o, true);
        o += 2;
        const until = dv.getUint32(o, true);
        o += 4;
        bountyTarget = target;
        bountyUntil = until;
        const tn = displayNameOf(target);
        pushEventFeed(`${t('event.bounty')}: ${tn}`, 'Bounty');

        bumpMatchTabBadge();
        addToast('🎯', `${infoPack().labels.bounty}: ${tn}`, 'big', t('toast.bounty_desc'), { tab: 'match', key: `bounty_${target}`, prio: target === you ? 'jackpot' : 'important' });
        // J2/J3: назначение баунти — глобальное событие. Полная громкость только
        // если цель — ты, иначе 40%.
        sfx.bountyAssigned(target === you ? 1 : 0.4);
        if (target === you) fxFlashScreen([255, 140, 90], 0.7);
        continue;
      }

      if (kind === 4) {
        if (!need(2 + 2)) return;
        const killer = dv.getUint16(o, true);
        o += 2;
        const victim = dv.getUint16(o, true);
        o += 2;
        const kn = displayNameOf(killer);
        const vn = displayNameOf(victim);
        pushEventFeed(`${t('event.bounty_claimed')}: ${kn} -> ${vn}`, 'Bounty', killer);

        bumpMatchTabBadge();
        const mineClaim = killer === you;
        addToast('🏆', t('toast.bounty_claim_title'), 'big', t('toast.bounty_claim_desc'), { tab: 'match', key: 'bounty_claim', prio: mineClaim ? 'jackpot' : 'minor' });
        // J2: тряска и полная громкость только тому, кто забрал награду.
        if (mineClaim) {
          sfx.bountyClaimed();
          addShakeClass('large');
          fxFlashScreen([255, 210, 120], 0.9);
          comboBump();
        } else {
          sfx.bountyAssigned(0.4);
        }
        continue;
      }

      if (kind === 5) {
        if (!need(2 + 1 + 2 + 2 + 4)) return;
        const id = dv.getUint16(o, true);
        o += 2;
        const type = dv.getUint8(o);
        o += 1;
        const x = dv.getUint16(o, true);
        o += 2;
        const y = dv.getUint16(o, true);
        o += 2;
        const expires = dv.getUint32(o, true);
        o += 4;
        powerUps.set(id, { id, type, x, y, expires });
        continue;
      }

      if (kind === 6) {
        if (!need(2 + 2 + 1 + 2 + 2)) return;
        const pid = dv.getUint16(o, true);
        o += 2;
        const id = dv.getUint16(o, true);
        o += 2;
        const type = dv.getUint8(o);
        o += 1;
        const ex = dv.getUint16(o, true);
        o += 2;
        const ey = dv.getUint16(o, true);
        o += 2;
        powerUps.delete(id);
        const pn = displayNameOf(pid);
        pushEventFeed(`${pn} ${t('event.picked')}: ${powerupLabel(type)}`, 'Pickup', pid);

        if (pid === you) {
          if (type === 1) youShield = true;
          if (type === 2) {
            youSpeedUntilTick = lastEventsTick + 45;
            youSpeedType = 2;
          }
          if (type === 4) {
            youSpeedUntilTick = lastEventsTick + 95;
            youSpeedType = 4;
          }
          addFxBurst(ex, ey, type === 2 ? 'pickup2' : type === 4 ? 'pickup4' : 'pickup');
          if (type === 2 || type === 4) sfx.speedOn();
          else sfx.pickup();
          addShakeClass('micro', ...shakeDirFrom(ex, ey));
          comboBump();
        }
        continue;
      }

      if (kind === 9) {
        if (!need(2 + 1 + 2 + 2)) return;
        const pid = dv.getUint16(o, true);
        o += 2;
        const type = dv.getUint8(o);
        o += 1;
        const ex = dv.getUint16(o, true);
        o += 2;
        const ey = dv.getUint16(o, true);
        o += 2;
        const pn = displayNameOf(pid);
        pushEventFeed(`${pn} ${t('event.used')}: ${powerupLabel(type)}`, 'Use', pid);

        if (pid === you) {
          if (type === 1) youShield = false;
          addFxBurst(ex, ey, 'use');
          addToast(type === 3 ? '💥' : '🛡', `${t('toast.powerup_used')}: ${powerupLabel(type)}`, null, infoDesc(infoPack().powerups, type, ''));
          if (type === 3) {
            sfx.explode();
            fxFlashScreen([255, 150, 90], 0.8);
          } else {
            sfx.powerUsed();
          }
          addShakeClass('medium', ...shakeDirFrom(ex, ey));
        }
        continue;
      }

      if (kind === 7) {
        if (!need(1 + 4)) return;
        const type = dv.getUint8(o);
        o += 1;
        const until = dv.getUint32(o, true);
        o += 4;
        mutatorType = type;
        mutatorUntil = until;
        const mn = mutatorLabel(type);
        if (mn) pushEventFeed(`${t('event.round')}: ${mn}`, 'Round');

        if (mn) addToast('⚡', `${infoPack().labels.round}: ${mn}`, 'big', infoDesc(infoPack().mutators, type, ''), { key: `mutator_${type}`, prio: 'important' });
        // J2: глобальное событие — 40% громкости.
        sfx.mutatorOn(0.4);
        continue;
      }

      if (kind === 8) {
        if (!need(1)) return;
        const type = dv.getUint8(o);
        o += 1;
        if (mutatorType === type) {
          mutatorType = 0;
          mutatorUntil = 0;
        }

        addToast('✓', infoPack().labels.roundEnded, 'big');
        sfx.mutatorOff(0.4);
        continue;
      }

      // Сервер для неизвестного типа события пишет ровно один байт-заглушку
      // (см. default в buildEventsPooledLocked). Пропускаем его и продолжаем
      // разбор: иначе старый закешированный клиент терял бы весь остаток
      // пакета после первого же нового типа события — этот баг в проекте уже
      // случался дважды и молча ломал киллфид, тосты и обновления заданий.
      // C10: при рассинхроне версий это десятки предупреждений на тик —
      // логируем один раз на тип события.
      if (!unknownEventKindSeen.has(kind)) {
        unknownEventKindSeen.add(kind);
        try {
          console.warn('unknown event kind', kind);
        } catch {}
      }
      if (!need(1)) break;
      o += 1;
      continue;
    }

    // K7: renderKillfeed() звался 13 раз внутри цикла разбора событий (замер:
    // 784 мутации DOM за 115 с). Один пакет — одна перерисовка в конце.
    if (killfeedDirty) {
      killfeedDirty = false;
      renderKillfeed();
    }
    renderMetaHud();
    renderTopHud();
    return;
  }
  } catch (e) {
    console.warn('bad binary state packet', e);
  }
}


function onChat(m) {
  if (!m) return;
  addChatLine(m);
  updateChatHeaderStatus();
}

/* Новые косметические категории приходят отдельным JSON-сообщением, потому что
   бинарный ROI-снапшот остаётся 21-байтным и не расширяется:
   {"players":[{"n":12,"terr":3,"death":1,"title":7}, ...]}
   Сообщения может не быть (старый сервер) — тогда карты пусты и всё рисуется
   базовыми вариантами. */
function onCosExtra(m) {
  const arr = Array.isArray(m?.players) ? m.players : null;
  if (!arr) return;
  cosTerrByPlayer.clear();
  cosDeathByPlayer.clear();
  cosTitleByPlayer.clear();
  // C4: bot identity. Полная пересборка — сообщение всегда содержит всю комнату.
  botArchByPlayer.clear();
  for (const it of arr) {
    const n = Number(it?.n);
    if (!Number.isFinite(n)) continue;
    const terr = cosClampId(it?.terr);
    const death = cosClampId(it?.death);
    const title = Math.max(0, Math.min(COS_TITLE_MAX, Number(it?.title) || 0));
    if (terr) cosTerrByPlayer.set(n, terr);
    if (death) cosDeathByPlayer.set(n, death);
    if (title) cosTitleByPlayer.set(n, title);
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
    if (n === you) {
      youCos.eq.terr = terr;
      youCos.eq.death = death;
      youTitleId = title;
    }
  }
  try {
    if (cosmeticsOpen) syncCosmeticsUi();
  } catch {}
  // C3: экипировка изменилась — обновляем панель «Ваш облик» в меню.
  try {
    renderMenuSkinPreview();
  } catch {}
}

// Разбор одной записи имени. Возвращает true, если что-то изменилось.
function applyNameRecord(rec) {
  const id = Number(rec?.n);
  const nm = rec?.nm;
  if (!Number.isFinite(id) || typeof nm !== 'string') return false;

  // C5: английский вариант — отдельная карта, выбор делает displayNameOf().
  const en = typeof rec?.nmEn === 'string' ? rec.nmEn.trim() : '';
  if (en) nameEnById.set(id, en);
  else nameEnById.delete(id);

  // G15: сервер генерирует уникальные шуточные ники ботов — используем их.
  // Свой запасной вариант нужен только когда сервер прислал пустую строку.
  const clean = nm.trim();
  if (clean) {
    nameById.set(id, clean);
  } else if (botIds && botIds.has(id)) {
    nameById.set(id, botDisplayName(id));
  } else {
    return !!en;
  }
  return true;
}

function nameUpdateFlush(changed) {
  if (!changed) return;
  if (chat.classList.contains('collapsed')) {
    chatDirty = true;
    return;
  }
  renderChat();
}

function onNameUpdate(m) {
  nameUpdateFlush(applyNameRecord(m));
}

/* Защита на случай, если сервер начнёт слать один пакет со списком имён вместо
   N отдельных сообщений (при входе в долгоживущую комнату их сотни). Старый
   nameUpdate продолжает работать. Принимаем и {names:[...]}, и голый массив. */
function onNameUpdateBatch(d) {
  const list = Array.isArray(d) ? d : Array.isArray(d?.names) ? d.names : null;
  if (!list) return;
  let changed = false;
  for (const rec of list) {
    if (applyNameRecord(rec)) changed = true;
  }
  nameUpdateFlush(changed);
}

function onRttPong(m) {
  const ts = m?.t;
  if (typeof ts !== 'number') return;
  const now = performance.now();
  pingMs = Math.max(0, now - ts);
}

function onRooms(rooms) {
  roomsLoading = false;
  roomsLoadError = '';
  if (roomsLoadTimeout) {
    clearTimeout(roomsLoadTimeout);
    roomsLoadTimeout = 0;
  }
  if (refreshRoomsBtn) {
    refreshRoomsBtn.disabled = false;
    refreshRoomsBtn.classList.remove('isLoading');
    refreshRoomsBtn.textContent = t('rooms.refresh');
  }
  lastRooms = Array.isArray(rooms) ? rooms : [];
  updateRoomsUi();
}
function onLeft() {
  rejoinRoomId = null;
  rejoinFinish();
  roomId = null;
  roomLimit = null;
  updateRoomInfo();
  showMenuOverlay();
}

function connectWs() {
  net.connect();
}

setInterval(() => {
  if (!menuOverlay || menuOverlay.classList.contains('hidden')) return;
  if (started) return;
  if (roomsCreateOpen || createRoomPending) return;
  const now = performance.now();
  if (now < roomsAutoRefreshAt) return;
  roomsAutoRefreshAt = now + 5000;
  wsSend('rooms', {});
}, 1200);

function applyPackedDelta(u16, buf) {
  if (!u16 || !buf) return;
  const d = new Uint32Array(buf);
  const len = u16.length;
  for (let k = 0; k < d.length; k++) {
    const v = d[k];
    const i = v >>> 16;
    const o = v & 0xffff;
    if (i < len) u16[i] = o;
  }
}

/* J15 — заливка расходится волной от точки замыкания петли.
   Раньше задержка была `(i * 37) % 170` — псевдослучайный шум, который читался
   как «мигание». Теперь честная дистанция от головы владельца до клетки на 8 мс,
   так что фронт заливки идёт из той точки, где игрок вернулся в свою зону.
   Стоимость — один sqrt на изменённую клетку. */
const FILL_WAVE_MS_PER_CELL = 8;
const FILL_WAVE_MAX_MS = 700;

function fillDelayFor(i, owner) {
  const a = captureAnchorByOwner.get(owner);
  if (!a || !W) return (i * 37) % fillDelayMod;
  const dx = (i % W) - a.x;
  const dy = ((i / W) | 0) - a.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  return Math.min(FILL_WAVE_MAX_MS, d * FILL_WAVE_MS_PER_CELL);
}

// Головы всех живых игроков в момент прихода снапшота — они же точки замыкания
// для тех, кто именно в этом тике захватил территорию.
function refreshCaptureAnchors(players) {
  if (!Array.isArray(players)) return;
  captureAnchorByOwner.clear();
  for (const p of players) {
    if (!p || !p.a) continue;
    captureAnchorByOwner.set(p.n, { x: Number(p.x) || 0, y: Number(p.y) || 0 });
  }
}

function markCoolSeen(i, raw, now) {
  if (!coolSeenAt) return;
  if (gridCellIsCooling(raw)) {
    if (!coolSeenAt[i]) coolSeenAt[i] = now;
  } else if (coolSeenAt[i]) {
    coolSeenAt[i] = 0;
  }
}

function applyPackedDeltaGridWithAnim(buf, now) {
  if (!gridOwner || !buf || !gridFillAt) return;
  const d = new Uint32Array(buf);
  const len = gridOwner.length;
  for (let k = 0; k < d.length; k++) {
    const v = d[k];
    const i = v >>> 16;
    const o = v & 0xffff;
    if (i >= len) continue;
    const prev = gridOwner[i];
    if (prev !== o) {
      gridOwner[i] = o;
      markCoolSeen(i, o, now);
      // Остывающие клетки (старший бит) не анимируем как свежий захват.
      if (o !== 0 && !gridCellIsCooling(o)) {
        gridFillAt[i] = now + fillDelayFor(i, o);
      }
    }
  }
}

function onState(s) {
  clientState.lastState = s;

  // K1: прямоугольник ROI приходил и молча выбрасывался. Он — единственный
  // источник правды о том, какая часть сетки вообще свежая.
  const r = s?.roi;
  if (r && Number(r.rw) > 0 && Number(r.rh) > 0) {
    lastRoi = {
      rx: Math.max(0, Number(r.rx) || 0),
      ry: Math.max(0, Number(r.ry) || 0),
      rw: Number(r.rw) || 0,
      rh: Number(r.rh) || 0
    };
  } else if (s?.full) {
    // Полный снапшот освежает всю карту — тумана в этом кадре нет.
    lastRoi = null;
  }

  const now = performance.now();

  // J15: якоря должны быть готовы до применения дельты сетки — именно в этом
  // снапшоте голова стоит там, где петля замкнулась.
  refreshCaptureAnchors(s.players);

  if (s.full) {
    const prev = gridOwner;
    gridOwner = new Uint16Array(s.grid);
    trailOwner = new Uint16Array(s.trail);
    if (!gridFillAt || gridFillAt.length !== gridOwner.length) gridFillAt = new Float32Array(gridOwner.length);
    if (!coolSeenAt || coolSeenAt.length !== gridOwner.length) coolSeenAt = new Float32Array(gridOwner.length);
    if (prev && prev.length === gridOwner.length) {
      for (let i = 0; i < gridOwner.length; i++) {
        const n = gridOwner[i];
        if (prev[i] !== n) markCoolSeen(i, n, now);
        if (n !== 0 && !gridCellIsCooling(n) && prev[i] !== n) {
          gridFillAt[i] = now + fillDelayFor(i, n);
        }
      }
    } else {
      for (let i = 0; i < gridOwner.length; i++) markCoolSeen(i, gridOwner[i], now);
    }
  } else {
    applyPackedDeltaGridWithAnim(s.dg, now);
    applyPackedDelta(trailOwner, s.dt);
  }

  // minimap is updated by server-sent chunk updates

  const tmpPlayers = prevPlayers;
  prevPlayers = currPlayers;
  currPlayers = tmpPlayers;
  currPlayers.clear();
  let nameChanged = false;
  for (const p of s.players) {
    currPlayers.set(p.n, p);
    // K2: номера игроков переиспользуются (аллокатор отдаёт первый свободный,
    // боты пересоздаются при каждом входе/выходе человека). Кэш «номер → цвет»
    // раньше писался один раз и никогда не обновлялся: номер 7 оставался
    // красным даже после того, как его получил новый синий бот. Сравниваем
    // цвет каждый кадр и сбрасываем зависимые кэши при расхождении.
    if (colors.get(p.n) !== p.c) {
      colors.set(p.n, p.c);
      ownerFillStyleCache.delete(p.n);
      minimapOwnerRgbCache.delete(p.n);
      minimapDirty = true;
    }
    if (p.nm && nameById.get(p.n) !== p.nm) {
      nameById.set(p.n, p.nm);
      nameChanged = true;
    }
  }

  if (nameChanged && clientState.chatMessages.length) renderChat();

  headIndexByOwner.clear();
  for (const p of s.players) {
    headIndexByOwner.set(p.n, p.y * W + p.x);
  }

  lastPacketAt = performance.now();

  if (clientState.lastStateAt != null) {
    const dt = lastPacketAt - clientState.lastStateAt;
    if (dt > 0) tickrate = lerp(tickrate || 0, 1000 / dt, 0.15);
  }
  clientState.lastStateAt = lastPacketAt;

  try {
    refreshOwnGeometry(false);
  } catch {}

  const me = s.players?.find((p) => p.n === you);
  if (me) {
    const alive = !!me.a;
    if (alive) {
      const ordered = computeTopSorted(s.players);
      const idx = ordered.findIndex((p) => p.n === you);
      const cells = Number(me?.s) || 0;
      const pct = mapCells ? (cells / mapCells) * 100 : 0;
      const points = Number(me?.p) || 0;
      const place = idx >= 0 ? `${idx + 1}/${ordered.length}` : '—';
      lastYouStats = { cells, pct, points, place };
    }
    if (alive && !youAlive) {
      youAlive = true;
      lastDirSent = null;
      hideOverlays();
    } else if (!alive && youAlive) {
      youAlive = false;
      lastDirSent = null;
      youStreak = 0;
      // Драматический наезд камеры на голову в точке гибели — до того, как
      // сервер уберёт игрока из состояния и координаты станут недоступны.
      beginDeathZoom((Number(me.x) || 0) + 0.5, (Number(me.y) || 0) + 0.5);
      // Момент смерти стоит увидеть: модалка мгновенно накрывала кадр, в
      // котором игрока убили. Держим паузу, пока идёт hitstop + вспышка.
      beginDeathSlowMo();
    }
  }
}

setInterval(() => {
  updateLeaderboard();
}, 1000);

showMenuOverlay();
connectWs();

function quantizeAlpha(a) {
  const v = Math.max(0, Math.min(1, a));
  return Math.round(v * ALPHA_STEPS);
}

function getOwnerFillStyle(owner, a) {
  const ai = quantizeAlpha(a);
  let arr = ownerFillStyleCache.get(owner);
  if (!arr) {
    arr = new Array(ALPHA_STEPS + 1);
    ownerFillStyleCache.set(owner, arr);
  }
  let s = arr[ai];
  if (s) return s;
  const c = boostHsl(colors.get(owner) || 'hsl(210 20% 60%)');
  const rgb = hslToRgb(c);
  const aa = ai / ALPHA_STEPS;
  s = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${aa})`;
  arr[ai] = s;
  return s;
}

function drawMinimap() {
  const res = drawMinimapImpl(mmCtx, {
    minimapImage,
    minimapGridOwner,
    clientState,
    minimapDirty,
    minimapHadChunkUpdate,
    N,
    you,
    colors,
    botIds,
    bountyTarget,
    minimapOwnerRgbCache,
    gridCellOwner,
    gridCellIsCooling,
    viewMinX,
    viewMinY,
    viewMaxX,
    viewMaxY,
    W,
    H,
    syncMinimapOverlayCanvas
  });
  minimapDirty = res.dirty;
  minimapHadChunkUpdate = res.hadChunkUpdate;
}

function formatRate(bps) {
  return formatRateOf(bps);
}

function perfValueSpan(text, bad) {
  const cls = bad ? 'perfBad' : 'perfOk';
  return `<span class="perfValue ${cls}">${text}</span>`;
}

function getInterpPlayer(id, t) {
  const b = currPlayers.get(id);
  if (!b) return null;
  const a = prevPlayers.get(id) || b;
  return {
    ...b,
    ix: lerp(a.x, b.x, t),
    iy: lerp(a.y, b.y, t)
  };
}

function draw() {
  requestAnimationFrame(draw);
  const matchOverlayOpen = !!(matchOverlay && !matchOverlay.classList.contains('hidden'));
  if (matchOverlayOpen) {
    updateMatchCountdown();
  }

  if (!clientState.lastState || !gridOwner || !trailOwner) return;

  /* K7: под открытым оверлеем смерти/итогов поле продолжало рисоваться на
     60 fps, причём сквозь backdrop-filter: blur(8px) — худший из возможных
     сценариев для мобильного GPU: каждый кадр поля тянет за собой пересчёт
     размытия всей области оверлея. Поле там статично и всё равно размыто,
     поэтому обновляем его раз в 4 кадра.
     C10: backdrop-filter стоит не только на этих двух оверлеях, но и на
     магазине с меню — а магазин открывается прямо из HUD во время матча.
     Единый признак — класс overlayActive на body. */
  const deathOverlayOpen = !!(deathOverlay && !deathOverlay.classList.contains('hidden'));
  let anyOverlayOpen = matchOverlayOpen || deathOverlayOpen;
  try {
    if (document.body.classList.contains('overlayActive')) anyOverlayOpen = true;
  } catch {}
  if (anyOverlayOpen) {
    draw._blurSkip = ((draw._blurSkip || 0) + 1) % 4;
    if (draw._blurSkip !== 0) return;
  } else {
    draw._blurSkip = 0;
  }

  const cw = window.innerWidth;
  const ch = window.innerHeight;

  let occludedBottom = 0;
  try {
    if (chat) {
      const r = chat.getBoundingClientRect();
      const coversMostWidth = r.width >= cw * 0.85;
      const touchesBottom = r.bottom >= ch - 1;
      if (coversMostWidth && touchesBottom) {
        occludedBottom = Math.max(0, ch - r.top);
      }
    }
  } catch {
    occludedBottom = 0;
  }

  const viewH = Math.max(1, ch - occludedBottom);

  // J12: hitstop замедляет только интерполяцию игроков, не эффекты.
  const interpNow = performance.now();
  const interpElapsed = interpNow - lastPacketAt - hitstopLostMs(lastPacketAt, interpNow);
  const interp = Math.max(0, Math.min(1, interpElapsed / tickMs));

  const my = getInterpPlayer(you, interp);
  const nt = approxNowTick();
  const speedActive = !!(my && my.a && nt != null && youSpeedUntilTick && nt < youSpeedUntilTick);
  const targetX = my ? my.ix + 0.5 : W / 2;
  const targetY = my ? my.iy + 0.5 : H / 2;
  clientState.camX = followCamera(clientState.camX, targetX);
  clientState.camY = followCamera(clientState.camY, targetY);

  {
    const now = performance.now();
    const dt = now - (draw._shakeAt || now);
    draw._shakeAt = now;
    const next = decayShake({
      x: shakeX, y: shakeY, vx: shakeVelX, vy: shakeVelY,
      dtMs: dt, intensity: shakeIntensity
    });
    shakeX = next.x;
    shakeY = next.y;
    shakeVelX = next.vx;
    shakeVelY = next.vy;
  }

  /* C1: масштаб считался только от вьюпорта, а ROI сервера фиксирован (80×56).
     На портретном телефоне (viewH/cw > 1.4) масштаб упирался в ширину, по
     высоте на экран влезало под сотню рядов — и всё, что выходило за 56 рядов
     ROI, закрашивалось туманом: до 40% экрана. Клэмпим масштаб снизу так,
     чтобы экран никогда не был больше фактического ROI. На десктопе
     (cw/viewH ≈ 1.6) обе поправки меньше базового значения и ничего не
     меняют. */
  const baseCell = cellSizeFor({ cw, viewH, roi: lastRoi, roiGrant });

  /* Драматический наезд на точку гибели: чистый визуальный множитель поверх
     baseCell, не влияющий на ROI/сетевой запрос вьюпорта (см. beginDeathZoom
     / updateDeathZoom выше). Камера на время наезда смешивается с точкой
     гибели, а не с текущей целью followCamera. */
  const { zoom: deathZoom, mixToAnchor: deathZoomMix } = updateDeathZoom(performance.now());
  const cell = baseCell * deathZoom;
  const camXForZoom = clientState.camX + (deathZoomAnchorX - clientState.camX) * deathZoomMix;
  const camYForZoom = clientState.camY + (deathZoomAnchorY - clientState.camY) * deathZoomMix;

  /* Камера жёстко зафиксирована на игроке: никакого сдвига по направлению
     движения. Так просил заказчик — «взгляд» не должен уезжать вперёд при
     смене направления.
     Историю двух предыдущих попыток стоит держать в уме, чтобы не вернуться:
     1) поправка «затолкать вьюпорт внутрь ROI» считалась от края окна, а окно
        сервер снапит по ROIStep — величина была ступенчатой, и сглаживание не
        убирало ступеньку, а растягивало её в рывок (0.005..0.6 клетки за кадр);
     2) ведение вперёд на серверный lookahead рывок убрало, но давало ровно тот
        эффект, который заказчику не нужен — камера доворачивала на поворотах.
     Чтобы при нулевом ведении сзади не появлялся туман, сервер тоже перестал
     смещать окно вперёд (roiLookahead → 0), и ROI центрируется на голове. */
  clientState.camLeadX = 0;
  clientState.camLeadY = 0;

  ctx.clearRect(0, 0, cw, ch);

  const screenBounds = visibleBounds({
    cw, viewH, cell,
    camX: camXForZoom + clientState.camLeadX, camY: camYForZoom + clientState.camLeadY,
    shakeX, shakeY, W, H
  });
  const { offsetX, offsetY, minX, minY, maxX, maxY } = screenBounds;

  /* K1: границы горячего цикла по сетке — пересечение экрана с последним
     полученным ROI. За его пределами gridOwner/trailOwner заведомо устарели. */
  const gb = clampToRoi(screenBounds, lastRoi);
  const gMinX = gb.minX;
  const gMinY = gb.minY;
  const gMaxX = gb.maxX;
  const gMaxY = gb.maxY;

  /* C1: рамка обзора на миникарте рисовалась по границам экрана и заявляла
     обзор больше реального — всё, что за ROI, на экране всё равно туман.
     Рамка = фактически видимая область. */
  {
    const vr = viewRectOf(gb);
    viewMinX = vr.minX;
    viewMinY = vr.minY;
    viewMaxX = vr.maxX;
    viewMaxY = vr.maxY;
  }

  {
    // C10: оба градиента зависят только от размеров — раньше пересоздавались
    // каждый кадр. Кэш инвалидируется при изменении cw/ch/viewH.
    const key = `${cw}x${ch}x${viewH}`;
    if (bgGradCacheKey !== key) {
      bgGradCacheKey = key;
      // Волна 9: поле живёт в той же гамме, что и оверлеи, — «неоновый сад».
      // Изумруд в левом верхнем углу, фиолет в правом нижнем, как в .overlay.
      const bg = ctx.createLinearGradient(0, 0, cw, ch);
      bg.addColorStop(0, '#05100f');
      bg.addColorStop(0.55, '#060a12');
      bg.addColorStop(1, '#0a0714');
      bgGradLinear = bg;

      const vg = ctx.createRadialGradient(cw * 0.52, viewH * 0.46, Math.min(cw, viewH) * 0.25, cw * 0.52, viewH * 0.46, Math.min(cw, viewH) * 0.85);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.55)');
      bgGradVignette = vg;
    }
    ctx.fillStyle = bgGradLinear;
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = bgGradVignette;
    ctx.fillRect(0, 0, cw, ch);
  }

  const nowFrame = performance.now();

  const segByOwner = new Map();
  // Цвет владельца кэшируем до горячего цикла: drawSegTile зовётся для каждой
  // клетки следа каждый кадр, лишний boostHsl там не нужен.
  const hslByOwner = new Map();
  // Стиль территории приходит отдельным JSON (`cosExtra`), а не в 21-байтной
  // записи снапшота. Паттерн создаётся ОДИН раз на владельца за кадр, дальше в
  // цикле по клеткам остаётся один fillRect.
  const terrByOwner = new Map();
  const terrStyleByOwner = new Map();
  for (const p of clientState.lastState.players) {
    segByOwner.set(p.n, cosClampId(p.cosSeg));
    const hsl = boostHsl(colors.get(p.n) || p.c || 'hsl(210 20% 60%)');
    hslByOwner.set(p.n, hsl);
    const tid = cosClampId(cosTerrByPlayer.get(p.n) || 0);
    if (tid) {
      terrByOwner.set(p.n, tid);
      if (cosTerrIsPattern(tid)) {
        const st = cosTerrFillStyle(ctx, hsl, tid, offsetX, offsetY, cell);
        if (st) terrStyleByOwner.set(p.n, st);
      }
    }
  }

  if (fxEnabled && speedActive) {
    const dt = Math.min(40, nowFrame - (draw._spAt || nowFrame));
    draw._spAt = nowFrame;
    const [dx, dy] = dirVec(my.d);
    const bx = my.ix + 0.5 - dx * 0.55;
    const by = my.iy + 0.5 - dy * 0.55;
    const c = boostHsl(colors.get(you) || my.c || 'hsl(210 20% 60%)');
    // J22: пресет эффектов масштабирует плотность частиц.
    const rate = (0.22 + 0.55 * fxIntensity) * fxParticleScale();
    const count = Math.max(0, Math.min(7, Math.round((dt / 16) * rate * 3)));
    for (let k = 0; k < count; k++) {
      const jx = (Math.random() - 0.5) * 0.25;
      const jy = (Math.random() - 0.5) * 0.25;
      const pvx = (-dx * (0.010 + Math.random() * 0.010) + (Math.random() - 0.5) * 0.006) * (0.55 + fxIntensity * 0.85);
      const pvy = (-dy * (0.010 + Math.random() * 0.010) + (Math.random() - 0.5) * 0.006) * (0.55 + fxIntensity * 0.85);
      fxParticles.push({
        bornAt: nowFrame,
        lastAt: nowFrame,
        x: bx + jx,
        y: by + jy,
        vx: pvx,
        vy: pvy,
        c,
        r: 0.10 + Math.random() * 0.14
      });
    }
    // Hard cap: remove oldest particles without O(n) shift()
    const hardCap = 220;
    if (fxParticles.length > hardCap) {
      fxParticles.splice(0, fxParticles.length - hardCap);
    }
  }

  // I2: собственный след — главный объект риска в игре. Раньше он отличался от
  // собственной территории всего на 0.07 альфы. Теперь: 0.85 + светлая обводка,
  // а на длинном следе (сигнал риска) добавляется пульсация яркости.
  const trailStyle = trailVisualState({
    trailLen: youTrailLen,
    pulseFrom: TRAIL_PULSE_FROM,
    fxEnabled,
    reducedMotion: prefersReducedMotion(),
    nowFrame
  });
  const ownTrailA = trailStyle.ownAlpha;
  const otherTrailA = trailStyle.otherAlpha;
  const ownTrailStroke = trailStyle.ownStroke;
  const drawOwnOutline = cell >= 8;

  // F18/I4: ближайшая своя клетка ищется бесплатно, прямо в горячем цикле.
  let nearHomeD = Infinity;
  let nearHomeX = -1;
  let nearHomeY = -1;
  const headCX = my ? my.ix : -1;
  const headCY = my ? my.iy : -1;

  /* C10: пунктир остывающей территории раньше стоил save()+setLineDash(новый
     массив)+strokeRect+restore() НА КАЖДУЮ клетку — после смерти это 1000-2000
     клеток в кадре. Теперь рёбра копятся в Path2D (по одному на квантованный
     цвет), рисуются только по границе области, а пунктир задаётся один раз. */
  const coolPaths = coolEdgePaths;
  coolPaths.clear();
  const coolSame = (nx, ny, owner) => {
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) return false;
    const raw = gridOwner[ny * W + nx];
    return gridCellIsCooling(raw) && gridCellOwner(raw) === owner;
  };

  for (let y = gMinY; y <= gMaxY; y++) {
    for (let x = gMinX; x <= gMaxX; x++) {
      const i = y * W + x;
      const rawOwner = gridOwner[i];
      // F5: старший бит = «клетка остывает, её ещё можно вернуть».
      const cooling = gridCellIsCooling(rawOwner);
      const o = cooling ? 0 : rawOwner;
      const coolOwner = cooling ? gridCellOwner(rawOwner) : 0;
      const t = trailOwner[i];

      if (cooling) {
        // Остывающая территория: полупрозрачная заливка, пунктирная граница,
        // ритм пульса подсказывает, что время уходит.
        // F5: плюс затухание по мере приближения к концу окна — чем ближе
        // истечение, тем бледнее клетка и тем чаще пульс.
        const px = offsetX + x * cell;
        const py = offsetY + y * cell;
        // Точное время истечения — из EventCoolBatch; клиентская оценка по
        // первому увиденному кадру остаётся запасным вариантом.
        const deadline = coolDeadlineByOwner.get(coolOwner) || 0;
        const seen = coolSeenAt ? coolSeenAt[i] : 0;
        const prog = deadline
          ? Math.max(0, Math.min(1, 1 - (deadline - nowFrame) / RECLAIM_WINDOW_MS))
          : seen
            ? Math.max(0, Math.min(1, (nowFrame - seen) / RECLAIM_WINDOW_MS))
            : 0;
        const fade = 1 - prog * 0.8;
        const rate = 0.005 + 0.012 * prog;
        const pulse = 0.5 + 0.5 * Math.sin(nowFrame * rate - (x + y) * 0.35);
        ctx.fillStyle = getOwnerFillStyle(coolOwner, (0.14 + 0.10 * pulse) * fade);
        ctx.fillRect(px, py, cell, cell);
        if (cell >= 7) {
          // Альфа квантуется до 1/16 — иначе на каждую клетку приходился бы
          // свой Path2D и группировка не давала бы выигрыша.
          const aq = Math.max(1, Math.round((0.45 + 0.25 * pulse) * fade * 16)) / 16;
          const key = getOwnerFillStyle(coolOwner, aq);
          let path = coolPaths.get(key);
          if (!path) {
            path = new Path2D();
            coolPaths.set(key, path);
          }
          const x1 = px + 0.5;
          const y1 = py + 0.5;
          const x2 = px + cell - 0.5;
          const y2 = py + cell - 0.5;
          if (!coolSame(x, y - 1, coolOwner)) {
            path.moveTo(x1, y1);
            path.lineTo(x2, y1);
          }
          if (!coolSame(x, y + 1, coolOwner)) {
            path.moveTo(x1, y2);
            path.lineTo(x2, y2);
          }
          if (!coolSame(x - 1, y, coolOwner)) {
            path.moveTo(x1, y1);
            path.lineTo(x1, y2);
          }
          if (!coolSame(x + 1, y, coolOwner)) {
            path.moveTo(x2, y1);
            path.lineTo(x2, y2);
          }
        }
      }

      if (o === you && headCX >= 0) {
        const hdx = x - headCX;
        const hdy = y - headCY;
        const hd = hdx * hdx + hdy * hdy;
        if (hd < nearHomeD) {
          nearHomeD = hd;
          nearHomeX = x;
          nearHomeY = y;
        }
      }

      if (o !== 0) {
        const baseA = 0.58;
        const filledAt = gridFillAt ? gridFillAt[i] : 0;
        const age = filledAt ? nowFrame - filledAt : 1e9;

        let waveA = 0;
        if (filledAt && age >= fillAnimMs) {
          const t = age - fillAnimMs;
          if (t < wavePeriodMs) {
            const wave = 0.5 + 0.5 * Math.sin((x * 0.85 + y * 1.15) * waveScale - t * waveSpeed);
            const fade = 1 - (t / wavePeriodMs);
            waveA = waveAlpha * wave * fade;
          }
        }

        const px = offsetX + x * cell;
        const py = offsetY + y * cell;
        const tid = terrByOwner.get(o) || 0;

        // Одна альфа на все три фазы (появление / анимация заливки / покой),
        // чтобы стиль территории подключался ровно в одном месте.
        let a;
        let shineA = 0;
        if (age < 0) {
          a = 0.12 + waveA * 0.35;
        } else if (age < fillAnimMs) {
          const p = Math.max(0, Math.min(1, age / fillAnimMs));
          a = Math.min(0.92, baseA * (0.25 + 0.75 * p) + waveA * 0.5);
          shineA = 0.18 * (1 - Math.abs(p - 0.5) * 2);
        } else {
          a = Math.min(0.92, baseA + waveA);
        }
        if (tid) a = Math.max(0, Math.min(1, a + cosTerrAlphaMod(tid, x, y, nowFrame)));

        const pat = tid ? terrStyleByOwner.get(o) : null;
        if (pat) {
          // try/finally, а не просто парные присваивания до/после: без него
          // исключение внутри fillRect (например, битый CanvasPattern) оставит
          // globalCompositeOperation залипшим на 'lighter' до конца сессии —
          // ничего не сбрасывает его в начале кадра, и вся дальнейшая
          // отрисовка тем же ctx (территория, HUD) начнёт светлеть.
          const additive = cosTerrIsAdditive(tid);
          if (additive) ctx.globalCompositeOperation = 'lighter';
          try {
            ctx.globalAlpha = a;
            ctx.fillStyle = pat;
            ctx.fillRect(px, py, cell, cell);
          } finally {
            ctx.globalAlpha = 1;
            if (additive) ctx.globalCompositeOperation = 'source-over';
          }
        } else {
          ctx.fillStyle = getOwnerFillStyle(o, a);
          ctx.fillRect(px, py, cell, cell);
        }

        if (shineA > 0.01) {
          ctx.fillStyle = getOwnerFillStyle(o, Math.min(0.92, 0.22 + shineA + waveA * 0.35));
          const inset = Math.max(1, (cell * 0.18) | 0);
          ctx.fillRect(px + inset, py + inset, cell - inset * 2, cell - inset * 2);
        }

        // Витраж: светящийся шов только по внешней границе владения.
        if (tid === 5 && cell >= 7) {
          let e = 0;
          if (y === 0 || gridOwner[i - W] !== o) e |= 1;
          if (x === W - 1 || gridOwner[i + 1] !== o) e |= 2;
          if (y === H - 1 || gridOwner[i + W] !== o) e |= 4;
          if (x === 0 || gridOwner[i - 1] !== o) e |= 8;
          if (e) drawTerrSeam(ctx, px, py, cell, hslByOwner.get(o) || 'hsl(210 20% 60%)', e, 0.75);
        }
      }

      if (t !== 0) {
        const mineTrail = t === you;
        let a = mineTrail ? ownTrailA : otherTrailA;
        if (headIndexByOwner.get(t) === i) a *= interp;
        if (a > 0.02) {
          const segId = segByOwner.get(t) || 0;
          const px = offsetX + x * cell;
          const py = offsetY + y * cell;
          // Единый источник правды: тот же drawSegTile, что и в магазине.
          drawSegTile(ctx, px, py, cell, hslByOwner.get(t) || 'hsl(210 20% 60%)', segId, x * 31 + y * 17, a, nowFrame);

          if (mineTrail && drawOwnOutline) {
            ctx.strokeStyle = ownTrailStroke;
            ctx.lineWidth = 1;
            ctx.strokeRect(px + 1.5, py + 1.5, cell - 3, cell - 3);
          }
        }
      }
    }
  }

  // C10: один save/restore и один setLineDash на весь кадр вместо одного на клетку.
  if (coolPaths.size) {
    const dash = Math.max(2, cell * 0.22);
    ctx.save();
    ctx.setLineDash([dash, dash]);
    ctx.lineDashOffset = -nowFrame * 0.02;
    ctx.lineWidth = 1;
    for (const [style, path] of coolPaths) {
      ctx.strokeStyle = style;
      ctx.stroke(path);
    }
    ctx.restore();
    coolPaths.clear();
  }

  if (nearHomeX >= 0) {
    youNearestHomeX = nearHomeX;
    youNearestHomeY = nearHomeY;
    youNearestHomeAt = nowFrame;
  }

  {
    // Сетка в бренд-гамме: чистый белый на #060a12 читался холодным «дребезгом».
    ctx.strokeStyle = 'rgba(120,220,190,0.055)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const step = cell >= 16 ? 1 : 2;
    for (let x = minX; x <= maxX; x += step) {
      const px = offsetX + x * cell;
      ctx.moveTo(px, offsetY + minY * cell);
      ctx.lineTo(px, offsetY + (maxY + 1) * cell);
    }
    ctx.stroke();
    ctx.beginPath();
    for (let y = minY; y <= maxY; y += step) {
      const py = offsetY + y * cell;
      ctx.moveTo(offsetX + minX * cell, py);
      ctx.lineTo(offsetX + (maxX + 1) * cell, py);
    }
    ctx.stroke();
  }

  /* K1: туман за пределами ROI. Рисуется после сетки и до рамки карты, чтобы
     гасить и клетки, и линии, но не трогать игроков, эффекты и HUD. */
  if (lastRoi && (gMinX > minX || gMinY > minY || gMaxX < maxX || gMaxY < maxY)) {
    const kx = offsetX + lastRoi.rx * cell;
    const ky = offsetY + lastRoi.ry * cell;
    const kw = lastRoi.rw * cell;
    const kh = lastRoi.rh * cell;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, cw, ch);
    ctx.rect(kx, ky, kw, kh);
    ctx.fillStyle = 'rgba(6,8,12,0.82)';
    ctx.fill('evenodd');
    ctx.restore();

    // Тонкая граница известной области: игрок должен понимать, что дальше не
    // «пусто», а «неизвестно».
    ctx.save();
    ctx.strokeStyle = 'rgba(148,163,184,0.20)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(kx + 0.5, ky + 0.5, Math.max(1, kw - 1), Math.max(1, kh - 1));
    ctx.restore();
  }

  {
    const left = offsetX;
    const top = offsetY;
    const w = W * cell;
    const h = H * cell;
    const lw = Math.max(6, Math.min(26, cell * 0.30));

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, cw, ch);
    ctx.rect(left, top, w, h);
    ctx.clip('evenodd');
    ctx.lineJoin = 'round';
    ctx.lineWidth = lw;
    ctx.strokeStyle = 'rgba(96,165,250,0.18)';
    ctx.shadowColor = 'rgba(96,165,250,0.55)';
    ctx.shadowBlur = 22;
    ctx.strokeRect(left - lw / 2, top - lw / 2, w + lw, h + lw);
    ctx.restore();

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, lw * 0.40);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    {
      const lw2 = ctx.lineWidth;
      ctx.strokeRect(left - lw2 / 2, top - lw2 / 2, w + lw2, h + lw2);
    }
    ctx.restore();
  }

  if (powerUps && powerUps.size) {
    const now = performance.now();
    const nt = approxNowTick();
    const nextPuScreenPos = [];
    for (const pu of powerUps.values()) {
      const x = Number(pu.x) || 0;
      const y = Number(pu.y) || 0;
      if (
        x < minX - OFFSCREEN_MARGIN_CELLS ||
        x > maxX + OFFSCREEN_MARGIN_CELLS ||
        y < minY - OFFSCREEN_MARGIN_CELLS ||
        y > maxY + OFFSCREEN_MARGIN_CELLS
      ) {
        continue;
      }

      const cx = offsetX + (x + 0.5) * cell;
      const cy = offsetY + (y + 0.5) * cell;
      nextPuScreenPos.push({ cx, cy, r: cell * 0.34, type: pu.type });

      let pulse = 1;
      let alpha = 1;
      if (nt != null && pu.expires) {
        const rem = Number(pu.expires) - nt;
        if (rem < 30) {
          const blink = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(now * 0.020));
          alpha *= Math.max(0.15, blink);
          pulse *= 0.96 + 0.10 * (0.5 + 0.5 * Math.sin(now * 0.016));
        } else {
          pulse *= 0.98 + 0.06 * (0.5 + 0.5 * Math.sin(now * 0.008));
        }
      }

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(cx, cy);
      ctx.scale(pulse, pulse);
      ctx.translate(-cx, -cy);

      const r = cell * 0.34;
      if (pu.type === 1) {
        ctx.save();
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 3;
          const px = cx + Math.cos(a) * r;
          const py = cy + Math.sin(a) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(0,255,255,0.18)';
        ctx.strokeStyle = 'rgba(0,255,255,0.92)';
        ctx.lineWidth = Math.max(1, cell * 0.10);
        ctx.shadowColor = 'rgba(0,255,255,0.55)';
        ctx.shadowBlur = 16;
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      } else if (pu.type === 2) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.35, cy - r * 0.65);
        ctx.lineTo(cx + r * 0.05, cy - r * 0.10);
        ctx.lineTo(cx - r * 0.05, cy - r * 0.10);
        ctx.lineTo(cx + r * 0.35, cy + r * 0.65);
        ctx.lineTo(cx - r * 0.05, cy + r * 0.15);
        ctx.lineTo(cx + r * 0.05, cy + r * 0.15);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,215,0,0.20)';
        ctx.strokeStyle = 'rgba(255,215,0,0.92)';
        ctx.lineWidth = Math.max(1, cell * 0.10);
        ctx.shadowColor = 'rgba(255,215,0,0.55)';
        ctx.shadowBlur = 16;
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      } else if (pu.type === 3) {
        ctx.save();
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const rr = i % 2 === 0 ? r * 0.95 : r * 0.42;
          const px = cx + Math.cos(a) * rr;
          const py = cy + Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,80,80,0.18)';
        ctx.strokeStyle = 'rgba(255,80,80,0.95)';
        ctx.lineWidth = Math.max(1, cell * 0.10);
        ctx.shadowColor = 'rgba(255,80,80,0.65)';
        ctx.shadowBlur = 18;
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.22, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.90)';
        ctx.fill();
        ctx.restore();
      } else if (pu.type === 4) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.55, cy - r * 0.05);
        ctx.lineTo(cx - r * 0.10, cy - r * 0.70);
        ctx.lineTo(cx - r * 0.05, cy - r * 0.22);
        ctx.lineTo(cx + r * 0.55, cy + r * 0.05);
        ctx.lineTo(cx + r * 0.10, cy + r * 0.70);
        ctx.lineTo(cx + r * 0.05, cy + r * 0.22);
        ctx.closePath();
        ctx.fillStyle = 'rgba(170,120,255,0.20)';
        ctx.strokeStyle = 'rgba(190,150,255,0.96)';
        ctx.lineWidth = Math.max(1, cell * 0.10);
        ctx.shadowColor = 'rgba(190,150,255,0.70)';
        ctx.shadowBlur = 18;
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.90, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(190,150,255,0.22)';
        ctx.lineWidth = Math.max(1, cell * 0.06);
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();
    }
    powerUpScreenPos = nextPuScreenPos;
  } else if (powerUpScreenPos.length) {
    powerUpScreenPos = [];
  }

  if (fxEnabled && fxParticles.length) {
    for (let i = fxParticles.length - 1; i >= 0; i--) {
      const p0 = fxParticles[i];
      const bornAt = typeof p0.bornAt === 'number' ? p0.bornAt : p0.t0;
      const lastAt = typeof p0.lastAt === 'number' ? p0.lastAt : p0.t0;
      const age = nowFrame - bornAt;
      if (age > 520) {
        fxParticles.splice(i, 1);
        continue;
      }
      const dt = Math.min(40, Math.max(0, nowFrame - lastAt));
      p0.x += p0.vx * dt;
      p0.y += p0.vy * dt;
      p0.lastAt = nowFrame;

      if (
        p0.x < minX - OFFSCREEN_MARGIN_CELLS ||
        p0.x > maxX + OFFSCREEN_MARGIN_CELLS ||
        p0.y < minY - OFFSCREEN_MARGIN_CELLS ||
        p0.y > maxY + OFFSCREEN_MARGIN_CELLS
      ) {
        continue;
      }
      const a = (1 - age / 520) * (0.50 + 0.40 * fxIntensity);
      const cx = offsetX + p0.x * cell;
      const cy = offsetY + p0.y * cell;
      const rr = Math.max(1, cell * p0.r);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.shadowColor = p0.c;
      ctx.shadowBlur = Math.max(6, cell * 0.45);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  ctx.font = `12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial`;

  for (const p of clientState.lastState.players) {
    if (!p.a) continue;
    const ip = getInterpPlayer(p.n, interp) || { ...p, ix: p.x, iy: p.y };
    const c = boostHsl(colors.get(p.n) || p.c || 'hsl(210 20% 60%)');
    const px = offsetX + (ip.ix + 0.5) * cell;
    const py = offsetY + (ip.iy + 0.5) * cell;

    const [dx, dy] = dirVec(ip.d);
    if (fxEnabled && p.n === you && speedActive) {
      ctx.save();
      ctx.globalAlpha = 0.55 * (0.35 + fxIntensity * 0.65);
      ctx.strokeStyle = c;
      ctx.shadowColor = c;
      ctx.shadowBlur = Math.max(10, cell * 0.9);
      ctx.lineWidth = Math.max(2, cell * 0.14);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px - dx * cell * 0.85, py - dy * cell * 0.85);
      ctx.stroke();
      ctx.restore();
    }

    const isBounty = !!(bountyTarget && p.n === bountyTarget);
    // Байт `sh` — битовая маска: бит0 = щит, бит1 = неуязвимость после респавна.
    const shMask = Number(ip.sh) || 0;
    const hasShield = (shMask & 1) !== 0;
    const hasInvuln = (shMask & 2) !== 0;
    const hasSpeed = !!(p.n === you && speedActive);
    const speedType = hasSpeed ? (youSpeedType === 4 ? 4 : 2) : 0;

    if (hasInvuln) {
      const tt = performance.now() * 0.010 + (p.n % 997) * 0.02;
      const pulse = 0.5 + 0.5 * Math.sin(tt);
      ctx.save();
      ctx.globalAlpha = 0.30 + 0.30 * pulse;
      ctx.setLineDash([Math.max(2, cell * 0.14), Math.max(2, cell * 0.12)]);
      ctx.lineDashOffset = -performance.now() * 0.04;
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.lineWidth = Math.max(1, cell * 0.07);
      ctx.beginPath();
      ctx.arc(px, py, cell * (0.54 + 0.04 * pulse), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (hasShield) {
      const tt = performance.now() * 0.004 + (p.n % 997) * 0.01;
      const pulse = 0.5 + 0.5 * Math.sin(tt);
      const rr = cell * (0.46 + 0.04 * pulse);
      ctx.save();
      ctx.globalAlpha = 0.22 + 0.18 * pulse;
      ctx.strokeStyle = 'rgba(120,200,255,0.95)';
      ctx.shadowColor = 'rgba(120,200,255,0.95)';
      ctx.shadowBlur = Math.max(10, cell * 0.8);
      ctx.lineWidth = Math.max(2, cell * 0.10);
      ctx.beginPath();
      ctx.arc(px, py, rr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (hasSpeed) {
      const tt = performance.now() * 0.006 + (p.n % 997) * 0.02;
      const pulse = 0.5 + 0.5 * Math.sin(tt);
      const rr = cell * (speedType === 4 ? (0.64 + 0.035 * pulse) : (0.60 + 0.03 * pulse));
      ctx.save();
      ctx.globalAlpha = (speedType === 4 ? 0.18 : 0.16) + (speedType === 4 ? 0.14 : 0.12) * pulse;
      ctx.strokeStyle = speedType === 4 ? 'rgba(190,150,255,0.94)' : 'rgba(255,215,0,0.92)';
      ctx.shadowColor = speedType === 4 ? 'rgba(190,150,255,0.85)' : 'rgba(255,215,0,0.75)';
      ctx.shadowBlur = Math.max(8, cell * (speedType === 4 ? 0.85 : 0.7));
      ctx.lineWidth = Math.max(2, cell * (speedType === 4 ? 0.095 : 0.08));
      if (speedType === 4) {
        ctx.beginPath();
        ctx.arc(px, py, rr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha *= 0.60;
        ctx.lineWidth = Math.max(1, cell * 0.06);
        ctx.beginPath();
        ctx.arc(px, py, rr * 0.82, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.setLineDash([Math.max(2, cell * 0.10), Math.max(2, cell * 0.10)]);
        ctx.lineDashOffset = -performance.now() * 0.02;
        ctx.beginPath();
        ctx.arc(px, py, rr, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Голова и направляющий нос — единый drawHead, тот же и в магазине.
    drawHead(ctx, px, py, cell, c, ip.cosHead, dx, dy, nowFrame);

    if (isBounty) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,80,80,0.95)';
      ctx.lineWidth = Math.max(2, cell * 0.11);
      ctx.setLineDash([Math.max(3, cell * 0.16), Math.max(2, cell * 0.10)]);
      ctx.lineDashOffset = -performance.now() * 0.03;
      ctx.shadowColor = 'rgba(255,80,80,0.75)';
      ctx.shadowBlur = Math.max(10, cell * 0.75);
      ctx.beginPath();
      ctx.arc(px, py, cell * 0.70, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (hasShield || hasSpeed || isBounty || hasInvuln) {
      const badges = [];
      if (hasInvuln) badges.push({ fill: 'rgba(255,255,255,0.95)', stroke: 'rgba(0,0,0,0.35)' });
      if (hasShield) badges.push({ fill: 'rgba(120,200,255,0.95)', stroke: 'rgba(255,255,255,0.25)' });
      if (hasSpeed) badges.push({ fill: speedType === 4 ? 'rgba(190,150,255,0.95)' : 'rgba(255,215,0,0.95)', stroke: 'rgba(255,255,255,0.25)' });
      if (isBounty) badges.push({ fill: 'rgba(255,80,80,0.95)', stroke: 'rgba(255,255,255,0.25)' });

      const br = Math.max(2, cell * 0.075);
      const gap = br * 2.25;
      const bx0 = px - ((badges.length - 1) * gap) / 2;
      const by = py - cell * 0.72;
      ctx.save();
      ctx.globalAlpha = 0.95;
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 6;
      for (let i = 0; i < badges.length; i++) {
        const b = badges[i];
        const bx = bx0 + i * gap;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fillStyle = b.fill;
        ctx.fill();
        ctx.lineWidth = Math.max(1, cell * 0.03);
        ctx.strokeStyle = b.stroke;
        ctx.stroke();
      }
      ctx.restore();
    }

    /* Титул идёт перед ником — он виден всем, кто видит плашку.
       C4: у бота перед титулом идёт глиф архетипа. В канвасе CSS-бейджа быть
       не может, поэтому берём тот же символ, что рисует .botArch::before —
       один знак, плашка от него почти не растёт, а «кто передо мной» читается
       ещё до того, как бот что-то сделает. */
    const archGlyph = botArchGlyph(ip.n);
    const label = `${archGlyph ? `${archGlyph} ` : ''}${cosTitlePrefix(cosTitleByPlayer.get(ip.n) || 0)}${ip.nm ? String(ip.nm) : String(ip.n)}`;
    // Плашка ника — единый drawNamePlate, тот же и в магазине.
    drawNamePlate(ctx, label, px, py - cell * 0.58, c, ip.cosNameplate, 0.95, 12, nowFrame);
  }

  // I4: радар угрозы. Дуга по краю экрана в направлении чужой головы ближе
  // 25 клеток, пока игрок вне своей территории. Интенсивность растёт при сближении.
  if (fxEnabled && my && my.a && !youInOwnZone) {
    const reduce = prefersReducedMotion();
    const hx = my.ix + 0.5;
    const hy = my.iy + 0.5;
    const ecx = cw / 2;
    const ecy = viewH / 2;
    const rx = Math.max(40, cw / 2 - 16);
    const ry = Math.max(40, viewH / 2 - 16);
    const THREAT_CELLS = 25;
    let drawn = 0;

    for (const p of clientState.lastState.players) {
      if (!p.a || p.n === you) continue;
      const dx = p.x + 0.5 - hx;
      const dy = p.y + 0.5 - hy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= THREAT_CELLS) continue;

      const inten = Math.max(0, Math.min(1, 1 - dist / THREAT_CELLS));
      const ang = Math.atan2(dy, dx);
      const pulse = reduce ? 1 : 0.8 + 0.2 * Math.sin(nowFrame * 0.012 + p.n * 0.7);
      const span = 0.28 + 0.34 * inten;
      const col = bountyTarget && p.n === bountyTarget ? 'rgba(255,140,60,0.95)' : 'rgba(255,70,92,0.95)';

      ctx.save();
      ctx.globalAlpha = Math.min(0.9, (0.14 + 0.66 * inten * inten) * pulse);
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(3, 4 + 13 * inten);
      ctx.strokeStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.ellipse(ecx, ecy, rx, ry, 0, ang - span, ang + span);
      ctx.stroke();
      ctx.restore();

      if (++drawn >= 4) break;
    }
  }

  // F18: счётчик длины следа у головы + компас в сторону ближайшей своей клетки.
  if (my && my.a && started) {
    const hpx = offsetX + (my.ix + 0.5) * cell;
    const hpy = offsetY + (my.iy + 0.5) * cell;
    const fontPx = Math.max(11, Math.round(cell * 0.60));

    if (youTrailLen > 0) {
      const risky = youTrailLen >= TRAIL_PULSE_FROM;
      const txt = String(youTrailLen);
      ctx.save();
      ctx.font = `700 ${fontPx}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.92)';
      ctx.strokeText(txt, hpx, hpy + cell * 0.98);
      ctx.fillStyle = risky ? 'rgba(255,190,80,0.98)' : 'rgba(255,255,255,0.90)';
      ctx.fillText(txt, hpx, hpy + cell * 0.98);
      ctx.restore();
    }

    if (!youInOwnZone && youNearestHomeX >= 0) {
      const ax = youNearestHomeX + 0.5 - (my.ix + 0.5);
      const ay = youNearestHomeY + 0.5 - (my.iy + 0.5);
      const dlen = Math.sqrt(ax * ax + ay * ay);
      if (dlen > 1.2) {
        const ang = Math.atan2(ay, ax);
        const rr = cell * 1.25;
        const tipX = hpx + Math.cos(ang) * rr;
        const tipY = hpy + Math.sin(ang) * rr;
        const wgt = cell * 0.26;
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = 'rgba(120,255,190,0.95)';
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = Math.max(1, cell * 0.05);
        ctx.beginPath();
        ctx.moveTo(tipX + Math.cos(ang) * wgt, tipY + Math.sin(ang) * wgt);
        ctx.lineTo(tipX + Math.cos(ang + 2.4) * wgt, tipY + Math.sin(ang + 2.4) * wgt);
        ctx.lineTo(tipX + Math.cos(ang - 2.4) * wgt, tipY + Math.sin(ang - 2.4) * wgt);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    // F15: пока игрок ни разу не замкнул петлю, компас — слишком тихая
    // подсказка. Ведём пунктирную линию прямо к своей земле и подписываем её.
    if (obGuideActive() && !youInOwnZone && youNearestHomeX >= 0) {
      const tx = offsetX + (youNearestHomeX + 0.5) * cell;
      const ty = offsetY + (youNearestHomeY + 0.5) * cell;
      const ddx = tx - hpx;
      const ddy = ty - hpy;
      const dpx = Math.sqrt(ddx * ddx + ddy * ddy);
      if (dpx > cell * 1.5) {
        const ang = Math.atan2(ddy, ddx);
        // Линия не доходит до самой головы и до самой цели — чтобы не мешать.
        const x0 = hpx + Math.cos(ang) * cell * 0.9;
        const y0 = hpy + Math.sin(ang) * cell * 0.9;
        const reduce = prefersReducedMotion();
        const pulse = reduce ? 0.85 : 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(nowFrame * 0.006));

        ctx.save();
        ctx.globalAlpha = 0.9 * pulse;
        ctx.strokeStyle = 'rgba(120,255,190,0.95)';
        ctx.lineWidth = Math.max(2, cell * 0.16);
        ctx.lineCap = 'round';
        ctx.setLineDash([Math.max(4, cell * 0.5), Math.max(4, cell * 0.45)]);
        ctx.lineDashOffset = reduce ? 0 : -nowFrame * 0.06;
        ctx.shadowColor = 'rgba(0,0,0,0.65)';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.setLineDash([]);

        // Наконечник у цели.
        const hw = Math.max(6, cell * 0.55);
        ctx.fillStyle = 'rgba(120,255,190,0.98)';
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx + Math.cos(ang + 2.5) * hw, ty + Math.sin(ang + 2.5) * hw);
        ctx.lineTo(tx + Math.cos(ang - 2.5) * hw, ty + Math.sin(ang - 2.5) * hw);
        ctx.closePath();
        ctx.fill();

        // Подпись у цели, но всегда внутри вьюпорта.
        const label = t('onb.return_here');
        const lf = Math.max(12, Math.round(cell * 0.85));
        ctx.font = `800 ${lf}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = 1;
        const lx = Math.max(70, Math.min(cw - 70, tx));
        const ly = Math.max(28, Math.min(viewH - 28, ty - cell * 1.4));
        ctx.lineJoin = 'round';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(0,0,0,0.9)';
        ctx.strokeText(label, lx, ly);
        ctx.fillStyle = 'rgba(160,255,215,0.98)';
        ctx.fillText(label, lx, ly);
        ctx.restore();
      }
    }
  }

  if (!chat.classList.contains('collapsed')) {
    if (!chat.contains(document.activeElement) && performance.now() > chatOpenUntil) {
      setChatCollapsed(true);
    }
  }

  if (minimapDirty || minimapHadChunkUpdate || nowFrame - lastMinimapDrawAt >= MINIMAP_REFRESH_MS) {
    drawMinimap();
    lastMinimapDrawAt = nowFrame;
  }

  if (fxBursts.length) {
    for (let i = fxBursts.length - 1; i >= 0; i--) {
      const fx = fxBursts[i];
      const knd0 = String(fx.kind || '');
      const isScore = knd0 === 'score';
      // Длительность бурста — параметр: вспышка захвата живёт 650 мс,
      // эффект гибели дольше, всплывающее число — своё время.
      const life = Number(fx.life) > 0 ? Number(fx.life) : isScore ? SCORE_POPUP_MS : 650;
      const age = nowFrame - fx.t0;
      if (age > life) {
        fxBursts.splice(i, 1);
        continue;
      }
      if (!isScore && !fxEnabled) continue;
      const x = fx.x;
      const y = fx.y;
      if (
        x < minX - OFFSCREEN_MARGIN_CELLS ||
        x > maxX + OFFSCREEN_MARGIN_CELLS ||
        y < minY - OFFSCREEN_MARGIN_CELLS ||
        y > maxY + OFFSCREEN_MARGIN_CELLS
      ) {
        continue;
      }

      // J5: всплывающее число «+247» над точкой захвата.
      if (isScore) {
        const sp = Math.max(0, Math.min(1, age / SCORE_POPUP_MS));
        const v = Math.max(0, Math.round(Number(fx.value) || 0));
        if (!v) continue;
        const scale = age < 150 ? easeOutBack(age / 150) : 1;
        const alpha = sp > 0.72 ? Math.max(0, (1 - sp) / 0.28) : 1;
        const size = Math.round(12 + Math.min(28, v * 0.35));
        const sx = offsetX + (x + 0.5) * cell;
        const sy = offsetY + (y + 0.5) * cell - easeOutCubic(sp) * cell * 1.2;
        const col = v >= 300 ? 'rgba(200,130,255,1)' : v >= 100 ? 'rgba(255,210,60,1)' : 'rgba(255,255,255,1)';
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(sx, sy);
        if (scale !== 1) ctx.scale(scale, scale);
        ctx.font = `700 ${size}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.95)';
        ctx.strokeText(`+${v}`, 0, 0);
        ctx.fillStyle = col;
        ctx.fillText(`+${v}`, 0, 0);
        ctx.restore();
        continue;
      }

      const p = Math.max(0, Math.min(1, age / life));
      const cx = offsetX + (x + 0.5) * cell;
      const cy = offsetY + (y + 0.5) * cell;
      const knd = knd0;

      // Гибель: тот же drawDeathFx, что и в превью магазина.
      if (knd.startsWith('die')) {
        const dieId = cosClampId(Number(knd.slice(3)) || 0);
        const owner = Number(fx.pid);
        const ownerHsl = boostHsl(colors.get(owner) || 'hsl(210 20% 60%)');
        drawDeathFx(ctx, cx, cy, cell * (0.6 + fxIntensity * 0.7), ownerHsl, dieId, p);
        continue;
      }

      const isCap = knd.startsWith('cap');
      const base = cell * (knd === 'kill' ? 1.1 : isCap ? 1.05 : 0.85);
      const r = base * (0.35 + 1.25 * p) * (0.35 + fxIntensity * 0.95);
      const a = (1 - p) * (0.55 + 0.45 * fxIntensity);

      // Захват: тот же drawCaptureFx, что и в превью магазина. Цвет берётся
      // от игрока, совершившего захват (варианты 5..7 — со своей палитрой).
      if (isCap) {
        const capId = cosClampId(knd.slice(3));
        const owner = Number(fx.pid);
        const ownerHsl = boostHsl(colors.get(owner) || colors.get(you) || 'hsl(210 20% 60%)');
        const capCell = cell * (0.35 + fxIntensity * 0.95);
        drawCaptureFx(ctx, cx, cy, capCell, ownerHsl, capId, p);
        continue;
      }

      let col = 'rgba(255,215,0,0.92)';
      if (knd === 'kill') col = 'rgba(255,45,85,0.95)';
      // F5: возврат остывшей земли — холодный голубой, а не «золото захвата».
      else if (knd === 'reclaim') col = 'rgba(120,220,255,0.96)';
      else if (knd === 'use') col = 'rgba(0,255,255,0.95)';
      else if (knd === 'pickup2') col = 'rgba(255,215,0,0.95)';
      else if (knd === 'pickup4') col = 'rgba(190,150,255,0.96)';

      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1, cell * 0.10);
      if (knd === 'pickup4') {
        ctx.lineWidth = Math.max(2, cell * 0.10);
        for (let k = 0; k < 10; k++) {
          const ang = p * 2.0 + (k * Math.PI * 2) / 10;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(ang) * r * 0.30, cy + Math.sin(ang) * r * 0.30);
          ctx.lineTo(cx + Math.cos(ang) * r * 1.05, cy + Math.sin(ang) * r * 1.05);
          ctx.stroke();
        }
        ctx.globalAlpha = a * 0.85;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.95, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = a * 0.45;
        ctx.lineWidth = Math.max(1, cell * 0.06);
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
        ctx.stroke();
      } else if (knd === 'pickup2') {
        ctx.lineWidth = Math.max(2, cell * 0.09);
        ctx.setLineDash([Math.max(2, cell * 0.10), Math.max(2, cell * 0.10)]);
        ctx.lineDashOffset = -nowFrame * 0.03;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  if (started) {
    renderMetaHud();
    renderTopHud();
    /* K3: условие `rightSidebarEl.dataset.tab === 'team'` не выполнялось никогда
       — в разметке жёстко прописан `data-tab="match"`, и его никто не менял, так
       что живая таблица игроков не отрисовывалась ни разу за матч. Рендерим
       безусловно, но не 60 раз в секунду: таблица собирается через innerHTML. */
    const nowTeam = performance.now();
    if (nowTeam - (renderTeamHud._at || 0) >= 400) {
      renderTeamHud._at = nowTeam;
      renderTeamHud();
    }
  }

  if (deathOverlay && !deathOverlay.classList.contains('hidden')) {
    const now = performance.now();
    if (now - (lastDeathStatsAt || 0) > 500) {
      lastDeathStatsAt = now;
      renderDeathStats();
    }
  }

  fpsFrames++;
  const now = performance.now();
  const dtFps = now - fpsLast;
  if (dtFps >= 500) {
    const inst = (fpsFrames * 1000) / dtFps;
    fps = fps ? lerp(fps, inst, 0.2) : inst;
    fpsFrames = 0;
    fpsLast = now;
  }

  if (bytesSampleAt == null) {
    bytesSampleAt = now;
    bytesInSample = bytesInTotal;
    bytesOutSample = bytesOutTotal;
  } else {
    const dtNet = now - bytesSampleAt;
    if (dtNet >= 500) {
      const dtSec = dtNet / 1000;
      const instDown = (bytesInTotal - bytesInSample) / dtSec;
      const instUp = (bytesOutTotal - bytesOutSample) / dtSec;
      downBps = downBps ? lerp(downBps, instDown, 0.2) : instDown;
      upBps = upBps ? lerp(upBps, instUp, 0.2) : instUp;
      bytesSampleAt = now;
      bytesInSample = bytesInTotal;
      bytesOutSample = bytesOutTotal;
    }
  }

  const pingText = pingMs == null ? '…' : `${pingMs.toFixed(0)}ms`;
  const upText = formatRate(upBps);
  const downText = formatRate(downBps);
  const tr = tickrate ? `${tickrate.toFixed(1)}` : '…';
  const sr = tickMs ? `${(1000 / tickMs).toFixed(1)}` : '…';
  const rid = roomId == null ? '…' : String(roomId);

  const fpsText = fps ? fps.toFixed(0) : '…';
  const srvNum = tickMs ? 1000 / tickMs : null;
  const tickBad = srvNum != null && tickrate ? tickrate < srvNum * 0.8 : tr === '…';

  const roomBad = roomId == null;
  const fpsBad = fps ? fps < 30 : fpsText === '…';
  const pingBad = pingMs == null ? true : pingMs > 150;
  const upBad = upText === '…';
  const downBad = downText === '…';
  const srvBad = srvNum == null;

  if (!perfEnabled) {
    return;
  }

  setSafeHtml(perfEl, `
    <div class="perfRow">${escapeHtml(t('perf.room'))}: ${perfValueSpan(rid, roomBad)}</div>
    <div class="perfRow">${escapeHtml(t('perf.fps'))}: ${perfValueSpan(fpsText, fpsBad)}</div>
    <div class="perfRow">${escapeHtml(t('perf.ping'))}: ${perfValueSpan(pingText, pingBad)}</div>
    <div class="perfRow">${escapeHtml(t('perf.traffic'))}: ↑ ${perfValueSpan(upText, upBad)}&nbsp;&nbsp;↓ ${perfValueSpan(downText, downBad)}</div>
    <div class="perfRow">${escapeHtml(t('perf.ticks'))}: ${perfValueSpan(tr, tickBad)} (${escapeHtml(t('perf.server'))} ${perfValueSpan(sr, srvBad)})</div>
  `);
}

bindSettingsUi();
bindCosmeticsUi();

draw();
