/* Верхний HUD и правая колонка (мета-панель и таблица команды). Вынесено из
   client.js — вызовы и порядок выполнения не менялись, только источник
   импорта. Как и client_shop_ui.js/client_rooms_ui.js, функции принимают
   deps — геттеры для переменных состояния client.js и ссылки на DOM/хелперы.
   Это не меняет, КОГДА что вызывается, только ОТКУДА берётся код функции. */

import { cosClampId } from './client_cos_draw.js';
import { escapeHtml, setSafeHtml } from './client_util.js';

// C10: getElementById зваться каждый кадр не должен — держим ссылку.
let topHudPlaceElCache = null;
let topHudPhaseElCache = null;

// I5: отдельный слот баунти в верхнем HUD. Разметку добавляет вёрсточный агент
// (#topHudBounty); пока её нет — создаём сами, рядом с киллами.
function ensureTopHudBountyEl(deps) {
  const { topHudKillsEl, topHudTimeEl } = deps;
  let el = document.getElementById('topHudBounty');
  if (el) return el;
  const host = topHudKillsEl?.parentElement || topHudTimeEl?.parentElement || null;
  if (!host) return null;
  try {
    el = document.createElement('span');
    el.id = 'topHudBounty';
    el.className = 'topHudBounty hidden';
    host.insertBefore(el, topHudKillsEl || null);
  } catch {
    return null;
  }
  return el;
}

/* K3: «Место N/M · Очки P» — единственная цифра, по которой игра на самом деле
   ранжирует, и её в HUD не было вовсе (показывалась «Зона %», по которой не
   ранжируют). Слот #topHudPlace ждём от вёрсточного агента; пока его нет —
   создаём сами, слева в правой группе верхнего HUD. */
function ensureTopHudPlaceEl(deps) {
  const { topHudTimeEl, topHudKillsEl } = deps;
  if (topHudPlaceElCache && topHudPlaceElCache.isConnected) return topHudPlaceElCache;
  let el = document.getElementById('topHudPlace');
  if (el) return (topHudPlaceElCache = el);
  const host = topHudTimeEl?.parentElement || topHudKillsEl?.parentElement || null;
  if (!host) return null;
  try {
    el = document.createElement('span');
    el.id = 'topHudPlace';
    // Пока вёрсточный агент не завёл собственный стиль, переиспользуем
    // существующую «пилюлю» .topHudChip — иначе строка выглядит как сырой текст.
    el.className = 'topHudPlace topHudChip';
    host.insertBefore(el, host.firstChild);
  } catch {
    return null;
  }
  return (topHudPlaceElCache = el);
}

/* C2: индикатор фазы матча — рядом с таймером. Слот #topHudPhase ждём от
   вёрсточного агента; пока его нет — создаём сами и переиспользуем .topHudChip. */
function ensureTopHudPhaseEl(deps) {
  const { topHudTimeEl, topHudKillsEl } = deps;
  if (topHudPhaseElCache && topHudPhaseElCache.isConnected) return topHudPhaseElCache;
  let el = document.getElementById('topHudPhase');
  if (el) return (topHudPhaseElCache = el);
  const host = topHudTimeEl?.parentElement || topHudKillsEl?.parentElement || null;
  if (!host) return null;
  try {
    el = document.createElement('span');
    el.id = 'topHudPhase';
    el.className = 'topHudPhase topHudChip';
    if (topHudTimeEl && topHudTimeEl.parentElement === host) {
      host.insertBefore(el, topHudTimeEl.nextSibling);
    } else {
      host.appendChild(el);
    }
  } catch {
    return null;
  }
  return (topHudPhaseElCache = el);
}

