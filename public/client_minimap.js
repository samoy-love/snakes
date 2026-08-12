/* Миникарта: зоны интереса (топ-1 и цель баунти) и отрисовка канваса.

   Раньше всё жило в client.js и захватывало глобалы (mmCtx, W, H, colors,
   you, botIds, bountyTarget, буферы пикселей и флаги «грязного» кадра)
   напрямую. По образцу public/client_field_view.js данные и канвас-контекст
   передаются как аргументы — так логику зон и отрисовку можно проверить без
   живого DOM.

   Мутируемые буферы миникарты (image data, буфер владельцев клеток, кэш RGB)
   передаются по ссылке и правятся на месте, как и раньше. Примитивные флаги
   (dirty/hadChunkUpdate) не мутируются через захват — вызывающая сторона
   передаёт текущие значения и получает обратно новые. */

import { boostHsl, hslToRgb } from './client_color.js';
import { sortPlayersByScore } from './client_stats.js';
import { clampInt } from './client_util.js';

const MINIMAP_ZONE_REFRESH_MIN_MS = 14000;
const MINIMAP_ZONE_REFRESH_MAX_MS = 24000;

const MINIMAP_TOP1_SWITCH_COOLDOWN_MS = 4500;

export const MINIMAP_ZONE_ICON_TOP1 = '👑';
export const MINIMAP_ZONE_ICON_BOUNTY = '🎯';

function minimapZoneRadiusCells(W, H) {
  const base = Math.round(Math.min(W, H) * 0.085);
  return clampInt(base, 28, 90);
}

function rndDisk(r) {
  const a = Math.random() * Math.PI * 2;
  const rr = Math.sqrt(Math.random()) * r;
  return { x: Math.cos(a) * rr, y: Math.sin(a) * rr };
}

function scheduleNextZoneUpdate(now) {
  const span = MINIMAP_ZONE_REFRESH_MAX_MS - MINIMAP_ZONE_REFRESH_MIN_MS;
  return now + MINIMAP_ZONE_REFRESH_MIN_MS + Math.random() * Math.max(0, span);
}

function ensureZoneState(prev, pid, px, py, now, W, H) {
  const r = minimapZoneRadiusCells(W, H);

  let needUpdate = !prev || prev.pid !== pid || prev.r !== r;
  if (!needUpdate) {
    if (now >= (prev.nextAt || 0)) needUpdate = true;
  }

  if (!needUpdate) return prev;

  const off = rndDisk(r * 0.85);
  const cx = clampInt((Number(px) || 0) + off.x, 0, Math.max(0, W - 1));
  const cy = clampInt((Number(py) || 0) + off.y, 0, Math.max(0, H - 1));
  return {
    pid,
    r,
    cx,
    cy,
    trueX: Number(px) || 0,
    trueY: Number(py) || 0,
    nextAt: scheduleNextZoneUpdate(now)
  };
}

function drawZoneCircle(mmCtx, W, H, cx, cy, r, stroke, fill, icon) {
  if (cx < 0 || cy < 0 || cx >= W || cy >= H) return;

  mmCtx.save();
  mmCtx.beginPath();
  mmCtx.arc(cx + 0.5, cy + 0.5, r, 0, Math.PI * 2);
  mmCtx.fillStyle = fill;
  mmCtx.fill();
  mmCtx.strokeStyle = stroke;
  mmCtx.lineWidth = 2;
  mmCtx.stroke();

  if (icon) {
    mmCtx.font = '8px ui-sans-serif, system-ui, sans-serif';
    mmCtx.textAlign = 'center';
    mmCtx.textBaseline = 'middle';
    mmCtx.fillStyle = 'rgba(0,0,0,0.70)';
    mmCtx.fillText(icon, cx + 1.0, cy + 1.0);
    mmCtx.fillStyle = 'rgba(255,255,255,0.92)';
    mmCtx.fillText(icon, cx + 0.5, cy + 0.5);
  }

  mmCtx.restore();
}

/**
 * Зоны интереса миникарты: пин на текущего лидера и на цель баунти.
 *
 * clientState мутируется на месте (как и остальной код клиента, см.
 * client_state.js) — там же живут пины между кадрами.
 */
