/* Debug-мост для широкого каталога состояний визуального ревью
   (docs/reviews/review-loop-prompt.md, разделы 1.1-1.3).

   Активация — СТРОГО как остальные dev-only ветки клиента (см. docs/security.md
   про WS_ORIGINS/WS_ALLOW_LOCALHOST/PROFILE_SECRET_REQUIRED: включатель узкий
   и явный, а не "по наличию файла"): только ?debug=1 в URL страницы. Сервер
   никакого моста в hello/HTML не инжектит (grep по index.html и hello в
   internal/game не находит подобного канала), поэтому единственный безопасный
   источник — window.location, без похода на сеть. Модуль подключается из
   client.js условно, через динамический import() — на проде без ?debug=1 файл
   не грузится вовсе (см. client.js, конец файла).

   Каждая функция — тонкая обёртка НАД реальными путями рендера: те же
   экспорты, которыми пользуются обработчики сообщений сервера
   (client_ws_handlers.js), тот же формат данных. Ничего своего debug.* не
   рисует. */

const DEBUG_ACTIVE = new URLSearchParams(location.search).get('debug') === '1';

if (!DEBUG_ACTIVE) {
  throw new Error('client_debug: не активирован — нужен ?debug=1 в URL');
}

import { clientState } from './client_state.js';
import { session, match, cos, me, world, settings, netStat } from './client_store.js';
import { dom } from './client_dom.js';
import { t } from './client_i18n_rt.js';
import { DEATH_REASON } from './client_death.js';
import {
  renderMatchResults,
  showMatchOverlay,
  showDeathOverlayDebug,
  updateMatchCountdown
} from './client_endgame.js';
import { showCosmeticsOverlay, syncCosmeticsUi, youCos, renderMenuSkinPreview, setCosmeticsStatus } from './client_shop.js';
import { equip as cosEquip, markOwned as cosMarkOwned, applyCosPayload, invField, eqField, COS_STATE_CATS } from './client_cos_state.js';
import {
  onRooms,
  hideMenuOverlay,
  setMenuControlsSeen,
  syncMenuOnboardingUi,
  setRoomsCreateOpen,
  updateRoomsCreateUi,
  renderMenuMeta
} from './client_menu.js';
import { onChatInit, onChat, toggleEmojiPanel } from './client_chat.js';
import { pushEventFeed, renderKillfeed, updateLeaderboard, setLeaderboardPinned } from './client_hud_panels.js';
import { addToast } from './client_toasts.js';
import { onState } from './client_net_bind.js';
import { toggleMinimapOverlay } from './client_minimap_ui.js';
import { obBumpDeaths, obMarkStageShown } from './client_onboarding.js';
import { applyPerfUi, showSettingsOverlay } from './client_settings.js';
import { renderPerfPanel } from './client_draw.js';
import {
  addFxBurst,
  addScorePopup,
  addShakeClass,
  showBigBanner,
  triggerHitstop
} from './client_fx_rt.js';

const REASON_BY_NAME = {
  cut: DEATH_REASON.CUT,
  headon: DEATH_REASON.HEADON,
  selftrail: DEATH_REASON.SELFTRAIL,
  wall: DEATH_REASON.WALL
};

function resolveReason(reason) {
  if (typeof reason === 'number') return reason;
  return REASON_BY_NAME[String(reason || '').toLowerCase()] || DEATH_REASON.WALL;
}

/* death(reason) — экран смерти. reason: 1..4 либо 'cut'|'headon'|'selftrail'|'wall'.
   Тот же путь, что и реальная смерть (client_ws_handlers.js): наполняет
   me.lastDeathInfo и зовёт показ оверлея (showDeathOverlayDebug — тонкий
   экспорт, заведённый в client_endgame.js рядом с renderDeathStats/
   renderDeathReason ровно для этого моста). */
function death(reason) {
  me.lastDeathInfo = { killer: 0, killerName: '', reason: resolveReason(reason) };
  showDeathOverlayDebug();
}

