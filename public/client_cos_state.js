/* Состояние косметики игрока: что куплено и что надето.

   Было четырнадцать плоских переменных (youCosInvHead, youCosEqSeg, …) на
   149 ссылок по client.js. Из-за них существовали две цепочки if по семь
   ветвей — «дай маску по категории» и «дай надетое по категории», — и обе
   заканчивались `return youCosEqFrame`. То есть на любой НЕизвестной
   категории они молча отдавали данные рамок. Ровно так вкладка титулов
   открывалась с выбором, указывающим на id надетой рамки: 'title' не
   покупается, в цепочке его нет, и она проваливалась в ветку по умолчанию.

   Здесь состояние держится в объектах с ключом-категорией: цепочки не нужны,
   а неизвестная категория честно даёт 0.

   Имена полей на проводе (invHead, eqCaptureFx) выводятся из одного
   соответствия CAT_SUFFIX. Раньше это знание было выписано трижды: разбор
   сообщения сервера, чтение локального кэша и запись «желаемой» экипировки. */

export const CAT_SUFFIX = {
  capturefx: 'CaptureFx',
  head: 'Head',
  seg: 'Seg',
  nameplate: 'Nameplate',
  frame: 'Frame',
  terr: 'Terr',
  death: 'Death'
};

export const COS_STATE_CATS = Object.keys(CAT_SUFFIX);

/** Имя поля «что куплено»: 'head' -> 'invHead'. Неизвестная категория — ''. */
export function invField(cat) {
  const s = CAT_SUFFIX[cat];
  return s ? `inv${s}` : '';
}

/** Имя поля «что надето»: 'head' -> 'eqHead'. */
export function eqField(cat) {
  const s = CAT_SUFFIX[cat];
  return s ? `eq${s}` : '';
}

const MAX_ID = 7;
const clampId = (v) => Math.max(0, Math.min(MAX_ID, Number(v) || 0));
const toMask = (v) => Number(v) || 0;

/** Пустое состояние: ничего не куплено, везде базовый вариант. */
export function createCosState() {
  const inv = {};
  const eq = {};
  for (const cat of COS_STATE_CATS) {
    inv[cat] = 0;
    eq[cat] = 0;
  }
  return { inv, eq };
}

/**
 * Заполнить состояние из сообщения сервера или из локального кэша.
 *
 * @param mode 'replace' — поля, которых в сообщении нет, обнуляются: это
 *             полный снимок (hello, cosmetics);
 *             'patch'   — трогаем только присланное: сообщение cosExtra
 *             частичное, категорий в нём может не быть вовсе.
 */
export function applyCosPayload(state, payload, mode = 'replace') {
  if (!state || !payload) return state;
  for (const cat of COS_STATE_CATS) {
    const iv = payload[invField(cat)];
    const ev = payload[eqField(cat)];
    if (mode === 'patch') {
      if (iv !== undefined) state.inv[cat] = toMask(iv);
      if (ev !== undefined) state.eq[cat] = clampId(ev);
    } else {
      state.inv[cat] = toMask(iv);
      state.eq[cat] = clampId(ev);
    }
  }
  return state;
}

/** Плоский объект для кэша — те же имена полей, что и на проводе. */
export function cosPayloadOf(state) {
  const out = {};
  if (!state) return out;
  for (const cat of COS_STATE_CATS) {
    out[invField(cat)] = toMask(state.inv[cat]);
    out[eqField(cat)] = clampId(state.eq[cat]);
  }
  return out;
}

/* Маска купленного. Неизвестная категория (например 'title', который не
   покупается) даёт 0, а НЕ инвентарь рамок, как раньше. */
export function invOf(state, cat) {
  return toMask(state?.inv?.[cat]);
}

/** Надетый предмет. Неизвестная категория — базовый вариант. */
export function eqOf(state, cat) {
  return clampId(state?.eq?.[cat]);
}

/** Отметить предмет купленным. Возвращает false, если категория неизвестна. */
export function markOwned(state, cat, id) {
  if (!state || !CAT_SUFFIX[cat]) return false;
  const n = clampId(id);
  state.inv[cat] = toMask(state.inv[cat]) | (1 << n);
  return true;
}

/** Надеть предмет. Не даёт надеть некупленное — как и сервер. */
export function equip(state, cat, id) {
  if (!state || !CAT_SUFFIX[cat]) return false;
  const n = clampId(id);
  if ((toMask(state.inv[cat]) & (1 << n)) === 0) return false;
  state.eq[cat] = n;
  return true;
}
