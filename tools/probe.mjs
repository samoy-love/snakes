/*
 * tools/probe.mjs — per-frame cost probe for the in-match HUD (C7).
 *
 *   node tools/probe.mjs [--seconds 20]
 *
 * Instruments localStorage.getItem and Node.textContent/replaceChildren, plays
 * a short match, and reports how many of each happen per animation frame.
 * Anything that scales with frame count is a regression: the HUD is supposed to
 * write only on change.
 */
import { bootClient, sleep } from './harness.mjs';

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const SECONDS = Number(arg('seconds', 20));
const say = (s) => process.stdout.write(`${s}\n`);

const app = await bootClient({ width: 1366, height: 768, lang: 'ru', origin: arg('origin', 'http://localhost:3200') });
const win = app.win;

const counters = { ls: 0, text: 0, children: 0, createElement: 0 };
const byCaller = { text: new Map(), createElement: new Map(), children: new Map() };
// Attribute each DOM write to the first client.js frame on the stack, so a
// per-frame number can be traced to the function that produced it.
function blame(map) {
  const st = String(new Error().stack || '').split('\n');
  const line = st.find((l, i) => i > 2 && l.includes('client.js'));
  const key = line ? line.trim().replace(/\s*\(.*$/, '').replace(/^at\s+/, '') : 'unknown';
  map.set(key, (map.get(key) || 0) + 1);
}
const lsKeys = new Map();

const ls = win.localStorage;
const origGet = ls.getItem.bind(ls);
ls.getItem = (k) => {
  counters.ls++;
  lsKeys.set(k, (lsKeys.get(k) || 0) + 1);
  return origGet(k);
};

const nodeProto = win.Node.prototype;
const desc = Object.getOwnPropertyDescriptor(nodeProto, 'textContent');
Object.defineProperty(nodeProto, 'textContent', {
  configurable: true,
  get: desc.get,
  set(v) {
    counters.text++;
    blame(byCaller.text);
    desc.set.call(this, v);
  },
});
const origRepl = win.Element.prototype.replaceChildren;
win.Element.prototype.replaceChildren = function (...a) {
  counters.children++;
  blame(byCaller.children);
  return origRepl.apply(this, a);
};
const origCreate = win.document.createElement.bind(win.document);
win.document.createElement = (...a) => {
  counters.createElement++;
  blame(byCaller.createElement);
  return origCreate(...a);
};

await app.frames(8, 20);
await sleep(1500);
await app.frames(8, 20);
const nameInput = win.document.getElementById('menuNameInput');
if (nameInput) {
  nameInput.value = 'Probe';
  nameInput.dispatchEvent(new win.Event('input', { bubbles: true }));
}
app.click('playBtn');
await app.frames(40, 16);

// Reset after the join burst: we only care about the steady in-match cost.
for (const k of Object.keys(counters)) counters[k] = 0;
lsKeys.clear();

const KEYS = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
const total = Math.round((SECONDS * 1000) / 16);
let frames = 0;
for (let f = 0; f < total; f++) {
  if (f % 44 === 0) app.key(KEYS[(f / 44) % 4 | 0]);
  await app.frames(1, 16);
  frames++;
  const dov = win.document.getElementById('deathOverlay');
  if (dov && !dov.classList.contains('hidden')) {
    try {
      app.click('restartBtn');
    } catch {}
    await app.frames(16, 16);
  }
}

say(`frames                 ${frames}`);
say(`localStorage.getItem   ${counters.ls}  (${(counters.ls / frames).toFixed(3)} / frame)`);
say(`textContent writes     ${counters.text}  (${(counters.text / frames).toFixed(2)} / frame)`);
say(`replaceChildren        ${counters.children}  (${(counters.children / frames).toFixed(3)} / frame)`);
say(`createElement          ${counters.createElement}  (${(counters.createElement / frames).toFixed(2)} / frame)`);
for (const [k, m] of Object.entries(byCaller)) {
  const t = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  say(`  top ${k} callers: ${t.map(([n, c]) => `${n}=${(c / frames).toFixed(2)}/f`).join('  ')}`);
}
const top = [...lsKeys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
say(`hottest storage keys   ${JSON.stringify(top)}`);
say(`console.error x${app.errors.length} ${app.errors.slice(0, 3).join(' | ')}`);
say(`console.warn  x${app.warns.length} ${[...new Set(app.warns)].slice(0, 3).join(' | ')}`);
say(`frame errors  x${app.frameErrors.length} ${app.frameErrors[0] || ''}`);

app.restore();
process.exit(0);
