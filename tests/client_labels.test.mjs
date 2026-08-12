/*
 * Подписи и форматирование поверх стора: client_labels.js.
 *
 * Почему это стоит тестов. Арифметика форматирования уже проверена в
 * client_format.test.mjs, но здесь к ней подмешано состояние — язык, длина
 * тика, последнее событие, номер своего игрока. Ошибка в подстановке не
 * падает, а показывает игроку пустую подсказку смерти, «0:00» на живом
 * контракте или чужое имя в строке «убит».
 *
 * Отдельно про тексты смерти: у deathReasonText три ветки (сам себя, убийца
 * известен, причина без убийцы), и раньше их можно было проверить только
 * глазами на живой странице, умерев нужным способом.
 *
 * Модуль тянет client_i18n_rt.js, а тот на импорте читает localStorage —
 * поэтому заглушки ставятся до динамического импорта, а не после. Ещё setLang()
 * перерисовывает статическую разметку, отсюда пустой document: нам нужен только
 * переключатель языка, а не браузер.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
};

globalThis.document = {
  documentElement: { setAttribute: () => {} },
  querySelectorAll: () => []
};

const {
  RECLAIM_WINDOW_MS,
  approxNowTick,
  contractLabel,
  deathReasonHint,
  deathReasonLabel,
  deathReasonText,
  fmtInt,
  fmtPct1,
  formatTickRemain,
  formatTime,
  infoDesc,
  infoName,
  powerupLabel,
  reclaimWindowSec,
  tickRemainSeconds
} = await import('../public/client_labels.js');

const { setLang, t } = await import('../public/client_i18n_rt.js');
const { match, session } = await import('../public/client_store.js');
const { DEATH_REASON } = await import('../public/client_death.js');

/** Стор общий для всех тестов файла — каждый тест ставит своё состояние. */
function setSession({ tickMs = 100, you = 0, reclaimTicksFromServer = 0 } = {}) {
  session.tickMs = tickMs;
  session.you = you;
  session.reclaimTicksFromServer = reclaimTicksFromServer;
}

function setEvents({ tick, at }) {
  match.lastEventsTick = tick;
  match.lastEventsAt = at;
}

// --- Числа с текущим языком --------------------------------------------------

test('fmtInt/fmtPct1 берут язык из рантайма, а не из аргумента', () => {
  setLang('en');
  assert.equal(fmtInt(1234), '1,234');
  assert.equal(fmtPct1(12.35), '12.4%');

  setLang('ru');
  assert.equal(fmtPct1(12.4), '12,4%');
  assert.match(fmtInt(1234).replace(/\s/g, ''), /^1234$/);
});

test('fmtInt: мусор на входе даёт «0», а не «NaN» в HUD', () => {
  setLang('ru');
  assert.equal(fmtInt(undefined), '0');
  assert.equal(fmtInt('абв'), '0');
});

test('formatTime: метка чата и битая дата', () => {
  assert.equal(formatTime(new Date(2026, 0, 2, 7, 5).getTime()), '07:05');
  assert.equal(formatTime(NaN), '--:--');
});

// --- Словарные подписи -------------------------------------------------------

test('infoName/infoDesc: пустая карта и неизвестный тип падают на запасной текст', () => {
  assert.equal(infoName({ 3: { name: 'Ускорение' } }, 3, 'запас'), 'Ускорение');
  assert.equal(infoName({ 3: { name: 'Ускорение' } }, 9, 'запас'), 'запас');
  assert.equal(infoName(null, 3, 'запас'), 'запас');
  assert.equal(infoName(null, 3), '', 'без запаса — пустая строка, а не undefined на экране');

  assert.equal(infoDesc({ 3: { desc: 'что делает' } }, 3, 'запас'), 'что делает');
  assert.equal(infoDesc({ 3: { name: 'Ускорение' } }, 3, 'запас'), 'запас', 'name — не desc');
});

test('powerupLabel: неизвестный предмет подписан словарём, а не пустотой', () => {
  setLang('ru');
  assert.equal(powerupLabel(9999), t('name.item_fallback'));
});

test('contractLabel: неизвестный контракт даёт пустую строку', () => {
  setLang('ru');
  assert.equal(contractLabel(9999), '');
});

// --- Обратный отсчёт ---------------------------------------------------------

test('approxNowTick: экстраполяция от последнего события через стор', () => {
  setSession({ tickMs: 100 });
  setEvents({ tick: 50, at: Date.now() - 500 });
  const now = approxNowTick();
  assert.ok(now >= 55 && now < 56, `ожидали ~55, получили ${now}`);
});

test('approxNowTick: событий не было — считать не из чего', () => {
  setSession({ tickMs: 100 });
  setEvents({ tick: 0, at: 0 });
  assert.equal(approxNowTick(), null);
});

test('formatTickRemain: живой срок показывается как м:сс', () => {
  setSession({ tickMs: 100 });
  setEvents({ tick: 100, at: Date.now() });
  // до тика 700 при текущем 100 и тике 100 мс — 60 секунд
  assert.equal(formatTickRemain(700), '1:00');
});

