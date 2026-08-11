/* Настройки (оверлей, HUD-параметры, FX-пресеты). Вынесено из client.js —
   вызовы и порядок выполнения не менялись, только источник импорта. Как и
   client_shop_ui.js/client_hud.js, функции принимают deps — геттеры/сеттеры
   для переменных состояния client.js и ссылки на DOM/хелперы. */

export function applyHudSettingsImpl(deps) {
  const { getHudBrightness, getHudContrast, getHudPanelOpacity } = deps;
  const b = document.body;
  if (!b) return;
  try {
    b.style.setProperty('--hud-brightness', String(getHudBrightness()));
    b.style.setProperty('--hud-contrast', String(getHudContrast()));
    b.style.setProperty('--hud-panel-alpha', String(getHudPanelOpacity()));
  } catch {}
}

export function applyFxPresetImpl(next, fromUser, deps) {
  const { normalizeFxPreset, setFxPreset, setFxPresetUserSet, getFxPreset } = deps;
  const v = normalizeFxPreset(next);
  if (!v) return;
  setFxPreset(v);
  if (fromUser) setFxPresetUserSet(true);
  try {
    document.body.dataset.fxPreset = getFxPreset();
  } catch {}
  const sel = document.getElementById('fxPresetSelect');
  if (sel) {
    try {
      sel.value = getFxPreset();
    } catch {}
  }
}

function syncSettingsInputsUi(deps) {
  const {
    fxEnabledInput,
    fxIntensityInput,
    shakeIntensityInput,
    perfEnabledInput,
    perfCompactInput,
    soundEnabledInput,
    soundVolumeInput,
    muteOnBlurInput,
    hapticsInput,
    hudBrightnessInput,
    hudContrastInput,
    hudPanelOpacityInput,
    getFxEnabled,
    getFxIntensity,
    getShakeIntensity,
    getPerfEnabled,
    getPerfCompact,
    getSoundEnabled,
    getSoundVolume,
    getMuteOnBlur,
    getHapticsEnabled,
    getHudBrightness,
    getHudContrast,
    getHudPanelOpacity
  } = deps;

  if (fxEnabledInput) fxEnabledInput.checked = !!getFxEnabled();
  if (fxIntensityInput) fxIntensityInput.value = String(getFxIntensity());
  if (shakeIntensityInput) shakeIntensityInput.value = String(getShakeIntensity());
  if (perfEnabledInput) perfEnabledInput.checked = !!getPerfEnabled();
  if (perfCompactInput) perfCompactInput.checked = !!getPerfCompact();
  if (soundEnabledInput) soundEnabledInput.checked = !!getSoundEnabled();
  if (soundVolumeInput) soundVolumeInput.value = String(getSoundVolume());
  if (muteOnBlurInput) muteOnBlurInput.checked = !!getMuteOnBlur();
  if (hapticsInput) hapticsInput.checked = !!getHapticsEnabled();
  if (hudBrightnessInput) hudBrightnessInput.value = String(getHudBrightness());
  if (hudContrastInput) hudContrastInput.value = String(getHudContrast());
  if (hudPanelOpacityInput) hudPanelOpacityInput.value = String(getHudPanelOpacity());
}