/* matchResults(list) — итоги матча. list — массив в формате matchResults
   сервера: { n, p, pk, avg, k, d, place, ct, cp, cg, se, sb, pb, cd, fr, ... }.
   Тот же путь, что и onMatchEnd в client_ws_handlers.js. */
function matchResults(list) {
  match.lastResults = Array.isArray(list) ? list : [];
  renderMatchResults(match.lastResults);
  showMatchOverlay();
}

/* Инвентарь по умолчанию (свежий debug-профиль) хранит только базовый
   предмет (id 0) — shopState() раньше ничего в youCos не досыпал, поэтому
   ВСЕ 7 масочных категорий (title — отдельная, ачивочная система, не тут)
   на фильтре 'owned' показывали один и тот же кадр «куплена только база»:
   8 визуально почти неотличимых скриншотов вместо демонстрации реального
   владения. Маска 0b0111 = id 0,1,2 куплены — оставляет id 3-7 некупленными,
   так что 'available'/isLocked-прогресс остаются рабочими на тех же данных.
   Экипируем id 1 (не базу), чтобы превью тоже отличалось от «БАЗА».

   J20: живой WS у debug-сессии никуда не девается (мост наполняет только
   рендер, а не отключает сеть) — сервер честно шлёт СВОЁ 'cosmetics' для
   анонимного профиля (mask=1, только база) отдельным сообщением, и оно
   применяется 'replace'-режимом (client_shop.js: onCosmetics), затирая
   любой более ранний фейковый инвентарь целиком. Раньше сид ставился один
   раз при первом shopState() — реальное сообщение сервера прилетало following
   и откатывало его обратно к mask=1 ещё до скриншота. Фикс: сидим ПЕРЕД
   КАЖДЫМ вызовом, вплотную к syncCosmeticsUi() — между сидом и рендером нет
   зазора, в который успело бы прилететь новое серверное сообщение. */
function seedShopInventory() {
  const payload = {};
  for (const cat of COS_STATE_CATS) {
    payload[invField(cat)] = 0b0111;
    payload[eqField(cat)] = 1;
  }
  applyCosPayload(youCos, payload, 'patch');
}

/* shopState(tab, filter) — магазин на заданной вкладке/фильтре.
   tab — одна из COSMETICS_TABS (client_shop.js): terr/seg/head/death/
   capturefx/nameplate/frame/title. filter — 'all'|'owned'|'available'. */
function shopState(tab, filter) {
  seedShopInventory();
  showCosmeticsOverlay();
  cos.cat = String(tab || 'terr');
  cos.filter = String(filter || 'all');
  syncCosmeticsUi();
}

/* roomsList(rooms) — список комнат в меню. rooms — массив в формате сервера:
   { id, title, humans, limit, names, nameCount, namesTruncated }. */
function roomsList(rooms) {
  document.getElementById('roomsDetails')?.setAttribute('open', '');
  onRooms(Array.isArray(rooms) ? rooms : []);
}

/* chatLog(messages) — история чата. messages — массив { n, text, t }, тот же
   формат, что и chatInit с сервера. */
function chatLog(messages) {
  // #chat скрыт CSS-ом, пока открыт #menuOverlay (body.overlayActive) — вне
  // реального матча (тот же путь закрытия, что и ensureMatchWorld() ниже).
  // На узком вьюпорте #chat к тому же стартует свёрнутым в кнопку
  // (08-game-sidebar.css: #chat.collapsed прячет #chatForm/#chatLog) —
  // onChatInit (в отличие от addChatLine/bumpChatVisibility) сам его не
  // разворачивает, поэтому снимаем класс явно.
  hideMenuOverlay();
  document.getElementById('chat')?.classList.remove('collapsed');
  onChatInit(Array.isArray(messages) ? messages : []);
}

