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
