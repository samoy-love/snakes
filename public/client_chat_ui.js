/* Рендер чата (лог сообщений) и эмодзи-панели. Раньше жил в client.js и
   читал/писал через plain module-level переменные и десяток внешних
   хелперов напрямую. Здесь то же поведение, но всё внешнее приходит через
   deps, а список сообщений — через client_state.js (pushChatMessage /
   resetChatMessages), а не как голый module-глобал.

   createChatUi(deps) один раз создаёт замыкание над DOM чата и возвращает
   { renderChat, buildChatLineElement, addChatLine, onChatInit,
     toggleEmojiPanel } — client.js держит эти имена как раньше, только
   вызовы уходят в возвращённый объект. */

import { clientState, pushChatMessage, resetChatMessages } from './client_state.js';
import { KEYS, storageGetJson, storageSetJson } from './client_storage.js';

export function createChatUi(deps) {
  const {
    chat,
    chatLog,
    chatInput,
    emojiBtn,
    emojiPanel,
    emojiCloseBtn,
    emojiRecent,
    emojiGrid,
    EMOJIS,
    setSafeEmojiHtml,
    displayNameOf,
    formatTime,
    getYou,
    updateChatLayout,
    bumpChatVisibility,
    CHAT_AUTO_OPEN_MS,
    notifyUnread,
    setChatCollapsed,
    bumpChatOpenUntil
  } = deps;

  let chatRenderedCount = 0;

  function buildChatLineElement(m) {
    const line = document.createElement('div');
    line.className = 'chatLine';
    if (m?.n === getYou()) line.classList.add('me');

    const meta = document.createElement('div');
    meta.className = 'chatMeta';

    const nameEl = document.createElement('div');
    nameEl.className = 'chatName';
    nameEl.textContent = displayNameOf(m?.n);

    const timeEl = document.createElement('div');
    timeEl.className = 'chatTime';
    timeEl.textContent = formatTime(m?.t);

    meta.appendChild(nameEl);
    meta.appendChild(timeEl);

    const textEl = document.createElement('div');
    textEl.className = 'chatText';
    setSafeEmojiHtml(textEl, String(m?.text ?? ''));

    line.appendChild(meta);
    line.appendChild(textEl);
    return line;
  }

  function renderChat() {
    const atBottom = chatLog.scrollTop + chatLog.clientHeight >= chatLog.scrollHeight - 24;

    const frag = document.createDocumentFragment();
    for (const m of clientState.chatMessages) {
      frag.appendChild(buildChatLineElement(m));
    }

    chatLog.replaceChildren(frag);
    chatRenderedCount = clientState.chatMessages.length;
    if (atBottom) chatLog.scrollTop = chatLog.scrollHeight;
    updateChatLayout();
  }

  function addChatLine(msg) {
    const shifted = pushChatMessage(msg);
    if (chat.classList.contains('collapsed')) {
      bumpChatVisibility(CHAT_AUTO_OPEN_MS, false);
    }

    try {
      const ae = document.activeElement;
      const focused = !!(ae && chat.contains(ae));
      if (!focused) notifyUnread();
    } catch {}

    if (shifted) {
      renderChat();
      bumpChatVisibility(CHAT_AUTO_OPEN_MS, false);
      updateChatLayout();
      return;
    }

    if (chatRenderedCount === clientState.chatMessages.length - 1) {
      const atBottom = chatLog.scrollTop + chatLog.clientHeight >= chatLog.scrollHeight - 24;
      chatLog.appendChild(buildChatLineElement(msg));
      chatRenderedCount = clientState.chatMessages.length;
      if (atBottom) chatLog.scrollTop = chatLog.scrollHeight;
    } else {
      renderChat();
    }
    bumpChatVisibility(CHAT_AUTO_OPEN_MS, false);
    updateChatLayout();
  }

  function onChatInit(history) {
    chatLog.textContent = '';
    resetChatMessages(history);
    renderChat();
    updateChatLayout();
  }

  // --- Эмодзи-панель ---

  let recentEmojis = [];

  function getEmojiCode(e) {
    const cps = Array.from(String(e)).map((ch) => ch.codePointAt(0).toString(16));
    return cps.join('-').toLowerCase().replace(/-fe0f/g, '');
  }

  function loadRecentEmojis() {
    const v = storageGetJson(KEYS.recentEmojis);
    if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').slice(0, 24);
    return [];
  }

  function saveRecentEmojis() {
    storageSetJson(KEYS.recentEmojis, recentEmojis.slice(0, 24));
  }

  function pushRecentEmoji(e) {
    const s = String(e);
    recentEmojis = [s, ...recentEmojis.filter((x) => x !== s)].slice(0, 24);
    saveRecentEmojis();
  }

  function insertAtCursor(el, text) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    el.value = `${before}${text}${after}`;
    const pos = start + text.length;
    el.selectionStart = pos;
    el.selectionEnd = pos;
    el.focus();
    if (el === chatInput) deps.scheduleChatInputOverlayRender?.();
  }

  function createEmojiButton(e) {
    const b = document.createElement('button');
    b.type = 'button';
    setSafeEmojiHtml(b, e);
    b.addEventListener('click', () => {
      insertAtCursor(chatInput, e);
      pushRecentEmoji(e);
      renderEmojiRecent();
      bumpChatOpenUntil(12000);
    });
    return b;
  }

  function renderEmojiGrid(list) {
    if (!emojiGrid) return;
    const frag = document.createDocumentFragment();
    for (const e of list) frag.appendChild(createEmojiButton(e));
    emojiGrid.replaceChildren(frag);
  }

  function renderEmojiRecent() {
    if (!emojiRecent) return;
    if (!recentEmojis.length) {
      emojiRecent.classList.add('hidden');
      emojiRecent.replaceChildren();
      return;
    }
    emojiRecent.classList.remove('hidden');
    const frag = document.createDocumentFragment();
    for (const e of recentEmojis) frag.appendChild(createEmojiButton(e));
    emojiRecent.replaceChildren(frag);
  }

  function toggleEmojiPanel(open) {
    if (!emojiPanel) return;
    const shouldOpen = open ?? !emojiPanel.classList.contains('open');
    emojiPanel.classList.toggle('open', shouldOpen);
    if (shouldOpen) {
      bumpChatOpenUntil(12000);
      renderEmojiRecent();
    } else {
      renderEmojiGrid(EMOJIS);
    }
  }

  emojiBtn?.addEventListener('click', () => {
    if (chat.classList.contains('collapsed')) setChatCollapsed(false);
    toggleEmojiPanel();
  });

  emojiCloseBtn?.addEventListener('click', () => {
    toggleEmojiPanel(false);
  });

  recentEmojis = loadRecentEmojis();
  renderEmojiGrid(EMOJIS);
  if (emojiBtn) setSafeEmojiHtml(emojiBtn, '\u{1F600}');

  return {
    buildChatLineElement,
    renderChat,
    addChatLine,
    onChatInit,
    toggleEmojiPanel,
    getEmojiCode
  };
}
