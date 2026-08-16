/* Правая колонка и лента событий.

   Здесь живёт всё, что относится к сайдбару матча: раскрытость <details>
   «Матч»/«Команда», переключение вкладок, значки непрочитанного, заглушки
   пустых панелей, закрепление таблицы лидеров и сама лента событий
   (eventFeed + её отрисовка).

   Модуль импортирует dom и группы стора напрямую — deps-объект ему не
   нужен. Единственный вызов наружу, который иначе замкнул бы импорты в
   кольцо (client_hud.js уже импортирует отсюда syncRightEmptyStates), —
   перерисовка таблицы команды; она приходит через initHudPanels().

   Порядок создания разметки сохранён прежним: сами узлы (значки, заглушки,
   блок событий) собираются не при загрузке модуля, а в initRightPanelsDom(),
   которую client.js зовёт ровно там, где раньше стояли соответствующие
   const-объявления. */

import { dom } from './client_dom.js';
import { KEYS, storageFlag, storageGet, storageSet, storageSetFlag } from './client_storage.js';
import { clientState } from './client_state.js';
import { cos, me, session, ui } from './client_store.js';
import { lang, t } from './client_i18n_rt.js';
import { botArchBadge, botArchInfo, cosTitleName } from './client_identity.js';
import { pushEventFeedImpl, renderKillfeedImpl } from './client_fx_ui.js';
import { updateLeaderboard as renderLeaderboard } from './client_leaderboard.js';
import { bumpChatOpenUntilBy, setChatCollapsed } from './client_chat.js';
import { setToastActionHandler } from './client_toasts.js';

/* Перерисовка таблицы команды. Импортировать её отсюда нельзя: client_hud.js
   импортирует syncRightEmptyStates из этого файла. */
let renderTeamHudRef = null;

export function initHudPanels(ctx) {
  renderTeamHudRef = ctx?.renderTeamHud || null;

  /* Клик по тосту события уводит в раздел правой колонки. Сами тосты про
     вкладки не знают — обработчик регистрирует тот, кто вкладками владеет.
     Без этой строки тост остаётся нажимаемым на вид (role=button, фокус,
     aria-label), а клик не делает ничего. */
  setToastActionHandler((action) => {
    const tab = String(action?.tab || '');
    if (tab === 'match' || tab === 'team' || tab === 'chat') setRightTab(tab, true);
  });

  // Кнопка «закрепить таблицу лидеров» — рядом с самим закреплением.
  dom.lbBtn?.addEventListener('click', () => {
    if (!dom.hud) return;
    setLeaderboardPinned(!dom.hud.classList.contains('lbPinned'));
  });

  /* Секундный тик таблицы лидеров: строки зависят не только от пакетов
     сервера (время удержания, окно реклейма), поэтому между снапшотами она
     всё равно должна оживать. */
  setInterval(() => {
    updateLeaderboard();
  }, 1000);
}

/* ==========================================================================
 * Закрепление таблицы лидеров
 * ====================================================================== */


export function setLeaderboardPinned(v) {
  if (!dom.hud) return;
  const on = !!v;
  if (on) dom.hud.classList.add('lbPinned');
  else dom.hud.classList.remove('lbPinned');
  storageSetFlag(KEYS.leaderboardPinned, on);

  if (session.started) {
    renderTeamHudRef?.();
  }
}

export function getLeaderboardPinnedDefault() {
  return storageFlag(KEYS.leaderboardPinned, false);
}

/* ==========================================================================
 * Раскрытость панелей и вкладки правой колонки
 * ====================================================================== */


export function initRightDetailsState() {
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
    el.open = storageFlag(key, defaultOpen);
    el.addEventListener('toggle', () => {
      storageSetFlag(key, el.open);
    });
  };

  initOne(dom.rightMatchDetails, KEYS.rightMatchOpen, true);
  initOne(dom.rightTeamDetails, KEYS.rightTeamOpen, isDesktop);
}

/* Выбранная вкладка правой колонки.

   Ключ rightTab читался при старте (getRightTabDefault), но записать его было
   некому: ни одна ветка не сохраняла выбор. То есть «запомнить последнюю
   вкладку» не работало никогда — колонка всегда открывалась на «Матче».
   Сохраняем только выбор ИГРОКА (fromUser): восстановление вкладки при
   загрузке само зовёт эту функцию, и без флага оно бы просто переписывало
   ключ тем же значением. */
