/* Тосты/баннеры/FX-вспышки/hitstop/комбо-HUD/лента событий — вынесено из
   client.js. Вызовы и порядок выполнения не менялись, только источник
   импорта. Как и client_hud.js/client_shop_ui.js, функции принимают deps —
   геттеры/колбэки для переменных состояния и DOM/хелперов client.js. Это не
   меняет, КОГДА что вызывается, только ОТКУДА берётся код функции. */

/* ==========================================================================
 * J9 — полноэкранная вспышка (#fxFlash)
 * ======================================================================== */

const FX_FLASH_MIN_INTERVAL_MS = 400; // не чаще 2.5 Гц
const FX_FLASH_PEAK_ALPHA = 0.35;
const FX_FLASH_DUR_MS = 280;
const FX_FLASH_RISE_MS = 90;

let fxFlashLastAt = 0;
let fxFlashRaf = 0;

function clampByte(v) {
  const n = Math.round(Number(v) || 0);
  return Math.max(0, Math.min(255, n));
}

// Красный канал не должен мигать изолированно: подтягиваем G/B под R.
function safeFlashRgb(rgb) {
  let r = clampByte(rgb?.[0]);
  let g = clampByte(rgb?.[1]);
  let b = clampByte(rgb?.[2]);
  const floor = Math.round(r * 0.45);
  if (g < floor) g = floor;
  if (b < floor) b = floor;
  return [r, g, b];
}

// deps: { fxEnabled, fxFlashScale }
export function fxFlashScreenImpl(rgb, strength, deps) {
  const { fxEnabled, fxFlashScale } = deps;
  if (!fxEnabled) return;
  const scale = fxFlashScale();
  if (scale <= 0) return;
  const el = document.getElementById('fxFlash');
  if (!el) return;

  const now = performance.now();
  if (now - fxFlashLastAt < FX_FLASH_MIN_INTERVAL_MS) return;
  fxFlashLastAt = now;

  const [r, g, b] = safeFlashRgb(rgb);
  const s = Math.max(0, Math.min(1, Number(strength ?? 1)));
  const peak = Math.min(FX_FLASH_PEAK_ALPHA, FX_FLASH_PEAK_ALPHA * s * scale);
  if (peak <= 0.005) return;

  try {
    if (fxFlashRaf) cancelAnimationFrame(fxFlashRaf);
  } catch {}
  fxFlashRaf = 0;

  try {
    el.style.transition = 'none';
    el.style.background = `radial-gradient(circle at 50% 50%, rgba(${r},${g},${b},0.90) 0%, rgba(${r},${g},${b},0.42) 42%, rgba(${r},${g},${b},0) 72%)`;
    el.style.opacity = '0';
    el.classList.add('isOn');
  } catch {
    return;
  }

  const t0 = performance.now();
  const step = () => {
    const age = performance.now() - t0;
    if (age >= FX_FLASH_DUR_MS) {
      try {
        el.style.opacity = '0';
        el.classList.remove('isOn');
      } catch {}
      fxFlashRaf = 0;
      return;
    }
    const a =
      age < FX_FLASH_RISE_MS
        ? (age / FX_FLASH_RISE_MS) * peak
        : peak * (1 - (age - FX_FLASH_RISE_MS) / (FX_FLASH_DUR_MS - FX_FLASH_RISE_MS));
    try {
      el.style.opacity = Math.max(0, a).toFixed(3);
    } catch {}
    fxFlashRaf = requestAnimationFrame(step);
  };
  fxFlashRaf = requestAnimationFrame(step);
}

/* ==========================================================================
 * J13 — центральный баннер крупных событий (#bigBanner)
 * ======================================================================== */

const BIG_BANNER_MIN_INTERVAL_MS = 3000;
const BIG_BANNER_TTL_MS = 2600;

let bigBannerLastAt = 0;
let bigBannerTimer = 0;

