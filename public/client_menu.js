/* Экран меню и список комнат.
 *
 * Модуль собирает вместе всё, что игрок видит до входа в матч: поле ника,
 * блок «Играть», мета-крючок с дейликами, список комнат с поиском/сортировкой
 * и форму создания комнаты. Разметку и состояние он берёт импортом (dom и
 * группы стора), поэтому deps-объектов наружу здесь нет.
 *
 * Импортом не берутся ровно те вещи, что зависят от сетевого модуля: он
 * собирается в client.js ниже по файлу, и импорт отсюда дал бы цикл. Они
 * приходят один раз через initMenu().
 */

import { dom } from './client_dom.js';
import { KEYS, storageFlag, storageSetFlag } from './client_storage.js';
import { cos, dailySlots, me, rooms, session, setPlayerName } from './client_store.js';
import { formatNumber, t } from './client_i18n_rt.js';
import { escapeHtml, normalizeMenuNickInput, overlayManager, sanitizeNameClient, sanitizeRoomTitleClient, setSafeHtml } from './client_util.js';
import { isOverlayOpen, syncOverlayUiState } from './client_overlays.js';
import { addToast } from './client_toasts.js';
import { dailyLabel, fmtInt } from './client_labels.js';
import { COSMETICS_CATS, missingFor } from './client_cos_model.js';
import { renderMenuMetaImpl, showMenuOverlayImpl, updateMenuNameUiImpl } from './client_menu_ui.js';
import {
  renderRoomsList,
  renderRoomsEmpty,
  updateRoomsStats,
  syncRoomsSearchClearUiImpl,
  clearRoomsSearchImpl,
  attemptJoinRoomImpl,
  setRoomsCreateOpenImpl,
  updateRoomsCreateUiImpl,
  applyRoomsFilterSortImpl,
  updateRoomsUiImpl,
  updateRoomInfoImpl
} from './client_rooms_ui.js';
import { onError as onErrorImpl } from './client_ws_handlers.js';
import { cancelDeathSlowMo } from './client_endgame.js';
import { updateChatHeaderStatus } from './client_chat.js';
import {
  cosmeticsCheapestPrice,
  cosmeticsOpClear,
  cosmeticsOwnedCount,
  scheduleMenuSkinPreview,
  setCosmeticsStatus,
  stopMenuSkinPreview,
  syncCosmeticsUi
} from './client_shop.js';

let wsSend = () => false;
let wsIsConnected = () => false;
let wsStatusSuffix = () => '';
let connectWs = () => {};
let trackEvent = () => {};
let markJoinFunnelStart = () => {};
let rejoinGiveUp = () => {};
let rejoinFinish = () => {};


export function getMenuControlsSeen() {
  return storageFlag(KEYS.menuControlsSeen, false);
}

export function setMenuControlsSeen() {
  storageSetFlag(KEYS.menuControlsSeen, true);
}

export function syncMenuOnboardingUi() {
  /* Тот же признак гасит и подсказку про свайп поверх поля (#helpTouch,
     12-mobile.css): игрок, который уже поехал, управление знает, а строка
     висела весь матч и все следующие. Класс ставится до проверки ниже —
     подсказка в меню и подсказка в матче живут в разных узлах, и отсутствие
     одного не повод не обновить другой. */
  document.body.classList.toggle('controlsSeen', getMenuControlsSeen());
  if (!dom.menuOnboarding) return;
  dom.menuOnboarding.classList.toggle('hidden', getMenuControlsSeen());
}

export function updateMenuNameUi() {
  updateMenuNameUiImpl({ menuNameInput: dom.menuNameInput, normalizeMenuNickInput, playBtn: dom.playBtn, menuNameError: dom.menuNameError, t });
}

// Гарантирует непустой ник перед стартом: пустое поле заполняется случайным.
function ensureNickBeforePlay() {
  if (!dom.menuNameInput) return true;
  const v = normalizeMenuNickInput(dom.menuNameInput.value);
  if (!v.raw) {
    dom.menuNameInput.value = randomNickValue();
    updateMenuNameUi();
  }
  return !dom.playBtn || !dom.playBtn.disabled;
}

