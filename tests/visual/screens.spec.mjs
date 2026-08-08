// Визуальные регрессионные тесты экранов. Пиксельное сравнение — единственный
// способ реально ловить регрессии рендера канваса (draw()); проверки
// computed style его не видят. Playwright — единственная JS-зависимость
// проекта, см. package.json.
//
// Детерминизм:
//   - боты/матч: сервер поднят через `make run-visual` (playwright.config.mjs)
//     с фиксированным ROOM_LIMIT и коротким MATCH_DURATION_TICKS — только для
//     этого прогона, PROFILES_PATH одноразовый, PROFILE_SECRET зафиксирован;
//   - анимации: reducedMotion: 'reduce' в конфиге плюс animations: 'disabled'
//     у каждого toHaveScreenshot;
//   - живые числа (таймер матча, счётчик игроков онлайн, id комнаты) —
//     маскируются явно, а не «авось не попадут в кадр».
import { test, expect } from '@playwright/test';

// Живые/непредсказуемые зоны, одинаковые для нескольких экранов.
const LIVE_HUD = ['#roomInfo', '#matchCountdown', '#menuOnlineBadge'];

/*
 * #eventToasts (тосты заданий — контракты матча случайны по составу, и сами
 * тосты специально держатся НАД оверлеями, body.overlayActive поднимает им
 * z-index) не маскируется через locator: контейнер меняет ВЫСОТУ с числом
 * тостов, а mask красит прямоугольник фиксированного размера, снятый в
 * момент скриншота, — на baseline и на прогоне сравнения размеры расходятся,
 * и несовпадающий остаток протекает в дифф. Вместо этого тосты просто чистим
 * перед снимком — то, ради чего они существуют (сам факт извещения), кадру
 * не нужно.
 */
async function clearEventToasts(page) {
  await page.evaluate(() => {
    document.getElementById('eventToasts')?.replaceChildren();
  });
}

async function waitConnected(page) {
  // menuOnlineCount меняется с «—» на число только после hello от сервера —
  // это и есть сигнал «WS готов», без которого playBtn один раз проглатывает
  // клик (см. client.js: play/offline-toast).
  await expect(page.locator('#menuOnlineCount')).not.toHaveText('—', { timeout: 15_000 });
}

async function dismissOnboardingIfAny(page) {
  const onboarding = page.locator('#menuOnboarding');
  if (await onboarding.isVisible().catch(() => false)) {
    await page.evaluate(() => document.getElementById('menuOnboarding')?.classList.add('hidden'));
  }
}

