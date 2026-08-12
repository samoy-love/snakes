/* Сиюминутные эффекты: тряска, hitstop, вспышки, баннеры, комбо, count-up.
 *
 * Раньше всё это жило в client.js тонкими обёртками вокруг client_fx_ui.js:
 * обёртка нужна была только чтобы собрать deps из локальных переменных.
 * Теперь состояние берётся из fxRt/settings/session/me/world в client_store.js
 * по ссылке, пресеты — из client_fx_preset.js, поэтому deps-объект не нужен.
 *
 * Наружу модуль зовёт только trackEvent() — он остался в client.js вместе с
 * остальной локальной аналитикой, поэтому приходит через initFxRt(). */

import { createFxModule } from './client_fx.js';
import { KEYS, storageGet, storageSetFlag } from './client_storage.js';
import {
  addShakeClassImpl,
  addShakeImpl,
  comboBreakImpl,
  comboBumpImpl,
  comboResetImpl,
  fxFlashScreenImpl,
  HITSTOP_TIME_SCALE,
  renderComboHudImpl,
  showBigBannerImpl,
  triggerHitstopImpl
} from './client_fx_ui.js';
import {
  fxBannerEnabled,
  fxCountUpEnabled,
  fxFlashScale,
  fxHitstopScale,
  fxShakeScale
} from './client_fx_preset.js';
import { fxRt, me, session, settings, world } from './client_store.js';
import { addToast } from './client_toasts.js';
import { sfx } from './client_sfx.js';
import { t } from './client_i18n_rt.js';
import { fmtInt } from './client_labels.js';
import { easeOutCubic } from './client_util.js';

export { HITSTOP_TIME_SCALE };

/* Локальный счётчик событий из client.js — единственная связь наружу. */
let trackEvent = () => {};

export function initFxRt(ctx) {
  if (typeof ctx?.trackEvent === 'function') trackEvent = ctx.trackEvent;
}

export const fx = createFxModule();

export function addFxBurst(x, y, kind, extra) {
  fx.addFxBurst(x, y, kind, () => ({ fxEnabled: settings.fxEnabled, fxBursts: fxRt.bursts, shakeIntensity: settings.shakeIntensity, addShakeVel }), extra);
}

function addShake(amount, dirX, dirY) {
  addShakeImpl(amount, dirX, dirY, { fx, shakeIntensity: settings.shakeIntensity, addShakeVel });
}

function addShakeVel(dx, dy) {
  fxRt.shakeVelX += dx;
  fxRt.shakeVelY += dy;
}

/* ==========================================================================
 * J12 — hitstop
 *
 * На джекпот-события интерполяция игроков идёт с множителем 0.15 в течение
 * 90-140 мс. Эффекты (вспышки, бурсты, тосты) живут по реальному времени —
 * замедляется только движение змеек, поэтому удар «звенит», а не тормозит UI.
 * В пресете «Спокойно» hitstop равен 0 и весь механизм выключен.
 * ======================================================================== */

// { from, until } — общее состояние с triggerHitstopImpl() в client_fx_ui.js
// (передаётся туда по ссылке, обе стороны читают/пишут одни и те же поля).

export function triggerHitstop(ms) {
  triggerHitstopImpl(ms, { fxHitstopScale, hitstopState: fxRt.hitstop });
}

// Сколько «съел» hitstop из окна [since, now]. Вычитается из времени
// интерполяции, поэтому змейки в эти миллисекунды почти стоят.
export function hitstopLostMs(since, now) {
  if (!fxRt.hitstop.until) return 0;
  const s = Math.max(fxRt.hitstop.from, Number(since) || 0);
  const e = Math.min(now, fxRt.hitstop.until);
  if (e <= s) return 0;
  return (e - s) * (1 - HITSTOP_TIME_SCALE);
}

/* ==========================================================================
 * J6 — count-up чисел
 * ======================================================================== */

const numberAnims = new WeakMap();

function cancelNumberAnim(el) {
  const prev = numberAnims.get(el);
  if (!prev) return;
  try {
    if (prev.raf) cancelAnimationFrame(prev.raf);
  } catch {}
  try {
    if (prev.to) clearTimeout(prev.to);
  } catch {}
  numberAnims.delete(el);
  try {
    el.classList.remove('counting');
  } catch {}
}

