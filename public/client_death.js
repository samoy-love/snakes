/* Причина смерти — числа 1..4, приходящие в бинарном протоколе, и их
   перевод в суффикс i18n-ключа (death.reason.<suffix> / death.hint.<suffix>).
   Раньше эту нумерацию знали три места отдельно: разбор бинарного пакета
   (handleStateBinary), deathReasonText и deathReasonHint — новую причину
   смерти пришлось бы добавлять в трёх местах и легко забыть одно. */

export const DEATH_REASON = Object.freeze({
  CUT: 1,
  HEADON: 2,
  SELFTRAIL: 3,
  WALL: 4
});

const SUFFIX_BY_REASON = {
  [DEATH_REASON.CUT]: 'cut',
  [DEATH_REASON.HEADON]: 'headon',
  [DEATH_REASON.SELFTRAIL]: 'selftrail',
  [DEATH_REASON.WALL]: 'wall'
};

/** '' для неизвестной/нулевой причины — вызывающий сам решает, что показать. */
export function deathReasonSuffix(reason) {
  return SUFFIX_BY_REASON[Number(reason) || 0] || '';
}