function drawMinimapZones(mmCtx, clientState, bountyTarget, W, H) {
  if (!clientState.lastState?.players?.length) return;
  const now = performance.now();

  const ordered = sortPlayersByScore(clientState.lastState.players);
  const candidateTop1 = ordered.find((p) => p && p.a) || null;
  if (!candidateTop1) {
    clientState.minimapTop1PinnedId = 0;
    clientState.minimapTop1NextSwitchAt = 0;
    clientState.minimapTop1Zone = null;
  } else {
    if (!clientState.minimapTop1PinnedId) {
      clientState.minimapTop1PinnedId = candidateTop1.n;
      clientState.minimapTop1NextSwitchAt = now + MINIMAP_TOP1_SWITCH_COOLDOWN_MS;
    }

    const pinned = clientState.lastState.players.find((p) => p && p.a && p.n === clientState.minimapTop1PinnedId) || null;
    if (!pinned) {
      clientState.minimapTop1PinnedId = candidateTop1.n;
      clientState.minimapTop1NextSwitchAt = now + MINIMAP_TOP1_SWITCH_COOLDOWN_MS;
      clientState.minimapTop1Zone = ensureZoneState(clientState.minimapTop1Zone, candidateTop1.n, candidateTop1.x, candidateTop1.y, now, W, H);
    } else if (candidateTop1.n === clientState.minimapTop1PinnedId) {
      clientState.minimapTop1Zone = ensureZoneState(clientState.minimapTop1Zone, pinned.n, pinned.x, pinned.y, now, W, H);
    } else {
      if (now >= clientState.minimapTop1NextSwitchAt) {
        clientState.minimapTop1PinnedId = candidateTop1.n;
        clientState.minimapTop1NextSwitchAt = now + MINIMAP_TOP1_SWITCH_COOLDOWN_MS;
        clientState.minimapTop1Zone = ensureZoneState(clientState.minimapTop1Zone, candidateTop1.n, candidateTop1.x, candidateTop1.y, now, W, H);
      } else {
        clientState.minimapTop1Zone = ensureZoneState(clientState.minimapTop1Zone, pinned.n, pinned.x, pinned.y, now, W, H);
      }
    }
  }

  const btId = Number(bountyTarget) || 0;
  if (btId !== (clientState.minimapLastBountyTarget || 0)) {
    clientState.minimapLastBountyTarget = btId;
    clientState.minimapBountyZone = null;
  }

  if (btId) {
    const bt = clientState.lastState.players.find((p) => p && p.n === btId) || null;
    if (!bt || !bt.a) {
      clientState.minimapBountyZone = null;
    } else {
      clientState.minimapBountyZone = ensureZoneState(clientState.minimapBountyZone, bt.n, bt.x, bt.y, now, W, H);
    }
  } else {
    clientState.minimapBountyZone = null;
  }

  if (clientState.minimapTop1Zone && clientState.minimapBountyZone && clientState.minimapTop1Zone.pid === clientState.minimapBountyZone.pid) {
    clientState.minimapTop1Zone = null;
  }

  if (clientState.minimapTop1Zone) {
    drawZoneCircle(
      mmCtx,
      W,
      H,
      clientState.minimapTop1Zone.cx,
      clientState.minimapTop1Zone.cy,
      clientState.minimapTop1Zone.r,
      'rgba(255, 215, 0, 0.35)',
      'rgba(255, 215, 0, 0.05)',
      MINIMAP_ZONE_ICON_TOP1
    );
  }
  if (clientState.minimapBountyZone) {
    drawZoneCircle(
      mmCtx,
      W,
      H,
      clientState.minimapBountyZone.cx,
      clientState.minimapBountyZone.cy,
      clientState.minimapBountyZone.r,
      'rgba(255, 59, 48, 0.35)',
      'rgba(255, 59, 48, 0.06)',
      MINIMAP_ZONE_ICON_BOUNTY
    );
  }
}

/* УХ33: своя территория выделяется насыщеннее чужой — не притемняем её тем же
   множителем 0.50, чтобы цвет читался ярче остальных владений. */
export function setMinimapPixel(i, { minimapImage, minimapGridOwner, you, colors, minimapOwnerRgbCache, gridCellOwner, gridCellIsCooling }) {
  if (!minimapImage || !minimapGridOwner) return;
  const raw = minimapGridOwner[i];
  const cooling = gridCellIsCooling(raw);
  const o = gridCellOwner(raw);
  let r = 12;
  let g = 16;
  let b = 20;
  if (o !== 0) {
    const isMine = you && o === you;
    let rgb = minimapOwnerRgbCache.get(o);
    if (!rgb) {
      const c = boostHsl(colors.get(o) || 'hsl(210 20% 60%)');
      const raw2 = hslToRgb(c);
      const mul = isMine ? 0.82 : 0.50;
      rgb = [Math.round(raw2[0] * mul), Math.round(raw2[1] * mul), Math.round(raw2[2] * mul)];
      minimapOwnerRgbCache.set(o, rgb);
    }
    // Остывающая территория на миникарте заметно тусклее «живой».
    const k = cooling ? 0.42 : 1;
    r = Math.round(rgb[0] * k) + (cooling ? 10 : 0);
    g = Math.round(rgb[1] * k) + (cooling ? 10 : 0);
    b = Math.round(rgb[2] * k) + (cooling ? 10 : 0);
  }
  const di = i * 4;
  const data = minimapImage.data;
  data[di] = r;
  data[di + 1] = g;
  data[di + 2] = b;
  data[di + 3] = 255;
}

