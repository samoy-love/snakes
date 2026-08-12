/* Жизненный цикл матча — вынесено из client.js. Управляет переходами между
   фазами матча (расширение/конфликт/финал), концом и стартом нового матча,
   сбросом матч-скоуп состояния и каскадом чисел на экране итогов.

   Функции принимают явные deps вместо захвата глобалов client.js. Много
   изменяемых примитивов client.js (matchPhase, matchEnded, botIds и т.п.)
   объявлены там через let — записать их отсюда напрямую нельзя, поэтому
   импл-функции возвращают объект res с новыми значениями, а тонкая обёртка
   в client.js раскладывает его обратно по переменным (тот же приём, что и
   у onState()/onError() в client.js). Порядок вызовов и побочные эффекты не
   менялись — только источник переменных. */

// Применяет фазу матча. announce=true только для реальной смены фазы по ходу
// матча — при входе в комнату посреди финала баннер не нужен.
export function applyMatchPhaseImpl(ph, until, announce, seq, deps) {
  const { matchPhase, started, matchPhaseBannerSeq, matchSeq, matchFinalMult, t, showBigBanner, phaseDesc, addToast, sfx, phaseLabel, phaseIcon, renderTopHud, PHASE_FINAL } = deps;

  const next = Math.max(0, Math.min(2, Number(ph) || 0));
  const prev = matchPhase;
  let nextMatchPhase = next;
  const nextMatchPhaseUntil = Math.max(0, Number(until) || 0);
  let nextMatchPhaseBannerSeq = matchPhaseBannerSeq;

  if (announce && next === PHASE_FINAL && prev !== PHASE_FINAL && started) {
    const s = Number.isFinite(Number(seq)) ? Number(seq) : matchSeq;
    if (nextMatchPhaseBannerSeq !== s) {
      nextMatchPhaseBannerSeq = s;
      const title = t('phase.final_banner').replace('×2', `×${matchFinalMult}`);
      if (!showBigBanner('🔥', title, phaseDesc(PHASE_FINAL), 'jackpot')) {
        addToast('🔥', title, 'big', phaseDesc(PHASE_FINAL), {
          tab: 'match',
          key: 'match_phase_final',
          prio: 'jackpot'
        });
      }
      try {
        sfx.jackpot?.();
      } catch {}
    }
  } else if (announce && next !== prev && started) {
    addToast(phaseIcon(next), `${t('phase.label')}: ${phaseLabel(next)}`, null, phaseDesc(next), {
      tab: 'match',
      key: 'match_phase',
      prio: 'important'
    });
  }

  try {
    renderTopHud();
  } catch {}

  return { matchPhase: nextMatchPhase, matchPhaseUntil: nextMatchPhaseUntil, matchPhaseBannerSeq: nextMatchPhaseBannerSeq };
}

export function updateMatchCountdownImpl(deps) {
  const { matchCountdownEl, matchEnded, matchResetAt, approxNowTick, tickMs, syncMatchOverlayActions } = deps;
  if (!matchCountdownEl) return;
  if (!matchEnded || !matchResetAt) {
    matchCountdownEl.textContent = '—';
    syncMatchOverlayActions();
    return;
  }
  const nt = approxNowTick();
  if (nt == null) {
    matchCountdownEl.textContent = '—';
    syncMatchOverlayActions();
    return;
  }
  const remTicks = Math.max(0, matchResetAt - nt);
  const remMs = tickMs ? remTicks * tickMs : 0;
  const sec = Math.max(0, Math.ceil(remMs / 1000));
  matchCountdownEl.textContent = `${sec}s`;
  syncMatchOverlayActions();
}