// Возвращает true, если баннер показан. Иначе вызывающий откатывается на тост.
export function showBigBannerImpl(icon, title, sub, mod) {
  const el = document.getElementById('bigBanner');
  if (!el) return false;

  const now = performance.now();
  if (now - bigBannerLastAt < BIG_BANNER_MIN_INTERVAL_MS) return false;
  bigBannerLastAt = now;

  try {
    if (bigBannerTimer) clearTimeout(bigBannerTimer);
  } catch {}
  bigBannerTimer = 0;

  try {
    el.classList.remove('bannerJackpot', 'bannerDanger');
    const m = String(mod || '');
    if (m === 'jackpot') el.classList.add('bannerJackpot');
    else if (m === 'danger') el.classList.add('bannerDanger');

    const wrap = document.createElement('div');
    wrap.className = 'bigBannerInner';

    const ic = document.createElement('div');
    ic.className = 'bigBannerIcon';
    ic.textContent = String(icon || '★');

    const tt = document.createElement('div');
    tt.className = 'bigBannerTitle';
    tt.textContent = String(title || '');

    wrap.appendChild(ic);
    wrap.appendChild(tt);

    const s = String(sub || '').trim();
    if (s) {
      const se = document.createElement('div');
      se.className = 'bigBannerSub';
      se.textContent = s;
      wrap.appendChild(se);
    }

    el.replaceChildren(wrap);
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    // Перезапуск анимации: снимаем класс, форсируем рефлоу, ставим обратно.
    el.classList.remove('isOn');
    void el.offsetWidth;
    el.classList.add('isOn');
  } catch {
    return false;
  }

  bigBannerTimer = setTimeout(() => {
    bigBannerTimer = 0;
    try {
      el.classList.remove('isOn');
    } catch {}
  }, BIG_BANNER_TTL_MS);
  return true;
}

/* ==========================================================================
 * J14 — классы тряски / J12 — hitstop
 * ======================================================================== */

const SHAKE_CLASSES = { micro: 0.08, small: 0.2, medium: 0.4, large: 0.7 };

// deps: { fx, shakeIntensity, addShakeVel }
export function addShakeImpl(amount, dirX, dirY, deps) {
  const { fx, shakeIntensity, addShakeVel } = deps;
  fx.addShake(amount, () => ({ shakeIntensity, addShakeVel }), dirX, dirY);
}

// deps: { fxShakeScale, fx, shakeIntensity, addShakeVel }
export function addShakeClassImpl(kind, dirX, dirY, deps) {
  const { fxShakeScale } = deps;
  const amt = SHAKE_CLASSES[String(kind || '')] ?? SHAKE_CLASSES.small;
  const scaled = amt * fxShakeScale();
  if (scaled <= 0) return;
  addShakeImpl(scaled, dirX, dirY, deps);
}

const HITSTOP_TIME_SCALE = 0.15;

// deps: { fxHitstopScale, hitstopState } — hitstopState это { from, until },
// общий с hitstopLostMs() в client.js (она осталась там, читает те же поля).
export function triggerHitstopImpl(ms, deps) {
  const { fxHitstopScale, hitstopState } = deps;
  const k = fxHitstopScale();
  if (k <= 0) return;
  const dur = Math.max(0, Number(ms) || 0) * k;
  if (dur <= 0) return;
  const now = performance.now();
  if (now < hitstopState.until) {
    hitstopState.until = Math.max(hitstopState.until, now + dur);
    return;
  }
  hitstopState.from = now;
  hitstopState.until = now + dur;
}

export { HITSTOP_TIME_SCALE };

/* ==========================================================================
 * J10 — комбо с растущим тоном
 * ======================================================================== */

const COMBO_WINDOW_MS = 3000;
let comboCount = 0;
let comboLastAt = 0;
let comboTimer = 0;
let comboHudSig = '';