export function renderTopHudImpl(deps) {
  const {
    topHudEl,
    started,
    clientState,
    you,
    mapCells,
    topHudCellsEl,
    topHudPctEl,
    topHudKillsEl,
    topHudTimeEl,
    topHudContractEl,
    topHudBarFillEl,
    cosmeticsBtn,
    lastPacketAt,
    lang,
    matchPhase,
    matchEnded,
    matchFinalMult,
    matchPhaseUntil,
    matchEndTick,
    bountyTarget,
    bountyUntil,
    youKills,
    youContractType,
    youContractGoal,
    youContractProgress,
    youContractUntil,
    PHASE_FINAL,
    PHASE_CONFLICT,
    obTick,
    obUnlocked,
    obSecondMatchPlus,
    animateNumber,
    computeTopSorted,
    t,
    phaseIcon,
    phaseLabel,
    phaseDesc,
    tickRemainSeconds,
    formatTickRemain,
    renderComboHud,
    displayNameOf,
    contractLabel,
    infoPack
  } = deps;

  if (!topHudEl) return;
  if (!started || !clientState.lastState) {
    topHudEl.setAttribute('aria-hidden', 'true');
    return;
  }

  topHudEl.setAttribute('aria-hidden', 'false');

  // F17: постепенное раскрытие мета-систем в первом матче.
  obTick();
  const obKills = obUnlocked('bounty');
  const obContract = obUnlocked('contract');
  // Магазин — со второго матча: в первом тратить ещё нечего и незачем.
  if (cosmeticsBtn) cosmeticsBtn.classList.toggle('hidden', !obSecondMatchPlus());

  const me = clientState.lastState.players?.find((p) => p.n === you);
  const cells = Number(me?.s) || 0;
  const pct = mapCells ? (cells / mapCells) * 100 : 0;

  // J6: счётчик клеток догоняется анимацией, а не прыгает.
  if (topHudCellsEl) {
    const prevCells = Number(topHudCellsEl.dataset.value);
    if (!Number.isFinite(prevCells)) {
      topHudCellsEl.textContent = String(cells);
    } else if (prevCells !== cells) {
      animateNumber(topHudCellsEl, prevCells, cells, 420);
    }
    topHudCellsEl.dataset.value = String(cells);
  }
  if (topHudPctEl) {
    // C10: запись в DOM только при изменении строки. Сверяемся с самим узлом,
    // а не с внешним кэшем: тот протух бы, если разметку пересоберут.
    const pctTxt = `${pct.toFixed(1)}%`;
    if (topHudPctEl.textContent !== pctTxt) topHudPctEl.textContent = pctTxt;
  }

  // K3: место и очки — прямо в верхнем HUD.
  // C10: computeTopSorted() копировала и сортировала массив каждый кадр, а
  // textContent писался безусловно. Пересчёт — только когда меняется вход.
  {
    const placeEl = ensureTopHudPlaceEl(deps);
    if (placeEl) {
      // points в подписи остаётся, хотя в текст больше не попадает: их
      // изменение — признак того, что мог поменяться и порядок в таблице,
      // то есть само место. Это триггер пересчёта, а не выводимое значение.
      const points = Number(me?.p) || 0;
      const sig = `${lastPacketAt}|${points}|${lang}`;
      if (renderTopHudImpl._placeSig !== sig) {
        renderTopHudImpl._placeSig = sig;
        const ordered = computeTopSorted(clientState.lastState.players);
        const idx = ordered.findIndex((p) => p.n === you);
        /* Очки из полосы убраны: место уже ранжирует игрока, а сами очки
           стоят колонкой в правой таблице (и в итогах матча). В полосе
           шириной ~370px «· Очки 0» стоило целой строки переноса. */
        const txt = idx >= 0 ? `${t('hud.place_short')} ${idx + 1}/${ordered.length}` : '';
        if (placeEl.textContent !== txt) {
          placeEl.textContent = txt;
          placeEl.classList.toggle('hidden', !txt);
          try {
            placeEl.title = `${t('death.place')} / ${t('death.points')}`;
          } catch {}
        }
        placeEl.classList.toggle('isLeader', idx === 0);
      }
    }
  }

  /* C2: фаза матча рядом с таймером. Раньше игрок не видел арку вовсе —
     включая удвоение очков за захват в последней фазе. */
  {
    const phaseEl = ensureTopHudPhaseEl(deps);
    if (phaseEl) {
      const isFinal = matchPhase === PHASE_FINAL;
      let txt = matchEnded
        ? ''
        : `${phaseIcon(matchPhase)} ${phaseLabel(matchPhase)}${isFinal ? ` ×${matchFinalMult}` : ''}`;
      // Последние 20 секунд перед финалом — обратный отсчёт до ×N, чтобы игрок
      // успел придержать крупный захват.
      if (txt && !isFinal && matchPhase === PHASE_CONFLICT && matchPhaseUntil) {
        // tickRemainSeconds отдаёт дробное число: без округления в чипе
        // висело бы «Final in 12.698999999999979», да ещё и с записью в DOM
        // на каждом кадре.
        const raw = tickRemainSeconds(matchPhaseUntil);
        const sec = raw == null ? null : Math.max(0, Math.ceil(raw));
        if (sec != null && sec <= 20) {
          txt = `🔥 ${t('phase.final_in')} ${sec}`;
        }
      }
      if (phaseEl.textContent !== txt) {
        phaseEl.textContent = txt;
        phaseEl.classList.toggle('hidden', !txt);
        phaseEl.classList.toggle('isFinal', isFinal);
        try {
          phaseEl.title = `${t('phase.label')}: ${phaseDesc(matchPhase)}`;
        } catch {}
      }
    }
  }

  if (topHudKillsEl) {
    const killsTxt = obKills ? `⚔ ${youKills}` : '';
    if (topHudKillsEl.textContent !== killsTxt) {
      topHudKillsEl.textContent = killsTxt;
      topHudKillsEl.classList.toggle('hidden', !obKills);
    }
  }
  if (obKills) renderComboHud();

  // I5: таймер матча — отдельный крупный элемент. Только время, без «•»-склейки,
  // иначе самое важное («сколько до конца») обрезается по ellipsis.
  if (topHudTimeEl) {
    const rem = matchEndTick ? formatTickRemain(matchEndTick) : '';
    if (topHudTimeEl.textContent !== rem) {
      topHudTimeEl.textContent = rem || '';
      const sec = matchEndTick ? tickRemainSeconds(matchEndTick) : null;
      topHudTimeEl.classList.toggle('isUrgent', sec != null && sec <= 30);
      topHudTimeEl.classList.toggle('isCritical', sec != null && sec <= 15);
      topHudTimeEl.classList.toggle('hidden', !rem);
      try {
        topHudTimeEl.title = t('hud.time_left');
      } catch {}
    }
  }

  // I5: баунти — отдельный элемент, а не часть таймерной строки.
  const bountyEl = ensureTopHudBountyEl(deps);
  if (bountyEl) {
    if (bountyTarget && obKills) {
      const bn = displayNameOf(bountyTarget);
      const rem = formatTickRemain(bountyUntil);
      /* C7: строка писалась в DOM на КАЖДОМ кадре, хотя меняется раз в секунду
         (обратный отсчёт). Пишем только при изменении — так же, как соседние
         элементы верхнего HUD. */
      const bt = rem ? `🎯 ${bn} (${rem})` : `🎯 ${bn}`;
      if (bountyEl.textContent !== bt) bountyEl.textContent = bt;
      bountyEl.classList.remove('hidden');
      bountyEl.classList.toggle('isMe', bountyTarget === you);
    } else {
      if (bountyEl.textContent !== '') bountyEl.textContent = '';
      bountyEl.classList.add('hidden');
    }
  }

  /* Строка «Цель: захват территории» отсюда убрана. Цель матча не меняется
     никогда и ничего не сообщает игроку, который уже в матче, — а место в
     всегда видимой полосе занимала. Правила объясняет меню (блок «Как
     играть»), а верхняя полоса оставлена под то, что действительно меняется:
     место, зона, время, фаза, киллы и контракт. */
  const ensureContractParts = () => {
    if (!topHudContractEl) return { chip: null };
    let chip = topHudContractEl.querySelector('.topHudChip');
    if (!chip) {
      topHudContractEl.replaceChildren();
      chip = document.createElement('span');
      chip.className = 'topHudChip hidden';
      topHudContractEl.appendChild(chip);
    }
    return { chip };
  };

  const { chip } = ensureContractParts();

  if (chip) {
    if (youContractType && obContract) {
      const cn = contractLabel(youContractType) || infoPack().labels.contract;
      const goal = Number(youContractGoal) || 0;
      const prog = Number(youContractProgress) || 0;
      const rem = formatTickRemain(youContractUntil);
      // C7: то же самое — раньше безусловная запись на каждом кадре.
      const chipTxt = `📜 ${cn} ${prog}/${goal}${rem ? ` (${rem})` : ''}`;
      if (chip.textContent !== chipTxt) chip.textContent = chipTxt;
      chip.classList.remove('hidden');
    } else {
      if (chip.textContent !== '') chip.textContent = '';
      chip.classList.add('hidden');
    }
  }

  if (topHudBarFillEl) {
    const p = mapCells ? Math.max(0, Math.min(1, cells / mapCells)) : 0;
    // C7: присваивание в style пересчитывает стиль элемента даже когда значение
    // не изменилось, а меняется оно только при смене числа клеток.
    const wTxt = `${(p * 100).toFixed(1)}%`;
    if (topHudBarFillEl.style.width !== wTxt) topHudBarFillEl.style.width = wTxt;
  }
}

