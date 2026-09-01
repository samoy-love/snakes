/* Отрисовка кадра: камера, поле, эффекты, HUD-обвязка и сам цикл кадров.
   Модуль читает и пишет те же группы стора, что и остальной клиент, поэтому
   deps-объект ему не нужен — всё нужное он импортирует напрямую. Наружу
   отдаются только точки, которые зовут обработчики сокета (применение дельт
   сетки, геометрия своего) и запуск цикла. */
import { clientState } from './client_state.js';
import {
  cos,
  fxRt,
  match,
  me,
  netStat,
  session,
  settings,
  world
} from './client_store.js';
import { dom } from './client_dom.js';
import {
  computeDrawCamera,
  paintBursts,
  paintEntities,
  paintFieldFx,
  paintPowerUps,
  paintTerrain,
  renderPerfPanel
} from './client_draw.js';
import { dirVec, viewRectOf } from './client_field_view.js';
import { boostHsl, hslToRgb } from './client_color.js';
import { easeOutBack, easeOutCubic, lerp } from './client_util.js';
import { gridCellIsCooling, gridCellOwner } from './client_grid.js';
import { fxParticleScale, prefersReducedMotion } from './client_fx_preset.js';
import { anyOverlayOpen, isOverlayOpen } from './client_overlays.js';
import { RECLAIM_WINDOW_MS, approxNowTick, powerupLabel } from './client_labels.js';
import { cosClampId, drawCaptureFx, drawDeathFx } from './client_cos_draw.js';
import { SCORE_POPUP_MS, hasFirstCapture, hitstopLostMs } from './client_fx_rt.js';
import { obGuideActiveImpl } from './client_onboarding.js';
import { botArchGlyph, cosTitlePrefix } from './client_identity.js';
import { roi, viewCellBudget } from './client_viewport.js';
import { MINIMAP_REFRESH_MS, drawMinimap } from './client_minimap_ui.js';
import { getChatOpenUntil, setChatCollapsed } from './client_chat.js';
import {
  renderMetaHudImpl as renderMetaHud,
  renderTeamHudImpl as renderTeamHud,
  renderTopHudImpl as renderTopHud
} from './client_hud.js';
import {
  tickDeathStats,
  updateDeathZoom,
  updateMatchCountdown
} from './client_endgame.js';
import { t } from './client_i18n_rt.js';

const ctx = dom.canvas.getContext('2d');

 ctx.imageSmoothingEnabled = true;
 ctx.imageSmoothingQuality = 'high';

// C14: экран-координаты нарисованных бонусов — для подсказки эффекта по
// наведению мыши (у канвас-объектов нет нативного title). Заполняется в draw().
let powerUpScreenPos = [];

// C10: градиенты фона кадра зависят только от размеров вьюпорта.
let bgGradCacheKey = '';
let bgGradLinear = null;
let bgGradVignette = null;


const ownerFillStyleCache = new Map();
const ALPHA_STEPS = 64;

const fillAnimMs = 480;
const fillDelayMod = 170;
const waveSpeed = 0.0042;
const waveScale = 0.55;
const waveAlpha = 0.10;
const wavePeriodMs = (Math.PI * 2) / waveSpeed;

// Запас в клетках при отсечении «объект вне экрана, пропустить отрисовку» —
// один допуск на пауэрапы, частицы и бурсты эффектов. Раньше был продублирован
// с разными значениями (±1 у пауэрапов, ±2 у частиц и бурстов) — объект у
// самого края экрана пропадал/появлялся на клетку раньше, чем остальные.
const OFFSCREEN_MARGIN_CELLS = 2;

// Момент последнего спавна искр трассы разгона — раньше жил как draw._spAt,
// теперь передаётся в paintFieldFx() (client_draw.js) как мутируемый ref,
// чтобы функция не зависела от объекта draw().

/* I2/F18: геометрия «своего» — длина следа и ближайшая своя клетка. */
const TRAIL_PULSE_FROM = 22;
let ownGeometryAt = 0;

