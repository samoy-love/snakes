// Широкий каталог состояний для визуального ревью (docs/reviews/review-loop-prompt.md,
// разделы 1.1-1.3). ДАННЫЕ, минимум кода: run(page) наполняет реальное
// состояние клиента через window.__snakesDebug (public/client_debug.js,
// только под ?debug=1) и через обычные пользовательские действия там, где
// debug-мосту взяться неоткуда (настройки — обычные переключатели формы).
//
// Каждая запись — { id, description, viewport?, run(page) }. id совпадает с
// заголовком теста в catalog.spec.mjs, поэтому --grep Playwright фильтрует
// каталог "из коробки". viewport, если задан, — имя проекта из VIEWPORTS
// (playwright.config.mjs); запись без него прогоняется на всех вьюпортах.

import { gotoDebug, callDebug } from './catalog-helpers.mjs';

// --- Смерть -----------------------------------------------------------------

const DEATH_REASONS = ['cut', 'headon', 'selftrail', 'wall'];

const deathEntries = DEATH_REASONS.map((reason) => ({
  id: `death-${reason}`,
  description: `Экран смерти — причина «${reason}»`,
  async run(page) {
    await gotoDebug(page);
    await callDebug(page, 'death', reason);
    await page.locator('#deathOverlay').waitFor({ state: 'visible' });
  }
}));

// F16b/K4: человеческая подсказка под причиной смерти (client_death_ui.js:
// renderDeathReasonImpl, deathsSeen < 3) живёт только первые три смерти
// профиля — дальше остаётся сухая причина без объяснения. debug.deathExhausted
// (public/client_debug.js) поднимает obDeathsSeen() до 3 тремя вызовами
// obBumpDeaths() перед показом оверлея — тем же путём, каким реальный
// showDeathOverlay() сам считает счётчик. Причина зафиксирована одна ('wall') —
// подсказка от причины не зависит, только от deathsSeen, дублировать на все
// четыре не нужно.
const deathExhaustedEntry = {
  id: 'death-wall-hint-exhausted',
  description: 'Экран смерти — причина «wall», подсказка новичка уже исчерпана (4-я смерть подряд)',
  async run(page) {
    await gotoDebug(page);
    await callDebug(page, 'deathExhausted', 'wall');
    await page.locator('#deathOverlay').waitFor({ state: 'visible' });
  }
};

// --- Итоги матча --------------------------------------------------------------

function player(n, over) {
  return {
    n,
    p: 1000 - n * 40,
    pk: 300 - n * 10,
    avg: 150 - n * 5,
    k: Math.max(0, 5 - n),
    d: n % 3,
    place: n,
    ...over
  };
}

const matchResultsEntries = [
  {
    id: 'match-results-solo',
    description: 'Итоги матча — один игрок (единственный участник)',
    run: matchResultsRun([player(1, { n: 1 })])
  },
  {
    id: 'match-results-many',
    description: 'Итоги матча — много игроков, я не первый',
    run: matchResultsRun(Array.from({ length: 12 }, (_, i) => player(i + 1)))
  },
  {
    id: 'match-results-leader-left',
    description: 'Итоги матча — лидер отключился (место занято, но без ника)',
    run: matchResultsRun([
      player(1, { nm: '' }),
      player(2),
      player(3)
    ])
  }
];

function matchResultsRun(list) {
  return async (page) => {
    await gotoDebug(page);
    await callDebug(page, 'matchResults', list);
    await page.locator('#matchOverlay').waitFor({ state: 'visible' });
  };
}

// match-results-* выше не зовут updateMatchCountdown() — #matchCountdown у
// них так и остаётся заглушкой «—» (см. index.html: matchHint). Обратный
// отсчёт до следующего матча — отдельное, содержательно другое состояние того
// же #matchOverlay: тот же путь, что и настоящий конец матча (client_match.js:
// onMatchEndImpl выставляет match.ended/match.resetAt, updateMatchCountdown()
// в client_endgame.js считает остаток по approxNowTick()/session.tickMs).
const matchCountdownEntry = {
  id: 'match-countdown',
  description: 'Итоги матча — с живым обратным отсчётом до следующего матча',
  async run(page) {
    await gotoDebug(page);
    await callDebug(page, 'matchCountdownScene', 8);
    await page.locator('#matchOverlay').waitFor({ state: 'visible' });
    const el = page.locator('#matchCountdown');
    await el.waitFor({ state: 'visible' });
  }
};

