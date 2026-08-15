/* DOM-обвязка магазина косметики: показ/скрытие оверлея, синхронизация
   списка предметов и большое превью выбранного облика. Вынесено из client.js
   — вызовы и порядок выполнения не менялись, только источник импорта.
   Чистая логика (цены, тиры, инвентарь, desired-состояние) остаётся в
   client_cos_*.js, здесь только рендер и обработчики событий.

   Раньше каждая функция принимала deps — объект на сотню ключей с геттерами и
   сеттерами состояния client.js, узлами разметки и ссылками на соседние
   модули. Собирался он заново на каждый вызов, а любое переименование поля в
   client.js молча превращалось в undefined на этой стороне. Теперь состояние
   берётся из client_store.js по ссылке, узлы — из client_dom.js, а обвязка
   магазина — из client_shop.js. Кольцо импортов с client_shop.js безопасно:
   на верхнем уровне обоих файлов друг у друга ничего не вызывается. */

import { cos, session, world } from './client_store.js';
import { dom } from './client_dom.js';
import { escapeHtml, overlayManager, setSafeHtml } from './client_util.js';
import { t, tfmt } from './client_i18n_rt.js';
import { fmtInt } from './client_labels.js';
import { formatGroupedCount } from './client_format.js';
import { syncOverlayUiState } from './client_overlays.js';
import { boostHsl, hslToRgb } from './client_color.js';
import { COSMETICS_MAX_ID, tierClass } from './client_cos_model.js';
import { buyButtonState, equipButtonState, visibleItems } from './client_cos_ui.js';
import { COS_TITLE_MAX, cosTitleName, cosTitlePrefix, cosTitleReq } from './client_identity.js';
import {
  COS_DEATH_MS,
  COS_FONT,
  cosClampId,
  cosPrepCanvas,
  drawCaptureFx,
  drawDeathFx,
  drawFrameRow,
  drawHead,
  drawNamePlate,
  drawSegTile,
  drawTerrSeam,
  drawTerrTile
} from './client_cos_draw.js';
import {
  COSMETICS_TABS,
  COSMETICS_TAB_ICON_BY_CAT,
  cosmeticsBuyLocal,
  cosmeticsCacheSave,
  cosmeticsEnsureLocalReady,
  cosmeticsEqForCat,
  cosmeticsEquipLocal,
  cosmeticsFormatCost,
  cosmeticsLabel,
  cosmeticsMaskForCat,
  cosmeticsOpBegin,
  cosmeticsOpClear,
  cosmeticsOpIsPending,
  cosmeticsOwnedCount,
  cosmeticsServerReady,
  cosmeticsSetDesiredEq,
  cosmeticsTierLabel,
  cosmeticsVariantName,
  scheduleMenuSkinPreview,
  setCosmeticsStatus,
  wsIsConnected,
  wsSend,
  youCos
} from './client_shop.js';

/* Пропорции единой сцены предпросмотра (магазин и панель «Ваш облик» в меню
   рисуют один и тот же кусок поля в одном масштабе). */
export const COS_SCENE = {
  pad: 0.07,
  zoneX: 0.05,
  zoneY: 0.20,
  zoneW: 0.46,
  zoneH: 0.58,
  cellK: 0.13,
  cellMin: 14,
  cellMax: 34,
  cellRefMin: 186
};

/* Подложка поля сцены предпросмотра — сетка и виньетка под цвет игрового поля. */
function drawCosmeticsFieldBackdrop(ctx2, x, y, w, h, step, originX, originY) {
  ctx2.save();
  const bg = ctx2.createLinearGradient(x, y, x + w, y + h);
  bg.addColorStop(0, '#05100f');
  bg.addColorStop(0.55, '#060a12');
  bg.addColorStop(1, '#0a0714');
  ctx2.fillStyle = bg;
  ctx2.fillRect(x, y, w, h);

  const cell = Math.max(8, Math.round(Number(step) || 18));
  const ox = Number.isFinite(originX) ? originX : x;
  const oy = Number.isFinite(originY) ? originY : y;

  ctx2.strokeStyle = 'rgba(120,220,190,0.055)';
  ctx2.lineWidth = 1;
  for (let px = ox - Math.ceil((ox - x) / cell) * cell; px < x + w; px += cell) {
    if (px <= x) continue;
    ctx2.beginPath();
    ctx2.moveTo(Math.round(px) + 0.5, y);
    ctx2.lineTo(Math.round(px) + 0.5, y + h);
    ctx2.stroke();
  }
  for (let py = oy - Math.ceil((oy - y) / cell) * cell; py < y + h; py += cell) {
    if (py <= y) continue;
    ctx2.beginPath();
    ctx2.moveTo(x, Math.round(py) + 0.5);
    ctx2.lineTo(x + w, Math.round(py) + 0.5);
    ctx2.stroke();
  }

  const vg = ctx2.createRadialGradient(
    x + w * 0.5, y + h * 0.5, Math.min(w, h) * 0.20,
    x + w * 0.5, y + h * 0.5, Math.max(w, h) * 0.72
  );
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx2.fillStyle = vg;
  ctx2.fillRect(x, y, w, h);

  ctx2.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx2.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx2.restore();
}

/* Территория в сцене предпросмотра — теми же плитками, что и в игре. */
function drawCosmeticsZone(ctx2, rect, ownerId, alpha, terrId, cellHint) {
  const base = boostHsl(world.colors.get(ownerId) || 'hsl(210 20% 60%)');
  const id = cosClampId(terrId);
  const a = Math.max(0, Math.min(1, alpha));
  const now = performance.now();
  const cell = Math.max(8, Math.round(Number(cellHint) || 16));
  const cols = Math.max(1, Math.ceil(rect.w / cell));
  const rows = Math.max(1, Math.ceil(rect.h / cell));
  ctx2.save();
  ctx2.beginPath();
  ctx2.rect(rect.x, rect.y, rect.w, rect.h);
  ctx2.clip();
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      drawTerrTile(ctx2, rect.x + gx * cell, rect.y + gy * cell, cell, base, id, gx, gy, a, now);
    }
  }
  const rgbB = hslToRgb(base);
  ctx2.globalAlpha = Math.min(0.5, a * 0.42);
  ctx2.fillStyle = `rgb(${rgbB[0]},${rgbB[1]},${rgbB[2]})`;
  const inset = Math.max(1, (cell * 0.18) | 0);
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      ctx2.fillRect(rect.x + gx * cell + inset, rect.y + gy * cell + inset, cell - inset * 2, cell - inset * 2);
    }
  }
  ctx2.globalAlpha = 1;
  ctx2.restore();

  if (id === 5) {
    ctx2.save();
    const rgb = hslToRgb(base);
    ctx2.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx2.shadowColor = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    ctx2.shadowBlur = 14;
    ctx2.lineWidth = 3;
    ctx2.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
    ctx2.restore();
  }
}

