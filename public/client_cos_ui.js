/* Сборка данных для витрины магазина косметики: список предметов вкладки и
   состояния кнопок «Купить»/«Экипировать». Чистая арифметика без DOM и без
   i18n — тексты и вёрстку строит syncCosmeticsUi() в client.js, а здесь
   только то, что можно свести к таблице значений и сверить формулой.

   Первый вынесенный кусок syncCosmeticsUi() (client.js, ~420 строк): дальше
   функция всё ещё собирает DOM сама, но список предметов и состояния кнопок
   больше не пересчитываются инлайном внутри цикла отрисовки. */

import { bitHas, missingFor, priceOf, tierOf } from './client_cos_model.js';

/** Предметы вкладки cat, отсортированные по цене и отфильтрованные текущим
    фильтром ('all' | 'owned' | 'available'). Порядок и состав — то, что раньше
    вычислялось инлайн в цикле построения карточек. */
export function visibleItems(cat, filter, balance, mask, eq, prices, maxId) {
  const order = [];
  for (let id = 0; id <= maxId; id++) {
    order.push({ id, price: priceOf(cat, id, prices) });
  }
  order.sort((a, b) => a.price - b.price || a.id - b.id);

  const bal = Math.max(0, Math.floor(Number(balance) || 0));
  const items = [];
  for (const { id, price } of order) {
    const owned = bitHas(mask, id);
    if (filter === 'owned' && !owned) continue;
    if (filter === 'available' && (owned || bal < price)) continue;

    items.push({
      id,
      price,
      owned,
      equipped: Number(eq) === id,
      tier: tierOf(price),
      missing: missingFor(price, bal)
    });
  }
  return items;
}

/** Состояние кнопки «Купить»: активна ли, каким классом красится, какую
    подсказку показывать. Текст и перевод подсказки — дело вызывающего кода. */
export function buyButtonState({ pending, online, confirmed, pendingOtherOp, poor }) {
  const disabled = !!pending || !online || !confirmed || !!pendingOtherOp;
  const className = disabled || poor ? 'btnSecondary' : 'btnPrimary';
  let titleKind = null;
  if (!online) titleKind = 'no_connection';
  else if (!confirmed) titleKind = 'unconfirmed_hint';
  else if (poor) titleKind = 'need_more';
  return { disabled, className, poor: !!poor, pending: !!pending, titleKind };
}

/** Состояние кнопки экипировки: «Снять» для надетого небазового предмета,
    иначе «Надеть»/«Экипировано». id=0 (базовый вариант) снять нельзя. */
export function equipButtonState({ equipped, id }) {
  if (equipped && id !== 0) {
    return { kind: 'remove', className: 'btnSecondary', disabled: false };
  }
  return {
    kind: equipped ? 'equipped' : 'wear',
    className: equipped ? 'btnGhost' : 'btnPrimary',
    disabled: !!equipped
  };
}