// --- Магазин: декартово произведение вкладок × фильтров ---------------------

const SHOP_TABS = ['terr', 'seg', 'head', 'death', 'capturefx', 'nameplate', 'frame', 'title'];
const SHOP_FILTERS = ['all', 'owned', 'available'];

// cosmetics locked+progress: заблокированный товар с прогресс-баром до цены
// НЕ может появиться на shop-*-available ни при каких фейковых данных —
// public/client_cos_ui.js: visibleItems() исключает такие карточки из выдачи
// самим условием фильтра (`filter === 'available' && (owned || bal < price)`
// -> continue): 'available' по определению показывает только то, что уже по
// карману, то есть !isLocked. isLocked (`!owned && balance < price`,
// public/client_shop_ui.js) возможен только под фильтром 'all' — и там он
// гарантирован без какой-либо специальной подготовки данных: заход с
// ?debug=1 без входа в матч оставляет cos.style (баланс) = 0 и titleMask/inv
// пустыми (public/client_store.js: cos.style=0, ничего не куплено), а
// public/client_cos_model.js: priceOf() при cos.prices=null берёт
// COSMETICS_FALLBACK_PRICES — ненулевые цены почти везде, кроме id=0. Значит
// shop-*-all уже гарантированно показывает как минимум одну locked-карточку
// с прогресс-баром на дефолтных данных — чинить здесь нечего.

const shopEntries = [];
for (const tab of SHOP_TABS) {
  for (const filter of SHOP_FILTERS) {
    shopEntries.push({
      id: `shop-${tab}-${filter}`,
      description: `Магазин — вкладка «${tab}», фильтр «${filter}»`,
      async run(page) {
        await gotoDebug(page);
        await callDebug(page, 'shopState', tab, filter);
        await page.locator('#cosmeticsOverlay').waitFor({ state: 'visible' });
      }
    });
  }
}

const shopErrorEntry = {
  id: 'shop-error-status',
  description: 'Магазин — статус ошибки покупки (#cosmeticsStatus), тот же путь, что и cosmetics_not_enough_style с сервера',
  async run(page) {
    await gotoDebug(page);
    await callDebug(page, 'shopStatus');
    await page.locator('#cosmeticsStatus').waitFor({ state: 'visible' });
  }
};

// --- Комнаты ------------------------------------------------------------------

function room(id, over) {
  return { id, title: `Комната ${id}`, humans: 3, limit: 16, names: ['Аня', 'Боря', 'Вика'], nameCount: 3, ...over };
}

const roomsEntries = [
  {
    id: 'rooms-empty',
    description: 'Список комнат — пусто',
    run: roomsRun([], null)
  },
  {
    id: 'rooms-one',
    description: 'Список комнат — одна комната',
    run: roomsRun([room(1)], null)
  },
  {
    id: 'rooms-many',
    description: 'Список комнат — много комнат',
    run: roomsRun(Array.from({ length: 10 }, (_, i) => room(i + 1, { humans: i % 16, limit: 16 })), null)
  },
  {
    id: 'rooms-search',
    description: 'Список комнат — с активным поиском',
    run: roomsRun(
      [room(1, { title: 'Дружеская' }), room(2, { title: 'Турнир' }), room(3, { title: 'Дружеская 2' })],
      'Дружеская'
    )
  }
];

function roomsRun(list, query) {
  return async (page) => {
    await gotoDebug(page);
    await callDebug(page, 'roomsList', list);
    if (query != null) {
      await page.fill('#roomsSearchInput', query);
    }
    await page.locator('#roomsList').waitFor({ state: 'visible' });
  };
}

// Форма создания комнаты (public/client_rooms_ui.js: updateRoomsCreateUiImpl,
// вызывается из public/client_menu.js: setRoomsCreateOpen/updateRoomsCreateUi).
// roomsCreateInvalid воспроизводит тот же текст ошибки, что и реальный ответ
// сервера code==='room_title_invalid' (public/client_ws_handlers.js: onError).
const roomsCreateEntries = [
  {
    id: 'rooms-create-empty',
    description: 'Форма создания комнаты — открыта, пустая',
    async run(page) {
      await gotoDebug(page);
      await callDebug(page, 'roomsCreateEmpty');
      await page.locator('#roomsCreate').waitFor({ state: 'visible' });
    }
  },
  {
    id: 'rooms-create-invalid',
    description: 'Форма создания комнаты — ошибка валидации названия',
    async run(page) {
      await gotoDebug(page);
      await callDebug(page, 'roomsCreateInvalid');
      await page.locator('#roomsCreateError').waitFor({ state: 'visible' });
    }
  }
];