function randomNickValue() {
  const prefix = t('menu.nick_random_prefix');
  const n = Math.floor(1000 + Math.random() * 9000);
  return `${prefix} ${n}`;
}

function applyRandomNick() {
  if (!dom.menuNameInput) return;
  dom.menuNameInput.value = randomNickValue();
  updateMenuNameUi();
  try {
    dom.menuNameInput.focus();
  } catch {}
}

export function submitName() {
  const nm = setPlayerName(sanitizeNameClient(dom.nameInput.value));
  if (!nm) return;
  if (dom.menuNameInput) dom.menuNameInput.value = nm;
  wsSend('setName', { name: nm });
}

function submitNameFromInput(el) {
  const nm = setPlayerName(sanitizeNameClient(el?.value));
  if (!nm) return null;
  dom.nameInput.value = nm;
  if (dom.menuNameInput) dom.menuNameInput.value = nm;
  wsSend('setName', { name: nm });
  updateMenuNameUi();
  return nm;
}

export function showMenuOverlay() {
  showMenuOverlayImpl({
    cancelDeathSlowMo,
    menuOverlay: dom.menuOverlay,
    deathOverlay: dom.deathOverlay,
    overlayManager,
    setStarted: (v) => {
      session.started = v;
    },
    setYouAlive: (v) => {
      session.youAlive = v;
    },
    updateMenuNameUi,
    syncMenuOnboardingUi,
    setCreateRoomPending: (v) => {
      rooms.createPending = v;
    },
    updateRoomsCreateUi,
    setLastYouStats: (v) => {
      me.lastStats = v;
    },
    getRoomsLoadTimeout: () => rooms.loadTimeout,
    setRoomsLoadTimeout: (v) => {
      rooms.loadTimeout = v;
    },
    getRoomsLoading: () => rooms.loading,
    setRoomsLoading: (v) => {
      rooms.loading = v;
    },
    getLastRooms: () => rooms.last,
    topHudEl: dom.topHud,
    setYouStreak: (v) => {
      me.streak = v;
    },
    syncOverlayUiState,
    scheduleMenuSkinPreview,
    renderMenuMeta
  });
}

export function hideMenuOverlay() {
  if (dom.menuOverlay) dom.menuOverlay.classList.add('hidden');
  stopMenuSkinPreview();
  overlayManager.close('menu');
  syncOverlayUiState();
}

/* Мета-крючок на экране меню: активные дейлики и прогресс до первого скина.
   Блок пустой (и скрыт CSS-ом), пока сервер не прислал ни задач, ни баланса —
   на первом экране новичка он ничего не должен обещать. */

export function renderMenuMeta() {
  renderMenuMetaImpl({
    menuMetaEl: dom.menuMeta,
    menuOverlay: dom.menuOverlay,
    dailySlots,
    youDailies: me.dailies,
    dailyLabel,
    escapeHtml,
    t,
    fmtInt,
    COSMETICS_CATS,
    cosmeticsOwnedCount,
    cosmeticsCheapestPrice,
    missingFor,
    getYouStyle: () => cos.style,
    setSafeHtml
  });
}

/* C7: слотов ежедневок у сервера три (sendDailyStateToPlayer шлёт 1, 2, 3), а
   клиент знал только про два: `if (slot === 1) ... else ...` затирал второй
   слот третьим, прогресс двух разных квестов писался в одни переменные и
   скакал. Теперь хранилище по номеру слота — число слотов задаёт сервер. */

export function dailySetAssign(slot, type, goal, prog) {
  const s = Number(slot) || 0;
  if (s <= 0) return;
  me.dailies.set(s, { type: Number(type) || 0, goal: Number(goal) || 0, prog: Number(prog) || 0 });
  // Дейлики видны и на экране меню — держим блок в актуальном состоянии.
  try {
    renderMenuMeta();
  } catch {}
}