/* Змейка в сцене предпросмотра: голова + хвост, обрезанный там, где ложится
   на уже нарисованную территорию. */
function drawCosmeticsSnake(ctx2, headX, headY, cell, ownerId, segId, headId, headColor, tileCount, zone) {
  const base = boostHsl(world.colors.get(ownerId) || 'hsl(210 20% 60%)');
  const c = headColor || base;
  const scell = Math.max(14, Math.round(cell));
  const now = performance.now();
  const tiles = Math.max(3, Math.min(12, Number(tileCount) || 6));
  const headLeft = headX - scell / 2;
  const zoneRight = zone ? zone.x + zone.w : headLeft;
  for (let i = 0; i < tiles; i++) {
    const tileLeft = headLeft - (i + 1) * scell;
    if (tileLeft + scell <= zoneRight) continue;
    drawSegTile(ctx2, tileLeft, headY - scell / 2, scell, base, segId, i + 17, 0.88, now);
  }
  drawHead(ctx2, headX, headY, scell, c, headId, 1, 0, now);
}

/* Единая сцена предпросмотра — кусок игрового поля: своя территория, из неё
   выезжает змейка нормального размера, над головой плашка с ником. */
export function drawCosmeticsScene(ctx2, rect, opts) {
  const { x: fx, y: fy, w: fw, h: fh } = rect;
  const {
    cat = '',
    label = '',
    now = 0,
    reduceMotion = false,
    highlight = false,
    ids = {}
  } = opts || {};

  const baseC = boostHsl(world.colors.get(session.you) || 'hsl(210 20% 60%)');
  const scell = Math.max(
    COS_SCENE.cellMin,
    Math.min(COS_SCENE.cellMax, Math.round(COS_SCENE.cellRefMin * COS_SCENE.cellK))
  );

  const zone = {
    x: Math.round(fx + fw * COS_SCENE.zoneX),
    y: Math.round(fy + fh * COS_SCENE.zoneY),
    w: Math.max(scell * 2, Math.round((fw * COS_SCENE.zoneW) / scell) * scell),
    h: Math.max(scell * 2, Math.round((fh * COS_SCENE.zoneH) / scell) * scell)
  };

  drawCosmeticsFieldBackdrop(ctx2, fx, fy, fw, fh, scell, zone.x, zone.y);

  ctx2.save();
  ctx2.beginPath();
  ctx2.rect(fx, fy, fw, fh);
  ctx2.clip();

  const plateFont = Math.max(11, Math.round(scell * 0.62));
  const headRow = Math.max(0, Math.floor(zone.h / scell / 2));
  const headX = Math.round(zone.x + zone.w + scell * 2.5);
  const headY = Math.round(zone.y + headRow * scell + scell / 2);

  const period = 2400;
  const p = reduceMotion ? 0.55 : (now % period) / period;

  if (cat === 'death') {
    drawCosmeticsZone(ctx2, zone, session.you, 0.55, ids.terr, scell);
    const dieStart = 0.45;
    const dieP = p < dieStart ? -1 : Math.min(1, (p - dieStart) / (COS_DEATH_MS / period));
    if (dieP < 0) {
      drawCosmeticsSnake(ctx2, headX, headY, scell, session.you, ids.seg, ids.head, baseC, 6, zone);
      drawNamePlate(ctx2, label, headX, headY - scell * 0.95, baseC, ids.nameplate, 0.95, plateFont, now);
    } else {
      drawDeathFx(ctx2, headX, headY, Math.max(16, Math.round(scell * 1.25)), baseC, ids.death, dieP);
    }
    ctx2.restore();
    return { scell, zone, headX, headY };
  }

  drawCosmeticsZone(ctx2, zone, session.you, 0.55, ids.terr, scell);
  drawCosmeticsSnake(ctx2, headX, headY, scell, session.you, ids.seg, ids.head, baseC, cat === 'seg' ? 8 : 6, zone);
  drawNamePlate(ctx2, label, headX, headY - scell * 0.95, baseC, ids.nameplate, 0.95, plateFont, now);

  const burstStart = 0.58;
  const burstP = p < burstStart ? -1 : (p - burstStart) / (650 / period);
  if (burstP >= 0 && burstP <= 1) {
    drawCaptureFx(
      ctx2,
      zone.x + zone.w * 0.5,
      zone.y + zone.h * 0.5,
      Math.max(18, Math.round(scell * 1.35)),
      baseC,
      ids.capturefx,
      burstP
    );
  }

  if (highlight) {
    ctx2.save();
    ctx2.strokeStyle = 'rgba(46, 230, 160, 0.60)';
    ctx2.setLineDash([5, 4]);
    ctx2.lineWidth = 2;
    if (cat === 'head') {
      ctx2.beginPath();
      ctx2.arc(headX, headY, scell * 0.82, 0, Math.PI * 2);
      ctx2.stroke();
    } else if (cat === 'nameplate' || cat === 'title') {
      const ph = Math.round(plateFont * 1.5);
      ctx2.strokeRect(headX - scell * 2.4, headY - scell * 0.95 - ph - 4, scell * 4.8, ph + 8);
    } else if (cat === 'seg') {
      const segRight = headX - scell / 2;
      const segLeft = Math.max(zone.x + zone.w, segRight - scell * 8);
      ctx2.strokeRect(segLeft, headY - scell * 0.62, segRight - segLeft, scell * 1.24);
    } else if (cat === 'terr') {
      ctx2.strokeRect(zone.x + 1, zone.y + 1, zone.w - 2, zone.h - 2);
    }
    ctx2.restore();
  }

  ctx2.restore();
  return { scell, zone, headX, headY };
}