/* leaderboard(entries) — таблица лидеров. entries — массив игроков в формате
   state.players: { n, nm, p, s, cosFrame }.
   #stats — часть #hud (правой колонки боя), а #hud сам скрыт вне игрового
   состояния (session.started/тело body.inGame — см. ensureMatchWorld()).
   Первая версия этой функции пинула лидерборд (setLeaderboardPinned — снимает
   ТОЛЬКО правило `#hud:not(.lbPinned) #stats`), но не входила в игровое
   состояние вовсе — #hud оставался display:none целиком, и `getComputedStyle`
   на самой #stats table лгал "display:table" (Chrome не смотрит на предков),
   тогда как Playwright's actual visibility check (учитывает предков) честно
   висел все 300с на каждом вьюпорте. pushScene(baseScene()) — тот же вход в
   игровой экран, что и у matchScene(), — обязателен, а не косметика. */
function leaderboard(entries) {
  pushScene(baseScene());
  clientState.lastState = { ...clientState.lastState, players: Array.isArray(entries) ? entries : [] };
  setLeaderboardPinned(true);
  updateLeaderboard();
}

/* J19: 'minor' и 'info' раньше были двумя разными пресетами с одним и тем же
   icon='ℹ'/variant=null — addToast() (client_toasts.js) различает тосты
   визуально только по icon/variant, а не по kind, поэтому оба рендерились
   пиксель-в-пиксель одинаково. grep addToast( по client_ws_handlers.js не
   нашёл ни одного реального вызова с типом 'minor' или 'info' — это не
   название какого-то реального сорта тоста, а имена ключей самого пресета.
   Единственное реальное совпадение с icon='ℹ'/variant=null — общий info-тост
   магазина (client_shop.js: addToast(k==='error'?'⚠':k==='success'?'✅':'ℹ', ...)),
   поэтому оставлен 'info' — как более говорящее и единственное подтверждённое
   в реальном коде имя, 'minor' убран. */
const TOAST_PRESETS = {
  info: () => addToast('ℹ', 'Debug: info toast', null),
  success: () => addToast('✅', 'Debug: success toast', null),
  error: () => addToast('⚠', 'Debug: error toast', null),
  big: () => addToast('🎁', 'Debug: big toast', 'big', 'Подзаголовок крупного тоста'),
  jackpot: () => addToast('💎', 'Debug: jackpot toast', 'big', 'Редкое событие', { key: 'debug_jackpot', prio: 'jackpot' })
};

/* toast(kind) — тост события. kind — один из TOAST_PRESETS (info/
   success/error/big/jackpot); неизвестный kind — 'info'. */
function toast(kind) {
  const fn = TOAST_PRESETS[String(kind || 'info')] || TOAST_PRESETS.info;
  fn();
}

/* connectionError() — тост обрыва соединения. Тот же вызов, что и в
   client_net_bind.js при реальном разрыве. */
function connectionError() {
  addToast('📶', t('net.reconnecting'), null, t('net.rejoin_hint'), { key: 'net_reconnect' });
}

/* ==========================================================================
 * matchScene(sceneId) — экран боя (канвас + весь HUD поверх него) в разных
 * игровых состояниях: с эффектами и без, во время захвата чужой территории,
 * на разгоне, с активным контрактом/командной панелью/переполненным полем.
 *
 * Путь наполнения — ТОТ ЖЕ, что и у реального кадра: onState() из
 * client_net_bind.js (тонкая обвязка над onStateImpl из client_ws_handlers.js,
 * та же функция, что разбирает msgType=2 с сервера). Экспортирована оттуда
 * специально для этого моста — дублировать сборку её ctx здесь не нужно.
 * topHud/killfeed/teamHud/metaHud/rightSidebar/minimap не тронуты явно: они
 * сами перерисовываются из общего рендер-цикла (draw(), уже запущен
 * startRenderLoop() в client.js), как и в реальной игре.
 *
 * ДОГАДКА (нет прямого пути её проверить без реального коннекта в комнату):
 * если игрок ни разу не входил в реальный матч на этой странице (обычный
 * случай — сюда идут сразу после ?debug=1 без клика «Играть»), session.W/H
 * ещё нулевые: их выставляет только onInit() при реальном join, а не hello.
 * ensureMatchWorld() тогда заводит их сама, тем же набором полей, что и
 * onInit() (без сетевых вызовов wsSend/respawn — они здесь не нужны). Если
 * матч уже реальный (страница дошла до ?debug=1 после клика «Играть»),
 * существующие session.W/H не трогаются — используется реальный размер поля. */