// Полный проход по сетке дешевле, чем кажется (200x140), и вызывается 5 раз в
// секунду вне кадрового цикла: считает длину своего следа и ближайшую свою
// клетку, если её не нашлось в видимой области.
export function refreshOwnGeometry(force) {
  if (!world.gridOwner || !world.trailOwner || !session.you || !session.W || !session.H) return;
  const now = performance.now();
  if (!force && now - ownGeometryAt < 200) return;
  ownGeometryAt = now;

  /* Локальная переменная под свою змейку раньше звалась me, а показатели
     лежали в отдельных youTrailLen/youInOwnZone/youNearestHome*. При переезде
     состояния в стор эти имена стали полями группы me — и локальная змейка
     закрыла собой группу: все присваивания уходили в объект игрока из
     снапшота, а не в хранилище, причём в ветке «змейка мертва» они писались
     в заведомо отсутствующий объект. Там же уцелело голое `you` вместо
     session.you — обращение к нему валило функцию с ReferenceError. Итог:
     счётчик длины следа, компас домой и подсказка новичку молчали весь матч.
     Локальная змейка теперь mine, группа стора не затеняется. */
  const mine = world.currPlayers.get(session.you);
  if (!mine || !mine.a) {
    me.trailLen = 0;
    me.inOwnZone = true;
    me.nearestHomeX = -1;
    me.nearestHomeY = -1;
    return;
  }

  const hx = Number(mine.x) || 0;
  const hy = Number(mine.y) || 0;
  const hi = hy * session.W + hx;
  me.inOwnZone = hi >= 0 && hi < world.gridOwner.length ? world.gridOwner[hi] === session.you : false;

  const staleHome = now - me.nearestHomeAt > 400;
  let len = 0;
  let bestD = Infinity;
  let bx = -1;
  let by = -1;
  let i = 0;
  for (let y = 0; y < session.H; y++) {
    const dy = y - hy;
    const dy2 = dy * dy;
    for (let x = 0; x < session.W; x++, i++) {
      if (world.trailOwner[i] === session.you) len++;
      if (staleHome && world.gridOwner[i] === session.you) {
        const dx = x - hx;
        const d = dx * dx + dy2;
        if (d < bestD) {
          bestD = d;
          bx = x;
          by = y;
        }
      }
    }
  }
  me.trailLen = len;
  if (staleHome) {
    me.nearestHomeX = bx;
    me.nearestHomeY = by;
    me.nearestHomeAt = bx >= 0 ? now : 0;
  }
}

export function applyPackedDelta(u16, buf) {
  if (!u16 || !buf) return;
  const d = new Uint32Array(buf);
  const len = u16.length;
  for (let k = 0; k < d.length; k++) {
    const v = d[k];
    const i = v >>> 16;
    const o = v & 0xffff;
    if (i < len) u16[i] = o;
  }
}

/* J15 — заливка расходится волной от точки замыкания петли.
   Раньше задержка была `(i * 37) % 170` — псевдослучайный шум, который читался
   как «мигание». Теперь честная дистанция от головы владельца до клетки на 8 мс,
   так что фронт заливки идёт из той точки, где игрок вернулся в свою зону.
   Стоимость — один sqrt на изменённую клетку. */
const FILL_WAVE_MS_PER_CELL = 8;
const FILL_WAVE_MAX_MS = 700;

export function fillDelayFor(i, owner) {
  const a = world.captureAnchorByOwner.get(owner);
  if (!a || !session.W) return (i * 37) % fillDelayMod;
  const dx = (i % session.W) - a.x;
  const dy = ((i / session.W) | 0) - a.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  return Math.min(FILL_WAVE_MAX_MS, d * FILL_WAVE_MS_PER_CELL);
}

// Головы всех живых игроков в момент прихода снапшота — они же точки замыкания
// для тех, кто именно в этом тике захватил территорию.
export function refreshCaptureAnchors(players) {
  if (!Array.isArray(players)) return;
  world.captureAnchorByOwner.clear();
  for (const p of players) {
    if (!p || !p.a) continue;
    world.captureAnchorByOwner.set(p.n, { x: Number(p.x) || 0, y: Number(p.y) || 0 });
  }
}

export function markCoolSeen(i, raw, now) {
  if (!world.coolSeenAt) return;
  if (gridCellIsCooling(raw)) {
    if (!world.coolSeenAt[i]) world.coolSeenAt[i] = now;
  } else if (world.coolSeenAt[i]) {
    world.coolSeenAt[i] = 0;
  }
}

export function applyPackedDeltaGridWithAnim(buf, now) {
  if (!world.gridOwner || !buf || !world.gridFillAt) return;
  const d = new Uint32Array(buf);
  const len = world.gridOwner.length;
  for (let k = 0; k < d.length; k++) {
    const v = d[k];
    const i = v >>> 16;
    const o = v & 0xffff;
    if (i >= len) continue;
    const prev = world.gridOwner[i];
    if (prev !== o) {
      world.gridOwner[i] = o;
      markCoolSeen(i, o, now);
      // Остывающие клетки (старший бит) не анимируем как свежий захват.
      if (o !== 0 && !gridCellIsCooling(o)) {
        world.gridFillAt[i] = now + fillDelayFor(i, o);
      }
    }
  }
}

