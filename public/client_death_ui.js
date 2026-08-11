/* Экран смерти и итогов матча: death-zoom камеры, оверлей поражения и таблица
   результатов. Вынесено из client.js — вызовы и порядок выполнения не
   менялись, только источник импорта. Числовая логика (причина смерти, личный
   рекорд, сортировка игроков) остаётся в чистых client_death.js/
   client_stats.js — здесь только DOM/canvas-обвязка. */

/* Вызывается каждый кадр из draw(). Возвращает { zoom, mixToAnchor } —
   текущий множитель клетки и долю [0..1], на которую камера должна
   сместиться от обычной цели к точке гибели. deps.get/set-геттеры читают и
   пишут переменные состояния client.js (deathZoomActive/Current/StartAt/
   ReleaseAt/AtRelease). */
export function updateDeathZoomImpl(now, deps) {
  const {
    prefersReducedMotion,
    fxHitstopScale,
    easeOutCubic,
    DEATH_ZOOM_MAX,
    DEATH_ZOOM_IN_MS,
    DEATH_ZOOM_OUT_MS,
    getActive,
    setActive,
    getCurrent,
    setCurrent,
    getStartAt,
    getReleaseAt,
    getAtRelease
  } = deps;

  if (prefersReducedMotion() || fxHitstopScale() <= 0) {
    setActive(false);
    setCurrent(1);
    return { zoom: 1, mixToAnchor: 0 };
  }

  let current = getCurrent();
  if (getActive()) {
    const t = easeOutCubic((now - getStartAt()) / DEATH_ZOOM_IN_MS);
    current = 1 + (DEATH_ZOOM_MAX - 1) * t;
  } else if (current > 1) {
    const t = easeOutCubic((now - getReleaseAt()) / DEATH_ZOOM_OUT_MS);
    current = getAtRelease() + (1 - getAtRelease()) * t;
    if (current <= 1.001) current = 1;
  } else {
    current = 1;
  }
  setCurrent(current);
  const mixToAnchor = (current - 1) / (DEATH_ZOOM_MAX - 1);
  return { zoom: current, mixToAnchor };
}

export function showDeathOverlayImpl(deps) {
  const {
    deathOverlay,
    overlayManager,
    dismissRoundModToasts,
    syncOverlayUiState,
    setChatCollapsed,
    toggleEmojiPanel,
    setDeathBestShown,
    renderDeathStats,
    setLastDeathStatsAt,
    sfx,
    comboBreak,
    obDeathsSeen,
    obBumpDeaths,
    setDeathReasonDeathsSeen,
    renderDeathReason
  } = deps;

  if (deathOverlay) deathOverlay.classList.remove('hidden');
  overlayManager.open('death');
  dismissRoundModToasts();
  syncOverlayUiState();
  setChatCollapsed(true);
  toggleEmojiPanel(false);
  setDeathBestShown(null);
  renderDeathStats();
  setLastDeathStatsAt(0);

  // J16: собственная смерть была беззвучной.
  sfx.death();
  comboBreak();

  // F16b: человеческое объяснение только на первых трёх смертях — дальше
  // ветеран читает сухую причину быстрее, чем абзац текста.
  // K4: сколько смертей было НА МОМЕНТ показа — запоминаем, чтобы блок можно
  // было пересобрать при смене языка с тем же составом строк.
  setDeathReasonDeathsSeen(obDeathsSeen());
  obBumpDeaths();
  renderDeathReason();

  overlayManager.focusDefault('death');
}

/* K4: раньше подсказка в оверлее смерти собиралась только внутри
   showDeathOverlay(), и setLang() её не трогал — в английском интерфейсе
   висело «Выйди из своей зоны, обведи участок…». Теперь это отдельная функция,
   которую зовёт и показ оверлея, и смена языка. */
