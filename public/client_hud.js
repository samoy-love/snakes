/* Верхний HUD и правая колонка (мета-панель и таблица команды).

   Раньше все три функции принимали deps — один объект на шестьдесят ключей,
   который client.js пересобирал перед каждым вызовом, то есть до 180 раз в
   секунду в кадре отрисовки. Ключи были копиями состояния, и любое
   переименование поля в client.js молча превращало сокращённую запись
   `{ youKills }` в `{ kills: me.kills }` — модуль-потребитель продолжал
   доставать youKills и получал undefined, а кусок интерфейса просто пропадал.

   Теперь модуль импортирует dom и группы стора напрямую и читает те же самые
   поля, что и все остальные. Передавать нечего, ctx нет.

   Поля-подписи renderTopHudImpl._placeSig и renderMetaHudImpl._sig остаются
   на самих функциях: их гасит resetClientForNewMatch вместе с очисткой DOM. */

import { cosClampId } from './client_cos_draw.js';
import { escapeHtml, setSafeHtml } from './client_util.js';
import { dom } from './client_dom.js';
import { clientState } from './client_state.js';
import {
  PHASE_CONFLICT,
  PHASE_FINAL,
  cos,
  dailySlots,
  match,
  me,
  session,
  world
} from './client_store.js';
import { infoPack, lang, t } from './client_i18n_rt.js';
import { obSecondMatchPlus, obTickImpl, obUnlocked } from './client_onboarding.js';
import { addToast } from './client_toasts.js';
import { animateNumber, renderComboHud } from './client_fx_rt.js';
import { sortPlayersByScore } from './client_stats.js';
import { displayNameOf, playerTitleHtml } from './client_identity.js';
import {
  contractLabel,
  dailyLabel,
  formatTickRemain,
  infoName,
  powerupLabel,
  tickRemainSeconds
} from './client_labels.js';
import { syncRightEmptyStates } from './client_hud_panels.js';

// C10: getElementById зваться каждый кадр не должен — держим ссылку.
let topHudPlaceElCache = null;
let topHudPhaseElCache = null;

function phaseKey(ph) {
  return ph === PHASE_FINAL ? 'final' : ph === PHASE_CONFLICT ? 'conflict' : 'expansion';
}

export function phaseLabel(ph) {
  return t(`phase.${phaseKey(ph)}`);
}

export function phaseDesc(ph) {
  return t(`phase.${phaseKey(ph)}_desc`);
}

export function phaseIcon(ph) {
  return ph === PHASE_FINAL ? '🔥' : ph === PHASE_CONFLICT ? '⚔' : '🌱';
}

// I5: отдельный слот баунти в верхнем HUD. Разметку добавляет вёрсточный агент
// (#topHudBounty); пока её нет — создаём сами, рядом с киллами.
function ensureTopHudBountyEl() {
  let el = document.getElementById('topHudBounty');
  if (el) return el;
  const host = dom.topHudKills?.parentElement || dom.topHudTime?.parentElement || null;
  if (!host) return null;
  try {
    el = document.createElement('span');
    el.id = 'topHudBounty';
    el.className = 'topHudBounty hidden';
    host.insertBefore(el, dom.topHudKills || null);
  } catch {
    return null;
  }
  return el;
}

/* K3: «Место N/M · Очки P» — единственная цифра, по которой игра на самом деле
   ранжирует, и её в HUD не было вовсе (показывалась «Зона %», по которой не
   ранжируют). Слот #topHudPlace ждём от вёрсточного агента; пока его нет —
   создаём сами, слева в правой группе верхнего HUD. */
