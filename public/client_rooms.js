/* Отбор и порядок комнат в списке меню.
   Логика чистая: на вход — массив комнат с сервера, режим сортировки и строка
   поиска, на выход — новый массив. DOM здесь не читается намеренно: раньше
   sortRooms сама лезла в roomsSortSelect.value, а applyRoomsFilterSort — в
   lastRooms и roomsSearchInput.value, и проверить порядок можно было только
   через живую страницу. Теперь режим и запрос приходят аргументами, а связь с
   DOM осталась одной строкой на стороне client.js.

   Порядок сортировки — часть продукта, а не деталь реализации: «Свободные
   сверху» решает, куда попадёт новичок, нажавший «Играть». Поэтому у каждого
   режима зафиксирован полный компаратор, включая тай-брейк по id: без него
   порядок комнат с равной заполненностью скакал между обновлениями списка
   (сервер шлёт их в произвольном порядке), и строка «прыгала» под курсором. */

export const ROOMS_SORT_MODES = ['free', 'fill', 'humans', 'id'];

/** Режим сортировки, приводимый к известному; всё неизвестное — 'free'. */
export function normalizeRoomsSort(mode) {
  const v = String(mode || '').trim();
  return ROOMS_SORT_MODES.includes(v) ? v : 'free';
}

/** Строка, по которой ищет поле поиска: номер, название, заполненность, ники.
    id подставляется через ?? '': у записи без него шаблонная строка давала
    литерал «undefined», и запрос «undef» находил битые комнаты. */
export function roomsQueryText(r) {
  const rid = r?.id ?? '';
  const title = String(r?.title || '').trim();
  const humans = Number(r?.humans) || 0;
  const limit = Number(r?.limit) || 0;
  const names = Array.isArray(r?.names) ? r.names : [];
  const nameCount = Number(r?.nameCount) || names.length;
  return `${rid} ${title} ${humans}/${limit} ${nameCount} ${names.join(' ')}`.toLowerCase();
}

const num = (v) => Number(v) || 0;
// Лимит 0 у битой записи превратил бы долю в Infinity и утащил бы комнату
// в начало списка «по заполненности».
const lim = (v) => Math.max(1, Number(v) || 1);
const byId = (a, b) => num(a?.id) - num(b?.id);

const COMPARATORS = {
  id: byId,

  // Свободные сверху: сначала не-полные, внутри — где больше живых игроков
  // (пустая комната скучнее полупустой), затем по номеру.
  free: (a, b) => {
    const aFull = num(a?.humans) >= lim(a?.limit);
    const bFull = num(b?.humans) >= lim(b?.limit);
    if (aFull !== bFull) return aFull ? 1 : -1;
    const d = num(b?.humans) - num(a?.humans);
    return d !== 0 ? d : byId(a, b);
  },

  humans: (a, b) => {
    const d = num(b?.humans) - num(a?.humans);
    return d !== 0 ? d : byId(a, b);
  },

  // По заполненности: доля, затем абсолютное число, затем номер.
  fill: (a, b) => {
    const d = num(b?.humans) / lim(b?.limit) - num(a?.humans) / lim(a?.limit);
    if (d !== 0) return d;
    const dh = num(b?.humans) - num(a?.humans);
    return dh !== 0 ? dh : byId(a, b);
  }
};

/** Копия списка в выбранном порядке. Исходный массив не трогаем. */
export function sortRooms(rooms, mode) {
  const out = Array.isArray(rooms) ? [...rooms] : [];
  out.sort(COMPARATORS[normalizeRoomsSort(mode)]);
  return out;
}

/** Отбор по строке поиска и сортировка — то, что видит игрок в списке. */
export function filterAndSortRooms(rooms, { query = '', sort = 'free' } = {}) {
  const raw = Array.isArray(rooms) ? rooms : [];
  const q = String(query || '').trim().toLowerCase();
  const filtered = q ? raw.filter((r) => roomsQueryText(r).includes(q)) : raw;
  return sortRooms(filtered, sort);
}
