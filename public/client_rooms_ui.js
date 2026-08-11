/* DOM-рендер списка комнат в меню. Раньше жил в client.js и читал десяток
   глобалов (roomsListEl, selectedRoomId, t, attemptJoinRoom...) напрямую.
   Здесь то же поведение, но всё внешнее приходит аргументами: контейнер,
   массив комнат и объект колбэков/хелперов. Сортировка и фильтрация — в
   client_rooms.js, сюда не дублируются. */

/** Список комнат. container — узел, куда рисуем; rooms — уже отфильтрованный
    и отсортированный массив (см. client_rooms.js). deps:
      t              — функция перевода
      selectedRoomId — id выбранной сейчас комнаты (или null)
      onSelect(rid)  — вызывается при выборе строки (клик/space/стрелки)
      onJoin(rid)    — вызывается при явном запросе входа (кнопка/dblclick/Enter) */
export function renderRoomsList(container, rooms, deps) {
  if (!container) return;
  const { t, selectedRoomId, onSelect, onJoin } = deps;
  container.textContent = '';
  if (!Array.isArray(rooms) || rooms.length === 0) {
    container.textContent = deps.emptyMessage || t('rooms.empty');
    return;
  }

  const wrap = document.createElement('div');
  wrap.setAttribute('role', 'listbox');
  wrap.setAttribute('aria-label', t('rooms.list_aria'));
  for (const r of rooms) {
    const row = document.createElement('div');
    const rid = r?.id;
    const titleText = String(r?.title || '').trim();
    const humans = Number(r?.humans) || 0;
    const limit = Number(r?.limit) || 0;
    const names = Array.isArray(r?.names) ? r.names : [];
    const nameCount = Number(r?.nameCount) || names.length;
    const namesTruncated = !!r?.namesTruncated;

    const title = document.createElement('div');
    title.className = 'roomRowTitle';
    if (titleText) title.textContent = `${titleText} (#${rid})`;
    else title.textContent = `${t('rooms.room')} ${rid}`;

    const meta = document.createElement('div');
    meta.className = 'roomRowMeta';
    if (humans === 0) {
      meta.classList.add('isEmpty');
      const countSpan = document.createElement('span');
      countSpan.textContent = `${humans}/${limit}`;
      const badge = document.createElement('span');
      badge.className = 'roomEmptyBadge';
      badge.textContent = t('rooms.badge_empty');
      meta.appendChild(countSpan);
      meta.appendChild(badge);
    } else {
      meta.textContent = `${humans}/${limit}`;
    }

    const list = document.createElement('div');
    list.className = 'roomRowSub';
    const hidden = Math.max(0, nameCount - names.length);
    const suffix = (namesTruncated || hidden > 0) && hidden > 0 ? ` (+${hidden})` : '';
    list.textContent = (names.length ? names.join(', ') : '—') + suffix;

    const join = document.createElement('button');
    join.className = 'btnGhost roomRowJoin';
    join.type = 'button';
    join.textContent = t('rooms.join');
    join.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onJoin?.(rid);
    });

    row.classList.add('roomRow');
    row.dataset.rid = String(rid);
    row.setAttribute('role', 'option');
    if (selectedRoomId != null && Number(rid) === Number(selectedRoomId)) {
      row.classList.add('selected');
      row.setAttribute('aria-selected', 'true');
    } else {
      row.setAttribute('aria-selected', 'false');
    }
    row.tabIndex = 0;

    const applySelection = (target) => {
      const parent = target?.parentElement;
      if (parent) {
        for (const el of parent.children) {
          try {
            el.classList.remove('selected');
            el.setAttribute('aria-selected', 'false');
          } catch {}
        }
      }
      try {
        target.classList.add('selected');
        target.setAttribute('aria-selected', 'true');
      } catch {}
      onSelect?.(rid);
    };

    row.addEventListener('click', () => {
      applySelection(row);
    });
    row.addEventListener('dblclick', () => {
      applySelection(row);
      onJoin?.(rid);
    });
    row.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        applySelection(row);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        applySelection(row);
        onJoin?.(rid);
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const parent = row.parentElement;
        if (!parent) return;
        const items = Array.from(parent.children);
        const idx = items.indexOf(row);
        const next = e.key === 'ArrowDown' ? items[idx + 1] : items[idx - 1];
        const nextRid = next?.dataset?.rid;
        if (!next || nextRid == null) return;
        try {
          next.focus();
        } catch {}
        for (const el of items) {
          try {
            el.classList.remove('selected');
            el.setAttribute('aria-selected', 'false');
          } catch {}
        }
        try {
          next.classList.add('selected');
          next.setAttribute('aria-selected', 'true');
        } catch {}
        onSelect?.(Number(nextRid));
      }
    });

    const top = document.createElement('div');
    top.className = 'roomRowTop';
    const left = document.createElement('div');
    left.className = 'roomRowLeft';
    left.appendChild(title);
    left.appendChild(meta);
    top.appendChild(left);
    top.appendChild(join);

    row.appendChild(top);
    row.appendChild(list);
    wrap.appendChild(row);
  }
  container.appendChild(wrap);
}