function ensureTopHudPlaceEl() {
  if (topHudPlaceElCache && topHudPlaceElCache.isConnected) return topHudPlaceElCache;
  let el = document.getElementById('topHudPlace');
  if (el) return (topHudPlaceElCache = el);
  const host = dom.topHudTime?.parentElement || dom.topHudKills?.parentElement || null;
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
function ensureTopHudPhaseEl() {
  if (topHudPhaseElCache && topHudPhaseElCache.isConnected) return topHudPhaseElCache;
  let el = document.getElementById('topHudPhase');
  if (el) return (topHudPhaseElCache = el);
  const host = dom.topHudTime?.parentElement || dom.topHudKills?.parentElement || null;
  if (!host) return null;
  try {
    el = document.createElement('span');
    el.id = 'topHudPhase';
    el.className = 'topHudPhase topHudChip';
    if (dom.topHudTime && dom.topHudTime.parentElement === host) {
      host.insertBefore(el, dom.topHudTime.nextSibling);
    } else {
      host.appendChild(el);
    }
  } catch {
    return null;
  }
  return (topHudPhaseElCache = el);
}

export function renderTopHudImpl() {
  const topHudEl = dom.topHud;
  if (!topHudEl) return;
  if (!session.started || !clientState.lastState) {
    topHudEl.setAttribute('aria-hidden', 'true');
    return;
  }

  topHudEl.setAttribute('aria-hidden', 'false');

  // F17: постепенное раскрытие мета-систем в первом матче.
  obTickImpl({ started: session.started, addToast, t });
  const obKills = obUnlocked('bounty');
  const obContract = obUnlocked('contract');
  // Магазин — со второго матча: в первом тратить ещё нечего и незачем.
  if (dom.cosmeticsBtn) dom.cosmeticsBtn.classList.toggle('hidden', !obSecondMatchPlus());

  const you = session.you;
  const mapCells = session.mapCells;
  const mine = clientState.lastState.players?.find((p) => p.n === you);
  const cells = Number(mine?.s) || 0;
  const pct = mapCells ? (cells / mapCells) * 100 : 0;

  // J6: счётчик клеток догоняется анимацией, а не прыгает.
  if (dom.topHudCells) {
    const prevCells = Number(dom.topHudCells.dataset.value);
    if (!Number.isFinite(prevCells)) {
      dom.topHudCells.textContent = String(cells);
    } else if (prevCells !== cells) {
      animateNumber(dom.topHudCells, prevCells, cells, 420);
    }
    dom.topHudCells.dataset.value = String(cells);
  }
  if (dom.topHudPct) {
    // C10: запись в DOM только при изменении строки. Сверяемся с самим узлом,
    // а не с внешним кэшем: тот протух бы, если разметку пересоберут.
    const pctTxt = `${pct.toFixed(1)}%`;
    if (dom.topHudPct.textContent !== pctTxt) dom.topHudPct.textContent = pctTxt;
  }

  // K3: место и очки — прямо в верхнем HUD.
  // C10: computeTopSorted() копировала и сортировала массив каждый кадр, а
  // textContent писался безусловно. Пересчёт — только когда меняется вход.
  {
    const placeEl = ensureTopHudPlaceEl();
    if (placeEl) {
      // points в подписи остаётся, хотя в текст больше не попадает: их
      // изменение — признак того, что мог поменяться и порядок в таблице,
      // то есть само место. Это триггер пересчёта, а не выводимое значение.
      const points = Number(mine?.p) || 0;
      const sig = `${world.lastPacketAt}|${points}|${lang()}`;
      if (renderTopHudImpl._placeSig !== sig) {
        renderTopHudImpl._placeSig = sig;
        const ordered = sortPlayersByScore(clientState.lastState.players);
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
    const phaseEl = ensureTopHudPhaseEl();
    if (phaseEl) {
      const isFinal = match.phase === PHASE_FINAL;
      let txt = match.ended
        ? ''
        : `${phaseIcon(match.phase)} ${phaseLabel(match.phase)}${isFinal ? ` ×${match.finalMult}` : ''}`;
      // Последние 20 секунд перед финалом — обратный отсчёт до ×N, чтобы игрок
      // успел придержать крупный захват.
      if (txt && !isFinal && match.phase === PHASE_CONFLICT && match.phaseUntil) {
        // tickRemainSeconds отдаёт дробное число: без округления в чипе
        // висело бы «Final in 12.698999999999979», да ещё и с записью в DOM
        // на каждом кадре.
        const raw = tickRemainSeconds(match.phaseUntil);
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
          phaseEl.title = `${t('phase.label')}: ${phaseDesc(match.phase)}`;
        } catch {}
      }
    }
  }

  if (dom.topHudKills) {
    const killsTxt = obKills ? `⚔ ${me.kills}` : '';
    if (dom.topHudKills.textContent !== killsTxt) {
      dom.topHudKills.textContent = killsTxt;
      dom.topHudKills.classList.toggle('hidden', !obKills);
    }
  }
  if (obKills) renderComboHud();

  // I5: таймер матча — отдельный крупный элемент. Только время, без «•»-склейки,
  // иначе самое важное («сколько до конца») обрезается по ellipsis.
  if (dom.topHudTime) {
    const rem = match.endTick ? formatTickRemain(match.endTick) : '';
    if (dom.topHudTime.textContent !== rem) {
      dom.topHudTime.textContent = rem || '';
      const sec = match.endTick ? tickRemainSeconds(match.endTick) : null;
      dom.topHudTime.classList.toggle('isUrgent', sec != null && sec <= 30);
      dom.topHudTime.classList.toggle('isCritical', sec != null && sec <= 15);
      dom.topHudTime.classList.toggle('hidden', !rem);
      try {
        dom.topHudTime.title = t('hud.time_left');
      } catch {}
    }
  }

  // I5: баунти — отдельный элемент, а не часть таймерной строки.
  const bountyEl = ensureTopHudBountyEl();
  if (bountyEl) {
    if (match.bountyTarget && obKills) {
      const bn = displayNameOf(match.bountyTarget);
      const rem = formatTickRemain(match.bountyUntil);
      /* C7: строка писалась в DOM на КАЖДОМ кадре, хотя меняется раз в секунду
         (обратный отсчёт). Пишем только при изменении — так же, как соседние
         элементы верхнего HUD. */
      const bt = rem ? `🎯 ${bn} (${rem})` : `🎯 ${bn}`;
      if (bountyEl.textContent !== bt) bountyEl.textContent = bt;
      bountyEl.classList.remove('hidden');
      bountyEl.classList.toggle('isMe', match.bountyTarget === you);
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
    if (!dom.topHudContract) return { chip: null };
    let chip = dom.topHudContract.querySelector('.topHudChip');
    if (!chip) {
      dom.topHudContract.replaceChildren();
      chip = document.createElement('span');
      chip.className = 'topHudChip hidden';
      dom.topHudContract.appendChild(chip);
    }
    return { chip };
  };

  const { chip } = ensureContractParts();

  if (chip) {
    if (me.contractType && obContract) {
      const cn = contractLabel(me.contractType) || infoPack().labels.contract;
      const goal = Number(me.contractGoal) || 0;
      const prog = Number(me.contractProgress) || 0;
      const rem = formatTickRemain(me.contractUntil);
      // C7: то же самое — раньше безусловная запись на каждом кадре.
      const chipTxt = `📜 ${cn} ${prog}/${goal}${rem ? ` (${rem})` : ''}`;
      if (chip.textContent !== chipTxt) chip.textContent = chipTxt;
      chip.classList.remove('hidden');
    } else {
      if (chip.textContent !== '') chip.textContent = '';
      chip.classList.add('hidden');
    }
  }

  if (dom.topHudBarFill) {
    const p = mapCells ? Math.max(0, Math.min(1, cells / mapCells)) : 0;
    // C7: присваивание в style пересчитывает стиль элемента даже когда значение
    // не изменилось, а меняется оно только при смене числа клеток.
    const wTxt = `${(p * 100).toFixed(1)}%`;
    if (dom.topHudBarFill.style.width !== wTxt) dom.topHudBarFill.style.width = wTxt;
  }
}

export function renderMetaHudImpl() {
  const metaHudEl = dom.metaHud;
  if (!metaHudEl) return;
  const addRow = (rows, label, value, urgent) => {
    const v = String(value ?? '').trim();
    if (!v) return;
    rows.push({ label, value: v, urgent: !!urgent });
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
  if (obKills && me.streak >= 2) addRow(fightRows, t('meta.streak'), `x${me.streak}`);
  const buffs = [];
  if (me.shield && obBonus) buffs.push(infoName(infoPack().powerups, 1, powerupLabel(1)));
  if (obBonus && me.speedUntilTick && match.lastEventsTick && me.speedUntilTick > match.lastEventsTick) {
    const rem = formatTickRemain(me.speedUntilTick);
    const tpe = me.speedType === 4 ? 4 : 2;
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
  if (cos.style && obUnlocked('contract')) addRow(mainRows, infoPack().labels.style, String(cos.style));

  // Ежедневки — со второго матча: в первом они только добавляют шума.
  const dailyRows = [];
  if (obDaily) {
    // C7: все слоты, сколько бы их ни прислал сервер.
    for (const s of dailySlots()) {
      const it = me.dailies.get(s);
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

export function renderTeamHudImpl() {
  const teamHudEl = dom.teamHud;
  if (!teamHudEl) return;
  if (!session.started || !clientState.lastState) {
    teamHudEl.textContent = '';
    try {
      syncRightEmptyStates();
    } catch {}
    return;
  }
  const you = session.you;
  const mapCells = session.mapCells;
  const ordered = sortPlayersByScore(clientState.lastState.players);
  // cells/pct/place отсюда убраны вместе со строками «Место» и «Очки»:
  // ровно эти числа стоят в #topHudPlace, который виден всегда.
  const small = window.innerWidth <= 720;
  const maxRows = small ? 10 : 12;
  const topN = ordered.slice(0, maxRows);

  const rows = topN
    .map((p, i) => {
      const pid = escapeHtml(String(p.n));
      const nm = p.nm || String(p.n);
      const isMe = p.n === you;
      const pp = mapCells ? ((Number(p.s) || 0) / mapCells) * 100 : 0;
      const fr = Number(p.cosFrame) || 0;
      const frClass = `frame${cosClampId(fr)}`;
      return `
        <tr class="${isMe ? 'me' : ''} ${frClass}" data-pid="${pid}">
          <td class="num">${i + 1}</td>
          <td class="name">${playerTitleHtml(cos.titleByPlayer.get(p.n) || 0)}${escapeHtml(nm)}</td>
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

/* Метки последней перерисовки таблицы команды: их читают троттлинги в
   client_render.js (renderTeamHud._at) и на экране смерти
   (renderTeamHudState._u). Раньше нули проставлял client.js — начальное
   значение принадлежит самой функции. */
renderTeamHudImpl._u = 0;
renderTeamHudImpl._at = 0;