const MATCH_W = 48;
const MATCH_H = 32;

function ensureMatchWorld() {
  if (!session.W) {
    session.W = MATCH_W;
    session.H = MATCH_H;
    session.N = session.W * session.H;
    session.mapCells = session.N;
    session.you = session.you || 1;
    session.tickMs = session.tickMs || 120;

    const mm = dom.minimap;
    if (mm) {
      const mmCtx = mm.getContext('2d');
      mm.width = session.W;
      mm.height = session.H;
      world.minimapGridOwner = new Uint16Array(session.N);
      world.minimapImage = mmCtx.createImageData(session.W, session.H);
      mmCtx.imageSmoothingEnabled = true;
    }
  }
  session.started = true;
  if (!match.lastEventsAt) {
    match.lastEventsTick = 0;
    match.lastEventsAt = Date.now();
  }
  // Реальный вход в матч (onInitImpl, client_ws_handlers.js) закрывает меню
  // и помечает roomId/userLeftRoom/body.inGame тем же набором присваиваний —
  // без него две вещи ломаются: #menuOverlay остаётся поверх канваса на
  // первом кадре, а любое последующее WS-событие (onClose/onLeft в
  // client_net_bind.js смотрит именно на session.roomId/userLeftRoom) решает,
  // что игрок «не в комнате», и зовёт showMenuOverlay() поверх уже
  // нарисованной сцены — независимо от синтетического состояния канваса.
  if (session.roomId == null) session.roomId = -1;
  session.userLeftRoom = false;
  session.rejoinRoomId = session.roomId;
  try {
    document.body.classList.add('inGame');
  } catch {}
  hideMenuOverlay();
}

function makePlayer(n, x, y, over) {
  const o = over || {};
  return {
    n,
    x,
    y,
    d: o.d || 'right',
    a: o.a !== false,
    c: o.c || `hsl(${(n * 47) % 360} 70% 55%)`,
    s: o.s ?? 240,
    p: o.p ?? 500,
    sh: o.sh ?? 0,
    cosCaptureFx: o.cosCaptureFx ?? 0,
    cosHead: o.cosHead ?? 0,
    cosSeg: o.cosSeg ?? 0,
    cosNameplate: o.cosNameplate ?? 0,
    cosFrame: o.cosFrame ?? 0,
    nm: o.nm || `Игрок ${n}`,
    b: 0
  };
}

function fillRect(grid, w, x0, y0, x1, y1, owner) {
  for (let y = Math.max(0, y0); y < y1; y++) {
    for (let x = Math.max(0, x0); x < x1; x++) {
      grid[y * w + x] = owner;
    }
  }
}

/* Базовая реалистичная сцена: своя территория слева, чужая справа, твоя
   голова и короткий свежий след на границе — то же, что видел бы игрок
   секунду после захода на нейтральную полосу. */
function baseScene() {
  ensureMatchWorld();
  const w = session.W;
  const h = session.H;
  const you = session.you;
  const opp = you + 1;
  const bot = you + 2;

  const grid = new Uint16Array(w * h);
  fillRect(grid, w, 1, 1, Math.floor(w * 0.4), h - 1, you);
  fillRect(grid, w, Math.floor(w * 0.6), 1, w - 1, h - 1, opp);

  const trail = new Uint16Array(w * h);
  const hx = Math.floor(w * 0.4) + 3;
  const hy = Math.floor(h / 2);
  for (let k = 0; k < 6; k++) {
    const tx = hx - k;
    if (tx >= 0 && tx < w) trail[hy * w + tx] = you;
  }

  const players = [
    makePlayer(you, hx, hy, { nm: 'Вы', c: 'hsl(150 70% 55%)' }),
    makePlayer(opp, Math.floor(w * 0.72), Math.floor(h * 0.45), { nm: 'Соперник', c: 'hsl(0 70% 55%)' }),
    makePlayer(bot, Math.floor(w * 0.18), Math.floor(h * 0.22), { nm: 'Бот', c: 'hsl(260 70% 55%)' })
  ];

  return { grid, trail, players, w, h, you, opp, bot, hx, hy };
}

