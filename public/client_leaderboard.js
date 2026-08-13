/* Таблица лидеров: DOM-рендер строк лидерборда (топ + режим "рядом со мной"
   с гистерезисом) и точечное обновление ячейки имени с титулом.

   Раньше это жило в client.js и читало/писало module-level let'ы
   (leaderboardTable/leaderboardTbody/lbMode/...) напрямую. По образцу
   public/client_minimap.js: снимок состояния матча и функции-зависимости
   (доступ к DOM статов, i18n, титулам, значкам ботов) передаются как
   аргументы, а сугубо внутреннее состояние рендера (DOM таблицы, режим
   top/around, подпись последнего набора строк) остаётся module-scoped
   здесь же. Кэш DOM-строк по id игрока — в clientState.leaderboardRowsById
   (public/client_state.js), как и раньше. */

import { clientState } from './client_state.js';
import { sortPlayersByScore } from './client_stats.js';
import { cosClampId } from './client_cos_draw.js';

let leaderboardTable = null;
let leaderboardTbody = null;
let lastLeaderboardSig = '';

let lbMode = 'top';
let lbAroundIndex = null;
let lbAroundIndexAt = 0;

let lastLeaderboardRenderAt = 0;

/* Сброс на вход/выход из матча — тот же набор полей, что раньше сбрасывался
   в client.js вручную. clientState.leaderboardRowsById пересоздаётся, а не
   очищается, чтобы отвязать все ранее выданные строки от нового матча. */
export function resetLeaderboardUi() {
  lastLeaderboardSig = '';
  lbAroundIndex = null;
  lbAroundIndexAt = 0;
  clientState.leaderboardRowsById = new Map();
  try {
    leaderboardTbody?.replaceChildren?.();
  } catch {}
}

export function ensureLeaderboardDom(statsEl, t) {
  if (!statsEl) return;
  if (leaderboardTable && leaderboardTbody) return;

  leaderboardTable = document.createElement('table');
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  const thRank = document.createElement('th');
  thRank.textContent = '#';
  thRank.className = 'rank';
  const thName = document.createElement('th');
  thName.textContent = t('leaderboard.player');
  const thCells = document.createElement('th');
  thCells.textContent = t('leaderboard.cells');
  thCells.className = 'cells';
  thCells.style.textAlign = 'right';
  const thPct = document.createElement('th');
  thPct.textContent = t('leaderboard.share');
  thPct.className = 'share';
  thPct.style.textAlign = 'right';
  trh.appendChild(thRank);
  trh.appendChild(thName);
  trh.appendChild(thCells);
  trh.appendChild(thPct);
  thead.appendChild(trh);
  leaderboardTable.appendChild(thead);

  leaderboardTbody = document.createElement('tbody');
  leaderboardTable.appendChild(leaderboardTbody);

  statsEl.replaceChildren(leaderboardTable);
}

function createLeaderboardRow(p) {
  const tr = document.createElement('tr');
  tr.dataset.pid = String(p.n);
  tr.classList.add('lb-enter');

  const tdRank = document.createElement('td');
  tdRank.className = 'rank';
  const tdName = document.createElement('td');
  tdName.className = 'name';
  const tdCells = document.createElement('td');
  tdCells.className = 'num cells';
  const tdPct = document.createElement('td');
  tdPct.className = 'num share';

  tr.appendChild(tdRank);
  tr.appendChild(tdName);
  tr.appendChild(tdCells);
  tr.appendChild(tdPct);

  tr._lb = { tdRank, tdName, tdCells, tdPct };
  return tr;
}

/* То же для DOM-пути таблицы лидеров, которая обновляется каждый кадр:
   пересобираем ячейку только при смене титула или ника.
   deps: { botArchInfo, botArchBadge, cosTitleName, lang } */
