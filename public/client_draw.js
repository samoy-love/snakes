/* Камера кадра отрисовки: масштаб, сдвиг к игроку, наезд на точку гибели,
   тряска экрана и итоговые границы видимости (screenBounds/gb).

   Вынесено из draw() (public/client.js) — сама функция рисования остаётся
   там же и вызывает computeDrawCamera() первой строкой, деструктурируя
   результат. Часть значений (camX/camY/camLeadX/camLeadY) по-прежнему пишется
   в clientState — так было и до выноса, поведение сохранено.

   Модульные переменные client.js (shakeX/shakeY/shakeVelX/shakeVelY,
   draw._shakeAt и т.п.) сюда не тянутся через замыкание — они приходят
   параметрами и возвращаются обновлёнными, вызывающая сторона сама
   переприсваивает их себе. Это и держит tests/client_draw_wiring.test.mjs
   зелёным: верхний уровень этого файла не знает имён из client.js.

   Три раздельных performance.now() из исходника (interpNow / shake-dt /
   updateDeathZoom) сведены к одному now-параметру — они и раньше отставали
   друг от друга на доли миллисекунды, поведение эффекта это не меняет. */

import { clientState } from './client_state.js';
import { cellSizeFor, followCamera, decayShake, visibleBounds, clampToRoi, dirVec } from './client_field_view.js';
import { boostHsl } from './client_color.js';
import { trailVisualState } from './client_trail_style.js';
import { formatRate as formatRateOf } from './client_format.js';
import { escapeHtml, setSafeHtml } from './client_util.js';
import {
  cosClampId,
  cosTerrAlphaMod,
  cosTerrFillStyle,
  cosTerrIsAdditive,
  cosTerrIsPattern,
  drawHead,
  drawNamePlate,
  drawSegTile,
  drawTerrSeam
} from './client_cos_draw.js';

// Скретч-Map путей остывающих клеток территории — переиспользуется каждый
// кадр (см. коммент у coolEdgePaths в исходнике client.js до выноса), чтобы
// не аллоцировать новый Map на каждый вызов paintTerrain().
const coolEdgePaths = new Map();

export function computeDrawCamera(now, deps) {
  const { cw, viewH, you, W, H, tickMs, lastPacketAt, youSpeedUntilTick, shakeX, shakeY, shakeVelX, shakeVelY, shakeIntensity, lastRoi, roiGrant, deathZoomAnchorX, deathZoomAnchorY, getInterpPlayer, approxNowTick, hitstopLostMs, updateDeathZoom } = deps;

  // J12: hitstop замедляет только интерполяцию игроков, не эффекты.
  const interpElapsed = now - lastPacketAt - hitstopLostMs(lastPacketAt, now);
  const interp = Math.max(0, Math.min(1, interpElapsed / tickMs));

  const my = getInterpPlayer(you, interp);
  const nt = approxNowTick();
  const speedActive = !!(my && my.a && nt != null && youSpeedUntilTick && nt < youSpeedUntilTick);
  const targetX = my ? my.ix + 0.5 : W / 2;
  const targetY = my ? my.iy + 0.5 : H / 2;
  clientState.camX = followCamera(clientState.camX, targetX);
  clientState.camY = followCamera(clientState.camY, targetY);

  const shakeDt = now - (computeDrawCamera._shakeAt || now);
  computeDrawCamera._shakeAt = now;
  const nextShake = decayShake({
    x: shakeX, y: shakeY, vx: shakeVelX, vy: shakeVelY,
    dtMs: shakeDt, intensity: shakeIntensity
  });

  /* C1: масштаб считался только от вьюпорта, а ROI сервера фиксирован (80×56).
     На портретном телефоне (viewH/cw > 1.4) масштаб упирался в ширину, по
     высоте на экран влезало под сотню рядов — и всё, что выходило за 56 рядов
     ROI, закрашивалось туманом: до 40% экрана. Клэмпим масштаб снизу так,
     чтобы экран никогда не был больше фактического ROI. На десктопе
     (cw/viewH ≈ 1.6) обе поправки меньше базового значения и ничего не
     меняют. */
  const baseCell = cellSizeFor({ cw, viewH, roi: lastRoi, roiGrant });

  /* Драматический наезд на точку гибели: чистый визуальный множитель поверх
     baseCell, не влияющий на ROI/сетевой запрос вьюпорта (см. beginDeathZoom
     / updateDeathZoom в client.js). Камера на время наезда смешивается с
     точкой гибели, а не с текущей целью followCamera. */
  const { zoom: deathZoom, mixToAnchor: deathZoomMix } = updateDeathZoom(now);
  const cell = baseCell * deathZoom;
  const camXForZoom = clientState.camX + (deathZoomAnchorX - clientState.camX) * deathZoomMix;
  const camYForZoom = clientState.camY + (deathZoomAnchorY - clientState.camY) * deathZoomMix;

  /* Камера жёстко зафиксирована на игроке: никакого сдвига по направлению
     движения. Так просил заказчик — «взгляд» не должен уезжать вперёд при
     смене направления.
     Историю двух предыдущих попыток стоит держать в уме, чтобы не вернуться:
     1) поправка «затолкать вьюпорт внутрь ROI» считалась от края окна, а окно
        сервер снапит по ROIStep — величина была ступенчатой, и сглаживание не
        убирало ступеньку, а растягивало её в рывок (0.005..0.6 клетки за кадр);
     2) ведение вперёд на серверный lookahead рывок убрало, но давало ровно тот
        эффект, который заказчику не нужен — камера доворачивала на поворотах.
     Чтобы при нулевом ведении сзади не появлялся туман, сервер тоже перестал
     смещать окно вперёд (roiLookahead → 0), и ROI центрируется на голове. */
  clientState.camLeadX = 0;
  clientState.camLeadY = 0;

  const screenBounds = visibleBounds({
    cw, viewH, cell,
    camX: camXForZoom + clientState.camLeadX, camY: camYForZoom + clientState.camLeadY,
    shakeX: nextShake.x, shakeY: nextShake.y, W, H
  });
  const { offsetX, offsetY, minX, minY, maxX, maxY } = screenBounds;

  /* K1: границы горячего цикла по сетке — пересечение экрана с последним
     полученным ROI. За его пределами gridOwner/trailOwner заведомо устарели. */
  const gb = clampToRoi(screenBounds, lastRoi);
  const gMinX = gb.minX;
  const gMinY = gb.minY;
  const gMaxX = gb.maxX;
  const gMaxY = gb.maxY;

  return {
    interp, my, nt, speedActive, targetX, targetY,
    shakeX: nextShake.x, shakeY: nextShake.y, shakeVelX: nextShake.vx, shakeVelY: nextShake.vy,
    baseCell, deathZoom, deathZoomMix, cell, camXForZoom, camYForZoom,
    screenBounds, offsetX, offsetY, minX, minY, maxX, maxY,
    gb, gMinX, gMinY, gMaxX, gMaxY
  };
}