export function resetClientForNewMatchImpl(deps) {
  const { matchContinueTimeout, colors, ownerFillStyleCache, minimapOwnerRgbCache, coolDeadlineByOwner, captureAnchorByOwner, eventFeed, toastByKey, toastQueue, powerUps, comboReset, killfeedEl, eventToastsEl, renderKillfeed, renderMetaHudImpl, renderTopHudImpl, clientState, resetLeaderboardUi, renderMetaHud, renderTopHud, syncMatchOverlayActions } = deps;

  let nextMatchContinuePending = false;
  let nextMatchContinueTimeout = matchContinueTimeout;
  if (nextMatchContinueTimeout) {
    clearTimeout(nextMatchContinueTimeout);
    nextMatchContinueTimeout = 0;
  }

  let nextMatchStyleEarned = 0;

  // K2: номера игроков в новом матче раздаются заново — кэши по номеру нужно
  // обнулить, иначе враг ещё несколько минут рисуется цветом прошлого хозяина
  // номера, а два игрока могут оказаться одного цвета.
  colors.clear();
  ownerFillStyleCache.clear();
  minimapOwnerRgbCache.clear();
  const nextBotIds = new Set();
  coolDeadlineByOwner.clear();
  const nextLastRoi = null;
  /* C7: карты «по номеру игрока» здесь НЕ чистятся намеренно. Сервер при
     matchStart не пересылает ни nameUpdateBatch, ни cosExtra (main.go: обе
     рассылки привязаны к входу в комнату), поэтому очистка оставила бы всех
     без имён и косметики до следующего события. Номера внутри комнаты между
     матчами не переигрываются — переигрываются они при входе, там очистка и
     стоит (см. onInit). Ограничены по размеру: ключ — номер игрока, а их в
     комнате не больше roomLimit + ботов. */
  captureAnchorByOwner.clear();

  eventFeed.length = 0;
  let nextLastEventsTick = 0;
  let nextLastEventsAt = 0;
  let nextBigToastCooldownUntil = 0;

  try {
    for (const it of toastByKey.values()) {
      if (it?.timer) clearTimeout(it.timer);
    }
  } catch {}
  toastByKey.clear();
  toastQueue.length = 0;

  let nextLastDeathInfo = null;
  let nextLastYouStats = null;

  let nextMutatorType = 0;
  let nextMutatorUntil = 0;
  let nextBountyTarget = 0;
  let nextBountyUntil = 0;
  const nextPowerUps = new Map();

  let nextYouKills = 0;
  let nextYouStreak = 0;
  let nextYouTrailLen = 0;
  let nextYouInOwnZone = true;
  let nextYouNearestHomeX = -1;
  let nextYouNearestHomeY = -1;
  let nextYouNearestHomeAt = 0;
  comboReset();
  let nextYouContractType = 0;
  let nextYouContractGoal = 0;
  let nextYouContractProgress = 0;
  let nextYouContractUntil = 0;
  let nextYouShield = false;
  let nextYouSpeedUntilTick = 0;
  let nextYouSpeedType = 0;
  // keep youStyle; it is a persistent currency, not match-scoped

  try {
    if (killfeedEl) killfeedEl.replaceChildren();
    if (eventToastsEl) eventToastsEl.replaceChildren();
  } catch {}
  // C8: DOM киллфида очищен вручную — подпись обязана протухнуть.
  renderKillfeed._sig = null;
  // C7: у мета-панели теперь такая же подпись — сбрасываем по той же причине.
  renderMetaHudImpl._sig = null;
  renderTopHudImpl._placeSig = null;

  clientState.lastState = null;
  const nextPrevPlayers = new Map();
  const nextCurrPlayers = new Map();
  const nextHeadIndexByOwner = new Map();
  const nextLastPacketAt = performance.now();
  clientState.camX = null;
  clientState.camY = null;
  clientState.camLeadX = 0;
  clientState.camLeadY = 0;

  let nextShakeX = 0;
  let nextShakeY = 0;
  let nextShakeVelX = 0;
  let nextShakeVelY = 0;

  let nextMinimapDirty = true;
  let nextMinimapHadChunkUpdate = false;
  let nextLastMinimapDrawAt = 0;

  resetLeaderboardUi();

  renderKillfeed();
  renderMetaHud();
  renderTopHud();
  syncMatchOverlayActions();

  return {
    matchContinuePending: nextMatchContinuePending,
    matchContinueTimeout: nextMatchContinueTimeout,
    matchStyleEarned: nextMatchStyleEarned,
    botIds: nextBotIds,
    lastRoi: nextLastRoi,
    lastEventsTick: nextLastEventsTick,
    lastEventsAt: nextLastEventsAt,
    bigToastCooldownUntil: nextBigToastCooldownUntil,
    lastDeathInfo: nextLastDeathInfo,
    lastYouStats: nextLastYouStats,
    mutatorType: nextMutatorType,
    mutatorUntil: nextMutatorUntil,
    bountyTarget: nextBountyTarget,
    bountyUntil: nextBountyUntil,
    powerUps: nextPowerUps,
    youKills: nextYouKills,
    youStreak: nextYouStreak,
    youTrailLen: nextYouTrailLen,
    youInOwnZone: nextYouInOwnZone,
    youNearestHomeX: nextYouNearestHomeX,
    youNearestHomeY: nextYouNearestHomeY,
    youNearestHomeAt: nextYouNearestHomeAt,
    youContractType: nextYouContractType,
    youContractGoal: nextYouContractGoal,
    youContractProgress: nextYouContractProgress,
    youContractUntil: nextYouContractUntil,
    youShield: nextYouShield,
    youSpeedUntilTick: nextYouSpeedUntilTick,
    youSpeedType: nextYouSpeedType,
    prevPlayers: nextPrevPlayers,
    currPlayers: nextCurrPlayers,
    headIndexByOwner: nextHeadIndexByOwner,
    lastPacketAt: nextLastPacketAt,
    shakeX: nextShakeX,
    shakeY: nextShakeY,
    shakeVelX: nextShakeVelX,
    shakeVelY: nextShakeVelY,
    minimapDirty: nextMinimapDirty,
    minimapHadChunkUpdate: nextMinimapHadChunkUpdate,
    lastMinimapDrawAt: nextLastMinimapDrawAt
  };
}

