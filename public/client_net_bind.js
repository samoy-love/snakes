/* Связь клиента с сервером: профиль, сокет, реконнект, разбор пакетов.

   Здесь живёт всё, что раньше держал client.js вокруг WebSocket: выдача и
   хранение токена профиля, сборка сетевого модуля со всеми колбэками,
   возврат в комнату после обрыва, воронка входа, диспетчер бинарных пакетов
   и обработчики текстовых сообщений (имена, пинг, выход).

   Модуль импортирует dom и группы стора напрямую — deps-объект ему не нужен.
   Наружу он отдаёт отправку в сокет и её спутников (wsSend, wsIsConnected,
   wsStatusSuffix, connectWs), которые client.js раздаёт остальным модулям.

   Обработчики полей имени вешаются из initNetBind(), а не при загрузке
   модуля. */

import { cos, match, netStat, rooms, session, settings, styleToast, ui, world } from './client_store.js';
import { ANALYTICS_PREFIX, KEYS, storageBump, storageGet, storageSet } from './client_storage.js';
import { dom } from './client_dom.js';
import { createNetModule } from './client_net.js';
import { infoPack, t } from './client_i18n_rt.js';
import { hueToHsl } from './client_color.js';
import { PLAYER_RECORD_SIZES, pickPlayerRecordSize } from './client_protocol.js';
import {
  handleEventsMessage,
  handleMinimapMessage,
  handlePlayersMessage,
  onInit as onInitImpl,
  onState as onStateImpl
} from './client_ws_handlers.js';
import { setMinimapPixel } from './client_minimap.js';
import { obFireEventImpl, obResetMatch } from './client_onboarding.js';
import {
  applyPackedDelta,
  applyPackedDeltaGridWithAnim,
  cosCaptureFxByPlayer,
  fillDelayFor,
  markCoolSeen,
  ownerFillStyleCache,
  refreshCaptureAnchors,
  refreshOwnGeometry
} from './client_render.js';
import { onCosExtra, onCosmetics, setYouStyle } from './client_shop.js';
import {
  RECLAIM_WINDOW_MS,
  achvLabel,
  approxNowTick,
  contractLabel,
  dailyLabel,
  deathReasonLabel,
  fmtInt,
  infoDesc,
  mutatorLabel,
  powerupLabel,
  styleLabel
} from './client_labels.js';
import { COS_DEATH_MS, cosClampId } from './client_cos_draw.js';
import {
  renderMetaHudImpl as renderMetaHud,
  renderTopHudImpl as renderTopHud
} from './client_hud.js';
import { bumpMatchTabBadge, pushEventFeed, renderKillfeed } from './client_hud_panels.js';
import { vibrate } from './client_settings.js';
import { sfx } from './client_sfx.js';
import { addToast } from './client_toasts.js';
import { botArchByPlayer, botDisplayName, displayNameOf } from './client_identity.js';
import { applyRoiCaps, applyViewportGrant, forgetSentViewport, sendViewportNow } from './client_viewport.js';
import {
  dailySetAssign,
  dailySetProgress,
  hideMenuOverlay,
  onError,
  onRooms,
  setRoomsCreateOpen,
  showMenuOverlay,
  submitName,
  syncMenuOnboardingUi,
  updateRoomInfo,
  updateRoomsCreateUi,
  updateRoomsUi
} from './client_menu.js';
import {
  applyMatchPhase,
  beginDeathSlowMo,
  beginDeathZoom,
  hideMatchOverlay,
  hideOverlays,
  obAnnounceShop,
  onMatchEnd,
  onMatchPhase,
  onMatchStart,
  renderMatchResults,
  resetClientForNewMatch,
  showMatchOverlay,
  updateMatchCountdown
} from './client_endgame.js';
import { onChat, onChatInit, renderChat } from './client_chat.js';
import {
  CAPTURE_JACKPOT_CELLS,
  addFxBurst,
  addScorePopup,
  addShakeClass,
  celebrateFirstCapture,
  comboBreak,
  comboBump,
  fxFlashScreen,
  shakeDirFrom,
  showBigBanner,
  triggerHitstop
} from './client_fx_rt.js';

/* ==========================================================================
 * Профиль
 * ====================================================================== */

let profileToken = '';

function getProfileToken() {
  if (profileToken) return profileToken;
  const cached = storageGet(KEYS.profileToken);
  if (typeof cached === 'string' && cached.length >= 8 && cached.length <= 1024) {
    profileToken = cached;
  }
  return profileToken;
}

