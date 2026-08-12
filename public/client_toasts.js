/* Тосты событий (#eventToasts): очередь, приоритеты, схлопывание повторов.

   Механизм был разрезан пополам: очередь, монтирование и снятие жили в
   client.js, а addToast() — в client_fx_ui.js и получал десять полей в deps,
   включая сами toastMount/toastUnmount/toastDrain. Из-за разреза в двух
   файлах лежали две одинаковые функции пульса (toastBump и toastBumpEl) с
   комментарием, объясняющим, почему их две. Здесь они снова одна.

   Три правила, ради которых всё это устроено сложнее, чем «показать и
   убрать»:
     — на экране не больше MAX_EVENT_TOASTS штук, остальные ждут в очереди;
     — J19: очередь не FIFO, а по приоритету, иначе ачивка ждёт за тремя
       «+15 Стиля»; важное событие вытесняет самый незначительный тост;
     — J20: повтор того же события не плодит второй тост, а наращивает «×N».
       Ключ намеренно не включает вариант: 'big' даунгрейдится до обычного при
       активном кулдауне, и одно событие получало два разных ключа. */

import { dom } from './client_dom.js';

const MAX_EVENT_TOASTS = 3;
const TTL_MS = { big: 8200, normal: 2200 };

// J19: приоритеты вместо чистого FIFO.
const TOAST_PRIO = { minor: 0, important: 1, jackpot: 2 };

const toastByKey = new Map();
const toastQueue = [];

/* Крупный тост не должен идти следом за крупным: два подряд читаются как
   один мигающий. Ставится при монтировании 'big'. */
let bigToastCooldownUntil = 0;

/* Клик по тосту может увести в раздел правой колонки. Сам модуль про вкладки
   не знает — обработчик регистрирует тот, кто ими владеет. */
let actionHandler = null;

export function setToastActionHandler(fn) {
  actionHandler = typeof fn === 'function' ? fn : null;
}

function prioValue(name) {
  return TOAST_PRIO[String(name || 'minor')] ?? 0;
}

const ttlOf = (item) => (item.variant === 'big' ? TTL_MS.big : TTL_MS.normal);

// J7: пульс при повторе события — с рефлоу-сбросом, иначе анимация не рестартует.
function bump(el) {
  if (!el) return;
  try {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  } catch {}
}

function scheduleRemoval(item) {
  if (item.timer) clearTimeout(item.timer);
  item.timer = setTimeout(() => {
    try {
      item.el?.remove?.();
    } catch {}
    toastByKey.delete(item.key);
    drain();
  }, ttlOf(item));
}

function mount(item) {
  if (!dom.eventToasts || !item) return;

  const wrap = document.createElement('div');
  wrap.className = item.variant === 'big' ? 'eventToast eventToastBig' : 'eventToast';

  const ic = document.createElement('div');
  ic.className = 'eventToastIcon';
  ic.textContent = String(item.icon || '★');

  const body = document.createElement('div');
  body.style.display = 'grid';
  body.style.gap = '2px';

  const tx = document.createElement('div');
  tx.className = 'eventToastText';
  const baseText = String(item.baseText || item.text || '');
  tx.textContent = item.count > 1 ? `${baseText} x${item.count}` : baseText;
  body.appendChild(tx);

  const sub = String(item.subtext || '').trim();
  if (sub) {
    const subEl = document.createElement('div');
    subEl.className = 'eventToastSub';
    subEl.textContent = sub;
    body.appendChild(subEl);
  }

  wrap.append(ic, body);

  if (item.action && typeof item.action === 'object') {
    wrap.classList.add('eventToastAction');
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'button');
    wrap.setAttribute('aria-label', baseText);
    const run = () => actionHandler?.(item.action);
    wrap.addEventListener('click', (e) => {
      e?.preventDefault?.();
      run();
    });
    wrap.addEventListener('keydown', (e) => {
      if (e.key === ' ') {
        e.preventDefault();
        run();
      }
    });
  }

  dom.eventToasts.prepend(wrap);
  item.el = wrap;
  item.textEl = tx;

  /* J21: класс .eventToastBig раньше снимался через 2100 мс при живущем
     8200 мс тосте — 3/4 времени «крупный» тост выглядел обычным. Теперь
     модификатор держится всю жизнь тоста. */
  if (item.variant === 'big') bigToastCooldownUntil = performance.now() + 2500;

  scheduleRemoval(item);
}

