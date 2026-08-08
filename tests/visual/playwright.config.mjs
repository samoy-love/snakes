// Конфиг визуальных регрессионных тестов. Единственный потребитель Playwright
// в проекте — см. package.json рядом: клиент и его остальные тесты (tests/*.test.mjs)
// внешних зависимостей не имеют и не должны.
//
// Сервер под тесты поднимается самим Playwright (webServer ниже) через
// `make run-visual` из корня репозитория — ROOM_LIMIT и длительность матча
// зафиксированы там, а не читаются из .env разработчика: скриншот,
// зависящий от локальных настроек, не может быть эталоном.
//
// Три сервера, не один. Тест игровой сессии доводит реальный матч до конца
// (см. screens.spec.mjs) — на ОДНОМ общем сервере три вьюпорта дрались бы за
// один и тот же матч, и единственным безопасным режимом был бы workers: 1
// (последовательно, ~6 минут). У каждого вьюпорта — свой порт, свой процесс
// сервера, свой одноразовый профиль: матчи идут независимо и параллельно.
import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const VIEWPORTS = [
  { name: 'mobile-375x812', width: 375, height: 812, port: 8099 },
  { name: 'tablet-768x1024', width: 768, height: 1024, port: 8100 },
  { name: 'desktop-1280x720', width: 1280, height: 720, port: 8101 }
];

export default defineConfig({
  testDir: __dirname,
  fullyParallel: false,
  // Один воркер на вьюпорт — тесты ВНУТРИ вьюпорта (game session, затем
  // menu, затем shop) идут по порядку на его собственном сервере, а сами
  // вьюпорты — параллельно друг другу на разных портах (см. webServer ниже).
  // На CI (2 vCPU у стандартного раннера) все три процесса Go + три
  // Chromium одновременно уже боролись за CPU настолько, что desktop однажды
  // не уложился и в 200-секундный таймаут теста — на своём железе так же
  // легко не воспроизвести. Два воркера на CI менее эффектны (не 3x, а 2x),
  // но не соревнуются за ядра так агрессивно.
  workers: process.env.CI ? 2 : VIEWPORTS.length,
  retries: 0,
  timeout: 300_000,
  expect: {
    // Небольшой допуск: сглаживание/шрифты на разных машинах дают единицы
    // пикселей по краям, а не смысловую разницу.
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' }
  },
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    // Отключает CSS-анимации/переходы и уважает prefers-reduced-motion —
    // рендер канваса (draw()) это не покрывает, о нём заботится сам тест
    // (маскирование живых зон), но HUD/оверлеи так не «доигрывают» переход.
    reducedMotion: 'reduce'
  },
  projects: VIEWPORTS.map(({ name, width, height, port }) => ({
    name,
    use: { ...devices['Desktop Chrome'], viewport: { width, height }, baseURL: `http://127.0.0.1:${port}` }
  })),
  webServer: VIEWPORTS.map(({ name, port }) => ({
    command: `make run-visual VISUAL_PORT=${port} VISUAL_PROFILES_PATH=tests/visual/.tmp/profiles-${name}.json`,
    cwd: REPO_ROOT,
    url: `http://127.0.0.1:${port}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // go run компилирует пакет заново при первом запуске — на холодном кеше
    // модулей (свежий раннер CI) это может занять десятки секунд. Три
    // параллельных `go run .` делят один и тот же build-кеш модулей/пакетов
    // (GOCACHE общий для раннера), гонки за него нет — компилятор сам
    // сериализует доступ.
    stdout: 'pipe',
    stderr: 'pipe'
  }))
});