function pushScene(s) {
  onState({ full: true, grid: s.grid, trail: s.trail, players: s.players, roi: null });
}

function sceneCalm() {
  pushScene(baseScene());
}

function sceneFxBurst() {
  const s = baseScene();
  pushScene(s);
  addFxBurst(s.hx, s.hy, 'kill');
  addShakeClass('medium', 1, 0);
  triggerHitstop(120);
}

/* Территория соперника у твоей головы только что перекрашена в твой цвет —
   кадр в момент захвата, а не итоговый оверлей. */
function sceneEatingOpponent() {
  const s = baseScene();
  const cx = Math.floor(s.w * 0.56);
  const cy = s.hy;
  fillRect(s.grid, s.w, cx - 4, cy - 4, cx + 4, cy + 4, s.you);
  s.players[0].x = cx;
  s.players[0].y = cy;
  pushScene(s);
  addFxBurst(cx, cy, 'cap0', { pid: s.you });
  addScorePopup(cx, cy, 64);
  showBigBanner('💎', t('banner.jackpot'), `+64 · ${t('banner.jackpot_sub')}`, 'jackpot');
}

/* Разгон/буст: me.speedUntilTick в будущем относительно приблизительного
   текущего тика (approxNowTick() в client_labels.js — считает от
   match.lastEventsTick/lastEventsAt). Визуально это читает client_draw.js:
   paintEntities() (speedActive) — золотое/фиолетовое кольцо у головы и
   искры следа в draw() (client_render.js), а не отдельный флаг на игроке. */
function sceneBoost() {
  const s = baseScene();
  pushScene(s);
  match.lastEventsTick = 1000;
  match.lastEventsAt = Date.now();
  me.speedUntilTick = 100000;
  me.speedType = 4;
}

function sceneKillfeedBusy() {
  const s = baseScene();
  pushScene(s);
  pushEventFeed(`Вы -> ${s.opp === s.you ? '' : 'Соперник'} (headon)`, 'Kill', s.you);
  pushEventFeed('Бот captured +120 zone', 'Capture', s.bot);
  pushEventFeed('Баунти: Соперник', 'Bounty');
  pushEventFeed('Вы -> Бот (cut)', 'Kill', s.you);
  pushEventFeed('Соперник — Ачивка: Первая кровь', 'Achv', s.opp);
  renderKillfeed();
}

/* topHud с активным контрактом: me.contractType/Goal/Progress/Until — те же
   поля, что пишет kind===10/11 в handleEventsMessage; чтение — client_hud.js
   renderTopHudImpl() -> ensureContractParts(). */
function sceneContractActive() {
  const s = baseScene();
  pushScene(s);
  match.lastEventsTick = 1000;
  match.lastEventsAt = Date.now();
  me.contractType = 1;
  me.contractGoal = 100;
  me.contractProgress = 42;
  me.contractUntil = 100000;
  // Итерация 6: у свежего Playwright-профиля obMatchesEntered()===0 =>
  // obFirstMatch()===true, и topHudContract остаётся за замком obUnlocked()
  // (client_hud.js:297) до 135с матч-таймера или показанной ступени 'contract'
  // (client_onboarding.js). Сценарий должен показывать контракт сразу — снимаем
  // замок так же, как его снимает реальное первое убийство в матче.
  obMarkStageShown('contract');
}

/* J19: match-scene-team-mode и match-scene-crowded слиты в один сценарий.
   Раньше это были два отдельных id, отличавшихся только тем, что team-mode
   раскрывал #rightTeamDetails и добавлял 6 статистов на y=5 через шаг 3, а
   crowded добавлял 8 статистов, разбросанных по трём высотам — на итоговом
   кадре разница сводилась к количеству фигурок на и без того тесном канвасе,
   едва заметной на скриншоте такого размера. teamHud (панель «Команда»)
   рисуется renderTeamHudImpl() безусловно на каждый рендер, пока
   session.started и есть lastState — собственного флага «командный режим» в
   клиенте нет (grep 'teamHud' не нашёл иного условия показа), так что
   раскрыть панель можно поверх любой сцены. Сценарий теперь одновременно
   показывает толпу статистов (было в crowded) И раскрытую командную панель
   (было в team-mode) — один кадр вместо двух почти неотличимых. */
