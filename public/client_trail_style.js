/* Визуальное состояние собственного следа: чистая арифметика без канваса.
   Вынесено из draw() (client.js, ~1180 строк — самая рискованная функция
   клиента, см. §6.4 отчёта разведки от 2026-08-05) — второй чистый кусок
   после dirVec, посчитанный один раз до горячего цикла отрисовки клеток и
   там же только читаемый.

   I2: собственный след — главный объект риска в игре. Он отличался от
   собственной территории всего на 0.07 альфы, поэтому базовая альфа
   поднята, добавлена светлая обводка, а на длинном следе (сигнал риска)
   ещё и пульсация яркости. */

/** Доля риска от длины следа: 0 до порога, дальше растёт до 1 за 55 клеток. */
export function trailRiskFor(trailLen, pulseFrom) {
  const len = Number(trailLen) || 0;
  const from = Number(pulseFrom) || 0;
  if (len <= from) return 0;
  return Math.min(1, (len - from) / 55);
}

/**
 * Альфа и обводка собственного следа на текущий кадр.
 *
 * Пульс выключен без риска, без эффектов (fxEnabled=false) и при
 * prefers-reduced-motion — тогда след просто ярче территории, без анимации.
 */
export function trailVisualState({ trailLen, pulseFrom, fxEnabled, reducedMotion, nowFrame }) {
  const risk = trailRiskFor(trailLen, pulseFrom);
  const pulse = risk <= 0 || !fxEnabled || reducedMotion ? 0 : risk * (0.5 + 0.5 * Math.sin(Number(nowFrame) * 0.0115));
  return {
    risk,
    pulse,
    ownAlpha: Math.min(0.98, 0.85 + 0.11 * pulse),
    otherAlpha: 0.74,
    ownStroke: `rgba(255,255,255,${(0.45 + 0.4 * pulse).toFixed(3)})`
  };
}
