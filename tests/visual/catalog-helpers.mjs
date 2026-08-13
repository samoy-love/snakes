// Общие хелперы каталога состояний (tests/visual/catalog.spec.mjs).
// Копии/адаптации трёх приёмов из screens.spec.mjs — сюда вынесены, чтобы не
// дублировать их в каждой записи tests/visual/catalog.mjs (там нужны только
// данные). Что каждый приём делает и почему — см. комментарии в оригинале
// (screens.spec.mjs), здесь они не повторяются.

export async function waitConnected(page) {
  const { expect } = await import('@playwright/test');
  await expect(page.locator('#menuOnlineCount')).not.toHaveText('—', { timeout: 15_000 });
}

export async function freezeRoomInfoWidth(page) {
  await page.evaluate(() => {
    const el = document.getElementById('roomInfo');
    if (!el) return;
    el.style.width = '';
    el.textContent = 'Комната: 1 / 16';
    const w = el.getBoundingClientRect().width;
    if (w > 0) {
      el.style.width = `${w}px`;
      el.style.whiteSpace = 'nowrap';
      el.style.overflow = 'hidden';
    }
  });
}

export async function clearEventToasts(page) {
  await page.evaluate(() => {
    document.getElementById('eventToasts')?.replaceChildren();
  });
}

// Открыть страницу с активным debug-мостом (public/client_debug.js) и
// дождаться готовности сокета — тот же сигнал, что и в screens.spec.mjs.
export async function gotoDebug(page) {
  await page.goto('/?debug=1');
  await waitConnected(page);
}

// Вызвать window.__snakesDebug.<fn>(...args) в странице. Мост бросает
// исключение при загрузке без ?debug=1 — gotoDebug() всегда должен идти
// раньше любого вызова этого хелпера.
export async function callDebug(page, fn, ...args) {
  await page.waitForFunction((name) => typeof window.__snakesDebug?.[name] === 'function', fn, { timeout: 10_000 });
  await page.evaluate(({ fn, args }) => window.__snakesDebug[fn](...args), { fn, args });
}
