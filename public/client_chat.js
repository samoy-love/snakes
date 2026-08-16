/* Чат целиком: подложка ввода, сворачивание, непрочитанные, подсказка Enter,
   статус в шапке и обвязка над client_chat_ui.js (рендер лога и эмодзи-панель).
   Раньше всё это лежало в client.js вперемешку с отрисовкой поля.

   Модуль сам подписывается на смену языка — тексты шапки собираются в JS и на
   переключении языка не пересобирались, оставаясь на прежнем.

   Наружу нужны только две вещи, которые нельзя импортировать без цикла:
   отправка в сокет и суффикс состояния соединения. Они приходят в initChat().
   Обработчики вешаются оттуда же, а не при загрузке модуля: updateChatHeaderStatus()
   дёргает wsStatusSuffix(), а сетевой модуль в client.js создаётся позже. */

import { clientState } from './client_state.js';
import { KEYS, storageFlag, storageGet, storageSetFlag } from './client_storage.js';
import { session, ui } from './client_store.js';
import { dom, setChatInputEl } from './client_dom.js';
import { EMOJIS, setSafeEmojiHtml } from './client_util.js';
import { isOverlayOpen } from './client_overlays.js';
import { onLangChange, t } from './client_i18n_rt.js';
import { displayNameOf } from './client_identity.js';
import { formatTime } from './client_labels.js';
import { createChatUi } from './client_chat_ui.js';

let wsSend = () => false;
let wsStatusSuffix = () => '';

let chatUi = null;

let chatOpenUntil = 0;

const CHAT_AUTO_OPEN_MS = 6500;

export function getChatOpenUntil() {
  return chatOpenUntil;
}

export function bumpChatOpenUntilBy(ms) {
  chatOpenUntil = performance.now() + (Number(ms) || 0);
}

/* Поле ввода в разметке — <input>, но перенос строки по Shift+Enter требует
   textarea. Подменяем узел на месте, сохраняя атрибуты и значение. */
function ensureChatTextarea() {
  if (!dom.chatInput || dom.chatInput.tagName === 'TEXTAREA') return;
  const prev = dom.chatInput;
  const ta = document.createElement('textarea');
  ta.id = prev.id;
  ta.placeholder = prev.getAttribute('placeholder') || '';
  ta.maxLength = prev.maxLength;
  ta.autocomplete = prev.autocomplete;
  ta.autocapitalize = prev.autocapitalize;
  ta.autocorrect = prev.getAttribute('autocorrect') || '';
  ta.spellcheck = prev.spellcheck;
  ta.rows = 1;
  ta.value = prev.value || '';
  for (const a of prev.getAttributeNames()) {
    if (a === 'id') continue;
    if (a === 'value') continue;
    if (a === 'placeholder') continue;
    try {
      if (!ta.hasAttribute(a)) ta.setAttribute(a, prev.getAttribute(a) || '');
    } catch {}
  }
  try {
    prev.replaceWith(ta);
  } catch {
    return;
  }
  setChatInputEl(ta);
}

/* Подмена узла обязана произойти до того, как кто-нибудь запомнит ссылку на
   поле ввода, поэтому она идёт при загрузке модуля, а не из initChat(). */
ensureChatTextarea();

export function bumpChatVisibility(ms, focusInput) {
  if (!dom.chat) return;
  if (isOverlayOpen('menu')) return;
  if (isOverlayOpen('settings')) return;
  if (isOverlayOpen('cosmetics')) return;
  if (isOverlayOpen('match')) return;

  if (dom.chat.classList.contains('collapsed')) setChatCollapsed(false);
  const now = performance.now();
  const d = Math.max(0, Number(ms) || 0);
  chatOpenUntil = Math.max(chatOpenUntil, now + d);
  if (focusInput && dom.chatInput) {
    try {
      dom.chatInput.focus();
    } catch {}
  }
}

let unreadCount = 0;

function updateUnreadBadge() {
  if (!dom.chatUnread) return;
  const n = Math.max(0, Number(unreadCount) || 0);
  if (n <= 0) {
    dom.chatUnread.classList.add('hidden');
    dom.chatUnread.textContent = '';
    return;
  }
  dom.chatUnread.classList.remove('hidden');
  dom.chatUnread.textContent = n > 99 ? '99+' : String(n);
}