/**
 * Полная перерисовка миникарты: буфер владельцев клеток, живые игроки,
 * рамка текущего обзора, зоны интереса и своя точка поверх всего.
 *
 * Примитивные флаги dirty/hadChunkUpdate передаются значением и возвращаются
 * в результате — вызывающий (client_minimap_ui.js) обязан переписать ими свои
 * поля стора, т.к. по ссылке примитив не мутируется.
 */
export function drawMinimap(mmCtx, deps) {
  const {
    minimapImage,
    minimapGridOwner,
    clientState,
    minimapDirty,
    N,
    you,
    colors,
    botIds,
    bountyTarget,
    minimapOwnerRgbCache,
    gridCellOwner,
    gridCellIsCooling,
    viewMinX,
    viewMinY,
    viewMaxX,
    viewMaxY,
    W,
    H,
    syncMinimapOverlayCanvas
  } = deps;

  if (!minimapImage || !minimapGridOwner || !clientState.lastState) {
    return { dirty: minimapDirty, hadChunkUpdate: deps.minimapHadChunkUpdate };
  }

  let dirty = minimapDirty;
  if (dirty) {
    dirty = false;
    for (let i = 0; i < N; i++) {
      setMinimapPixel(i, { minimapImage, minimapGridOwner, you, colors, minimapOwnerRgbCache, gridCellOwner, gridCellIsCooling });
    }
  }

  mmCtx.putImageData(minimapImage, 0, 0);

  // I3: на миникарте видны все живые игроки, а не только ты.
  // Свою точку рисуем последней и крупнее (ниже, после рамки обзора).
  for (const p of clientState.lastState.players) {
    if (!p.a) continue;
    if (p.n === you) continue;
    if (p.x < 0 || p.y < 0 || p.x >= W || p.y >= H) continue;
    const c = boostHsl(colors.get(p.n) || p.c || 'hsl(210 20% 60%)');
    const rgb = hslToRgb(c);
    const isBot = botIds.has(p.n);
    const isBounty = !!(bountyTarget && p.n === bountyTarget);

    // Тёмная подложка, чтобы точка читалась на своей же территории.
    mmCtx.fillStyle = 'rgba(0,0,0,0.62)';
    mmCtx.fillRect(p.x - 1, p.y - 1, 3, 3);
    mmCtx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${isBot ? 0.62 : 0.98})`;
    mmCtx.fillRect(p.x, p.y, isBot ? 1 : 2, isBot ? 1 : 2);

    if (isBounty) {
      mmCtx.save();
      mmCtx.strokeStyle = 'rgba(255,90,60,0.95)';
      mmCtx.lineWidth = 1;
      mmCtx.strokeRect(p.x - 2.5, p.y - 2.5, 6, 6);
      mmCtx.restore();
    }
  }

  mmCtx.save();
  mmCtx.lineWidth = 1;
  const w = Math.max(1, viewMaxX - viewMinX + 1);
  const h = Math.max(1, viewMaxY - viewMinY + 1);
  mmCtx.strokeStyle = 'rgba(0,0,0,0.70)';
  mmCtx.lineWidth = 3;
  mmCtx.strokeRect(viewMinX + 0.5, viewMinY + 0.5, w - 1, h - 1);
  mmCtx.strokeStyle = 'rgba(255,255,255,0.90)';
  mmCtx.lineWidth = 1;
  mmCtx.strokeRect(viewMinX + 0.5, viewMinY + 0.5, w - 1, h - 1);

  try {
    drawMinimapZones(mmCtx, clientState, bountyTarget, W, H);
  } catch {}

  const me = clientState.lastState.players.find((p) => p.n === you && p.a);
  if (me) {
    mmCtx.fillStyle = 'rgba(0,0,0,0.72)';
    mmCtx.fillRect(me.x - 2, me.y - 2, 5, 5);
    mmCtx.fillStyle = 'rgba(255,255,255,0.96)';
    mmCtx.fillRect(me.x - 1, me.y - 1, 3, 3);
    mmCtx.fillStyle = 'rgba(0,0,0,0.70)';
    mmCtx.fillRect(me.x, me.y, 1, 1);
  }
  mmCtx.restore();

  syncMinimapOverlayCanvas();

  return { dirty, hadChunkUpdate: false };
}
