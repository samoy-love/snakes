// Конфиг визуальных регрессионных тестов. Единственный потребитель Playwright
// в проекте — см. package.json рядом: клиент и его остальные тесты (tests/*.test.mjs)
// внешних зависимостей не имеют и не должны.
//
// Сервер под тесты поднимается самим Playwright (webServer ниже) через
// `make run-visual` из корня репозитория — ROOM_LIMIT и длительность матча
// зафиксированы там, а не читаются из .env разработчика: скриншот,
// зависящий от локальных настроек, не может быть эталоном.
//
// Свой сервер на каждый вьюпорт, а не один общий. Тест игровой сессии
// доводит реальный матч до конца (см. screens.spec.mjs) — на ОДНОМ общем
// сервере вьюпорты дрались бы за один и тот же матч, и единственным
// безопасным режимом был бы workers: 1 (последовательно, по нескольку минут
// на каждый). У каждого вьюпорта — свой порт, свой процесс сервера, свой
// одноразовый профиль: матчи идут независимо и параллельно. Число серверов
// равно VIEWPORTS.length, а не жёстко «три» — см. массив ниже.
import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/* Экспортируется, чтобы порты не пришлось дублировать: их читает
   free-ports.mjs, снимающий серверы от прошлого прогона.

   touch: true — только у мобильного вьюпорта. Без него это просто Desktop
   Chrome с урезанным окном: navigator.maxTouchPoints=0 и
   matchMedia('(pointer: coarse)') всегда false, потому что devices['Desktop
   Chrome'] ниже не даёт ни hasTouch, ни isMobile сама по себе — один resize
   viewport их не включает. hapticsSupported() (client_settings.js) требует
   ОБА условия и поэтому #hapticsRow физически не мог показаться:
   settings-haptics-shown висел 300с (test.timeout) на каждом прогоне, ждя
   узел, которому взяться было неоткуда. Тот же класс условия
   (`@media (pointer: coarse)`) используют и тач-хинты экрана смерти/
   онбординга меню (iter-1.md, находки #4/#5) — без hasTouch/isMobile здесь
   каталог тоже не показывал бы их настоящее мобильное состояние. */
export const VIEWPORTS = [
  { name: 'iphone-390x844', width: 390, height: 844, port: 8099, touch: true },
  { name: 'desktop-1280x720', width: 1280, height: 720, port: 8101 },
  { name: 'desktop-2560x1440', width: 2560, height: 1440, port: 8102 }
];

export default defineConfig({
  testDir: __dirname,
  fullyParallel: false,
  // Один воркер на вьюпорт — тесты ВНУТРИ вьюпорта (game session, затем
  // menu, затем shop) идут по порядку на его собственном сервере, а сами
  // вьюпорты — параллельно друг другу на разных портах (см. webServer ниже).
  // На CI (2 vCPU у стандартного раннера) уже три процесса Go + три Chromium
  // одновременно боролись за CPU настолько, что desktop однажды не уложился
  // и в 200-секундный таймаут теста — на своём железе так же легко не
  // воспроизвести. Фиксированные 2 воркера на CI держат это в узде и при
  // росте VIEWPORTS: полного параллелизма (Nx) на CI нет ни при трёх
  // вьюпортах, ни при четырёх, но 2 воркера не соревнуются за ядра так
  // агрессивно, как VIEWPORTS.length.
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
  projects: VIEWPORTS.map(({ name, width, height, port, touch }) => ({
    name,
    use: {
      ...devices['Desktop Chrome'],
      viewport: { width, height },
      baseURL: `http://127.0.0.1:${port}`,
      ...(touch ? { hasTouch: true, isMobile: true } : {})
    }
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
