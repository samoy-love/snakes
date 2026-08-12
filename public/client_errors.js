/* Единая точка логирования необработанных ошибок клиента.

   Отдельный модуль, потому что подписка обязана встать ПЕРВОЙ строкой
   загрузчика: ошибка в любом другом модуле на этапе инициализации должна
   попасть в консоль, а не потеряться. */

export function installErrorLogging() {
  if (typeof window === 'undefined') return;

  window.addEventListener('error', (ev) => {
    try {
      console.error('client_error', ev?.error || ev?.message || ev);
    } catch {}
  });

  window.addEventListener('unhandledrejection', (ev) => {
    try {
      console.error('client_unhandledrejection', ev?.reason || ev);
    } catch {}
  });
}