export function renderDeathReasonImpl(deps) {
  const {
    deathReasonEl,
    getDeathReasonDeathsSeen,
    lastDeathInfo,
    deathReasonText,
    deathReasonHint,
    tfmt,
    reclaimWindowSec,
    document
  } = deps;

  if (!deathReasonEl) return;
  const deathsSeen = getDeathReasonDeathsSeen();
  const reasonText = deathReasonText(lastDeathInfo);
  const hintText = deathsSeen < 3 ? deathReasonHint(lastDeathInfo) : '';
  // F5 «Реклейм»: механика нигде не объяснена, показываем её на первой смерти.
  // Секунды подставляются из reclaimTicks, пришедшего в hello: раньше «20»
  // было вписано в саму строку словаря и пережило G22, где окно урезали до
  // 15 секунд. Единственный раз, когда игрок читает эту подсказку, она врала
  // на треть — и врала в ту сторону, которая стоит ему земли.
  const reclaimText = deathsSeen < 1 ? tfmt('reclaim.hint', { sec: reclaimWindowSec() }) : '';
  try {
    const frag = document.createDocumentFragment();
    if (reasonText) {
      const r = document.createElement('div');
      r.className = 'deathReasonMain';
      r.textContent = reasonText;
      frag.appendChild(r);
    }
    if (hintText) {
      const h = document.createElement('div');
      h.className = 'deathReasonHint';
      h.textContent = hintText;
      frag.appendChild(h);
    }
    if (reclaimText) {
      const rc = document.createElement('div');
      rc.className = 'deathReasonHint';
      rc.textContent = `♻ ${reclaimText}`;
      frag.appendChild(rc);
    }
    deathReasonEl.replaceChildren(frag);
  } catch {
    deathReasonEl.textContent = reasonText || hintText;
  }
  deathReasonEl.style.display = reasonText || hintText || reclaimText ? '' : 'none';
}

export function renderDeathStatsImpl(deps) {
  const {
    deathStatsEl,
    clientState,
    you,
    lastYouStats,
    mapCells,
    youContractType,
    youContractProgress,
    youContractGoal,
    contractLabel,
    infoPack,
    computeTopSorted,
    cosClampId,
    playerTitleHtml,
    cosTitleByPlayer,
    escapeHtml,
    getDeathBestShown,
    setDeathBestShown,
    commitBestPct,
    setSafeHtml,
    t,
    fmtInt,
    fmtPct1,
    rightTeamDetailsEl,
    renderTeamHudState,
    teamUnreadCount,
    setTeamUnreadCount,
    setBadgeCount,
    rightTeamBadgeEl,
    syncRightEmptyStates,
    youKills
  } = deps;

  if (!deathStatsEl) return;
  if (!clientState.lastState) {
    deathStatsEl.textContent = '';
    return;
  }
  const ordered = computeTopSorted(clientState.lastState.players);
  const meIndex = ordered.findIndex((p) => p.n === you);
  const me = meIndex >= 0 ? ordered[meIndex] : null;

  const snap = lastYouStats;
  const cells = Number(snap?.cells ?? me?.s) || 0;
  const pct = Number(snap?.pct ?? (mapCells ? (cells / mapCells) * 100 : 0)) || 0;
  const place =
    String(snap?.place || '').trim() || (meIndex >= 0 ? `${meIndex + 1}/${ordered.length}` : '—');

  const points = Number(snap?.points ?? me?.p) || 0;

  let contractText = '';
  if (youContractType) {
    const cn = contractLabel(youContractType) || infoPack().labels.contract;
    contractText = `${cn}: ${youContractProgress}/${youContractGoal}`;
  }

  const top = ordered.slice(0, 5);
  const rows = top
    .map((p, i) => {
      const pid = String(p.n);
      const nm = p.nm || String(p.n);
      const isMe = p.n === you;
      return `
        <tr class="${isMe ? 'matchRowMe' : ''} frame${cosClampId(p.cosFrame)}" data-pid="${pid}">
          <td class="num">${i + 1}</td>
          <td class="name">${playerTitleHtml(cosTitleByPlayer.get(p.n) || 0)}${escapeHtml(nm)}</td>
          <td class="num">${Number(p.p) || 0}</td>
        </tr>
      `;
    })
    .join('');

  // Рекорд считаем один раз на показ оверлея: renderDeathStats зовётся и на
  // обновлениях состояния, поэтому «новый рекорд» сохраняется в deathBestShown.
  const bestInfo = getDeathBestShown() || commitBestPct(pct);
  setDeathBestShown(bestInfo);

  const isTop1 = place && place !== '—' && place.startsWith('1/');

  setSafeHtml(
    deathStatsEl,
    `
    <div class="matchSummary" aria-label="${escapeHtml(t('death.your_result'))}">
      <div class="matchKpiGrid">
        <div class="matchKpi">
          <div class="matchKpiLabel">${escapeHtml(t('death.place'))}</div>
          <div class="matchKpiValue">${escapeHtml(place)}</div>
        </div>
        <div class="matchKpi">
          <div class="matchKpiLabel">${escapeHtml(t('death.points'))}</div>
          <div class="matchKpiValue">${fmtInt(points)}</div>
        </div>
      </div>

      <div class="matchMiniGrid">
        <div class="matchMini">
          <div class="matchMiniLabel">${escapeHtml(t('death.zone'))}</div>
          <div class="matchMiniValue">${fmtInt(cells)} • ${fmtPct1(pct)}</div>
        </div>
        <div class="matchMini">
          <div class="matchMiniLabel">${escapeHtml(t('death.kills'))}</div>
          <div class="matchMiniValue">${fmtInt(youKills)}</div>
        </div>
        ${
          // До первого осмысленного забега рекорда нет, и «Рекорд зоны 0,0%» —
          // не мотиватор, а насмешка. Карточка появляется вместе с рекордом.
          bestInfo.best > 0
            ? `
        <div class="matchMini${bestInfo.isRecord ? ' deathRecord' : ''}">
          <div class="matchMiniLabel">${escapeHtml(bestInfo.isRecord ? t('death.new_record') : t('death.best_zone'))}</div>
          <div class="matchMiniValue">${fmtPct1(bestInfo.best)}</div>
        </div>`
            : ''
        }
        ${
          contractText
            ? `
        <div class="matchMini">
          <div class="matchMiniLabel">${escapeHtml(t('death.contract'))}</div>
          <div class="matchMiniValue">${escapeHtml(contractText)}</div>
        </div>`
            : ''
        }
      </div>

      <div class="matchNextGap">${isTop1 ? escapeHtml(t('death.top1')) : escapeHtml(t('death.try_again'))}</div>
    </div>

    <div class="matchTableWrap" role="region" aria-label="${escapeHtml(t('death.top'))}">
      <table class="matchTable">
        <thead>
          <tr>
            <th class="num">#</th>
            <th>${escapeHtml(t('match.player'))}</th>
            <th class="num">${escapeHtml(t('death.points'))}</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `
  );

  try {
    const now = performance.now();
    if (rightTeamDetailsEl && !rightTeamDetailsEl.open) {
      if (!renderTeamHudState._u || now - renderTeamHudState._u > 1600) {
        renderTeamHudState._u = now;
        setTeamUnreadCount(Math.min(999, teamUnreadCount() + 1));
        setBadgeCount(rightTeamBadgeEl, teamUnreadCount());
      }
    }
  } catch {}
  try {
    syncRightEmptyStates();
  } catch {}
}