export function dailySetProgress(slot, prog) {
  const s = Number(slot) || 0;
  const it = me.dailies.get(s);
  if (!it) {
    // Прогресс раньше назначения (перезаход в комнату) — не теряем его.
    me.dailies.set(s, { type: 0, goal: 0, prog: Number(prog) || 0 });
    return;
  }
  it.prog = Number(prog) || 0;
  try {
    renderMenuMeta();
  } catch {}
}

function syncRoomsSearchClearUi() {
  syncRoomsSearchClearUiImpl({ roomsSearchClearBtn: dom.roomsSearchClearBtn, roomsSearchInput: dom.roomsSearchInput });
}

function clearRoomsSearch() {
  clearRoomsSearchImpl({ roomsSearchInput: dom.roomsSearchInput, syncRoomsSearchClearUi, updateRoomsUi });
}

function attemptJoinRoom(rid) {
  attemptJoinRoomImpl(rid, { menuNameInput: dom.menuNameInput, submitNameFromInput, updateMenuNameUi, trackEvent, wsSend });
}

export function setRoomsCreateOpen(v) {
  setRoomsCreateOpenImpl(v, {
    setRoomsCreateOpen: (on) => {
      rooms.createOpen = on;
    },
    roomsCreateEl: dom.roomsCreate,
    toggleCreateRoomBtn: dom.toggleCreateRoomBtn,
    t,
    roomsCreateNameInput: dom.roomsCreateNameInput,
    updateRoomsCreateUi
  });
}

export function updateRoomsCreateUi(errMsg) {
  updateRoomsCreateUiImpl(errMsg, {
    getRoomsCreateOpen: () => rooms.createOpen,
    roomsCreateError: dom.roomsCreateError,
    createRoomBtn: dom.createRoomBtn,
    sanitizeRoomTitleClient,
    roomsCreateNameInput: dom.roomsCreateNameInput,
    t,
    getCreateRoomPending: () => rooms.createPending
  });
}

/* Параметр называется list, а не rooms: одноимённая группа стора здесь же в
   области видимости, и параметр её перекрывал — выбор комнаты писался в
   пришедший с сервера массив, а список так и оставался невыбранным. */
function renderRoomsListLocal(list, emptyMessage) {
  renderRoomsList(dom.roomsList, list, {
    t,
    selectedRoomId: rooms.selectedId,
    emptyMessage,
    onSelect: (rid) => {
      rooms.selectedId = rid;
      if (dom.joinRoomBtn) dom.joinRoomBtn.disabled = rooms.selectedId == null;
      updateRoomsStatsLocal(rooms.last);
    },
    onJoin: (rid) => attemptJoinRoom(rid)
  });
}

function renderRoomsEmptyLocal(kind, message) {
  renderRoomsEmpty(dom.roomsList, kind, message, {
    t,
    onRetry: () => dom.refreshRoomsBtn?.click(),
    onCreateRoom: () => setRoomsCreateOpen(true),
    onResetSearch: () => {
      if (dom.roomsSearchInput) dom.roomsSearchInput.value = '';
      updateRoomsUi();
      try {
        dom.roomsSearchInput?.focus();
      } catch {}
    }
  });
}

function updateRoomsStatsLocal(rawRooms) {
  updateRoomsStats(
    rawRooms,
    {
      statsEl: dom.roomsStats,
      onlineEl: document.getElementById('menuOnlineCount'),
      badgeEl: document.getElementById('menuOnlineBadge')
    },
    { t, formatNumber, wsStatusSuffix, loading: rooms.loading, error: rooms.loadError }
  );
}

/* Порядок и отбор комнат переехали в client_rooms.js — вместе с тестами.
   Здесь остаётся единственное, что действительно принадлежит этому файлу:
   откуда взять режим сортировки и строку поиска. */
function applyRoomsFilterSort() {
  return applyRoomsFilterSortImpl({ lastRooms: rooms.last, roomsSearchInput: dom.roomsSearchInput, roomsSortSelect: dom.roomsSortSelect });
}