// Экраны настроек/игры/смерти/итогов матча идут через один реальный матч на
// СВОЁМ сервере вьюпорта (у каждого проекта — собственный порт и процесс, см.
// playwright.config.mjs), а не через подделанное состояние мимо client.js —
// именно эту подделку эти тесты и должны ловить.
//
// Матч на сервере тикает от старта процесса, а не от первого join (`make
// run-visual` ставит MATCH_DURATION_TICKS с большим запасом — см. Makefile),
// поэтому этот тест идёт ПЕРВЫМ в файле: ему нужен весь бюджет времени матча
// на смерть и ожидание итогов, а не то, что останется после менюшных тестов.
test.describe('игровая сессия', () => {
  test('настройки, игра, смерть, итоги матча', async ({ page }) => {
    test.setTimeout(280_000);

    await page.goto('/');
    await waitConnected(page);
    await dismissOnboardingIfAny(page);
    await page.click('#playBtn');

    // «Играть» первым кликом иногда просит подключиться (offline-toast),
    // если WS ещё не успел выйти из CONNECTING — второй клик уже уходит.
    // Проверяем по САМОМУ меню, а не по hud: если экран уже сменился, второй
    // клик целится в скрытую кнопку и виснет на ожидании её видимости.
    const menuOverlay = page.locator('#menuOverlay');
    const hud = page.locator('#hud');
    await page.waitForTimeout(500);
    if (await menuOverlay.isVisible().catch(() => true)) {
      await page.click('#playBtn');
    }
    await expect(hud).toBeVisible({ timeout: 15_000 });
    // Первый кадр после join может прийти на пустом ROI — ждём отрисовку
    // собственной змейки (заголовок HUD уже не placeholder).
    await page.waitForTimeout(300);

    // Не полный экран: канвас (#game) под HUD рисует живую партию — позиции
    // змейки, ботов и еды идут с сервера случайными и ничем не зафиксированы,
    // маскировать элемент, который занимает весь вьюпорт, бессмысленно —
    // Playwright красит маской весь его bounding box, то есть всю страницу
    // целиком, и HUD поверх него становится не видно ни в эталоне, ни в
    // диффе. Регрессию рендера канваса (draw()) ловит не пиксельный тест, а
    // числовая сверка формул (см. PR field-math); здесь под контролем —
    // именно статичное HUD-обрамление редизайна.
    await expect(page.locator('#hud')).toHaveScreenshot('game-hud.png', {
      mask: LIVE_HUD.map((s) => page.locator(s))
    });

    await page.click('#settingsBtn');
    await expect(page.locator('#settingsOverlay')).toBeVisible();
    await clearEventToasts(page);
    await expect(page).toHaveScreenshot('settings.png', { mask: LIVE_HUD.map((s) => page.locator(s)) });
    // Закрываем настройки напрямую через DOM, а не кликом. Кликом их закрывал
    // прежний код, но кнопку может перехватить не только тост события (для
    // тостов уже есть clearEventToasts выше) — на перегруженном CI-раннере
    // (двухъядерный, три матча делят CPU, см. workers в конфиге) матч иногда
    // успевает завершиться смертью игрока, пока окно настроек ещё открыто, и
    // deathOverlay встаёт поверх settingsOverlay физически. force:true здесь
    // не спасает: клик Playwright — синтетическое событие по координатам
    // центра кнопки, и браузер маршрутизирует его на реальный верхний элемент
    // в этой точке, а не на элемент из локатора. DOM-манипуляция не зависит
    // от того, что физически нарисовано поверх.
    await page.evaluate(() => document.getElementById('settingsOverlay')?.classList.add('hidden'));
    await expect(page.locator('#settingsOverlay')).toBeHidden();

    // Смерть — врезаться в границу поля. Направление фиксировано (вверх);
    // сетка (internal/protocol.H = 140) при 1 клетке/тик (TickMS = 100 мс)
    // даёт теоретический потолок ~14 c от любой точки спавна до ближайшей
    // границы, но практика (сетевая задержка, сброс направления при входе)
    // иногда заметно дольше — держим кратный запас, а не подгоняем впритык
    // под теорию. Клавишу жмём периодически, а не один раз: если нажатие
    // потерялось (фокус ещё не на канвасе сразу после закрытия оверлея
    // настроек), тест не должен виснуть до общего таймаута молча.
    for (let i = 0; i < 30 && !(await page.locator('#deathOverlay').isVisible()); i++) {
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(2_000);
    }
    await expect(page.locator('#deathOverlay')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(150); // дать дорисоваться статистике смерти
    await clearEventToasts(page);
    // #deathReason маскируется тоже: при повторном локальном прогоне сервер
    // может переиспользоваться (reuseExistingServer в playwright.config.mjs),
    // и след от предыдущего раза способен убить змейку раньше, чем она
    // дойдёт до границы карты — причина смерти тогда не «в стену», а «в
    // чужой след». Разметку карточки смерти это не меняет, только текст.
    await expect(page).toHaveScreenshot('death.png', {
      mask: [...LIVE_HUD, '#deathStats', '#deathReason'].map((s) => page.locator(s))
    });

    // Итоги матча приходят по истечении MATCH_DURATION_TICKS — счётчик
    // сервера этого вьюпорта, который тикает НЕПРЕРЫВНО циклами (матч ->
    // intermission -> матч) с рождения процесса. Зайти в тест можно ровно в
    // момент старта нового матча, тогда ждать придётся почти полную его
    // длительность — отсюда запас в таймауте.
    await expect(page.locator('#matchOverlay')).toBeVisible({ timeout: 130_000 });
    await page.waitForTimeout(150);
    await clearEventToasts(page);
    await expect(page).toHaveScreenshot('match.png', {
      mask: [...LIVE_HUD, '#matchResults'].map((s) => page.locator(s))
    });
  });
});

test.describe('главный экран', () => {
  test('меню', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await dismissOnboardingIfAny(page);
    await expect(page.locator('#menuOverlay')).toBeVisible();
    await expect(page).toHaveScreenshot('menu.png', { mask: LIVE_HUD.map((s) => page.locator(s)) });
  });
});

test.describe('магазин', () => {
  test('косметика', async ({ page }) => {
    await page.goto('/');
    await waitConnected(page);
    await page.click('#cosmeticsMenuBtn');
    await expect(page.locator('#cosmeticsOverlay')).toBeVisible();
    // Список карточек рисуется асинхронно после открытия — ждём хотя бы одну.
    await expect(page.locator('#cosmeticsItems').locator('> *').first()).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveScreenshot('shop.png', {
      mask: [...LIVE_HUD, '#cosmeticsPreview'].map((s) => page.locator(s))
    });
  });
});