/* Клетки поля/территорий: per-owner цвета/паттерны, остывающая территория с
   cool-edge путями, собственный и чужие следы, лёгкая сетка поверх.

   Вынесено из draw() (public/client.js) — вызывается на прежнем месте, после
   градиента фона и до тумана ROI; порядок слоёв не менялся.

   cameraFrame — результат computeDrawCamera(), передаётся как есть (не
   пересчитывается). Модульные значения client.js (colors, gridOwner,
   trailOwner, gridFillAt, headIndexByOwner, coolDeadlineByOwner, coolSeenAt,
   getOwnerFillStyle, gridCellOwner, gridCellIsCooling и т.д.) приходят через
   deps — так же, как в computeDrawCamera(), и по той же причине держит
   tests/client_draw_wiring.test.mjs зелёным. */
export function paintTerrain(ctx, cameraFrame, deps) {
  const { nowFrame, you, W, H, colors, gridOwner, trailOwner, gridFillAt, headIndexByOwner, cosTerrByPlayer, coolDeadlineByOwner, coolSeenAt, getOwnerFillStyle, gridCellOwner, gridCellIsCooling, RECLAIM_WINDOW_MS, fillAnimMs, wavePeriodMs, waveScale, waveSpeed, waveAlpha, youTrailLen, TRAIL_PULSE_FROM, fxEnabled, reducedMotion } = deps;
  const { offsetX, offsetY, minX, minY, maxX, maxY, gMinX, gMinY, gMaxX, gMaxY, cell, my } = cameraFrame;

  const segByOwner = new Map();
  const hslByOwner = new Map();
  const terrByOwner = new Map();
  const terrStyleByOwner = new Map();
  for (const p of clientState.lastState.players) {
    segByOwner.set(p.n, cosClampId(p.cosSeg));
    const hsl = boostHsl(colors.get(p.n) || p.c || 'hsl(210 20% 60%)');
    hslByOwner.set(p.n, hsl);
    const tid = cosClampId(cosTerrByPlayer.get(p.n) || 0);
    if (tid) {
      terrByOwner.set(p.n, tid);
      if (cosTerrIsPattern(tid)) {
        const st = cosTerrFillStyle(ctx, hsl, tid, offsetX, offsetY, cell);
        if (st) terrStyleByOwner.set(p.n, st);
      }
    }
  }

  const trailStyle = trailVisualState({
    trailLen: youTrailLen,
    pulseFrom: TRAIL_PULSE_FROM,
    fxEnabled,
    reducedMotion,
    nowFrame
  });
  const ownTrailA = trailStyle.ownAlpha;
  const otherTrailA = trailStyle.otherAlpha;
  const ownTrailStroke = trailStyle.ownStroke;
  const drawOwnOutline = cell >= 8;

  // F18/I4: ближайшая своя клетка ищется бесплатно, прямо в горячем цикле.
  let nearHomeD = Infinity;
  let nearHomeX = -1;
  let nearHomeY = -1;
  const headCX = my ? my.ix : -1;
  const headCY = my ? my.iy : -1;

  const coolPaths = coolEdgePaths;
  coolPaths.clear();
  const coolSame = (nx, ny, owner) => {
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) return false;
    const raw = gridOwner[ny * W + nx];
    return gridCellIsCooling(raw) && gridCellOwner(raw) === owner;
  };

  for (let y = gMinY; y <= gMaxY; y++) {
    for (let x = gMinX; x <= gMaxX; x++) {
      const i = y * W + x;
      const rawOwner = gridOwner[i];
      // F5: старший бит = «клетка остывает, её ещё можно вернуть».
      const cooling = gridCellIsCooling(rawOwner);
      const o = cooling ? 0 : rawOwner;
      const coolOwner = cooling ? gridCellOwner(rawOwner) : 0;
      const t = trailOwner[i];

      if (cooling) {
        // Остывающая территория: полупрозрачная заливка, пунктирная граница,
        // ритм пульса подсказывает, что время уходит.
        // F5: плюс затухание по мере приближения к концу окна — чем ближе
        // истечение, тем бледнее клетка и тем чаще пульс.
        const px = offsetX + x * cell;
        const py = offsetY + y * cell;
        // Точное время истечения — из EventCoolBatch; клиентская оценка по
        // первому увиденному кадру остаётся запасным вариантом.
        const deadline = coolDeadlineByOwner.get(coolOwner) || 0;
        const seen = coolSeenAt ? coolSeenAt[i] : 0;
        const prog = deadline
          ? Math.max(0, Math.min(1, 1 - (deadline - nowFrame) / RECLAIM_WINDOW_MS))
          : seen
            ? Math.max(0, Math.min(1, (nowFrame - seen) / RECLAIM_WINDOW_MS))
            : 0;
        const fade = 1 - prog * 0.8;
        const rate = 0.005 + 0.012 * prog;
        const pulse = 0.5 + 0.5 * Math.sin(nowFrame * rate - (x + y) * 0.35);
        ctx.fillStyle = getOwnerFillStyle(coolOwner, (0.14 + 0.10 * pulse) * fade);
        ctx.fillRect(px, py, cell, cell);
        if (cell >= 7) {
          // Альфа квантуется до 1/16 — иначе на каждую клетку приходился бы
          // свой Path2D и группировка не давала бы выигрыша.
          const aq = Math.max(1, Math.round((0.45 + 0.25 * pulse) * fade * 16)) / 16;
          const key = getOwnerFillStyle(coolOwner, aq);
          let path = coolPaths.get(key);
          if (!path) {
            path = new Path2D();
            coolPaths.set(key, path);
          }
          const x1 = px + 0.5;
          const y1 = py + 0.5;
          const x2 = px + cell - 0.5;
          const y2 = py + cell - 0.5;
          if (!coolSame(x, y - 1, coolOwner)) {
            path.moveTo(x1, y1);
            path.lineTo(x2, y1);
          }
          if (!coolSame(x, y + 1, coolOwner)) {
            path.moveTo(x1, y2);
            path.lineTo(x2, y2);
          }
          if (!coolSame(x - 1, y, coolOwner)) {
            path.moveTo(x1, y1);
            path.lineTo(x1, y2);
          }
          if (!coolSame(x + 1, y, coolOwner)) {
            path.moveTo(x2, y1);
            path.lineTo(x2, y2);
          }
        }
      }

      if (o === you && headCX >= 0) {
        const hdx = x - headCX;
        const hdy = y - headCY;
        const hd = hdx * hdx + hdy * hdy;
        if (hd < nearHomeD) {
          nearHomeD = hd;
          nearHomeX = x;
          nearHomeY = y;
        }
      }

      if (o !== 0) {
        const baseA = 0.58;
        const filledAt = gridFillAt ? gridFillAt[i] : 0;
        const age = filledAt ? nowFrame - filledAt : 1e9;

        let waveA = 0;
        if (filledAt && age >= fillAnimMs) {
          const t2 = age - fillAnimMs;
          if (t2 < wavePeriodMs) {
            const wave = 0.5 + 0.5 * Math.sin((x * 0.85 + y * 1.15) * waveScale - t2 * waveSpeed);
            const fade = 1 - (t2 / wavePeriodMs);
            waveA = waveAlpha * wave * fade;
          }
        }

        const px = offsetX + x * cell;
        const py = offsetY + y * cell;
        const tid = terrByOwner.get(o) || 0;

        // Одна альфа на все три фазы (появление / анимация заливки / покой),
        // чтобы стиль территории подключался ровно в одном месте.
        let a;
        let shineA = 0;
        if (age < 0) {
          a = 0.12 + waveA * 0.35;
        } else if (age < fillAnimMs) {
          const p = Math.max(0, Math.min(1, age / fillAnimMs));
          a = Math.min(0.92, baseA * (0.25 + 0.75 * p) + waveA * 0.5);
          shineA = 0.18 * (1 - Math.abs(p - 0.5) * 2);
        } else {
          a = Math.min(0.92, baseA + waveA);
        }
        if (tid) a = Math.max(0, Math.min(1, a + cosTerrAlphaMod(tid, x, y, nowFrame)));

        const pat = tid ? terrStyleByOwner.get(o) : null;
        if (pat) {
          // try/finally, а не просто парные присваивания до/после: без него
          // исключение внутри fillRect (например, битый CanvasPattern) оставит
          // globalCompositeOperation залипшим на 'lighter' до конца сессии —
          // ничего не сбрасывает его в начале кадра, и вся дальнейшая
          // отрисовка тем же ctx (территория, HUD) начнёт светлеть.
          const additive = cosTerrIsAdditive(tid);
          if (additive) ctx.globalCompositeOperation = 'lighter';
          try {
            ctx.globalAlpha = a;
            ctx.fillStyle = pat;
            ctx.fillRect(px, py, cell, cell);
          } finally {
            ctx.globalAlpha = 1;
            if (additive) ctx.globalCompositeOperation = 'source-over';
          }
        } else {
          ctx.fillStyle = getOwnerFillStyle(o, a);
          ctx.fillRect(px, py, cell, cell);
        }

        if (shineA > 0.01) {
          ctx.fillStyle = getOwnerFillStyle(o, Math.min(0.92, 0.22 + shineA + waveA * 0.35));
          const inset = Math.max(1, (cell * 0.18) | 0);
          ctx.fillRect(px + inset, py + inset, cell - inset * 2, cell - inset * 2);
        }

        // Витраж: светящийся шов только по внешней границе владения.
        if (tid === 5 && cell >= 7) {
          let e = 0;
          if (y === 0 || gridOwner[i - W] !== o) e |= 1;
          if (x === W - 1 || gridOwner[i + 1] !== o) e |= 2;
          if (y === H - 1 || gridOwner[i + W] !== o) e |= 4;
          if (x === 0 || gridOwner[i - 1] !== o) e |= 8;
          if (e) drawTerrSeam(ctx, px, py, cell, hslByOwner.get(o) || 'hsl(210 20% 60%)', e, 0.75);
        }
      }

      if (t !== 0) {
        const mineTrail = t === you;
        let a = mineTrail ? ownTrailA : otherTrailA;
        if (headIndexByOwner.get(t) === i) a *= cameraFrame.interp;
        if (a > 0.02) {
          const segId = segByOwner.get(t) || 0;
          const px = offsetX + x * cell;
          const py = offsetY + y * cell;
          // Единый источник правды: тот же drawSegTile, что и в магазине.
          drawSegTile(ctx, px, py, cell, hslByOwner.get(t) || 'hsl(210 20% 60%)', segId, x * 31 + y * 17, a, nowFrame);

          if (mineTrail && drawOwnOutline) {
            ctx.strokeStyle = ownTrailStroke;
            ctx.lineWidth = 1;
            ctx.strokeRect(px + 1.5, py + 1.5, cell - 3, cell - 3);
          }
        }
      }
    }
  }

  // C10: один save/restore и один setLineDash на весь кадр вместо одного на клетку.
  if (coolPaths.size) {
    const dash = Math.max(2, cell * 0.22);
    ctx.save();
    ctx.setLineDash([dash, dash]);
    ctx.lineDashOffset = -nowFrame * 0.02;
    ctx.lineWidth = 1;
    for (const [style, path] of coolPaths) {
      ctx.strokeStyle = style;
      ctx.stroke(path);
    }
    ctx.restore();
    coolPaths.clear();
  }

  {
    // Сетка в бренд-гамме: чистый белый на #060a12 читался холодным «дребезгом».
    ctx.strokeStyle = 'rgba(120,220,190,0.055)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const step = cell >= 16 ? 1 : 2;
    for (let x = minX; x <= maxX; x += step) {
      const px = offsetX + x * cell;
      ctx.moveTo(px, offsetY + minY * cell);
      ctx.lineTo(px, offsetY + (maxY + 1) * cell);
    }
    ctx.stroke();
    ctx.beginPath();
    for (let y = minY; y <= maxY; y += step) {
      const py = offsetY + y * cell;
      ctx.moveTo(offsetX + minX * cell, py);
      ctx.lineTo(offsetX + (maxX + 1) * cell, py);
    }
    ctx.stroke();
  }

  return { nearHomeX, nearHomeY, hasNearHome: nearHomeX >= 0 };
}

