/* Миникарта: легенда, полноэкранный режим и вызов отрисовки.

   Сама отрисовка пикселей — в client_minimap.js (там же тесты на раскладку
   зон и пинов). Здесь всё, что вокруг неё: подпись значков, увеличенная
   копия на весь экран и решение «пора перерисовывать».

   Полноэкранный режим — не украшение: на мобильном #minimapPanel скрыт
   раскладкой, а клавиши M на телефоне нет, поэтому без кнопки игрок в игре
   про захват территории играет вслепую.

   УХ33: у миникарты не было легенды для точек-иконок — жёлтая рамка топ-1 и
   красная у баунти читались только методом тыка. */

import { dom } from './client_dom.js';
import { clientState } from './client_state.js';
import { match, session, world } from './client_store.js';
import { onLangChange, t } from './client_i18n_rt.js';
import { overlayManager } from './client_util.js';
import { registerOverlayCloser, syncOverlayUiState } from './client_overlays.js';
import { drawMinimap as drawMinimapImpl } from './client_minimap.js';
import { gridCellIsCooling, gridCellOwner } from './client_grid.js';

/* Как часто перерисовывать карту, если ничего не менялось. */
export const MINIMAP_REFRESH_MS = 200;

/* Кэш «номер владельца -> rgb» для пикселей карты: пересчитывать hsl->rgb на
   каждую клетку каждого кадра дорого. Чистится на границе матча вместе с
   цветами — номера раздаются заново. */
export const minimapOwnerRgbCache = new Map();

let minimapOverlayOpen = false;
let minimapOverlayCtx = null;

/* УХ33: у миникарты не было легенды для точек-иконок — жёлтая рамка топ-1 и
   красная у баунти читались только методом тыка. Три строки: своя точка,
   боты, остальные игроки — с теми же значками/цветами, что рисует
   drawMinimap()/setMinimapPixel(). */
function updateMinimapLegend() {
  if (!dom.minimapLegend) return;
  const rows = [
    { swatch: 'minimapLegendMe', label: t('minimap.legend_me') },
    { swatch: 'minimapLegendPlayer', label: t('minimap.legend_player') },
    { swatch: 'minimapLegendBot', label: t('minimap.legend_bot') }
  ];
  const items = rows.map((r) => {
    const row = document.createElement('div');
    row.className = 'minimapLegendRow';
    const sw = document.createElement('span');
    sw.className = `minimapLegendSwatch ${r.swatch}`;
    row.append(sw, document.createTextNode(r.label));
    return row;
  });
  try {
    dom.minimapLegend.replaceChildren(...items);
  } catch {}
  try {
    dom.minimapLegend.classList.remove('hidden');
  } catch {}
  try {
    dom.minimapLegend.setAttribute('aria-hidden', 'false');
  } catch {}
}

function ensureMinimapOverlayCanvas() {
  if (!dom.minimapOverlayCanvas) return;
  const ctx = dom.minimapOverlayCanvas.getContext('2d');
  if (!ctx) return;
  minimapOverlayCtx = ctx;
  const w = (dom.minimap?.width || 0) * 2;
  const h = (dom.minimap?.height || 0) * 2;
  if (w > 0 && h > 0) {
    if (dom.minimapOverlayCanvas.width !== w) dom.minimapOverlayCanvas.width = w;
    if (dom.minimapOverlayCanvas.height !== h) dom.minimapOverlayCanvas.height = h;
  }
  minimapOverlayCtx.imageSmoothingEnabled = false;
}

function syncMinimapOverlayCanvas() {
  if (!minimapOverlayOpen) return;
  if (!dom.minimapOverlayCanvas || !dom.minimap || !minimapOverlayCtx) return;
  if (dom.minimapOverlayCanvas.width !== dom.minimap.width * 2 || dom.minimapOverlayCanvas.height !== dom.minimap.height * 2) {
    ensureMinimapOverlayCanvas();
  }
  minimapOverlayCtx.clearRect(0, 0, dom.minimapOverlayCanvas.width, dom.minimapOverlayCanvas.height);
  minimapOverlayCtx.drawImage(
    dom.minimap,
    0,
    0,
    dom.minimap.width,
    dom.minimap.height,
    0,
    0,
    dom.minimapOverlayCanvas.width,
    dom.minimapOverlayCanvas.height
  );
}

function showMinimapOverlay() {
  if (!dom.minimapOverlay) return;
  minimapOverlayOpen = true;
  dom.minimapOverlay.classList.remove('hidden');
  overlayManager.open('minimap');
  syncOverlayUiState();
  ensureMinimapOverlayCanvas();
  syncMinimapOverlayCanvas();
  overlayManager.focusDefault('minimap');
}

function hideMinimapOverlay() {
  if (!dom.minimapOverlay) return;
  minimapOverlayOpen = false;
  dom.minimapOverlay.classList.add('hidden');
  overlayManager.close('minimap');
  syncOverlayUiState();
}

export function toggleMinimapOverlay() {
  if (minimapOverlayOpen) hideMinimapOverlay();
  else showMinimapOverlay();
}

/* Обработчики вешаются из initMinimapUi(), а не при загрузке модуля. */
export function initMinimapUi() {
  registerOverlayCloser('minimap', hideMinimapOverlay);

  /* Миникарта рисуется пиксель в пиксель и растягивается — без сглаживания
     она рябит лесенкой. Настройка ставится один раз: контекст канваса потом
     запрашивается каждый кадр, но объект тот же самый. */
  try {
    const mmCtx = dom.minimap.getContext('2d');
    mmCtx.imageSmoothingEnabled = true;
    mmCtx.imageSmoothingQuality = 'high';
  } catch {}

  dom.minimapOverlayCloseBtn?.addEventListener('click', (e) => {
    e?.preventDefault?.();
    hideMinimapOverlay();
  });

  // Тач-доступ к карте: на мобильном #minimapPanel скрыт, а клавиши M нет,
  // поэтому без этой кнопки игрок в игре про захват территории играет вслепую.
  dom.minimapMobileBtn?.addEventListener('click', (e) => {
    e?.preventDefault?.();
    toggleMinimapOverlay();
  });

  dom.minimapOverlay?.addEventListener('click', (e) => {
    if (e.target === dom.minimapOverlay) {
      hideMinimapOverlay();
    }
  });

  try {
    updateMinimapLegend();
  } catch {}

  onLangChange(updateMinimapLegend);
}

export function drawMinimap() {
  const res = drawMinimapImpl(dom.minimap.getContext('2d'), {
    minimapImage: world.minimapImage,
    minimapGridOwner: world.minimapGridOwner,
    clientState,
    minimapDirty: world.minimapDirty,
    minimapHadChunkUpdate: world.minimapHadChunkUpdate,
    N: session.N,
    you: session.you,
    colors: world.colors,
    botIds: world.botIds,
    bountyTarget: match.bountyTarget,
    minimapOwnerRgbCache,
    gridCellOwner,
    gridCellIsCooling,
    viewMinX: world.viewMinX,
    viewMinY: world.viewMinY,
    viewMaxX: world.viewMaxX,
    viewMaxY: world.viewMaxY,
    W: session.W,
    H: session.H,
    syncMinimapOverlayCanvas
  });
  world.minimapDirty = res.dirty;
  world.minimapHadChunkUpdate = res.hadChunkUpdate;
}

