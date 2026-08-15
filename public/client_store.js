import { KEYS, storageGet, storageSet, storageFlag } from './client_storage.js';

/* Изменяемое состояние клиента.

   Раньше оно жило сотней плоских `let` на уровне client.js, и это определяло
   всю остальную архитектуру: вынесенный модуль состояния не видел, поэтому
   получал его копией в deps-объекте, а свои изменения возвращал объектом
   результата, который client.js переписывал обратно по полю. Копирований
   набралось на сотни строк — onInit возвращал 33 поля, resetClientForNewMatch
   35, разбор событий 22, — и каждое из них можно было забыть. Один такой
   случай задокументирован прямо в коде: updateRoomInfo() читала roomId до
   того, как его успевали присвоить, и весь матч показывала «Комната: … / 16».

   Здесь состояние собрано в именованные группы, которые импортируются по
   ссылке. Модуль читает и пишет те же самые поля, что и все остальные, —
   передавать и возвращать нечего.

   Границы групп проведены по времени жизни, а не по экрану:
     session  — что верно, пока мы в этой комнате;
     match    — что сбрасывается на границе матча;
     world    — сетка, игроки и всё, что приходит снапшотом;
     me       — показатели своего игрока за матч;
     cos      — кошелёк, инвентарь и состояние магазина;
     settings — то, что игрок выставил сам и что переживает перезагрузку;
     fxRt     — сиюминутное состояние эффектов (тряска, вспышки, частицы);
     netStat  — счётчики для панели производительности.

   Массивы и Map создаются один раз и дальше только очищаются: ссылки на них
   разошлись по модулям, и подмена объекта целиком их бы осиротила. Там, где
   пересоздание всё же нужно (типизированные массивы сетки под новый размер
   карты), поле держит ссылку и переприсваивается явно.

   ГРАНИЦА: кто берёт состояние отсюда, а кто получает параметром.

   Отсюда импортируют все модули, которые и так завязаны на браузер: они
   трогают DOM, канвас или сокет, и притворяться чистыми им незачем.

   Есть и вторая группа — модули, которые СОЗНАТЕЛЬНО оставлены чистыми и
   получают всё, что им нужно, параметром deps/ctx:

     client_draw.js        геометрия кадра и рисование по канвасу
     client_field_view.js  масштаб, камера, видимая область
     client_minimap.js     раскладка миникарты и её зон
     client_rooms.js       отбор и сортировка комнат
     client_stats.js       личный рекорд и сортировка таблицы
     client_format.js      форматирование чисел и времени
     client_cos_*.js       модель косметики, цены, тиры
     client_onboarding.js  правила мягкой первой сессии

   Это не недоделанный распил, а осознанное решение: у всех перечисленных
   есть юнит-тесты, которые гоняют их на подставных данных без браузера. Если
   такой модуль начнёт импортировать стор, тест придётся либо тащить весь стор
   за собой, либо мокать его — и проверка перестанет быть проверкой формулы.
   Признак простой: модуль без DOM и без сокета получает данные параметром;
   всё остальное берёт их здесь. */

/* Что верно, пока клиент находится в этой комнате. */
export const session = {
  W: 0,
  H: 0,
  N: 0,
  you: 0,
  tickMs: 100,
  mapCells: 0,
  roomId: null,
  roomLimit: null,

  /* Ник игрока. Раньше это был снимок localStorage, снятый один раз при
     загрузке модуля (`const storedName = ...`), и обновить его было нечем:
     смена ника писала в хранилище, но не в снимок. После обрыва связи
     onOpen переотправлял серверу СТАРОЕ имя — игрок менял ник, терял связь
     на секунду и возвращался под прежним. Теперь имя живёт здесь, и у него
     одна точка записи — setPlayerName(). */
  name: storageGet(KEYS.name) || '',

  // Игрок в матче (поле нарисовано и управление живое).
  started: false,
  youAlive: false,

  /* K7 «Реконнект». Комната, в которую нужно вернуться после разрыва:
     ставится в onClose, гасится после успешного onInit или явного выхода.
     userLeftRoom отличает «игрок нажал Выйти» от «сеть отвалилась». */
  rejoinRoomId: null,
  rejoinPending: false,
  rejoinTimeoutTimer: 0,
  userLeftRoom: false,

  /* Клик «Играть»/«Войти» до того, как сокет успел открыться. Намерение
     переживает соединение и уходит один раз, как только оно откроется. */
  pendingQuickJoin: null,

  // Окно реклейма словами сервера (hello.reclaimTicks); 0 — старый сервер.
  reclaimTicksFromServer: 0,

  // Направление, отправленное последним, — чтобы не слать дубли.
  lastDirSent: null
};

