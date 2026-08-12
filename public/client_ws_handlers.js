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

// msgType === 4: minimap chunks (tick, cw, ch, count, flags, chunks...).
// ctx — явные зависимости, которые тело читало через замыкание client.js:
//   W, N                                       — размеры минимапы
//   minimapGridOwner                           — Uint16Array владельцев клеток
//   minimapImage, you, colors, minimapOwnerRgbCache,
//   gridCellOwner, gridCellIsCooling           — данные для setMinimapPixel
//   setMinimapPixel                            — client_minimap.js
// Возвращает null, если буфера не хватило (диспетчер должен прервать разбор
// без побочных эффектов), иначе { offset, hadChunkUpdate: true }.
export function handleMinimapMessage(dv, offset, ctx) {
  const { W, N, minimapGridOwner, minimapImage, you, colors, minimapOwnerRgbCache, gridCellOwner, gridCellIsCooling, setMinimapPixel } = ctx;
  const bl = dv.byteLength;
  let o = offset;

  if (o + 4 + 1 + 1 + 2 + 1 > bl) return null;
  o += 4;
  const cw = dv.getUint8(o);
  o += 1;
  const ch = dv.getUint8(o);
  o += 1;
  if (!cw || !ch) return null;
  const count = dv.getUint16(o, true);
  o += 2;
  const flags = dv.getUint8(o);
  o += 1;
  const hasTrail = (flags & 1) === 1;
  const chunkCells = cw * ch;
  for (let k = 0; k < count; k++) {
    const bytesChunk = 2 + chunkCells * 2 + (hasTrail ? chunkCells * 2 : 0);
    if (o + bytesChunk > bl) return null;
    const cx = dv.getUint8(o);
    o += 1;
    const cy = dv.getUint8(o);
    o += 1;
    const x0 = cx * cw;
    const y0 = cy * ch;
    for (let n = 0; n < chunkCells; n++) {
      const v = dv.getUint16(o, true);
      o += 2;
      const xx = n % cw;
      const yy = (n / cw) | 0;
      const i = (y0 + yy) * W + (x0 + xx);
      if (i >= 0 && i < N && minimapGridOwner) minimapGridOwner[i] = v;
    }
    if (hasTrail) {
      for (let n = 0; n < chunkCells; n++) {
        o += 2;
      }
    }

    // update pixels for this chunk only
    for (let yy = 0; yy < ch; yy++) {
      const row = (y0 + yy) * W + x0;
      for (let xx = 0; xx < cw; xx++) {
        const i = row + xx;
        if (i >= 0 && i < N) {
          setMinimapPixel(i, { minimapImage, minimapGridOwner, you, colors, minimapOwnerRgbCache, gridCellOwner, gridCellIsCooling });
        }
      }
    }
  }
  return { offset: o, hadChunkUpdate: true };
}

