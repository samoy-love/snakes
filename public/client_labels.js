/* Подписи и форматирование: как число, срок или числовой код превращаются в
   строку для игрока.

   Собрано в один модуль, потому что у всего этого одна природа: почти чистая
   функция над словарём (infoPack) и стором (язык, длина тика, последнее
   событие). Раньше эти два десятка функций были размазаны по client.js между
   отрисовкой и обработчиками, и каждый вынесенный модуль просил их через
   deps-объект по одной.

   Арифметика форматирования живёт в client_format.js и покрыта тестами там.
   Здесь — только подстановка текущего состояния в её аргументы. */

import { DEATH_REASON, deathReasonSuffix } from './client_death.js';
import {
  approxTickNow,
  formatClock,
  formatInt,
  formatPct1,
  formatRemainMs,
  remainMsToTick
} from './client_format.js';
import { infoPack, isEn, lang, t } from './client_i18n_rt.js';
import { match, session } from './client_store.js';

// --- Числа -------------------------------------------------------------------

export function fmtInt(n) {
  return formatInt(n, lang());
}

export function fmtPct1(n) {
  return formatPct1(n, lang());
}

/** Часы:минуты метки строки чата. */
export function formatTime(ms) {
  return formatClock(ms);
}

// --- Имена и описания из словаря --------------------------------------------

export function infoName(map, type, fallback) {
  const it = map && map[type];
  return it?.name || fallback || '';
}

export function infoDesc(map, type, fallback) {
  const it = map && map[type];
  return it?.desc || fallback || '';
}

export function powerupLabel(type) {
  const p = infoPack();
  return infoName(p.powerups, type, t('name.item_fallback'));
}

export function mutatorLabel(type) {
  const p = infoPack();
  return infoName(p.mutators, type, '');
}

export function contractLabel(type) {
  const p = infoPack();
  return infoName(p.contracts, type, '');
}

export function dailyLabel(type) {
  const p = infoPack();
  return infoName(p.dailies, type, t('name.daily_fallback'));
}

export function achvLabel(type) {
  const p = infoPack();
  return infoName(p.achv, type, isEn() ? `Achievement ${type}` : `Достижение ${type}`);
}

export function styleLabel(type) {
  const p = infoPack();
  return infoName(p.style, type, p.labels.style);
}

// --- Обратный отсчёт ---------------------------------------------------------

/* Арифметика — в client_format.js, здесь только чтение состояния
   (session.tickMs, последний известный тик и когда он пришёл). */
export function approxNowTick() {
  return approxTickNow({
    tickMs: session.tickMs,
    lastEventsTick: match.lastEventsTick,
    lastEventsAt: match.lastEventsAt,
    nowMs: Date.now()
  });
}

export function formatTickRemain(untilTick) {
  return formatRemainMs(remainMsToTick(untilTick, approxNowTick(), session.tickMs));
}

export function tickRemainSeconds(untilTick) {
  const ms = remainMsToTick(untilTick, approxNowTick(), session.tickMs);
  return ms == null ? null : ms / 1000;
}

/* F5 «Реклейм»: точный момент истечения приходит с сервера в EventCoolBatch
   (kind 21, поле C — тик исчезновения), и отсчёт ведётся по нему. Константа
   ниже — только запасной вариант на те кадры, когда клетка уже пришла с флагом
   остывания, а событие с дедлайном ещё нет, плюс потолок на приходящее
   значение. Держать её в соответствии с ReclaimTicks в internal/game/grid.go:
   150 тиков по 100 мс = 15 секунд. Расхождение здесь не ломает игру, но
   заставляет полосу отсчёта врать до прихода события. */
export const RECLAIM_WINDOW_MS = 15000;

/* Окно реклейма, как его назвал сервер в hello (reclaimTicks). Нужно тексту
   подсказки на экране смерти: вписанное в словарь число уже один раз пережило
   изменение константы на сервере. Пусто — старый сервер, работает встроенное
   значение. */
export function reclaimWindowSec() {
  const ticks = Number(session.reclaimTicksFromServer) || 0;
  const ms = ticks > 0 ? ticks * (Number(session.tickMs) || 100) : RECLAIM_WINDOW_MS;
  return Math.round(ms / 1000);
}

// --- Причина смерти ----------------------------------------------------------

export function deathReasonLabel(reason) {
  const suffix = deathReasonSuffix(reason);
  return suffix ? t(`death.reason.${suffix}`) : '';
}

export function deathReasonText(info) {
  const killer = Number(info?.killer) || 0;
  const killerName = String(info?.killerName || '').trim();
  const rs = deathReasonLabel(info?.reason);
  if (killer && killer === session.you) return rs ? `${t('death.reason_prefix')}: ${rs}` : '';
  if (killer && killerName) return rs ? `${t('death.killed_by')}: ${killerName} (${rs})` : `${t('death.killed_by')}: ${killerName}`;
  return rs ? `${t('death.reason_prefix')}: ${rs}` : '';
}

// F15: сухое «Разрез следа» ничего не объясняет новичку. Даём правило игры.
export function deathReasonHint(info) {
  const reason = Number(info?.reason) || 0;
  const killerName = String(info?.killerName || '').trim();
  if (reason === DEATH_REASON.CUT && killerName) {
    return isEn()
      ? `${killerName} crossed your trail. Until the loop is closed you are vulnerable.`
      : `${killerName} пересёк твой след. Пока след не замкнут — ты уязвим.`;
  }
  const suffix = deathReasonSuffix(reason);
  return suffix ? t(`death.hint.${suffix}`) : t('death.hint.generic');
}
