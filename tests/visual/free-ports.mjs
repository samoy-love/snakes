/* Снимает серверы, оставшиеся от прошлого визуального прогона.
 *
 * Playwright поднимает сервер командой `make run-visual`, то есть цепочкой
 * процессов: playwright -> shell -> make -> shell -> `go run .` -> собранный
 * бинарь. Убивая команду, Playwright снимает её саму, но не внука: бинарь
 * остаётся жить и держит порт. Отсюда два симптома, оба неприятные:
 *
 *   1) прогон не завершается — итоговая строка «N passed» не печатается,
 *      потому что дочерние процессы живы;
 *   2) СЛЕДУЮЩИЙ прогон видит занятый порт и (reuseExistingServer вне CI)
 *      молча переиспользует старый сервер. А тот уже накопил комнаты, и их
 *      номера в HUD становятся двузначными — ширина панели меняется, и
 *      эталонные снимки перестают совпадать. Выглядит это как настоящая
 *      регрессия вёрстки; на разбор такого случая ушёл час.
 *
 * Поэтому перед прогоном порты освобождаются явно. Скрипт снимает ТОЛЬКО
 * процессы, которые слушают наши порты, — по идентификатору, а не по имени
 * образа: на машине разработчика рядом крутятся другие node/go-процессы, и
 * гасить их по имени недопустимо.
 */

import { execFileSync } from 'node:child_process';
import { VIEWPORTS } from './playwright.config.mjs';

/* Порты берём из конфига Playwright, а не из аргументов: дублировать их в
   Makefile значило бы завести второй список, который однажды разъедется с
   первым. Аргументы оставлены как ручной способ снять произвольный порт. */
const fromArgs = process.argv.slice(2).map(Number).filter(Boolean);
const PORTS = fromArgs.length ? fromArgs : VIEWPORTS.map((v) => v.port);

const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    // Пустой вывод — значит никто не слушает; это норма, а не ошибка.
    return '';
  }
};

/* Windows: netstat печатает pid последней колонкой у строк LISTENING. */
function pidsWindows(port) {
  const out = run('netstat', ['-ano', '-p', 'TCP']);
  const pids = new Set();
  for (const line of out.split('\n')) {
    if (!line.includes('LISTENING')) continue;
    const cols = line.trim().split(/\s+/);
    const local = cols[1] || '';
    if (!local.endsWith(`:${port}`)) continue;
    const pid = Number(cols[cols.length - 1]);
    if (pid > 0) pids.add(pid);
  }
  return [...pids];
}

/* Linux/macOS: lsof отдаёт pid по порту напрямую. */
function pidsUnix(port) {
  const out = run('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN']);
  return out
    .split('\n')
    .map((s) => Number(s.trim()))
    .filter((n) => n > 0);
}

const isWindows = process.platform === 'win32';
let killed = 0;

for (const port of PORTS) {
  for (const pid of isWindows ? pidsWindows(port) : pidsUnix(port)) {
    if (isWindows) run('taskkill', ['/PID', String(pid), '/F', '/T']);
    else {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
    console.log(`free-ports: снят процесс ${pid} на порту ${port}`);
    killed++;
  }
}

if (!killed) console.log('free-ports: занятых портов нет');
