/* Жизненный цикл матча: переходы между фазами (расширение/конфликт/финал),
   конец и старт нового матча, сброс матч-скоуп состояния и каскад чисел на
   экране итогов.

   Отдельно от экрана итогов (client_endgame.js), который эти функции зовёт:
   здесь только арка матча и её состояние, без DOM оверлеев — так порядок
   фаз проверяется тестом.

   Много изменяемых примитивов (matchPhase, matchEnded, botIds и т.п.) раньше
   было плоскими let в client.js — записать их отсюда было нельзя, и функции
   возвращали объект res, который вызывающий раскладывал обратно. Теперь это
   поля match/session в client_store.js, они правятся на месте. */

import { PHASE_EXPANSION, PHASE_FINAL, match, session } from './client_store.js';

// Применяет фазу матча. announce=true только для реальной смены фазы по ходу
// матча — при входе в комнату посреди финала баннер не нужен.
export function applyMatchPhaseImpl(ph, until, announce, seq, deps) {
  const { t, showBigBanner, phaseDesc, addToast, sfx, phaseLabel, phaseIcon, renderTopHud } = deps;

  const next = Math.max(0, Math.min(2, Number(ph) || 0));
  const prev = match.phase;
  match.phase = next;
  match.phaseUntil = Math.max(0, Number(until) || 0);

  if (announce && next === PHASE_FINAL && prev !== PHASE_FINAL && session.started) {
    const s = Number.isFinite(Number(seq)) ? Number(seq) : match.seq;
    // Баннер «ФИНАЛ ×N» — один раз на матч, даже если событие придёт дважды.
    if (match.phaseBannerSeq !== s) {
      match.phaseBannerSeq = s;
      const title = t('phase.final_banner').replace('×2', `×${match.finalMult}`);
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
  } else if (announce && next !== prev && session.started) {
    addToast(phaseIcon(next), `${t('phase.label')}: ${phaseLabel(next)}`, null, phaseDesc(next), {
      tab: 'match',
      key: 'match_phase',
      prio: 'important'
    });
  }

  try {
    renderTopHud();
  } catch {}
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

/* Конец матча: сервер прислал итоги. */
export function onMatchEndImpl(d, deps) {
  const { hideOverlays, bumpMatchesPlayed, renderMatchResults, updateMatchCountdown, showMatchOverlay } = deps;

  if (typeof d?.tick === 'number' && Number.isFinite(d.tick)) {
    match.lastEventsTick = d.tick;
    match.lastEventsAt = Date.now();
  }
  match.seq = Number(d?.seq) || match.seq;
  match.endTick = Number(d?.endTick) || match.endTick;
  match.resetAt = Number(d?.resetAt) || 0;
  match.ended = true;

  match.continuePending = false;
  if (match.continueTimeout) {
    clearTimeout(match.continueTimeout);
    match.continueTimeout = 0;
  }

  session.youAlive = false;
  session.lastDirSent = null;
  session.started = false;

  hideOverlays();

  match.lastResults = d?.results || null;

  bumpMatchesPlayed();
  renderMatchResults(match.lastResults);
  updateMatchCountdown();
  showMatchOverlay();
}

/* Начало нового матча в той же комнате. */
export function onMatchStartImpl(d, deps) {
  const {
    applyMatchPhase,
    resetClientForNewMatch,
    hideMatchOverlay,
    hideOverlays,
    toggleEmojiPanel,
    syncMatchOverlayActions,
    obResetMatch,
    obAnnounceShop,
    updateMatchCountdown,
    showMatchOverlay
  } = deps;

  if (typeof d?.tick === 'number' && Number.isFinite(d.tick)) {
    match.lastEventsTick = d.tick;
    match.lastEventsAt = Date.now();
  }
  match.seq = Number(d?.seq) || match.seq;
  match.endTick = Number(d?.endTick) || 0;
  match.resetAt = 0;
  match.ended = false;
  /* C2: новый матч всегда начинается с фазы расширения; сервер дублирует её в
     payload matchStart. Баннер фазы при этом не нужен. */
  match.phaseBannerSeq = -1;
  applyMatchPhase(d?.phase ?? PHASE_EXPANSION, d?.phaseUntil, false, match.seq);

  match.continuePending = false;
  if (match.continueTimeout) {
    clearTimeout(match.continueTimeout);
    match.continueTimeout = 0;
  }

  session.youAlive = false;
  session.lastDirSent = null;

  if (!match.autoJoin) {
    // Остаёмся на экране итогов, пока игрок не нажмёт «Играть дальше».
    session.started = false;
    updateMatchCountdown();
    showMatchOverlay();
    return;
  }

  resetClientForNewMatch();
  hideMatchOverlay();
  hideOverlays();
  toggleEmojiPanel(false);
  syncMatchOverlayActions();
  session.started = true;
  obResetMatch();
  obAnnounceShop();
  try {
    document.body.classList.add('inGame');
  } catch {}
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
