/* Экраны конца: пауза и наезд камеры на смерть, оверлей смерти, оверлей итогов
   матча и всё, что происходит на границе матча (фазы, обратный отсчёт, сброс
   клиента под новый матч).

   Модуль берёт состояние по ссылке из client_store.js и узлы из client_dom.js,
   поэтому deps-объекты ему не нужны. Снаружи приходят только две вещи, которые
   импортом не взять без цикла: отправка в сокет и общий с отрисовкой кэш
   стилей заливки. Обе — через initEndgame(). */

import { clientState } from './client_state.js';
import { KEYS, storageBump, storageGet, storageSetFlag } from './client_storage.js';
import { cos, fxRt, match, me, resetForNewMatch, session } from './client_store.js';
import { dom } from './client_dom.js';
import { infoPack, t, tfmt } from './client_i18n_rt.js';
import {
  applyMatchPhaseImpl,
  onMatchEndImpl,
  onMatchStartImpl,
  runMatchResultsCascadeImpl,
  updateMatchCountdownImpl
} from './client_match.js';
import {
  renderDeathReasonImpl,
  renderDeathStatsImpl,
  renderMatchResultsImpl,
  showDeathOverlayImpl,
  updateDeathZoomImpl
} from './client_death_ui.js';
import {
  phaseDesc,
  phaseIcon,
  phaseLabel,
  renderMetaHudImpl as renderMetaHud,
  renderTeamHudImpl as renderTeamHud,
  renderTopHudImpl as renderTopHud
} from './client_hud.js';
import {
  animateNumber,
  comboBreak,
  comboReset,
  showBigBanner,
  triggerHitstop
} from './client_fx_rt.js';
import { fxCountUpEnabled, fxHitstopScale, prefersReducedMotion } from './client_fx_preset.js';
import { sfx } from './client_sfx.js';
import { vibrate } from './client_settings.js';
import { addToast, dismissRoundModToasts, resetToasts } from './client_toasts.js';
import { hideAllOverlays, syncOverlayUiState } from './client_overlays.js';
import { easeOutCubic, escapeHtml, overlayManager, setSafeHtml } from './client_util.js';
import { setChatCollapsed, toggleEmojiPanel } from './client_chat.js';
import {
  obAnnounceShopImpl,
  obBumpDeaths,
  obDeathsSeen,
  obResetMatch
} from './client_onboarding.js';
import {
  approxNowTick,
  contractLabel,
  deathReasonHint,
  deathReasonText,
  fmtInt,
  fmtPct1,
  reclaimWindowSec,
  styleLabel
} from './client_labels.js';
import { displayNameFrom, playerTitleHtml } from './client_identity.js';
import { cosClampId } from './client_cos_draw.js';
import { COSMETICS_CATS, missingFor } from './client_cos_model.js';
import {
  cosmeticsCheapestPrice,
  cosmeticsOwnedCount,
  showCosmeticsOverlay
} from './client_shop.js';
import { resetLeaderboardUi } from './client_leaderboard.js';
import {
  eventFeed,
  getRightTeamBadgeEl,
  getTeamUnreadCount,
  renderKillfeed,
  setBadgeCount,
  setTeamUnreadCount,
  syncRightEmptyStates
} from './client_hud_panels.js';
import { minimapOwnerRgbCache } from './client_minimap_ui.js';
import { commitBestPct as commitBest, sortPlayersByScore } from './client_stats.js';

let wsSend = () => {};
/* Кэш стилей заливки общий с отрисовкой в client.js: сброс на границе матча
   обязан чистить именно его, а не свою копию. */
let ownerFillStyleCache = new Map();

/* C2: арка матча (сервер, F4/G24). Фаза приезжает в init/matchStart и
   отдельным JSON-сообщением matchPhase на каждой границе. До этого клиент
   её не читал вовсе, и удвоение очков за захват в финале было невидимым. */
// Множитель очков за захват в финале. Сервер сообщает его в hello (finalMult).
// Чтобы баннер «ФИНАЛ ×2» не повторялся при повторной доставке того же события.

/* Применяет фазу. announce=true только для реальной смены фазы по ходу матча —
   при входе в комнату посреди финала баннер не нужен. */