export function updateRoomsUi() {
  updateRoomsUiImpl({
    syncRoomsSearchClearUi,
    getLastRooms: () => rooms.last,
    getSelectedRoomId: () => rooms.selectedId,
    setSelectedRoomId: (v) => {
      rooms.selectedId = v;
    },
    joinRoomBtn: dom.joinRoomBtn,
    updateRoomsStatsLocal,
    applyRoomsFilterSort,
    getRoomsLoading: () => rooms.loading,
    getRoomsLoadError: () => rooms.loadError,
    renderRoomsEmptyLocal,
    renderRoomsListLocal
  });
}

export function updateRoomInfo() {
  updateRoomInfoImpl({
    roomInfoEl: dom.roomInfo,
    getRoomId: () => session.roomId,
    getRoomLimit: () => session.roomLimit,
    t,
    wsStatusSuffix,
    updateChatHeaderStatus
  });
}

/* Параметр называется list по той же причине, что и в renderRoomsListLocal:
   имя rooms здесь занято группой стора, и присваивание rooms.last уходило в
   пришедший массив вместо хранилища — список комнат не обновлялся вовсе. */
export function onRooms(list) {
  rooms.loading = false;
  rooms.loadError = '';
  if (rooms.loadTimeout) {
    clearTimeout(rooms.loadTimeout);
    rooms.loadTimeout = 0;
  }
  if (dom.refreshRoomsBtn) {
    dom.refreshRoomsBtn.disabled = false;
    dom.refreshRoomsBtn.classList.remove('isLoading');
    dom.refreshRoomsBtn.textContent = t('rooms.refresh');
  }
  rooms.last = Array.isArray(list) ? list : [];
  updateRoomsUi();
}

export function onError(d) {
  onErrorImpl(d, {
    setRoomsCreateOpen,
    updateRoomsCreateUi,
    t,
    roomsCreateNameInput: dom.roomsCreateNameInput,
    rejoinGiveUp,
    cosmeticsOpClear,
    setCosmeticsStatus,
    syncCosmeticsUi,
    addToast
  });
}

/** Слушатели экрана меню и таймер автообновления списка комнат.
    deps: всё, что зависит от сетевого модуля и потому не берётся импортом. */