/* Игроки: голова с носом, кольца щита/неуязвимости/спидбуста, метка охоты,
   бейджи статусов и плашка ника.

   Вынесено из draw() (public/client.js) — вызывается на прежнем месте, сразу
   после трассы разгона (fx speed trail) и до радара угрозы; порядок слоёв
   не менялся.

   cameraFrame — результат computeDrawCamera(), передаётся как есть; offsetX/
   offsetY/cell/interp/speedActive берутся из него. Модульные значения
   client.js (you, colors, fxEnabled, bountyTarget, youSpeedType,
   cosTitleByPlayer, getInterpPlayer, botArchGlyph, cosTitlePrefix) приходят
   через state — так же, как deps в paintTerrain()/computeDrawCamera(), и по
   той же причине держит tests/client_draw_wiring.test.mjs зелёным. */
export function paintEntities(ctx, cameraFrame, state, now) {
  const { you, colors, fxEnabled, fxIntensity, bountyTarget, youSpeedType, cosTitleByPlayer, getInterpPlayer, botArchGlyph, cosTitlePrefix } = state;
  const { offsetX, offsetY, cell, interp, speedActive } = cameraFrame;

  ctx.font = `12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial`;

  for (const p of clientState.lastState.players) {
    if (!p.a) continue;
    const ip = getInterpPlayer(p.n, interp) || { ...p, ix: p.x, iy: p.y };
    const c = boostHsl(colors.get(p.n) || p.c || 'hsl(210 20% 60%)');
    const px = offsetX + (ip.ix + 0.5) * cell;
    const py = offsetY + (ip.iy + 0.5) * cell;

    const [dx, dy] = dirVec(ip.d);
    if (fxEnabled && p.n === you && speedActive) {
      ctx.save();
      ctx.globalAlpha = 0.55 * (0.35 + fxIntensity * 0.65);
      ctx.strokeStyle = c;
      ctx.shadowColor = c;
      ctx.shadowBlur = Math.max(10, cell * 0.9);
      ctx.lineWidth = Math.max(2, cell * 0.14);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px - dx * cell * 0.85, py - dy * cell * 0.85);
      ctx.stroke();
      ctx.restore();
    }

    const isBounty = !!(bountyTarget && p.n === bountyTarget);
    // Байт `sh` — битовая маска: бит0 = щит, бит1 = неуязвимость после респавна.
    const shMask = Number(ip.sh) || 0;
    const hasShield = (shMask & 1) !== 0;
    const hasInvuln = (shMask & 2) !== 0;
    const hasSpeed = !!(p.n === you && speedActive);
    const speedType = hasSpeed ? (youSpeedType === 4 ? 4 : 2) : 0;

    if (hasInvuln) {
      const tt = performance.now() * 0.010 + (p.n % 997) * 0.02;
      const pulse = 0.5 + 0.5 * Math.sin(tt);
      ctx.save();
      ctx.globalAlpha = 0.30 + 0.30 * pulse;
      ctx.setLineDash([Math.max(2, cell * 0.14), Math.max(2, cell * 0.12)]);
      ctx.lineDashOffset = -performance.now() * 0.04;
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.lineWidth = Math.max(1, cell * 0.07);
      ctx.beginPath();
      ctx.arc(px, py, cell * (0.54 + 0.04 * pulse), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (hasShield) {
      const tt = performance.now() * 0.004 + (p.n % 997) * 0.01;
      const pulse = 0.5 + 0.5 * Math.sin(tt);
      const rr = cell * (0.46 + 0.04 * pulse);
      ctx.save();
      ctx.globalAlpha = 0.22 + 0.18 * pulse;
      ctx.strokeStyle = 'rgba(120,200,255,0.95)';
      ctx.shadowColor = 'rgba(120,200,255,0.95)';
      ctx.shadowBlur = Math.max(10, cell * 0.8);
      ctx.lineWidth = Math.max(2, cell * 0.10);
      ctx.beginPath();
      ctx.arc(px, py, rr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (hasSpeed) {
      const tt = performance.now() * 0.006 + (p.n % 997) * 0.02;
      const pulse = 0.5 + 0.5 * Math.sin(tt);
      const rr = cell * (speedType === 4 ? (0.64 + 0.035 * pulse) : (0.60 + 0.03 * pulse));
      ctx.save();
      ctx.globalAlpha = (speedType === 4 ? 0.18 : 0.16) + (speedType === 4 ? 0.14 : 0.12) * pulse;
      ctx.strokeStyle = speedType === 4 ? 'rgba(190,150,255,0.94)' : 'rgba(255,215,0,0.92)';
      ctx.shadowColor = speedType === 4 ? 'rgba(190,150,255,0.85)' : 'rgba(255,215,0,0.75)';
      ctx.shadowBlur = Math.max(8, cell * (speedType === 4 ? 0.85 : 0.7));
      ctx.lineWidth = Math.max(2, cell * (speedType === 4 ? 0.095 : 0.08));
      if (speedType === 4) {
        ctx.beginPath();
        ctx.arc(px, py, rr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha *= 0.60;
        ctx.lineWidth = Math.max(1, cell * 0.06);
        ctx.beginPath();
        ctx.arc(px, py, rr * 0.82, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.setLineDash([Math.max(2, cell * 0.10), Math.max(2, cell * 0.10)]);
        ctx.lineDashOffset = -performance.now() * 0.02;
        ctx.beginPath();
        ctx.arc(px, py, rr, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Голова и направляющий нос — единый drawHead, тот же и в магазине.
    drawHead(ctx, px, py, cell, c, ip.cosHead, dx, dy, now);

    if (isBounty) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,80,80,0.95)';
      ctx.lineWidth = Math.max(2, cell * 0.11);
      ctx.setLineDash([Math.max(3, cell * 0.16), Math.max(2, cell * 0.10)]);
      ctx.lineDashOffset = -performance.now() * 0.03;
      ctx.shadowColor = 'rgba(255,80,80,0.75)';
      ctx.shadowBlur = Math.max(10, cell * 0.75);
      ctx.beginPath();
      ctx.arc(px, py, cell * 0.70, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (hasShield || hasSpeed || isBounty || hasInvuln) {
      const badges = [];
      if (hasInvuln) badges.push({ fill: 'rgba(255,255,255,0.95)', stroke: 'rgba(0,0,0,0.35)' });
      if (hasShield) badges.push({ fill: 'rgba(120,200,255,0.95)', stroke: 'rgba(255,255,255,0.25)' });
      if (hasSpeed) badges.push({ fill: speedType === 4 ? 'rgba(190,150,255,0.95)' : 'rgba(255,215,0,0.95)', stroke: 'rgba(255,255,255,0.25)' });
      if (isBounty) badges.push({ fill: 'rgba(255,80,80,0.95)', stroke: 'rgba(255,255,255,0.25)' });

      const br = Math.max(2, cell * 0.075);
      const gap = br * 2.25;
      const bx0 = px - ((badges.length - 1) * gap) / 2;
      const by = py - cell * 0.72;
      ctx.save();
      ctx.globalAlpha = 0.95;
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 6;
      for (let i = 0; i < badges.length; i++) {
        const b = badges[i];
        const bx = bx0 + i * gap;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fillStyle = b.fill;
        ctx.fill();
        ctx.lineWidth = Math.max(1, cell * 0.03);
        ctx.strokeStyle = b.stroke;
        ctx.stroke();
      }
      ctx.restore();
    }

    /* Титул идёт перед ником — он виден всем, кто видит плашку.
       C4: у бота перед титулом идёт глиф архетипа. В канвасе CSS-бейджа быть
       не может, поэтому берём тот же символ, что рисует .botArch::before —
       один знак, плашка от него почти не растёт, а «кто передо мной» читается
       ещё до того, как бот что-то сделает. */
    const archGlyph = botArchGlyph(ip.n);
    const label = `${archGlyph ? `${archGlyph} ` : ''}${cosTitlePrefix(cosTitleByPlayer.get(ip.n) || 0)}${ip.nm ? String(ip.nm) : String(ip.n)}`;
    // Плашка ника — единый drawNamePlate, тот же и в магазине.
    drawNamePlate(ctx, label, px, py - cell * 0.58, c, ip.cosNameplate, 0.95, 12, now);
  }
}

/* FX-частицы над полем: искры трассы разгона — движение, отрисовка и
   вычистка истёкших. Не DOM-тосты/баннеры/попапы — те в client_fx_ui.js;
   это именно то, что рисуется поверх canvas игрового поля.

   Вынесено из draw() (public/client.js) — вызывается на прежнем месте, после
   пауэрапов и до paintEntities(); порядок слоёв не менялся. Спавн частиц
   остаётся в draw() (привязан к тому же кадру, что движение камеры/интерп) —
   paintFieldFx() получает уже наполненный fxParticles и только рисует.

   fxParticles — тот же массив-накопитель client.js, мутируется на месте
   (splice при истечении жизни частицы), возврата не требует: ссылка на
   массив стабильна.

   cameraFrame — результат computeDrawCamera(), передаётся как есть. deps —
   модульные значения client.js (fxEnabled, fxIntensity, fxParticles,
   OFFSCREEN_MARGIN_CELLS), приходят так же, как в paintTerrain()/
   paintEntities(), и по той же причине держит tests/client_draw_wiring.test.mjs
   зелёным. */
export function paintFieldFx(ctx, cameraFrame, now, deps) {
  const { fxEnabled, fxIntensity, fxParticles, OFFSCREEN_MARGIN_CELLS } = deps;
  const { offsetX, offsetY, cell, minX, maxX, minY, maxY } = cameraFrame;

  if (fxEnabled && fxParticles.length) {
    for (let i = fxParticles.length - 1; i >= 0; i--) {
      const p0 = fxParticles[i];
      const bornAt = typeof p0.bornAt === 'number' ? p0.bornAt : p0.t0;
      const lastAt = typeof p0.lastAt === 'number' ? p0.lastAt : p0.t0;
      const age = now - bornAt;
      if (age > 520) {
        fxParticles.splice(i, 1);
        continue;
      }
      const dt = Math.min(40, Math.max(0, now - lastAt));
      p0.x += p0.vx * dt;
      p0.y += p0.vy * dt;
      p0.lastAt = now;

      if (
        p0.x < minX - OFFSCREEN_MARGIN_CELLS ||
        p0.x > maxX + OFFSCREEN_MARGIN_CELLS ||
        p0.y < minY - OFFSCREEN_MARGIN_CELLS ||
        p0.y > maxY + OFFSCREEN_MARGIN_CELLS
      ) {
        continue;
      }
      const a = (1 - age / 520) * (0.50 + 0.40 * fxIntensity);
      const cx = offsetX + p0.x * cell;
      const cy = offsetY + p0.y * cell;
      const rr = Math.max(1, cell * p0.r);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.shadowColor = p0.c;
      ctx.shadowBlur = Math.max(6, cell * 0.45);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

/* Пауэрапы поля: иконка-форма по типу (ромб/молния/звезда/крест) с пульсацией
   и предупреждающим морганием у истекающих. Возвращает screenPos — список
   экранных координат нарисованных значков, нужен вызывающему для хит-теста
   тултипов/кликов (раньше жил как powerUpScreenPos в draw()). deps — те же
   модульные значения client.js, что и у соседних paint*(), по той же причине
   держит tests/client_draw_wiring.test.mjs зелёным. */
export function paintPowerUps(ctx, cameraFrame, now, deps) {
  const { powerUps, approxNowTick, OFFSCREEN_MARGIN_CELLS } = deps;
  const { offsetX, offsetY, cell, minX, maxX, minY, maxY } = cameraFrame;

  if (!powerUps || !powerUps.size) return [];

  const nt = approxNowTick();
  const screenPos = [];
  for (const pu of powerUps.values()) {
    const x = Number(pu.x) || 0;
    const y = Number(pu.y) || 0;
    if (
      x < minX - OFFSCREEN_MARGIN_CELLS ||
      x > maxX + OFFSCREEN_MARGIN_CELLS ||
      y < minY - OFFSCREEN_MARGIN_CELLS ||
      y > maxY + OFFSCREEN_MARGIN_CELLS
    ) {
      continue;
    }

    const cx = offsetX + (x + 0.5) * cell;
    const cy = offsetY + (y + 0.5) * cell;
    screenPos.push({ cx, cy, r: cell * 0.34, type: pu.type });

    let pulse = 1;
    let alpha = 1;
    if (nt != null && pu.expires) {
      const rem = Number(pu.expires) - nt;
      if (rem < 30) {
        const blink = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(now * 0.020));
        alpha *= Math.max(0.15, blink);
        pulse *= 0.96 + 0.10 * (0.5 + 0.5 * Math.sin(now * 0.016));
      } else {
        pulse *= 0.98 + 0.06 * (0.5 + 0.5 * Math.sin(now * 0.008));
      }
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.scale(pulse, pulse);
    ctx.translate(-cx, -cy);

    const r = cell * 0.34;
    if (pu.type === 1) {
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 3;
        const px = cx + Math.cos(a) * r;
        const py = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(0,255,255,0.18)';
      ctx.strokeStyle = 'rgba(0,255,255,0.92)';
      ctx.lineWidth = Math.max(1, cell * 0.10);
      ctx.shadowColor = 'rgba(0,255,255,0.55)';
      ctx.shadowBlur = 16;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    } else if (pu.type === 2) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.35, cy - r * 0.65);
      ctx.lineTo(cx + r * 0.05, cy - r * 0.10);
      ctx.lineTo(cx - r * 0.05, cy - r * 0.10);
      ctx.lineTo(cx + r * 0.35, cy + r * 0.65);
      ctx.lineTo(cx - r * 0.05, cy + r * 0.15);
      ctx.lineTo(cx + r * 0.05, cy + r * 0.15);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,215,0,0.20)';
      ctx.strokeStyle = 'rgba(255,215,0,0.92)';
      ctx.lineWidth = Math.max(1, cell * 0.10);
      ctx.shadowColor = 'rgba(255,215,0,0.55)';
      ctx.shadowBlur = 16;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    } else if (pu.type === 3) {
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 === 0 ? r * 0.95 : r * 0.42;
        const px = cx + Math.cos(a) * rr;
        const py = cy + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,80,80,0.18)';
      ctx.strokeStyle = 'rgba(255,80,80,0.95)';
      ctx.lineWidth = Math.max(1, cell * 0.10);
      ctx.shadowColor = 'rgba(255,80,80,0.65)';
      ctx.shadowBlur = 18;
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.90)';
      ctx.fill();
      ctx.restore();
    } else if (pu.type === 4) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.55, cy - r * 0.05);
      ctx.lineTo(cx - r * 0.10, cy - r * 0.70);
      ctx.lineTo(cx - r * 0.05, cy - r * 0.22);
      ctx.lineTo(cx + r * 0.55, cy + r * 0.05);
      ctx.lineTo(cx + r * 0.10, cy + r * 0.70);
      ctx.lineTo(cx + r * 0.05, cy + r * 0.22);
      ctx.closePath();
      ctx.fillStyle = 'rgba(170,120,255,0.20)';
      ctx.strokeStyle = 'rgba(190,150,255,0.96)';
      ctx.lineWidth = Math.max(1, cell * 0.10);
      ctx.shadowColor = 'rgba(190,150,255,0.70)';
      ctx.shadowBlur = 18;
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.90, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(190,150,255,0.22)';
      ctx.lineWidth = Math.max(1, cell * 0.06);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }
  return screenPos;
}

/* Всплески событий поля (kill/reclaim/pickup/use/захват/гибель/всплывающее
   число очков) — fxBursts. Мутирует и прорежает переданный массив bursts
   in-place (splice истёкших), как и раньше в draw(). deps несёт то, что
   нельзя импортировать сюда без цикла модулей (drawDeathFx/drawCaptureFx —
   client_cos_draw.js тянет client_draw.js через paintEntities) плюс обычный
   набор модульных значений client.js, как у соседних paint*(). */
export function paintBursts(ctx, cameraFrame, nowFrame, deps) {
  const { bursts, fxEnabled, fxIntensity, SCORE_POPUP_MS, OFFSCREEN_MARGIN_CELLS, you, colors, boostHsl, cosClampId, drawDeathFx, drawCaptureFx, easeOutBack, easeOutCubic } = deps;
  const { offsetX, offsetY, cell, minX, maxX, minY, maxY } = cameraFrame;

  if (!bursts.length) return;

  for (let i = bursts.length - 1; i >= 0; i--) {
    const fx = bursts[i];
    const knd0 = String(fx.kind || '');
    const isScore = knd0 === 'score';
    // Длительность бурста — параметр: вспышка захвата живёт 650 мс,
    // эффект гибели дольше, всплывающее число — своё время.
    const life = Number(fx.life) > 0 ? Number(fx.life) : isScore ? SCORE_POPUP_MS : 650;
    const age = nowFrame - fx.t0;
    if (age > life) {
      bursts.splice(i, 1);
      continue;
    }
    if (!isScore && !fxEnabled) continue;
    const x = fx.x;
    const y = fx.y;
    if (
      x < minX - OFFSCREEN_MARGIN_CELLS ||
      x > maxX + OFFSCREEN_MARGIN_CELLS ||
      y < minY - OFFSCREEN_MARGIN_CELLS ||
      y > maxY + OFFSCREEN_MARGIN_CELLS
    ) {
      continue;
    }

    // J5: всплывающее число «+247» над точкой захвата.
    if (isScore) {
      const sp = Math.max(0, Math.min(1, age / SCORE_POPUP_MS));
      const v = Math.max(0, Math.round(Number(fx.value) || 0));
      if (!v) continue;
      const scale = age < 150 ? easeOutBack(age / 150) : 1;
      const alpha = sp > 0.72 ? Math.max(0, (1 - sp) / 0.28) : 1;
      const size = Math.round(12 + Math.min(28, v * 0.35));
      const sx = offsetX + (x + 0.5) * cell;
      const sy = offsetY + (y + 0.5) * cell - easeOutCubic(sp) * cell * 1.2;
      const col = v >= 300 ? 'rgba(200,130,255,1)' : v >= 100 ? 'rgba(255,210,60,1)' : 'rgba(255,255,255,1)';
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(sx, sy);
      if (scale !== 1) ctx.scale(scale, scale);
      ctx.font = `700 ${size}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.95)';
      ctx.strokeText(`+${v}`, 0, 0);
      ctx.fillStyle = col;
      ctx.fillText(`+${v}`, 0, 0);
      ctx.restore();
      continue;
    }

    const p = Math.max(0, Math.min(1, age / life));
    const cx = offsetX + (x + 0.5) * cell;
    const cy = offsetY + (y + 0.5) * cell;
    const knd = knd0;

    // Гибель: тот же drawDeathFx, что и в превью магазина.
    if (knd.startsWith('die')) {
      const dieId = cosClampId(Number(knd.slice(3)) || 0);
      const owner = Number(fx.pid);
      const ownerHsl = boostHsl(colors.get(owner) || 'hsl(210 20% 60%)');
      drawDeathFx(ctx, cx, cy, cell * (0.6 + fxIntensity * 0.7), ownerHsl, dieId, p);
      continue;
    }

    const isCap = knd.startsWith('cap');
    const base = cell * (knd === 'kill' ? 1.1 : isCap ? 1.05 : 0.85);
    const r = base * (0.35 + 1.25 * p) * (0.35 + fxIntensity * 0.95);
    const a = (1 - p) * (0.55 + 0.45 * fxIntensity);

    // Захват: тот же drawCaptureFx, что и в превью магазина. Цвет берётся
    // от игрока, совершившего захват (варианты 5..7 — со своей палитрой).
    if (isCap) {
      const capId = cosClampId(knd.slice(3));
      const owner = Number(fx.pid);
      const ownerHsl = boostHsl(colors.get(owner) || colors.get(you) || 'hsl(210 20% 60%)');
      const capCell = cell * (0.35 + fxIntensity * 0.95);
      drawCaptureFx(ctx, cx, cy, capCell, ownerHsl, capId, p);
      continue;
    }

    let col = 'rgba(255,215,0,0.92)';
    if (knd === 'kill') col = 'rgba(255,45,85,0.95)';
    // F5: возврат остывшей земли — холодный голубой, а не «золото захвата».
    else if (knd === 'reclaim') col = 'rgba(120,220,255,0.96)';
    else if (knd === 'use') col = 'rgba(0,255,255,0.95)';
    else if (knd === 'pickup2') col = 'rgba(255,215,0,0.95)';
    else if (knd === 'pickup4') col = 'rgba(190,150,255,0.96)';

    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(1, cell * 0.10);
    if (knd === 'pickup4') {
      ctx.lineWidth = Math.max(2, cell * 0.10);
      for (let k = 0; k < 10; k++) {
        const ang = p * 2.0 + (k * Math.PI * 2) / 10;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * r * 0.30, cy + Math.sin(ang) * r * 0.30);
        ctx.lineTo(cx + Math.cos(ang) * r * 1.05, cy + Math.sin(ang) * r * 1.05);
        ctx.stroke();
      }
      ctx.globalAlpha = a * 0.85;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.95, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = a * 0.45;
      ctx.lineWidth = Math.max(1, cell * 0.06);
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
      ctx.stroke();
    } else if (knd === 'pickup2') {
      ctx.lineWidth = Math.max(2, cell * 0.09);
      ctx.setLineDash([Math.max(2, cell * 0.10), Math.max(2, cell * 0.10)]);
      ctx.lineDashOffset = -nowFrame * 0.03;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function perfValueSpan(text, bad) {
  const cls = bad ? 'perfBad' : 'perfOk';
  return `<span class="perfValue ${cls}">${text}</span>`;
}

/* Панель #perf: FPS/пинг/трафик/тики. Вынесено из конца draw() (public/
   client.js) — draw() по-прежнему вызывает её последней строкой, передавая
   уже собранные метрики кадра (roomId/fps/pingMs/upBps/downBps/tickrate/
   tickMs) и функцию перевода t(). Сама draw() решает, звать ли её вообще —
   ранний return при !perfEnabled остаётся в draw(), сюда не переехал.

   Не тянет ничего из client.js через замыкание — весь верхний уровень
   собственный, поэтому держит tests/client_draw_wiring.test.mjs зелёным
   тем же способом, что computeDrawCamera()/paintTerrain()/paintEntities()/
   paintFieldFx(). */
export function renderPerfPanel(perfEl, metrics, t) {
  const { roomId, fps, pingMs, upBps, downBps, tickrate, tickMs } = metrics;

  const pingText = pingMs == null ? '…' : `${pingMs.toFixed(0)}ms`;
  const upText = formatRateOf(upBps);
  const downText = formatRateOf(downBps);
  const tr = tickrate ? `${tickrate.toFixed(1)}` : '…';
  const sr = tickMs ? `${(1000 / tickMs).toFixed(1)}` : '…';
  const rid = roomId == null ? '…' : String(roomId);

  const fpsText = fps ? fps.toFixed(0) : '…';
  const srvNum = tickMs ? 1000 / tickMs : null;
  const tickBad = srvNum != null && tickrate ? tickrate < srvNum * 0.8 : tr === '…';

  const roomBad = roomId == null;
  const fpsBad = fps ? fps < 30 : fpsText === '…';
  const pingBad = pingMs == null ? true : pingMs > 150;
  const upBad = upText === '…';
  const downBad = downText === '…';
  const srvBad = srvNum == null;

  setSafeHtml(perfEl, `
    <div class="perfRow">${escapeHtml(t('perf.room'))}: ${perfValueSpan(rid, roomBad)}</div>
    <div class="perfRow">${escapeHtml(t('perf.fps'))}: ${perfValueSpan(fpsText, fpsBad)}</div>
    <div class="perfRow">${escapeHtml(t('perf.ping'))}: ${perfValueSpan(pingText, pingBad)}</div>
    <div class="perfRow">${escapeHtml(t('perf.traffic'))}: ↑ ${perfValueSpan(upText, upBad)}&nbsp;&nbsp;↓ ${perfValueSpan(downText, downBad)}</div>
    <div class="perfRow">${escapeHtml(t('perf.ticks'))}: ${perfValueSpan(tr, tickBad)} (${escapeHtml(t('perf.server'))} ${perfValueSpan(sr, srvBad)})</div>
  `);
}
