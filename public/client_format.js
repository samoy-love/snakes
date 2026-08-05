/* Форматирование чисел, долей, времени и обратного отсчёта.
   Всё чистое: язык и «текущий тик» приходят аргументами, а не читаются из
   состояния client.js. Так каждую формулу видно тестом, а не только глазами
   на живой странице.

   Отдельно про обратный отсчёт. Раньше формула «сколько осталось» была
   размазана по трём функциям, каждая из которых сама лезла в tickMs,
   lastEventsTick и lastEventsAt. Здесь оставлена только арифметика:
   сколько миллисекунд между «сейчас» и целевым тиком и как это показать.
   Чтение состояния осталось в client.js одной строкой. */

/** Локаль форматирования чисел. Русский — основной язык продукта. */
export function numberLocale(lang) {
  return String(lang) === 'en' ? 'en-US' : 'ru-RU';
}

/** Целое с разделителями разрядов. Нечисло — «0», а не «NaN» на экране. */
export function formatInt(n, lang) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  try {
    return Math.round(v).toLocaleString(numberLocale(lang));
  } catch {
    return String(Math.round(v));
  }
}

/** Доля карты с одним знаком: «12,4%». Нечисло — нулевая доля, не «NaN%». */
export function formatPct1(n, lang) {
  const v = Number(n);
  const zero = String(lang) === 'en' ? '0.0%' : '0,0%';
  if (!Number.isFinite(v)) return zero;
  try {
    return (
      v.toLocaleString(numberLocale(lang), {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
      }) + '%'
    );
  } catch {
    return v.toFixed(1) + '%';
  }
}

/** Произвольное форматирование через Intl. Нечисло возвращается как есть. */
export function formatNumber(value, lang, options) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  try {
    return new Intl.NumberFormat(numberLocale(lang), options || {}).format(n);
  } catch {
    return String(n);
  }
}

/* Группировка разрядов без Intl: счётчики валюты обновляются часто, и
   Intl.NumberFormat на каждый кадр заметно дороже одной регулярки.

   Разделитель — УЗКИЙ НЕРАЗРЫВНЫЙ пробел U+202F. Глазами он неотличим от
   обычного пробела, поэтому вынесен в именованную константу: при переносе
   этого кода в модуль его уже однажды подменили обычным, а с обычным
   «100 000» рвётся переносом строки посреди числа. Тест сверяет код точки,
   а не вид символа — иначе подмену снова никто не заметит. */
export const GROUP_SEPARATOR = ' ';

export function formatGroupedCount(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR);
}

/** Часы:минуты по локальному времени — метка строки чата. */
export function formatClock(t) {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return '--:--';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Скорость канала в перф-панели. Отрицательное и нечисло — многоточие. */
export function formatRate(bps) {
  const v = Number(bps);
  if (!Number.isFinite(v) || v < 0) return '…';
  const kb = v / 1024;
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)}MB/s`;
  return `${kb.toFixed(1)}KB/s`;
}

/* --- Обратный отсчёт -------------------------------------------------------
   nowTick — дробный «текущий тик», посчитанный из последнего события и
   времени, прошедшего с него. Отрицательный остаток срезается в ноль: матч,
   который уже кончился, показывает 0:00, а не «-0:03». */

/** Миллисекунды до целевого тика. null, если считать не из чего. */
export function remainMsToTick(untilTick, nowTick, tickMs) {
  const ut = Number(untilTick) || 0;
  const ms = Number(tickMs) || 0;
  if (!ut || !ms) return null;
  if (nowTick == null || !Number.isFinite(Number(nowTick))) return null;
  return Math.max(0, (ut - Number(nowTick)) * ms);
}

/** Остаток как «м:сс». Пустая строка, если считать не из чего. */
export function formatRemainMs(remainMs) {
  if (remainMs == null || !Number.isFinite(Number(remainMs))) return '';
  const sec = Math.ceil(Math.max(0, Number(remainMs)) / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Дробный «текущий тик» из последнего события. null, если событий не было. */
export function approxTickNow({ tickMs, lastEventsTick, lastEventsAt, nowMs }) {
  const ms = Number(tickMs) || 0;
  if (!ms) return null;
  if (!lastEventsTick || !lastEventsAt) return null;
  const dtMs = Number(nowMs) - Number(lastEventsAt);
  if (!Number.isFinite(dtMs)) return null;
  return Number(lastEventsTick) + Math.max(0, dtMs / ms);
}