/* Всё, что живёт ровно один матч. */
export const match = {
  seq: 0,
  endTick: 0,

  /* C2: арка матча. Фаза приезжает в init/matchStart и отдельным сообщением
     matchPhase на каждой границе. */
  phase: 0,
  phaseUntil: 0,
  // Множитель очков за захват в финале; сервер сообщает его в hello.
  finalMult: 2,
  // Чтобы баннер «ФИНАЛ ×2» не повторялся при повторной доставке события.
  phaseBannerSeq: -1,

  ended: false,
  resetAt: 0,
  styleEarned: 0,

  continuePending: false,
  continueTimeout: 0,
  autoJoin: storageFlag(KEYS.matchAutoJoin, true),
  lastResults: null,

  // Последний тик, о котором рассказал сервер, и когда он к нам пришёл.
  lastEventsTick: 0,
  lastEventsAt: 0,

  // Раундовые модификаторы и охота за головой.
  mutatorType: 0,
  mutatorUntil: 0,
  bountyTarget: 0,
  bountyUntil: 0,
  powerUps: new Map()
};

export const PHASE_EXPANSION = 0;
export const PHASE_CONFLICT = 1;
export const PHASE_FINAL = 2;

/* Сетка, игроки и прочее содержимое снапшота. */
export const world = {
  // Типизированные массивы по размеру карты — пересоздаются в onInit.
  gridOwner: null,
  trailOwner: null,
  gridFillAt: null,
  coolSeenAt: null,
  minimapGridOwner: null,
  minimapImage: null,

  /* K1 «Туман войны»: границы последнего полученного ROI. Всё, что вне его,
     не рисуется из gridOwner — честное «не знаю» вместо уверенного вранья. */
  lastRoi: null,

  prevPlayers: new Map(),
  currPlayers: new Map(),
  headIndexByOwner: new Map(),
  lastPacketAt: 0,
  tickrate: 0,

  // Цвет игрока по номеру и производные от него кэши стилей.
  colors: new Map(),
  botIds: new Set(),

  // Имена: русское и английское, выбор делает displayNameOf().
  nameById: new Map(),
  nameEnById: new Map(),

  // Бывший владелец -> когда его остывающая земля исчезнет окончательно.
  coolDeadlineByOwner: new Map(),
  // Точка замыкания петли — из неё расходится волна заливки (J15).
  captureAnchorByOwner: new Map(),

  // Миникарта: что перерисовать и когда рисовали в прошлый раз.
  minimapDirty: true,
  minimapHadChunkUpdate: false,
  lastMinimapDrawAt: 0,

  // Видимая область в клетках — рамка обзора на миникарте.
  viewMinX: 0,
  viewMinY: 0,
  viewMaxX: 0,
  viewMaxY: 0
};

/* Свои показатели за матч. */
export const me = {
  kills: 0,
  streak: 0,
  shield: false,
  speedUntilTick: 0,
  speedType: 0,

  contractType: 0,
  contractGoal: 0,
  contractProgress: 0,
  contractUntil: 0,

  /* C7: слотов ежедневок у сервера три, и раньше клиент знал только про два —
     прогресс двух разных квестов писался в одни переменные и скакал.
     Хранилище по номеру слота; число слотов задаёт сервер. */
  dailies: new Map(),

  /* I2/F18: геометрия «своего» — длина следа и ближайшая своя клетка. */
  trailLen: 0,
  inOwnZone: true,
  nearestHomeX: -1,
  nearestHomeY: -1,
  nearestHomeAt: 0,

  // Последний снимок своей строки таблицы и причина последней смерти.
  lastStats: null,
  lastDeathInfo: null
};

/* Номера занятых слотов ежедневок по возрастанию. Живёт рядом с самим
   хранилищем, потому что число слотов задаёт сервер, и перебирать их нужно
   всем, кто рисует задания: и правой панели, и экрану меню. */
export function dailySlots() {
  return Array.from(me.dailies.keys()).sort((a, b) => a - b);
}

/* Кошелёк, инвентарь, титулы и состояние магазина. */
export const cos = {
  style: 0,
  titleId: 0,
  titleMask: 0,

  // Экипировка остальных игроков по номерам (из cosExtra).
  terrByPlayer: new Map(),
  deathByPlayer: new Map(),
  titleByPlayer: new Map(),

  // Таблицы, присланные сервером в hello.
  titleServerNames: new Map(),
  titleAchvById: new Map(),
  achvProgressById: new Map(),
  prices: null,

  // Состояние оверлея магазина.
  open: false,
  cat: 'terr',
  selId: 0,
  filter: 'all',
  earnExpanded: false,
  tabsScrolledCat: '',
  previewRaf: 0,
  previewLastAt: 0,

  // Откуда взято состояние: 'server' — подтверждено, 'cache' — локально.
  loaded: false,
  source: 'server',

  // Одна операция магазина в полёте, с жёстким таймаутом.
  pendingOp: null,
  opTimer: 0,

  // Источник строки статуса: функция, чтобы пережить смену языка.
  statusSrc: '',
  statusKind: ''
};

/* J19: мелкие начисления Стиля агрегируются в один тост «+N Стиля ×3» —
   иначе десяток захватов подряд забивает очередь тостов однотипными
   строками. Буфер копится до срабатывания таймера. */