function setProfileToken(tok) {
  const s = typeof tok === 'string' ? tok.trim() : '';
  if (!s || s.length > 1024) return;
  profileToken = s;
  storageSet(KEYS.profileToken, s);
}

/* ==========================================================================
 * Сокет
 * ====================================================================== */

let net = null;

export function wsSend(type, data) {
  return net.send(type, data) !== false;
}

export function wsIsConnected() {
  try {
    return net?.isConnected?.() === true;
  } catch {
    return false;
  }
}

export function wsStatusSuffix() {
  return net.statusSuffix();
}

export function connectWs() {
  net.connect();
}

/* ==========================================================================
 * Реконнект
 * ====================================================================== */

/* K7 «Реконнект». session.roomId комнаты, в которую нужно вернуться после разрыва:
   ставится в onClose, гасится после успешного onInit или явного выхода.
   session.userLeftRoom отличает «игрок нажал Выйти» от «сеть отвалилась». */
/* C9: у ожидания возврата не было таймаута, а разбирались только ответы
   room_not_found / room_full. При любом другом ответе (или проглоченном join)
   игрок навсегда оставался на замороженном игровом экране. */
const REJOIN_TIMEOUT_MS = 6000;

export function rejoinFinish() {
  session.rejoinPending = false;
  if (session.rejoinTimeoutTimer) {
    clearTimeout(session.rejoinTimeoutTimer);
    session.rejoinTimeoutTimer = 0;
  }
}

// Возврат не состоялся: уводим в меню вместо замороженного игрового экрана.
export function rejoinGiveUp(msg) {
  rejoinFinish();
  session.rejoinRoomId = null;
  session.roomId = null;
  session.roomLimit = null;
  session.started = false;
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
  session.rejoinPending = true;
  if (session.rejoinTimeoutTimer) clearTimeout(session.rejoinTimeoutTimer);
  session.rejoinTimeoutTimer = setTimeout(() => {
    session.rejoinTimeoutTimer = 0;
    if (!session.rejoinPending) return;
    rejoinGiveUp(null);
  }, REJOIN_TIMEOUT_MS);
}

/* Клик «Играть»/«Войти» до того, как сокет успел открыться (обычно —
   в первые доли секунды после загрузки страницы), раньше просто гасился
   тостом «офлайн»: само намерение войти в игру нигде не запоминалось, и
   игроку приходилось жать кнопку заново, пока клик не попадал в момент,
   когда соединение уже установлено. Здесь то же решение, что и у
   session.rejoinRoomId для обрыва связи посреди матча — намерение переживает
   соединение и посылается один раз, как только оно откроется. */

/* ==========================================================================
 * Воронка входа
 * ====================================================================== */

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

export function markJoinFunnelStart(mode) {
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
  /* В консоль печатаем только когда включена панель производительности:
     раньше строка уходила на каждый вход в игру у всех игроков. Медленные
     случаи всё равно уезжают на сервер ниже — диагностика от этого не
     страдает. */
  if (settings.perfEnabled) {
    try {
      console.log(`[join_funnel] mode=${joinFunnelMode} click_to_init_ms=${toInitMs} click_to_first_state_ms=${toStateMs}`);
    } catch {}
  }
  // Только заметно медленные случаи шлём на сервер — иначе обычная игра
  // превращается в лог-спам на каждый вход. 800мс — за пределами того, что
  // ощущается как «мгновенно», но не срабатывает на обычный пинг.
  if (toStateMs > 800) {
    wsSend('clientTiming', { kind: 'join_funnel', mode: joinFunnelMode, toInitMs, toStateMs });
  }
  joinFunnelAt = 0;
}

/* ==========================================================================
 * Счётчик пользовательских событий
 * ====================================================================== */

/* Счётчики шагов до игры: нажал «Играть», создал комнату, обновил список.
   Игровые события (заходы, убийства, захват) считает сервер сам — здесь
   только то, что происходит ДО подключения и потому серверу не видно.

   Вместе с серверным snakes_joins_total это даёт воронку: сколько нажало
   «Играть» против того, сколько реально подключилось. Расхождение между
   ними — сорвавшиеся подключения, и увидеть его больше негде.

   Список имён закрыт на стороне экспортёра (nginxlog.yml в
   metrics.samoy.love): незнакомое сворачивается в ряд "other". Добавляя
   событие здесь, добавьте его и там.

   Раньше отсюда же уходил sendBeacon на /e/<событие>. Такого маршрута на
   сервере нет и никогда не было (см. main.go: mux знает только /ws, /healthz,
   /readyz, /metrics и статику), поэтому каждый «Играть» и «Обновить» давал
   404: пять ошибок в консоли за сессию, лишние запросы через nginx и мусор в
   его логах. Продуктовая аналитика в проекте живёт в Prometheus на стороне
   сервера, отдельный клиентский канал ей не нужен.
   Локальные счётчики оставлены: они бесплатны и полезны при разборе жалоб
   («сколько раз игрок вообще жал Играть») — читать их можно из консоли. */
