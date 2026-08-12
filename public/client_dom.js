/* Ссылки на узлы разметки — одним списком.

   Раньше сотня `document.getElementById(...)` лежала прямо в client.js, и
   любой модуль, которому нужен был хоть один узел, получал его через deps:
   client_settings.js просил восемнадцать полей, client_shop_ui.js —
   тринадцать. Узлы не меняются за время жизни страницы, поэтому передавать
   их по цепочке вызовов нечего — достаточно импортировать отсюда.

   Файл сознательно не импортирует ничего: он вычисляется первым, и любой
   модуль может рассчитывать на готовый dom к моменту своей инициализации.

   Отсутствующий узел — это null, а не исключение: разметка знает про
   мобильную и десктопную раскладку, и половина панелей на телефоне не
   существует вовсе. Проверять `if (!dom.x) return` — норма, как и было. */

const byId = (id) => document.getElementById(id);

export const dom = {
  // Поле и его контекст.
  canvas: byId('game'),
  minimap: byId('minimap'),

  // Верхний HUD матча.
  hud: byId('hud'),
  lbBtn: byId('lbBtn'),
  stats: byId('stats'),
  topHud: byId('topHud'),
  topHudCells: byId('topHudCells'),
  topHudPct: byId('topHudPct'),
  topHudTime: byId('topHudTime'),
  topHudKills: byId('topHudKills'),
  topHudContract: byId('topHudContract'),
  topHudBarFill: byId('topHudBarFill'),
  metaHud: byId('metaHud'),
  teamHud: byId('teamHud'),
  killfeed: byId('killfeed'),
  eventToasts: byId('eventToasts'),
  perf: byId('perf'),
  roomInfo: byId('roomInfo'),

  // Правая колонка.
  rightSidebar: byId('rightSidebar'),
  rightInfo: byId('rightInfo'),
  rightMatchDetails: byId('rightMatchDetails'),
  rightTeamDetails: byId('rightTeamDetails'),

  // Чат.
  chat: byId('chat'),
  chatHeader: byId('chatHeader'),
  chatHeaderHint: byId('chatHeaderHint'),
  chatLog: byId('chatLog'),
  chatForm: byId('chatForm'),
  chatInput: byId('chatInput'),
  chatInputOverlay: byId('chatInputOverlay'),
  chatUnread: byId('chatUnread'),
  chatBtn: byId('chatBtn'),
  emojiBtn: byId('emojiBtn'),
  emojiPanel: byId('emojiPanel'),
  emojiCloseBtn: byId('emojiCloseBtn'),
  emojiRecent: byId('emojiRecent'),
  emojiGrid: byId('emojiGrid'),

  // Миникарта: легенда и полноэкранный режим.
  minimapLegend: byId('minimapLegend'),
  minimapOverlay: byId('minimapOverlay'),
  minimapOverlayCloseBtn: byId('minimapOverlayCloseBtn'),
  minimapOverlayCanvas: byId('minimapOverlayCanvas'),
  minimapMobileBtn: byId('minimapMobileBtn'),

  // Меню.
  menuOverlay: byId('menuOverlay'),
  menuNameInput: byId('menuNameInput'),
  menuNameError: byId('menuNameError'),
  menuNameRandomBtn: byId('menuNameRandomBtn'),
  menuOnboarding: byId('menuOnboarding'),
  menuMeta: byId('menuMeta'),
  menuSkinPreview: byId('menuSkinPreview'),
  menuOnlineCount: byId('menuOnlineCount'),
  menuOnlineBadge: byId('menuOnlineBadge'),
  playBtn: byId('playBtn'),
  langToggleGlobal: byId('langToggleGlobal'),

  // Ник в игровом HUD (устаревшая форма, но живая).
  nameInput: byId('nameInput'),
  nameBtn: byId('nameBtn'),

  // Комнаты.
  joinRoomBtn: byId('joinRoomBtn'),
  toggleCreateRoomBtn: byId('toggleCreateRoomBtn'),
  refreshRoomsBtn: byId('refreshRoomsBtn'),
  roomsStats: byId('roomsStats'),
  roomsList: byId('roomsList'),
  roomsSearchInput: byId('roomsSearchInput'),
  roomsSearchClearBtn: byId('roomsSearchClearBtn'),
  roomsSortSelect: byId('roomsSortSelect'),
  roomsCreate: byId('roomsCreate'),
  roomsCreateNameInput: byId('roomsCreateNameInput'),
  roomsCreateError: byId('roomsCreateError'),
  createRoomBtn: byId('createRoomBtn'),
  leaveBtn: byId('leaveBtn'),

  /* Общая подложка режимов «смерть» и «итоги матча»: видимость выводится из
     видимости самих режимов в syncOverlayUiState(), своего show/hide нет. */
  endOverlay: byId('endOverlay'),
  deathOverlay: byId('deathOverlay'),
  restartBtn: byId('restartBtn'),
  deathMenuBtn: byId('deathMenuBtn'),
  deathReason: byId('deathReason'),
  deathStats: byId('deathStats'),

  matchOverlay: byId('matchOverlay'),
  matchResults: byId('matchResults'),
  matchCountdown: byId('matchCountdown'),
  matchContinueBtn: byId('matchContinueBtn'),
  matchMenuBtn: byId('matchMenuBtn'),

  // Настройки.
  settingsBtn: byId('settingsBtn'),
  settingsOverlay: byId('settingsOverlay'),
  closeSettingsBtn: byId('closeSettingsBtn'),
  fxEnabledInput: byId('fxEnabled'),
  fxIntensityInput: byId('fxIntensity'),
  shakeIntensityInput: byId('shakeIntensity'),
  perfEnabledInput: byId('perfEnabled'),
  perfCompactInput: byId('perfCompact'),
  soundEnabledInput: byId('soundEnabled'),
  soundVolumeInput: byId('soundVolume'),
  muteOnBlurInput: byId('muteOnBlur'),
  hapticsInput: byId('hapticsEnabled'),
  hapticsRow: byId('hapticsRow'),
  testBeepBtn: byId('testBeepBtn'),
  resetSettingsBtn: byId('resetSettingsBtn'),
  hudBrightnessInput: byId('hudBrightness'),
  hudContrastInput: byId('hudContrast'),
  hudPanelOpacityInput: byId('hudPanelOpacity'),

  // Магазин.
  cosmeticsBtn: byId('cosmeticsBtn'),
  cosmeticsMenuBtn: byId('cosmeticsMenuBtn'),
  cosmeticsOverlay: byId('cosmeticsOverlay'),
  cosmeticsCloseBtn: byId('cosmeticsCloseBtn'),
  cosmeticsStyle: byId('cosmeticsStyle'),
  cosmeticsEarnStyle: byId('cosmeticsEarnStyle'),
  cosmeticsTabs: byId('cosmeticsTabs'),
  cosmeticsItems: byId('cosmeticsItems'),
  cosmeticsPreview: byId('cosmeticsPreview'),
  cosmeticsHint: byId('cosmeticsHint'),
  cosmeticsWhere: byId('cosmeticsWhere'),
  cosmeticsStatus: byId('cosmeticsStatus'),
  cosmeticsStyleInfoBtn: byId('cosmeticsStyleInfoBtn'),
  cosmeticsFilterAllBtn: byId('cosmeticsFilterAll'),
  cosmeticsFilterOwnedBtn: byId('cosmeticsFilterOwned'),
  cosmeticsFilterAvailableBtn: byId('cosmeticsFilterAvailable'),

  /* Единственный узел, который не приходит из разметки: .matchActions лежит
     внутри #matchOverlay и своего id не имеет. */
  matchActions: byId('matchOverlay')?.querySelector?.('.matchActions') || null
};

/* Поле ввода чата подменяется на <textarea> в client_chat_runtime.js (нужен
   перенос строки по Shift+Enter, у <input> его нет). Ссылка в dom обязана
   указывать на живой узел, поэтому подмена идёт через эту функцию, а не
   присваиванием в чужом модуле. */
export function setChatInputEl(el) {
  dom.chatInput = el || null;
}