function sceneCrowded() {
  const s = baseScene();
  const extra = Array.from({ length: 8 }, (_, i) =>
    makePlayer(s.bot + 20 + i, 4 + i * 4, 8 + ((i % 3) * 7), { nm: `Игрок ${i + 4}` })
  );
  s.players.push(...extra);
  pushScene(s);
}

const MATCH_SCENES = {
  'match-scene-calm': sceneCalm,
  'match-scene-fx-burst': sceneFxBurst,
  'match-scene-eating-opponent': sceneEatingOpponent,
  'match-scene-boost': sceneBoost,
  'match-scene-killfeed-busy': sceneKillfeedBusy,
  'match-scene-contract-active': sceneContractActive,
  'match-scene-crowded': sceneCrowded
};

/* matchScene(sceneId) — единая точка входа каталога (tests/visual/catalog.mjs)
   в сценарии экрана боя. Неизвестный id — тихий откат на спокойную сцену. */
function matchScene(sceneId) {
  const fn = MATCH_SCENES[String(sceneId || 'match-scene-calm')];
  (fn || sceneCalm)();
}

/* deathExhausted(reason) — экран смерти на четвёртой смерти подряд, когда
   человеческая подсказка (client_death_ui.js: renderDeathReasonImpl,
   deathsSeen < 3) уже не показывается — только сухая причина. obDeathsSeen()
   (client_onboarding.js) читает счётчик РЕАЛЬНЫХ смертей из localStorage: на
   свежем профиле он 0, showDeathOverlay() читает его и сам инкрементит
   (obBumpDeaths()) при каждом показе оверлея. Три предварительных вызова
   obBumpDeaths() поднимают счётчик до 3 без лишних оверлеев — ровно то же,
   что оставили бы три реальные смерти подряд, — а затем death() показывает
   четвёртый оверлей, уже видящий deathsSeen()===3 и прячущий подсказку. */
function deathExhausted(reason) {
  obBumpDeaths();
  obBumpDeaths();
  obBumpDeaths();
  death(reason);
}

/* menuOnboardingDismiss() — строка подсказки об управлении в меню
   (#menuOnboarding) уже отмечена прочитанной. Тот же путь, что и реальное
   первое закрытие: setMenuControlsSeen()/syncMenuOnboardingUi()
   (client_menu.js), пишущие и читающие тот же KEYS.menuControlsSeen, что и
   обычный показ меню. На свежем профиле Playwright флаг не установлен —
   поэтому 'menu-onboarding-shown' в каталоге просто открывает меню без
   вызова этой функции, а её вызывает только 'menu-onboarding-dismissed'. */
function menuOnboardingDismiss() {
  setMenuControlsSeen();
  syncMenuOnboardingUi();
}

/* menuSkinPreview(cat, itemId) — панель «Ваш облик» на экране меню с явно
   выбранным (не базовым) предметом. Тот же путь экипировки, что и в магазине
   (cosEquip -> renderMenuSkinPreview, client_shop.js: applyCosPayload
   зовёт их так же при приходе cosExtra с сервера). */
function menuSkinPreview(cat, itemId) {
  // equip() (client_cos_state.js) молча отказывает надеть предмет, которого
  // нет в битовой маске инвентаря — как и сервер. createCosState() заводит
  // youCos.inv нулями, а этот сценарий не выдавал предмет заранее, поэтому
  // cosEquip() всегда возвращал false и youCos.eq.head оставался 0: скриншот
  // menu-skin-preview.png был побайтово идентичен menu-default.png
  // (docs/reviews/iter-5.md). markOwned() — тот же путь, которым владение
  // отмечается при реальной покупке (client_shop.js), выдаём его перед
  // экипировкой.
  const c = String(cat || 'head');
  const id = Number(itemId) || 1;
  cosMarkOwned(youCos, c, id);
  cosEquip(youCos, c, id);
  renderMenuSkinPreview();
}