export function initMenu(ctx) {
  wsSend = ctx.wsSend;
  wsIsConnected = ctx.wsIsConnected;
  wsStatusSuffix = ctx.wsStatusSuffix;
  connectWs = ctx.connectWs;
  trackEvent = ctx.trackEvent;
  markJoinFunnelStart = ctx.markJoinFunnelStart;
  rejoinGiveUp = ctx.rejoinGiveUp;
  rejoinFinish = ctx.rejoinFinish;

  dom.toggleCreateRoomBtn?.addEventListener('click', () => {
    setRoomsCreateOpen(!rooms.createOpen);
  });

  dom.roomsCreateNameInput?.addEventListener('input', () => {
    updateRoomsCreateUi();
  });

  dom.createRoomBtn?.addEventListener('click', () => {
    const nm = submitNameFromInput(dom.menuNameInput);
    if (!nm) {
      updateMenuNameUi();
      dom.menuNameInput?.focus();
      return;
    }

    const title = sanitizeRoomTitleClient(dom.roomsCreateNameInput?.value);
    if (!title) {
      updateRoomsCreateUi();
      dom.roomsCreateNameInput?.focus();
      return;
    }

    rooms.createPending = true;
    updateRoomsCreateUi();
    trackEvent('create_room');
    wsSend('createRoom', { title });
  });

  dom.leaveBtn?.addEventListener('click', () => {
    // K7: явный выход — реконнект в эту комнату больше не нужен.
    session.userLeftRoom = true;
    session.rejoinRoomId = null;
    rejoinFinish();
    wsSend('leave', {});
    session.roomId = null;
    session.roomLimit = null;
    updateRoomInfo();
    showMenuOverlay();
  });

  dom.playBtn?.addEventListener('click', () => {
    markJoinFunnelStart('auto');
    // Пустой ник не должен быть барьером: подставляем случайный и стартуем.
    ensureNickBeforePlay();
    const nm = submitNameFromInput(dom.menuNameInput);
    if (!nm) {
      updateMenuNameUi();
      dom.menuNameInput?.focus();
      return;
    }
    // Без соединения join раньше молча проглатывался — кнопка «не работала»,
    // и клик приходилось повторять, пока он не попадёт в момент, когда сокет
    // уже открыт. Теперь намерение сохраняется и уходит само по onOpen.
    if (!wsIsConnected()) {
      session.pendingQuickJoin = { event: 'quick_start', params: { mode: 'auto' } };
      addToast('📡', t('net.join_offline'), null, null, { key: 'join_offline' });
      connectWs();
      return;
    }
    session.userLeftRoom = false;
    trackEvent('quick_start');
    wsSend('join', { mode: 'auto' });
  });

  dom.joinRoomBtn?.addEventListener('click', () => {
    if (rooms.selectedId == null) return;
    markJoinFunnelStart('room');
    const nm = submitNameFromInput(dom.menuNameInput);
    if (!nm) {
      updateMenuNameUi();
      dom.menuNameInput?.focus();
      return;
    }
    if (!wsIsConnected()) {
      session.pendingQuickJoin = { event: 'join_room', params: { roomId: rooms.selectedId, mode: 'id' } };
      addToast('📡', t('net.join_offline'), null, null, { key: 'join_offline' });
      connectWs();
      return;
    }
    session.userLeftRoom = false;
    trackEvent('join_room');
    wsSend('join', { roomId: rooms.selectedId, mode: 'id' });
  });

  dom.menuNameInput?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    // H5: Enter в поле ника запускает игру — привычный для жанра паттерн.
    // Раньше нажатие просто гасилось, и клавиатурный путь «ввёл ник → Enter» не работал.
    e.preventDefault();
    dom.playBtn?.click();
  });

  dom.menuNameInput?.addEventListener('input', () => {
    updateMenuNameUi();
  });

  dom.menuNameRandomBtn?.addEventListener('click', (e) => {
    e?.preventDefault?.();
    applyRandomNick();
  });

  dom.roomsSearchInput?.addEventListener('input', () => {
    syncRoomsSearchClearUi();
  });

  dom.roomsSearchClearBtn?.addEventListener('click', (e) => {
    e?.preventDefault?.();
    clearRoomsSearch();
  });

  dom.refreshRoomsBtn?.addEventListener('click', () => {
    if (rooms.loading) return;
    if (rooms.loadTimeout) {
      clearTimeout(rooms.loadTimeout);
      rooms.loadTimeout = 0;
    }

    rooms.loading = true;
    rooms.loadError = '';
    trackEvent('refresh_rooms');
    if (dom.refreshRoomsBtn) {
      dom.refreshRoomsBtn.disabled = true;
      dom.refreshRoomsBtn.classList.add('isLoading');
      dom.refreshRoomsBtn.textContent = t('rooms.loading');
    }
    updateRoomsUi();
    wsSend('rooms', {});

    rooms.loadTimeout = setTimeout(() => {
      rooms.loadTimeout = 0;
      if (!rooms.loading) return;
      rooms.loading = false;
      rooms.loadError = t('rooms.timeout');
      if (dom.refreshRoomsBtn) {
        dom.refreshRoomsBtn.disabled = false;
        dom.refreshRoomsBtn.classList.remove('isLoading');
        dom.refreshRoomsBtn.textContent = t('rooms.refresh');
      }
      updateRoomsUi();
    }, 4000);
  });

  dom.roomsSearchInput?.addEventListener('input', () => {
    updateRoomsUi();
  });

  dom.roomsSortSelect?.addEventListener('change', () => {
    updateRoomsUi();
  });

  setInterval(() => {
    if (!isOverlayOpen('menu')) return;
    if (session.started) return;
    if (rooms.createOpen || rooms.createPending) return;
    const now = performance.now();
    if (now < rooms.autoRefreshAt) return;
    rooms.autoRefreshAt = now + 5000;
    wsSend('rooms', {});
  }, 1200);
}
