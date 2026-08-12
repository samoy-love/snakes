/*
 * Арка матча: смена фаз и баннер финала.
 *
 * Эта часть игры дважды оказывалась сломанной молча, и оба раза — потому что
 * её никто не проверял:
 *   - сообщение matchPhase проваливалось в конец цепочки else if диспетчера и
 *     не разбиралось вовсе (C2 в истории клиента);
 *   - позже переименование переменной matchPhase -> match.phase зацепило
 *     строковый литерал в той же цепочке, и ветка снова перестала совпадать.
 * Первый случай ловит теперь client_json_msg_contract.test.mjs (сверка типов
 * сообщений с сервером), но сама логика фаз оставалась непокрытой: визуальные
 * тесты снимают экраны раньше, чем матч доходит до финальной фазы.
 *
 * Здесь проверяется поведение, которое видит игрок: множитель очков в финале
 * объявляется ровно один раз за матч, повторная доставка того же события
 * ничего не показывает второй раз, а вход в комнату посреди финала не
 * показывает баннер вовсе.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { applyMatchPhaseImpl } from '../public/client_match.js';
import { PHASE_CONFLICT, PHASE_EXPANSION, PHASE_FINAL, match, session } from '../public/client_store.js';

/* Заглушки вместо интерфейса: сама функция ничего не рисует, она решает —
   объявлять ли фазу и чем именно. Записываем эти решения. */
function makeDeps({ bannerShown = true } = {}) {
  const calls = { banners: [], toasts: [], jackpots: 0, hudRedraws: 0 };
  return {
    calls,
    deps: {
      t: (key) => (key === 'phase.final_banner' ? 'ФИНАЛ ×2' : key),
      phaseDesc: (ph) => `desc${ph}`,
      phaseLabel: (ph) => `label${ph}`,
      phaseIcon: () => '🔥',
      showBigBanner: (icon, title, sub) => {
        calls.banners.push({ icon, title, sub });
        return bannerShown;
      },
      addToast: (icon, text, variant, sub, opts) => calls.toasts.push({ icon, text, variant, sub, opts }),
      sfx: { jackpot: () => calls.jackpots++ },
      renderTopHud: () => calls.hudRedraws++
    }
  };
}

function resetMatch() {
  match.phase = PHASE_EXPANSION;
  match.phaseUntil = 0;
  match.phaseBannerSeq = -1;
  match.seq = 7;
  match.finalMult = 3;
  session.started = true;
}

test('фаза и её дедлайн переезжают в состояние', () => {
  resetMatch();
  const { deps } = makeDeps();
  applyMatchPhaseImpl(PHASE_CONFLICT, 12345, false, 7, deps);
  assert.equal(match.phase, PHASE_CONFLICT);
  assert.equal(match.phaseUntil, 12345);
});

test('мусор вместо фазы зажимается в допустимый диапазон', () => {
  resetMatch();
  const { deps } = makeDeps();
  applyMatchPhaseImpl(99, -5, false, 7, deps);
  assert.equal(match.phase, PHASE_FINAL, 'больше максимума — это финал');
  assert.equal(match.phaseUntil, 0, 'отрицательный дедлайн — это ноль');

  applyMatchPhaseImpl('ерунда', 0, false, 7, deps);
  assert.equal(match.phase, PHASE_EXPANSION, 'нечисло — это нулевая фаза');
});

test('баннер финала показывает множитель, который прислал сервер', () => {
  resetMatch();
  const { calls, deps } = makeDeps();
  applyMatchPhaseImpl(PHASE_FINAL, 0, true, 7, deps);

  assert.equal(calls.banners.length, 1);
  assert.equal(calls.banners[0].title, 'ФИНАЛ ×3', 'в словаре ×2, у сервера finalMult=3');
  assert.equal(calls.jackpots, 1, 'момент отмечается звуком');
});

test('повторная доставка того же события не объявляет финал дважды', () => {
  resetMatch();
  const { calls, deps } = makeDeps();
  applyMatchPhaseImpl(PHASE_FINAL, 0, true, 7, deps);
  applyMatchPhaseImpl(PHASE_FINAL, 0, true, 7, deps);

  assert.equal(calls.banners.length, 1, 'баннер один на матч');
  assert.equal(calls.jackpots, 1);
});

/* Именно этот случай стережёт защиту по seq. Проверка «два вызова подряд»
   его не покрывает: там второй раз спасает внешнее условие prev !== FINAL.
   А вот если фаза успела откатиться (переподключение посреди матча вернуло
   состояние на expansion), то без seq баннер «ФИНАЛ ×N» показали бы дважды за
   один и тот же матч. */
test('в пределах одного матча финал объявляется один раз даже после отката фазы', () => {
  resetMatch();
  const { calls, deps } = makeDeps();
  applyMatchPhaseImpl(PHASE_FINAL, 0, true, 7, deps);
  match.phase = PHASE_EXPANSION;
  applyMatchPhaseImpl(PHASE_FINAL, 0, true, 7, deps);

  assert.equal(calls.banners.length, 1);
  assert.equal(calls.jackpots, 1);
});

test('в новом матче финал объявляется заново', () => {
  resetMatch();
  const { calls, deps } = makeDeps();
  applyMatchPhaseImpl(PHASE_FINAL, 0, true, 7, deps);
  // Следующий матч — другой seq.
  match.phase = PHASE_EXPANSION;
  applyMatchPhaseImpl(PHASE_FINAL, 0, true, 8, deps);

  assert.equal(calls.banners.length, 2);
});

test('вход в комнату посреди финала проходит молча', () => {
  resetMatch();
  const { calls, deps } = makeDeps();
  // announce=false — это восстановление состояния, а не событие матча.
  applyMatchPhaseImpl(PHASE_FINAL, 0, false, 7, deps);

  assert.equal(calls.banners.length, 0);
  assert.equal(calls.toasts.length, 0);
  assert.equal(match.phase, PHASE_FINAL, 'но сама фаза применена');
});

test('до старта матча фазы не объявляются', () => {
  resetMatch();
  session.started = false;
  const { calls, deps } = makeDeps();
  applyMatchPhaseImpl(PHASE_FINAL, 0, true, 7, deps);
  applyMatchPhaseImpl(PHASE_CONFLICT, 0, true, 7, deps);

  assert.equal(calls.banners.length, 0);
  assert.equal(calls.toasts.length, 0);
});

test('обычная смена фазы идёт тостом, а не баннером', () => {
  resetMatch();
  const { calls, deps } = makeDeps();
  applyMatchPhaseImpl(PHASE_CONFLICT, 0, true, 7, deps);

  assert.equal(calls.banners.length, 0);
  assert.equal(calls.toasts.length, 1);
  assert.equal(calls.toasts[0].opts.key, 'match_phase');
});

test('если баннер показать не удалось, финал объявляется тостом', () => {
  resetMatch();
  const { calls, deps } = makeDeps({ bannerShown: false });
  applyMatchPhaseImpl(PHASE_FINAL, 0, true, 7, deps);

  assert.equal(calls.banners.length, 1, 'попытка была');
  assert.equal(calls.toasts.length, 1, 'и откат на тост');
  assert.equal(calls.toasts[0].opts.key, 'match_phase_final');
});

test('верхний HUD перерисовывается на каждой смене фазы', () => {
  resetMatch();
  const { calls, deps } = makeDeps();
  applyMatchPhaseImpl(PHASE_CONFLICT, 0, true, 7, deps);
  applyMatchPhaseImpl(PHASE_FINAL, 0, true, 7, deps);
  assert.equal(calls.hudRedraws, 2);
});
