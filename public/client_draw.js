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
import { cellSizeFor, followCamera, decayShake, visibleBounds, clampToRoi } from './client_field_view.js';

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
