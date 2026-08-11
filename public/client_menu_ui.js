/* Экран главного меню/лендинга: показ оверлея меню, мета-крючок с дейликами
   и прогрессом до первого скина, состояние поля ника. Вынесено из client.js —
   вызовы и порядок выполнения не менялись, только источник импорта. */

/* Открывает оверлей меню и приводит связанное состояние в исходный вид.
   deps.set* — сеттеры для переменных состояния client.js (started, youAlive,
   createRoomPending, lastYouStats, roomsLoadTimeout, roomsLoading, youStreak),
   деп.get* — геттеры для чтения их текущих значений. */
export function showMenuOverlayImpl(deps) {
  const {
    cancelDeathSlowMo,
    menuOverlay,
    deathOverlay,
    overlayManager,
    setStarted,
    setYouAlive,
    updateMenuNameUi,
    syncMenuOnboardingUi,
    setCreateRoomPending,
    updateRoomsCreateUi,
    setLastYouStats,
    getRoomsLoadTimeout,
    setRoomsLoadTimeout,
    getRoomsLoading,
    getLastRooms,
    setRoomsLoading,
    topHudEl,
    setYouStreak,
    syncOverlayUiState,
    scheduleMenuSkinPreview,
    renderMenuMeta
  } = deps;

  cancelDeathSlowMo();
  if (menuOverlay) menuOverlay.classList.remove('hidden');
  if (deathOverlay) deathOverlay.classList.add('hidden');
  overlayManager.close('death');
  overlayManager.open('menu');
  setStarted(false);
  setYouAlive(false);
  try {
    document.body.classList.remove('inGame');
  } catch {}
  updateMenuNameUi();
  syncMenuOnboardingUi();
  setCreateRoomPending(false);
  updateRoomsCreateUi();
  setLastYouStats(null);
  if (getRoomsLoadTimeout()) {
    clearTimeout(getRoomsLoadTimeout());
    setRoomsLoadTimeout(0);
  }
  if (getRoomsLoading() && (!Array.isArray(getLastRooms()) || getLastRooms().length === 0)) {
    setRoomsLoading(false);
  }
  overlayManager.focusDefault('menu');
  if (topHudEl) topHudEl.setAttribute('aria-hidden', 'true');
  setYouStreak(0);
  syncOverlayUiState();
  // C3: панель «Ваш облик» — рисуем сразу, как только меню показано.
  scheduleMenuSkinPreview();
  renderMenuMeta();
}

/* Мета-крючок на экране меню: активные дейлики и прогресс до первого скина.
   Блок пустой (и скрыт CSS-ом), пока сервер не прислал ни задач, ни баланса —
   на первом экране новичка он ничего не должен обещать. */
export function renderMenuMetaImpl(deps) {
  const {
    menuMetaEl,
    menuOverlay,
    dailySlots,
    youDailies,
    dailyLabel,
    escapeHtml,
    t,
    fmtInt,
    COSMETICS_CATS,
    cosmeticsOwnedCount,
    cosmeticsCheapestPrice,
    missingFor,
    getYouStyle,
    setSafeHtml
  } = deps;

  if (!menuMetaEl) return;
  if (menuOverlay?.classList.contains('hidden')) return;

  const rows = [];

  for (const slot of dailySlots()) {
    const it = youDailies.get(slot);
    if (!it || !it.type || it.goal <= 0) continue;
    const prog = Math.max(0, Math.min(it.goal, Number(it.prog) || 0));
    const done = prog >= it.goal;
    const pct = (prog / it.goal) * 100;
    rows.push(`
      <div class="menuMetaRow${done ? ' isDone' : ''}" title="${escapeHtml(t('meta.tasks_hint'))}">
        <span class="menuMetaIcon" aria-hidden="true">${done ? '🏁' : '📅'}</span>
        <span class="menuMetaText">${escapeHtml(dailyLabel(it.type))}</span>
        <span class="menuMetaValue">${fmtInt(prog)}/${fmtInt(it.goal)}</span>
        <span class="menuMetaBar"><span class="menuMetaBarFill" style="width:${pct.toFixed(1)}%"></span></span>
      </div>`);
  }

  // Прогресс до первого скина — только пока он действительно первый.
  let ownedExtra = 0;
  for (const cat of COSMETICS_CATS) ownedExtra += Math.max(0, cosmeticsOwnedCount(cat) - 1);
  const price = cosmeticsCheapestPrice();
  if (ownedExtra === 0 && price > 0) {
    const have = Math.max(0, Math.floor(Number(getYouStyle()) || 0));
    const left = missingFor(price, have);
    const pct = Math.max(0, Math.min(100, (have / price) * 100));
    rows.push(`
      <div class="menuMetaRow${left === 0 ? ' isDone' : ''}">
        <span class="menuMetaIcon" aria-hidden="true">✨</span>
        <span class="menuMetaText">${escapeHtml(t('match.first_skin'))}</span>
        <span class="menuMetaValue">${left > 0 ? `${fmtInt(have)}/${fmtInt(price)}` : escapeHtml(t('cosmetics.buy'))}</span>
        <span class="menuMetaBar"><span class="menuMetaBarFill" style="width:${pct.toFixed(1)}%"></span></span>
      </div>`);
  }

  setSafeHtml(menuMetaEl, rows.join(''));
}

/* Валидация поля ника на экране меню: блокирует «Играть» только при реально
   некорректном вводе, но не при пустом поле (пустой ник подставляется сам). */
export function updateMenuNameUiImpl(deps) {
  const { menuNameInput, normalizeMenuNickInput, playBtn, menuNameError, t } = deps;

  if (!menuNameInput) return;
  const v = normalizeMenuNickInput(menuNameInput.value);
  // Пустое поле — не ошибка: при старте ник подставляется автоматически.
  // Иначе новый игрок видит красную ошибку и заблокированный «Играть» ещё
  // до того, как что-либо сделал.
  const empty = !v.raw;
  let errKey = '';
  if (!empty) {
    if (v.hasBadChars) errKey = 'menu.nick_error_chars';
    else if (!v.value) errKey = 'menu.nick_error_required';
    else if (v.value.length < 2) errKey = 'menu.nick_error_length';
  }

  const ok = !errKey;
  // «Играть» блокируется только при реально некорректном вводе, но не пустым полем.
  if (playBtn) playBtn.disabled = !ok;
  try {
    menuNameInput.setAttribute('aria-invalid', ok ? 'false' : 'true');
  } catch {}
  if (menuNameError) menuNameError.textContent = ok ? '' : t(errKey);
}