export function setRightTab(tab, fromUser) {
  const id = String(tab || 'match');
  if (id !== 'match' && id !== 'team' && id !== 'chat') return;
  if (fromUser) storageSet(KEYS.rightTab, id);
  if (id === 'chat') {
    if (dom.chat.classList.contains('collapsed')) setChatCollapsed(false);
    bumpChatOpenUntilBy(12000);
    if (dom.chatInput && document.activeElement !== dom.chatInput) {
      try {
        dom.chatInput.focus();
      } catch {}
    }
    return;
  }

  const target = id === 'team' ? dom.teamHud : dom.metaHud;
  if (dom.rightInfo && target) {
    const top = Math.max(0, (target.offsetTop || 0) - 6);
    try {
      dom.rightInfo.scrollTo({ top, behavior: fromUser ? 'smooth' : 'auto' });
    } catch {
      dom.rightInfo.scrollTop = top;
    }
  }
}


export function getRightTabDefault() {
  const raw = storageGet(KEYS.rightTab);
  return raw === 'match' || raw === 'team' || raw === 'chat' ? raw : 'match';
}

export function bumpMatchTabBadge() {
  if (!dom.rightInfo) return;
  dom.rightInfo.classList.add('rightInfoPulse');
  window.clearTimeout(bumpMatchTabBadge._t);
  bumpMatchTabBadge._t = window.setTimeout(() => {
    dom.rightInfo.classList.remove('rightInfoPulse');
  }, 550);

  try {
    if (dom.rightMatchDetails && !dom.rightMatchDetails.open) {
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

/* ==========================================================================
 * Значки непрочитанного и заглушки пустых панелей
 * ====================================================================== */

let matchUnreadCount = 0;
let teamUnreadCount = 0;
let eventsUnreadCount = 0;

export function getTeamUnreadCount() {
  return teamUnreadCount;
}

export function setTeamUnreadCount(v) {
  teamUnreadCount = v;
}

function createSummaryBadge(detailsEl) {
  const sum = detailsEl?.querySelector?.('.rightDetailsSummary');
  if (!sum) return null;
  const el = document.createElement('span');
  el.className = 'badge hidden';
  el.setAttribute('aria-hidden', 'true');
  sum.appendChild(el);
  return el;
}

export function setBadgeCount(el, n) {
  if (!el) return;
  const v = Math.max(0, Number(n) || 0);
  el.textContent = v > 99 ? '99+' : String(v);
  el.classList.toggle('hidden', v <= 0);
}

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
  el._descEl = dEl;
  el._descKey = descKey;
  return el;
}

let rightMatchBadgeEl = null;
let rightTeamBadgeEl = null;
let rightEventsBadgeEl = null;
let rightEventsDetailsEl = null;
let rightMatchEmptyEl = null;
let rightTeamEmptyEl = null;
let rightEventsEmptyEl = null;

export function getRightTeamBadgeEl() {
  return rightTeamBadgeEl;
}

/* Сборка узлов правой колонки. Отдельно от загрузки модуля: блок событий
   переносит #killfeed внутрь нового <details>, и делать это на импорте —
   значит незаметно поменять момент, в который разметка перестраивается. */
export function initRightPanelsDom() {
  rightMatchBadgeEl = createSummaryBadge(dom.rightMatchDetails);
  rightTeamBadgeEl = createSummaryBadge(dom.rightTeamDetails);

  rightEventsDetailsEl = (() => {
    if (!dom.rightInfo || !dom.killfeed) return null;
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
      dom.killfeed.parentElement?.removeChild?.(dom.killfeed);
    } catch {}
    det.appendChild(dom.killfeed);
    dom.rightInfo.appendChild(det);
    return det;
  })();

  rightEventsBadgeEl = createSummaryBadge(rightEventsDetailsEl);

  rightMatchEmptyEl = createRightEmpty(dom.rightMatchDetails, 'right.match_empty_title', 'right.match_empty_desc');
  rightTeamEmptyEl = createRightEmpty(dom.rightTeamDetails, 'right.team_empty_title', 'right.team_empty_desc');
  rightEventsEmptyEl = createRightEmpty(rightEventsDetailsEl, 'right.events_empty_title', 'right.events_empty_desc');

  dom.rightMatchDetails?.addEventListener?.('toggle', () => {
    if (dom.rightMatchDetails.open) {
      matchUnreadCount = 0;
      setBadgeCount(rightMatchBadgeEl, matchUnreadCount);
    }
  });

  dom.rightTeamDetails?.addEventListener?.('toggle', () => {
    if (dom.rightTeamDetails.open) {
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
}

export function syncRightEmptyStates() {
  const matchEmpty = !session.started || !dom.metaHud || dom.metaHud.style.display === 'none' || dom.metaHud.childElementCount === 0;
  const teamEmpty = !session.started || !dom.teamHud || !String(dom.teamHud.textContent || '').trim();
  const eventsEmpty = !session.started || !dom.killfeed || dom.killfeed.childElementCount === 0;
  if (rightMatchEmptyEl) {
    rightMatchEmptyEl.classList.toggle('hidden', !matchEmpty);
    /* Панель «МАТЧ» пуста, но матч уже идёт (например, контракт активен и
       виден в верхней полосе, а самой панели попросту нечего добавить) —
       текст «Начните матч» в этом случае лжёт: игрок уже в матче. */
    if (matchEmpty && rightMatchEmptyEl._descEl) {
      const active = session.started && !!me.contractType;
      const startedNoContract = session.started && !me.contractType;
      const descKey = active
        ? 'right.match_empty_desc_active'
        : startedNoContract
          ? 'right.match_empty_desc_no_contract'
          : rightMatchEmptyEl._descKey;
      rightMatchEmptyEl._descEl.textContent = t(descKey);
      const titleEl = rightMatchEmptyEl.querySelector('.rightEmptyTitle');
      const titleKey = active
        ? 'right.match_empty_title_active'
        : startedNoContract
          ? 'right.match_empty_title_no_contract'
          : 'right.match_empty_title';
      if (titleEl) titleEl.textContent = t(titleKey);
    }
  }
  if (rightTeamEmptyEl) rightTeamEmptyEl.classList.toggle('hidden', !teamEmpty);
  if (rightEventsEmptyEl) rightEventsEmptyEl.classList.toggle('hidden', !eventsEmpty);
}

export function updateRightI18n() {
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
      const active = session.started && !!me.contractType;
      const startedNoContract = session.started && !me.contractType;
      if (tt) {
        tt.textContent = t(active
          ? 'right.match_empty_title_active'
          : startedNoContract
            ? 'right.match_empty_title_no_contract'
            : 'right.match_empty_title');
      }
      if (dd) {
        dd.textContent = t(active
          ? 'right.match_empty_desc_active'
          : startedNoContract
            ? 'right.match_empty_desc_no_contract'
            : 'right.match_empty_desc');
      }
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

/* ==========================================================================
 * Лента событий
 * ====================================================================== */

export const eventFeed = [];

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
/* Какие события вообще попадают в ленту. Лента — не лог сервера, а ответ на
   вопрос игрока «что важного только что случилось со мной и вокруг меня»:
     - смерти и убийства (кто опасен, кого убрали) — всегда;
     - глобальные объявления матча (баунти, мутатор раунда) — всегда;
     - всё остальное — захваты, реклеймы, поднятые бонусы, серии, ачивки,
       контракты — только СВОИ. Чужой «+91 зоны» или «поднял: Рывок» ничего
       не сообщает о раскладе и топил в ленте собственные события игрока;
     - начисления стиля («+1 стиль (Захват)») в ленту не идут вовсе: их уже
       показывает тост внизу слева, вторая копия справа — шум. */
const FEED_GLOBAL_KINDS = new Set(['Kill', 'Death', 'Revenge', 'Bounty', 'Round']);

function feedEventRelevant(kind, actorNum) {
  const k = String(kind || '');
  if (FEED_GLOBAL_KINDS.has(k)) return true;
  const a = Number(actorNum);
  return Number.isFinite(a) && a === session.you;
}

export function pushEventFeed(text, kind, actorNum) {
  if (!feedEventRelevant(kind, actorNum)) return;
  pushEventFeedImpl(text, kind, actorNum, {
    eventFeed,
    setKillfeedDirty: (v) => {
      ui.killfeedDirty = v;
    }
  });
}

export function renderKillfeed() {
  renderKillfeedImpl({
    killfeedEl: dom.killfeed,
    eventFeed,
    you: session.you,
    lang: lang(),
    botArchInfo,
    botArchBadge,
    rightEventsDetailsEl,
    getEventsUnreadCount: () => eventsUnreadCount,
    setEventsUnreadCount: (v) => {
      eventsUnreadCount = v;
    },
    setBadgeCount,
    rightEventsBadgeEl,
    syncRightEmptyStates
  });
}

export function updateLeaderboard() {
  renderLeaderboard(clientState.lastState, {
    you: session.you,
    mapCells: session.mapCells,
    statsEl: dom.stats,
    t,
    cosTitleByPlayer: cos.titleByPlayer,
    botArchInfo,
    botArchBadge,
    cosTitleName,
    lang: lang()
  });
}