export function renderMetaHudImpl(deps) {
  const {
    metaHudEl,
    clientState,
    you,
    mapCells,
    youStreak,
    youShield,
    youSpeedUntilTick,
    lastEventsTick,
    youSpeedType,
    youStyle,
    youDailies,
    t,
    obUnlocked,
    obSecondMatchPlus,
    infoName,
    infoPack,
    powerupLabel,
    formatTickRemain,
    dailySlots,
    dailyLabel,
    syncRightEmptyStates
  } = deps;

  if (!metaHudEl) return;
  const addRow = (rows, label, value, urgent) => {
    const v = String(value ?? '').trim();
    if (!v) return;
    rows.push({ label, value: v, urgent: !!urgent });
  };

  const addProgressRow = (rows, label, p, leftText, rightText, urgent) => {
    const pct = Number(p);
    if (!Number.isFinite(pct)) return;
    const lt = String(leftText || '').trim();
    const rt = String(rightText || '').trim();
    const vv = lt && rt ? `${lt} • ${rt}` : lt || rt;
    rows.push({
      label,
      value: vv,
      urgent: !!urgent,
      progress: Math.max(0, Math.min(1, pct / 100)),
      progressRight: vv,
    });
  };

  const buildSection = (title, rows, titleHint) => {
    const sec = document.createElement('div');
    sec.className = 'metaSection';
    const t2 = document.createElement('div');
    t2.className = 'metaSectionTitle';
    t2.textContent = title;
    if (titleHint) t2.title = titleHint;
    sec.appendChild(t2);
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = r.urgent ? 'metaRow metaRowUrgent' : 'metaRow';
      if (typeof r.progress === 'number') {
        row.className += ' metaRowProgress';
        row.style.setProperty('--p', String(r.progress));
      }
      const l = document.createElement('span');
      l.className = 'metaLabel';
      l.textContent = `${r.label}:`;
      const v = document.createElement('span');
      v.className = 'metaValue';
      v.textContent = typeof r.progressRight === 'string' && r.progressRight ? r.progressRight : r.value;
      row.appendChild(l);
      row.appendChild(v);
      sec.appendChild(row);
    }
    return sec;
  };

  const me = clientState.lastState?.players?.find?.((p) => p.n === you) || null;
  const cells = Number(me?.s) || 0;
  const pct = mapCells ? (cells / mapCells) * 100 : 0;

  // F17: в первом матче мета-системы открываются по одной (см. OB_STAGES).
  const obBonus = obUnlocked('bonus');
  const obKills = obUnlocked('bounty');
  const obDaily = obSecondMatchPlus();

  /* Мутатор раунда и баунти отсюда убраны: оба уже стоят в верхней полосе
     (#topHudPhase и #topHudBounty), причём там они и нужнее — это события с
     обратным отсчётом, требующие немедленной реакции, а полоса видна всегда.
     Дублирование стоило правой панели двух строк, а полосе — ничего. */
  const matchRows = [];

  const fightRows = [];
  // «Киллы» живут в #topHudKills. Здесь остаётся только серия: её в верхней
  // полосе нет, а она объясняет, откуда взялся множитель очков.
  if (obKills && youStreak >= 2) addRow(fightRows, t('meta.streak'), `x${youStreak}`);
  const buffs = [];
  if (youShield && obBonus) buffs.push(infoName(infoPack().powerups, 1, powerupLabel(1)));
  if (obBonus && youSpeedUntilTick && lastEventsTick && youSpeedUntilTick > lastEventsTick) {
    const rem = formatTickRemain(youSpeedUntilTick);
    const tpe = youSpeedType === 4 ? 4 : 2;
    const dash = infoName(infoPack().powerups, tpe, powerupLabel(tpe));
    buffs.push(rem ? `${dash} (${rem})` : dash);
  }
  if (buffs.length) addRow(fightRows, infoPack().labels.buffs, buffs.join(' • '));

  /* Панель показывает ТОЛЬКО то, чего нет в верхней полосе.
     Убраны как дубли (замер на живом экране, 1076x970):
       - «Цель: захват территории» — цель матча не меняется никогда, а слово
         «Цель» и без того стоит заголовком этой же секции;
       - «Зона: N • M%»  — ровно это показывают #topHudPct и #topHudCells;
       - «До конца: м:сс» — это #topHudTime;
       - «Киллы: N» ниже — это #topHudKills.
     Верхняя полоса видна всегда и читается одним взглядом; правая панель —
     для того, что в строку не помещается. */
  const mainRows = [];
  // Стиль как валюта имеет смысл только вместе с контрактом, который его даёт.
  if (youStyle && obUnlocked('contract')) addRow(mainRows, infoPack().labels.style, String(youStyle));

  // Ежедневки — со второго матча: в первом они только добавляют шума.
  const dailyRows = [];
  if (obDaily) {
    // C7: все слоты, сколько бы их ни прислал сервер.
    for (const s of dailySlots()) {
      const it = youDailies.get(s);
      if (!it || !it.type) continue;
      addRow(dailyRows, dailyLabel(it.type), `${it.prog}/${it.goal}`);
    }
  }

  const detailSections = [];
  const addDetailSection = (title, rows, titleHint) => {
    if (!rows.length) return;
    detailSections.push({ title, rows, titleHint });
  };
  // Заголовок «Матч» уже стоит в summary этого <details> — внутри он был
  // третьей копией того же слова. Секция про мутатор и баунти — это раунд.
  addDetailSection(t('meta.round'), matchRows);
  addDetailSection(t('meta.fight'), fightRows);
  addDetailSection(t('meta.tasks'), dailyRows, t('meta.tasks_hint'));

  /* C7: панель пересобиралась ПОЛНОСТЬЮ на каждом кадре — замер оснасткой
     (tools/probe.mjs): 16 createElement и 10 записей textContent на кадр,
     то есть ~1000 узлов в секунду при том, что содержимое меняется раз в
     секунду (обратные отсчёты) или реже. Тот же приём, что в renderKillfeed:
     сверяем подпись содержимого и не трогаем DOM, когда рисовать нечего. */
  const metaSig = JSON.stringify([
    mainRows,
    detailSections,
    // Свёрнутость <details> живёт в DOM, а не в данных: если панель пересобрать,
    // она схлопнется, поэтому состояние в подпись не входит и пересборка
    // происходит только при смене самих строк.
  ]);
  if (renderMetaHudImpl._sig === metaSig) return;
  renderMetaHudImpl._sig = metaSig;

  if (!mainRows.length && !detailSections.length) {
    metaHudEl.textContent = '';
    metaHudEl.style.display = 'none';
    return;
  }

  // Раскрытое состояние блока «Подробнее» переживает пересборку. Если
  // панель ещё ни разу не собиралась в этой сессии — стартуем раскрытой на
  // десктопе (там серия киллов и дневные задания видны без лишнего клика) и
  // свёрнутой на мобильном (места мало, как и раньше).
  const priorMetaDetails = metaHudEl.querySelector('details.metaDetails');
  const wasOpen = priorMetaDetails
    ? priorMetaDetails.open
    : window.matchMedia('(min-width: 721px)').matches;

  metaHudEl.style.display = '';
  const frag = document.createDocumentFragment();
  if (mainRows.length) {
    frag.appendChild(buildSection(t('meta.wallet'), mainRows));
  }

  if (detailSections.length) {
    const det = document.createElement('details');
    det.className = 'metaDetails';
    det.open = wasOpen;

    const sum = document.createElement('summary');
    sum.className = 'metaDetailsSummary';
    sum.textContent = t('meta.details');
    det.appendChild(sum);

    for (const s of detailSections) {
      det.appendChild(buildSection(s.title, s.rows, s.titleHint));
    }
    frag.appendChild(det);
  }
  metaHudEl.replaceChildren(frag);

  try {
    syncRightEmptyStates();
  } catch {}
}