// msgType === 5: пакет событий матча (тик, мутатор, баунти, powerUps,
// список событий). Самая насыщенная побочными эффектами ветка бинарного
// протокола — перенесена ЦЕЛИКОМ как есть из handleStateBinary(), порядок
// вызовов внутри каждого kind не менялся.
//
// В отличие от handlePlayersMessage()/handleMinimapMessage() эта ветка не
// только читает состояние client.js, но и переприсваивает module-level
// let-переменные (bountyTarget, mutatorType, youKills, youContractProgress,
// killfeedDirty и т.д. — их читают renderTopHud()/renderMetaHud() и другие
// части client.js). Присваивание внутри функции меняет только ЛОКАЛЬНУЮ
// копию (JS передаёт примитивы по значению), поэтому такие имена не могут
// быть просто полями ctx, которые функция читает и всё — она должна отдать
// их обновлённые значения обратно. Контракт: ctx передаёт НАЧАЛЬНЫЕ значения
// этих полей, а при успешном разборе (offset !== null) функция возвращает
// объект с offset и итоговыми значениями ВСЕХ из них — вызывающий код в
// client.js обязан переприсвоить свои module-level let из этого объекта.
// При нехватке байт функция возвращает null, ничего не отдавая — как и
// другие handle*Message(), это означает «прервать разбор без побочных
// эффектов после этой точки» (эффекты ДО прерывания, например изменение o
// или пуш в киллфид, уже могли начаться — это то же поведение, что было в
// исходном коде: `return;` внутри if (msgType === 5) обрывал разбор ровно
// в этом месте).
//
// ctx — явные зависимости из client.js:
//   значения для обратной записи (см. выше): lastEventsTick, lastEventsAt, mutatorType, mutatorUntil, bountyTarget, bountyUntil, powerUps, youKills, youStreak, youShield, youSpeedUntilTick, youSpeedType, matchStyleEarned, styleToastAcc, styleToastReason, styleToastCount, styleToastTimer, youContractType, youContractGoal, youContractProgress, youContractUntil, killfeedDirty, lastDeathInfo
//   функции/константы только на чтение:
//     displayNameOf, deathReasonLabel, addFxBurst, cosClampId,
//     cosDeathByPlayer, COS_DEATH_MS, pushEventFeed, t (i18n), addShakeClass,
//     shakeDirFrom, sfx, fxFlashScreen, comboBump, vibrate, obFireEvent,
//     FEED_FOREIGN_CAPTURE_MIN, addScorePopup, CAPTURE_JACKPOT_CELLS,
//     triggerHitstop, bumpMatchTabBadge, showBigBanner, addToast, fmtInt,
//     celebrateFirstCapture, cosCaptureFxByPlayer, coolDeadlineByOwner (Map,
//     мутируется через .set/.delete — сама ссылка не переприсваивается),
//     approxNowTick, tickMs, RECLAIM_WINDOW_MS, dailySetAssign, infoPack,
//     dailyLabel, dailySetProgress, youDailies (Map), achvLabel, infoDesc,
//     contractLabel, styleLabel, setYouStyle, flushStyleToast, comboBreak,
//     mutatorLabel, unknownEventKindSeen (Set), powerupLabel, you (id игрока),
//     renderKillfeed, renderMetaHud, renderTopHud
export function handleEventsMessage(dv, offset, ctx) {
  const { displayNameOf, deathReasonLabel, addFxBurst, cosClampId, cosDeathByPlayer, COS_DEATH_MS, pushEventFeed, t, addShakeClass, shakeDirFrom, sfx, fxFlashScreen, comboBump, vibrate, obFireEvent, FEED_FOREIGN_CAPTURE_MIN, addScorePopup, CAPTURE_JACKPOT_CELLS, triggerHitstop, bumpMatchTabBadge, showBigBanner, addToast, fmtInt, celebrateFirstCapture, cosCaptureFxByPlayer, coolDeadlineByOwner, approxNowTick, tickMs, RECLAIM_WINDOW_MS, dailySetAssign, infoPack, dailyLabel, dailySetProgress, youDailies, achvLabel, infoDesc, contractLabel, styleLabel, setYouStyle, flushStyleToast, comboBreak, mutatorLabel, unknownEventKindSeen, powerupLabel, you, renderKillfeed, renderMetaHud, renderTopHud } = ctx;
  let lastEventsTick = ctx.lastEventsTick;
  let lastEventsAt = ctx.lastEventsAt;
  let mutatorType = ctx.mutatorType;
  let mutatorUntil = ctx.mutatorUntil;
  let bountyTarget = ctx.bountyTarget;
  let bountyUntil = ctx.bountyUntil;
  let powerUps = ctx.powerUps;
  let youKills = ctx.youKills;
  let youStreak = ctx.youStreak;
  let youShield = ctx.youShield;
  let youSpeedUntilTick = ctx.youSpeedUntilTick;
  let youSpeedType = ctx.youSpeedType;
  let matchStyleEarned = ctx.matchStyleEarned;
  let styleToastAcc = ctx.styleToastAcc;
  let styleToastReason = ctx.styleToastReason;
  let styleToastCount = ctx.styleToastCount;
  let styleToastTimer = ctx.styleToastTimer;
  let youContractType = ctx.youContractType;
  let youContractGoal = ctx.youContractGoal;
  let youContractProgress = ctx.youContractProgress;
  let youContractUntil = ctx.youContractUntil;
  let killfeedDirty = ctx.killfeedDirty;
  let lastDeathInfo = ctx.lastDeathInfo;
  const bl = dv.byteLength;
  let o = offset;

  const need = (n) => o+n <= bl;
  if (!need(4 + 1 + 4 + 2 + 4 + 1)) return null;
  const tick = dv.getUint32(o, true);
  o += 4;

  lastEventsTick = tick;
  lastEventsAt = Date.now();

  mutatorType = dv.getUint8(o);
  o += 1;
  mutatorUntil = dv.getUint32(o, true);
  o += 4;

  bountyTarget = dv.getUint16(o, true);
  o += 2;
  bountyUntil = dv.getUint32(o, true);
  o += 4;

  const puCount = dv.getUint8(o);
  o += 1;
  const nextPU = new Map();
  if (!need(puCount * 11 + 2)) return null;
  for (let k = 0; k < puCount; k++) {
    const id = dv.getUint16(o, true);
    o += 2;
    const type = dv.getUint8(o);
    o += 1;
    const x = dv.getUint16(o, true);
    o += 2;
    const y = dv.getUint16(o, true);
    o += 2;
    const expires = dv.getUint32(o, true);
    o += 4;
    nextPU.set(id, { id, type, x, y, expires });
  }
  powerUps = nextPU;

  const evCount = dv.getUint16(o, true);
  o += 2;
  for (let k = 0; k < evCount; k++) {
    if (!need(1)) return null;
    const kind = dv.getUint8(o);
    o += 1;

    if (kind === 1) {
      if (!need(9)) return null;
      const victim = dv.getUint16(o, true);
      o += 2;
      const killer = dv.getUint16(o, true);
      o += 2;
      const reason = dv.getUint8(o);
      o += 1;
      const ex = dv.getUint16(o, true);
      o += 2;
      const ey = dv.getUint16(o, true);
      o += 2;
      const vn = displayNameOf(victim);
      const kn = killer ? displayNameOf(killer) : '';

      if (victim === you) {
        lastDeathInfo = { killer, killerName: kn, reason };
      }

      const rs = deathReasonLabel(reason);
      // Эффект гибели жертвы — его видят все, а не только убийца.
      // Стиль берём из cosExtra; без сообщения это базовая вспышка (0).
      addFxBurst(ex, ey, `die${cosClampId(cosDeathByPlayer.get(victim) || 0)}`, {
        pid: victim,
        life: COS_DEATH_MS
      });

      if (killer) pushEventFeed(`${kn} -> ${vn}${rs ? ` (${rs})` : ''}`, 'Kill', killer);
      else pushEventFeed(`${vn} ${t('feed.died')}${rs ? ` (${rs})` : ''}`, 'Death', victim);

      if (killer && killer === you) {
        youKills++;
        addFxBurst(ex, ey, 'kill');
        addShakeClass('medium', ...shakeDirFrom(ex, ey));
        sfx.kill();
        fxFlashScreen([255, 96, 96], 0.75);
        comboBump();
        vibrate(35);
        // K5: первое убийство — открываем контракты.
        obFireEvent('kill');
      }
      if (victim === you) {
        // J2: отклик на собственную смерть — не на чужую.
        addShakeClass('large', ...shakeDirFrom(ex, ey));
        fxFlashScreen([255, 80, 80], 1);
        comboBreak();
        // K5: первая смерть — теперь понятно, зачем баунти и киллы.
        obFireEvent('death');
      }
      continue;
    }

    if (kind === 19) {
      if (!need(2 + 2 + 2 + 4 + 1)) return null;
      const pid = dv.getUint16(o, true);
      o += 2;
      const ex = dv.getUint16(o, true);
      o += 2;
      const ey = dv.getUint16(o, true);
      o += 2;
      const delta = dv.getUint32(o, true);
      o += 4;
      const fxId = dv.getUint8(o);
      o += 1;
      const pn = displayNameOf(pid);
      /* C6: 13 ботов делают по ~66 захватов за матч — это ~2 строки в
         секунду, лента читалась как зависший лог и в ней тонули киллы.
         Свой захват идёт в ленту всегда (это ответ на твоё действие),
         чужой — только если он крупный: порог примерно равен половине
         типового домашнего квадрата, ниже него событие не несёт
         информации о раскладе на карте. */
      if (pid === you || delta >= FEED_FOREIGN_CAPTURE_MIN) {
        pushEventFeed(
          `${pn} ${t('feed.captured')} +${delta} ${t('feed.zone')}`,
          'Capture',
          pid
        );
      }
      addFxBurst(ex, ey, `cap${cosClampId(fxId)}`, { pid });
      if (pid === you) {
        // J5: самое частое приятное действие теперь показывает число.
        addScorePopup(ex, ey, delta);
        comboBump();

        const jackpot = delta >= CAPTURE_JACKPOT_CELLS;
        if (jackpot) {
          addShakeClass('large', ...shakeDirFrom(ex, ey));
          fxFlashScreen([255, 215, 120], 1);
          // J12: 140 мс на самом жирном событии игры.
          triggerHitstop(140);
          sfx.jackpot();
          bumpMatchTabBadge();
          if (!showBigBanner('💎', t('banner.jackpot'), `+${fmtInt(delta)} · ${t('banner.jackpot_sub')}`, 'jackpot')) {
            addToast('💎', `${t('banner.jackpot')} +${fmtInt(delta)}`, 'big', t('banner.jackpot_sub'), {
              tab: 'match',
              key: 'capture_jackpot',
              prio: 'jackpot'
            });
          }
        } else {
          addShakeClass('small', ...shakeDirFrom(ex, ey));
          // J17: раньше захват меньше 40 клеток звучал как ничто.
          if (delta >= 40) sfx.captureBig();
          else sfx.captureSmall();
        }

        celebrateFirstCapture(delta);
        // K5: первый захват — момент, когда про бонусы уже есть смысл рассказать.
        obFireEvent('capture');
      }
      continue;
    }

    // F5 «Реклейм»: игрок вернул свою остывающую территорию.
    // A=игрок, B=клетки, X/Y=точка возврата. Без разбора этого kind весь
    // остаток пакета событий терялся бы (парсер ломается на неизвестном kind).
    if (kind === 20) {
      if (!need(2 + 2 + 2 + 2)) return null;
      const pid = dv.getUint16(o, true);
      o += 2;
      const cells = dv.getUint16(o, true);
      o += 2;
      const ex = dv.getUint16(o, true);
      o += 2;
      const ey = dv.getUint16(o, true);
      o += 2;
      const pn = displayNameOf(pid);
      // C6: тот же порог, что и у захвата — чужой возврат мелочи в ленте
      // такой же шум, как и чужой мелкий захват. Свой — всегда.
      if (pid === you || cells >= FEED_FOREIGN_CAPTURE_MIN) {
        pushEventFeed(`${pn} ${t('feed.reclaimed')} +${cells}`, 'Reclaim', pid);
      }
      addFxBurst(ex, ey, `cap${cosClampId(cosCaptureFxByPlayer(pid))}`, { pid });
      if (pid === you && cells > 0) {
        addScorePopup(ex, ey, cells);
        // F5: возврат своей земли должен читаться иначе, чем обычный захват —
        // это отыгранная назад потеря, а не прирост.
        addFxBurst(ex, ey, 'reclaim', { life: 900 });
        addShakeClass(cells >= 120 ? 'medium' : 'small', ...shakeDirFrom(ex, ey));
        fxFlashScreen([120, 220, 255], Math.min(1, 0.35 + cells / 400));
        sfx.bountyClaimed();
        addToast('♻', t('reclaim.toast'), cells >= 120 ? 'big' : '', `+${fmtInt(cells)} · ${t('reclaim.toast_desc')}`, {
          key: 'reclaim',
          prio: cells >= 120 ? 'jackpot' : 'important'
        });
        if (cells >= 120) triggerHitstop(110);
      }
      coolDeadlineByOwner.delete(pid);
      continue;
    }

    // F5 «Реклейм»: EventCoolBatch (21) — территория погибшего пошла остывать.
    // A=бывший владелец, B=клетки, C=тик окончательного исчезновения.
    // Даёт честное время истечения вместо клиентской оценки по первому кадру.
    if (kind === 21) {
      if (!need(2 + 2 + 4)) return null;
      const pid = dv.getUint16(o, true);
      o += 2;
      const cells = dv.getUint16(o, true);
      o += 2;
      const untilTick = dv.getUint32(o, true);
      o += 4;
      if (cells > 0) {
        const nt = approxNowTick();
        const remMs = nt != null && tickMs ? Math.max(0, (untilTick - nt) * tickMs) : RECLAIM_WINDOW_MS;
        coolDeadlineByOwner.set(pid, performance.now() + Math.min(RECLAIM_WINDOW_MS * 1.5, remMs));
      }
      continue;
    }

    if (kind === 15) {
      if (!need(2 + 1 + 2 + 4)) return null;
      const pid = dv.getUint16(o, true);
      o += 2;
      const slot = dv.getUint8(o);
      o += 1;
      const goal = dv.getUint16(o, true);
      o += 2;
      const packed = dv.getUint32(o, true);
      o += 4;
      // K7: раньше здесь объявлялась `const t`, перекрывавшая функцию перевода
      // на весь блок. Переименовано в `type`.
      const type = (packed >>> 16) & 0xffff;
      const prog = packed & 0xffff;
      if (pid === you) {
        dailySetAssign(slot, type, goal, prog);
        bumpMatchTabBadge();
        // J16: назначение ежедневки было беззвучным.
        sfx.dailyAssigned();
        // C7: ключ тоста включает слот — иначе два слота с одним типом
        // схлопывались в один тост и одно из заданий оставалось невидимым.
        addToast('📅', `${infoPack().labels.daily}: ${dailyLabel(type)}`, 'big', infoDesc(infoPack().dailies, type, ''), { tab: 'match', key: `daily_assign_${slot}_${type}`, prio: 'important' });
      }
      continue;
    }

    if (kind === 16) {
      if (!need(2 + 1 + 2)) return null;
      const pid = dv.getUint16(o, true);
      o += 2;
      const slot = dv.getUint8(o);
      o += 1;
      const prog = dv.getUint16(o, true);
      o += 2;
      if (pid === you) {
        dailySetProgress(slot, prog);
      }
      continue;
    }

    if (kind === 17) {
      if (!need(2 + 1)) return null;
      const pid = dv.getUint16(o, true);
      o += 2;
      const slot = dv.getUint8(o);
      o += 1;
      if (pid === you) {
        bumpMatchTabBadge();
        // C7: тост называет конкретное задание и различает слоты.
        const doneIt = youDailies.get(Number(slot) || 0);
        if (doneIt) doneIt.prog = doneIt.goal || doneIt.prog;
        const doneName = doneIt?.type ? dailyLabel(doneIt.type) : '';
        addToast('🏁', infoPack().labels.dailyComplete, 'big', doneName, { tab: 'match', key: `daily_complete_${slot}`, prio: 'important' });
        sfx.dailyDone();
        comboBump();
      }
      continue;
    }

    if (kind === 18) {
      if (!need(2 + 1)) return null;
      const pid = dv.getUint16(o, true);
      o += 2;
      const achv = dv.getUint8(o);
      o += 1;
      const pn = displayNameOf(pid);
      pushEventFeed(`${pn} — ${infoPack().labels.achievement}: ${achvLabel(achv)}`, 'Achv', pid);
      if (pid === you) {
        bumpMatchTabBadge();
        sfx.achievement();
        fxFlashScreen([255, 225, 150], 0.8);
        triggerHitstop(90);
        // J13: ачивка идёт в центральный баннер, а не тонет за тремя мелкими тостами.
        if (!showBigBanner('🏅', achvLabel(achv), infoDesc(infoPack().achv, achv, ''), 'jackpot')) {
          addToast('🏅', `${infoPack().labels.achievement}: ${achvLabel(achv)}`, 'big', infoDesc(infoPack().achv, achv, ''), { tab: 'match', key: `achv_${achv}`, prio: 'jackpot' });
        }
      }
      continue;
    }

    if (kind === 10) {
      if (!need(2 + 1 + 2 + 4)) return null;
      const pid = dv.getUint16(o, true);
      o += 2;
      const type = dv.getUint8(o);
      o += 1;
      const goal = dv.getUint16(o, true);
      o += 2;
      const until = dv.getUint32(o, true);
      o += 4;
      const pn = displayNameOf(pid);
      pushEventFeed(`${pn} — ${infoPack().labels.contract}: ${contractLabel(type) || type} ${goal}`, 'Contract', pid);
      if (pid === you) {
        youContractType = type;
        youContractGoal = goal;
        youContractProgress = 0;
        youContractUntil = until;
        bumpMatchTabBadge();
        // J16: назначение контракта было беззвучным.
        sfx.contractAssigned();
        addToast('📜', `${infoPack().labels.contract}: ${contractLabel(type) || type}`, 'big', infoDesc(infoPack().contracts, type, ''), { tab: 'match', key: `contract_assign_${type}`, prio: 'important' });
      }
      continue;
    }

    if (kind === 11) {
      if (!need(2 + 1 + 2)) return null;
      const pid = dv.getUint16(o, true);
      o += 2;
      const type = dv.getUint8(o);
      o += 1;
      const prog = dv.getUint16(o, true);
      o += 2;
      if (pid === you) {
        youContractType = type;
        youContractProgress = prog;
      }
      continue;
    }

    if (kind === 12) {
      if (!need(2 + 1)) return null;
      const pid = dv.getUint16(o, true);
      o += 2;
      const type = dv.getUint8(o);
      o += 1;
      const pn = displayNameOf(pid);
      pushEventFeed(`${pn} — ${infoPack().labels.contractComplete}: ${contractLabel(type) || type}`, 'Contract', pid);
      if (pid === you) {
        youContractProgress = youContractGoal;
        bumpMatchTabBadge();
        addToast('✅', `${infoPack().labels.contractComplete}: ${contractLabel(type) || type}`, 'big', infoDesc(infoPack().contracts, type, ''), { tab: 'match', key: `contract_complete_${type}`, prio: 'important' });
        sfx.contractDone();
        comboBump();
      }
      continue;
    }

    if (kind === 13) {
      if (!need(2 + 2 + 4 + 1)) return null;
      const pid = dv.getUint16(o, true);
      o += 2;
      const delta = dv.getUint16(o, true);
      o += 2;
      const total = dv.getUint32(o, true);
      o += 4;
      const reason = dv.getUint8(o);
      o += 1;
      /* C8: начисления Стиля чужих игроков давали вторую строку на каждый
         захват бота — при одном человеке в комнате это ~16 строк/с про чужую
         валюту, ценности для игрока ноль. В ленту идёт только свой Стиль. */
      if (pid === you) {
        pushEventFeed(`+${delta} ${t('cosmetics.style_points')} (${styleLabel(reason)})`, 'Style');
        if (delta > 0) matchStyleEarned += delta;
        setYouStyle(total);
        bumpMatchTabBadge();
        if (delta >= 20) {
          if (styleToastTimer) {
            try {
              clearTimeout(styleToastTimer);
            } catch {}
            styleToastTimer = 0;
            styleToastAcc = 0;
            styleToastReason = 0;
            styleToastCount = 0;
          }
          addToast('✨', `+${delta} ${t('cosmetics.style_points')}`, 'big', styleLabel(reason), { tab: 'match', key: `style_${reason}_${delta}` });
        } else if (delta > 0) {
          if (styleToastAcc && styleToastReason && styleToastReason !== reason) {
            flushStyleToast();
          }
          styleToastAcc += delta;
          styleToastReason = reason;
          styleToastCount++;
          if (!styleToastTimer) {
            styleToastTimer = setTimeout(flushStyleToast, 650);
          }
        }
      }
      continue;
    }

    if (kind === 14) {
      if (!need(2 + 2)) return null;
      const killer = dv.getUint16(o, true);
      o += 2;
      const victim = dv.getUint16(o, true);
      o += 2;
      const kn = displayNameOf(killer);
      const vn = displayNameOf(victim);
      pushEventFeed(`${t('feed.revenge')}: ${kn} -> ${vn}`, 'Revenge', killer);
      if (killer === you) {
        bumpMatchTabBadge();
        sfx.revenge();
        fxFlashScreen([255, 110, 110], 0.85);
        if (!showBigBanner('😈', t('banner.revenge'), t('banner.revenge_sub'), 'danger')) {
          addToast('😈', t('banner.revenge'), 'big', t('banner.revenge_sub'), { tab: 'match', key: 'revenge', prio: 'jackpot' });
        }
      }
      continue;
    }

    if (kind === 2) {
      if (!need(2 + 1)) return null;
      const pid = dv.getUint16(o, true);
      o += 2;
      const streak = dv.getUint8(o);
      o += 1;
      const pn = displayNameOf(pid);
      pushEventFeed(`${pn} — ${t('event.streak')} x${streak}`, 'Streak', pid);
      if (pid === you) {
        youStreak = streak;
        // J3: раньше бип стоял вне этой проверки — в комнате с 14 ботами
        // получался метроном.
        sfx.streak(Math.max(0, streak - 2));
        if (streak === 3) {
          bumpMatchTabBadge();
          addToast('🔥', `${t('toast.streak')} x${streak}`, null, t('toast.streak_3'), { tab: 'match', key: `streak_${streak}`, prio: 'important' });
        }
        if (streak >= 5) {
          bumpMatchTabBadge();
          fxFlashScreen([255, 170, 90], 0.8);
          if (!showBigBanner('🔥', `${t('banner.streak')} x${streak}`, t('toast.streak_5'), 'jackpot')) {
            addToast('🔥', `${t('toast.streak')} x${streak}`, 'big', t('toast.streak_5'), { tab: 'match', key: `streak_${streak}`, prio: 'jackpot' });
          }
        }
      }
      continue;
    }

    if (kind === 3) {
      if (!need(2 + 4)) return null;
      const target = dv.getUint16(o, true);
      o += 2;
      const until = dv.getUint32(o, true);
      o += 4;
      bountyTarget = target;
      bountyUntil = until;
      const tn = displayNameOf(target);
      pushEventFeed(`${t('event.bounty')}: ${tn}`, 'Bounty');

      bumpMatchTabBadge();
      addToast('🎯', `${infoPack().labels.bounty}: ${tn}`, 'big', t('toast.bounty_desc'), { tab: 'match', key: `bounty_${target}`, prio: target === you ? 'jackpot' : 'important' });
      // J2/J3: назначение баунти — глобальное событие. Полная громкость только
      // если цель — ты, иначе 40%.
      sfx.bountyAssigned(target === you ? 1 : 0.4);
      if (target === you) fxFlashScreen([255, 140, 90], 0.7);
      continue;
    }

    if (kind === 4) {
      if (!need(2 + 2)) return null;
      const killer = dv.getUint16(o, true);
      o += 2;
      const victim = dv.getUint16(o, true);
      o += 2;
      const kn = displayNameOf(killer);
      const vn = displayNameOf(victim);
      pushEventFeed(`${t('event.bounty_claimed')}: ${kn} -> ${vn}`, 'Bounty', killer);

      bumpMatchTabBadge();
      const mineClaim = killer === you;
      addToast('🏆', t('toast.bounty_claim_title'), 'big', t('toast.bounty_claim_desc'), { tab: 'match', key: 'bounty_claim', prio: mineClaim ? 'jackpot' : 'minor' });
      // J2: тряска и полная громкость только тому, кто забрал награду.
      if (mineClaim) {
        sfx.bountyClaimed();
        addShakeClass('large');
        fxFlashScreen([255, 210, 120], 0.9);
        comboBump();
      } else {
        sfx.bountyAssigned(0.4);
      }
      continue;
    }

    if (kind === 5) {
      if (!need(2 + 1 + 2 + 2 + 4)) return null;
      const id = dv.getUint16(o, true);
      o += 2;
      const type = dv.getUint8(o);
      o += 1;
      const x = dv.getUint16(o, true);
      o += 2;
      const y = dv.getUint16(o, true);
      o += 2;
      const expires = dv.getUint32(o, true);
      o += 4;
      powerUps.set(id, { id, type, x, y, expires });
      continue;
    }

    if (kind === 6) {
      if (!need(2 + 2 + 1 + 2 + 2)) return null;
      const pid = dv.getUint16(o, true);
      o += 2;
      const id = dv.getUint16(o, true);
      o += 2;
      const type = dv.getUint8(o);
      o += 1;
      const ex = dv.getUint16(o, true);
      o += 2;
      const ey = dv.getUint16(o, true);
      o += 2;
      powerUps.delete(id);
      const pn = displayNameOf(pid);
      pushEventFeed(`${pn} ${t('event.picked')}: ${powerupLabel(type)}`, 'Pickup', pid);

      if (pid === you) {
        if (type === 1) youShield = true;
        if (type === 2) {
          youSpeedUntilTick = lastEventsTick + 45;
          youSpeedType = 2;
        }
        if (type === 4) {
          youSpeedUntilTick = lastEventsTick + 95;
          youSpeedType = 4;
        }
        addFxBurst(ex, ey, type === 2 ? 'pickup2' : type === 4 ? 'pickup4' : 'pickup');
        if (type === 2 || type === 4) sfx.speedOn();
        else sfx.pickup();
        addShakeClass('micro', ...shakeDirFrom(ex, ey));
        comboBump();
      }
      continue;
    }

    if (kind === 9) {
      if (!need(2 + 1 + 2 + 2)) return null;
      const pid = dv.getUint16(o, true);
      o += 2;
      const type = dv.getUint8(o);
      o += 1;
      const ex = dv.getUint16(o, true);
      o += 2;
      const ey = dv.getUint16(o, true);
      o += 2;
      const pn = displayNameOf(pid);
      pushEventFeed(`${pn} ${t('event.used')}: ${powerupLabel(type)}`, 'Use', pid);

      if (pid === you) {
        if (type === 1) youShield = false;
        addFxBurst(ex, ey, 'use');
        addToast(type === 3 ? '💥' : '🛡', `${t('toast.powerup_used')}: ${powerupLabel(type)}`, null, infoDesc(infoPack().powerups, type, ''));
        if (type === 3) {
          sfx.explode();
          fxFlashScreen([255, 150, 90], 0.8);
        } else {
          sfx.powerUsed();
        }
        addShakeClass('medium', ...shakeDirFrom(ex, ey));
      }
      continue;
    }

    if (kind === 7) {
      if (!need(1 + 4)) return null;
      const type = dv.getUint8(o);
      o += 1;
      const until = dv.getUint32(o, true);
      o += 4;
      mutatorType = type;
      mutatorUntil = until;
      const mn = mutatorLabel(type);
      if (mn) pushEventFeed(`${t('event.round')}: ${mn}`, 'Round');

      if (mn) addToast('⚡', `${infoPack().labels.round}: ${mn}`, 'big', infoDesc(infoPack().mutators, type, ''), { key: `mutator_${type}`, prio: 'important' });
      // J2: глобальное событие — 40% громкости.
      sfx.mutatorOn(0.4);
      continue;
    }

    if (kind === 8) {
      if (!need(1)) return null;
      const type = dv.getUint8(o);
      o += 1;
      if (mutatorType === type) {
        mutatorType = 0;
        mutatorUntil = 0;
      }

      addToast('✓', infoPack().labels.roundEnded, 'big');
      sfx.mutatorOff(0.4);
      continue;
    }

    // Сервер для неизвестного типа события пишет ровно один байт-заглушку
    // (см. default в buildEventsPooledLocked). Пропускаем его и продолжаем
    // разбор: иначе старый закешированный клиент терял бы весь остаток
    // пакета после первого же нового типа события — этот баг в проекте уже
    // случался дважды и молча ломал киллфид, тосты и обновления заданий.
    // C10: при рассинхроне версий это десятки предупреждений на тик —
    // логируем один раз на тип события.
    if (!unknownEventKindSeen.has(kind)) {
      unknownEventKindSeen.add(kind);
      try {
        console.warn('unknown event kind', kind);
      } catch {}
    }
    if (!need(1)) break;
    o += 1;
    continue;
  }

  // K7: renderKillfeed() звался 13 раз внутри цикла разбора событий (замер:
  // 784 мутации DOM за 115 с). Один пакет — одна перерисовка в конце.
  if (killfeedDirty) {
    killfeedDirty = false;
    renderKillfeed();
  }
  renderMetaHud();
  renderTopHud();
  return { offset: o, lastEventsTick, lastEventsAt, mutatorType, mutatorUntil, bountyTarget, bountyUntil, powerUps, youKills, youStreak, youShield, youSpeedUntilTick, youSpeedType, matchStyleEarned, styleToastAcc, styleToastReason, styleToastCount, styleToastTimer, youContractType, youContractGoal, youContractProgress, youContractUntil, killfeedDirty, lastDeathInfo };
}

