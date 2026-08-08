/* «Желаемая» экипировка: что игрок выбрал, пока сервер был недоступен.

   Зачем это вообще. Магазин работает и без соединения — предметы берутся из
   локального кэша. Игрок может надеть скин, пока идёт переподключение, и
   выбор обязан пережить это: иначе экипировка молча откатывается на то, что
   помнит сервер, и выглядит как «игра не сохранила покупку».

   Здесь только модель: чтение, запись и ПЛАН применения. Отправкой на сервер
   и показом ошибок занимается client.js — так план можно проверить тестом,
   не поднимая ни WebSocket, ни DOM.

   Соответствие «категория -> поле» не живёт здесь: в хранилище лежат ровно те
   имена, что и на проводе (eqHead, eqCaptureFx), и выводит их eqField из
   client_cos_state.js. Своя копия этого списка здесь уже была — с теми же
   значениями, но отдельным объектом; новая категория косметики требовала
   правки в двух файлах, а забытая правка означала «выбор сохраняется, но не
   применяется никогда». */

import { COS_STATE_CATS, eqField } from './client_cos_state.js';

/* Ключ обязан совпадать с прежним: под ним уже лежит выбор у живых игроков,
   и переименование молча стёрло бы его — «игра не сохранила экипировку». */
export const COSMETICS_DESIRED_KEY = 'snakes_cosmetics_desired_v1';

const MAX_ID = 7;
const clampId = (v) => Math.max(0, Math.min(MAX_ID, Number(v) || 0));

/** Прочитать сохранённый выбор. Любая порча хранилища — как будто выбора нет. */
export function loadDesired(storage) {
  try {
    const raw = storage?.getItem?.(COSMETICS_DESIRED_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
    return s;
  } catch {
    return null;
  }
}

/** Записать выбор. Пустой объект и null стирают запись, а не хранят мусор. */
export function saveDesired(storage, s) {
  try {
    if (!s || Object.keys(s).length === 0) {
      storage?.removeItem?.(COSMETICS_DESIRED_KEY);
      return;
    }
    storage?.setItem?.(COSMETICS_DESIRED_KEY, JSON.stringify(s));
  } catch {
    // Приватный режим или переполненное хранилище: выбор не важнее игры.
  }
}

/** Запомнить, что игрок хочет надеть предмет id в категории cat. */
export function setDesired(storage, cat, id) {
  const field = eqField(String(cat || '').trim().toLowerCase());
  if (!field) return false;
  const next = loadDesired(storage) || {};
  next[field] = clampId(id);
  saveDesired(storage, next);
  return true;
}

/**
 * План применения выбора к серверу — чистая функция, ничего не отправляет.
 *
 * @param desired   что сохранено локально
 * @param inventory (cat) => битовая маска купленного
 * @param equipped  (cat) => что надето сейчас
 * @returns { toSend, missing }
 *   toSend  — что нужно отправить: уже надетое сюда не попадает;
 *   missing — чего в инвентаре нет. Это не придирка: кэш пережил смену
 *             личности (сменился PROFILE_SECRET, чужое устройство), обещает
 *             предмет, которого у аккаунта нет, и промолчать здесь значит
 *             оставить игрока с бесконечно «не применяющимся» скином.
 */
export function planDesiredApply({ desired, inventory, equipped }) {
  const toSend = [];
  const missing = [];
  if (!desired) return { toSend, missing };

  for (const cat of COS_STATE_CATS) {
    const field = eqField(cat);
    const raw = desired[field];
    if (raw === undefined || raw === null) continue;

    const want = clampId(raw);
    if (want === clampId(equipped?.(cat))) continue; // уже надето

    if ((Number(inventory?.(cat)) & (1 << want)) === 0) {
      missing.push({ cat, id: want, field });
      continue;
    }
    toSend.push({ cat, id: want, field });
  }
  return { toSend, missing };
}

/**
 * Что оставить в хранилище после попытки применения.
 * Остаётся ТОЛЬКО не отправленное: применённое уже подтвердит сервер, а
 * недоступное не станет доступным от повторов и иначе копилось бы вечно.
 */
export function keepUnsent(sentOk) {
  const kept = {};
  for (const { field, id, ok } of sentOk) {
    if (!ok) kept[field] = id;
  }
  return kept;
}