// --- Чат ------------------------------------------------------------------

const chatEntries = [
  {
    id: 'chat-empty',
    description: 'Чат — пусто',
    run: chatRun([])
  },
  {
    id: 'chat-history',
    description: 'Чат — история сообщений',
    run: chatRun([
      { n: 1, text: 'Привет!', t: Date.now() / 1000 },
      { n: 2, text: 'Го в команду', t: Date.now() / 1000 },
      { n: 1, text: 'Го', t: Date.now() / 1000 }
    ])
  },
  {
    id: 'chat-long-message',
    description: 'Чат — очень длинное сообщение',
    run: chatRun([
      {
        n: 1,
        text: 'Оооооооооооооооооооооооооооооооооооооооооооооооооооооооооооооооооооооооочень длинное сообщение, которое должно перенестись на несколько строк в узкой панели чата'.slice(0, 180),
        t: Date.now() / 1000
      }
    ])
  }
];

function chatRun(messages) {
  return async (page) => {
    await gotoDebug(page);
    await callDebug(page, 'chatLog', messages);
    await page.locator('#chatLog').waitFor({ state: 'visible' });
  };
}

// Поле ввода чата с набранным текстом и эмодзи. Отдельного слоя-подложки
// (#chatInputOverlay) больше нет: он дублировал набираемый текст поверх поля,
// эмодзи рисует сам браузер.
const chatInputOverlayEntry = {
  id: 'chat-input-typed',
  description: 'Поле ввода чата — набранный текст с эмодзи',
  async run(page) {
    await gotoDebug(page);
    // #chat скрыт, пока открыт #menuOverlay — chatLog([]) закрывает меню тем
    // же путём, что и остальные chat-сценарии (см. client_debug.js).
    await callDebug(page, 'chatLog', []);
    await page.fill('#chatInput', '😀 привет команда 🔥');
  }
};

// Бейдж непрочитанных (#chatUnread) — debug.chatUnread (public/client_debug.js)
// зовёт onChat() тем же путём, что и реальные входящие сообщения
// (onTextMsg 'chat', public/client_net_bind.js); бейдж растёт, пока фокус вне
// #chat — на свежей странице он и так снаружи.
const chatUnreadEntry = {
  id: 'chat-unread-badge',
  description: 'Чат — бейдж непрочитанных сообщений',
  async run(page) {
    await gotoDebug(page);
    await callDebug(page, 'chatUnread', 3);
    await page.locator('#chatUnread').waitFor({ state: 'visible' });
  }
};

// Эмодзи-панель: 'пустые недавние' — дефолт свежего профиля (localStorage без
// KEYS.recentEmojis). 'с недавними' кликает по НАСТОЯЩЕЙ кнопке в гриде
// (public/client_chat_ui.js: createEmojiButton -> pushRecentEmoji ->
// renderEmojiRecent) — тем же путём, каким недавние эмодзи копятся в реальной
// игре, а не имитацией через мост.
const emojiPanelEntries = [
  {
    id: 'chat-emoji-panel-empty-recent',
    description: 'Эмодзи-панель — открыта, «недавние» пусты (свежий профиль)',
    async run(page) {
      await gotoDebug(page);
      await callDebug(page, 'emojiPanel', true);
      await page.locator('#emojiPanel.open').waitFor({ state: 'visible' });
    }
  },
  {
    id: 'chat-emoji-panel',
    description: 'Эмодзи-панель — открыта, с недавно использованными эмодзи',
    async run(page) {
      await gotoDebug(page);
      await callDebug(page, 'emojiPanel', true);
      await page.locator('#emojiGrid button').first().click();
      await page.locator('#emojiRecent button').first().waitFor({ state: 'visible' });
    }
  }
];

// --- Leaderboard ------------------------------------------------------------

const leaderboardEntries = [
  {
    id: 'leaderboard-basic',
    description: 'Таблица лидеров (правая колонка)',
    async run(page) {
      await gotoDebug(page);
      const players = Array.from({ length: 10 }, (_, i) => ({
        n: i + 1,
        nm: `Игрок ${i + 1}`,
        p: 1000 - i * 50,
        s: 500 - i * 20,
        cosFrame: i % 8
      }));
      await callDebug(page, 'leaderboard', players);
      // Правая колонка — <details>, таблица может быть свёрнута по умолчанию.
      await page.evaluate(() => {
        document.getElementById('rightMatchDetails')?.setAttribute('open', '');
      });
      await page.locator('#stats table').waitFor({ state: 'visible' });
    }
  }
];

