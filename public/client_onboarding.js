/* F15/F17 — мягкая первая сессия. Вынесено из client.js — вызовы и порядок
   выполнения не менялись, только источник импорта.

   Новичок видит шесть мета-систем одновременно поверх непонятой базовой
   механики. В первом матче они открываются по одной, а путь домой
   подсвечивается стрелкой, пока игрок ни разу не замкнул петлю.

   Функции без внешних зависимостей (только localStorage/performance)
   экспортируются напрямую и используются в client.js как есть. Функции,
   которым нужны addToast/t/hasFirstCapture/started из client.js, оформлены
   как *Impl(..., deps) — как и в client_death_ui.js/client_hud.js, client.js
   держит тонкую обёртку с тем же именем, которая передаёт deps. */

import { KEYS, storageBump, storageGet, storageSet } from './client_storage.js';


// Пороги подобраны так, чтобы первый захват (15-20 с) успел случиться раньше
// любой мета-системы: сначала правило игры, потом надстройки над ним.
/* K5: ступени онбординга висели на секундомере ПЕРВОГО матча (105/135/165 с),
   а `obUnlocked()` открывал всё сразу после двух сыгранных матчей. Новичок,
   умерший дважды за первые две минуты (типичный сценарий), не видел ни одной
   ступени и на второй жизни получал сразу весь HUD.
   Теперь ступень привязана к событию — к моменту, когда механика впервые
   становится осмысленной. Таймер остался только страховкой для игрока, который
   за все эти секунды так ничего и не сделал. */
export const OB_STAGES = [
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
  const raw = storageGet(KEYS.obStage);
  if (raw) for (const s of String(raw).split(',')) if (s) obStagesShown.add(s);
  return obStagesShown;
}

function obMarkStageShown(id) {
  const set = obLoadStages();
  if (set.has(id)) return;
  set.add(id);
  storageSet(KEYS.obStage, Array.from(set).join(','));
}

// Первый матч в жизни игрока: только в нём мета-системы придерживаются.
function obFirstMatch() {
  return obMatchesEntered() <= 1;
}

// Второй и дальше — ежедневки и магазин уже показываем.
export function obSecondMatchPlus() {
  return obMatchesEntered() >= 2;
}

export function obDeathsSeen() {
  /* Хранилище недоступно (onFail=99) — считаем игрока опытным: подсказки
     новичка лучше не показать вовсе, чем показывать их каждую сессию. Ключа
     нет — игрок действительно новый, ноль смертей. */
  return Math.max(0, Number(storageGet(KEYS.obDeaths, '99')) || 0);
}

export function obBumpDeaths() {
  storageBump(KEYS.obDeaths);
}

function obMatchElapsed() {
  if (!obMatchStartAt) return 0;
  return performance.now() - obMatchStartAt;
}

/* Отдельный счётчик «сколько матчей игрок начал». FIRST_MATCH_KEY растёт только
   в onMatchEnd, а тот приходит не всегда (умер и досидел до конца в оверлее
   смерти — экран итогов не показывается). Онбординг на таком счётчике завис бы
   в режиме «первый матч» навсегда, поэтому у него свой, по входам. */

/* C10: значение читалось из localStorage по 3-4 раза за кадр (obTick +
   obUnlocked + obSecondMatchPlus в renderTopHud) — ~180 синхронных чтений в
   секунду. Кэшируем в памяти: писать в ключ может только этот же модуль. */
let obEnteredCache = null;

function obMatchesEntered() {
  if (obEnteredCache != null) return obEnteredCache;
  obEnteredCache = Math.max(0, Number(storageGet(KEYS.obEntered, '99')) || 0);
  return obEnteredCache;
}

function obBumpMatchesEntered() {
  const next = obMatchesEntered() + 1;
  obEnteredCache = next;
  storageSet(KEYS.obEntered, next);
}

// Разблокирована ли мета-система. Вне первого матча — всё открыто.
export function obUnlocked(id) {
  if (!obFirstMatch()) return true;
  const st = OB_STAGES.find((s) => s.id === id);
  if (!st) return true;
  // K5: ступень, уже показанная по событию, остаётся открытой — в том числе
  // после смерти и респавна в том же матче.
  if (obLoadStages().has(st.id)) return true;
  return obMatchElapsed() >= st.at;
}

// K5: показать ступень (один раз за всю жизнь профиля). deps: addToast, t.
function obShowStageImpl(st, deps) {
  if (!st) return;
  const { addToast, t } = deps;
  const set = obLoadStages();
  if (set.has(st.id)) return;
  obMarkStageShown(st.id);
  addToast(st.icon, t(st.title), 'big', t(st.desc), { key: `onb_${st.id}`, prio: 'important' });
}

/* K5: событийный триггер. kind — 'capture' | 'kill' | 'death'.
   Молчит у ветеранов (больше трёх входов в матч) — им объяснять нечего.
   deps: addToast, t (передаются дальше в obShowStageImpl). */
export function obFireEventImpl(kind, deps) {
  if (obMatchesEntered() > 3) return;
  for (const st of OB_STAGES) {
    if (st.on !== kind) continue;
    obShowStageImpl(st, deps);
  }
}

// F15: стрелка домой живёт, пока игрок ни разу не замкнул петлю.
// deps: hasFirstCapture.
export function obGuideActiveImpl(deps) {
  return !deps.hasFirstCapture() && obMatchesEntered() <= 2;
}

/* C9: возврат после обрыва связи — не «новый матч». Раньше два разрыва Wi-Fi
   у новичка досрочно выключали весь онбординг. */
export function obResetMatch(countEntry = true) {
  obMatchStartAt = performance.now();
  if (countEntry) obBumpMatchesEntered();
}

// Вызывается из renderTopHud (каждый кадр), поэтому дешёвая: сравнение чисел.
// deps: started, addToast, t.
export function obTickImpl(deps) {
  if (!deps.started || !obMatchStartAt || obMatchesEntered() > 2) return;
  const el = obMatchElapsed();
  for (const st of OB_STAGES) {
    // K5: таймер теперь только страховка — событие обычно срабатывает раньше.
    if (el < st.at) continue;
    obShowStageImpl(st, deps);
  }
}

// Магазин и ежедневки — со второго матча, одним тостом и один раз.
// deps: addToast, t.
export function obAnnounceShopImpl(deps) {
  if (!obSecondMatchPlus()) return;
  if (obMatchesEntered() > 3) return;
  const set = obLoadStages();
  if (set.has('shop')) return;
  obMarkStageShown('shop');
  const { addToast, t } = deps;
  setTimeout(() => {
    addToast('🎨', t('onb.shop_title'), 'big', t('onb.shop_desc'), { key: 'onb_shop', prio: 'important' });
  }, 2500);
}