export function ensureSettingsStateImpl(deps) {
  const {
    setFxEnabled,
    setFxIntensity,
    setShakeIntensity,
    setPerfEnabled,
    setPerfCompact,
    setSoundEnabled,
    setSoundVolume,
    setMuteOnBlur,
    setHapticsEnabled,
    setHudBrightness,
    setHudContrast,
    setHudPanelOpacity,
    getFxEnabled,
    getFxIntensity,
    getShakeIntensity,
    getPerfEnabled,
    getPerfCompact,
    getSoundEnabled,
    getSoundVolume,
    getMuteOnBlur,
    getHapticsEnabled,
    getHudBrightness,
    getHudContrast,
    getHudPanelOpacity,
    setFxPreset,
    getFxPreset,
    setFxPresetUserSet,
    getFxPresetUserSet,
    normalizeFxPreset,
    prefersReducedMotion,
    applyFxPreset,
    applyHudSettings,
    applyPerfUi,
    applyHudDensity,
    getHudDensityDefault,
    syncHapticsRowUi,
    perfEl
  } = deps;

  try {
    const raw = localStorage.getItem('snakes_settings_v1');
    if (raw) {
      const s = JSON.parse(raw);
      if (s.fxEnabled != null) setFxEnabled(s.fxEnabled);
      if (s.fxIntensity != null) setFxIntensity(s.fxIntensity);
      if (s.shakeIntensity != null) setShakeIntensity(s.shakeIntensity);
      if (s.perfEnabled != null) setPerfEnabled(s.perfEnabled);
      if (s.perfCompact != null) setPerfCompact(s.perfCompact);
      if (s.soundEnabled != null) setSoundEnabled(s.soundEnabled);
      if (s.soundVolume != null) setSoundVolume(s.soundVolume);
      if (s.muteOnBlur != null) setMuteOnBlur(s.muteOnBlur);
      if (s.hapticsEnabled != null) setHapticsEnabled(s.hapticsEnabled);
      if (s.hudBrightness != null) setHudBrightness(s.hudBrightness);
      if (s.hudContrast != null) setHudContrast(s.hudContrast);
      if (s.hudPanelOpacity != null) setHudPanelOpacity(s.hudPanelOpacity);
      const p = normalizeFxPreset(s.fxPreset);
      if (p) {
        setFxPreset(p);
        setFxPresetUserSet(!!s.fxPresetUserSet);
      }
    }
  } catch {}

  // J22: без явного выбора пользователя уважаем системный запрет анимаций.
  if (!getFxPresetUserSet() && prefersReducedMotion()) setFxPreset('calm');
  applyFxPreset(getFxPreset(), false);

  syncSettingsInputsUi(deps);

  syncHapticsRowUi();

  if (perfEl) perfEl.style.display = getPerfEnabled() ? '' : 'none';
  applyPerfUi();
  applyHudSettings();

  applyHudDensity(getHudDensityDefault());
}

export function saveSettingsStateImpl(deps) {
  const {
    getFxEnabled,
    getFxIntensity,
    getShakeIntensity,
    getPerfEnabled,
    getPerfCompact,
    getSoundEnabled,
    getSoundVolume,
    getMuteOnBlur,
    getHapticsEnabled,
    getHudBrightness,
    getHudContrast,
    getHudPanelOpacity,
    getFxPreset,
    getFxPresetUserSet
  } = deps;
  try {
    localStorage.setItem(
      'snakes_settings_v1',
      JSON.stringify({
        fxEnabled: getFxEnabled(),
        fxIntensity: getFxIntensity(),
        shakeIntensity: getShakeIntensity(),
        perfEnabled: getPerfEnabled(),
        perfCompact: getPerfCompact(),
        soundEnabled: getSoundEnabled(),
        soundVolume: getSoundVolume(),
        muteOnBlur: getMuteOnBlur(),
        hapticsEnabled: getHapticsEnabled(),
        hudBrightness: getHudBrightness(),
        hudContrast: getHudContrast(),
        hudPanelOpacity: getHudPanelOpacity(),
        fxPreset: getFxPreset(),
        fxPresetUserSet: getFxPresetUserSet()
      })
    );
  } catch {}
}

