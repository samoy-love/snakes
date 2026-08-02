/* Утилиты без игрового состояния — всё, что зависит только от аргументов.
   Четыре группы: числовые помощники и easing; чистка ника и названия комнаты
   (повторяет серверные правила, чтобы UI не расходился с ответом сервера);
   экранирование HTML и подстановка twemoji; ловушка фокуса для оверлеев. */

// --- Числа и интерполяция ---

export function clampInt(v, lo, hi) {
  const n = Math.floor(Number(v) || 0);
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

export function easeOutCubic(p) {
  const t = Math.max(0, Math.min(1, p));
  return 1 - Math.pow(1 - t, 3);
}

export function easeOutBack(p) {
  const t = Math.max(0, Math.min(1, p));
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// --- Ники и названия комнат: та же чистка, что делает сервер ---

export function normalizeMenuNickInput(name) {
  const raw = String(name || '')
    .replace(/\r|\n|\t/g, ' ')
    .trim();
  if (!raw) return { raw: '', value: '', hasBadChars: false };

  const maxLen = 18;
  let out = '';
  let hasBadChars = false;
  for (const ch of raw) {
    if (out.length >= maxLen) break;
    const code = ch.codePointAt(0);
    if (code == null) continue;
    if (code < 0x20) continue;
    if (ch === '<' || ch === '>') {
      hasBadChars = true;
      continue;
    }

    const ok =
      ch === ' ' ||
      ch === '-' ||
      ch === '_' ||
      (ch >= '0' && ch <= '9') ||
      (ch >= 'A' && ch <= 'Z') ||
      (ch >= 'a' && ch <= 'z') ||
      (ch >= 'А' && ch <= 'я') ||
      ch === 'Ё' ||
      ch === 'ё';

    if (!ok) {
      hasBadChars = true;
      continue;
    }
    out += ch;
  }
  out = out.replace(/\s+/g, ' ').trim();
  return { raw, value: out, hasBadChars };
}

export function sanitizeNameClient(name) {
  const v = normalizeMenuNickInput(name);
  if (!v.value) return '';
  if (v.hasBadChars) return '';
  if (v.value.length < 2) return '';
  return v.value;
}

export function sanitizeRoomTitleClient(title) {
  const raw = String(title || '')
    .replace(/\r|\n|\t/g, ' ')
    .trim();
  if (!raw) return '';

  const maxLen = 32;
  let out = '';
  for (const ch of raw) {
    if (out.length >= maxLen) break;
    const code = ch.codePointAt(0);
    if (code == null) continue;
    if (code < 0x20) continue;
    if (ch === '<' || ch === '>') continue;
    out += ch;
  }
  return out.trim();
}

// --- Экранирование HTML и подстановка twemoji-картинок ---

export const EMOJIS = [
  '\u{1F44B}',
  '\u{1F44D}',
  '\u{1F44E}',
  '\u{2705}',
  '\u{274C}',
  '\u{2753}',
  '\u{203C}\u{FE0F}',
  '\u{26A0}\u{FE0F}',
  '\u{1F198}',
  '\u{23F3}',
  '\u{1F440}',
  '\u{1F9E0}',
  '\u{1F5FA}\u{FE0F}',
  '\u{1F9ED}',
  '\u{1F3C1}',
  '\u{1F6A9}',
  '\u{1F3AF}',
  '\u{2694}\u{FE0F}',
  '\u{1F6E1}\u{FE0F}',
  '\u{1F3F9}',
  '\u{1F4A3}',
  '\u{1F4A5}',
  '\u{1F525}',
  '\u{26A1}',
  '\u{2728}',
  '\u{2764}\u{FE0F}',
  '\u{1F494}',
  '\u{1F602}',
  '\u{1F605}',
  '\u{1F60E}',
  '\u{1F621}',
  '\u{1F62D}',
  '\u{1F631}',
  '\u{1F92F}'
];

const EMOJI_PNG_BASE = '/emoji-64/';

const TWEMOJI_OPTS = {
  callback: (icon) => {
    const normalized = String(icon).toLowerCase().replace(/-fe0f/g, '');
    return `${EMOJI_PNG_BASE}${normalized}.png`;
  },
  className: 'emoji',
  attributes: () => ({ loading: 'lazy', decoding: 'async' })
};

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function emojiParseSafeHtml(text) {
  const raw = String(text);
  const escaped = escapeHtml(raw);
  if (!/[\p{Extended_Pictographic}]/u.test(raw)) return escaped;
  const tw = globalThis.twemoji;
  if (tw && typeof tw.parse === 'function') return tw.parse(escaped, TWEMOJI_OPTS);
  return escaped;
}

export function setSafeHtml(el, html) {
  if (!el) return;
  el.innerHTML = String(html ?? '');
}

export function setSafeEmojiHtml(el, text) {
  if (!el) return;
  el.innerHTML = emojiParseSafeHtml(text);
}

// --- Ловушка фокуса для модальных оверлеев ---

function focusablesIn(root) {
  if (!root) return [];
  const nodes = Array.from(
    root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
  );
  return nodes.filter((el) => {
    if (el.disabled) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.tabIndex < 0) return false;
    const r = el.getBoundingClientRect?.();
    if (r && r.width === 0 && r.height === 0) return false;
    return true;
  });
}

function trapFocusIn(root, e) {
  const list = focusablesIn(root);
  if (!list.length) return;
  const first = list[0];
  const last = list[list.length - 1];
  const active = document.activeElement;
  if (e.shiftKey) {
    if (active === first || !root.contains(active)) {
      last.focus();
      e.preventDefault();
    }
  } else {
    if (active === last || !root.contains(active)) {
      first.focus();
      e.preventDefault();
    }
  }
}

// --- Стек модальных оверлеев: кто сверху, куда вернуть фокус, что закрыть по Esc ---

export const overlayManager = (() => {
  const stack = [];
  const defs = new Map();

  const normalize = (id) => String(id || '').trim();

  const register = (id, def) => {
    const k = normalize(id);
    if (!k) return;
    defs.set(k, def || {});
  };

  const isOpen = (id) => {
    const k = normalize(id);
    return k ? stack.includes(k) : false;
  };

  const open = (id) => {
    const k = normalize(id);
    if (!k) return;
    const i = stack.lastIndexOf(k);
    if (i >= 0) stack.splice(i, 1);
    stack.push(k);
  };

  const close = (id) => {
    const k = normalize(id);
    if (!k) return;
    const i = stack.lastIndexOf(k);
    if (i >= 0) stack.splice(i, 1);
  };

  const getTop = () => {
    if (!stack.length) return null;
    return stack[stack.length - 1] || null;
  };

  const getTopDef = () => {
    const top = getTop();
    return top ? defs.get(top) : null;
  };

  const getRoot = (def) => {
    if (!def) return null;
    const r = def.root;
    if (typeof r === 'function') return r();
    return r || null;
  };

  const getDefaultFocus = (def) => {
    if (!def) return null;
    const root = getRoot(def);
    const df = def.defaultFocus;
    if (typeof df === 'function') return df();
    if (typeof df === 'string' && root) return root.querySelector(df);
    return null;
  };

  const focusDefault = (id) => {
    const k = normalize(id);
    const def = k ? defs.get(k) : null;
    if (!def) return;
    const root = getRoot(def);
    const target = getDefaultFocus(def) || focusablesIn(root)[0];
    if (!target) return;
    try {
      requestAnimationFrame(() => target?.focus?.());
    } catch {}
  };

  const trapFocus = (e) => {
    const def = getTopDef();
    if (!def || def.trap === false) return false;
    const root = getRoot(def);
    if (!root) return false;
    trapFocusIn(root, e);
    return true;
  };

  const closeTop = () => {
    const id = getTop();
    if (!id) return false;
    const def = defs.get(id);
    if (!def || def.closable === false) return false;
    try {
      def.close?.();
    } catch {}
    return true;
  };

  return {
    register,
    isOpen,
    open,
    close,
    getTop,
    focusDefault,
    trapFocus,
    closeTop
  };
})();