// deps: { getStarted, getYouKills }
export function renderComboHudImpl(deps) {
  const started = deps.getStarted();
  const youKills = deps.getYouKills();
  const el = document.getElementById('hudCombo');
  if (!el) return;
  // renderTopHud вызывается каждый кадр — пересобираем DOM только при изменении.
  const sig = started ? `${youKills}|${comboCount}` : '';
  if (sig === comboHudSig) return;
  comboHudSig = sig;

  const showCombo = comboCount >= 2;
  if (!started) {
    el.classList.remove('isOn');
    el.replaceChildren();
    return;
  }
  try {
    const kills = document.createElement('span');
    kills.className = 'hudComboKills';
    kills.textContent = `⚔ ${youKills}`;

    el.replaceChildren(kills);

    if (showCombo) {
      const c = document.createElement('span');
      c.className = 'hudComboValue';
      c.textContent = `x${comboCount}`;
      const grow = Math.min(2.0, 1 + (comboCount - 2) * 0.14);
      c.style.fontSize = `${(100 * grow).toFixed(0)}%`;
      el.appendChild(c);
    }
    el.classList.toggle('isOn', showCombo || youKills > 0);
  } catch {}
}

// deps: { getStarted, getYouKills, sfx }
export function comboBumpImpl(deps) {
  const { sfx } = deps;
  const now = performance.now();
  if (now - comboLastAt > COMBO_WINDOW_MS) comboCount = 0;
  comboLastAt = now;
  comboCount++;

  if (comboCount >= 2) {
    /* Наружу уходит НОМЕР ШАГА, а не полутона. Раньше здесь считался подъём
       «+2 полутона за шаг» с потолком в 24: после четырнадцатого звена
       цепочки звук переставал меняться совсем, и рекордная серия матча
       звучала как средняя. Куда шаг девать — высота, плотность, хвост —
       решает палитра (ladder() в client_sfx.js); здесь только счёт. */
    sfx.comboStep(comboCount - 2);
  }
  renderComboHudImpl(deps);

  try {
    if (comboTimer) clearTimeout(comboTimer);
  } catch {}
  comboTimer = setTimeout(() => comboBreakImpl(deps), COMBO_WINDOW_MS + 40);
}

// deps: { getStarted, getYouKills, sfx }
export function comboBreakImpl(deps) {
  const { sfx } = deps;
  comboTimer = 0;
  const had = comboCount;
  comboCount = 0;
  renderComboHudImpl(deps);
  // Падение начинается с той ступени, на которой цепочка оборвалась.
  if (had >= 2) sfx.comboBreak(had - 2);
}

// deps: { getStarted, getYouKills }
export function comboResetImpl(deps) {
  try {
    if (comboTimer) clearTimeout(comboTimer);
  } catch {}
  comboTimer = 0;
  comboCount = 0;
  comboLastAt = 0;
  comboHudSig = '';
  renderComboHudImpl(deps);
}

/* ==========================================================================
 * J20 — тосты (#eventToasts)
 * ======================================================================== */

// deps: {
//   eventToastsEl, getBigToastCooldownUntil, toastByKey, toastQueue,
//   MAX_EVENT_TOASTS, toastPrioValue, toastMount, toastLowestMounted, toastUnmount
// }
/* ==========================================================================
 * Лента событий / килфид (#killfeed)
 * ======================================================================== */

let killfeedSig = '';
let killfeedLastUnreadAt = 0;

/* actorNum (необязательный) — номер игрока, чьё это событие. Нужен только
   для значка архетипа бота (C4); на текст и схлопывание не влияет. */
