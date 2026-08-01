/*
 * tools/hud.mjs — DOM-side verification for C3/C4/C6.
 *
 *   node tools/hud.mjs [--seconds 45] [--lang ru]
 *
 * The playfield lives on <canvas> (see shoot.mjs), but the leaderboard, the
 * killfeed and the cosmetics shop are plain DOM. This script plays a match,
 * then prints:
 *   - the leaderboard rows with their bot-archetype badges (C4);
 *   - the killfeed lines and the capture events that were filtered out (C6);
 *   - the Titles tab of the shop with real achievement progress (C3).
 */
import { bootClient, sleep } from './harness.mjs';

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const SECONDS = Number(arg('seconds', 45));
const LANG = arg('lang', 'ru');
const say = (s) => process.stdout.write(`${s}\n`);

const app = await bootClient({ width: 1366, height: 768, lang: LANG, origin: arg('origin', 'http://localhost:3200') });
const win = app.win;
const doc = win.document;

/* C6 accounting: tally every killfeed line the player is actually shown,
 * by kind, over the whole match. `#killfeed` is rebuilt with replaceChildren
 * only when the visible text changes, so counting distinct texts per kind
 * gives the real event volume the player reads. */
const seen = new Map();
const kinds = new Map();
{
  const feed = doc.getElementById('killfeed');
  const orig = feed.replaceChildren.bind(feed);
  feed.replaceChildren = (...nodes) => {
    for (const n of nodes) {
      const k = (n.getAttribute?.('class') || '').replace('killLine', '').trim() || 'plain';
      const key = `${k}|${n.textContent}`;
      if (!seen.has(key)) {
        seen.set(key, 1);
        kinds.set(k, (kinds.get(k) || 0) + 1);
      }
    }
    return orig(...nodes);
  };
}

await app.frames(8, 20);
await sleep(1500);
await app.frames(8, 20);
const nameInput = doc.getElementById('menuNameInput');
if (nameInput) {
  nameInput.value = LANG === 'en' ? 'Harness' : 'Стенд';
  nameInput.dispatchEvent(new win.Event('input', { bubbles: true }));
}
app.click('playBtn');

const KEYS = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
const total = Math.round((SECONDS * 1000) / 16);
for (let f = 0; f < total; f++) {
  if (f % 44 === 0) app.key(KEYS[(f / 44) % 4 | 0]);
  await app.frames(1, 16);
  const dov = doc.getElementById('deathOverlay');
  if (dov && !dov.classList.contains('hidden')) {
    try {
      app.click('restartBtn');
    } catch {}
    await app.frames(16, 16);
  }
}

const desc = (el) => {
  const cls = el.getAttribute('class') || '';
  const ttl = el.getAttribute('title') || '';
  return `<${el.tagName.toLowerCase()} class="${cls}"${ttl ? ` title="${ttl}"` : ''}>${el.textContent}`;
};

say('===== C4: leaderboard rows =====');
for (const tr of doc.querySelectorAll('#stats tbody tr')) {
  const cells = [...tr.children].map((td) => td.textContent.trim());
  const badge = tr.querySelector('.botArch');
  say(`  ${cells.join(' | ')}${badge ? `   [badge ${badge.getAttribute('class')} title="${badge.getAttribute('title')}" aria="${badge.getAttribute('aria-label')}"]` : ''}`);
}

say('===== C4/C6: killfeed lines =====');
for (const d of doc.querySelectorAll('#killfeed > div')) {
  const badge = d.querySelector('.botArch');
  say(`  ${desc(d)}${badge ? `   [badge ${badge.getAttribute('class')}]` : ''}`);
}

say('===== C6: distinct killfeed lines over the whole match, by kind =====');
say(`  ${JSON.stringify(Object.fromEntries([...kinds].sort((a, b) => b[1] - a[1])))}`);
say(`  total distinct lines = ${seen.size} over ${SECONDS}s = ${(seen.size / SECONDS).toFixed(2)}/s`);

// ---- C3: the Titles tab of the shop ---------------------------------------
try {
  app.click('cosmeticsBtn');
} catch {
  try {
    app.click('cosmeticsMenuBtn');
  } catch {}
}
await app.frames(6, 16);
const titleTab = [...doc.querySelectorAll('#cosmeticsOverlay button, #cosmeticsOverlay [role="tab"]')].find((b) =>
  /титул|title/i.test(b.textContent || '')
);
if (titleTab) {
  titleTab.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await app.frames(6, 16);
}
say('===== C3: titles tab =====');
const cards = doc.querySelectorAll('.titleItem');
say(`  cards=${cards.length}`);
for (const c of cards) {
  const name = c.querySelector('.titleName')?.textContent?.trim() || '';
  const req = c.querySelector('.titleReq')?.textContent?.trim() || '';
  const bar = c.querySelector('.cosmeticsItemProgress > span');
  const lab = c.querySelector('.cosmeticsItemProgressLabel')?.textContent?.trim() || '';
  const row = c.querySelector('.cosmeticsProgressRow') ? 'row' : bar ? 'bare' : '-';
  say(`  ${c.className.includes('isLocked') ? 'LOCKED  ' : 'unlocked'} ${name.padEnd(26)} bar=${bar ? bar.style.width : '-'} label="${lab}" wrap=${row} req="${req}"`);
}

say(`console.error x${app.errors.length} ${app.errors.slice(0, 4).join(' | ')}`);
say(`console.warn  x${app.warns.length} ${[...new Set(app.warns)].slice(0, 4).join(' | ')}`);
say(`frame errors  x${app.frameErrors.length} ${app.frameErrors[0] || ''}`);

app.restore();
process.exit(0);