function updateChatLayout() {
  if (!dom.chat || !dom.chatLog) return;
  const count = clientState.chatMessages.length;
  dom.chat.classList.toggle('chatEmpty', count <= 0);
  let max = 320;
  if (count <= 0) max = 80;
  if (count <= 2) max = 140;
  if (count <= 6) max = 220;
  try {
    dom.chat.style.setProperty('--chat-log-max', `${max}px`);
  } catch {}
}

function notifyChatUnread() {
  unreadCount = Math.min(999, unreadCount + 1);
  updateUnreadBadge();
}

function buildChatLineElement(m) {
  return chatUi?.buildChatLineElement(m);
}

export function renderChat() {
  chatUi?.renderChat();
}

function addChatLine(msg) {
  chatUi?.addChatLine(msg);
}

export function onChatInit(history) {
  chatUi?.onChatInit(history);
  ui.chatDirty = false;
}

export function toggleEmojiPanel(open) {
  chatUi?.toggleEmojiPanel(open);
}

export function onChat(m) {
  if (!m) return;
  addChatLine(m);
  updateChatHeaderStatus();
}

export function setChatCollapsed(v) {
  dom.chat.classList.toggle('collapsed', v);
  if (v) toggleEmojiPanel(false);
  if (!v) {
    unreadCount = 0;
    updateUnreadBadge();
    if (ui.chatDirty) {
      renderChat();
      ui.chatDirty = false;
    }
  }

  storageSetFlag(KEYS.chatCollapsed, v);
}

export function getChatCollapsedDefault() {
  const raw = storageGet(KEYS.chatCollapsed);
  if (raw === '1') return true;
  if (raw === '0') return false;
  const small = (window.innerWidth <= 1400 && window.innerHeight <= 820) || window.innerWidth <= 720;
  return small;
}

let chatEnterHintTimer = 0;
let chatEnterHintDismissed = false;

function hideChatEnterHint() {
  if (!dom.chatHeaderHint || chatEnterHintDismissed) return;
  chatEnterHintDismissed = true;
  dom.chatHeaderHint.classList.add('hidden');
  if (chatEnterHintTimer) {
    clearTimeout(chatEnterHintTimer);
    chatEnterHintTimer = 0;
  }
  storageSetFlag(KEYS.chatEnterHint, true);
}

function initChatEnterHint() {
  if (!dom.chatHeaderHint) return;
  const dismissed = storageFlag(KEYS.chatEnterHint, false);
  if (dismissed) {
    chatEnterHintDismissed = true;
    dom.chatHeaderHint.classList.add('hidden');
    return;
  }
  dom.chatHeaderHint.classList.remove('hidden');
  if (chatEnterHintTimer) clearTimeout(chatEnterHintTimer);
  chatEnterHintTimer = setTimeout(() => {
    hideChatEnterHint();
  }, 12000);
}

let chatHeaderStatusEl = null;
let chatCollapseBtnEl = null;

export function updateChatHeaderStatus() {
  if (!chatHeaderStatusEl) return;
  const inRoom = session.roomId != null;
  const suf = wsStatusSuffix();
  const base = inRoom ? `${t('chat.status_room')} ${session.roomId}` : t('chat.status_lobby');
  chatHeaderStatusEl.textContent = `${base}${suf ? ` ${suf}` : ''}`;
}

function syncChatCollapseButtonUi() {
  if (!chatCollapseBtnEl) return;
  const collapsed = dom.chat.classList.contains('collapsed');
  chatCollapseBtnEl.textContent = collapsed ? '▸' : '▾';
  chatCollapseBtnEl.setAttribute('aria-label', collapsed ? t('chat.expand') : t('chat.collapse'));
}

