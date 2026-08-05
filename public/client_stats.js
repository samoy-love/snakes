/* Итоговые цифры игрока: порядок в таблице и личный рекорд.
   Чистые функции — хранилище приходит аргументом, поэтому рекорд можно
   проверить тестом, а не «сыграй и посмотри».

   Рекорд намеренно живёт в localStorage, а не в профиле на сервере: это
   мотиватор «побей себя», он нужен сразу после смерти и не должен зависеть
   ни от сети, ни от того, успел ли профиль синхронизироваться. */

export const BEST_PCT_KEY = 'snakes_best_pct_v1';

/* Порог, ниже которого прирост не считается новым рекордом.
   Стартовая территория — 3x3 клетки, и на большой карте это сотые доли
   процента. Без порога КАЖДАЯ смерть на спавне объявлялась бы рекордом, и
   плашка «Новый рекорд!» обесценилась бы за один вечер. */
export const BEST_PCT_EPSILON = 0.05;

/** Порядок таблицы: очки, при равенстве — захваченные клетки. */
export function sortPlayersByScore(players) {
  const list = Array.isArray(players) ? [...players] : [];
  list.sort((a, b) => (Number(b?.p) || 0) - (Number(a?.p) || 0) || (Number(b?.s) || 0) - (Number(a?.s) || 0));
  return list;
}

/** Место игрока в виде «3/14». Прочерк, если игрока в таблице нет. */
export function placeLabel(players, playerNum) {
  const ordered = sortPlayersByScore(players);
  const i = ordered.findIndex((p) => p?.n === playerNum);
  return i >= 0 ? `${i + 1}/${ordered.length}` : '—';
}

/** Доля карты в процентах. 0, если размер карты неизвестен. */
export function zonePct(cells, mapCells) {
  const c = Number(cells) || 0;
  const m = Number(mapCells) || 0;
  if (m <= 0) return 0;
  return (c / m) * 100;
}

/** Прочитать рекорд. Любая порча хранилища читается как «рекорда нет». */
export function readBestPct(storage) {
  try {
    const v = Number(storage?.getItem?.(BEST_PCT_KEY));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

/**
 * Учесть забег и вернуть { best, isRecord }.
 *
 * isRecord === true только если рекорд УЖЕ был и его побили: первый в жизни
 * результат — это ещё не «новый рекорд», сравнивать не с чем, и плашка на
 * первой же смерти читалась бы как издёвка.
 */
export function commitBestPct(pct, storage) {
  const cur = Number(pct) || 0;
  const prev = readBestPct(storage);
  if (cur > prev + BEST_PCT_EPSILON) {
    try {
      storage?.setItem?.(BEST_PCT_KEY, String(cur));
    } catch {
      // Приватный режим или переполненное хранилище: рекорд не важнее игры.
    }
    return { best: cur, isRecord: prev > 0 };
  }
  return { best: prev, isRecord: false };
}