export const styleToast = {
  acc: 0,
  reason: 0,
  count: 0,
  timer: 0
};

/* Флаги «перерисовать», которые ставит разбор пакета, а гасит кадр.
   K7/#8: killfeedDirty раньше выставлялся вручную следом за каждым
   pushEventFeed() в двенадцати ветках по типу события — забытая строка ничего
   видимо не ломала, но лента переставала обновляться до следующего пакета,
   дёрнувшего перерисовку по другой причине. */
export const ui = {
  killfeedDirty: false,
  chatDirty: false
};

/* Список комнат и форма создания — состояние экрана меню. */
export const rooms = {
  last: [],
  loading: false,
  loadError: '',
  loadTimeout: 0,
  selectedId: null,
  createOpen: false,
  createPending: false,
  // Когда можно снова автоматически спросить список у сервера.
  autoRefreshAt: 0
};

/* То, что выставил игрок; переживает перезагрузку страницы. */
export const settings = {
  fxEnabled: true,
  fxIntensity: 0.85,
  shakeIntensity: 0.55,
  fxPreset: 'normal',
  // Ручное переопределение авто-падения в «Спокойно» при reduced-motion.
  fxPresetUserSet: false,

  perfEnabled: false,

  soundEnabled: true,
  soundVolume: 0.7,
  muteOnBlur: true,
  soundMutedByBlur: false,

  /* Тактильный отклик. Включён по умолчанию, но срабатывает только там, где
     navigator.vibrate поддержан; iOS Safari его не знает. */
  hapticsEnabled: true,

  hudPanelOpacity: 0.82
};

/* Сиюминутное состояние эффектов — не сохраняется и не переживает матч. */
export const fxRt = {
  bursts: [],
  particles: [],
  shakeX: 0,
  shakeY: 0,
  shakeVelX: 0,
  shakeVelY: 0,
  /* { from, until } — hitstop, общее состояние с client_fx_ui.js. */
  hitstop: { from: 0, until: 0 },
  // Момент последнего спавна искр трассы разгона.
  spawnAt: { at: 0 },

  /* Точка, на которую наезжает камера при гибели. Её пишет экран смерти
     (client_endgame.js), а читает отрисовка кадра (client_render.js) — то
     есть это ровно межмодульное состояние, и жить оно должно здесь. Раньше
     это была пара `export let` в client_endgame.js: живые привязки ESM такое
     позволяют, но получалось единственное исключение из общего правила, и
     читателю приходилось выяснять, почему у этих двух чисел свой особый
     путь. */
  deathZoomAnchorX: 0,
  deathZoomAnchorY: 0
};

/* Счётчики панели производительности. */
export const netStat = {
  fps: 0,
  fpsLast: 0,
  fpsFrames: 0,
  pingMs: null,
  bytesInTotal: 0,
  bytesOutTotal: 0,
  bytesInSample: 0,
  bytesOutSample: 0,
  bytesSampleAt: null,
  downBps: null,
  upBps: null
};

/* Единственная точка записи ника: держит в согласии состояние и хранилище.
   Возвращает нормализованное имя, чтобы вызывающему не приходилось повторять
   ту же нормализацию. */
export function setPlayerName(nm) {
  const s = String(nm || '').trim();
  if (!s) return '';
  session.name = s;
  storageSet(KEYS.name, s);
  return s;
}

/* Сброс на границе матча. Раньше это была функция на 90 строк, которая
   принимала 25 значений и возвращала 35 — ровно потому, что писать в чужие
   переменные она не могла. Теперь это просто присваивания. */
export function resetForNewMatch() {
  match.styleEarned = 0;
  match.lastEventsTick = 0;
  match.lastEventsAt = 0;
  match.mutatorType = 0;
  match.mutatorUntil = 0;
  match.bountyTarget = 0;
  match.bountyUntil = 0;
  match.powerUps.clear();

  world.colors.clear();
  world.botIds.clear();
  world.coolDeadlineByOwner.clear();
  world.captureAnchorByOwner.clear();
  world.prevPlayers.clear();
  world.currPlayers.clear();
  world.headIndexByOwner.clear();
  world.lastRoi = null;
  world.lastPacketAt = performance.now();
  world.minimapDirty = true;
  world.minimapHadChunkUpdate = false;
  world.lastMinimapDrawAt = 0;

  me.kills = 0;
  me.streak = 0;
  me.shield = false;
  me.speedUntilTick = 0;
  me.speedType = 0;
  me.contractType = 0;
  me.contractGoal = 0;
  me.contractProgress = 0;
  me.contractUntil = 0;
  me.trailLen = 0;
  me.inOwnZone = true;
  me.nearestHomeX = -1;
  me.nearestHomeY = -1;
  me.nearestHomeAt = 0;
  me.lastStats = null;
  me.lastDeathInfo = null;

  fxRt.shakeX = 0;
  fxRt.shakeY = 0;
  fxRt.shakeVelX = 0;
  fxRt.shakeVelY = 0;
}
