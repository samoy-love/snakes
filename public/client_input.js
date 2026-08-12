/* Логика управления змейкой: смена направления (клавиатура) и свайпы на
   канвасе (тач), включая визуальный индикатор свайпа.

   Отдельно от навешивания слушателей (client_controls.js), чтобы правила
   «какое направление считать допустимым» и «какой жест куда переводится»
   проверялись тестом без живого DOM и без событий браузера.

   Изменяемые примитивы (lastDirSent, swipeActive, swipeX0/Y0, swipePointerId)
   раньше жили плоскими let в client.js — записать их отсюда было нельзя, и
   импл-функции возвращали объект res, который вызывающий раскладывал обратно
   по переменным. Теперь lastDirSent — поле session в client_store.js, а
   состояние жеста лежит в локальном swipe: и то и другое правится на месте,
   возвращать нечего. */

import { session } from './client_store.js';

export function setDirImpl(dir, deps) {
  const { getMenuControlsSeen, setMenuControlsSeen, syncMenuOnboardingUi, wsSend } = deps;
  if (!session.youAlive) return;
  // Дубль того же направления серверу не нужен.
  if (dir === session.lastDirSent) return;
  // F13: подсказка про управление гаснет по факту действия, а не по факту входа.
  if (!getMenuControlsSeen()) {
    setMenuControlsSeen();
    syncMenuOnboardingUi();
  }
  wsSend('input', { dir });
  session.lastDirSent = dir;
}

// Хвост главного keydown-обработчика: сама смена направления стрелками/WASD.
// Проверки оверлеев/фокуса чата остаются в client_controls.js — они решают,
// стоит ли вообще давать ходу дойти сюда.
export function handleMovementKeydownImpl(e, deps) {
  const { overlayManager, nameInput, chat, setDir } = deps;
  // C6: never steer the snake while an overlay is on top of the game.
  if (overlayManager.getTop()) return;

  const ae = document.activeElement;
  if (ae && (ae === nameInput || chat.contains(ae))) return;
  if (e.code === 'ArrowUp' || e.code === 'KeyW') setDir('up');
  else if (e.code === 'ArrowDown' || e.code === 'KeyS') setDir('down');
  else if (e.code === 'ArrowLeft' || e.code === 'KeyA') setDir('left');
  else if (e.code === 'ArrowRight' || e.code === 'KeyD') setDir('right');
}

function swipeDirImpl(dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

// Визуальный индикатор свайпа (только тач): показывает точку отсчёта жеста,
// deadzone-порог SWIPE_PX и текущее накопленное смещение пальца. Раньше
// точка отсчёта переустанавливалась молча — игрок не видел, где проходит
// граница срабатывания, и терял змейку на "случайных" срабатываниях.
export function getSwipeIndicatorImpl(deps) {
  const { swipeIndicatorEl } = deps;
  if (swipeIndicatorEl) return swipeIndicatorEl;
  const el = document.createElement('div');
  el.id = 'swipeIndicator';
  el.setAttribute('aria-hidden', 'true');
  const dead = document.createElement('div');
  dead.className = 'swipeIndicator-deadzone';
  const dot = document.createElement('div');
  dot.className = 'swipeIndicator-dot';
  el.appendChild(dead);
  el.appendChild(dot);
  document.body.appendChild(el);
  return el;
}

export function showSwipeIndicatorImpl(x0, y0, deps) {
  const { getSwipeIndicator } = deps;
  const el = getSwipeIndicator();
  el.style.left = `${x0}px`;
  el.style.top = `${y0}px`;
  el.classList.add('isOn');
}

export function moveSwipeIndicatorImpl(dx, dy, deps) {
  const { swipeIndicatorEl } = deps;
  if (!swipeIndicatorEl) return;
  const dot = swipeIndicatorEl.querySelector('.swipeIndicator-dot');
  if (dot) dot.style.transform = `translate(${dx}px, ${dy}px)`;
}

export function hideSwipeIndicatorImpl(deps) {
  const { swipeIndicatorEl } = deps;
  if (!swipeIndicatorEl) return;
  swipeIndicatorEl.classList.remove('isOn');
  const dot = swipeIndicatorEl.querySelector('.swipeIndicator-dot');
  if (dot) dot.style.transform = 'translate(0, 0)';
}

/* Состояние жеста живёт здесь, а не у вызывающего: три обработчика читают и
   пишут одни и те же четыре поля, и раньше каждый возвращал их объектом,
   который вызывающий раскладывал обратно по переменным. Сам по себе жест
   наружу не виден — наружу видно только setDir(). */
const swipe = {
  active: false,
  x0: 0,
  y0: 0,
  pointerId: null
};

/* Порог срабатывания в пикселях: ниже него палец считается дрожащим, а не
   ведущим змейку. */
export const SWIPE_PX = 22;

export function handleSwipePointerDownImpl(e, deps) {
  const { showSwipeIndicator, canvas } = deps;
  if (!session.youAlive) return;
  if (e.pointerType !== 'touch') return;

  swipe.active = true;
  swipe.x0 = e.clientX;
  swipe.y0 = e.clientY;
  swipe.pointerId = e.pointerId;
  showSwipeIndicator(swipe.x0, swipe.y0);
  try {
    canvas.setPointerCapture?.(e.pointerId);
  } catch {
    /* Захват — оптимизация: свайп работает и без него, а setPointerCapture
       кидает NotFoundError, если указатель уже отпущен. */
  }
  e.preventDefault();
}

export function handleSwipePointerMoveImpl(e, deps) {
  const { moveSwipeIndicator, showSwipeIndicator, setDir } = deps;
  if (!swipe.active) return;
  if (swipe.pointerId != null && e.pointerId !== swipe.pointerId) return;

  const dx = e.clientX - swipe.x0;
  const dy = e.clientY - swipe.y0;
  moveSwipeIndicator(dx, dy);
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return;

  setDir(swipeDirImpl(dx, dy));
  /* Точка отсчёта переносится под палец: иначе один длинный жест давал бы
     только один поворот. */
  swipe.x0 = e.clientX;
  swipe.y0 = e.clientY;
  showSwipeIndicator(swipe.x0, swipe.y0);
  e.preventDefault();
}

export function endSwipeImpl(e, deps) {
  const { hideSwipeIndicator } = deps;
  if (swipe.pointerId != null && e.pointerId !== swipe.pointerId) return;
  swipe.active = false;
  swipe.pointerId = null;
  hideSwipeIndicator();
}
