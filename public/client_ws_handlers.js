// Обработчики бинарных WS-сообщений, вынесенные из handleStateBinary()
// в client.js. Каждая функция разбирает ровно один msgType и возвращает
// новый offset (курсор буфера) после разбора — диспетчер (switch/if по
// msgType) остаётся в client.js.

// msgType === 2: ROI-обновление (players, rx/ry/rw/rh, dg, dt).
// ctx — явные зависимости, которые тело читало через замыкание client.js:
//   PLAYER_RECORD_SIZES, pickPlayerRecordSize — client_protocol.js
//   hueToHsl                                  — client_color.js
//   botIds                                    — module-level Set в client.js
//   DIR_NAMES                                 — module-level массив в client.js
//   displayNameOf, botDisplayName, t          — функции client.js/i18n
//   onState                                   — обработчик готового кадра состояния
export function handlePlayersMessage(dv, offset, ctx) {
  const { PLAYER_RECORD_SIZES, pickPlayerRecordSize, hueToHsl, botIds, DIR_NAMES, displayNameOf, botDisplayName, t, onState } = ctx;
  const bl = dv.byteLength;
  let o = offset;

  if (o + 4 + 2 > bl) return null;
  const tick = dv.getUint32(o, true);
  o += 4;
  const pc = dv.getUint16(o, true);
  o += 2;

  const [perPlayerV4, perPlayerV3, perPlayerV2] = PLAYER_RECORD_SIZES;
  const perPlayer = pickPlayerRecordSize(bl - o, pc);
  if (perPlayer === null) return null;
  const players = [];
  for (let k = 0; k < pc; k++) {
    const n = dv.getUint16(o, true);
    o += 2;
    const x = dv.getUint16(o, true);
    o += 2;
    const y = dv.getUint16(o, true);
    o += 2;
    const d = dv.getUint8(o);
    o += 1;
    const a = dv.getUint8(o) === 1;
    o += 1;
    const s = dv.getUint16(o, true);
    o += 2;
    const p = dv.getUint16(o, true);
    o += 2;
    const hue = dv.getUint16(o, true);
    o += 2;
    let sh = 0;
    let bot = 0;
    let cosCaptureFx = 0;
    let cosHead = 0;
    let cosSeg = 0;
    let cosNameplate = 0;
    let cosFrame = 0;
    if (perPlayer === perPlayerV2 || perPlayer === perPlayerV3) {
      sh = dv.getUint8(o);
      o += 1;
    }
    if (perPlayer === perPlayerV4) {
      sh = dv.getUint8(o);
      o += 1;
    }
    if (perPlayer === perPlayerV4) {
      bot = dv.getUint8(o);
      o += 1;
    }
    if (perPlayer === perPlayerV3 || perPlayer === perPlayerV4) {
      cosCaptureFx = dv.getUint8(o);
      o += 1;
      cosHead = dv.getUint8(o);
      o += 1;
      cosSeg = dv.getUint8(o);
      o += 1;
      cosNameplate = dv.getUint8(o);
      o += 1;
      cosFrame = dv.getUint8(o);
      o += 1;
    }
    const c = hueToHsl(hue);
    if (bot) botIds.add(n);
    players.push({
      n,
      x,
      y,
      d: DIR_NAMES[d] || 'right',
      a,
      c,
      s,
      p,
      sh,
      cosCaptureFx,
      cosHead,
      cosSeg,
      cosNameplate,
      cosFrame,
      nm: displayNameOf(n, bot ? botDisplayName(n) : `${t('leaderboard.player')} ${n}`),
      b: 0
    });
  }
  const rx = dv.getUint16(o, true);
  o += 2;
  const ry = dv.getUint16(o, true);
  o += 2;
  const rw = dv.getUint16(o, true);
  o += 2;
  const rh = dv.getUint16(o, true);
  o += 2;
  const lenDG = dv.getUint32(o, true);
  o += 4;
  const lenDT = dv.getUint32(o, true);
  o += 4;
  if (o + lenDG + lenDT > bl) return null;
  const dg = dv.buffer.slice(o, o + lenDG);
  o += lenDG;
  const dt = dv.buffer.slice(o, o + lenDT);
  o += lenDT;
  onState({ full: false, tick, t: Date.now(), players, dg, dt, roi: { rx, ry, rw, rh } });
  return o;
}