export function applyMatchPhase(ph, until, announce, seq) {
  applyMatchPhaseImpl(ph, until, announce, seq, {
    t,
    showBigBanner,
    phaseDesc,
    addToast,
    sfx,
    phaseLabel,
    phaseIcon,
    renderTopHud
  });
}

export function onMatchPhase(d) {
  if (!d || typeof d !== 'object') return;
  applyMatchPhase(d.phase, d.until, true, d.seq);
}

/* Итог по рекорду за ЭТУ смерть: считается один раз при показе оверлея,
   иначе повторные renderDeathStats() затирали бы «Новый рекорд». */
let deathBestShown = null;

/* Пауза между гибелью и оверлеем: игрок должен увидеть кадр, в котором его
   убили. Длительность идёт через тот же fx-пресет, что и остальная «сочность»,
   и полностью выключается при «Спокойно» / prefers-reduced-motion. */
const DEATH_SLOWMO_MS = 480;
let deathSlowMoTimer = 0;

export function beginDeathSlowMo() {
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
export function cancelDeathSlowMo() {
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
/* Сам якорь — в fxRt (client_store.js): его пишет этот модуль, а читает
   отрисовка кадра. */
let deathZoomStartAt = 0;
let deathZoomReleaseAt = 0;
let deathZoomAtRelease = 1;
let deathZoomCurrent = 1;

export function beginDeathZoom(x, y) {
  fxRt.deathZoomAnchorX = Number(x) || 0;
  fxRt.deathZoomAnchorY = Number(y) || 0;
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
export function updateDeathZoom(now) {
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

let lastDeathStatsAt = 0;

function showDeathOverlay() {
  showDeathOverlayImpl({
    deathOverlay: dom.deathOverlay,
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

/* Debug-мост (public/client_debug.js, только под ?debug=1) вызывает показ
   оверлея смерти напрямую, минуя реальную смерть в матче — тонкий экспорт по
   образцу соседних (renderDeathStats/renderDeathReason выше). */
export function showDeathOverlayDebug() {
  showDeathOverlay();
}

/* K7: под открытым оверлеем смерти таблицу итогов незачем пересобирать
   каждый кадр — throttle живёт здесь, вместе с моментом последней сборки,
   который выставляет и showDeathOverlay(). */
export function tickDeathStats() {
  const now = performance.now();
  if (now - (lastDeathStatsAt || 0) <= 500) return;
  lastDeathStatsAt = now;
  renderDeathStats();
}

/* K4: раньше подсказка в оверлее смерти собиралась только внутри
   showDeathOverlay(), и setLang() её не трогал — в английском интерфейсе
   висело «Выйди из своей зоны, обведи участок…». Теперь это отдельная функция,
   которую зовёт и показ оверлея, и смена языка. */
let deathReasonDeathsSeen = 99;

export function renderDeathReason() {
  renderDeathReasonImpl({
    deathReasonEl: dom.deathReason,
    getDeathReasonDeathsSeen: () => deathReasonDeathsSeen,
    lastDeathInfo: me.lastDeathInfo,
    deathReasonText,
    deathReasonHint,
    tfmt,
    reclaimWindowSec,
    document
  });
}

function computeTopSorted(players) {
  return sortPlayersByScore(players);
}

/* Личный рекорд по доле карты живёт в client_stats.js вместе с тестами.
   Здесь остаётся только подстановка хранилища. */
function commitBestPct(pct) {
  return commitBest(pct, localStorage);
}

export function renderDeathStats() {
  renderDeathStatsImpl({
    deathStatsEl: dom.deathStats,
    clientState,
    you: session.you,
    lastYouStats: me.lastStats,
    mapCells: session.mapCells,
    youContractType: me.contractType,
    youContractProgress: me.contractProgress,
    youContractGoal: me.contractGoal,
    contractLabel,
    infoPack,
    computeTopSorted,
    cosClampId,
    playerTitleHtml,
    cosTitleByPlayer: cos.titleByPlayer,
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
    youKills: me.kills,
    rightTeamDetailsEl: dom.rightTeamDetails,
    renderTeamHudState: renderTeamHud,
    teamUnreadCount: getTeamUnreadCount,
    setTeamUnreadCount,
    setBadgeCount,
    rightTeamBadgeEl: getRightTeamBadgeEl(),
    syncRightEmptyStates
  });
}

export function syncMatchOverlayActions() {
  if (!dom.matchContinueBtn) return;
  const waiting = !!match.continuePending;
  dom.matchContinueBtn.disabled = waiting;
  dom.matchContinueBtn.setAttribute('aria-disabled', waiting ? 'true' : 'false');
  dom.matchContinueBtn.textContent = waiting ? t('match.starting') : t('match.play_on');
}

export function showMatchOverlay() {
  cancelDeathSlowMo();
  if (dom.matchOverlay) dom.matchOverlay.classList.remove('hidden');
  if (dom.matchActions) dom.matchActions.classList.add('hidden');
  overlayManager.open('match');
  syncOverlayUiState();
  syncMatchOverlayActions();

  // J16: конец матча был беззвучным.
  comboReset();
  /* Строки итогов раньше лежали в локальной lastMatchResults; после переезда
     состояния в стор ссылка на неё осталась в коде и любой конец матча падал
     здесь с ReferenceError, не доиграв даже звук. Источник один — match.lastResults. */
  const rows = Array.isArray(match.lastResults) ? match.lastResults : [];
  const meIdx = rows.findIndex((r) => (Number(r?.n) || 0) === session.you);
  if (meIdx === 0) sfx.victory();
  else sfx.defeat();

  runMatchResultsCascade();
  overlayManager.focusDefault('match');
}

export function hideMatchOverlay() {
  if (dom.matchOverlay) dom.matchOverlay.classList.add('hidden');
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


function matchesPlayed() {
  return Math.max(0, Number(storageGet(KEYS.matchesPlayed)) || 0);
}

function bumpMatchesPlayed() {
  storageBump(KEYS.matchesPlayed);
}

/* F15/F17 — мягкая первая сессия. Остальные обёртки онбординга остались в
   client.js; сюда переехала только эта: её зовёт onMatchStart, и держать её
   на той стороне значило бы гонять вызов через ctx. */
export function obAnnounceShop() {
  obAnnounceShopImpl({ addToast, t });
}

// F16: крючок «до первого скина N ✨» на экране результатов первого матча.
function firstSkinHookHtml() {
  if (matchesPlayed() > 1) return '';
  let owned = 0;
  for (const cat of COSMETICS_CATS) owned += Math.max(0, cosmeticsOwnedCount(cat) - 1);
  if (owned > 0) return '';

  const price = cosmeticsCheapestPrice();
  if (price <= 0) return '';
  const have = Math.max(0, Math.floor(Number(cos.style) || 0));
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

function runMatchResultsCascade() {
  runMatchResultsCascadeImpl({ matchResultsEl: dom.matchResults, fxCountUpEnabled, animateNumber, sfx });
}

export function renderMatchResults(results) {
  renderMatchResultsImpl({
    results,
    matchResultsEl: dom.matchResults,
    you: session.you,
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
    cosTitleByPlayer: cos.titleByPlayer,
    contractLabel,
    pointsBreakdownText,
    styleBreakdownText,
    firstSkinHookHtml,
    matchAutoJoin: match.autoJoin,
    matchContinueBtn: dom.matchContinueBtn,
    matchMenuBtn: dom.matchMenuBtn,
    hideMatchOverlay,
    showCosmeticsOverlay,
    setMatchAutoJoin: (v) => {
      match.autoJoin = v;
      storageSetFlag(KEYS.matchAutoJoin, v);
    }
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

export function updateMatchCountdown() {
  updateMatchCountdownImpl({ matchCountdownEl: dom.matchCountdown, matchEnded: match.ended, matchResetAt: match.resetAt, approxNowTick, tickMs: session.tickMs, syncMatchOverlayActions });
}

/* Сброс на границе матча.

   Раньше это была функция на 150 строк в client_match.js: она принимала 21
   значение, заводила сорок локальных `nextX` и возвращала их объектом,
   который здесь переписывался обратно по полю. Логики в ней было строк на
   двадцать — всё остальное было платой за то, что состояние лежало в чужом
   файле.

   Общая часть теперь в resetForNewMatch() (client_store.js), здесь — то, что
   к состоянию не относится: кэши отрисовки, DOM и перерисовка панелей. */
export function resetClientForNewMatch() {
  if (match.continueTimeout) {
    clearTimeout(match.continueTimeout);
    match.continueTimeout = 0;
  }
  match.continuePending = false;

  resetForNewMatch();

  /* K2: номера игроков в новом матче раздаются заново — кэши по номеру нужно
     обнулить, иначе враг ещё несколько минут рисуется цветом прошлого хозяина
     номера, а два игрока могут оказаться одного цвета.

     C7: карты «по номеру игрока» (имена, косметика) при этом НЕ чистятся
     намеренно. Сервер при matchStart не пересылает ни nameUpdateBatch, ни
     cosExtra — обе рассылки привязаны к входу в комнату, — поэтому очистка
     оставила бы всех без имён и косметики до следующего события. Номера
     внутри комнаты между матчами не переигрываются; переигрываются они при
     входе, там очистка и стоит (см. onInit). */
  ownerFillStyleCache.clear();
  minimapOwnerRgbCache.clear();

  eventFeed.length = 0;
  resetToasts();
  comboReset();

  clientState.lastState = null;
  clientState.camX = null;
  clientState.camY = null;
  clientState.camLeadX = 0;
  clientState.camLeadY = 0;

  try {
    if (dom.killfeed) dom.killfeed.replaceChildren();
  } catch {}
  /* C8/C7: DOM киллфида и мета-панели очищен вручную — подписи, по которым
     эти панели решают «ничего не изменилось, перерисовывать нечего», обязаны
     протухнуть вместе с ним. */
  renderKillfeed._sig = null;
  renderMetaHud._sig = null;
  renderTopHud._placeSig = null;

  resetLeaderboardUi();
  renderKillfeed();
  renderMetaHud();
  renderTopHud();
  syncMatchOverlayActions();
}

export function onMatchEnd(d) {
  onMatchEndImpl(d, {
    hideOverlays,
    bumpMatchesPlayed,
    renderMatchResults,
    updateMatchCountdown,
    showMatchOverlay
  });
}

export function onMatchStart(d) {
  onMatchStartImpl(d, {
    applyMatchPhase,
    resetClientForNewMatch,
    hideMatchOverlay,
    hideOverlays,
    toggleEmojiPanel,
    syncMatchOverlayActions,
    obResetMatch,
    obAnnounceShop,
    updateMatchCountdown,
    showMatchOverlay
  });
}

export function hideOverlays() {
  /* Пауза перед оверлеем смерти могла «выстрелить» уже после конца матча —
     тогда экран смерти всплывал поверх итогов. Снимаем таймер вместе с ними. */
  cancelDeathSlowMo();
  /* K7: флаг залипал — оверлей магазина скрыт, а cos.open остаётся true,
     и каждое начисление Стиля запускало полную пересборку DOM скрытого
     магазина (замер 3.3 мс на начисление). */
  cos.open = false;
  hideAllOverlays();
}

export function initEndgame(ctx) {
  wsSend = ctx.wsSend;
  ownerFillStyleCache = ctx.ownerFillStyleCache;

  dom.matchContinueBtn?.addEventListener('click', () => {
    if (match.ended) {
      match.continuePending = true;
      syncMatchOverlayActions();
      if (match.continueTimeout) {
        clearTimeout(match.continueTimeout);
        match.continueTimeout = 0;
      }
      match.continueTimeout = setTimeout(() => {
        match.continueTimeout = 0;
        if (match.ended && match.continuePending) {
          match.continuePending = false;
          syncMatchOverlayActions();
        }
      }, 4000);
      wsSend('matchContinue', {});
      return;
    }
    hideMatchOverlay();
  });

  dom.matchMenuBtn?.addEventListener('click', (e) => {
    e?.preventDefault?.();
    hideMatchOverlay();
    if (match.continueTimeout) {
      clearTimeout(match.continueTimeout);
      match.continueTimeout = 0;
    }
    match.continuePending = false;
    dom.leaveBtn?.click();
  });

  dom.restartBtn?.addEventListener('click', () => {
    wsSend('respawn', { rejoin: true });
    hideOverlays();
    session.started = true;
    me.streak = 0;
    me.lastDeathInfo = null;
    me.lastStats = null;
  });

  dom.deathMenuBtn?.addEventListener('click', () => {
    dom.leaveBtn?.click();
  });
}
