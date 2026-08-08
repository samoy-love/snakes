// Конфиг визуальных регрессионных тестов. Единственный потребитель Playwright
// в проекте — см. package.json рядом: клиент и его остальные тесты (tests/*.test.mjs)
// внешних зависимостей не имеют и не должны.
//
// Сервер под тесты поднимается самим Playwright (webServer ниже) через
// `make run-visual` из корня репозитория — порт, ROOM_LIMIT и длительность
// матча зафиксированы там, а не читаются из .env разработчика: скриншот,
// зависящий от локальных настроек, не может быть эталоном.
import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BASE_URL = 'http://127.0.0.1:8099';

export default defineConfig({
  testDir: __dirname,
  fullyParallel: false,
  // workers: 1 — не сложность инфраструктуры, а необходимость: сценарии
  // game/settings/death/match ведут ОДНУ игровую сессию через реальный матч
  // на общем сервере (см. screens.spec.mjs). Параллельные воркеры делили бы
  // один и тот же матч на сервере и толкались бы за один снапшот.
  workers: 1,
  retries: 0,
  timeout: 220_000,
  expect: {
    // Небольшой допуск: сглаживание/шрифты на разных машинах дают единицы
    // пикселей по краям, а не смысловую разницу.
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' }
  },
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    // Единственный воркер — trace на первый повтор не нужен, но пригодится
    // при локальной отладке упавшего снапшота.
    trace: 'retain-on-failure',
    // Отключает CSS-анимации/переходы и уважает prefers-reduced-motion —
    // рендер канваса (draw()) это не покрывает, о нём заботится сам тест
    // (маскирование живых зон), но HUD/оверлеи так не «доигрывают» переход.
    reducedMotion: 'reduce'
  },
  projects: [
    { name: 'mobile-375x812', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } } },
    { name: 'tablet-768x1024', use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } } },
    { name: 'desktop-1280x720', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } }
  ],
  webServer: {
    command: 'make run-visual',
    cwd: REPO_ROOT,
    url: `${BASE_URL}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // go run компилирует пакет заново при первом запуске — на холодном кеше
    // модулей (свежий раннер CI) это может занять десятки секунд.
    stdout: 'pipe',
    stderr: 'pipe'
  }
});