// JSON-сообщение type === 'cosmetics': применение серверного снимка косметики
// игрока (инвентарь, титулы, прогресс ачивок, стиль). Перенесена ЦЕЛИКОМ как
// есть из onCosmetics() в client.js, порядок вызовов и побочные эффекты не
// менялись.
//
// Как и handleEventsMessage(), эта функция и читает, и переприсваивает
// module-level let-переменные client.js (youStyle, cosmeticsLoaded,
// cosmeticsSource, youTitleMask, youTitleId) — их читают другие части
// client.js (рендер HUD, магазин). Присваивание внутри функции меняет только
// ЛОКАЛЬНУЮ копию, поэтому контракт тот же: ctx передаёт НАЧАЛЬНЫЕ значения,
// функция возвращает объект с итоговыми значениями — вызывающий код в
// client.js обязан переприсвоить свои module-level let из этого объекта.
//
// ctx — явные зависимости из client.js:
//   значения для обратной записи: youStyle, cosmeticsLoaded, cosmeticsSource, youTitleMask, youTitleId
//   объекты, мутируемые на месте (ссылка не переприсваивается): youCos, achvProgressById
//   функции/константы только на чтение:
//     applyCosPayload, COS_TITLE_MAX, cosmeticsCacheSave, pendingCosmeticsOp,
//     cosmeticsOpClear, COSMETICS_MAX_ID, t, cosmeticsLabel, cosmeticsVariantName,
//     setCosmeticsStatus, addToast, playBeep, cosmeticsOpen,
//     cosmeticsApplyDesiredServer, syncCosmeticsUi, renderMetaHud, renderMenuSkinPreview
export function handleCosmeticsMessage(msg, ctx) {
  const { youCos, achvProgressById, applyCosPayload, COS_TITLE_MAX, cosmeticsCacheSave, pendingCosmeticsOp, cosmeticsOpClear, COSMETICS_MAX_ID, t, cosmeticsLabel, cosmeticsVariantName, setCosmeticsStatus, addToast, playBeep, cosmeticsOpen, cosmeticsApplyDesiredServer, syncCosmeticsUi, renderMetaHud, renderMenuSkinPreview } = ctx;
  let youStyle = ctx.youStyle;
  let cosmeticsLoaded = ctx.cosmeticsLoaded;
  let cosmeticsSource = ctx.cosmeticsSource;
  let youTitleMask = ctx.youTitleMask;
  let youTitleId = ctx.youTitleId;

  // C4: remember the previous inventory so we can detect what was just bought.
  const prevInv = {
    capturefx: Number(youCos.inv.capturefx) || 0,
    head: Number(youCos.inv.head) || 0,
    seg: Number(youCos.inv.seg) || 0,
    nameplate: Number(youCos.inv.nameplate) || 0,
    frame: Number(youCos.inv.frame) || 0,
    terr: Number(youCos.inv.terr) || 0,
    death: Number(youCos.inv.death) || 0
  };
  const hadServerState = cosmeticsSource === 'server';

  const st = Number(msg?.style);
  if (Number.isFinite(st)) youStyle = Math.max(0, st);

  cosmeticsLoaded = true;
  cosmeticsSource = 'server';

  // Полный снимок: категории, которых в сообщении нет, обнуляются.
  applyCosPayload(youCos, msg, 'replace');


  // Новые категории и титулы: сервер может их ещё не присылать. В этом случае
  // поля undefined -> нули, магазин показывает только базовый вариант, а
  // «Титулы» честно сообщают, что список пока недоступен.
  // Частичное сообщение: трогаем только присланное.
  applyCosPayload(youCos, msg, 'patch');
  if (msg?.titleMask !== undefined) youTitleMask = Number(msg.titleMask) || 0;
  if (msg?.titleId !== undefined) youTitleId = Math.max(0, Math.min(COS_TITLE_MAX, Number(msg.titleId) || 0));
  /* C3: прогресс по незакрытым ачивкам. Массив содержит ТОЛЬКО закрытые ещё
     ачивки — открытые сервер опускает, они и так видны по titleMask. Поле
     может отсутствовать (старый сервер) — тогда карту не трогаем вовсе,
     чтобы не стереть уже показанный прогресс. */
  if (Array.isArray(msg?.achvProgress)) {
    achvProgressById.clear();
    for (const it of msg.achvProgress) {
      const id = Number(it?.id);
      const cur = Number(it?.cur);
      const max = Number(it?.max);
      if (!Number.isFinite(id) || id < 0) continue;
      if (!Number.isFinite(max) || max <= 0) continue;
      achvProgressById.set(id, {
        cur: Math.max(0, Math.min(max, Number.isFinite(cur) ? cur : 0)),
        max,
      });
    }
  }
  // Базовый вариант всегда доступен — иначе магазин выглядит полностью пустым.
  youCos.inv.terr |= 1;
  youCos.inv.death |= 1;

  cosmeticsCacheSave();

  // C4: report the purchase that just landed.
  const pending = pendingCosmeticsOp;
  cosmeticsOpClear();

  if (hadServerState) {
    const nextInv = {
      capturefx: Number(youCos.inv.capturefx) || 0,
      head: Number(youCos.inv.head) || 0,
      seg: Number(youCos.inv.seg) || 0,
      nameplate: Number(youCos.inv.nameplate) || 0,
      frame: Number(youCos.inv.frame) || 0,
      terr: Number(youCos.inv.terr) || 0,
      death: Number(youCos.inv.death) || 0
    };
    let boughtCat = '';
    let boughtId = -1;
    for (const cat of Object.keys(nextInv)) {
      const added = nextInv[cat] & ~prevInv[cat];
      if (!added) continue;
      for (let id = 0; id <= COSMETICS_MAX_ID; id++) {
        if (added & (1 << id)) {
          boughtCat = cat;
          boughtId = id;
          break;
        }
      }
      if (boughtCat) break;
    }
    if (!boughtCat && pending) {
      // Server confirmed but nothing new appeared (already owned).
      boughtCat = '';
    }
    if (boughtCat) {
      const bc = boughtCat;
      const bi = boughtId;
      const boughtText = () => `${t('cosmetics.bought_prefix')}: ${cosmeticsLabel(bc)} — ${cosmeticsVariantName(bc, bi)}`;
      setCosmeticsStatus(boughtText, 'success');
      addToast('✨', boughtText(), null);
      playBeep(880, 150, 0.9);
    } else if (pending) {
      setCosmeticsStatus('', '');
    }
  } else if (cosmeticsOpen) {
    // Магазин был открыт ещё без серверного подтверждения (см. showCosmeticsOverlay)
    // и статус-строка застыла на «не подтверждено» — теперь оно пришло, гасим подсказку.
    setCosmeticsStatus('', '');
  }

  cosmeticsApplyDesiredServer();

  syncCosmeticsUi();

  renderMetaHud();
  // C3: инвентарь/экипировка обновились — перерисовываем «Ваш облик».
  try {
    renderMenuSkinPreview();
  } catch {}

  return { youStyle, cosmeticsLoaded, cosmeticsSource, youTitleMask, youTitleId };
}