function unmount(item) {
  if (!item) return;
  try {
    if (item.timer) clearTimeout(item.timer);
  } catch {}
  item.timer = 0;
  try {
    item.el?.remove?.();
  } catch {}
  item.el = null;
  item.textEl = null;
  toastByKey.delete(item.key);
}

// Смонтированный тост с наименьшим приоритетом — кандидат на вытеснение.
function lowestMounted() {
  let worst = null;
  let worstPrio = Infinity;
  for (const it of toastByKey.values()) {
    if (!it?.el) continue;
    const pv = prioValue(it.prio);
    if (pv < worstPrio) {
      worstPrio = pv;
      worst = it;
    }
  }
  return worst;
}

function drain() {
  if (!dom.eventToasts) return;
  while (dom.eventToasts.children.length < MAX_EVENT_TOASTS && toastQueue.length) {
    // Берём самый приоритетный, при равенстве — самый старый.
    let best = -1;
    let bestPrio = -1;
    for (let i = 0; i < toastQueue.length; i++) {
      const it = toastByKey.get(toastQueue[i]);
      if (!it || it.el) continue;
      const pv = prioValue(it.prio);
      if (pv > bestPrio) {
        bestPrio = pv;
        best = i;
      }
    }
    if (best < 0) {
      toastQueue.length = 0;
      return;
    }
    const next = toastByKey.get(toastQueue.splice(best, 1)[0]);
    if (next && !next.el) mount(next);
  }
}

/* addToast(icon, text, variant, subtext, action)
   action — необязательный объект {key, prio, tab}: key задаёт схлопывание,
   prio — приоритет, tab — куда увести по клику. Исторически на месте subtext
   иногда передают сразу action, поэтому аргументы разбираются терпимо. */
export function addToast(icon, text, variant, subtext, action) {
  if (!dom.eventToasts) return;
  const now = performance.now();

  let v = String(variant || '');
  if (v === 'big' && now < bigToastCooldownUntil) v = '';

  let st = subtext;
  let act = action;
  if (!act && st && typeof st === 'object') {
    act = st;
    st = '';
  }

  const key = String(act?.key || `${String(icon || '')}|${String(text || '')}|${String(st || '')}`);
  const prio = String(act?.prio || (String(variant || '') === 'big' ? 'important' : 'minor'));

  const prev = toastByKey.get(key);
  if (prev) {
    prev.at = now;
    prev.count = (prev.count || 1) + 1;
    if (prioValue(prio) > prioValue(prev.prio)) prev.prio = prio;
    // Ждущий в очереди досчитает повторы и покажет их сразу при монтировании.
    if (!prev.el) return;
    try {
      const bt = String(prev.baseText || prev.text || '');
      if (prev.textEl) prev.textEl.textContent = `${bt} x${prev.count}`;
      bump(prev.el);
      scheduleRemoval(prev);
    } catch {}
    return;
  }

  const item = {
    key,
    icon,
    text: String(text || ''),
    baseText: String(text || ''),
    variant: v,
    prio,
    subtext: String(st || ''),
    action: act,
    at: now,
    count: 1,
    el: null,
    textEl: null,
    timer: 0
  };
  toastByKey.set(key, item);

  if (dom.eventToasts.children.length >= MAX_EVENT_TOASTS) {
    // J19: важное событие вытесняет самый незначительный тост на экране.
    const worst = lowestMounted();
    if (worst && prioValue(item.prio) > prioValue(worst.prio)) {
      unmount(worst);
      mount(item);
      return;
    }
    toastQueue.push(key);
    return;
  }

  mount(item);
}

/* UX18: тосты активных модификаторов раунда («Раунд: …») теряют смысл, когда
   игрок уже смотрит на экран смерти или итогов. */
export function dismissRoundModToasts() {
  for (const item of Array.from(toastByKey.values())) {
    if (String(item.key || '').startsWith('mutator_') && item.el) unmount(item);
  }
}

/* Полный сброс на границе матча: чужие тосты не должны переезжать в новый. */
export function resetToasts() {
  for (const item of Array.from(toastByKey.values())) unmount(item);
  toastByKey.clear();
  toastQueue.length = 0;
  bigToastCooldownUntil = 0;
  if (dom.eventToasts) dom.eventToasts.replaceChildren();
}