export function resetSettingsStateImpl(deps) {
  const {
    setFxEnabled,
    setFxIntensity,
    setShakeIntensity,
    setPerfEnabled,
    setPerfCompact,
    setSoundEnabled,
    setSoundVolume,
    setMuteOnBlur,
    setHapticsEnabled,
    setHudBrightness,
    setHudContrast,
    setHudPanelOpacity,
    setSoundMutedByBlur,
    setFxPresetUserSet,
    getPerfEnabled,
    prefersReducedMotion,
    applyFxPreset,
    applyPerfUi,
    applyHudSettings,
    saveSettingsState,
    perfEl
  } = deps;

  setFxEnabled(true);
  setFxIntensity(0.85);
  setShakeIntensity(0.55);
  setPerfEnabled(false);
  setPerfCompact(false);
  setSoundEnabled(true);
  setSoundVolume(0.7);
  setMuteOnBlur(true);
  setHapticsEnabled(true);
  setHudBrightness(1);
  setHudContrast(1);
  setHudPanelOpacity(0.82);
  setSoundMutedByBlur(false);
  setFxPresetUserSet(false);
  applyFxPreset(prefersReducedMotion() ? 'calm' : 'normal', false);

  syncSettingsInputsUi(deps);

  if (perfEl) perfEl.style.display = getPerfEnabled() ? '' : 'none';
  applyPerfUi();
  applyHudSettings();
  saveSettingsState();
}

export function showSettingsOverlayImpl(deps) {
  const { settingsOverlay, overlayManager, syncOverlayUiState } = deps;
  if (settingsOverlay) settingsOverlay.classList.remove('hidden');
  overlayManager.open('settings');
  syncOverlayUiState();
  overlayManager.focusDefault('settings');
}

export function hideSettingsOverlayImpl(deps) {
  const { settingsOverlay, overlayManager, syncOverlayUiState } = deps;
  if (settingsOverlay) settingsOverlay.classList.add('hidden');
  overlayManager.close('settings');
  syncOverlayUiState();
}

// J22: тумблер пресета. Разметку добавляет вёрсточный агент (#fxPresetSelect);
// пока её нет — создаём поле сами, чтобы настройка была доступна.
export function ensureFxPresetControlImpl(deps) {
  const { fxEnabledInput, t, getFxPreset } = deps;
  let sel = document.getElementById('fxPresetSelect');
  if (!sel) {
    const anchor = fxEnabledInput?.closest?.('.fieldInline') || null;
    const host = anchor?.parentElement || null;
    if (!host) return null;
    try {
      const label = document.createElement('label');
      label.className = 'fieldInline';
      const span = document.createElement('span');
      span.className = 'fieldLabel';
      span.setAttribute('data-i18n', 'settings.fx_preset');
      span.textContent = t('settings.fx_preset');
      sel = document.createElement('select');
      sel.id = 'fxPresetSelect';
      label.appendChild(span);
      label.appendChild(sel);

      const hint = document.createElement('div');
      hint.className = 'fieldHint';
      hint.setAttribute('data-i18n', 'settings.fx_preset_hint');
      hint.textContent = t('settings.fx_preset_hint');

      host.insertBefore(label, anchor);
      host.insertBefore(hint, anchor);
    } catch {
      return null;
    }
  }

  try {
    const opts = [
      ['calm', t('settings.fx_preset_calm')],
      ['normal', t('settings.fx_preset_normal')],
      ['casino', t('settings.fx_preset_casino')]
    ];
    const need = sel.options?.length !== opts.length;
    if (need) sel.replaceChildren();
    for (let i = 0; i < opts.length; i++) {
      let op = sel.options?.[i];
      if (!op) {
        op = document.createElement('option');
        sel.appendChild(op);
      }
      op.value = opts[i][0];
      op.textContent = opts[i][1];
    }
    sel.value = getFxPreset();
  } catch {}
  return sel;
}

