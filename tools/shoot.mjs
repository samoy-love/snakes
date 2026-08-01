/*
 * tools/shoot.mjs — drive the real client through a match and dump PNGs.
 *
 *   node tools/shoot.mjs --w 390 --h 844 --tag phone --lang ru --seconds 60
 *
 * Writes tools/shots/<tag>-*.png plus an observation log on stdout.
 * The steering is a fixed square loop: leave home, close the loop, capture.
 * On death it clicks "Play again", so a long run keeps producing material.
 */
import { bootClient, sleep, SHOT_DIR } from './harness.mjs';

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const W = Number(arg('w', 1366));
const H = Number(arg('h', 768));
const TAG = arg('tag', `${W}x${H}`);
const LANG = arg('lang', 'ru');
const ORIGIN = arg('origin', 'http://localhost:3200');
const SECONDS = Number(arg('seconds', 45));
const SIDE = Number(arg('side', 7)); // cells per side of the capture loop

const say = (s) => process.stdout.write(`${s}\n`);

const BLOCK_VP = process.argv.includes('--novp');
const app = await bootClient({ width: W, height: H, lang: LANG, origin: ORIGIN, blockViewport: BLOCK_VP });
say(`# boot ok  viewport=${W}x${H} dpr=1 lang=${LANG}`);

await app.frames(10, 20);
await sleep(1500);
await app.frames(10, 20);
say(`shot menu           -> ${app.snapshot(`${TAG}-00-menu`)}`);

const nameInput = app.document.getElementById('menuNameInput');
if (nameInput) {
  nameInput.value = LANG === 'en' ? 'Harness' : 'Стенд';
  nameInput.dispatchEvent(new app.win.Event('input', { bubbles: true }));
  nameInput.dispatchEvent(new app.win.Event('change', { bubbles: true }));
}
app.click('playBtn');

// One tick = 100 ms (main.go TickMS), one frame ~16 ms, so a side of the loop
// is SIDE * 100 ms of wall clock.
const FRAMES_PER_SIDE = Math.round((SIDE * 100) / 16);
const DIRS = ['right', 'down', 'left', 'up'];
const KEYS = { right: 'ArrowRight', down: 'ArrowDown', left: 'ArrowLeft', up: 'ArrowUp' };

const total = Math.round((SECONDS * 1000) / 16);
const shots = new Set();
let deaths = 0;
let captureShot = 0;

function grab(name, f) {
  if (shots.has(name)) return;
  shots.add(name);
  say(`shot ${name.padEnd(18)} -> ${app.snapshot(`${TAG}-${name}`)}`);
  void f;
}

for (let f = 0; f < total; f++) {
  if (f % FRAMES_PER_SIDE === 0) app.key(KEYS[DIRS[(f / FRAMES_PER_SIDE) % 4 | 0]]);
  await app.frames(1, 16);

  // Death overlay: snapshot it, then respawn so the run keeps going.
  const dov = app.document.getElementById('deathOverlay');
  if (dov && !dov.classList.contains('hidden')) {
    deaths++;
    await app.frames(4, 16);
    grab('40-death-overlay');
    try {
      app.click('restartBtn');
    } catch {}
    await app.frames(20, 16);
    continue;
  }

  if (f === 30) grab('10-spawn');
  if (f === 90) grab('11-trail');
  // Right after the loop closes: the capture FX is still on screen.
  if (f === FRAMES_PER_SIDE * 4 + 8) grab('20-capture');
  if (f === FRAMES_PER_SIDE * 4 + 40) grab('21-owned');
  if (f === Math.round(total * 0.55)) grab('30-midgame');
  if (!captureShot && f > FRAMES_PER_SIDE * 8) {
    captureShot = 1;
    grab('31-second-loop');
  }
}
grab('99-final');

// ---- fog probe -------------------------------------------------------------
const cw = app.canvas.width;
const ch = app.canvas.height;
const band = Math.max(8, Math.round(Math.min(cw, ch) * 0.1));
const probe = {
  left: app.ink(0, 0, band, ch),
  right: app.ink(cw - band, 0, band, ch),
  top: app.ink(0, 0, cw, band),
  bottom: app.ink(0, ch - band, cw, band),
  center: app.ink(Math.round(cw / 2) - band, Math.round(ch / 2) - band, band * 2, band * 2),
};
say(
  `# ink%   ${Object.entries(probe)
    .map(([k, v]) => `${k}=${v.toFixed(1)}`)
    .join('  ')}`
);
say(`# canvas backing ${cw}x${ch}  deaths=${deaths}`);

// ---- what the client actually asked the server for -------------------------
const sentVp = app.win.__wsSent.filter((m) => m?.type === 'viewport').map((m) => m.data);
const gotVp = app.win.__wsRecv.filter((m) => m?.type === 'viewport').map((m) => m.data);
say(`# viewport sent ${JSON.stringify(sentVp)}  granted ${JSON.stringify(gotVp)}`);
const hello = app.win.__wsRecv.find((m) => m?.type === 'hello');
say(`# hello.roi ${JSON.stringify(hello?.data?.roi ?? null)}`);
const cosx = app.win.__wsRecv.filter((m) => m?.type === 'cosExtra').pop();
const bots = (cosx?.data?.players || []).filter((p) => p.bot);
say(`# cosExtra bots=${bots.length} sample=${JSON.stringify(bots.slice(0, 4))}`);
const cosm = app.win.__wsRecv.filter((m) => m?.type === 'cosmetics' || m?.type === 'init').pop();
const ap = cosm?.data?.achvProgress || cosm?.data?.cosmetics?.achvProgress;
say(`# achvProgress ${JSON.stringify((ap || []).slice(0, 5))} (n=${(ap || []).length})`);
say(`# console.error x${app.errors.length}${app.errors.length ? `\n${app.errors.slice(0, 6).join('\n')}` : ''}`);
const uw = [...new Set(app.warns)];
say(`# console.warn  x${app.warns.length}${uw.length ? `\n${uw.slice(0, 6).join('\n')}` : ''}`);
say(`# frame errors  x${app.frameErrors.length}${app.frameErrors.length ? `\n${app.frameErrors[0]}` : ''}`);
say(`# shots in ${SHOT_DIR}`);

app.restore();
process.exit(0);