function setNameCellWithTitle(td, titleId, name, playerNum, deps) {
  if (!td) return;
  const { botArchInfo, botArchBadge, cosTitleName, lang } = deps;
  const tid = Math.max(0, Number(titleId) || 0);
  const nm = String(name || '');
  // C4: значок бота — часть подписи, поэтому входит в ключ кэша, иначе смена
  // архетипа (переезд бота между слотами) не перерисует ячейку.
  const bi = botArchInfo(playerNum);
  const bsig = bi ? `${bi.arch}:${bi.tier}:${lang}` : '';
  if (td._tid === tid && td._nm === nm && td._bsig === bsig) return;
  td._tid = tid;
  td._nm = nm;
  td._bsig = bsig;
  const badge = bi ? botArchBadge(playerNum) : null;
  const tn = cosTitleName(tid);
  // Ник обрезается css text-overflow:ellipsis — title показывает полное имя
  // (с титулом, если он есть) при наведении мыши.
  td.title = tn ? `${tn} ${nm}` : nm;
  if (!tn) {
    if (badge) td.replaceChildren(badge, document.createTextNode(nm));
    else td.textContent = nm;
    return;
  }
  const sp = document.createElement('span');
  sp.className = 'playerTitle';
  sp.textContent = tn;
  if (badge) td.replaceChildren(badge, sp, document.createTextNode(nm));
  else td.replaceChildren(sp, document.createTextNode(nm));
}

/* Рендер таблицы лидеров. Принимает снимок состояния матча (clientState.lastState)
   как аргумент — не читает clientState напрямую, кроме leaderboardRowsById,
   который остаётся общим кэшем строк.
   deps: { you, mapCells, statsEl, t, cosTitleByPlayer, botArchInfo,
           botArchBadge, cosTitleName, lang } */
