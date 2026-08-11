/* Общее мутируемое состояние client.js, которое раньше жило в плоских
   module-level let/const и читалось/писалось вперемешку десятками функций.

   Здесь оно собрано в один объект, чтобы состояние было видно одним
   взглядом и чтобы поля не расползались по файлу поодиночке. Поведение
   не меняется — это перенос присваиваний, а не рефакторинг логики. */

export const clientState = {
  // Последний снимок состояния от сервера и время его получения.
  lastState: null,
  lastStateAt: null,

  // Кэш DOM-строк лидерборда по id игрока — переиспользуются между кадрами.
  leaderboardRowsById: new Map(),

  // Локальная лента сообщений чата.
  chatMessages: [],

  // Зоны и таймеры миникарты: метка топ-1 и цели баунти на карте, их
  // "прилипание" к одному игроку и кулдаун переключения.
  minimapTop1Zone: null,
  minimapBountyZone: null,
  minimapTop1PinnedId: 0,
  minimapTop1NextSwitchAt: 0,
  minimapLastBountyTarget: 0,

  // Камера: текущая позиция и её "разгон" за целью (лид).
  camX: null,
  camY: null,
  camLeadX: 0,
  camLeadY: 0
};

/* Единственная точка входа для дозаписи в chatMessages — WS-хендлеры и
   рендер чата (public/client_chat_ui.js) больше не пушат в массив напрямую.
   Возвращает true, если самое старое сообщение пришлось обрезать (лимит
   истории — 200), чтобы вызывающий знал, что нужен полный renderChat(), а
   не точечное добавление одной строки. */
export function pushChatMessage(msg) {
  clientState.chatMessages.push(msg);
  let shifted = false;
  while (clientState.chatMessages.length > 200) {
    clientState.chatMessages.shift();
    shifted = true;
  }
  return shifted;
}

/* Полная замена истории чата при входе в комнату (onChatInit). */
export function resetChatMessages(history) {
  clientState.chatMessages.length = 0;
  if (Array.isArray(history)) {
    for (const m of history) clientState.chatMessages.push(m);
  }
}
