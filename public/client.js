/* Точка входа клиента: только загрузчик.

   Логики здесь нет — всё живёт в модулях client_*.js, каждый из которых сам
   импортирует разметку (client_dom.js) и изменяемое состояние
   (client_store.js). Этот файл делает ровно три вещи: зовёт init-функции в
   нужном порядке, раздаёт модулям те немногие ссылки, которые нельзя
   импортировать без кольца (отправка в сокет, перерисовки), и подписывает
   на смену языка то, что собирается в JS и потому не переводится разметкой. */

import { installErrorLogging } from './client_errors.js';
import { initI18n, onLangChange, t } from './client_i18n_rt.js';
import { dom } from './client_dom.js';
import { initFxRt } from './client_fx_rt.js';
import { initOverlays, registerOverlayCloser } from './client_overlays.js';
import {
  connectWs,
  initNetBind,
  markJoinFunnelStart,
  rejoinFinish,
  rejoinGiveUp,
  trackEvent,
  wsIsConnected,
  wsSend,
  wsStatusSuffix
} from './client_net_bind.js';
import { initControls } from './client_controls.js';
import { ownerFillStyleCache, startRenderLoop } from './client_render.js';
import { ensureLeaderboardDom } from './client_leaderboard.js';
import { refreshBotNames } from './client_identity.js';
import {
  renderMetaHudImpl as renderMetaHud,
  renderTeamHudImpl as renderTeamHud,
  renderTopHudImpl as renderTopHud
} from './client_hud.js';
import {
  getLeaderboardPinnedDefault,
  getRightTabDefault,
  initHudPanels,
  initRightDetailsState,
  initRightPanelsDom,
  setLeaderboardPinned,
  setRightTab,
  updateLeaderboard,
  updateRightI18n
} from './client_hud_panels.js';
import {
  bindCosmeticsUi,
  initShop,
  renderCosmeticsStatus,
  renderMenuSkinPreview,
  syncCosmeticsUi
} from './client_shop.js';
import {
  hideMenuOverlay,
  initMenu,
  renderMenuMeta,
  showMenuOverlay,
  updateMenuNameUi,
  updateRoomInfo,
  updateRoomsUi
} from './client_menu.js';
import {
  initEndgame,
  renderDeathReason,
  renderDeathStats,
  syncMatchOverlayActions,
  updateMatchCountdown
} from './client_endgame.js';
import { initChat } from './client_chat.js';
import { initMinimapUi } from './client_minimap_ui.js';
import { initSettings } from './client_settings.js';
import { initViewport } from './client_viewport.js';

installErrorLogging();
initFxRt({ trackEvent });
initI18n();

/* Куски интерфейса, которые собираются в JS и потому не переводятся
   разметкой: каждая смена языка их пересобирает. */
onLangChange(() => {
  updateMenuNameUi();
  updateRoomsUi();
  updateRoomInfo();
  syncMatchOverlayActions();
  updateMatchCountdown();
  renderDeathStats();
  // C3: подпись под облик (титул + ник) зависит от языка.
  renderMenuSkinPreview();
  // K4: обе строки собираются в JS и раньше оставались на прежнем языке.
  renderDeathReason();
  renderCosmeticsStatus();
  renderTeamHud();
  renderTopHud();
  ensureLeaderboardDom(dom.stats, t);
  updateLeaderboard();
  /* C4: магазин собирается в JS и на смену языка не пересобирался — вкладки,
     «где это видно» и названия предметов оставались на прежнем языке прямо
     посреди переведённого интерфейса. */
  syncCosmeticsUi();
  renderMetaHud();
  updateRightI18n();
  refreshBotNames();
});

initOverlays();
registerOverlayCloser('menu', () => hideMenuOverlay());

/* Сеть поднимается первой из игровых модулей, и порядок здесь не косметика:
   initNetBind() собирает сокет и выставляет в поля ввода имя из прошлой
   сессии, а следом идут модули, которым нужны и wsSend, и это имя. Сам
   connect() отложен до конца файла — до него весь интерфейс уже собран, и
   первый же ответ сервера попадает в готовые обработчики. */
initNetBind();

/* Магазин живёт в client_shop.js/client_shop_ui.js и берёт состояние и разметку
   импортом. Импортировать он не может ровно три вещи: сокет (кольцо через
   client_net_bind.js), мета-блок меню (renderMenuMeta — не про магазин) и
   снимок имени. Их он получает один раз здесь. */
initShop({ wsSend, wsIsConnected, renderMenuMeta });

/* Экран меню и список комнат — в client_menu.js. Отсюда он получает только
   то, что зависит от сетевого модуля: отправку в сокет, состояние соединения
   и счётчики воронки входа. */
initMenu({
  wsSend,
  wsIsConnected,
  wsStatusSuffix,
  connectWs,
  trackEvent,
  markJoinFunnelStart,
  rejoinGiveUp,
  rejoinFinish
});

updateMenuNameUi();

/* Правая колонка живёт в client_hud_panels.js. Ссылку на перерисовку таблицы
   команды она получает здесь: импортировать её оттуда нельзя — client_hud.js
   сам импортирует из панелей syncRightEmptyStates. */
initHudPanels({ renderTeamHud });

/* Экраны смерти и итогов матча — в client_endgame.js. Отсюда он получает
   только отправку в сокет и общий с отрисовкой кэш стилей заливки. */
initEndgame({ wsSend, ownerFillStyleCache });

setLeaderboardPinned(getLeaderboardPinnedDefault());
initRightDetailsState();
setRightTab(getRightTabDefault(), false);

/* Чат поднимается только после сетевого модуля: статус в его шапке спрашивает
   у сокета суффикс состояния. */
initChat({ wsSend, wsStatusSuffix });

/* Значки непрочитанного, заглушки пустых панелей и блок «События» —
   в client_hud_panels.js. Сборка узлов оставлена ровно на этом месте:
   блок событий переносит #killfeed внутрь нового <details>, и делать это
   раньше значило бы поменять момент перестройки разметки. */
initRightPanelsDom();

// Клавиатура и свайпы: направление уходит прямо в сокет.
initControls({ wsSend });

showMenuOverlay();
connectWs();

initSettings();
bindCosmeticsUi();
/* Пересчёт канваса и просьба к серверу об окне — после того, как готовы и
   сокет (wsSend), и панель облика в меню (renderMenuSkinPreview). */
initViewport({ send: wsSend, onResized: renderMenuSkinPreview });
initMinimapUi();

startRenderLoop();

/* Мост для широкого каталога состояний визуального ревью
   (tests/visual/catalog.spec.mjs, docs/reviews/review-loop-prompt.md) —
   загружается только под ?debug=1, см. client_debug.js. Динамический
   import() внутри if гарантирует, что на проде без флага файл не запрашивается
   вовсе. */
if (new URLSearchParams(location.search).get('debug') === '1') {
  import('./client_debug.js').catch((e) => console.error('client_debug', e));
}