/* roomsCreateEmpty()/roomsCreateInvalid() — форма создания комнаты открыта:
   пустая или с ошибкой валидации. setRoomsCreateOpen/updateRoomsCreateUi —
   те же экспорты client_menu.js, которыми пользуется и обработчик клика
   toggleCreateRoomBtn, и реальный путь ошибки: onError() (client_ws_handlers.js)
   зовёт updateRoomsCreateUi(t('rooms.invalid_title')) ровно на
   code==='room_title_invalid' — тот же текст подставлен и здесь. */
function roomsCreateEmpty() {
  document.getElementById('roomsDetails')?.setAttribute('open', '');
  setRoomsCreateOpen(true);
  if (dom.roomsCreateNameInput) dom.roomsCreateNameInput.value = '';
  updateRoomsCreateUi();
}

function roomsCreateInvalid() {
  document.getElementById('roomsDetails')?.setAttribute('open', '');
  setRoomsCreateOpen(true);
  if (dom.roomsCreateNameInput) dom.roomsCreateNameInput.value = '';
  updateRoomsCreateUi(t('rooms.invalid_title'));
}

/* minimapFullscreen() — полноэкранный режим миникарты на мобильном.
   toggleMinimapOverlay (client_minimap_ui.js) — тот же обработчик, что висит
   на клике по dom.minimapMobileBtn (кнопка скрыта CSS-ом вне мобильной
   раскладки — сама раскладка выставляется вьюпортом каталога, не этой
   функцией). Сцену матча наполняем заранее (baseScene), иначе миникарта
   рисует пустое поле. */
function minimapFullscreen() {
  pushScene(baseScene());
  toggleMinimapOverlay();
}

/* settingsOpen() — открыть #settingsOverlay. dom.settingsBtn (реальная
   точка входа) лежит ВНУТРИ #hud, который скрыт до реального входа в матч
   (`body:not(.inGame) #hud { display:none }` — offsetParent у кнопки null).
   catalog.mjs раньше кликал по dom.settingsBtn напрямую — Playwright ждал
   актуируемости скрытой кнопки все 300с (глобальный test.timeout,
   playwright.config.mjs) и падал таймаутом на каждом вьюпорте. Зовём тот же
   showSettingsOverlay(), что и обработчик клика, в обход недоступной кнопки. */
function settingsOpen() {
  showSettingsOverlay();
}

/* perfPanel() — панель отладки FPS (#perf). settings.perfEnabled — то же
   поле, что переключает чекбокс #perfEnabled (client_settings.js: FIELDS),
   applyPerfUi() — тот же обработчик, что вызывает bind('perfEnabled', ...)
   на реальном change. Сцену матча наполняем, чтобы панель считала кадры не
   на пустом канвасе. */
function perfPanel() {
  pushScene(baseScene());
  settings.perfEnabled = true;
  applyPerfUi();
  // #perf:empty{display:none} (08-game-sidebar.css) — контент обычно
  // приходит из draw()'s rAF-цикла на следующем кадре. Под автоматизацией
  // (headless-окно без фокуса ОС) вкладка может быть document.hidden, и
  // rAF браузер попросту не планирует — рендерим один кадр панели тем же
  // renderPerfPanel(), что и draw(), не дожидаясь кадра.
  renderPerfPanel(dom.perf, { roomId: session.roomId, fps: netStat.fps, pingMs: netStat.pingMs, upBps: netStat.upBps, downBps: netStat.downBps, tickrate: world.tickrate, tickMs: session.tickMs }, t);
}

/* matchCountdownScene(seconds) — оверлей итогов с ЖИВЫМ обратным отсчётом до
   следующего матча, а не заглушкой «—»: match-results-* в каталоге не зовут
   updateMatchCountdown(), поэтому #matchCountdown у них всегда пустой тире.
   Путь — тот же, что и настоящий конец матча (onMatchEndImpl,
   client_match.js): match.ended/match.resetAt выставляются, затем
   updateMatchCountdown() (client_endgame.js) читает approxNowTick() и считает
   остаток по session.tickMs. */