test('formatTickRemain: истёкший срок — 0:00, а не отрицательное время', () => {
  setSession({ tickMs: 100 });
  setEvents({ tick: 1000, at: Date.now() });
  assert.equal(formatTickRemain(10), '0:00');
});

test('formatTickRemain: без события отсчёт молчит пустой строкой', () => {
  setSession({ tickMs: 100 });
  setEvents({ tick: 0, at: 0 });
  assert.equal(formatTickRemain(700), '');
});

test('tickRemainSeconds: секунды числом, null — если считать не из чего', () => {
  setSession({ tickMs: 100 });
  setEvents({ tick: 100, at: Date.now() });
  assert.equal(tickRemainSeconds(700), 60);
  assert.equal(tickRemainSeconds(0), null, 'цели нет');

  setEvents({ tick: 0, at: 0 });
  assert.equal(tickRemainSeconds(700), null, '«сейчас» неизвестно');
});

// --- Окно реклейма -----------------------------------------------------------

test('reclaimWindowSec: без сервера работает встроенное значение', () => {
  setSession({ tickMs: 100, reclaimTicksFromServer: 0 });
  assert.equal(reclaimWindowSec(), RECLAIM_WINDOW_MS / 1000);
});

test('reclaimWindowSec: слово сервера важнее константы', () => {
  setSession({ tickMs: 100, reclaimTicksFromServer: 300 });
  assert.equal(reclaimWindowSec(), 30);
});

test('reclaimWindowSec: нулевой tickMs не даёт нулевого окна', () => {
  setSession({ tickMs: 0, reclaimTicksFromServer: 150 });
  assert.equal(reclaimWindowSec(), 15, 'при неизвестной длине тика берётся 100 мс');
});

// --- Причина смерти ----------------------------------------------------------

test('deathReasonLabel: известная причина переводится, неизвестная молчит', () => {
  setLang('ru');
  assert.equal(deathReasonLabel(DEATH_REASON.CUT), t('death.reason.cut'));
  assert.equal(deathReasonLabel(0), '');
  assert.equal(deathReasonLabel(99), '');
});

test('deathReasonText: убийца — ты сам, имени в строке нет', () => {
  setLang('ru');
  setSession({ you: 7 });
  const s = deathReasonText({ killer: 7, killerName: 'Я', reason: DEATH_REASON.SELFTRAIL });
  assert.equal(s, `${t('death.reason_prefix')}: ${t('death.reason.selftrail')}`);
  assert.ok(!s.includes(t('death.killed_by')), 'себя не «убил» кто-то другой');
});

test('deathReasonText: убийца известен — имя и причина в скобках', () => {
  setLang('ru');
  setSession({ you: 7 });
  assert.equal(
    deathReasonText({ killer: 3, killerName: 'Змей', reason: DEATH_REASON.CUT }),
    `${t('death.killed_by')}: Змей (${t('death.reason.cut')})`
  );
});

test('deathReasonText: убийца без причины — одно имя, без пустых скобок', () => {
  setLang('ru');
  setSession({ you: 7 });
  assert.equal(deathReasonText({ killer: 3, killerName: 'Змей', reason: 0 }), `${t('death.killed_by')}: Змей`);
});

test('deathReasonText: стена — причина без убийцы', () => {
  setLang('ru');
  setSession({ you: 7 });
  assert.equal(
    deathReasonText({ killer: 0, killerName: '', reason: DEATH_REASON.WALL }),
    `${t('death.reason_prefix')}: ${t('death.reason.wall')}`
  );
});

test('deathReasonText: ничего не известно — пустая строка, а не «: undefined»', () => {
  setLang('ru');
  setSession({ you: 7 });
  assert.equal(deathReasonText(undefined), '');
  assert.equal(deathReasonText({}), '');
});

test('deathReasonHint: разрез с известным убийцей объясняет правило игры', () => {
  setSession({ you: 7 });
  setLang('ru');
  const ru = deathReasonHint({ reason: DEATH_REASON.CUT, killerName: 'Змей' });
  assert.match(ru, /^Змей пересёк твой след/);

  setLang('en');
  assert.match(deathReasonHint({ reason: DEATH_REASON.CUT, killerName: 'Snake' }), /^Snake crossed your trail/);
});

test('deathReasonHint: разрез без имени убийцы падает на словарную подсказку', () => {
  setLang('ru');
  assert.equal(deathReasonHint({ reason: DEATH_REASON.CUT, killerName: '   ' }), t('death.hint.cut'));
});

test('deathReasonHint: неизвестная причина всё равно даёт текст', () => {
  setLang('ru');
  const generic = t('death.hint.generic');
  assert.equal(deathReasonHint({ reason: 0 }), generic);
  assert.equal(deathReasonHint(undefined), generic);
  assert.notEqual(generic, 'death.hint.generic', 'ключ обязан быть в словаре');
});
