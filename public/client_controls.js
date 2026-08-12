/* Управление змейкой: клавиатура, свайпы на канвасе и глобальные горячие
   клавиши экрана (карта, панель производительности, Escape, Enter в чат).

   Сама механика (порог свайпа, запрет разворота на 180°, дедуп направления)
   живёт в client_input.js — здесь только связывание с DOM и состояние
   индикатора свайпа.

   Отправка направления в сокет приходит через initControls({ wsSend }):
   импортировать её из client_net_bind.js нельзя без кольца.

   Обработчики вешаются из initControls(), а не при загрузке модуля. */

import { dom } from './client_dom.js';
import { settings } from './client_store.js';
import { overlayManager } from './client_util.js';
import { isOverlayOpen } from './client_overlays.js';
import { applyPerfUi, saveSettings } from './client_settings.js';
import { bumpChatVisibility, setChatCollapsed } from './client_chat.js';
import { toggleMinimapOverlay } from './client_minimap_ui.js';
import { getMenuControlsSeen, setMenuControlsSeen, syncMenuOnboardingUi } from './client_menu.js';
import {
  endSwipeImpl,
  getSwipeIndicatorImpl,
  handleMovementKeydownImpl,
  handleSwipePointerDownImpl,
  handleSwipePointerMoveImpl,
  hideSwipeIndicatorImpl,
  moveSwipeIndicatorImpl,
  setDirImpl,
  showSwipeIndicatorImpl
} from './client_input.js';

// Отправка в сокет: приходит из client.js, см. initControls().
let wsSendRef = null;

function setDir(dir) {
  setDirImpl(dir, {
    getMenuControlsSeen,
    setMenuControlsSeen,
    syncMenuOnboardingUi,
    wsSend: wsSendRef
  });
}

// Визуальный индикатор свайпа (только тач): показывает точку отсчёта жеста,
// deadzone-порог SWIPE_PX и текущее накопленное смещение пальца. Раньше
// точка отсчёта переустанавливалась молча — игрок не видел, где проходит
// граница срабатывания, и терял змейку на "случайных" срабатываниях.
let swipeIndicatorEl = null;

function getSwipeIndicator() {
  swipeIndicatorEl = getSwipeIndicatorImpl({ swipeIndicatorEl });
  return swipeIndicatorEl;
}

function showSwipeIndicator(x0, y0) {
  showSwipeIndicatorImpl(x0, y0, { getSwipeIndicator });
}

function moveSwipeIndicator(dx, dy) {
  moveSwipeIndicatorImpl(dx, dy, { swipeIndicatorEl });
}

function hideSwipeIndicator() {
  hideSwipeIndicatorImpl({ swipeIndicatorEl });
}

function endSwipe(e) {
  endSwipeImpl(e, { hideSwipeIndicator });
}

export function initControls(ctx) {
  wsSendRef = ctx?.wsSend || null;

  window.addEventListener(
    'keydown',
    (e) => {
      if (isOverlayOpen('death')) {
        const isSpace =
          e.code === 'Space' ||
          e.key === ' ' ||
          e.key === 'Space' ||
          e.code === 'Spacebar' ||
          e.key === 'Spacebar' ||
          e.keyCode === 32 ||
          e.which === 32;

        if (e.key === 'Enter') {
          bumpChatVisibility(12000, true);
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        if (isSpace) {
          dom.restartBtn?.click();
          e.preventDefault();
          e.stopPropagation();
        }
      }
    },
    { capture: true }
  );

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      if (overlayManager.trapFocus(e)) return;
    }

    if (e.code === 'KeyM') {
      const ae = document.activeElement;
      if (ae && (ae === dom.nameInput || ae === dom.menuNameInput || dom.chat.contains(ae))) return;
      if (isOverlayOpen('menu')) return;
      if (isOverlayOpen('settings')) return;
      if (isOverlayOpen('cosmetics')) return;
      if (isOverlayOpen('match')) return;
      if (isOverlayOpen('death')) return;
      toggleMinimapOverlay();
      e.preventDefault();
      return;
    }

    if (e.code === 'KeyP') {
      const ae = document.activeElement;
      if (ae && (ae === dom.nameInput || ae === dom.menuNameInput || dom.chat.contains(ae))) return;
      if (isOverlayOpen('menu')) return;
      if (isOverlayOpen('settings')) return;
      if (isOverlayOpen('death')) return;
      settings.perfEnabled = !settings.perfEnabled;
      if (dom.perfEnabledInput) dom.perfEnabledInput.checked = !!settings.perfEnabled;
      applyPerfUi();
      saveSettings();
      e.preventDefault();
      return;
    }

    if (e.key === 'Escape' || e.key === 'Esc') {
      if (overlayManager.closeTop()) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (dom.chat && !dom.chat.classList.contains('collapsed')) {
        setChatCollapsed(true);
        try {
          document.activeElement?.blur?.();
        } catch {}
        e.preventDefault();
        return;
      }
    }

    if (e.key === 'Enter') {
      const ae = document.activeElement;
      if (ae && dom.chat.contains(ae)) return;
      if (isOverlayOpen('menu')) {
        e.preventDefault();
        return;
      }
      if (isOverlayOpen('settings')) {
        e.preventDefault();
        return;
      }
      if (isOverlayOpen('cosmetics')) {
        e.preventDefault();
        return;
      }
      if (isOverlayOpen('match')) {
        e.preventDefault();
        return;
      }

      bumpChatVisibility(12000, true);
      e.preventDefault();
      return;
    }

    handleMovementKeydownImpl(e, { overlayManager, nameInput: dom.nameInput, chat: dom.chat, setDir });
  });

  // Mobile / touch: swipe on the canvas to change direction
  try {
    dom.canvas.style.touchAction = 'none';
  } catch {
    // ignore
  }

  dom.canvas.addEventListener(
    'pointerdown',
    (e) => handleSwipePointerDownImpl(e, { showSwipeIndicator, canvas: dom.canvas }),
    { passive: false }
  );

  dom.canvas.addEventListener(
    'pointermove',
    (e) => handleSwipePointerMoveImpl(e, { moveSwipeIndicator, showSwipeIndicator, setDir }),
    { passive: false }
  );

  dom.canvas.addEventListener('pointerup', endSwipe);
  dom.canvas.addEventListener('pointercancel', endSwipe);
}