// --- Тосты событий ------------------------------------------------------------
//
// J19: 'minor' и 'info' раньше были двумя записями каталога, гонявшими два
// разных ключа TOAST_PRESETS (public/client_debug.js), которые рендерили
// ОДИНАКОВЫЙ тост: icon='ℹ', variant=null — addToast() (public/client_toasts.js)
// различает тосты только по icon/variant, текст роли не играет. grep
// addToast( по public/client_ws_handlers.js не нашёл ни одного реального
// вызова с типом 'minor' или 'info' — это имена ключей самого debug-пресета,
// не сортов тоста из реального кода. Единственное реальное совпадение с
// icon='ℹ'/variant=null — общий info-тост магазина (client_shop.js). 'minor'
// убран как чистый дубликат, 'info' остался (совпадает с реальным кодом).
const TOAST_KINDS = ['info', 'success', 'error', 'big', 'jackpot'];

const toastEntries = TOAST_KINDS.map((kind) => ({
  id: `toast-${kind}`,
  description: `Тост события — вариант «${kind}»`,
  async run(page) {
    await gotoDebug(page);
    await callDebug(page, 'toast', kind);
    await page.locator('#eventToasts .eventToast').first().waitFor({ state: 'visible' });
  }
}));

// --- Ошибка соединения / офлайн ------------------------------------------------
//
// Второй вариант тоста обрыва связи не заведён намеренно: grep addToast('📶'
// по public/client_net_bind.js нашёл единственное место — onClose() —
// которое срабатывает и на обрыве во время матча, и на неудаче самого первого
// подключения (до входа в комнату session.roomId ещё null, но onClose() ветку
// с этим тостом не заходит вовсе — см. код ниже, — а не рисует другой текст).
// Единственный путь, где этот тост реально показывается, — session.roomId !=
// null && !session.userLeftRoom (обрыв, когда игрок уже был в комнате); при
// самом первом подключении до входа в комнату onClose() вместо тоста зовёт
// showMenuOverlay() — т.е. отдельного тоста «не законнектились с самого
// начала» в клиенте просто нет, придумывать его не стали.
const connectionEntries = [
  {
    id: 'connection-error',
    description: 'Тост обрыва соединения (реконнект во время матча)',
    async run(page) {
      await gotoDebug(page);
      await callDebug(page, 'connectionError');
      await page.locator('#eventToasts .eventToast').first().waitFor({ state: 'visible' });
    }
  }
];

// --- Настройки: все состояния тумблеров ----------------------------------

// #settingsBtn живёт внутри #hud, который скрыт до реального входа в матч —
// клик по нему висел до глобального test.timeout (300с) на каждом
// вьюпорте, потому что кнопка никогда не становилась actionable. Открываем
// оверлей тем же путём, что и обработчик клика (debug.settingsOpen —
// public/client_debug.js), в обход недоступной кнопки.
async function openSettings(page) {
  await gotoDebug(page);
  await callDebug(page, 'settingsOpen');
  await page.locator('#settingsOverlay').waitFor({ state: 'visible' });
}