export function updateLeaderboard(state, deps) {
  if (!state) return;
  const { you, mapCells, statsEl, t, cosTitleByPlayer, botArchInfo, botArchBadge, cosTitleName, lang } = deps;

  ensureLeaderboardDom(statsEl, t);
  if (!leaderboardTbody) return;

  const now = performance.now();
  lastLeaderboardRenderAt = now;

  const reduceMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const small = window.innerWidth <= 720;
  const maxRows = small ? 8 : 10;
  const topCount = 5;
  const ordered = sortPlayersByScore(state.players);
  const meIndex = ordered.findIndex((p) => p.n === you);

  // Hysteresis for switching between "Top" and "Around me" mode.
  // This prevents the leaderboard from constantly changing its set of rows near the boundary.
  if (meIndex < 0) {
    lbMode = 'top';
  } else if (lbMode === 'top') {
    if (meIndex >= topCount + 1) {
      lbMode = 'around';
      lbAroundIndex = meIndex;
      lbAroundIndexAt = now;
    }
  } else {
    if (meIndex <= topCount - 2) {
      lbMode = 'top';
    }
  }

  const pick = [];
  const picked = new Set();
  const pushAt = (i) => {
    if (i < 0 || i >= ordered.length) return;
    const p = ordered[i];
    const pid = String(p.n);
    if (picked.has(pid)) return;
    picked.add(pid);
    pick.push({ p, rank: i + 1 });
  };

  for (let i = 0; i < topCount; i++) pushAt(i);
  if (lbMode === 'around' && meIndex >= topCount) {
    if (lbAroundIndex == null) {
      lbAroundIndex = meIndex;
      lbAroundIndexAt = now;
    } else {
      const diff = Math.abs(meIndex - lbAroundIndex);
      // Update the around-me anchor only on meaningful movement or after a short cooldown.
      if (diff >= 2 || (diff >= 1 && now - lbAroundIndexAt > 2500)) {
        lbAroundIndex = meIndex;
        lbAroundIndexAt = now;
      }
    }
    for (let i = lbAroundIndex - 2; i <= lbAroundIndex + 2; i++) pushAt(i);
  }
  if (pick.length > maxRows) pick.length = maxRows;

  const nearIds = new Set();
  if (meIndex >= 0) {
    for (let i = meIndex - 1; i <= meIndex + 1; i++) {
      if (i < 0 || i >= ordered.length) continue;
      nearIds.add(String(ordered[i].n));
    }
  }

  const firstTops = new Map();
  if (!reduceMotion) {
    for (const tr of leaderboardTbody.children) {
      const pid = tr?.dataset?.pid;
      if (!pid) continue;
      firstTops.set(pid, tr.getBoundingClientRect().top);
    }
  }

  const nextIds = new Set();
  for (const it of pick) {
    const p = it.p;
    const pid = String(p.n);
    nextIds.add(pid);

    let tr = clientState.leaderboardRowsById.get(pid);
    if (!tr) {
      tr = createLeaderboardRow(p);
      clientState.leaderboardRowsById.set(pid, tr);
    }

    if (p.n === you) tr.classList.add('me');
    else tr.classList.remove('me');
    // Рамка — CSS-класс .frame0..7 на строке таблицы лидеров.
    const frCls = `frame${cosClampId(p.cosFrame)}`;
    if (tr._frCls !== frCls) {
      if (tr._frCls) tr.classList.remove(tr._frCls);
      tr.classList.add(frCls);
      tr._frCls = frCls;
    }
    if (p.n !== you && nearIds.has(pid)) tr.classList.add('lbNear');
    else tr.classList.remove('lbNear');

    const lb = tr._lb;
    if (lb) {
      if (lb.tdRank) lb.tdRank.textContent = String(it.rank);
      // Титул перед ником — как в плашке над головой и в итогах матча.
      setNameCellWithTitle(lb.tdName, cosTitleByPlayer.get(p.n) || 0, p.nm || String(p.n), p.n, {
        botArchInfo,
        botArchBadge,
        cosTitleName,
        lang
      });
      lb.tdCells.textContent = `${p.p || 0} • ${p.s || 0}`;
      const pct = mapCells ? ((p.s || 0) / mapCells) * 100 : 0;
      lb.tdPct.textContent = pct.toFixed(1);
    }
  }

  // Signature must be stable and preserve order; Set iteration order can be misleading.
  const sig = pick.map((it) => String(it.p.n)).join(',');
  if (sig === lastLeaderboardSig) {
    // Только обновляем данные/классы — без перестановок DOM и без FLIP.
    return;
  }
  lastLeaderboardSig = sig;

  for (const it of pick) {
    const pid = String(it.p.n);
    const tr = clientState.leaderboardRowsById.get(pid);
    if (!tr) continue;
    leaderboardTbody.appendChild(tr);
  }

  for (const [pid, tr] of clientState.leaderboardRowsById) {
    if (nextIds.has(pid)) continue;
    if (!tr || tr.classList.contains('lb-leave')) {
      clientState.leaderboardRowsById.delete(pid);
      continue;
    }
    tr.classList.remove('lb-enter');
    tr.classList.add('lb-leave');
    setTimeout(() => {
      tr.remove();
    }, 260);
    clientState.leaderboardRowsById.delete(pid);
  }

  const moved = [];
  if (!reduceMotion) {
    for (const pid of nextIds) {
      const tr = clientState.leaderboardRowsById.get(pid);
      if (!tr) continue;
      const firstTop = firstTops.get(pid);
      if (firstTop == null) continue;
      const lastTop = tr.getBoundingClientRect().top;
      const dy = firstTop - lastTop;
      if (!dy) continue;
      tr.style.transition = 'none';
      tr.style.transform = `translateY(${dy}px)`;
      moved.push(tr);
    }

    // Force layout so the browser applies the inverted transforms before we start transitions.
    leaderboardTbody.getBoundingClientRect();
  }

  requestAnimationFrame(() => {
    for (const pid of nextIds) {
      const tr = clientState.leaderboardRowsById.get(pid);
      if (!tr) continue;
      if (tr.classList.contains('lb-enter')) tr.classList.remove('lb-enter');
    }

    if (reduceMotion) return;

    for (const tr of moved) {
      tr.style.transition = '';
      tr.style.transform = '';
    }
  });
}