function cosmeticsFrameSampleName(i) {
  return i === 1 ? t('cosmetics.balance_you') : `${t('leaderboard.player')} ${i + 2}`;
}

/* Сцена предпросмотра рамки профиля — таблица лидеров в миниатюре. */
function drawCosmeticsFramesScene(ctx2, w, h, frameId) {
  const pad = Math.round(Math.min(w, h) * 0.09);
  const th = Math.max(22, Math.round(h * 0.12));
  const rowH = Math.max(22, Math.round(h * 0.12));
  const rows = 4;
  const tw = w - pad * 2;
  const tx = pad;
  const ty = Math.round((h - (th + rows * rowH)) / 2);

  ctx2.save();
  ctx2.fillStyle = 'rgba(0,0,0,0.26)';
  ctx2.fillRect(tx, ty, tw, th + rows * rowH);
  ctx2.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx2.lineWidth = 1;
  ctx2.strokeRect(tx + 0.5, ty + 0.5, tw - 1, th + rows * rowH - 1);

  ctx2.fillStyle = 'rgba(0,0,0,0.34)';
  ctx2.fillRect(tx, ty, tw, th);
  ctx2.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx2.beginPath();
  ctx2.moveTo(tx, ty + th + 0.5);
  ctx2.lineTo(tx + tw, ty + th + 0.5);
  ctx2.stroke();

  ctx2.font = `12px ${COS_FONT}`;
  ctx2.fillStyle = 'rgba(255,255,255,0.86)';
  ctx2.textBaseline = 'middle';
  ctx2.textAlign = 'left';
  ctx2.fillText('#', tx + 12, ty + th / 2);
  ctx2.fillText(t('leaderboard.player'), tx + 34, ty + th / 2);
  ctx2.textAlign = 'right';
  ctx2.fillText(t('leaderboard.cells'), tx + tw - 12, ty + th / 2);
  ctx2.restore();

  const youRow = 1;
  for (let i = 0; i < rows; i++) {
    drawFrameRow(
      ctx2,
      tx,
      ty + th + i * rowH,
      tw,
      rowH,
      frameId,
      i + 1,
      cosmeticsFrameSampleName(i),
      fmtInt(1200 - i * 180),
      i === youRow
    );
  }
}

/* Одна функция на категорию для мини-иконки карточки в списке, вместо
   цепочки if (cat === ...). Ключи — COSMETICS_TABS (без 'title', у титулов
   своя иконка-медаль в разметке карточки, см. renderCosmeticsTitlesImpl ниже
   по файлу) — забытая категория провалит tests/client_cosmetics_cats_usage. */