async function setCheckbox(page, selector, checked) {
  await page.evaluate(
    ({ selector, checked }) => {
      const el = document.querySelector(selector);
      if (!el) return;
      el.checked = checked;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { selector, checked }
  );
}

async function setRange(page, selector, value) {
  await page.evaluate(
    ({ selector, value }) => {
      const el = document.querySelector(selector);
      if (!el) return;
      el.value = String(value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    { selector, value }
  );
}

const settingsEntries = [
  {
    id: 'settings-sound-on',
    description: 'Настройки — звук включён',
    async run(page) {
      await openSettings(page);
      await setCheckbox(page, '#soundEnabled', true);
    }
  },
  {
    id: 'settings-sound-off',
    description: 'Настройки — звук выключен',
    async run(page) {
      await openSettings(page);
      await setCheckbox(page, '#soundEnabled', false);
    }
  },
  {
    id: 'settings-haptics-shown',
    description: 'Настройки — строка вибрации показана (мобильный вьюпорт)',
    viewport: 'iphone-390x844',
    async run(page) {
      await openSettings(page);
      await page.locator('#hapticsRow').waitFor({ state: 'visible' });
    }
  },
  {
    id: 'settings-haptics-hidden',
    description: 'Настройки — строка вибрации скрыта (десктопный вьюпорт)',
    viewport: 'desktop-1280x720',
    async run(page) {
      await openSettings(page);
    }
  },
  {
    id: 'settings-fx-min',
    description: 'Настройки — интенсивность эффектов на минимуме',
    async run(page) {
      await openSettings(page);
      await setRange(page, '#fxIntensity', 0);
    }
  },
  {
    id: 'settings-fx-max',
    description: 'Настройки — интенсивность эффектов на максимуме',
    async run(page) {
      await openSettings(page);
      await setRange(page, '#fxIntensity', 1);
    }
  }
];

// Панель отладки FPS (#perf) — settings.perfEnabled (public/client_settings.js:
// FIELDS.perfEnabled), переключается тем же чекбоксом #perfEnabled, что и
// вручную. debug.perfPanel (public/client_debug.js) наполняет сцену матча,
// иначе панель считает кадры на пустом канвасе.
const settingsPerfEntry = {
  id: 'settings-perf-panel',
  description: 'Панель отладки FPS поверх экрана боя (settings.perfEnabled)',
  // U3 (10-ux-waves.css, @media max-width:720px): #perf безусловно
  // display:none на телефоне — «на телефоне поле важнее правой панели»,
  // не баг, а осознанное решение разметки. На iphone-390x844 запись НИКОГДА
  // не станет видимой, поэтому — только десктопный вьюпорт, как и
  // settings-haptics-hidden выше.
  viewport: 'desktop-1280x720',
  async run(page) {
    await gotoDebug(page);
    await callDebug(page, 'perfPanel');
    await page.locator('#perf').waitFor({ state: 'visible' });
    await page.waitForTimeout(120);
  }
};

// --- Меню: первый экран, онбординг управления, валидация ника, превью скина --

const menuEntries = [
  {
    id: 'menu-default',
    description: 'Экран меню — первый экран после захода, без debug-вызовов',
    async run(page) {
      await gotoDebug(page);
      await page.locator('#menuOverlay').waitFor({ state: 'visible' });
    }
  },
  {
    id: 'menu-onboarding-shown',
    description: 'Меню — подсказка про управление показана впервые (свежий профиль)',
    async run(page) {
      await gotoDebug(page);
      await page.locator('#menuOnboarding').waitFor({ state: 'visible' });
    }
  },
  {
    id: 'menu-onboarding-dismissed',
    description: 'Меню — подсказка про управление уже отмечена прочитанной',
    async run(page) {
      await gotoDebug(page);
      await callDebug(page, 'menuOnboardingDismiss');
      await page.locator('#menuOnboarding').waitFor({ state: 'hidden' });
    }
  },
  {
    id: 'menu-name-invalid',
    description: 'Меню — поле ника с ошибкой валидации',
    async run(page) {
      await gotoDebug(page);
      await page.fill('#menuNameInput', '<bad>');
      await page.locator('#menuNameError').waitFor({ state: 'visible' });
    }
  },
  {
    id: 'menu-skin-preview',
    description: 'Меню — панель «Ваш облик» с явно выбранным скином головы',
    // .menuSkinPanel { display:none } на ≤720px (10-ux-waves.css) — осознанное
    // решение дизайна («на телефоне колонка одна, а превью — лишние 200px до
    // кнопки «Играть»), не баг: на iphone-390x844 узел НИКОГДА не станет
    // видимым, Playwright ждал бы его 300с впустую. Тот же приём, что и у
    // settings-perf-panel/settings-haptics-hidden выше.
    viewport: 'desktop-1280x720',
    async run(page) {
      await gotoDebug(page);
      await callDebug(page, 'menuSkinPreview', 'head', 3);
      await page.locator('#menuSkinPreview').waitFor({ state: 'visible' });
    }
  },
  {
    id: 'menu-dailies-active',
    description: 'Меню — мета-крючок с активными дейликами и прогрессом до первого скина (#menuMeta)',
    async run(page) {
      await gotoDebug(page);
      // Итерация 6: type раньше передавался строкой ('kills'/'capture'), а
      // client_i18n.js:876 dailies ключует записи числами 1..4 — как и
      // реальный сервер (client_ws_handlers.js: kind===15 распаковывает type
      // как (packed >>> 16) & 0xffff, т.е. число). infoName() промахивался
      // мимо словаря и обе строки прогресса падали на общий фолбэк «Задание»,
      // неотличимые друг от друга. 1 = Kills/Убийства, 3 = Capture/Захват.
      await callDebug(page, 'menuDailies', [
        { slot: 0, type: 1, goal: 10, prog: 4 },
        { slot: 1, type: 3, goal: 500, prog: 500 }
      ]);
      await page.locator('#menuMeta').waitFor({ state: 'visible' });
    }
  }
];

// --- Миникарта: полноэкранный режим на мобильном ------------------------------
//
// #minimapMobileBtn — тач-доступ к карте на мобильном (public/client_minimap_ui.js:
// initMinimapUi, комментарий "на мобильном #minimapPanel скрыт, а клавиши M
// нет"); кнопка/раскладка мобильные, поэтому вьюпорт зафиксирован.
const minimapFullscreenEntry = {
  id: 'minimap-fullscreen',
  description: 'Миникарта — полноэкранный режим (мобильный вьюпорт)',
  viewport: 'iphone-390x844',
  async run(page) {
    await gotoDebug(page);
    await callDebug(page, 'minimapFullscreen');
    await page.locator('#minimapOverlay').waitFor({ state: 'visible' });
  }
};

// --- Экран боя: канвас + весь HUD поверх него (public/client_debug.js: debug.matchScene) ---
//
// В отличие от остальных записей каталога, наполняющих один оверлей, здесь
// снимается ВЕСЬ видимый экран боя — канвас несёт часть картины (грид,
// змейки, эффекты), а topHud/killfeed/teamHud/metaHud/rightSidebar/minimap
// рисуются вокруг него тем же рендер-циклом, что и в реальной игре.
// Изолированных HUD-заглушек здесь нет намеренно — заказчик просил снимать
// именно СОСТОЯНИЯ ЭКРАНА МАТЧА, они сами покрывают HUD.

const matchSceneEntries = [
  {
    id: 'match-scene-calm',
    description: 'Экран боя — спокойная игра, без эффектов'
  },
  {
    id: 'match-scene-fx-burst',
    description: 'Экран боя — активный fx-всплеск (килл, тряска, hitstop)'
  },
  {
    id: 'match-scene-eating-opponent',
    description: 'Экран боя — момент захвата чужой территории (перекраска + fx-всплеск)'
  },
  {
    id: 'match-scene-boost',
    description: 'Экран боя — змейка в режиме разгона/буста'
  },
  {
    id: 'match-scene-killfeed-busy',
    description: 'Экран боя — несколько записей в киллфиде одновременно'
  },
  {
    id: 'match-scene-contract-active',
    description: 'Экран боя — topHud с активным контрактом (прогресс-бар)'
  },
  {
    // J19: было двумя id (match-scene-team-mode, match-scene-crowded) —
    // отличались только числом статистов (6 против 8) и раскрытой панелью
    // «Команда»; на итоговом кадре разница едва заметна. Слиты в один:
    // толпа статистов И раскрытая командная панель одновременно (см.
    // public/client_debug.js: sceneCrowded).
    id: 'match-scene-crowded',
    description: 'Экран боя — толпа других игроков + раскрытая панель «Команда»',
    async extra(page) {
      // Тот же приём, что и в leaderboard-basic: панель — свёрнутый <details>,
      // на мобильном/узком вьюпорте может быть закрыта по умолчанию.
      await page.evaluate(() => {
        document.getElementById('rightTeamDetails')?.setAttribute('open', '');
      });
    }
  }
].map((entry) => ({
  ...entry,
  async run(page) {
    await gotoDebug(page);
    await callDebug(page, 'matchScene', entry.id);
    if (entry.extra) await entry.extra(page);
    await page.locator('#game').waitFor({ state: 'visible' });
    // Один кадр рендер-цикла (client_render.js: draw()), чтобы канвас и
    // teamHud/killfeed/topHud успели перерисоваться с новым состоянием.
    await page.waitForTimeout(120);
  }
}));

export const CATALOG = [
  ...deathEntries,
  deathExhaustedEntry,
  ...matchResultsEntries,
  matchCountdownEntry,
  ...shopEntries,
  shopErrorEntry,
  ...roomsEntries,
  ...roomsCreateEntries,
  ...chatEntries,
  chatInputOverlayEntry,
  chatUnreadEntry,
  ...emojiPanelEntries,
  ...leaderboardEntries,
  ...toastEntries,
  ...connectionEntries,
  ...settingsEntries,
  settingsPerfEntry,
  ...menuEntries,
  minimapFullscreenEntry,
  ...matchSceneEntries
];
