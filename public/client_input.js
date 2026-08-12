/* Управление змейкой — вынесено из client.js: смена направления (клавиатура)
   и свайпы на канвасе (тач), включая визуальный индикатор свайпа.

   Функции принимают явные deps вместо захвата глобалов client.js. Изменяемые
   примитивы client.js (lastDirSent, swipeActive, swipeX0/Y0, swipePointerId,
   swipeIndicatorEl) объявлены там через let — записать их отсюда напрямую
   нельзя, поэтому импл-функции возвращают объект res с новыми значениями, а
   тонкие обёртки в client.js раскладывают его обратно по переменным (тот же
   приём, что и у applyMatchPhase()/onMatchStart() в client_match.js). Порядок
   вызовов и побочные эффекты не менялись — только источник переменных. */

export function setDirImpl(dir, deps) {
  const { youAlive, lastDirSent, getMenuControlsSeen, setMenuControlsSeen, syncMenuOnboardingUi, wsSend } = deps;
  if (!youAlive) return { lastDirSent };
  if (dir === lastDirSent) return { lastDirSent };
  // F13: подсказка про управление гаснет по факту действия, а не по факту входа.
  if (!getMenuControlsSeen()) {
    setMenuControlsSeen();
    syncMenuOnboardingUi();
  }
  wsSend('input', { dir });
  return { lastDirSent: dir };
}

// Хвост главного keydown-обработчика client.js: сама смена направления
// стрелками/WASD. Проверки оверлеев/фокуса чата остаются в client.js — они
// решают, стоит ли вообще давать ходу дойти сюда.
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

export function swipeDirImpl(dx, dy) {
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

export function handleSwipePointerDownImpl(e, deps) {
  const { youAlive, swipeActive, swipeX0, swipeY0, swipePointerId, showSwipeIndicator, canvas } = deps;
  if (!youAlive) return { swipeActive, swipeX0, swipeY0, swipePointerId };
  if (e.pointerType !== 'touch') return { swipeActive, swipeX0, swipeY0, swipePointerId };

  const nextSwipeX0 = e.clientX;
  const nextSwipeY0 = e.clientY;
  showSwipeIndicator(nextSwipeX0, nextSwipeY0);
  try {
    canvas.setPointerCapture?.(e.pointerId);
  } catch {
    // Захват — оптимизация: свайп работает и без него, а setPointerCapture
    // кидает NotFoundError, если указатель уже отпущен.
  }
  e.preventDefault();

  return { swipeActive: true, swipeX0: nextSwipeX0, swipeY0: nextSwipeY0, swipePointerId: e.pointerId };
}

export function handleSwipePointerMoveImpl(e, deps) {
  const { swipeActive, swipeX0, swipeY0, swipePointerId, SWIPE_PX, moveSwipeIndicator, showSwipeIndicator, setDir } =
    deps;
  if (!swipeActive) return { swipeX0, swipeY0 };
  if (swipePointerId != null && e.pointerId !== swipePointerId) return { swipeX0, swipeY0 };

  const dx = e.clientX - swipeX0;
  const dy = e.clientY - swipeY0;
  moveSwipeIndicator(dx, dy);
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return { swipeX0, swipeY0 };

  setDir(swipeDirImpl(dx, dy));
  const nextSwipeX0 = e.clientX;
  const nextSwipeY0 = e.clientY;
  showSwipeIndicator(nextSwipeX0, nextSwipeY0);
  e.preventDefault();

  return { swipeX0: nextSwipeX0, swipeY0: nextSwipeY0 };
}

export function endSwipeImpl(e, deps) {
  const { swipePointerId, hideSwipeIndicator } = deps;
  if (swipePointerId != null && e.pointerId !== swipePointerId) return { swipeActive: true, swipePointerId };
  hideSwipeIndicator();
  return { swipeActive: false, swipePointerId: null };
}
