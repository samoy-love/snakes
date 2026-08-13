// Каталог состояний — НЕ гейт CI, снимки не сравниваются ни с чем (обычные
// page.screenshot, не toHaveScreenshot). Цель — набор актуальных скриншотов
// каждого состояния интерфейса для ручного/агентского визуального ревью
// (docs/reviews/review-loop-prompt.md), а не пиксельная регрессия: под неё
// уже есть screens.spec.mjs (сейчас временно отключён владельцем — не трогать).
//
// Тот же playwright.config.mjs (VIEWPORTS/проекты/серверы), новых серверов не
// поднимает. test.title намеренно равен id записи CATALOG — Playwright
// --grep фильтрует по названию теста "из коробки", отдельного механизма не
// требуется: `npx playwright test catalog --grep death-wall` прогонит только её.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { CATALOG } from './catalog.mjs';
import { clearEventToasts, freezeRoomInfoWidth } from './catalog-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = path.join(__dirname, 'shots');

// Узел, релевантный состоянию — на нём делаем скриншот, а не на всей странице:
// каталог снимает конкретный экран, а не случайный кусок HUD вокруг него.
function selectorForId(id) {
  if (id.startsWith('death-')) return '#deathOverlay';
  if (id.startsWith('match-results-')) return '#matchOverlay';
  if (id.startsWith('shop-')) return '#cosmeticsOverlay';
  if (id.startsWith('rooms-')) return '#roomsDetails';
  if (id.startsWith('chat-')) return '#chat';
  // #stats — сама таблица лидеров — сосед #rightSidebar внутри #hud
  // (public/index.html), а не его потомок; #rightSidebar на мобильном
  // вьюпорте (≤720px, public/css/08-game-sidebar.css) вообще скрыт целиком,
  // поэтому старый selector падал на iphone-390x844 (toBeVisible: hidden),
  // хотя сама таблица к этому моменту уже реально отрисована.
  if (id.startsWith('leaderboard-')) return '#stats';
  if (id.startsWith('toast-') || id === 'connection-error') return '#eventToasts';
  // settings-perf-panel — исключение среди 'settings-*': это FPS-панель
  // ПОВЕРХ экрана боя (debug.perfPanel не открывает #settingsOverlay вовсе,
  // см. catalog.mjs), а не сама панель настроек.
  if (id === 'settings-perf-panel') return '#perf';
  if (id.startsWith('settings-')) return '#settingsOverlay';
  // Экран боя — не один оверлей: канвас (весь виден) + HUD вокруг него,
  // снимаем весь видимый вьюпорт целиком, а не один узел.
  if (id.startsWith('match-scene-')) return 'body';
  return 'body';
}

// index.md собирается по фактически прогнанным записям (учитывает --grep и
// per-viewport ограничение записей через entry.viewport), а не по всему
// CATALOG статически — иначе таблица врала бы про снимки, которых не было.
const generatedRows = [];

test.describe('каталог состояний', () => {
  for (const entry of CATALOG) {
    test(entry.id, async ({ page }, testInfo) => {
      const viewportName = testInfo.project.name;
      test.skip(!!entry.viewport && entry.viewport !== viewportName, `запись только для ${entry.viewport}`);

      // Технический гейт: любая JS-ошибка/консольный error во время записи —
      // это сломанный скриншот, даже если он визуально прошёл. Печатаем в
      // stdout Playwright, чтобы её было видно в списке фейлов прогона.
      page.on('pageerror', (err) => {
        console.error(`[pageerror] ${entry.id} (${viewportName}): ${err.message}`);
      });
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          console.error(`[console.error] ${entry.id} (${viewportName}): ${msg.text()}`);
        }
      });

      await entry.run(page);

      if (!entry.id.startsWith('toast-') && entry.id !== 'connection-error') {
        await clearEventToasts(page);
      }
      await freezeRoomInfoWidth(page).catch(() => {});

      const selector = selectorForId(entry.id);
      const locator = page.locator(selector).first();
      await expect(locator).toBeVisible();

      const dir = path.join(SHOTS_DIR, viewportName);
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, `${entry.id}.png`);
      await locator.screenshot({ path: filePath, animations: 'disabled' });

      generatedRows.push({
        id: entry.id,
        description: entry.description,
        viewport: viewportName,
        path: path.relative(SHOTS_DIR, filePath).split(path.sep).join('/')
      });
    });
  }

  test.afterAll(async () => {
    if (!generatedRows.length) return;
    const indexPath = path.join(SHOTS_DIR, 'index.md');
    fs.mkdirSync(SHOTS_DIR, { recursive: true });

    // Несколько прогонов (проектов-вьюпортов) пишут в один файл параллельно —
    // сливаем с уже накопленными строками по ключу id+viewport, а не
    // перезаписываем: иначе последний завершившийся проект стирал бы строки
    // остальных.
    const existingRows = readExistingRows(indexPath);
    const merged = new Map();
    for (const r of [...existingRows, ...generatedRows]) merged.set(`${r.id}|${r.viewport}`, r);
    const rows = Array.from(merged.values()).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.viewport < b.viewport ? -1 : 1));

    const lines = [
      '# Каталог состояний — снимки',
      '',
      'НЕ гейт CI: обычные скриншоты для ревью, без пиксельного сравнения.',
      'Как прогнать: `npx playwright test -c tests/visual/playwright.config.mjs catalog`',
      '(из tests/visual — см. docs/testing.md).',
      '',
      '| id | описание | вьюпорт | файл |',
      '| --- | --- | --- | --- |'
    ];
    for (const r of rows) {
      lines.push(`| ${r.id} | ${r.description} | ${r.viewport} | ${r.path} |`);
    }
    fs.writeFileSync(indexPath, lines.join('\n') + '\n', 'utf8');
  });
});

function readExistingRows(indexPath) {
  if (!fs.existsSync(indexPath)) return [];
  try {
    const text = fs.readFileSync(indexPath, 'utf8');
    const rows = [];
    for (const line of text.split('\n')) {
      const m = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/);
      if (!m || m[1] === 'id' || m[1].startsWith('---')) continue;
      rows.push({ id: m[1], description: m[2], viewport: m[3], path: m[4] });
    }
    return rows;
  } catch {
    return [];
  }
}