export function bindSettingsUiImpl(deps) {
  const {
    ensureSettingsState,
    applyFxPreset,
    saveSettingsState,
    sfx,
    settingsBtn,
    closeSettingsBtn,
    settingsOverlay,
    showSettingsOverlay,
    hideSettingsOverlay,
    fxEnabledInput,
    fxIntensityInput,
    shakeIntensityInput,
    perfEnabledInput,
    perfCompactInput,
    soundEnabledInput,
    soundVolumeInput,
    muteOnBlurInput,
    hapticsInput,
    hudBrightnessInput,
    hudContrastInput,
    hudPanelOpacityInput,
    testBeepBtn,
    resetSettingsBtn,
    setFxEnabled,
    setFxIntensity,
    setShakeIntensity,
    setPerfEnabled,
    setPerfCompact,
    setSoundEnabled,
    setSoundVolume,
    setMuteOnBlur,
    setSoundMutedByBlur,
    setHapticsEnabled,
    setHudBrightness,
    setHudContrast,
    setHudPanelOpacity,
    getPerfEnabled,
    getMuteOnBlur,
    perfEl,
    applyPerfUi,
    applyHudSettings,
    playBeep,
    resetSettingsState,
    vibrate
  } = deps;

  ensureSettingsState();

  const fxPresetSelect = ensureFxPresetControlImpl(deps);
  fxPresetSelect?.addEventListener('change', () => {
    applyFxPreset(fxPresetSelect.value, true);
    saveSettingsState();
    sfx.ui();
  });

  settingsBtn?.addEventListener('click', () => {
    showSettingsOverlay();
  });
  closeSettingsBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    hideSettingsOverlay();
  });

  settingsOverlay?.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) {
      hideSettingsOverlay();
    }
  });

  fxEnabledInput?.addEventListener('change', () => {
    setFxEnabled(!!fxEnabledInput.checked);
    saveSettingsState();
  });
  fxIntensityInput?.addEventListener('input', () => {
    setFxIntensity(Math.max(0, Math.min(1, Number(fxIntensityInput.value) || 0)));
    saveSettingsState();
  });
  shakeIntensityInput?.addEventListener('input', () => {
    setShakeIntensity(Math.max(0, Math.min(1, Number(shakeIntensityInput.value) || 0)));
    saveSettingsState();
  });
  perfEnabledInput?.addEventListener('change', () => {
    setPerfEnabled(!!perfEnabledInput.checked);
    if (perfEl) perfEl.style.display = getPerfEnabled() ? '' : 'none';
    saveSettingsState();
  });
  perfCompactInput?.addEventListener('change', () => {
    setPerfCompact(!!perfCompactInput.checked);
    applyPerfUi();
    saveSettingsState();
  });
  soundEnabledInput?.addEventListener('change', () => {
    setSoundEnabled(!!soundEnabledInput.checked);
    saveSettingsState();
  });
  soundVolumeInput?.addEventListener('input', () => {
    setSoundVolume(Math.max(0, Math.min(1, Number(soundVolumeInput.value) || 0)));
    saveSettingsState();
  });

  muteOnBlurInput?.addEventListener('change', () => {
    setMuteOnBlur(!!muteOnBlurInput.checked);
    if (!muteOnBlurInput.checked) setSoundMutedByBlur(false);
    saveSettingsState();
  });

  hapticsInput?.addEventListener('change', () => {
    setHapticsEnabled(!!hapticsInput.checked);
    saveSettingsState();
    // Отклик на сам переключатель: игрок сразу чувствует, что именно включил.
    if (hapticsInput.checked) vibrate(30);
  });

  hudBrightnessInput?.addEventListener('input', () => {
    setHudBrightness(Math.max(0.5, Math.min(2, Number(hudBrightnessInput.value) || 1)));
    applyHudSettings();
    saveSettingsState();
  });
  hudContrastInput?.addEventListener('input', () => {
    setHudContrast(Math.max(0.5, Math.min(2, Number(hudContrastInput.value) || 1)));
    applyHudSettings();
    saveSettingsState();
  });
  hudPanelOpacityInput?.addEventListener('input', () => {
    setHudPanelOpacity(Math.max(0.3, Math.min(1, Number(hudPanelOpacityInput.value) || 0.82)));
    applyHudSettings();
    saveSettingsState();
  });

  testBeepBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    playBeep(660, 120, 1);
  });

  resetSettingsBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    resetSettingsState();
  });

  window.addEventListener('blur', () => {
    if (!getMuteOnBlur()) return;
    setSoundMutedByBlur(true);
  });
  window.addEventListener('focus', () => {
    setSoundMutedByBlur(false);
  });
}
