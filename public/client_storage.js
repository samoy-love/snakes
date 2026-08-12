/* localStorage: ключи в одном месте и безопасный доступ к ним.

   Ключей набралось два десятка, и до этого модуля они жили россыпью: часть
   константами в своих файлах (`const LB_PIN_KEY = 'lbPinned'`), часть голыми
   литералами прямо в вызове. Разъехаться такое может молча — записали по
   одной строке, прочитали по другой, и настройка просто не сохраняется.
   Один такой случай уже стоил бага: имя игрока писал client_menu.js по
   литералу 'name', а читал client_net_bind.js по такому же литералу, и связь
   двух модулей держалась на том, что обе строки совпадают.

   Именование ключей историческое и НЕСОГЛАСОВАННОЕ: часть с префиксом
   `snakes_` и версией, часть — голые слова. Так и оставлено намеренно: это
   реальные ключи в браузерах живых игроков, и переименование потеряло бы их
   настройки, купленную косметику и прогресс онбординга. Здесь они хотя бы
   собраны вместе, и видно, какой из них какой.

   Доступ идёт через get/set/remove, а не напрямую: обращение к localStorage
   бросает в приватном режиме Safari и при переполненном хранилище, поэтому
   каждый вызов и раньше был обёрнут в try/catch — вручную, все тридцать
   девять раз. Теперь try/catch ровно один. */

export const KEYS = {
  // Профиль и личность игрока.
  profileToken: 'snakes_profile_token_v1',
  name: 'name',

  // Настройки.
  settings: 'snakes_settings_v1',
  lang: 'lang',
  hudDensity: 'hudDensity',

  // Состояние интерфейса, которое игрок выставил сам.
  leaderboardPinned: 'lbPinned',
  rightTab: 'rightTab',
  rightMatchOpen: 'rightMatchOpen',
  rightTeamOpen: 'rightTeamOpen',
  chatCollapsed: 'chatCollapsed',
  chatEnterHint: 'chatEnterHintDismissed',
  matchAutoJoin: 'matchAutoJoin',

  // Прогресс и косметика.
  cosmeticsCache: 'snakes_cosmetics_cache_v1',
  cosmeticsDesired: 'snakes_cosmetics_desired_v1',
  matchesPlayed: 'snakes_matches_played_v1',
  firstCapture: 'snakes_first_capture_v1',
  bestPct: 'snakes_best_pct_v1',
  menuControlsSeen: 'menuControlsSeen',
  recentEmojis: 'recentEmojis',

  /* Онбординг. Имена ключей не совпадают с именами полей — так исторически
     сложилось (stages/deaths_seen/ob_matches), и переименовать их нельзя по
     той же причине, что и остальные: у живых игроков они уже записаны. */
  obStage: 'snakes_onboarding_stages_v1',
  obDeaths: 'snakes_deaths_seen_v1',
  obEntered: 'snakes_ob_matches_v1'
};

/* Счётчики пользовательских событий лежат под составным ключом `an_<событие>`
   и потому в таблице выше не перечислены — их множество задаётся вызывающим.
   Читаются только руками из консоли при разборе жалоб. */
export const ANALYTICS_PREFIX = 'an_';

/* Чтение.

   Различает два случая, и это различие существенно: «ключа нет» (вернётся
   null) и «хранилище недоступно» — приватный режим Safari, переполнение, —
   когда вернётся onFail. Половина вызывающих на этих случаях ведёт себя
   по-разному: первый захват у нового игрока праздновать надо, а у игрока с
   выключенным хранилищем — нет, иначе он увидит «первый захват» в каждом
   матче. Раньше это различие держалось на том, что try/catch стоял у самого
   вызывающего; когда try/catch переехал сюда, его пришлось выразить явно. */
export function storageGet(key, onFail = null) {
  try {
    return localStorage.getItem(key);
  } catch {
    return onFail;
  }
}

/* Запись. Возвращает false, если не удалось: у вызывающего почти всегда есть
   разумное поведение по умолчанию, и падать из-за несохранённой настройки
   игра не должна. */
export function storageSet(key, value) {
  try {
    localStorage.setItem(key, String(value));
    return true;
  } catch {
    return false;
  }
}

function storageRemove(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/* Числовой счётчик: прочитать, увеличить, записать. Отдельная функция, потому
   что этот приём повторялся в трёх местах (счётчики событий, сыгранные матчи,
   смерти в онбординге) и каждый раз писался заново. */
export function storageBump(key, by = 1) {
  const cur = Number(storageGet(key)) || 0;
  const next = cur + by;
  storageSet(key, String(next));
  return next;
}

/* Флаг «да/нет». В хранилище он лежит как '1'/'0' — это формат, который уже
   записан у живых игроков, менять его нельзя. def возвращается, когда ключа
   нет вовсе или в нём мусор. */
export function storageFlag(key, def = false) {
  const raw = storageGet(key, def ? '1' : '0');
  if (raw === '1') return true;
  if (raw === '0') return false;
  return def;
}

export function storageSetFlag(key, on) {
  return storageSet(key, on ? '1' : '0');
}

/* JSON-значение. Возвращает null и на отсутствие ключа, и на битое
   содержимое: разбирать полусохранённый объект хуже, чем начать с чистого. */
export function storageGetJson(key) {
  const raw = storageGet(key);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

export function storageSetJson(key, value) {
  try {
    return storageSet(key, JSON.stringify(value));
  } catch {
    return false;
  }
}