export function renderTeamHudImpl(deps) {
  const {
    teamHudEl,
    started,
    clientState,
    you,
    mapCells,
    t,
    computeTopSorted,
    cosTitleByPlayer,
    playerTitleHtml,
    syncRightEmptyStates
  } = deps;

  if (!teamHudEl) return;
  if (!started || !clientState.lastState) {
    teamHudEl.textContent = '';
    try {
      syncRightEmptyStates();
    } catch {}
    return;
  }
  const ordered = computeTopSorted(clientState.lastState.players);
  // cells/pct/place отсюда убраны вместе со строками «Место» и «Очки»:
  // ровно эти числа стоят в #topHudPlace, который виден всегда.
  const small = window.innerWidth <= 720;
  const maxRows = small ? 10 : 12;
  const topN = ordered.slice(0, maxRows);

  const rows = topN
    .map((p, i) => {
      const pid = String(p.n);
      const nm = p.nm || String(p.n);
      const isMe = p.n === you;
      const pp = mapCells ? ((Number(p.s) || 0) / mapCells) * 100 : 0;
      const fr = Number(p.cosFrame) || 0;
      const frClass = `frame${cosClampId(fr)}`;
      return `
        <tr class="${isMe ? 'me' : ''} ${frClass}" data-pid="${pid}">
          <td class="num">${i + 1}</td>
          <td class="name">${playerTitleHtml(cosTitleByPlayer.get(p.n) || 0)}${escapeHtml(nm)}</td>
          <td class="num">${Number(p.p) || 0}</td>
          <td class="num">${pp.toFixed(1)}%</td>
        </tr>
      `;
    })
    .join('');

  /* Панель — это только таблица. Убрано:
       - заголовок «Команда»: он уже стоит в summary этого же <details>;
       - строки «Место» и «Очки»: обе цифры есть в #topHudPlace;
       - подпись «Топ-5» над таблицей на 12 строк — она врала. Сколько строк
         показано, видно по самой таблице, отдельная подпись не нужна. */
  setSafeHtml(
    teamHudEl,
    `
    <div class="metaSection">
      <table class="teamTable">
        <thead>
          <tr>
            <th class="num">#</th>
            <th class="name">${escapeHtml(t('lb.player'))}</th>
            <th class="num">${escapeHtml(t('death.points'))}</th>
            <th class="num">${escapeHtml(t('match.zone'))}</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `
  );
}