export function trackEvent(name) {
  const ev = String(name || '').trim();
  if (!ev) return;

  // Приватный режим и переполненное хранилище гасятся внутри storageBump:
  // счётчик события не важнее игры.
  storageBump(`${ANALYTICS_PREFIX}${ev}`);
}

/* ==========================================================================
 * Онбординг
 * ====================================================================== */

/* F15/F17 — мягкая первая сессия. Логика вынесена в client_onboarding.js;
   здесь только тонкая обёртка над подсказкой по событию: её зовёт разбор
   пакета событий. obGuideActive/obTick живут там, где их читают
   (client_render.js и client_hud.js), obAnnounceShop — в client_endgame.js,
   его зовёт onMatchStart. */

function obFireEvent(kind) {
  obFireEventImpl(kind, { addToast, t });
}

/* ==========================================================================
 * Разбор пакетов
 * ====================================================================== */

const DIR_NAMES = ['up', 'down', 'left', 'right'];

// C10: дедуп предупреждений о неизвестных типах событий.
const unknownEventKindSeen = new Set();

// J19: мелкие начисления Стиля агрегируются в один тост «+N Стиля ×3».
function flushStyleToast() {
  styleToast.timer = 0;
  const delta = styleToast.acc;
  if (!delta) return;
  const reason = styleToast.reason;
  const count = Math.max(1, styleToast.count);
  styleToast.acc = 0;
  styleToast.reason = 0;
  styleToast.count = 0;
  const suffix = count > 1 ? ` ×${count}` : '';
  addToast('✨', `+${delta} ${t('cosmetics.style_points')}${suffix}`, null, styleLabel(reason), {
    tab: 'match',
    key: `style_small_${reason}`,
    prio: 'minor'
  });
}

/* C6: порог, ниже которого ЧУЖОЙ захват в ленту не идёт. Домашний квадрат на
   старте — 9x9 = 81 клетка, типовая петля бота даёт 20-40; 48 отсекает
   рутину и оставляет заметные события. Свои захваты, киллы, баунти,
   контракты и ачивки фильтром не затрагиваются. */
const FEED_FOREIGN_CAPTURE_MIN = 48;

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
    const nextO = handlePlayersMessage(dv, o, {
      PLAYER_RECORD_SIZES,
      pickPlayerRecordSize,
      hueToHsl,
      botIds: world.botIds,
      DIR_NAMES,
      displayNameOf,
      botDisplayName,
      t,
      onState
    });
    if (nextO === null) return;
    o = nextO;
    return;
  }

  // Minimap chunks: type(1)=4, tick(4), cw(1), ch(1), count(2), chunks...
  if (msgType === 4) {
    const res = handleMinimapMessage(dv, o, { setMinimapPixel });
    if (res === null) return;
    o = res.offset;
    return;
  }

  if (msgType === 5) {
    const res = handleEventsMessage(dv, o, {
      displayNameOf,
      deathReasonLabel,
      addFxBurst,
      cosClampId,
      COS_DEATH_MS,
      pushEventFeed,
      t,
      addShakeClass,
      shakeDirFrom,
      sfx,
      fxFlashScreen,
      comboBump,
      vibrate,
      obFireEvent,
      FEED_FOREIGN_CAPTURE_MIN,
      addScorePopup,
      CAPTURE_JACKPOT_CELLS,
      triggerHitstop,
      bumpMatchTabBadge,
      showBigBanner,
      addToast,
      fmtInt,
      celebrateFirstCapture,
      cosCaptureFxByPlayer,
      approxNowTick,
      RECLAIM_WINDOW_MS,
      dailySetAssign,
      infoPack,
      dailyLabel,
      dailySetProgress,
      achvLabel,
      infoDesc,
      contractLabel,
      styleLabel,
      setYouStyle,
      flushStyleToast,
      comboBreak,
      mutatorLabel,
      unknownEventKindSeen,
      powerupLabel,
      renderKillfeed,
      renderMetaHud,
      renderTopHud
    });
    if (res === null) return;
    o = res.offset;
    return;
  }
  } catch (e) {
    console.warn('bad binary state packet', e);
  }
}

