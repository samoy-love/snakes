/* J22 — пресеты эффектов: одна ручка на всю «сочность» игры.

   Пресет не хранит собственного состояния — он лежит в settings.fxPreset, а
   здесь только таблица и производные от неё множители. Отдельный маленький
   модуль нужен, чтобы звук (client_sfx.js) и настройки (client_settings.js)
   могли читать множители, не импортируя друг друга.

   prefers-reduced-motion живёт тут же и жёстко обнуляет всё, что двигается:
   тряску, вспышки, hitstop и count-up. Частицы и громкость остаются — они не
   вестибулярные. Раньше эту проверку забывали: fxShakeScale() была
   единственной из пяти функций, которая системный запрет не уважала, то есть
   тряска экрана — ровно то, что reduced-motion выключает, — продолжала
   работать. */

import { settings } from './client_store.js';

const FX_PRESETS = {
  calm: { shake: 0, flash: 0, particles: 0.35, hitstop: 0, countUp: false, volume: 0.6 },
  normal: { shake: 1, flash: 1, particles: 1, hitstop: 1, countUp: true, volume: 1 },
  casino: { shake: 1.45, flash: 1.25, particles: 1.4, hitstop: 1.3, countUp: true, volume: 1.1 }
};

export function prefersReducedMotion() {
  try {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  } catch {}
  return false;
}

export function normalizeFxPreset(v) {
  const s = String(v || '').trim();
  return FX_PRESETS[s] ? s : '';
}

function def() {
  return FX_PRESETS[settings.fxPreset] || FX_PRESETS.normal;
}

/* Множители того, что запрещает reduced-motion. */
export function fxShakeScale() {
  return prefersReducedMotion() ? 0 : Math.max(0, def().shake);
}

export function fxFlashScale() {
  return prefersReducedMotion() ? 0 : Math.max(0, def().flash);
}

export function fxHitstopScale() {
  return prefersReducedMotion() ? 0 : Math.max(0, def().hitstop);
}

export function fxCountUpEnabled() {
  return prefersReducedMotion() ? false : !!def().countUp;
}

/* Множители, которых запрет анимаций не касается. */
export function fxParticleScale() {
  return Math.max(0, def().particles);
}

export function fxVolumeScale() {
  return Math.max(0, def().volume);
}