/** Заглушки для пустого/загрузочного/ошибочного состояния списка. deps:
      t, onRetry, onCreateRoom, onResetSearch — колбэки кнопок (не все
      используются в каждом kind). */
export function renderRoomsEmpty(container, kind, message, deps) {
  if (!container) return;
  const { t, onRetry, onCreateRoom, onResetSearch } = deps;
  container.textContent = '';

  const wrap = document.createElement('div');
  wrap.className = 'roomsEmpty';

  const title = document.createElement('div');
  title.className = 'roomsEmptyTitle';

  const desc = document.createElement('div');
  desc.className = 'roomsEmptyDesc';

  const actions = document.createElement('div');
  actions.className = 'roomsEmptyActions';

  const k = String(kind || 'empty');
  if (k === 'loading') {
    title.textContent = t('rooms.empty_loading_title');
    desc.textContent = t('rooms.empty_loading_desc');
  } else if (k === 'error') {
    title.textContent = t('rooms.empty_error_title');
    desc.textContent = String(message || t('rooms.empty_error_desc'));
    const retry = document.createElement('button');
    retry.className = 'btnGhost';
    retry.textContent = t('rooms.retry');
    retry.addEventListener('click', () => onRetry?.());
    const create = document.createElement('button');
    create.className = 'btnPrimary';
    create.textContent = t('rooms.create_room');
    create.addEventListener('click', () => onCreateRoom?.());
    actions.appendChild(retry);
    actions.appendChild(create);
  } else if (k === 'noMatch') {
    title.textContent = t('rooms.empty_no_match_title');
    desc.textContent = t('rooms.empty_no_match_desc');
    const reset = document.createElement('button');
    reset.className = 'btnGhost';
    reset.textContent = t('rooms.reset_search');
    reset.addEventListener('click', () => onResetSearch?.());
    const create = document.createElement('button');
    create.className = 'btnPrimary';
    create.textContent = t('rooms.create_room');
    create.addEventListener('click', () => onCreateRoom?.());
    actions.appendChild(reset);
    actions.appendChild(create);
  } else {
    title.textContent = t('rooms.empty_none_title');
    desc.textContent = t('rooms.empty_none_desc');
    const create = document.createElement('button');
    create.className = 'btnPrimary';
    create.textContent = t('rooms.create_room');
    create.addEventListener('click', () => onCreateRoom?.());
    actions.appendChild(create);
  }

  wrap.appendChild(title);
  wrap.appendChild(desc);
  if (actions.childNodes.length) wrap.appendChild(actions);
  container.appendChild(wrap);
}

/** Счётчик онлайна в шапке меню и служебная строка статистики списка.
    els: { statsEl, onlineEl, badgeEl } — любой может отсутствовать.
    deps: { t, formatNumber, wsStatusSuffix, loading, error } */
export function updateRoomsStats(rawRooms, els, deps) {
  const rooms = Array.isArray(rawRooms) ? rawRooms : [];
  const totalHumans = rooms.reduce((acc, r) => acc + (Number(r?.humans) || 0), 0);
  const { statsEl, onlineEl, badgeEl } = els || {};
  const { t, formatNumber, wsStatusSuffix, loading, error } = deps || {};

  // Счётчик онлайна в шапке меню: самая ценная для конверсии цифра, раньше она
  // была спрятана в служебную строку внутри свёрнутой панели комнат.
  try {
    if (onlineEl) onlineEl.textContent = formatNumber(totalHumans);
    // K7: в поле `humans` сервер считает только людей, поэтому в пустой момент
    // бейдж честно писал «0 сейчас играют» — при 13 живых ботах на карте это
    // худшая из возможных первых цифр. Ботов в списке комнат нет, посчитать их
    // клиент не может, поэтому нулевой бейдж просто прячем.
    if (badgeEl) badgeEl.classList.toggle('hidden', !(totalHumans > 0));
  } catch {}

  if (!statsEl) return;
  const status = loading ? ` • ${t('rooms.loading')}` : error ? ` • ${error}` : '';
  statsEl.textContent = `${t('rooms.stats_prefix')}: ${formatNumber(rooms.length)} • ${t('rooms.stats_online')}: ${formatNumber(totalHumans)}${wsStatusSuffix()}${status}`;
}