function onInit(msg) {
  onInitImpl(msg, {
    markJoinFunnelInit,
    rejoinFinish,
    addToast,
    t,
    applyMatchPhase,
    resetClientForNewMatch,
    hideMatchOverlay,
    showMatchOverlay,
    renderMatchResults,
    updateMatchCountdown,
    setRoomsCreateOpen,
    updateRoomsCreateUi,
    hideMenuOverlay,
    hideOverlays,
    syncMenuOnboardingUi,
    obResetMatch,
    obAnnounceShop,
    ownerFillStyleCache,
    botArchByPlayer,
    wsSend,
    onCosmetics,
    renderTopHud
  });

  /* Строку «Комната: N / M» перерисовываем здесь, а не внутри обработчика:
     раньше он вёл свои копии roomId/roomLimit и возвращал их наружу, поэтому
     вызванный внутри updateRoomInfo() видел прежний roomId (null) и писал в
     HUD «Комната: … / 16» на весь матч. Теперь обработчик пишет прямо в
     session, и порядок уже не важен — вызов оставлен как явная точка
     перерисовки. */
  updateRoomInfo();
}

function onState(s) {
  onStateImpl(s, {
    ownerFillStyleCache,
    refreshCaptureAnchors,
    markCoolSeen,
    fillDelayFor,
    applyPackedDeltaGridWithAnim,
    applyPackedDelta,
    renderChat,
    refreshOwnGeometry,
    hideOverlays,
    beginDeathZoom,
    beginDeathSlowMo
  });
}

/* ==========================================================================
 * Имена игроков
 * ====================================================================== */

/* C5: сервер шлёт английский вариант имени (nmEn) в nameUpdate и matchResult —
   клиент его никогда не читал, и в EN топ-5 выглядел кириллицей. Единая точка
   выбора имени: displayNameOf(). */

// Разбор одной записи имени. Возвращает true, если что-то изменилось.
function applyNameRecord(rec) {
  const id = Number(rec?.n);
  const nm = rec?.nm;
  if (!Number.isFinite(id) || typeof nm !== 'string') return false;

  // C5: английский вариант — отдельная карта, выбор делает displayNameOf().
  const en = typeof rec?.nmEn === 'string' ? rec.nmEn.trim() : '';
  if (en) world.nameEnById.set(id, en);
  else world.nameEnById.delete(id);

  // G15: сервер генерирует уникальные шуточные ники ботов — используем их.
  // Свой запасной вариант нужен только когда сервер прислал пустую строку.
  const clean = nm.trim();
  if (clean) {
    world.nameById.set(id, clean);
  } else if (world.botIds && world.botIds.has(id)) {
    world.nameById.set(id, botDisplayName(id));
  } else {
    return !!en;
  }
  return true;
}