// animateNumber(el, from, to, ms, { delay, prefix, suffix, format, onDone })
export function animateNumber(el, from, to, ms, opts) {
  if (!el) return;
  const o = opts || {};
  const fmt = typeof o.format === 'function' ? o.format : (v) => fmtInt(v);
  const pre = String(o.prefix ?? '');
  const suf = String(o.suffix ?? '');
  const a = Number(from) || 0;
  const b = Number(to) || 0;
  const dur = Math.max(0, Number(ms) || 0);
  const delay = Math.max(0, Number(o.delay) || 0);

  cancelNumberAnim(el);

  const write = (v) => {
    try {
      el.textContent = `${pre}${fmt(v)}${suf}`;
    } catch {}
  };

  const finish = () => {
    write(b);
    try {
      el.classList.remove('counting');
    } catch {}
    numberAnims.delete(el);
    try {
      o.onDone?.();
    } catch {}
  };

  const wide = Math.abs(b - a) > 5;
  const animated = dur > 0 && wide && fxCountUpEnabled();

  if (!animated) {
    if (delay > 0) {
      numberAnims.set(el, { raf: 0, to: setTimeout(finish, delay) });
    } else {
      finish();
    }
    return;
  }

  write(a);

  const start = () => {
    const rec = numberAnims.get(el) || { raf: 0, to: 0 };
    rec.to = 0;
    try {
      el.classList.add('counting');
    } catch {}
    const t0 = performance.now();
    const step = () => {
      const p = dur > 0 ? (performance.now() - t0) / dur : 1;
      if (p >= 1) {
        finish();
        return;
      }
      write(a + (b - a) * easeOutCubic(p));
      rec.raf = requestAnimationFrame(step);
      numberAnims.set(el, rec);
    };
    rec.raf = requestAnimationFrame(step);
    numberAnims.set(el, rec);
  };

  if (delay > 0) {
    numberAnims.set(el, { raf: 0, to: setTimeout(start, delay) });
  } else {
    start();
  }
}

/* ==========================================================================
 * J9 — полноэкранная вспышка (#fxFlash)
 * ======================================================================== */

export function fxFlashScreen(rgb, strength) {
  fxFlashScreenImpl(rgb, strength, { fxEnabled: settings.fxEnabled, fxFlashScale });
}

/* ==========================================================================
 * J13 — центральный баннер крупных событий (#bigBanner)
 * ======================================================================== */

// Возвращает true, если баннер показан. Иначе вызывающий откатывается на тост.
export function showBigBanner(icon, title, sub, mod) {
  return showBigBannerImpl(icon, title, sub, mod, { fxBannerEnabled });
}

/* ==========================================================================
 * J14 — классы тряски
 * ======================================================================== */

export function addShakeClass(kind, dirX, dirY) {
  addShakeClassImpl(kind, dirX, dirY, { fxShakeScale, fx, shakeIntensity: settings.shakeIntensity, addShakeVel });
}

// Вектор «от точки события к моей голове» — толчок в сторону игрока.
export function shakeDirFrom(ex, ey) {
  const my = world.currPlayers?.get?.(session.you);
  if (!my) return [0, 0];
  const dx = (Number(my.x) || 0) - (Number(ex) || 0);
  const dy = (Number(my.y) || 0) - (Number(ey) || 0);
  if (!dx && !dy) return [0, 0];
  return [dx, dy];
}

/* ==========================================================================
 * J5 — всплывающие числа над точкой захвата
 * ======================================================================== */

export const SCORE_POPUP_MS = 900;
export const CAPTURE_JACKPOT_CELLS = 250;

/* F14 — первый захват в жизни игрока празднуется отдельно. */
export const FIRST_CAPTURE_KEY = 'snakes_first_capture_v1';

export function hasFirstCapture() {
  /* Ключа нет — значит захвата ещё не было, празднуем. Хранилище недоступно —
     считаем, что уже праздновали: иначе игрок с выключенным localStorage
     увидит «первый захват» в каждом матче. */
  return storageGet(KEYS.firstCapture, '1') === '1';
}

export function celebrateFirstCapture(delta) {
  if (hasFirstCapture()) return;
  storageSetFlag(KEYS.firstCapture, true);
  trackEvent('first_capture');
  sfx.firstCapture();
  fxFlashScreen([170, 255, 210], 1);
  // J12: момент озарения тоже заслуживает hitstop.
  triggerHitstop(120);
  const sub = `+${fmtInt(delta)} · ${t('banner.first_capture_sub')}`;
  if (!showBigBanner('🎉', t('banner.first_capture'), sub, 'jackpot')) {
    addToast('🎉', t('banner.first_capture'), 'big', sub, { key: 'first_capture', prio: 'jackpot' });
  }
}

export function addScorePopup(x, y, value) {
  const v = Math.max(0, Math.round(Number(value) || 0));
  if (!v) return;
  addFxBurst(x, y, 'score', { value: v });
}

/* ==========================================================================
 * J10 — комбо с растущим тоном
 * ======================================================================== */

// Геттеры, а не снимок значений: comboBump() планирует comboBreak() через
// setTimeout, и к моменту срабатывания session.started/me.kills могли измениться —
// нужны актуальные значения на момент вызова, а не те, что были при постановке.
function comboDeps() {
  return { getStarted: () => session.started, getYouKills: () => me.kills, sfx };
}

export function renderComboHud() {
  renderComboHudImpl(comboDeps());
}

export function comboBump() {
  comboBumpImpl(comboDeps());
}

export function comboBreak() {
  comboBreakImpl(comboDeps());
}

export function comboReset() {
  comboResetImpl(comboDeps());
}