// Вспышка захвата конкретного игрока — берём из последнего снапшота.
export function cosCaptureFxByPlayer(pid) {
  const list = clientState.lastState?.players;
  if (!Array.isArray(list)) return 0;
  for (const p of list) {
    if (p?.n === pid) return Number(p.cosCaptureFx) || 0;
  }
  return 0;
}

function quantizeAlpha(a) {
  const v = Math.max(0, Math.min(1, a));
  return Math.round(v * ALPHA_STEPS);
}

function getOwnerFillStyle(owner, a) {
  const ai = quantizeAlpha(a);
  let arr = ownerFillStyleCache.get(owner);
  if (!arr) {
    arr = new Array(ALPHA_STEPS + 1);
    ownerFillStyleCache.set(owner, arr);
  }
  let s = arr[ai];
  if (s) return s;
  const c = boostHsl(world.colors.get(owner) || 'hsl(210 20% 60%)');
  const rgb = hslToRgb(c);
  const aa = ai / ALPHA_STEPS;
  s = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${aa})`;
  arr[ai] = s;
  return s;
}

function getInterpPlayer(id, t) {
  const b = world.currPlayers.get(id);
  if (!b) return null;
  const a = world.prevPlayers.get(id) || b;
  return {
    ...b,
    ix: lerp(a.x, b.x, t),
    iy: lerp(a.y, b.y, t)
  };
}

// C14: у бонусов на канвасе нет нативного title — маленькая подсказка рядом
// с курсором при наведении на иконку подсказывает эффект без лишней вёрстки.
let powerUpTooltipEl = null;
function powerUpTooltip() {
  if (!powerUpTooltipEl) {
    powerUpTooltipEl = document.createElement('div');
    powerUpTooltipEl.className = 'powerupTooltip hidden';
    document.body.appendChild(powerUpTooltipEl);
  }
  return powerUpTooltipEl;
}
dom.canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;
  if (!powerUpScreenPos.length) {
    if (powerUpTooltipEl) powerUpTooltipEl.classList.add('hidden');
    return;
  }
  const mx = e.clientX;
  const my = e.clientY;
  let hit = null;
  let bestD = Infinity;
  for (const p of powerUpScreenPos) {
    const dx = mx - p.cx;
    const dy = my - p.cy;
    const d = dx * dx + dy * dy;
    const rr = (p.r * 1.6) * (p.r * 1.6);
    if (d <= rr && d < bestD) {
      bestD = d;
      hit = p;
    }
  }
  const el = powerUpTooltip();
  if (!hit) {
    el.classList.add('hidden');
    return;
  }
  el.textContent = powerupLabel(hit.type);
  el.style.left = `${mx + 14}px`;
  el.style.top = `${my + 14}px`;
  el.classList.remove('hidden');
});
dom.canvas.addEventListener('pointerleave', () => {
  if (powerUpTooltipEl) powerUpTooltipEl.classList.add('hidden');
});

/* Та же тонкая обёртка, что и в client.js: onboarding-модуль получает
   hasFirstCapture зависимостью, импортировать его сам он не может. */
function obGuideActive() {
  return obGuideActiveImpl({ hasFirstCapture });
}


function draw() {
  requestAnimationFrame(draw);
  const matchOverlayOpen = isOverlayOpen('match');
  if (matchOverlayOpen) {
    updateMatchCountdown();
  }

  if (!clientState.lastState || !world.gridOwner || !world.trailOwner) return;

  /* K7: под открытым оверлеем смерти/итогов поле продолжало рисоваться на
     60 fps, причём сквозь backdrop-filter: blur(8px) — худший из возможных
     сценариев для мобильного GPU: каждый кадр поля тянет за собой пересчёт
     размытия всей области оверлея. Поле там статично и всё равно размыто,
     поэтому обновляем его раз в 4 кадра.
     C10: backdrop-filter стоит не только на этих двух оверлеях, но и на
     магазине с меню — а магазин открывается прямо из HUD во время матча.
     Признак «открыт хоть один» спрашиваем у client_overlays.js, а не читаем
     класс overlayActive на body: класс — это следствие, которое ставит
     syncOverlayUiState(), и полагаться на побочный эффект чужой функции
     здесь незачем. */
  if (anyOverlayOpen()) {
    draw._blurSkip = ((draw._blurSkip || 0) + 1) % 4;
    if (draw._blurSkip !== 0) return;
  } else {
    draw._blurSkip = 0;
  }

  const cw = window.innerWidth;
  const ch = window.innerHeight;

  let occludedBottom = 0;
  try {
    if (dom.chat) {
      const r = dom.chat.getBoundingClientRect();
      const coversMostWidth = r.width >= cw * 0.85;
      const touchesBottom = r.bottom >= ch - 1;
      if (coversMostWidth && touchesBottom) {
        occludedBottom = Math.max(0, ch - r.top);
      }
    }
  } catch {
    occludedBottom = 0;
  }

  const viewH = Math.max(1, ch - occludedBottom);

  const drawCameraDeps = { cw, viewH, you: session.you, W: session.W, H: session.H, tickMs: session.tickMs, lastPacketAt: world.lastPacketAt, youSpeedUntilTick: me.speedUntilTick, shakeX: fxRt.shakeX, shakeY: fxRt.shakeY, shakeVelX: fxRt.shakeVelX, shakeVelY: fxRt.shakeVelY, shakeIntensity: settings.shakeIntensity, lastRoi: world.lastRoi, roiGrant: roi.grant, maxCells: viewCellBudget(), deathZoomAnchorX: fxRt.deathZoomAnchorX, deathZoomAnchorY: fxRt.deathZoomAnchorY, getInterpPlayer, approxNowTick, hitstopLostMs, updateDeathZoom };
  const cam = computeDrawCamera(performance.now(), drawCameraDeps);
  const { interp, my, nt, speedActive, targetX, targetY, cell, screenBounds, offsetX, offsetY, minX, minY, maxX, maxY, gb, gMinX, gMinY, gMaxX, gMaxY } = cam;
  const nextShakeX = cam.shakeX, nextShakeY = cam.shakeY, nextShakeVelX = cam.shakeVelX, nextShakeVelY = cam.shakeVelY;
  fxRt.shakeX = nextShakeX;
  fxRt.shakeY = nextShakeY;
  fxRt.shakeVelX = nextShakeVelX;
  fxRt.shakeVelY = nextShakeVelY;

  /* clearRect тут не нужен: следом идёт непрозрачный градиент фона ровно на
     тот же прямоугольник (0,0,cw,ch). Это был лишний проход по всему буферу
     канваса каждый кадр — на телефоне полтора миллиона пикселей впустую. */

  /* C1: рамка обзора на миникарте рисовалась по границам экрана и заявляла
     обзор больше реального — всё, что за ROI, на экране всё равно туман.
     Рамка = фактически видимая область. */
  {
    const vr = viewRectOf(gb);
    world.viewMinX = vr.minX;
    world.viewMinY = vr.minY;
    world.viewMaxX = vr.maxX;
    world.viewMaxY = vr.maxY;
  }

  {
    // C10: оба градиента зависят только от размеров — раньше пересоздавались
    // каждый кадр. Кэш инвалидируется при изменении cw/ch/viewH.
    const key = `${cw}x${ch}x${viewH}`;
    if (bgGradCacheKey !== key) {
      bgGradCacheKey = key;
      // Волна 9: поле живёт в той же гамме, что и оверлеи, — «неоновый сад».
      // Изумруд в левом верхнем углу, фиолет в правом нижнем, как в .overlay.
      const bg = ctx.createLinearGradient(0, 0, cw, ch);
      bg.addColorStop(0, '#05100f');
      bg.addColorStop(0.55, '#060a12');
      bg.addColorStop(1, '#0a0714');
      bgGradLinear = bg;

      const vg = ctx.createRadialGradient(cw * 0.52, viewH * 0.46, Math.min(cw, viewH) * 0.25, cw * 0.52, viewH * 0.46, Math.min(cw, viewH) * 0.85);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.55)');
      bgGradVignette = vg;
    }
    ctx.fillStyle = bgGradLinear;
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = bgGradVignette;
    ctx.fillRect(0, 0, cw, ch);
  }

  const nowFrame = performance.now();

  // Спавн искр трассы разгона. Остаётся в draw() (не в paintFieldFx()) —
  // момент спавна привязан к тому же кадру, что двигает камеру/интерп, а
  // сама отрисовка частиц (в т.ч. этих) стоит на прежнем месте ниже, после
  // пауэрапов — см. paintFieldFx() в client_draw.js.
  if (settings.fxEnabled && speedActive) {
    const dt = Math.min(40, nowFrame - (fxRt.spawnAt.at || nowFrame));
    fxRt.spawnAt.at = nowFrame;
    const [dx, dy] = dirVec(my.d);
    const bx = my.ix + 0.5 - dx * 0.55;
    const by = my.iy + 0.5 - dy * 0.55;
    const c = boostHsl(world.colors.get(session.you) || my.c || 'hsl(210 20% 60%)');
    // J22: пресет эффектов масштабирует плотность частиц.
    const rate = (0.22 + 0.55 * settings.fxIntensity) * fxParticleScale();
    const count = Math.max(0, Math.min(7, Math.round((dt / 16) * rate * 3)));
    for (let k = 0; k < count; k++) {
      const jx = (Math.random() - 0.5) * 0.25;
      const jy = (Math.random() - 0.5) * 0.25;
      const pvx = (-dx * (0.010 + Math.random() * 0.010) + (Math.random() - 0.5) * 0.006) * (0.55 + settings.fxIntensity * 0.85);
      const pvy = (-dy * (0.010 + Math.random() * 0.010) + (Math.random() - 0.5) * 0.006) * (0.55 + settings.fxIntensity * 0.85);
      fxRt.particles.push({
        bornAt: nowFrame,
        lastAt: nowFrame,
        x: bx + jx,
        y: by + jy,
        vx: pvx,
        vy: pvy,
        c,
        r: 0.10 + Math.random() * 0.14
      });
    }
    // Hard cap: remove oldest particles without O(n) shift()
    const hardCap = 220;
    if (fxRt.particles.length > hardCap) {
      fxRt.particles.splice(0, fxRt.particles.length - hardCap);
    }
  }

  // I2/F18/C10: клетки поля/территорий, cool-edge пути остывающей территории,
  // следы и лёгкая сетка поверх — см. client_draw.js: paintTerrain().
  const terrainResult = paintTerrain(ctx, cam, {
    nowFrame, you: session.you, W: session.W, H: session.H,
    colors: world.colors, gridOwner: world.gridOwner, trailOwner: world.trailOwner, gridFillAt: world.gridFillAt, headIndexByOwner: world.headIndexByOwner,
    cosTerrByPlayer: cos.terrByPlayer, coolDeadlineByOwner: world.coolDeadlineByOwner, coolSeenAt: world.coolSeenAt,
    getOwnerFillStyle, gridCellOwner, gridCellIsCooling,
    RECLAIM_WINDOW_MS, fillAnimMs, wavePeriodMs, waveScale, waveSpeed, waveAlpha,
    youTrailLen: me.trailLen, TRAIL_PULSE_FROM, fxEnabled: settings.fxEnabled, reducedMotion: prefersReducedMotion()
  });
  if (terrainResult.hasNearHome) {
    me.nearestHomeX = terrainResult.nearHomeX;
    me.nearestHomeY = terrainResult.nearHomeY;
    me.nearestHomeAt = nowFrame;
  }

  /* K1: туман за пределами ROI. Рисуется после сетки и до рамки карты, чтобы
     гасить и клетки, и линии, но не трогать игроков, эффекты и HUD. */
  if (world.lastRoi && (gMinX > minX || gMinY > minY || gMaxX < maxX || gMaxY < maxY)) {
    const kx = offsetX + world.lastRoi.rx * cell;
    const ky = offsetY + world.lastRoi.ry * cell;
    const kw = world.lastRoi.rw * cell;
    const kh = world.lastRoi.rh * cell;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, cw, ch);
    ctx.rect(kx, ky, kw, kh);
    ctx.fillStyle = 'rgba(6,8,12,0.82)';
    ctx.fill('evenodd');
    ctx.restore();

    // Тонкая граница известной области: игрок должен понимать, что дальше не
    // «пусто», а «неизвестно».
    ctx.save();
    ctx.strokeStyle = 'rgba(148,163,184,0.20)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(kx + 0.5, ky + 0.5, Math.max(1, kw - 1), Math.max(1, kh - 1));
    ctx.restore();
  }

  {
    const left = offsetX;
    const top = offsetY;
    const w = session.W * cell;
    const h = session.H * cell;
    const lw = Math.max(6, Math.min(26, cell * 0.30));

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, cw, ch);
    ctx.rect(left, top, w, h);
    ctx.clip('evenodd');
    ctx.lineJoin = 'round';
    ctx.lineWidth = lw;
    ctx.strokeStyle = 'rgba(96,165,250,0.18)';
    ctx.shadowColor = 'rgba(96,165,250,0.55)';
    ctx.shadowBlur = 22;
    ctx.strokeRect(left - lw / 2, top - lw / 2, w + lw, h + lw);
    ctx.restore();

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, lw * 0.40);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    {
      const lw2 = ctx.lineWidth;
      ctx.strokeRect(left - lw2 / 2, top - lw2 / 2, w + lw2, h + lw2);
    }
    ctx.restore();
  }

  // Пауэрапы поля — см. client_draw.js: paintPowerUps().
  if (match.powerUps && match.powerUps.size) {
    powerUpScreenPos = paintPowerUps(ctx, cam, performance.now(), { powerUps: match.powerUps, approxNowTick, OFFSCREEN_MARGIN_CELLS });
  } else if (powerUpScreenPos.length) {
    powerUpScreenPos = [];
  }

  // FX-частицы поля (искры трассы разгона): движение + отрисовка + вычистка
  // истёкших — см. client_draw.js: paintFieldFx(). Спавн стоит выше по кадру
  // (см. комментарий там), сама отрисовка — на прежнем месте, после
  // пауэрапов и до змей/следов.
  paintFieldFx(ctx, cam, nowFrame, { fxEnabled: settings.fxEnabled, fxIntensity: settings.fxIntensity, fxParticles: fxRt.particles, OFFSCREEN_MARGIN_CELLS });

  // Змеи/следы/nameplate-метки/индикаторы направления — см. client_draw.js:
  // paintEntities().
  paintEntities(ctx, cam, {
    you: session.you, colors: world.colors, fxEnabled: settings.fxEnabled, fxIntensity: settings.fxIntensity, bountyTarget: match.bountyTarget, youSpeedType: me.speedType,
    cosTitleByPlayer: cos.titleByPlayer, getInterpPlayer, botArchGlyph, cosTitlePrefix
  }, nowFrame);

  // I4: радар угрозы. Дуга по краю экрана в направлении чужой головы ближе
  // 25 клеток, пока игрок вне своей территории. Интенсивность растёт при сближении.
  if (settings.fxEnabled && my && my.a && !me.inOwnZone) {
    const reduce = prefersReducedMotion();
    const hx = my.ix + 0.5;
    const hy = my.iy + 0.5;
    const ecx = cw / 2;
    const ecy = viewH / 2;
    const rx = Math.max(40, cw / 2 - 16);
    const ry = Math.max(40, viewH / 2 - 16);
    const THREAT_CELLS = 25;
    let drawn = 0;

    for (const p of clientState.lastState.players) {
      if (!p.a || p.n === session.you) continue;
      const dx = p.x + 0.5 - hx;
      const dy = p.y + 0.5 - hy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= THREAT_CELLS) continue;

      const inten = Math.max(0, Math.min(1, 1 - dist / THREAT_CELLS));
      const ang = Math.atan2(dy, dx);
      const pulse = reduce ? 1 : 0.8 + 0.2 * Math.sin(nowFrame * 0.012 + p.n * 0.7);
      const span = 0.28 + 0.34 * inten;
      const col = match.bountyTarget && p.n === match.bountyTarget ? 'rgba(255,140,60,0.95)' : 'rgba(255,70,92,0.95)';

      ctx.save();
      ctx.globalAlpha = Math.min(0.9, (0.14 + 0.66 * inten * inten) * pulse);
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(3, 4 + 13 * inten);
      ctx.strokeStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.ellipse(ecx, ecy, rx, ry, 0, ang - span, ang + span);
      ctx.stroke();
      ctx.restore();

      if (++drawn >= 4) break;
    }
  }

  // F18: счётчик длины следа у головы + компас в сторону ближайшей своей клетки.
  if (my && my.a && session.started) {
    const hpx = offsetX + (my.ix + 0.5) * cell;
    const hpy = offsetY + (my.iy + 0.5) * cell;
    const fontPx = Math.max(11, Math.round(cell * 0.60));

    if (me.trailLen > 0) {
      const risky = me.trailLen >= TRAIL_PULSE_FROM;
      const txt = String(me.trailLen);
      ctx.save();
      ctx.font = `700 ${fontPx}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.92)';
      ctx.strokeText(txt, hpx, hpy + cell * 0.98);
      ctx.fillStyle = risky ? 'rgba(255,190,80,0.98)' : 'rgba(255,255,255,0.90)';
      ctx.fillText(txt, hpx, hpy + cell * 0.98);
      ctx.restore();
    }

    if (!me.inOwnZone && me.nearestHomeX >= 0) {
      const ax = me.nearestHomeX + 0.5 - (my.ix + 0.5);
      const ay = me.nearestHomeY + 0.5 - (my.iy + 0.5);
      const dlen = Math.sqrt(ax * ax + ay * ay);
      if (dlen > 1.2) {
        const ang = Math.atan2(ay, ax);
        const rr = cell * 1.25;
        const tipX = hpx + Math.cos(ang) * rr;
        const tipY = hpy + Math.sin(ang) * rr;
        const wgt = cell * 0.26;
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = 'rgba(120,255,190,0.95)';
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = Math.max(1, cell * 0.05);
        ctx.beginPath();
        ctx.moveTo(tipX + Math.cos(ang) * wgt, tipY + Math.sin(ang) * wgt);
        ctx.lineTo(tipX + Math.cos(ang + 2.4) * wgt, tipY + Math.sin(ang + 2.4) * wgt);
        ctx.lineTo(tipX + Math.cos(ang - 2.4) * wgt, tipY + Math.sin(ang - 2.4) * wgt);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    // F15: пока игрок ни разу не замкнул петлю, компас — слишком тихая
    // подсказка. Ведём пунктирную линию прямо к своей земле и подписываем её.
    if (obGuideActive() && !me.inOwnZone && me.nearestHomeX >= 0) {
      const tx = offsetX + (me.nearestHomeX + 0.5) * cell;
      const ty = offsetY + (me.nearestHomeY + 0.5) * cell;
      const ddx = tx - hpx;
      const ddy = ty - hpy;
      const dpx = Math.sqrt(ddx * ddx + ddy * ddy);
      if (dpx > cell * 1.5) {
        const ang = Math.atan2(ddy, ddx);
        // Линия не доходит до самой головы и до самой цели — чтобы не мешать.
        const x0 = hpx + Math.cos(ang) * cell * 0.9;
        const y0 = hpy + Math.sin(ang) * cell * 0.9;
        const reduce = prefersReducedMotion();
        const pulse = reduce ? 0.85 : 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(nowFrame * 0.006));

        ctx.save();
        ctx.globalAlpha = 0.9 * pulse;
        ctx.strokeStyle = 'rgba(120,255,190,0.95)';
        ctx.lineWidth = Math.max(2, cell * 0.16);
        ctx.lineCap = 'round';
        ctx.setLineDash([Math.max(4, cell * 0.5), Math.max(4, cell * 0.45)]);
        ctx.lineDashOffset = reduce ? 0 : -nowFrame * 0.06;
        ctx.shadowColor = 'rgba(0,0,0,0.65)';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.setLineDash([]);

        // Наконечник у цели.
        const hw = Math.max(6, cell * 0.55);
        ctx.fillStyle = 'rgba(120,255,190,0.98)';
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx + Math.cos(ang + 2.5) * hw, ty + Math.sin(ang + 2.5) * hw);
        ctx.lineTo(tx + Math.cos(ang - 2.5) * hw, ty + Math.sin(ang - 2.5) * hw);
        ctx.closePath();
        ctx.fill();

        // Подпись у цели, но всегда внутри вьюпорта.
        const label = t('onb.return_here');
        const lf = Math.max(12, Math.round(cell * 0.85));
        ctx.font = `800 ${lf}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = 1;
        const lx = Math.max(70, Math.min(cw - 70, tx));
        const ly = Math.max(28, Math.min(viewH - 28, ty - cell * 1.4));
        ctx.lineJoin = 'round';
        // Раньше «подложкой» была только чёрная обводка самого текста
        // (lineWidth 4) — на плотных сценах (много статистов рядом с целью,
        // особенно на узких вьюпортах) под ней читался и мешался нейм-тег
        // соседнего игрока: обводка недостаточно закрывает фон под буквами,
        // это лишь контур, а не заливка. Затем табличку сделали полностью
        // непрозрачной — она стала перекрывать не только фон поля, но и
        // чужой нейм-тег игрока, случайно оказавшегося за спиной у цели,
        // целиком (docs/reviews/iter-4.md). Теперь табличка полупрозрачная
        // (даёт заглянуть под неё), а собственная читаемость подписи
        // держится за счёт двойного контура текста (тёмная обводка + сама
        // заливка) — этого было мало без подложки только на однотонном
        // фоне, а поверх таблички хватает и на пёстрой сцене.
        const padX = Math.max(8, cell * 0.35);
        const padY = Math.max(5, cell * 0.22);
        const tw = ctx.measureText(label).width;
        const boxW = tw + padX * 2;
        const boxH = lf + padY * 2;
        const boxX = lx - boxW / 2;
        const boxY = ly - boxH / 2;
        const boxR = Math.min(10, boxH / 2);
        ctx.fillStyle = 'rgba(6,20,16,0.55)';
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxW, boxH, boxR);
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(160,255,215,0.55)';
        ctx.stroke();
        ctx.lineJoin = 'round';
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = 'rgba(4,12,10,0.95)';
        ctx.strokeText(label, lx, ly);
        ctx.fillStyle = 'rgba(160,255,215,0.98)';
        ctx.fillText(label, lx, ly);
        ctx.restore();
      }
    }
  }

  if (!dom.chat.classList.contains('collapsed')) {
    if (!dom.chat.contains(document.activeElement) && performance.now() > getChatOpenUntil()) {
      setChatCollapsed(true);
    }
  }

  if (world.minimapDirty || world.minimapHadChunkUpdate || nowFrame - world.lastMinimapDrawAt >= MINIMAP_REFRESH_MS) {
    drawMinimap();
    world.lastMinimapDrawAt = nowFrame;
  }

  // Всплески событий поля (kill/reclaim/pickup/захват/гибель/очки) —
  // см. client_draw.js: paintBursts(). Мутирует fxRt.bursts in-place.
  paintBursts(ctx, cam, nowFrame, {
    bursts: fxRt.bursts, fxEnabled: settings.fxEnabled, fxIntensity: settings.fxIntensity, SCORE_POPUP_MS, OFFSCREEN_MARGIN_CELLS,
    you: session.you, colors: world.colors, boostHsl, cosClampId, drawDeathFx, drawCaptureFx,
    easeOutBack, easeOutCubic
  });

  if (session.started) {
    renderMetaHud();
    renderTopHud();
    /* K3: условие `rightSidebar.dataset.tab === 'team'` не выполнялось никогда
       — в разметке жёстко прописан `data-tab="match"`, и его никто не менял, так
       что живая таблица игроков не отрисовывалась ни разу за матч. Рендерим
       безусловно, но не 60 раз в секунду: таблица собирается через innerHTML. */
    const nowTeam = performance.now();
    if (nowTeam - (renderTeamHud._at || 0) >= 400) {
      renderTeamHud._at = nowTeam;
      renderTeamHud();
    }
  }

  if (isOverlayOpen('death')) {
    tickDeathStats();
  }

  netStat.fpsFrames++;
  const now = performance.now();
  const dtFps = now - netStat.fpsLast;
  if (dtFps >= 500) {
    const inst = (netStat.fpsFrames * 1000) / dtFps;
    netStat.fps = netStat.fps ? lerp(netStat.fps, inst, 0.2) : inst;
    netStat.fpsFrames = 0;
    netStat.fpsLast = now;
  }

  if (netStat.bytesSampleAt == null) {
    netStat.bytesSampleAt = now;
    netStat.bytesInSample = netStat.bytesInTotal;
    netStat.bytesOutSample = netStat.bytesOutTotal;
  } else {
    const dtNet = now - netStat.bytesSampleAt;
    if (dtNet >= 500) {
      const dtSec = dtNet / 1000;
      const instDown = (netStat.bytesInTotal - netStat.bytesInSample) / dtSec;
      const instUp = (netStat.bytesOutTotal - netStat.bytesOutSample) / dtSec;
      netStat.downBps = netStat.downBps ? lerp(netStat.downBps, instDown, 0.2) : instDown;
      netStat.upBps = netStat.upBps ? lerp(netStat.upBps, instUp, 0.2) : instUp;
      netStat.bytesSampleAt = now;
      netStat.bytesInSample = netStat.bytesInTotal;
      netStat.bytesOutSample = netStat.bytesOutTotal;
    }
  }

  if (!settings.perfEnabled) {
    return;
  }

  renderPerfPanel(dom.perf, { roomId: session.roomId, fps: netStat.fps, pingMs: netStat.pingMs, upBps: netStat.upBps, downBps: netStat.downBps, tickrate: world.tickrate, tickMs: session.tickMs }, t);
}

// Запуск цикла кадров. Первый вызов draw() сам ставит requestAnimationFrame,
// дальше цикл держит себя сам.
export function startRenderLoop() {
  draw();
}

export { ownerFillStyleCache };
