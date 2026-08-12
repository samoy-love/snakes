/* Настройки: оверлей, сохранение, HUD-параметры, тактильный отклик.

   Раньше модуль не владел ничем: значения жили в client.js плоскими `let`, и
   каждая функция получала их набором геттеров/сеттеров — тридцать пар на
   двенадцать настроек. Половина файла была этой прокачкой, а не логикой:
   ensureSettingsStateImpl() начинался с деструктуризации двадцати шести имён.

   Теперь состояние лежит в settings (client_store.js) и правится напрямую, а
   узлы берутся из dom (client_dom.js). Осталась собственно логика: чтение и
   запись localStorage, синхронизация полей формы и обработчики. */

import { dom } from './client_dom.js';
import { KEYS, storageGet, storageGetJson, storageSet, storageSetJson } from './client_storage.js';
import { settings } from './client_store.js';
import { onLangChange, t } from './client_i18n_rt.js';
import { overlayManager } from './client_util.js';
import { syncOverlayUiState, registerOverlayCloser } from './client_overlays.js';
import { normalizeFxPreset, prefersReducedMotion } from './client_fx_preset.js';
import { playBeep, sfx } from './client_sfx.js';


/* Настройки, которые едут в localStorage как есть, с их диапазонами.
   Раньше этот список был выписан четырежды: в чтении, в записи, в сбросе и в
   синхронизации полей формы — и уже разъезжался (soundMutedByBlur сбрасывался,
   но не сохранялся). Теперь список один, а четыре прохода идут по нему. */
const FIELDS = {
  fxEnabled: { def: true, kind: 'bool', input: () => dom.fxEnabledInput },
  fxIntensity: { def: 0.85, kind: 'range', min: 0, max: 1, input: () => dom.fxIntensityInput },
  shakeIntensity: { def: 0.55, kind: 'range', min: 0, max: 1, input: () => dom.shakeIntensityInput },
  perfEnabled: { def: false, kind: 'bool', input: () => dom.perfEnabledInput },
  perfCompact: { def: false, kind: 'bool', input: () => dom.perfCompactInput },
  soundEnabled: { def: true, kind: 'bool', input: () => dom.soundEnabledInput },
  soundVolume: { def: 0.7, kind: 'range', min: 0, max: 1, input: () => dom.soundVolumeInput },
  muteOnBlur: { def: true, kind: 'bool', input: () => dom.muteOnBlurInput },
  hapticsEnabled: { def: true, kind: 'bool', input: () => dom.hapticsInput },
  hudBrightness: { def: 1, kind: 'range', min: 0.5, max: 2, input: () => dom.hudBrightnessInput },
  hudContrast: { def: 1, kind: 'range', min: 0.5, max: 2, input: () => dom.hudContrastInput },
  hudPanelOpacity: { def: 0.82, kind: 'range', min: 0.3, max: 1, input: () => dom.hudPanelOpacityInput }
};

const clampField = (name, raw) => {
  const f = FIELDS[name];
  if (f.kind === 'bool') return !!raw;
  const v = Number(raw);
  return Math.max(f.min, Math.min(f.max, Number.isFinite(v) ? v : f.def));
};

/* --- Применение к странице -------------------------------------------- */

function applyHudSettings() {
  const b = document.body;
  if (!b) return;
  try {
    b.style.setProperty('--hud-brightness', String(settings.hudBrightness));
    b.style.setProperty('--hud-contrast', String(settings.hudContrast));
    b.style.setProperty('--hud-panel-alpha', String(settings.hudPanelOpacity));
  } catch {}
}

export function applyPerfUi() {
  if (dom.perf) {
    dom.perf.classList.toggle('perfCompact', !!settings.perfCompact);
    dom.perf.style.display = settings.perfEnabled ? '' : 'none';
  }
}

function applyFxPreset(next, fromUser) {
  const v = normalizeFxPreset(next);
  if (!v) return;
  settings.fxPreset = v;
  if (fromUser) settings.fxPresetUserSet = true;
  try {
    document.body.dataset.fxPreset = v;
  } catch {}
  const sel = document.getElementById('fxPresetSelect');
  if (sel) {
    try {
      sel.value = v;
    } catch {}
  }
}

function getHudDensityDefault() {
  const raw = storageGet(KEYS.hudDensity);
  return raw === 'comfy' || raw === 'compact' ? raw : 'comfy';
}

function applyHudDensity(next) {
  const v = String(next || 'comfy');
  if (v !== 'comfy' && v !== 'compact') return;
  settings.hudDensity = v;
  try {
    document.body.dataset.hudDensity = v;
  } catch {}
  storageSet(KEYS.hudDensity, v);
}

/* --- Тактильный отклик -------------------------------------------------
   navigator.vibrate есть только на части устройств (Android/Chrome), и на
   десктопе он бессмысленен. Строку настройки показываем лишь там, где API
   реально существует, — иначе игрок щёлкает выключателем в пустоту. */
function hapticsSupported() {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
    /* Desktop Chrome объявляет vibrate и молча ничего не делает — по одному
       наличию метода строка настройки вылезала бы на десктопе. Требуем ещё и
       признак тач-устройства. */
    const coarse = !!window.matchMedia?.('(pointer: coarse)')?.matches;
    return coarse && Number(navigator.maxTouchPoints) > 0;
  } catch {
    return false;
  }
}

export function vibrate(pattern) {
  if (!settings.hapticsEnabled) return;
  if (prefersReducedMotion()) return;
  if (!hapticsSupported()) return;
  try {
    navigator.vibrate(pattern);
  } catch {}
}