const MINI_COSMETIC_PREVIEW_BY_CAT = {
  frame(c, { W, id }) {
    drawFrameRow(c, 2, 8, W - 4, 13, id, 1, '', '', false);
    drawFrameRow(c, 2, 22, W - 4, 14, id, 2, '', '', true);
  },
  capturefx(c, { cx, cy, base, id, now }) {
    const p = ((now % 1400) / 1400);
    c.save();
    c.translate(0, 0);
    drawCaptureFx(c, cx, cy, 13, base, id, p);
    c.restore();
  },
  seg(c, { cy, base, id, now }) {
    const cell = 10;
    for (let i = 0; i < 3; i++) {
      drawSegTile(c, 2 + i * cell, cy - cell / 2, cell, base, id, i, 0.95, now);
    }
    drawHead(c, 2 + 3 * cell + cell * 0.55, cy, cell, base, 0, 1, 0, now);
  },
  nameplate(c, { cx, cy, base, id, now }) {
    drawNamePlate(c, 'YOU', cx, cy + 9, base, id, 0.98, 10, now);
  },
  head(c, { cx, cy, base, id, now }) {
    drawHead(c, cx - 3, cy, 34, base, id, 1, 0, now);
  },
  terr(c, { W, H, base, id, now }) {
    const cell = 20;
    const ox = (W - cell * 2) / 2;
    const oy = (H - cell * 2) / 2;
    for (let gy = 0; gy < 2; gy++) {
      for (let gx = 0; gx < 2; gx++) {
        drawTerrTile(c, ox + gx * cell, oy + gy * cell, cell, base, id, gx, gy, 0.72, now);
      }
    }
    if (cosClampId(id) === 5) {
      drawTerrSeam(c, ox, oy, cell * 2, base, 15, 0.9, true);
    }
  },
  death(c, { cx, cy, base, id }) {
    drawDeathFx(c, cx, cy, 11, base, id, 0.42);
  },
  title(c, { cx, cy, id }) {
    c.save();
    c.font = `700 11px ${COS_FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.fillText(id === 0 ? '—' : '«»', cx, cy);
    c.restore();
  }
};

/* Мини-превью в карточке списка магазина. */
function drawMiniCosmeticPreview(canvasEl, cat, id) {
  if (!canvasEl) return;
  const W = 44;
  const H = 44;
  const c = cosPrepCanvas(canvasEl, W, H);
  if (!c) return;
  c.fillStyle = 'rgba(0,0,0,0.26)';
  c.fillRect(0, 0, W, H);

  const draw = MINI_COSMETIC_PREVIEW_BY_CAT[cat];
  if (!draw) return;
  draw(c, {
    W,
    H,
    cx: W / 2,
    cy: H / 2,
    base: boostHsl(world.colors.get(session.you) || 'hsl(210 20% 60%)'),
    now: performance.now(),
    id
  });
}

/* Какой id показывать в большом превью: у титулов свой потолок (16, а не 8). */
function cosmeticsPreviewIdImpl() {
  const cat = cos.cat;
  const clamp = cat === 'title'
    ? (v) => Math.max(0, Math.min(COS_TITLE_MAX, Number(v) || 0))
    : cosClampId;
  return clamp(cos.selId);
}

/* Большое превью выбранного/наведённого предмета. Ни одной собственной
   отрисовки предметов: всё рисуют drawSegTile/drawHead/drawNamePlate/
   drawCaptureFx/drawFrameRow — то же самое, что и игровой цикл. */
function renderCosmeticsPreviewImpl() {
  if (!dom.cosmeticsPreview) return;
  const cssW = Math.max(200, Math.round(dom.cosmeticsPreview.clientWidth || 420));
  const cssH = Math.max(140, Math.round(dom.cosmeticsPreview.clientHeight || 260));
  const ctx2 = cosPrepCanvas(dom.cosmeticsPreview, cssW, cssH);
  if (!ctx2) return;

  const reduceMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const now = reduceMotion ? 0 : performance.now();
  const selId = cosmeticsPreviewIdImpl();
  const cat = cos.cat;

  const setHint = () => {
    if (!dom.cosmeticsHint) return;
    dom.cosmeticsHint.textContent = `${cosmeticsLabel(cat)}: ${cosmeticsVariantName(cat, selId)}`;
  };

  if (cat === 'frame') {
    drawCosmeticsFramesScene(ctx2, cssW, cssH, selId);
    setHint();
    return;
  }

  const pick = (c, equipped) => (cat === c ? selId : equipped);
  const titleId = pick('title', cos.titleId);

  const pad = Math.round(Math.min(cssW, cssH) * COS_SCENE.pad);
  drawCosmeticsScene(
    ctx2,
    { x: pad, y: pad, w: cssW - pad * 2, h: cssH - pad * 2 },
    {
      cat,
      label: `${cosTitlePrefix(titleId)}${t('cosmetics.balance_you')}`,
      now,
      reduceMotion,
      highlight: true,
      ids: {
        head: pick('head', youCos.eq.head),
        seg: pick('seg', youCos.eq.seg),
        nameplate: pick('nameplate', youCos.eq.nameplate),
        capturefx: pick('capturefx', youCos.eq.capturefx),
        terr: pick('terr', youCos.eq.terr),
        death: pick('death', youCos.eq.death)
      }
    }
  );

  setHint();
}

/* Анимационный цикл большого превью — сцена «дышит» (захват, гибель), пока
   магазин открыт и предпочтения пользователя не просят убрать движение. */
export function scheduleCosmeticsPreviewAnimImpl() {
  if (cos.previewRaf) return;
  const tick = () => {
    cos.previewRaf = 0;
    if (!dom.cosmeticsOverlay || dom.cosmeticsOverlay.classList.contains('hidden')) return;
    const reduceMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (!reduceMotion) {
      const now = performance.now();
      if (!cos.previewLastAt || now - cos.previewLastAt > 33) {
        cos.previewLastAt = now;
        renderCosmeticsPreviewImpl();
      }
      cos.previewRaf = requestAnimationFrame(tick);
    }
  };
  cos.previewRaf = requestAnimationFrame(tick);
}

/* Смена выбранного предмета в списке. K7: не пересобирает весь список —
   только переключает класс на уже существующих карточках, иначе фокус с
   клавиатуры улетал в <body>. Полная пересборка — только если карточек с
   data-cosid в DOM ещё нет (список только загружается). */
function cosmeticsSelectItemImpl(id) {
  const next = Number(id) || 0;
  if (cos.selId === next) {
    renderCosmeticsPreviewImpl();
    return;
  }
  cos.selId = next;
  let patched = false;
  try {
    const cards = dom.cosmeticsItems?.querySelectorAll?.('.cosmeticsItem[data-cosid], .titleItem[data-cosid]');
    if (cards && cards.length) {
      for (const c of cards) c.classList.toggle('isSelected', Number(c.dataset.cosid) === next);
      patched = true;
    }
  } catch {}
  if (patched) renderCosmeticsPreviewImpl();
  else syncCosmeticsUiImpl();
}

/* Общая сборка .cosmeticsProgressRow > .cosmeticsItemProgress + заливка —
   раньше собиралась почти дословно дважды (обычный товар и titleItem),
   разными кусками кода с одинаковыми классами. Заливка — единственное, что
   отличается по разметке (div с width для обычного товара из-за aria на
   самом баре, span с width для титула без aria) — оставлена на совести
   вызывающей стороны через fillTag/fillWidth. */
function makeCosmeticsProgressRow(fracPercent, fillTag) {
  const row = document.createElement('div');
  row.className = 'cosmeticsProgressRow';
  const bar = document.createElement('div');
  bar.className = 'cosmeticsItemProgress';
  const fill = document.createElement(fillTag);
  fill.className = 'cosmeticsItemProgressFill';
  fill.style.width = `${fracPercent}%`;
  bar.appendChild(fill);
  row.appendChild(bar);
  return { row, bar, fill };
}

/* Скелетон списка/шапки, пока локальное состояние ещё не готово (первая
   загрузка страницы, кэш ещё не прочитан). */
function renderCosmeticsSkeletonImpl() {
  try {
    if (dom.cosmeticsEarnStyle) {
      const wrap = document.createElement('div');
      wrap.style.display = 'grid';
      wrap.style.gap = '8px';
      const l1 = document.createElement('div');
      l1.className = 'skeletonLine';
      l1.style.width = '62%';
      const l2 = document.createElement('div');
      l2.className = 'skeletonLine';
      l2.style.width = '92%';
      const l3 = document.createElement('div');
      l3.className = 'skeletonLine';
      l3.style.width = '86%';
      wrap.appendChild(l1);
      wrap.appendChild(l2);
      wrap.appendChild(l3);
      dom.cosmeticsEarnStyle.replaceChildren(wrap);
    }

    if (dom.cosmeticsTabs) {
      const btns = Array.from({ length: 5 }).map(() => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cosmeticsTabBtn';
        b.disabled = true;
        const sk = document.createElement('div');
        sk.className = 'skeletonLine';
        sk.style.width = '86px';
        sk.style.height = '10px';
        b.appendChild(sk);
        return b;
      });
      dom.cosmeticsTabs.replaceChildren(...btns);
    }

    if (dom.cosmeticsItems) {
      const items = Array.from({ length: 5 }).map(() => {
        const card = document.createElement('div');
        card.className = 'cosmeticsItem';

        const prev = document.createElement('div');
        prev.className = 'cosmeticsItemPreview skeletonBlock';

        const left = document.createElement('div');
        left.className = 'cosmeticsItemLeft';
        const t1 = document.createElement('div');
        t1.className = 'skeletonLine';
        t1.style.width = '220px';
        const t2 = document.createElement('div');
        t2.className = 'skeletonLine';
        t2.style.width = '140px';
        left.appendChild(t1);
        left.appendChild(t2);

        const right = document.createElement('div');
        right.className = 'cosmeticsItemRight';
        const b = document.createElement('div');
        b.className = 'skeletonBlock';
        b.style.width = '92px';
        b.style.height = '34px';
        b.style.borderRadius = '12px';
        right.appendChild(b);

        card.appendChild(left);
        card.appendChild(right);
        card.insertBefore(prev, left);
        return card;
      });
      dom.cosmeticsItems.replaceChildren(...items);
    }

    if (dom.cosmeticsHint) dom.cosmeticsHint.textContent = '';
  } catch {}
}

/* Открыть оверлей магазина: гарантирует локально готовое состояние, ставит
   превью на реально надетый предмет и синхронизирует список. */
export function showCosmeticsOverlayImpl() {
  if (!dom.cosmeticsOverlay) return;
  if (!cos.loaded) {
    cosmeticsEnsureLocalReady();
  }
  cos.open = true;
  dom.cosmeticsOverlay.classList.remove('hidden');
  overlayManager.open('cosmetics');
  cosmeticsOpClear();
  const cat = cos.cat;
  const eq0 = cat === 'title' ? cos.titleId : cosmeticsEqForCat(cat);
  cos.selId = Number.isFinite(Number(eq0)) ? Number(eq0) : 0;
  setCosmeticsStatus('', '');
  if (!wsIsConnected()) setCosmeticsStatus(() => t('cosmetics.no_connection'), 'info');
  else if (cos.source !== 'server') setCosmeticsStatus(() => t('cosmetics.unconfirmed_hint'), 'info');
  syncOverlayUiState();
  syncCosmeticsUiImpl();
  overlayManager.focusDefault('cosmetics');
}

/* Скрыть оверлей магазина и вернуть жизнь панели «Ваш облик» в меню. */
export function hideCosmeticsOverlayImpl() {
  try {
    setTimeout(() => scheduleMenuSkinPreview(), 0);
  } catch {}
  if (!dom.cosmeticsOverlay) return;
  cos.open = false;
  dom.cosmeticsOverlay.classList.add('hidden');
  overlayManager.close('cosmetics');
  cosmeticsOpClear();
  setCosmeticsStatus('', '');
  syncOverlayUiState();
  const raf = cos.previewRaf;
  if (raf) {
    try {
      cancelAnimationFrame(raf);
    } catch {}
    cos.previewRaf = 0;
  }
}

/* Полная синхронизация списка/шапки магазина с текущим состоянием (баланс,
   вкладки, фильтр, карточки предметов) + большое превью. */
export function syncCosmeticsUiImpl() {
  if (!dom.cosmeticsOverlay || dom.cosmeticsOverlay.classList.contains('hidden')) return;

  if (!cos.loaded) {
    cosmeticsEnsureLocalReady();
  }

  if (!cos.loaded) {
    if (dom.cosmeticsStyle) dom.cosmeticsStyle.textContent = '—';
    renderCosmeticsSkeletonImpl();
    return;
  }

  if (dom.cosmeticsStyle) dom.cosmeticsStyle.textContent = String(Math.floor(cos.style || 0));

  const filter = cos.filter;
  if (dom.cosmeticsFilterAllBtn) dom.cosmeticsFilterAllBtn.classList.toggle('isActive', filter === 'all');
  if (dom.cosmeticsFilterOwnedBtn) dom.cosmeticsFilterOwnedBtn.classList.toggle('isActive', filter === 'owned');
  if (dom.cosmeticsFilterAvailableBtn) dom.cosmeticsFilterAvailableBtn.classList.toggle('isActive', filter === 'available');

  if (dom.cosmeticsEarnStyle) {
    if (!cos.earnExpanded) {
      const hint = `<div>${escapeHtml(t('cosmetics.style_hint'))}</div>`;
      const off = cos.source === 'cache' ? `<div style="margin-top:6px">${escapeHtml(t('cosmetics.offline_hint'))}</div>` : '';
      setSafeHtml(dom.cosmeticsEarnStyle, hint + off);
    } else {
      setSafeHtml(
        dom.cosmeticsEarnStyle,
        `
        <div><b>${escapeHtml(t('cosmetics.earn_title'))}</b></div>
        <div class="row"><span class="k">${escapeHtml(t('cosmetics.earn_kills'))}</span><span>${escapeHtml(t('cosmetics.earn_kills_desc'))}</span></div>
        <div class="row"><span class="k">${escapeHtml(t('cosmetics.earn_revenge'))}</span><span>${escapeHtml(t('cosmetics.earn_revenge_desc'))}</span></div>
        <div class="row"><span class="k">${escapeHtml(t('cosmetics.earn_contracts'))}</span><span>${escapeHtml(t('cosmetics.earn_contracts_desc'))}</span></div>
        <div class="row"><span class="k">${escapeHtml(t('cosmetics.earn_dailies'))}</span><span>${escapeHtml(t('cosmetics.earn_dailies_desc'))}</span></div>
        <div class="row"><span class="k">${escapeHtml(t('cosmetics.earn_bounty'))}</span><span>${escapeHtml(t('cosmetics.earn_bounty_desc'))}</span></div>
        `
      );
    }
  }

  if (dom.cosmeticsTabs) {
    const btns = COSMETICS_TABS.map((cid) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cid === 'title' ? 'cosmeticsTabBtn isTitles' : 'cosmeticsTabBtn';
      const total = cid === 'title' ? COS_TITLE_MAX : COSMETICS_MAX_ID + 1;
      const have = cid === 'title' ? cosTitlesUnlockedCountImpl() : cosmeticsOwnedCount(cid);
      const fullLabel = `${cosmeticsLabel(cid)} ${have}/${total}`;
      const icon = document.createElement('span');
      icon.className = 'cosmeticsTabIcon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = COSMETICS_TAB_ICON_BY_CAT[cid] || '❔';
      /* Вкладка — иконка + НАЗВАНИЕ категории + счётчик. Одни пиктограммы
         (🟩 〰 ⚪ 💀 ✨ 🏷 🖼 🏅) не читались: что такое «〰» или «🏷», игрок
         угадывал перебором. Название рядом снимает вопрос; сетка вкладок
         (см. .cosmeticsTabs) укладывает восемь штук в два ряда. */
      const text = document.createElement('span');
      text.className = 'cosmeticsTabText';
      const name = document.createElement('span');
      name.className = 'cosmeticsTabName';
      name.textContent = cosmeticsLabel(cid);
      const count = document.createElement('span');
      count.className = 'cosmeticsTabCount';
      count.setAttribute('aria-hidden', 'true');
      count.textContent = `${have}/${total}`;
      text.append(name, count);
      b.append(icon, text);
      b.title = fullLabel;
      b.setAttribute('aria-label', fullLabel);
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', cid === cos.cat ? 'true' : 'false');
      b.addEventListener('click', () => {
        cos.cat = cid;
        cos.selId = cid === 'title' ? Math.max(0, Number(cos.titleId) || 0) : (Number(cosmeticsEqForCat(cid)) || 0);
        syncCosmeticsUiImpl();
      });
      return b;
    });
    dom.cosmeticsTabs.replaceChildren(...btns);
    if (cos.tabsScrolledCat !== cos.cat) {
      cos.tabsScrolledCat = cos.cat;
      try {
        const active = btns.find((b) => b.getAttribute('aria-selected') === 'true');
        active?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
      } catch {}
    }
  }

  const cosmeticsCat = cos.cat;

  try {
    if (dom.cosmeticsWhere) dom.cosmeticsWhere.textContent = t(`cosmetics.where_${cosmeticsCat}`) || '';
  } catch {}

  if (dom.cosmeticsItems && cosmeticsCat === 'title') {
    renderCosmeticsTitlesImpl();
    renderCosmeticsPreviewImpl();
    scheduleCosmeticsPreviewAnimImpl();
    return;
  }

  if (dom.cosmeticsItems) {
    dom.cosmeticsItems.classList.remove('isTitles');
    const mask = cosmeticsMaskForCat(cosmeticsCat);
    const eq = cosmeticsEqForCat(cosmeticsCat);
    const confirmed = cos.source === 'server';
    const online = wsIsConnected();
    const items = [];
    const balance = Math.max(0, Math.floor(Number(cos.style) || 0));

    const order = visibleItems(cosmeticsCat, filter, balance, mask, eq, cos.prices, COSMETICS_MAX_ID);

    let lastTier = '';
    for (const entry of order) {
      const id = entry.id;
      const price = entry.price;
      const owned = entry.owned;
      const equipped = entry.equipped;
      const missing = entry.missing;

      const variant = cosmeticsVariantName(cosmeticsCat, id);
      const tier = entry.tier;

      if (tier !== lastTier) {
        lastTier = tier;
        const sep = document.createElement('div');
        sep.className = `cosmeticsTierSep ${tierClass(tier)}`;
        sep.textContent = cosmeticsTierLabel(tier);
        items.push(sep);
      }

      const card = document.createElement('div');
      card.className = `cosmeticsItem ${tierClass(tier)}` + (cos.selId === id ? ' isSelected' : '');
      card.dataset.cosid = String(id);
      card.classList.toggle('isOwned', owned);
      card.classList.toggle('isEquipped', owned && equipped);
      card.classList.toggle('isLocked', !owned && balance < price);
      card.tabIndex = 0;
      card.addEventListener('click', () => {
        cosmeticsSelectItemImpl(id);
      });
      card.addEventListener('focus', () => cosmeticsSelectItemImpl(id));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          cosmeticsSelectItemImpl(id);
        }
      });

      const prev = document.createElement('div');
      prev.className = 'cosmeticsItemPreview';
      const cvs = document.createElement('canvas');
      prev.appendChild(cvs);
      drawMiniCosmeticPreview(cvs, cosmeticsCat, id);

      const left = document.createElement('div');
      left.className = 'cosmeticsItemLeft';
      const titleEl = document.createElement('div');
      titleEl.className = 'cosmeticsItemTitle';
      titleEl.textContent = variant;

      let sub = null;
      if (!owned && missing > 0) {
        // текста нет: он целиком в ценнике и на кнопке
      } else if (owned && !confirmed) {
        sub = document.createElement('div');
        sub.className = 'cosmeticsItemSub isUnconfirmed';
        sub.textContent = t('cosmetics.item_owned_unconfirmed');
      } else if (!equipped) {
        sub = document.createElement('div');
        sub.className = 'cosmeticsItemSub';
        sub.textContent = owned ? t('cosmetics.item_owned') : t('cosmetics.item_not_owned');
      }
      left.appendChild(titleEl);
      if (sub) left.appendChild(sub);

      if (!owned && price > 0 && missing > 0) {
        // Без обёртки .cosmeticsProgressRow (см. titleItem ниже) .cosmeticsItemLeft
        // грид с justify-items: center не даёт полосе явной ширины — она
        // схлопывалась в точку. .cosmeticsProgressRow задаёт колонку под бар.
        const pct = Math.max(0, Math.min(100, (balance / price) * 100)).toFixed(1);
        const { row, bar } = makeCosmeticsProgressRow(pct, 'div');
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', String(price));
        bar.setAttribute('aria-valuenow', String(Math.min(balance, price)));
        bar.setAttribute('aria-label', `${t('cosmetics.missing_prefix')} ${fmtInt(missing)}`);
        left.appendChild(row);
      }

      const right = document.createElement('div');
      right.className = 'cosmeticsItemRight';
      if (!owned) {
        const pr = document.createElement('div');
        pr.className = 'cosmeticsPrice';
        setSafeHtml(pr, cosmeticsFormatCost(price));
        right.appendChild(pr);

        const cat = cosmeticsCat;
        const pending = cosmeticsOpIsPending(cat, id);
        const poor = balance < price;

        const state = buyButtonState({ pending, online, confirmed, pendingOtherOp: cos.pendingOp, poor });

        const buy = document.createElement('button');
        buy.type = 'button';
        buy.disabled = state.disabled;
        buy.className = state.className;
        if (state.poor) buy.classList.add('isPoor');
        buy.textContent = state.poor ? `${t('cosmetics.not_enough_short')} ${fmtInt(missing)} ✨` : t('cosmetics.buy');
        if (state.pending) buy.classList.add('isLoading');
        if (state.titleKind === 'no_connection') buy.title = t('cosmetics.no_connection');
        else if (state.titleKind === 'unconfirmed_hint') buy.title = t('cosmetics.unconfirmed_hint');
        else if (state.titleKind === 'need_more') buy.title = `${t('cosmetics.need_more')} ${fmtInt(missing)} ✨`;

        buy.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (cos.pendingOp) return;
          if (poor) {
            setCosmeticsStatus(
              () => `${t('cosmetics.need_more')} ${fmtInt(missing)} ✨ — ${t('cosmetics.need_more_hint')}`,
              'error'
            );
            if (!cos.earnExpanded) cos.earnExpanded = true;
            syncCosmeticsUiImpl();
            try {
              dom.cosmeticsEarnStyle?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
            } catch {}
            return;
          }
          if (!cosmeticsServerReady()) {
            setCosmeticsStatus(() => (wsIsConnected() ? t('cosmetics.unconfirmed_hint') : t('cosmetics.no_connection')), 'error');
            cosmeticsBuyLocal(cat, id);
            return;
          }
          buy.disabled = true;
          buy.classList.add('isLoading');
          cosmeticsOpBegin(cat, id);
          setCosmeticsStatus(() => t('cosmetics.op_pending'), 'info');
          if (!wsSend('cosmeticsBuy', { cat, id })) {
            cosmeticsOpClear();
            setCosmeticsStatus(() => t('cosmetics.no_connection'), 'error');
            syncCosmeticsUiImpl();
          }
        });
        right.appendChild(buy);
      } else {
        const eqBtn = document.createElement('button');
        eqBtn.type = 'button';
        const cat = cosmeticsCat;
        const doEquip = (wantId) => {
          if (!cosmeticsServerReady()) {
            cosmeticsEquipLocal(cat, wantId);
            setCosmeticsStatus(() => (wsIsConnected() ? t('cosmetics.unconfirmed_hint') : t('cosmetics.no_connection')), 'info');
            return;
          }
          if (!wsSend('cosmeticsEquip', { cat, id: wantId })) {
            cosmeticsEquipLocal(cat, wantId);
            setCosmeticsStatus(() => t('cosmetics.no_connection'), 'error');
          } else {
            cosmeticsSetDesiredEq(cat, wantId);
          }
        };

        const eqState = equipButtonState({ equipped, id });
        eqBtn.className = eqState.className;
        eqBtn.disabled = eqState.disabled;
        if (eqState.kind === 'remove') {
          eqBtn.textContent = t('cosmetics.remove');
          eqBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            doEquip(0);
          });
        } else {
          eqBtn.textContent = eqState.kind === 'equipped' ? t('cosmetics.item_equipped') : t('cosmetics.wear');
          eqBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            doEquip(id);
          });
        }
        right.appendChild(eqBtn);
      }

      card.appendChild(left);
      card.appendChild(right);
      card.insertBefore(prev, left);
      items.push(card);
    }

    if (!items.length) {
      setSafeHtml(
        dom.cosmeticsItems,
        `
        <div class="roomsEmpty">
          <div class="roomsEmptyTitle">${escapeHtml(t('cosmetics.empty_title'))}</div>
          <div class="roomsEmptyDesc">${escapeHtml(t('cosmetics.empty_desc'))}</div>
        </div>
        `
      );
    } else {
      dom.cosmeticsItems.replaceChildren(...items);
    }
  }

  renderCosmeticsPreviewImpl();
  scheduleCosmeticsPreviewAnimImpl();
}

/* --- Титулы в магазине -----------------------------------------------------
   Отдельная вкладка: покупать нечего, поэтому вместо цены — условие открытия,
   а вместо «Купить» — «Надеть». Отправка идёт сообщением `titleEquip`.
   Вынесено из client.js вместе с остальной DOM-обвязкой магазина. */

function cosTitleUnlockedImpl(id) {
  const i = Math.max(0, Math.min(COS_TITLE_MAX, Number(id) || 0));
  if (i === 0) return true;
  return (Number(cos.titleMask) & (1 << i)) !== 0;
}

/* C3: прогресс к титулу. Возвращает {frac, cur, max} либо null, если данных
   нет. Открытый титул — {frac:1}, без счётчика: сервер не присылает прогресс
   по уже закрытым ачивкам, и придумывать «10/10» было бы враньём. */
function cosTitleProgressImpl(id) {
  const i = Math.max(0, Math.min(COS_TITLE_MAX, Number(id) || 0));
  if (i === 0) return null;
  if (cosTitleUnlockedImpl(i)) return { frac: 1, cur: 0, max: 0 };
  const achv = cos.titleAchvById.get(i);
  if (achv == null) return null;
  const p = cos.achvProgressById.get(achv);
  if (!p || !(p.max > 0)) return null;
  return { frac: Math.max(0, Math.min(1, p.cur / p.max)), cur: p.cur, max: p.max };
}

/* C3: «37/100», «0/100 000» — разряды через УЗКИЙ НЕРАЗРЫВНЫЙ пробел (U+202F).
   Сама группировка и константа разделителя — в client_format.js. */
function cosFormatCountImpl(n) {
  return formatGroupedCount(n);
}

function cosTitlesUnlockedCountImpl() {
  let n = 0;
  for (let i = 1; i <= COS_TITLE_MAX; i++) {
    if (cosTitleUnlockedImpl(i)) n++;
  }
  return n;
}

function cosTitleEquipImpl(id) {
  const i = Math.max(0, Math.min(COS_TITLE_MAX, Number(id) || 0));
  if (!cosTitleUnlockedImpl(i)) return;
  cos.titleId = i;
  if (session.you) {
    if (i) cos.titleByPlayer.set(session.you, i);
    else cos.titleByPlayer.delete(session.you);
  }
  cosmeticsCacheSave();
  if (!wsSend('titleEquip', { id: i })) {
    setCosmeticsStatus(() => (wsIsConnected() ? t('cosmetics.unconfirmed_hint') : t('cosmetics.no_connection')), 'info');
  }
  syncCosmeticsUiImpl();
}

function renderCosmeticsTitlesImpl() {
  if (!dom.cosmeticsItems) return;
  const cosmeticsFilter = cos.filter;
  const cosmeticsSelId = cos.selId;
  const items = [];

  const hint = document.createElement('div');
  hint.className = `cosmeticsTierSep ${tierClass()}`;
  hint.textContent = t('cosmetics.title_free_hint');
  items.push(hint);

  if (!cos.titleMask && cos.source !== 'server') {
    const note = document.createElement('div');
    note.className = 'cosmeticsItemWhere';
    note.textContent = t('cosmetics.titles_unavailable');
    items.push(note);
  }

  for (let id = 0; id <= COS_TITLE_MAX; id++) {
    const unlocked = cosTitleUnlockedImpl(id);
    const worn = Number(cos.titleId) === id;
    if (cosmeticsFilter === 'owned' && !unlocked) continue;
    if (cosmeticsFilter === 'available' && unlocked) continue;

    // Разметка карточки титула согласована с вёрсткой (.titleItem): медаль
    // вместо превью-канваса, условие получения вместо цены, никакой валюты.
    const card = document.createElement('div');
    card.className = 'titleItem' + (cosmeticsSelId === id ? ' isSelected' : '');
    // K7: тот же приём, что и для карточек предметов — выбор не пересобирает
    // список и не роняет фокус.
    card.dataset.cosid = String(id);
    card.classList.toggle('isUnlocked', unlocked);
    card.classList.toggle('isEquipped', worn);
    card.classList.toggle('isLocked', !unlocked);
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.addEventListener('click', () => {
      cosmeticsSelectItemImpl(id);
    });
    // Фокус с клавиатуры равен выбору: Tab по списку сразу меняет превью.
    card.addEventListener('focus', () => cosmeticsSelectItemImpl(id));

    const medal = document.createElement('span');
    medal.className = 'titleMedal';
    medal.setAttribute('aria-hidden', 'true');
    medal.textContent = id === 0 ? '—' : '🏅';

    const left = document.createElement('div');
    left.className = 'titleItemLeft';

    const nameEl = document.createElement('div');
    nameEl.className = 'titleName';
    nameEl.textContent = id === 0 ? t('cosmetics.title_none') : `«${cosTitleName(id)}»`;
    left.appendChild(nameEl);

    if (unlocked) {
      const desc = document.createElement('div');
      desc.className = 'titleDesc';
      desc.textContent =
        id === 0 ? t('cosmetics.title_none_desc') : `${t('cosmetics.title_earned_for')}: ${cosTitleReq(id)}`;
      left.appendChild(desc);
    } else {
      const req = document.createElement('div');
      req.className = 'titleReq';
      req.textContent = cosTitleReq(id) || t('cosmetics.title_locked');
      left.appendChild(req);
    }

    /* C3: реальный прогресс к ачивке. Сервер присылает накопленные счётчики
       в `cosmetics.achvProgress` (только по НЕ открытым ачивкам). У открытого
       титула счётчика нет — там полная полоса без подписи. Если сервер старый
       или связка «титул → ачивка» не пришла, cosTitleProgressImpl() вернёт
       null и блок просто не рисуется, как и раньше. */
    const prog = cosTitleProgressImpl(id);
    if (prog != null) {
      const pct = Math.round(Math.max(0, Math.min(1, prog.frac)) * 100);
      const { row } = makeCosmeticsProgressRow(pct, 'span');
      if (prog.max > 0) {
        const lab = document.createElement('span');
        lab.className = 'cosmeticsItemProgressLabel';
        lab.textContent = tfmt('cosmetics.progress_of', {
          cur: cosFormatCountImpl(prog.cur),
          max: cosFormatCountImpl(prog.max),
        });
        row.appendChild(lab);
      }
      left.appendChild(row);
    }

    const right = document.createElement('div');
    right.className = 'titleItemRight';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btnSecondary';
    if (!unlocked) {
      btn.disabled = true;
      btn.textContent = t('cosmetics.locked');
    } else if (worn) {
      btn.disabled = true;
      btn.textContent = t('cosmetics.title_equipped');
    } else {
      btn.textContent = t('cosmetics.wear');
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        cosTitleEquipImpl(id);
      });
    }
    right.appendChild(btn);

    card.appendChild(medal);
    card.appendChild(left);
    card.appendChild(right);
    items.push(card);
  }

  // Контейнер несёт --title-accent для вкладки титулов (см. .cosmeticsItems.isTitles).
  dom.cosmeticsItems.classList.add('isTitles');

  if (items.length <= 1) {
    setSafeHtml(
      dom.cosmeticsItems,
      `
      <div class="roomsEmpty">
        <div class="roomsEmptyTitle">${escapeHtml(t('cosmetics.empty_title'))}</div>
        <div class="roomsEmptyDesc">${escapeHtml(t('cosmetics.empty_desc'))}</div>
      </div>
      `
    );
    return;
  }
  dom.cosmeticsItems.replaceChildren(...items);
}