export function onMatchEndImpl(d, deps) {
  const { lastEventsTick, lastEventsAt, matchSeq, matchEndTick, matchContinueTimeout, hideOverlays, bumpMatchesPlayed, renderMatchResults, updateMatchCountdown, showMatchOverlay } = deps;

  let nextLastEventsTick = lastEventsTick;
  let nextLastEventsAt = lastEventsAt;
  if (typeof d?.tick === 'number' && Number.isFinite(d.tick)) {
    nextLastEventsTick = d.tick;
    nextLastEventsAt = Date.now();
  }
  const nextMatchSeq = Number(d?.seq) || matchSeq;
  const nextMatchEndTick = Number(d?.endTick) || matchEndTick;
  const nextMatchResetAt = Number(d?.resetAt) || 0;
  const nextMatchEnded = true;

  let nextMatchContinuePending = false;
  let nextMatchContinueTimeout = matchContinueTimeout;
  if (nextMatchContinueTimeout) {
    clearTimeout(nextMatchContinueTimeout);
    nextMatchContinueTimeout = 0;
  }

  const nextYouAlive = false;
  const nextLastDirSent = null;
  const nextStarted = false;

  hideOverlays();

  const nextLastMatchResults = d?.results || null;

  bumpMatchesPlayed();
  renderMatchResults(nextLastMatchResults);
  updateMatchCountdown();
  showMatchOverlay();

  return {
    lastEventsTick: nextLastEventsTick,
    lastEventsAt: nextLastEventsAt,
    matchSeq: nextMatchSeq,
    matchEndTick: nextMatchEndTick,
    matchResetAt: nextMatchResetAt,
    matchEnded: nextMatchEnded,
    matchContinuePending: nextMatchContinuePending,
    matchContinueTimeout: nextMatchContinueTimeout,
    youAlive: nextYouAlive,
    lastDirSent: nextLastDirSent,
    started: nextStarted,
    lastMatchResults: nextLastMatchResults
  };
}

