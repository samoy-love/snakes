/*
 * tools/orient.mjs — C5/C2 check: rotation and visualViewport resizes.
 *
 *   node tools/orient.mjs
 *
 * Rotates portrait -> landscape with `orientationchange` only (no `resize`,
 * which is what iOS Safari can do), then shrinks the height through
 * visualViewport alone (address bar collapse). After each step it reports the
 * canvas backing size and the viewport the client asked the server for.
 * Before C5 the canvas kept its old size until the next animation frame; the
 * assertion here is that it is correct immediately, with zero frames pumped.
 */
import { bootClient, sleep } from './harness.mjs';

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const say = (s) => process.stdout.write(`${s}\n`);

const app = await bootClient({ width: 390, height: 844, lang: 'ru', origin: arg('origin', 'http://localhost:3200') });
const win = app.win;

await app.frames(6, 20);
await sleep(1200);
await app.frames(6, 20);
const ni = win.document.getElementById('menuNameInput');
if (ni) {
  ni.value = 'Стенд';
  ni.dispatchEvent(new win.Event('input', { bubbles: true }));
}
app.click('playBtn');
await app.frames(40, 16);

const lastVp = () => {
  const v = app.win.__wsSent.filter((m) => m?.type === 'viewport').pop();
  return v ? `${v.data.w}x${v.data.h}` : 'none';
};
const grant = () => {
  const v = app.win.__wsRecv.filter((m) => m?.type === 'viewport').pop();
  return v ? `${v.data.w}x${v.data.h}` : 'none';
};
const line = (tag) =>
  say(
    `${tag.padEnd(34)} css=${win.innerWidth}x${win.innerHeight}  canvas=${app.canvas.width}x${app.canvas.height}  asked=${lastVp()}  granted=${grant()}`
  );

line('start (portrait)');

// --- rotation: orientationchange ONLY, and read the canvas with 0 frames run.
function raw(w, h) {
  Object.defineProperty(win, 'innerWidth', { value: w, configurable: true, writable: true });
  Object.defineProperty(win, 'innerHeight', { value: h, configurable: true, writable: true });
  win.visualViewport.width = w;
  win.visualViewport.height = h;
}

raw(844, 390);
win.dispatchEvent(new win.Event('orientationchange'));
line('after orientationchange (0 frames)');

await sleep(500);
await app.frames(2, 16);
line('after settle');

// --- address bar collapse: visualViewport resize only, no window resize.
raw(844, 330);
win.visualViewport.dispatchEvent(new win.Event('resize'));
line('after visualViewport resize (0 fr)');

// The debounced viewport message needs its timer to fire.
await sleep(700);
await app.frames(4, 16);
line('after debounce');

// Back to portrait.
raw(390, 844);
win.dispatchEvent(new win.Event('orientationchange'));
await sleep(700);
await app.frames(30, 16);
line('back to portrait');
say(`shot -> ${app.snapshot('orient-portrait-back')}`);

say(`all viewport messages: ${JSON.stringify(app.win.__wsSent.filter((m) => m?.type === 'viewport').map((m) => m.data))}`);
say(`console.error x${app.errors.length} ${app.errors.slice(0, 3).join(' | ')}`);
say(`frame errors  x${app.frameErrors.length} ${app.frameErrors[0] || ''}`);

app.restore();
process.exit(0);