export function renderMatchResultsImpl(deps) {
  const {
    matchResultsEl,
    you,
    escapeHtml,
    setSafeHtml,
    t,
    fmtInt,
    resultPeak,
    resultAvg,
    resultDeaths,
    displayNameFrom,
    cosClampId,
    playerTitleHtml,
    cosTitleByPlayer,
    contractLabel,
    pointsBreakdownText,
    styleBreakdownText,
    firstSkinHookHtml,
    matchAutoJoin,
    matchContinueBtn,
    matchMenuBtn,
    hideMatchOverlay,
    showCosmeticsOverlay,
    setMatchAutoJoin,
    localStorage
  } = deps;

  if (!matchResultsEl) return;
  const rows = Array.isArray(deps.results) ? deps.results : [];
  if (!rows.length) {
    setSafeHtml(matchResultsEl, `<div class="matchSub">${escapeHtml(t('match.results_unavailable'))}</div>`);
    return;
  }
  const meIndex = rows.findIndex((r) => (Number(r?.n) || 0) === you);
  const me = meIndex >= 0 ? rows[meIndex] : null;
  const mePoints = Number(me?.p) || 0;
  // Мгновенный снимок зоны бесполезен: умерший на последней секунде видел 0.
  // Сервер шлёт пик (Pk), среднюю (Avg) и смерти (D) — показываем их.
  const meCells = resultPeak(me);
  const meAvg = resultAvg(me);
  const meDeaths = resultDeaths(me);
  const meKills = Number(me?.k) || 0;
  const mePlace = Number(me?.place) || (meIndex >= 0 ? meIndex + 1 : 0);
  const meCt = Number(me?.ct) || 0;
  const meCp = Number(me?.cp) || 0;
  const meCg = Number(me?.cg) || 0;
  const meSe = Number(me?.se) || 0;
  const meSb = Array.isArray(me?.sb) ? me.sb : null;
  const mePb = Array.isArray(me?.pb) ? me.pb : null;
  const meCd = Array.isArray(me?.cd) ? me.cd : null;
  const totalPlayers = rows.length;
  const isWin = meIndex === 0;

  let nextGapText = '';
  if (meIndex > 0 && me) {
    const next = rows[meIndex - 1];
    const dp = (Number(next?.p) || 0) - mePoints;
    const dc = (Number(next?.cells) || 0) - meCells;
    const dk = (Number(next?.k) || 0) - meKills;
    const parts = [];
    if (dp > 0) parts.push(`${fmtInt(dp)} ${t('match.next_gap_points')}`);
    else if (dc > 0) parts.push(`${fmtInt(dc)} ${t('match.next_gap_cells')}`);
    else if (dk > 0) parts.push(`${fmtInt(dk)} ${t('match.next_gap_kills')}`);
    if (parts.length) nextGapText = `${t('match.next_gap')}: ${parts.join(' ')}`;
  }

  const trs = rows
    .slice(0, 32)
    .map((r, i) => {
      const n = Number(r?.n) || 0;
      // C5: итоги матча приходят с nmEn — в EN показываем его.
      const nm = String(displayNameFrom(r, n, n || '—'));
      const p = Number(r?.p) || 0;
      const peak = resultPeak(r);
      const k = Number(r?.k) || 0;
      const d = resultDeaths(r);
      const isMe = n === you;
      const fr = Number(r?.fr) || 0;
      const frClass = `frame${cosClampId(fr)}`;
      return `
        <tr class="${isMe ? 'matchRowMe' : ''} ${frClass}">
          <td class="num">${i + 1}</td>
          <td class="name">${playerTitleHtml(cosTitleByPlayer.get(n) || 0)}${escapeHtml(nm)}</td>
          <td class="num">${fmtInt(p)}</td>
          <td class="num">${fmtInt(peak)}</td>
          <td class="num">${fmtInt(k)}</td>
          <td class="num">${fmtInt(d)}</td>
        </tr>
      `;
    })
    .join('');

  setSafeHtml(
    matchResultsEl,
    `
    <div class="matchSummary" aria-label="${escapeHtml(t('match.summary'))}">
      <div class="matchSummaryTop">
        <div class="matchResultPill ${isWin ? 'matchResultWin' : 'matchResultLose'}">${escapeHtml(isWin ? t('match.victory') : t('match.defeat'))}</div>
      </div>

      <div class="matchKpiGrid">
        <div class="matchKpi">
          <div class="matchKpiLabel">${escapeHtml(t('match.place'))}</div>
          <div class="matchKpiValue"><span data-count="place" data-to="${mePlace || 0}">${mePlace ? fmtInt(mePlace) : '—'}</span><span class="matchKpiOf"> ${escapeHtml(t('match.out_of'))} ${fmtInt(totalPlayers)}</span></div>
        </div>
        <div class="matchKpi">
          <div class="matchKpiLabel">${escapeHtml(t('match.points'))}</div>
          <div class="matchKpiValue" data-count="points" data-to="${mePoints}">${me ? fmtInt(mePoints) : '—'}</div>
        </div>
      </div>

      <div class="matchMiniGrid">
        <div class="matchMini">
          <div class="matchMiniLabel">${escapeHtml(t('match.peak'))}</div>
          <div class="matchMiniValue" data-count="zone" data-to="${meCells}">${me ? fmtInt(meCells) : '—'}</div>
        </div>
        <div class="matchMini">
          <div class="matchMiniLabel">${escapeHtml(t('match.avg'))}</div>
          <div class="matchMiniValue">${me ? fmtInt(meAvg) : '—'}</div>
        </div>
        <div class="matchMini">
          <div class="matchMiniLabel">${escapeHtml(t('match.kills'))}</div>
          <div class="matchMiniValue" data-count="kills" data-to="${meKills}">${me ? fmtInt(meKills) : '—'}</div>
        </div>
        <div class="matchMini">
          <div class="matchMiniLabel">${escapeHtml(t('match.deaths'))}</div>
          <div class="matchMiniValue">${me ? fmtInt(meDeaths) : '—'}</div>
        </div>
        ${meSe > 0 ? `<div class="matchMini matchMiniReward"><div class="matchMiniLabel">${escapeHtml(t('match.reward'))}</div><div class="matchMiniValue"><span data-count="reward" data-to="${meSe}" data-prefix="✨ +">✨ +${fmtInt(meSe)}</span> ${escapeHtml(t('cosmetics.style_points'))}</div></div>` : ''}
      </div>

      ${firstSkinHookHtml()}

      ${me && meCt ? `<div class="matchNextGap">${escapeHtml(t('match.contract'))}: ${escapeHtml(contractLabel(meCt) || String(meCt))} ${fmtInt(meCp)}/${fmtInt(meCg)}</div>` : ''}

      ${meCd ? `<div class="matchNextGap">${escapeHtml(t('match.contract_done'))}: ${escapeHtml(contractLabel(1) || '1')} ${fmtInt(Number(meCd[1]) || 0)} · ${escapeHtml(contractLabel(2) || '2')} ${fmtInt(Number(meCd[2]) || 0)} · ${escapeHtml(contractLabel(3) || '3')} ${fmtInt(Number(meCd[3]) || 0)}</div>` : ''}

      ${(meSb || mePb) ? `<div class="matchNextGap">${escapeHtml(t('match.breakdown'))}</div>` : ''}
      ${mePb ? `<div class="matchMiniGrid">
        <div class="matchMini"><div class="matchMiniLabel">${escapeHtml(t('match.points_breakdown'))}</div><div class="matchMiniValue">${escapeHtml(pointsBreakdownText(mePb))}</div></div>
      </div>` : ''}
      ${meSb ? `<div class="matchMiniGrid">
        <div class="matchMini"><div class="matchMiniLabel">${escapeHtml(t('match.style_breakdown'))}</div><div class="matchMiniValue">${escapeHtml(styleBreakdownText(meSb))}</div></div>
      </div>` : ''}

      ${nextGapText ? `<div class="matchNextGap">${escapeHtml(nextGapText)}</div>` : ''}

      <div class="matchNextActions" aria-label="${escapeHtml(t('match.summary'))}">
        <button id="matchQuickBtn" class="btnPrimary" type="button">${escapeHtml(t('match.play_on'))}</button>
        <button id="matchRoomsBtn" class="btnSecondary" type="button">${escapeHtml(t('match.rooms'))}</button>
        <button id="matchCosmeticsBtn" class="btnGhost" type="button">${escapeHtml(t('match.cosmetics'))}</button>
      </div>

      <label class="matchNextGap" style="display:flex; gap:10px; align-items:center;">
        <input id="matchAutoJoin" type="checkbox" ${matchAutoJoin ? 'checked' : ''} />
        <span>${escapeHtml(t('match.autojoin'))}</span>
      </label>
    </div>

    <div class="matchTableWrap" role="region" aria-label="${escapeHtml(t('match.player'))}">
      <table class="matchTable">
        <thead>
          <tr>
            <th class="num">#</th>
            <th>${escapeHtml(t('match.player'))}</th>
            <th class="num">${escapeHtml(t('match.points'))}</th>
            <th class="num">${escapeHtml(t('match.peak'))}</th>
            <th class="num">${escapeHtml(t('match.kills'))}</th>
            <th class="num">${escapeHtml(t('match.deaths'))}</th>
          </tr>
        </thead>
        <tbody>
          ${trs}
        </tbody>
      </table>
    </div>
  `
  );

  const quickBtn = matchResultsEl.querySelector('#matchQuickBtn');
  quickBtn?.addEventListener('click', (e) => {
    e?.preventDefault?.();
    matchContinueBtn?.click();
  });

  const roomsBtn = matchResultsEl.querySelector('#matchRoomsBtn');
  roomsBtn?.addEventListener('click', (e) => {
    e?.preventDefault?.();
    matchMenuBtn?.click();
  });

  const cosBtn = matchResultsEl.querySelector('#matchCosmeticsBtn');
  cosBtn?.addEventListener('click', (e) => {
    e?.preventDefault?.();
    hideMatchOverlay();
    showCosmeticsOverlay();
  });

  const autoJoinEl = matchResultsEl.querySelector('#matchAutoJoin');
  if (autoJoinEl) {
    autoJoinEl.addEventListener('change', () => {
      setMatchAutoJoin(!!autoJoinEl.checked);
      localStorage.setItem('matchAutoJoin', autoJoinEl.checked ? '1' : '0');
    });
  }
}