// deps: { eventFeed, setKillfeedDirty }
export function pushEventFeedImpl(text, kind, actorNum, deps) {
  const { eventFeed, setKillfeedDirty } = deps;
  const t = performance.now();
  const s = String(text || '').trim();
  if (!s) return;
  const k = String(kind || '');
  const a = Number.isFinite(Number(actorNum)) ? Number(actorNum) : null;
  /* C8: подряд идущие одинаковые строки читались как зависший лог. Схлопываем
     их в одну с множителем ×N (окно 10 с — дальше строка всё равно истечёт). */
  const head = eventFeed[0];
  if (head && head.text === s && head.k === k && t - head.t < 10000) {
    head.n = (head.n || 1) + 1;
    head.t = t;
    setKillfeedDirty(true);
    return;
  }
  /* UX15: однотипные события одного игрока подряд (например "захватил +N зоны")
     схлопываем в одну строку с суммой, а не плодим повторы — сравниваем текст
     без хвостового числа, чтобы разные +N всё равно объединялись. */
  if (head && head.k === k && head.a === a && a != null && t - head.t < 10000) {
    const m = /^(.*\+)(\d+)(\D*)$/.exec(s);
    const hm = head.text ? /^(.*\+)(\d+)(\D*)$/.exec(head.text) : null;
    if (m && hm && m[1] === hm[1] && m[3] === hm[3]) {
      head.text = `${hm[1]}${Number(hm[2]) + Number(m[2])}${hm[3]}`;
      head.t = t;
      setKillfeedDirty(true);
      return;
    }
  }
  eventFeed.unshift({ t, text: s, k, n: 1, a });
  if (eventFeed.length > 64) eventFeed.length = 64;
  setKillfeedDirty(true);
}

// deps: {
//   killfeedEl, eventFeed, you, lang, botArchInfo, botArchBadge,
//   rightEventsDetailsEl, getEventsUnreadCount, setEventsUnreadCount,
//   setBadgeCount, rightEventsBadgeEl, syncRightEmptyStates
// }
export function renderKillfeedImpl(deps) {
  const {
    killfeedEl,
    eventFeed,
    you,
    lang,
    botArchInfo,
    botArchBadge,
    rightEventsDetailsEl,
    getEventsUnreadCount,
    setEventsUnreadCount,
    setBadgeCount,
    rightEventsBadgeEl,
    syncRightEmptyStates,
  } = deps;

  if (!killfeedEl) return;
  const now = performance.now();
  const small = window.innerWidth <= 720;
  const maxAge = small ? 8000 : 12000;
  // Четыре строки: пятая-шестая — уже история, а не события (волна 12).
  const maxLines = 4;
  const visible = eventFeed.filter((e) => now - e.t < maxAge).slice(0, maxLines);
  /* C8: замер до правки — 195 узлов за 12 с. Половина пересборок приходилась на
     пакеты, где видимый текст не менялся вообще: killfeedDirty выставляется на
     любое событие, а строк на экране всего 4-6. Сверяем подпись и не трогаем
     DOM, когда рисовать нечего нового. */
  // C4: значок бота входит в подпись — иначе приход cosExtra не перерисует ленту.
  const sig =
    visible.map((e) => `${e.k}${e.text}${e.n || 1}${botArchInfo(e.a) ? `b${e.a}` : ''}${e.a === you ? 'm' : ''}`).join('') + lang;
  if (killfeedSig === sig) return;
  killfeedSig = sig;

  const lines = visible.map((e) => {
    const div = document.createElement('div');
    const k = String(e?.k || '').trim();
    div.className = k ? `killLine killLine${k}` : 'killLine';
    // УХ31: отличаем свои события от чужих цветом левой полосы/фона.
    if (you && e?.a != null && Number(e.a) === you) div.classList.add('killLineMine');
    else if (e?.a != null) div.classList.add('killLineOther');
    // C8: множитель схлопнутых повторов.
    const rep = Number(e?.n) || 1;
    const txt = rep > 1 ? `${e.text} ×${rep}` : e.text;
    // C4: в килфиде колонка узкая — оставляем только глиф, без подписи архетипа.
    const badge = botArchBadge(e.a, { glyphOnly: true });
    if (badge) div.replaceChildren(badge, document.createTextNode(txt));
    else div.textContent = txt;
    return div;
  });
  killfeedEl.replaceChildren(...lines);

  try {
    if (rightEventsDetailsEl && !rightEventsDetailsEl.open && lines.length) {
      if (!killfeedLastUnreadAt || now - killfeedLastUnreadAt > 1200) {
        killfeedLastUnreadAt = now;
        setEventsUnreadCount(Math.min(999, getEventsUnreadCount() + 1));
        setBadgeCount(rightEventsBadgeEl, getEventsUnreadCount());
      }
    }
  } catch {}
  try {
    syncRightEmptyStates();
  } catch {}
}