function matchCountdownScene(seconds) {
  match.lastResults = [player0(1), player0(2), player0(3)];
  renderMatchResults(match.lastResults);
  session.tickMs = session.tickMs || 120;
  match.lastEventsTick = 0;
  match.lastEventsAt = Date.now();
  match.ended = true;
  match.resetAt = Math.ceil(((Number(seconds) || 8) * 1000) / session.tickMs);
  updateMatchCountdown();
  showMatchOverlay();
}

function player0(n) {
  return { n, p: 1000 - n * 40, pk: 300 - n * 10, avg: 150 - n * 5, k: Math.max(0, 5 - n), d: n % 3, place: n };
}

/* chatUnread(n) — бейдж непрочитанных сообщений в шапке чата. onChat()
   (client_chat.js) — тот же путь, что и реальное входящее сообщение
   (onTextMsg 'chat' в client_net_bind.js): бейдж растёт, только пока фокус
   не внутри #chat (addChatLine проверяет document.activeElement), поэтому
   функция не трогает фокус сама — на свежей странице после gotoDebug он и
   так снаружи чата. */
function chatUnread(n) {
  hideMenuOverlay();
  document.getElementById('chat')?.classList.remove('collapsed');
  const count = Math.max(1, Number(n) || 1);
  for (let i = 0; i < count; i++) {
    onChat({ n: 2, text: `Сообщение ${i + 1}`, t: Date.now() / 1000 });
  }
}

/* emojiPanel(open) — эмодзи-панель чата. toggleEmojiPanel (client_chat.js) —
   тот же обработчик, что висит на клике по dom.emojiBtn/emojiCloseBtn.
   'Недавние' (#emojiRecent) на свежем профиле пустые и потому скрыты —
   каталог для непустого варианта кликает по настоящей кнопке эмодзи в
   гриде (тот же путь, каким недавние эмодзи копятся в реальной игре), а не
   имитирует это через мост. */
function emojiPanel(open) {
  hideMenuOverlay();
  document.getElementById('chat')?.classList.remove('collapsed');
  toggleEmojiPanel(open !== false);
}

/* menuDailies(list) — мета-крючок на экране меню (#menuMeta): активные
   дейлики + прогресс до первого скина. list — [{ slot, type, goal, prog }],
   тот же формат, что и me.dailies (client_store.js). renderMenuMetaImpl
   (client_menu_ui.js) сама ничего не рисует, пока #menuOverlay скрыт —
   меню нужно оставить открытым (в отличие от matchScene, здесь НЕ зовём
   hideMenuOverlay). */
function menuDailies(list) {
  me.dailies.clear();
  for (const d of Array.isArray(list) ? list : []) {
    if (d && d.slot != null) me.dailies.set(Number(d.slot), { type: d.type, goal: Number(d.goal) || 0, prog: Number(d.prog) || 0 });
  }
  renderMenuMeta();
}

/* shopStatus(text, kind) — статусная строка магазина (#cosmeticsStatus) в
   состоянии ошибки покупки — тот же вызов, что и onError() в
   client_ws_handlers.js для cosmetics_not_enough_style/cosmetics_not_owned/
   cosmetics_unavailable. Открывает магазин сам, если он ещё не открыт. */
function shopStatus(text, kind) {
  seedShopInventory();
  showCosmeticsOverlay();
  setCosmeticsStatus(text || t('cosmetics.err_not_enough_style'), kind || 'error');
}

export const debug = {
  death,
  deathExhausted,
  matchResults,
  matchCountdownScene,
  shopState,
  roomsList,
  roomsCreateEmpty,
  roomsCreateInvalid,
  chatLog,
  chatUnread,
  emojiPanel,
  leaderboard,
  toast,
  connectionError,
  matchScene,
  menuOnboardingDismiss,
  menuSkinPreview,
  minimapFullscreen,
  perfPanel,
  menuDailies,
  shopStatus,
  settingsOpen
};

window.__snakesDebug = debug;
