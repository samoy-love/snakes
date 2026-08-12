/* Общее состояние оверлеев: кто открыт сейчас и что из этого следует.

   Регистрация в overlayManager (фокус-ловушка, Esc, порядок закрытия) жила в
   client.js, а syncOverlayUiState() — единственная функция, которая знает,
   что «открыт хоть один оверлей» означает класс на body, видимость кнопки
   языка и подложку #endOverlay, — вызывалась из десятка мест по всему файлу.

   Здесь и регистрация, и вывод состояния. Модули, которым нужно закрыть свой
   оверлей, зовут hideX() у себя и sync() отсюда; знать друг про друга им не
   нужно. Сами show/hide конкретных экранов остаются в своих модулях: у
   каждого свои побочные эффекты (звук, каскад результатов, остановка
   анимации превью). */

import { dom } from './client_dom.js';
import { overlayManager } from './client_util.js';

/* Оверлеи, чьё закрытие требует работы вне DOM (остановить анимацию, снять
   таймер). Модуль-владелец кладёт сюда свой обработчик при инициализации —
   иначе overlayManager дёргал бы classList напрямую и терял бы этот хвост. */
const closers = new Map();

export function registerOverlayCloser(name, close) {
  closers.set(name, close);
}

const runCloser = (name) => {
  const fn = closers.get(name);
  if (typeof fn === 'function') fn();
};

export function initOverlays() {
  overlayManager.register('menu', {
    root: () => dom.menuOverlay,
    defaultFocus: () => dom.menuNameInput,
    close: () => runCloser('menu'),
    closable: false
  });
  overlayManager.register('settings', {
    root: () => dom.settingsOverlay,
    defaultFocus: () => dom.closeSettingsBtn || dom.settingsOverlay?.querySelector('input, select, button'),
    close: () => runCloser('settings')
  });
  overlayManager.register('cosmetics', {
    root: () => dom.cosmeticsOverlay,
    defaultFocus: () => dom.cosmeticsCloseBtn,
    close: () => runCloser('cosmetics')
  });
  overlayManager.register('match', {
    root: () => dom.matchOverlay,
    defaultFocus: () => (!dom.matchContinueBtn?.disabled ? dom.matchContinueBtn : dom.matchMenuBtn),
    close: () => dom.matchMenuBtn?.click?.()
  });
  overlayManager.register('death', {
    root: () => dom.deathOverlay,
    defaultFocus: () => dom.restartBtn,
    close: () => dom.deathMenuBtn?.click?.()
  });
  overlayManager.register('minimap', {
    root: () => dom.minimapOverlay,
    defaultFocus: () => dom.minimapOverlayCloseBtn,
    close: () => runCloser('minimap')
  });

  // Разметка может прийти с уже открытым оверлеем — синхронизируем стек.
  for (const [name, el] of overlayEls()) {
    if (el && !el.classList.contains('hidden')) overlayManager.open(name);
  }
}

function overlayEls() {
  return [
    ['menu', dom.menuOverlay],
    ['settings', dom.settingsOverlay],
    ['cosmetics', dom.cosmeticsOverlay],
    ['match', dom.matchOverlay],
    ['death', dom.deathOverlay],
    ['minimap', dom.minimapOverlay]
  ];
}

export function isOverlayOpen(name) {
  const found = overlayEls().find(([n]) => n === name);
  const el = found?.[1];
  return !!(el && !el.classList.contains('hidden'));
}

/* Открыт ли хоть один оверлей. Читается и в draw(): под размытой подложкой
   поле рисуется раз в четыре кадра вместо шестидесяти. */
export function anyOverlayOpen() {
  return overlayEls().some(([, el]) => el && !el.classList.contains('hidden'));
}

/* Единственное место, где из «какие оверлеи открыты» выводится вид страницы. */
export function syncOverlayUiState() {
  const any = anyOverlayOpen();
  document.body.classList.toggle('overlayActive', any);
  if (dom.langToggleGlobal) dom.langToggleGlobal.classList.toggle('hidden', !any);

  /* Общая подложка #endOverlay видна, если открыт хоть один из двух режимов
     (death/match). Режимы взаимоисключающие по игровой логике, но здесь это
     не предполагается, а выводится из фактического DOM-состояния — на случай
     гонки оба класса просто ORятся. */
  if (dom.endOverlay) {
    const matchOpen = isOverlayOpen('match');
    const deathOpen = isOverlayOpen('death');
    dom.endOverlay.classList.toggle('hidden', !(matchOpen || deathOpen));
    if (deathOpen) dom.endOverlay.setAttribute('aria-labelledby', 'deathTitle');
    else if (matchOpen) dom.endOverlay.setAttribute('aria-labelledby', 'matchTitle');
  }
}

/* Погасить всё разом — начало матча, вход в комнату, респавн. */
export function hideAllOverlays() {
  for (const [name, el] of overlayEls()) {
    if (el) el.classList.add('hidden');
    overlayManager.close(name);
  }
  syncOverlayUiState();
}