function syncHapticsRowUi() {
  if (dom.hapticsRow) dom.hapticsRow.classList.toggle('hidden', !hapticsSupported());
}

/* --- Хранилище ---------------------------------------------------------- */

function syncInputs() {
  for (const [name, f] of Object.entries(FIELDS)) {
    const el = f.input();
    if (!el) continue;
    if (f.kind === 'bool') el.checked = !!settings[name];
    else el.value = String(settings[name]);
  }
}

export function saveSettings() {
  const out = { fxPreset: settings.fxPreset, fxPresetUserSet: settings.fxPresetUserSet };
  for (const name of Object.keys(FIELDS)) out[name] = settings[name];
  storageSetJson(KEYS.settings, out);
}

function loadSettings() {
  const s = storageGetJson(KEYS.settings);
  if (!s) return;
  for (const name of Object.keys(FIELDS)) {
    if (s[name] != null) settings[name] = clampField(name, s[name]);
  }
  const p = normalizeFxPreset(s.fxPreset);
  if (p) {
    settings.fxPreset = p;
    settings.fxPresetUserSet = !!s.fxPresetUserSet;
  }
}

function resetSettings() {
  for (const [name, f] of Object.entries(FIELDS)) settings[name] = f.def;
  settings.soundMutedByBlur = false;
  settings.fxPresetUserSet = false;
  applyFxPreset(prefersReducedMotion() ? 'calm' : 'normal', false);
  syncInputs();
  applyPerfUi();
  applyHudSettings();
  saveSettings();
}

/* --- Оверлей ------------------------------------------------------------ */

function showSettingsOverlay() {
  if (dom.settingsOverlay) dom.settingsOverlay.classList.remove('hidden');
  overlayManager.open('settings');
  syncOverlayUiState();
  overlayManager.focusDefault('settings');
}

function hideSettingsOverlay() {
  if (dom.settingsOverlay) dom.settingsOverlay.classList.add('hidden');
  overlayManager.close('settings');
  syncOverlayUiState();
}

/* J22: тумблер пресета. Разметки под него нет — создаём поле сами, чтобы
   настройка была доступна. Пересобирается на смену языка. */
function ensureFxPresetControl() {
  let sel = document.getElementById('fxPresetSelect');
  if (!sel) {
    const anchor = dom.fxEnabledInput?.closest?.('.fieldInline') || null;
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
      label.append(span, sel);

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
    if (sel.options?.length !== opts.length) sel.replaceChildren();
    for (let i = 0; i < opts.length; i++) {
      let op = sel.options?.[i];
      if (!op) {
        op = document.createElement('option');
        sel.appendChild(op);
      }
      op.value = opts[i][0];
      op.textContent = opts[i][1];
    }
    sel.value = settings.fxPreset;
  } catch {}
  return sel;
}

/* --- Инициализация ------------------------------------------------------ */

export function initSettings() {
  loadSettings();

  // J22: без явного выбора игрока уважаем системный запрет анимаций.
  if (!settings.fxPresetUserSet && prefersReducedMotion()) settings.fxPreset = 'calm';
  applyFxPreset(settings.fxPreset, false);

  syncInputs();
  syncHapticsRowUi();
  applyPerfUi();
  applyHudSettings();
  applyHudDensity(getHudDensityDefault());

  const fxPresetSelect = ensureFxPresetControl();
  fxPresetSelect?.addEventListener('change', () => {
    applyFxPreset(fxPresetSelect.value, true);
    saveSettings();
    sfx.ui();
  });
  onLangChange(ensureFxPresetControl);

  registerOverlayCloser('settings', hideSettingsOverlay);
  dom.settingsBtn?.addEventListener('click', showSettingsOverlay);
  dom.closeSettingsBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    hideSettingsOverlay();
  });
  dom.settingsOverlay?.addEventListener('click', (e) => {
    if (e.target === dom.settingsOverlay) hideSettingsOverlay();
  });

  /* Один обработчик на поле вместо двенадцати почти одинаковых блоков.
     after — то немногое, что действительно различается: перерисовать HUD,
     показать панель производительности, дать отклик на сам переключатель. */
  const bind = (name, after) => {
    const el = FIELDS[name].input();
    if (!el) return;
    const isBool = FIELDS[name].kind === 'bool';
    el.addEventListener(isBool ? 'change' : 'input', () => {
      settings[name] = clampField(name, isBool ? el.checked : el.value);
      after?.();
      saveSettings();
    });
  };

  bind('fxEnabled');
  bind('fxIntensity');
  bind('shakeIntensity');
  bind('perfEnabled', applyPerfUi);
  bind('perfCompact', applyPerfUi);
  bind('soundEnabled');
  bind('soundVolume');
  bind('muteOnBlur', () => {
    if (!settings.muteOnBlur) settings.soundMutedByBlur = false;
  });
  // Отклик на сам переключатель: игрок сразу чувствует, что именно включил.
  bind('hapticsEnabled', () => {
    if (settings.hapticsEnabled) vibrate(30);
  });
  bind('hudBrightness', applyHudSettings);
  bind('hudContrast', applyHudSettings);
  bind('hudPanelOpacity', applyHudSettings);

  dom.testBeepBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    playBeep(660, 120, 1);
  });
  dom.resetSettingsBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    resetSettings();
  });

  window.addEventListener('blur', () => {
    if (settings.muteOnBlur) settings.soundMutedByBlur = true;
  });
  window.addEventListener('focus', () => {
    settings.soundMutedByBlur = false;
  });
}