export function onMatchStartImpl(d, deps) {
  const { lastEventsTick, lastEventsAt, matchSeq, matchContinueTimeout, matchAutoJoin, applyMatchPhase, resetClientForNewMatch, hideMatchOverlay, hideOverlays, toggleEmojiPanel, syncMatchOverlayActions, obResetMatch, obAnnounceShop, updateMatchCountdown, showMatchOverlay, PHASE_EXPANSION } = deps;

  let nextLastEventsTick = lastEventsTick;
  let nextLastEventsAt = lastEventsAt;
  if (typeof d?.tick === 'number' && Number.isFinite(d.tick)) {
    nextLastEventsTick = d.tick;
    nextLastEventsAt = Date.now();
  }
  const nextMatchSeq = Number(d?.seq) || matchSeq;
  const nextMatchEndTick = Number(d?.endTick) || 0;
  const nextMatchResetAt = 0;
  const nextMatchEnded = false;
  // C2: новый матч всегда начинается с фазы расширения; сервер дублирует её в
  // payload matchStart.
  const nextMatchPhaseBannerSeq = -1;
  applyMatchPhase(d?.phase ?? PHASE_EXPANSION, d?.phaseUntil, false, nextMatchSeq);

  let nextMatchContinuePending = false;
  let nextMatchContinueTimeout = matchContinueTimeout;
  if (nextMatchContinueTimeout) {
    clearTimeout(nextMatchContinueTimeout);
    nextMatchContinueTimeout = 0;
  }

  const nextYouAlive = false;
  const nextLastDirSent = null;
  let nextStarted;

  if (matchAutoJoin) {
    resetClientForNewMatch();
    hideMatchOverlay();
    hideOverlays();
    toggleEmojiPanel(false);
    syncMatchOverlayActions();
    nextStarted = true;
    obResetMatch();
    obAnnounceShop();
    try {
      document.body.classList.add('inGame');
    } catch {}
  } else {
    // stay in results overlay until user clicks "Играть дальше"
    nextStarted = false;
    updateMatchCountdown();
    showMatchOverlay();
  }

  return {
    lastEventsTick: nextLastEventsTick,
    lastEventsAt: nextLastEventsAt,
    matchSeq: nextMatchSeq,
    matchEndTick: nextMatchEndTick,
    matchResetAt: nextMatchResetAt,
    matchEnded: nextMatchEnded,
    matchPhaseBannerSeq: nextMatchPhaseBannerSeq,
    matchContinuePending: nextMatchContinuePending,
    matchContinueTimeout: nextMatchContinueTimeout,
    youAlive: nextYouAlive,
    lastDirSent: nextLastDirSent,
    started: nextStarted
  };
}

// J6: каскад чисел — место → очки → зона → киллы → награда,
// по 250 мс со сдвигом 180 мс, каждое со своим восходящим бипом.
export const MATCH_CASCADE_ORDER = ['place', 'points', 'zone', 'kills', 'reward'];

export function runMatchResultsCascadeImpl(deps) {
  const { matchResultsEl, fxCountUpEnabled, animateNumber, sfx } = deps;
  if (!matchResultsEl) return;
  if (!fxCountUpEnabled()) return;
  let step = 0;
  for (const key of MATCH_CASCADE_ORDER) {
    const el = matchResultsEl.querySelector(`[data-count="${key}"]`);
    if (!el) continue;
    const to = Number(el.dataset.to) || 0;
    if (to <= 0) continue;
    const prefix = String(el.dataset.prefix || '');
    const delay = step * 180;
    animateNumber(el, 0, to, 250, {
      delay,
      prefix,
      onDone: () => {}
    });
    const i = step;
    setTimeout(() => sfx.countStep(i), delay);
    step++;
  }
}