function nameUpdateFlush(changed) {
  if (!changed) return;
  if (dom.chat.classList.contains('collapsed')) {
    ui.chatDirty = true;
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

/* ==========================================================================
 * Прочие сообщения
 * ====================================================================== */

function onRttPong(m) {
  const ts = m?.t;
  if (typeof ts !== 'number') return;
  const now = performance.now();
  netStat.pingMs = Math.max(0, now - ts);
}

function onLeft() {
  session.rejoinRoomId = null;
  rejoinFinish();
  session.roomId = null;
  session.roomLimit = null;
  updateRoomInfo();
  showMenuOverlay();
}

/* ==========================================================================
 * Сборка
 * ====================================================================== */

export function initNetBind() {
  dom.nameInput.value = session.name;
  if (dom.menuNameInput) dom.menuNameInput.value = session.name;

  dom.nameBtn.addEventListener('click', (e) => {
    e.preventDefault();
    submitName();
  });

  dom.nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault();
  });

  net = createNetModule({
    t,
    wsQuery: () => {
      // A1: identity is a signed token issued by the server. No token yet -> no param at all.
      const tok = getProfileToken();
      if (!tok) return '';
      return `t=${encodeURIComponent(tok)}`;
    },
    onBytesIn: (n) => {
      netStat.bytesInTotal += Number(n) || 0;
    },
    onBytesOut: (n) => {
      netStat.bytesOutTotal += Number(n) || 0;
    },
    onStatusChange: () => {
      updateRoomsUi();
    },
    onOpen: ({ send }) => {
      // Имя берём из стора, а не из снимка: после смены ника и обрыва
      // связи сюда обязано уйти НОВОЕ имя (см. session.name).
      if (session.name) send('setName', { name: session.name });
      dom.refreshRoomsBtn?.click();
      updateRoomsUi();
      // K7: обрыв связи (блокировка экрана, Wi-Fi → LTE) выбрасывал игрока из
      // матча в меню. Соединение восстанавливается само — возвращаемся в ту же
      // комнату, а не заставляем искать её руками.
      if (session.rejoinRoomId != null) {
        const rid = session.rejoinRoomId;
        // Стоило и то, и другое сразу — приоритет у возврата в матч, где игрок
        // уже был; отложенный вход из меню тогда не имеет смысла и не должен
        // выстрелить позже, на каком-то не связанном с ним переподключении.
        session.pendingQuickJoin = null;
        rejoinBegin();
        send('join', { roomId: rid, mode: 'id' });
      } else if (session.pendingQuickJoin != null) {
        const pj = session.pendingQuickJoin;
        session.pendingQuickJoin = null;
        session.userLeftRoom = false;
        trackEvent(pj.event);
        send('join', pj.params);
      }
    },
    onClose: () => {
      rooms.createPending = false;
      updateRoomsCreateUi();
      rooms.loading = false;
      rooms.loadError = t('net.offline');
      if (rooms.loadTimeout) {
        clearTimeout(rooms.loadTimeout);
        rooms.loadTimeout = 0;
      }
      if (dom.refreshRoomsBtn) {
        dom.refreshRoomsBtn.disabled = false;
        dom.refreshRoomsBtn.classList.remove('isLoading');
        dom.refreshRoomsBtn.textContent = t('rooms.refresh');
      }
      // K7: если игрок был в комнате и не уходил сам — запоминаем комнату и
      // держим игровой экран, вместо того чтобы швырять в меню.
      if (session.roomId != null && !session.userLeftRoom) {
        session.rejoinRoomId = session.roomId;
        addToast('📶', t('net.reconnecting'), null, t('net.rejoin_hint'), { key: 'net_reconnect' });
        updateRoomsUi();
        return;
      }
      session.rejoinRoomId = null;
      showMenuOverlay();
      updateRoomsUi();
    },
    onTextMsg: (t, d) => {
      if (t === 'hello') {
        // A1: the server re-issues the profile token on every connect.
        if (typeof d?.token === 'string') setProfileToken(d.token);
        if (typeof d?.roomLimit === 'number') session.roomLimit = d.roomLimit;
        /* C2: границы адаптивного ROI. Старый сервер их не шлёт — тогда
           остаются встроенные значения и просьба всё равно будет валидной. */
        applyRoiCaps(d?.roi);
        // Просим окно до входа в комнату: первый же ROI после join придёт нужного
        // размера, и стартовой полосы тумана не будет вовсе.
        forgetSentViewport();
        sendViewportNow();
        // C9: соединение доказано на прикладном уровне — можно сбрасывать backoff.
        try {
          net.markHealthy?.();
        } catch {}
        // C2: параметры арки матча.
        if (Number.isFinite(Number(d?.finalMult)) && Number(d.finalMult) > 0) {
          match.finalMult = Number(d.finalMult);
        }
        if (d?.cosmeticsPrices && typeof d.cosmeticsPrices === 'object') {
          cos.prices = d.cosmeticsPrices;
        }
        // F5: окно реклейма словами сервера, см. reclaimWindowSec().
        if (Number.isFinite(Number(d?.reclaimTicks)) && Number(d.reclaimTicks) > 0) {
          session.reclaimTicksFromServer = Number(d.reclaimTicks);
        }
        // Таблица титулов с сервера: страховка на случай, когда серверный набор
        // шире клиентского — тогда имя берётся оттуда, а не рисуется пустым.
        if (Array.isArray(d?.titles)) {
          cos.titleServerNames.clear();
          cos.titleAchvById.clear();
          for (const it of d.titles) {
            const id = Number(it?.id);
            const nm = typeof it?.name === 'string' ? it.name.trim() : '';
            // R5: язык выбирается в момент отрисовки, а не здесь — иначе смена
            // языка на лету оставила бы подставленные имена от старого.
            const nmEn = typeof it?.nameEn === 'string' ? it.nameEn.trim() : '';
            if (Number.isFinite(id) && id > 0 && nm) {
              cos.titleServerNames.set(id, { ru: nm, en: nmEn || nm });
            }
            // C3: связка «титул → ачивка», без неё прогресс не найти.
            const av = Number(it?.achv);
            if (Number.isFinite(id) && id > 0 && Number.isFinite(av) && av >= 0) {
              cos.titleAchvById.set(id, av);
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
        applyViewportGrant(d);
      }
    },
    onBinaryMsg: (buf) => {
      handleStateBinary(buf);
    }
  });
}
