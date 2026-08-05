/* Модель магазина косметики: категории, цены, тиры редкости и владение.
   Чистая арифметика без DOM и без состояния — прайс и маски владения приходят
   аргументами. Именно здесь живут правила, по которым игрок видит «сколько
   стоит», «какая редкость» и «сколько у меня уже есть», поэтому цена ошибки
   тут — не упавшая страница, а неверное число рядом с кнопкой «Купить».

   Владение хранится битовой маской: бит id — предмет куплен. id 0 — базовый
   вариант, он есть у всех и стоит 0. */

export const COSMETICS_MAX_ID = 7;

export const COSMETICS_CATS = ['terr', 'seg', 'head', 'death', 'capturefx', 'nameplate', 'frame'];

/* Запасной прайс на случай, если сервер не прислал свой. Значения намеренно
   не круглые и разные по категориям: это лестница редкости, а не линейка. */
export const COSMETICS_FALLBACK_PRICES = {
  frame: [0, 30, 45, 85, 115, 200, 330, 550],
  nameplate: [0, 40, 60, 105, 140, 240, 390, 640],
  seg: [0, 160, 55, 210, 360, 90, 580, 950],
  head: [0, 50, 75, 135, 175, 300, 500, 800],
  capturefx: [0, 65, 100, 180, 240, 410, 660, 1050],
  terr: [0, 60, 90, 150, 220, 360, 600, 980],
  death: [0, 55, 85, 140, 210, 340, 560, 900]
};

/** Куплен ли предмет id: проверка бита в маске владения. */
export function bitHas(mask, id) {
  const n = Number(id) || 0;
  // Сдвиг больше 31 в JS заворачивается по модулю 32 (1<<32 === 1), поэтому
  // без явной границы id=32 читался бы как id=0 и «базовый» вариант выглядел
  // бы купленным у всех. Категорий с таким числом предметов нет, но проверка
  // стоит одно сравнение.
  if (n < 0 || n > 30) return false;
  return (Number(mask) & (1 << n)) !== 0;
}

/** Сколько предметов категории куплено, включая базовый (id 0). */
export function ownedCountFromMask(mask) {
  let n = 0;
  for (let id = 0; id <= COSMETICS_MAX_ID; id++) {
    if (bitHas(mask, id)) n++;
  }
  return n;
}

/** Цена предмета. prices — то, что прислал сервер; при пропуске берётся запасной. */
export function priceOf(cat, id, prices) {
  const c = String(cat || '');
  const i = Math.max(0, Math.min(COSMETICS_MAX_ID, Number(id) || 0));

  if (prices && typeof prices === 'object') {
    const row = prices[c];
    if (Array.isArray(row)) {
      const v = Number(row[i]);
      if (Number.isFinite(v) && v >= 0) return v;
    } else {
      // Сервер вправе прислать одну цену на всю категорию. Базовый вариант
      // остаётся бесплатным: иначе игрок «покупал» бы то, что у него есть.
      const v = Number(row);
      if (Number.isFinite(v) && v >= 0) return i === 0 ? 0 : v;
    }
  }

  const fb = COSMETICS_FALLBACK_PRICES[c] || COSMETICS_FALLBACK_PRICES.frame;
  const v = Number(fb[i]);
  return Number.isFinite(v) ? v : 0;
}

/* Лестница редкости. Границы — это продукт: по ним красится карточка, бейдж и
   цвет цены, и сдвиг любой границы меняет то, что игрок считает «дорогим». */
export const TIER_BOUNDS = [
  { tier: 'base', maxPrice: 0 },
  { tier: 'common', maxPrice: 100 },
  { tier: 'rare', maxPrice: 250 },
  { tier: 'epic', maxPrice: 450 },
  { tier: 'legendary', maxPrice: 700 }
];

export const TIER_TOP = 'mythic';

/** Тир по цене. Ноль и отрицательное — базовый, дороже 700 — мифический. */
export function tierOf(price) {
  const p = Math.max(0, Number(price) || 0);
  for (const b of TIER_BOUNDS) {
    if (p <= b.maxPrice) return b.tier;
  }
  return TIER_TOP;
}

/** Самый дешёвый ПЛАТНЫЙ предмет во всём магазине — цель «до первого скина». */
export function cheapestPrice(prices) {
  let best = Infinity;
  for (const cat of COSMETICS_CATS) {
    for (let id = 1; id <= COSMETICS_MAX_ID; id++) {
      const p = priceOf(cat, id, prices);
      if (p > 0 && p < best) best = p;
    }
  }
  return Number.isFinite(best) ? best : 0;
}

/* Имя CSS-класса тира: 'rare' -> 'tierRare'. Раньше эта склейка была написана
   инлайном в одном месте (разделитель групп) и забыта в другом (сама
   карточка), из-за чего лестница редкости не рисовалась вовсе. */
export function tierClass(tier) {
  const s = String(tier || 'base');
  return `tier${s.charAt(0).toUpperCase()}${s.slice(1)}`;
}

/** Сколько ещё нужно накопить. Никогда не отрицательное: «-40 ✨» бессмысленно. */
export function missingFor(price, balance) {
  return Math.max(0, Math.ceil((Number(price) || 0) - (Number(balance) || 0)));
}