export function initChat(ctx) {
  if (typeof ctx?.wsSend === 'function') wsSend = ctx.wsSend;
  if (typeof ctx?.wsStatusSuffix === 'function') wsStatusSuffix = ctx.wsStatusSuffix;

  updateUnreadBadge();

  chatUi = createChatUi({
    chat: dom.chat,
    chatLog: dom.chatLog,
    chatInput: dom.chatInput,
    emojiBtn: dom.emojiBtn,
    emojiPanel: dom.emojiPanel,
    emojiCloseBtn: dom.emojiCloseBtn,
    emojiRecent: dom.emojiRecent,
    emojiGrid: dom.emojiGrid,
    EMOJIS,
    setSafeEmojiHtml,
    displayNameOf,
    formatTime,
    getYou: () => session.you,
    updateChatLayout,
    bumpChatVisibility,
    CHAT_AUTO_OPEN_MS,
    notifyUnread: notifyChatUnread,
    setChatCollapsed: (v) => setChatCollapsed(v),
    bumpChatOpenUntil: bumpChatOpenUntilBy
  });

  try {
    if (dom.emojiBtn) dom.emojiBtn.classList.add('iconBtn');
    if (dom.chatBtn) {
      dom.chatBtn.classList.add('iconBtn');
      dom.chatBtn.replaceChildren();
      const s = document.createElement('span');
      s.setAttribute('aria-hidden', 'true');
      s.textContent = '➤';
      dom.chatBtn.appendChild(s);
    }
  } catch {}

  dom.chatInput?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (e.shiftKey) {
      chatOpenUntil = performance.now() + 12000;
      return;
    }
    e.preventDefault();
    try {
      dom.chatForm?.requestSubmit?.();
    } catch {
      try {
        dom.chatForm?.dispatchEvent?.(new Event('submit', { cancelable: true }));
      } catch {}
    }
  });

  setChatCollapsed(getChatCollapsedDefault());
  initChatEnterHint();

  chatHeaderStatusEl = (() => {
    if (!dom.chatHeader) return null;
    const left = document.getElementById('chatHeaderLeft');
    if (!left) return null;
    const el = document.createElement('span');
    el.id = 'chatHeaderStatus';
    el.className = 'chatHeaderStatus';
    left.appendChild(el);
    return el;
  })();

  chatCollapseBtnEl = (() => {
    if (!dom.chatHeader) return null;
    const right = document.getElementById('chatHeaderRight');
    if (!right) return null;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'iconBtn chatCollapseBtn';
    b.setAttribute('data-role', 'chatCollapse');
    b.appendChild(document.createTextNode('▾'));
    right.appendChild(b);
    return b;
  })();

  syncChatCollapseButtonUi();
  updateChatHeaderStatus();

  try {
    if (dom.chatHeader) {
      dom.chatHeader.tabIndex = 0;
      dom.chatHeader.setAttribute('role', 'button');
    }
  } catch {}

  dom.chatHeader.addEventListener('click', (e) => {
    const role = String(e?.target?.getAttribute?.('data-role') || '');
    if (role === 'chatCollapse') {
      const isCollapsed = dom.chat.classList.contains('collapsed');
      if (isCollapsed) {
        setChatCollapsed(false);
        chatOpenUntil = performance.now() + 12000;
        try {
          dom.chatInput?.focus?.();
        } catch {}
      } else {
        setChatCollapsed(true);
      }
      syncChatCollapseButtonUi();
      e?.preventDefault?.();
      e?.stopPropagation?.();
      return;
    }
    const isCollapsed = dom.chat.classList.contains('collapsed');
    if (isCollapsed) {
      setChatCollapsed(false);
      chatOpenUntil = performance.now() + 12000;
      dom.chatInput.focus();
      e?.preventDefault?.();
    } else {
      setChatCollapsed(true);
    }
    syncChatCollapseButtonUi();
  });

  dom.chatHeader.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const role = String(e?.target?.getAttribute?.('data-role') || '');
      if (role === 'chatCollapse') return;
      e.preventDefault();
      dom.chatHeader.click();
    }
  });

  dom.chatInput?.addEventListener('input', () => {
    if (dom.chatInput && String(dom.chatInput.value || '').trim()) hideChatEnterHint();
  });

  dom.chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = String(dom.chatInput.value || '').trim();
    if (!text) return;
    wsSend('chat', { text });
    hideChatEnterHint();
    dom.chatInput.value = '';
    chatOpenUntil = performance.now() + 12000;
    unreadCount = 0;
    updateUnreadBadge();
  });

  onLangChange(() => {
    updateChatHeaderStatus();
    syncChatCollapseButtonUi();
  });
}
