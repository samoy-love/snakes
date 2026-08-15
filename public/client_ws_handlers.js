/* Разбор входящих сообщений сервера: бинарные пакеты кадра и JSON-сообщения
   состояния комнаты, косметики и ошибок.

   Отдельный модуль, потому что это самая длинная и самая «сырая» часть
   клиента: побайтовый разбор буфера рядом с отрисовкой и HUD читался как
   каша, а любая правка формата задевала половину файла. Здесь только разбор
   и запись в общий стор — кто и когда зовёт эти функции, решает диспетчер
   в client_net_bind.js.

   Бинарные обработчики разбирают ровно один msgType и возвращают новый
   offset (курсор буфера): по ссылке примитив не передать, поэтому диспетчер
   переприсваивает свой курсор из результата. Ничего другого наружу они не
   возвращают — состояние правится прямо в client_store.js. */

import { dom } from './client_dom.js';
import { clientState } from './client_state.js';
import { PHASE_FINAL, cos, match, me, rooms, session, styleToast, ui, world } from './client_store.js';
import { gridCellIsCooling, gridCellOwner } from './client_grid.js';
import { minimapOwnerRgbCache } from './client_minimap_ui.js';
import { sortPlayersByScore } from './client_stats.js';
import { lerp } from './client_util.js';

// msgType === 2: ROI-обновление (players, rx/ry/rw/rh, dg, dt).
// ctx — вызовы наружу и справочники, которые нельзя импортировать без кольца:
//   PLAYER_RECORD_SIZES, pickPlayerRecordSize — client_protocol.js
//   hueToHsl                                  — client_color.js
//   botIds                                    — множество id ботов
//   DIR_NAMES                                 — названия направлений
//   displayNameOf, botDisplayName, t          — имена игроков и перевод
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

/* msgType === 4: куски миникарты (tick, cw, ch, count, flags, chunks...).
   Возвращает null, если буфера не хватило — диспетчер обязан прервать разбор;
   иначе { offset } с курсором после разобранного. */
export function handleMinimapMessage(dv, offset, ctx) {
  const { setMinimapPixel } = ctx;
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
      const i = (y0 + yy) * session.W + (x0 + xx);
      if (i >= 0 && i < session.N && world.minimapGridOwner) world.minimapGridOwner[i] = v;
    }
    if (hasTrail) {
      for (let n = 0; n < chunkCells; n++) {
        o += 2;
      }
    }

    // update pixels for this chunk only
    for (let yy = 0; yy < ch; yy++) {
      const row = (y0 + yy) * session.W + x0;
      for (let xx = 0; xx < cw; xx++) {
        const i = row + xx;
        if (i >= 0 && i < session.N) {
          setMinimapPixel(i, {
            minimapImage: world.minimapImage,
            minimapGridOwner: world.minimapGridOwner,
            you: session.you,
            colors: world.colors,
            minimapOwnerRgbCache,
            gridCellOwner,
            gridCellIsCooling
          });
        }
      }
    }
  }
  // Пришедшие куски — повод перерисовать карту в ближайшем кадре.
  world.minimapHadChunkUpdate = true;
  return { offset: o };
}

/* Пакет игровых событий за тик: убийства, захваты, бонусы, контракты,
   ежедневки, ачивки, начисления Стиля, модификаторы раунда.

   Раньше функция принимала 22 значения изменяемого состояния и возвращала их
   обратно вместе с новым смещением буфера — список приходилось держать
   синхронным в трёх местах (ctx, прологовые `let`, return). Теперь она пишет
   в общий стор, и наружу отдаётся только курсор буфера.

   В ctx остались вызовы наружу: перевод, эффекты, звук и перерисовка. */
export function handleEventsMessage(dv, offset, ctx) {
  const {
    CAPTURE_JACKPOT_CELLS,
    COS_DEATH_MS,
    FEED_FOREIGN_CAPTURE_MIN,
    RECLAIM_WINDOW_MS,
    achvLabel,
    addFxBurst,
    addScorePopup,
    addShakeClass,
    addToast,
    approxNowTick,
    bumpMatchTabBadge,
    celebrateFirstCapture,
    comboBreak,
    comboBump,
    contractLabel,
    cosCaptureFxByPlayer,
    cosClampId,
    dailyLabel,
    dailySetAssign,
    dailySetProgress,
    deathReasonLabel,
    displayNameOf,
    flushStyleToast,
    fmtInt,
    fxFlashScreen,
    infoDesc,
    infoPack,
    mutatorLabel,
    obFireEvent,
    powerupLabel,
    pushEventFeed,
    renderKillfeed,
    renderMetaHud,
    renderTopHud,
    setYouStyle,
    sfx,
    shakeDirFrom,
    showBigBanner,
    styleLabel,
    t,
    triggerHitstop,
    unknownEventKindSeen,
    vibrate
  } = ctx;
  const bl = dv.byteLength;
  let o = offset;

  const need = (n) => o+n <= bl;
  if (!need(4 + 1 + 4 + 2 + 4 + 1)) return null;
  const tick = dv.getUint32(o, true);
  o += 4;

  match.lastEventsTick = tick;
  match.lastEventsAt = Date.now();

  match.mutatorType = dv.getUint8(o);
  o += 1;
  match.mutatorUntil = dv.getUint32(o, true);
  o += 4;

  match.bountyTarget = dv.getUint16(o, true);
  o += 2;
  match.bountyUntil = dv.getUint32(o, true);
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
  match.powerUps = nextPU;

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

      if (victim === session.you) {
        me.lastDeathInfo = { killer, killerName: kn, reason };
      }

      const rs = deathReasonLabel(reason);
      // Эффект гибели жертвы — его видят все, а не только убийца.
      // Стиль берём из cosExtra; без сообщения это базовая вспышка (0).
      addFxBurst(ex, ey, `die${cosClampId(cos.deathByPlayer.get(victim) || 0)}`, {
        pid: victim,
        life: COS_DEATH_MS
      });

      if (killer) pushEventFeed(`${kn} -> ${vn}${rs ? ` (${rs})` : ''}`, 'Kill', killer);
      else pushEventFeed(`${vn} ${t('feed.died')}${rs ? ` (${rs})` : ''}`, 'Death', victim);

      if (killer && killer === session.you) {
        me.kills++;
        addFxBurst(ex, ey, 'kill');
        addShakeClass('medium', ...shakeDirFrom(ex, ey));
        sfx.kill();
        fxFlashScreen([255, 96, 96], 0.75);
        comboBump();
        vibrate(35);
        // K5: первое убийство — открываем контракты.
        obFireEvent('kill');
      }
      if (victim === session.you) {
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
      if (pid === session.you || delta >= FEED_FOREIGN_CAPTURE_MIN) {
        pushEventFeed(
          `${pn} ${t('feed.captured')} +${delta} ${t('feed.zone')}`,
          'Capture',
          pid
        );
      }
      addFxBurst(ex, ey, `cap${cosClampId(fxId)}`, { pid });
      if (pid === session.you) {
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
      if (pid === session.you || cells >= FEED_FOREIGN_CAPTURE_MIN) {
        pushEventFeed(`${pn} ${t('feed.reclaimed')} +${cells}`, 'Reclaim', pid);
      }
      addFxBurst(ex, ey, `cap${cosClampId(cosCaptureFxByPlayer(pid))}`, { pid });
      if (pid === session.you && cells > 0) {
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
      world.coolDeadlineByOwner.delete(pid);
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
        const remMs = nt != null && session.tickMs ? Math.max(0, (untilTick - nt) * session.tickMs) : RECLAIM_WINDOW_MS;
        world.coolDeadlineByOwner.set(pid, performance.now() + Math.min(RECLAIM_WINDOW_MS * 1.5, remMs));
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
      if (pid === session.you) {
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
      if (pid === session.you) {
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
      if (pid === session.you) {
        bumpMatchTabBadge();
        // C7: тост называет конкретное задание и различает слоты.
        const doneIt = me.dailies.get(Number(slot) || 0);
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
      if (pid === session.you) {
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
      if (pid === session.you) {
        me.contractType = type;
        me.contractGoal = goal;
        me.contractProgress = 0;
        me.contractUntil = until;
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
      if (pid === session.you) {
        me.contractType = type;
        me.contractProgress = prog;
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
      if (pid === session.you) {
        me.contractProgress = me.contractGoal;
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
      if (pid === session.you) {
        pushEventFeed(`+${delta} ${t('cosmetics.style_points')} (${styleLabel(reason)})`, 'Style');
        if (delta > 0) match.styleEarned += delta;
        setYouStyle(total);
        bumpMatchTabBadge();
        if (delta >= 20) {
          if (styleToast.timer) {
            try {
              clearTimeout(styleToast.timer);
            } catch {}
            styleToast.timer = 0;
            styleToast.acc = 0;
            styleToast.reason = 0;
            styleToast.count = 0;
          }
          addToast('✨', `+${delta} ${t('cosmetics.style_points')}`, 'big', styleLabel(reason), { tab: 'match', key: `style_${reason}_${delta}` });
        } else if (delta > 0) {
          if (styleToast.acc && styleToast.reason && styleToast.reason !== reason) {
            flushStyleToast();
          }
          styleToast.acc += delta;
          styleToast.reason = reason;
          styleToast.count++;
          if (!styleToast.timer) {
            /* Окно накопления 3 с, а не 650 мс: при захвате за захватом
               тост «+1 стиль» вылезал каждую секунду и превращался в шум.
               Одна карточка «+N стиль ×K» на серию — читается, не мешает. */
            styleToast.timer = setTimeout(flushStyleToast, 3000);
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
      if (killer === session.you) {
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
      if (pid === session.you) {
        me.streak = streak;
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
      match.bountyTarget = target;
      match.bountyUntil = until;
      const tn = displayNameOf(target);
      pushEventFeed(`${t('event.bounty')}: ${tn}`, 'Bounty');

      bumpMatchTabBadge();
      addToast('🎯', `${infoPack().labels.bounty}: ${tn}`, 'big', t('toast.bounty_desc'), { tab: 'match', key: `bounty_${target}`, prio: target === session.you ? 'jackpot' : 'important' });
      // J2/J3: назначение баунти — глобальное событие. Полная громкость только
      // если цель — ты, иначе 40%.
      sfx.bountyAssigned(target === session.you ? 1 : 0.4);
      if (target === session.you) fxFlashScreen([255, 140, 90], 0.7);
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
      const mineClaim = killer === session.you;
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
      match.powerUps.set(id, { id, type, x, y, expires });
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
      match.powerUps.delete(id);
      const pn = displayNameOf(pid);
      pushEventFeed(`${pn} ${t('event.picked')}: ${powerupLabel(type)}`, 'Pickup', pid);

      if (pid === session.you) {
        if (type === 1) me.shield = true;
        if (type === 2) {
          me.speedUntilTick = match.lastEventsTick + 45;
          me.speedType = 2;
        }
        if (type === 4) {
          me.speedUntilTick = match.lastEventsTick + 95;
          me.speedType = 4;
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

      if (pid === session.you) {
        if (type === 1) me.shield = false;
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
      match.mutatorType = type;
      match.mutatorUntil = until;
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
      if (match.mutatorType === type) {
        match.mutatorType = 0;
        match.mutatorUntil = 0;
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
  if (ui.killfeedDirty) {
    ui.killfeedDirty = false;
    renderKillfeed();
  }
  renderMetaHud();
  renderTopHud();
  return { offset: o };
}

/* JSON-сообщение type === 'cosmetics': кошелёк, инвентарь, титулы, прогресс
   ачивок и надетый стиль. Порядок вызовов и побочные эффекты те же, что были
   у onCosmetics() до выноса.

   Раньше функция возвращала пять полей (баланс, признак загрузки, источник,
   маску и надетый титул), которые вызывающий раскладывал обратно по плоским
   let: присваивание внутри меняло только ЛОКАЛЬНУЮ копию. Теперь она пишет
   прямо в cos — ни списка значений на вход, ни возврата.

   В ctx остались только вызовы наружу и объект youCos, который мутируется
   на месте (ссылка не переприсваивается). */
export function handleCosmeticsMessage(msg, ctx) {
  const {
    COSMETICS_MAX_ID,
    COS_TITLE_MAX,
    addToast,
    applyCosPayload,
    cosmeticsApplyDesiredServer,
    cosmeticsCacheSave,
    cosmeticsLabel,
    cosmeticsOpClear,
    cosmeticsVariantName,
    playBeep,
    renderMenuSkinPreview,
    renderMetaHud,
    setCosmeticsStatus,
    syncCosmeticsUi,
    t,
    youCos
  } = ctx;

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
  const hadServerState = cos.source === 'server';

  const st = Number(msg?.style);
  if (Number.isFinite(st)) cos.style = Math.max(0, st);

  cos.loaded = true;
  cos.source = 'server';

  // Полный снимок: категории, которых в сообщении нет, обнуляются.
  applyCosPayload(youCos, msg, 'replace');


  // Новые категории и титулы: сервер может их ещё не присылать. В этом случае
  // поля undefined -> нули, магазин показывает только базовый вариант, а
  // «Титулы» честно сообщают, что список пока недоступен.
  // Частичное сообщение: трогаем только присланное.
  applyCosPayload(youCos, msg, 'patch');
  if (msg?.titleMask !== undefined) cos.titleMask = Number(msg.titleMask) || 0;
  if (msg?.titleId !== undefined) cos.titleId = Math.max(0, Math.min(COS_TITLE_MAX, Number(msg.titleId) || 0));
  /* C3: прогресс по незакрытым ачивкам. Массив содержит ТОЛЬКО закрытые ещё
     ачивки — открытые сервер опускает, они и так видны по titleMask. Поле
     может отсутствовать (старый сервер) — тогда карту не трогаем вовсе,
     чтобы не стереть уже показанный прогресс. */
  if (Array.isArray(msg?.achvProgress)) {
    cos.achvProgressById.clear();
    for (const it of msg.achvProgress) {
      const id = Number(it?.id);
      const cur = Number(it?.cur);
      const max = Number(it?.max);
      if (!Number.isFinite(id) || id < 0) continue;
      if (!Number.isFinite(max) || max <= 0) continue;
      cos.achvProgressById.set(id, {
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
  const pending = cos.pendingOp;
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
  } else if (cos.open) {
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
}

/* JSON-сообщение type === 'error'. Гасит форму создания комнаты, показывает
   игроку понятную причину и разруливает неудавшийся возврат в комнату. */
export function onError(d, ctx) {
  const {
    setRoomsCreateOpen,
    updateRoomsCreateUi,
    t,
    roomsCreateNameInput,
    rejoinGiveUp,
    cosmeticsOpClear,
    setCosmeticsStatus,
    syncCosmeticsUi,
    addToast
  } = ctx;
  const code = String(d?.message || '').trim();
  rooms.createPending = false;
  updateRoomsCreateUi();

  if (code === 'room_title_invalid') {
    setRoomsCreateOpen(true);
    updateRoomsCreateUi(t('rooms.invalid_title'));
    try {
      roomsCreateNameInput?.focus();
    } catch {}
    return;
  }

  const msgFor = () =>
    code === 'room_full'
      ? t('rooms.full')
      : code === 'room_not_found'
        ? t('rooms.not_found')
        : code === 'cosmetics_invalid_id'
          ? t('cosmetics.err_invalid_id')
          : code === 'cosmetics_invalid_cat'
            ? t('cosmetics.err_invalid_cat')
            : code === 'cosmetics_not_owned'
              ? t('cosmetics.err_not_owned')
              : code === 'cosmetics_not_enough_style'
                ? t('cosmetics.err_not_enough_style')
                : code === 'cosmetics_unavailable'
                  ? t('cosmetics.err_unavailable')
        : t('common.error');
  const msg = msgFor();

  // K7: если не удалось вернуться в свою комнату после обрыва — комнаты уже
  // нет или она заполнилась. Тогда честно отправляем в меню.
  // C9: любая ошибка во время ожидания возврата — повод честно уйти в меню,
  // а не только room_not_found / room_full.
  if (session.rejoinPending) {
    rejoinGiveUp(msg);
    return;
  }

  // C1/C4: shop errors must land inside the overlay — toasts are hidden while it is open.
  if (code.startsWith('cosmetics_')) {
    cosmeticsOpClear();
    if (cos.open) {
      setCosmeticsStatus(msgFor, 'error');
      syncCosmeticsUi();
    return;
    }
  }

  addToast('⚠', msg, null);
    return;
}

/* JSON-сообщение type === 'state' — снапшот состояния комнаты: сетка, следы,
   игроки. НЕ путать с бинарным разбором кадра (msgType-диспетчер).

   Раньше функция принимала 13 значений изменяемого состояния и возвращала их
   обратно объектом, который вызывающий раскладывал по плоским let. Теперь
   и она, и остальные модули пишут в один и тот же стор, поэтому ни того,
   ни другого списка больше нет.

   В ctx остались только вызовы наружу — то, что делают другие модули:
   применение дельт, перерисовка и реакция на смерть. */
export function onState(s, ctx) {
  const {
    ownerFillStyleCache,
    refreshCaptureAnchors,
    markCoolSeen,
    fillDelayFor,
    applyPackedDeltaGridWithAnim,
    applyPackedDelta,
    renderChat,
    refreshOwnGeometry,
    hideOverlays,
    beginDeathZoom,
    beginDeathSlowMo
  } = ctx;

  clientState.lastState = s;

  // K1: прямоугольник ROI приходил и молча выбрасывался. Он — единственный
  // источник правды о том, какая часть сетки вообще свежая.
  const r = s?.roi;
  if (r && Number(r.rw) > 0 && Number(r.rh) > 0) {
    world.lastRoi = {
      rx: Math.max(0, Number(r.rx) || 0),
      ry: Math.max(0, Number(r.ry) || 0),
      rw: Number(r.rw) || 0,
      rh: Number(r.rh) || 0
    };
  } else if (s?.full) {
    // Полный снапшот освежает всю карту — тумана в этом кадре нет.
    world.lastRoi = null;
  }

  const now = performance.now();

  // J15: якоря должны быть готовы до применения дельты сетки — именно в этом
  // снапшоте голова стоит там, где петля замкнулась.
  refreshCaptureAnchors(s.players);

  if (s.full) {
    const prev = world.gridOwner;
    world.gridOwner = new Uint16Array(s.grid);
    world.trailOwner = new Uint16Array(s.trail);
    const len = world.gridOwner.length;
    if (!world.gridFillAt || world.gridFillAt.length !== len) world.gridFillAt = new Float32Array(len);
    if (!world.coolSeenAt || world.coolSeenAt.length !== len) world.coolSeenAt = new Float32Array(len);
    if (prev && prev.length === len) {
      for (let i = 0; i < len; i++) {
        const n = world.gridOwner[i];
        if (prev[i] !== n) markCoolSeen(i, n, now);
        if (n !== 0 && !gridCellIsCooling(n) && prev[i] !== n) {
          world.gridFillAt[i] = now + fillDelayFor(i, n);
        }
      }
    } else {
      for (let i = 0; i < len; i++) markCoolSeen(i, world.gridOwner[i], now);
    }
  } else {
    applyPackedDeltaGridWithAnim(s.dg, now);
    applyPackedDelta(world.trailOwner, s.dt);
  }

  // Миникарта обновляется отдельными chunk-сообщениями сервера.

  const tmpPlayers = world.prevPlayers;
  world.prevPlayers = world.currPlayers;
  world.currPlayers = tmpPlayers;
  world.currPlayers.clear();

  let nameChanged = false;
  for (const p of s.players) {
    world.currPlayers.set(p.n, p);
    /* K2: номера игроков переиспользуются (аллокатор отдаёт первый свободный,
       боты пересоздаются при каждом входе/выходе человека). Кэш «номер →
       цвет» раньше писался один раз и никогда не обновлялся: номер 7
       оставался красным даже после того, как его получил новый синий бот.
       Сравниваем цвет каждый кадр и сбрасываем зависимые кэши при
       расхождении. */
    if (world.colors.get(p.n) !== p.c) {
      world.colors.set(p.n, p.c);
      ownerFillStyleCache.delete(p.n);
      minimapOwnerRgbCache.delete(p.n);
      world.minimapDirty = true;
    }
    if (p.nm && world.nameById.get(p.n) !== p.nm) {
      world.nameById.set(p.n, p.nm);
      nameChanged = true;
    }
  }

  if (nameChanged && clientState.chatMessages.length) renderChat();

  world.headIndexByOwner.clear();
  for (const p of s.players) {
    world.headIndexByOwner.set(p.n, p.y * session.W + p.x);
  }

  world.lastPacketAt = performance.now();

  if (clientState.lastStateAt != null) {
    const dt = world.lastPacketAt - clientState.lastStateAt;
    if (dt > 0) world.tickrate = lerp(world.tickrate || 0, 1000 / dt, 0.15);
  }
  clientState.lastStateAt = world.lastPacketAt;

  try {
    refreshOwnGeometry(false);
  } catch {}

  const mine = s.players?.find((p) => p.n === session.you);
  if (!mine) return;

  const alive = !!mine.a;
  if (alive) {
    const ordered = sortPlayersByScore(s.players);
    const idx = ordered.findIndex((p) => p.n === session.you);
    const cells = Number(mine?.s) || 0;
    const pct = session.mapCells ? (cells / session.mapCells) * 100 : 0;
    const points = Number(mine?.p) || 0;
    const place = idx >= 0 ? `${idx + 1}/${ordered.length}` : '—';
    me.lastStats = { cells, pct, points, place };
  }

  if (alive && !session.youAlive) {
    session.youAlive = true;
    session.lastDirSent = null;
    hideOverlays();
  } else if (!alive && session.youAlive) {
    session.youAlive = false;
    session.lastDirSent = null;
    me.streak = 0;
    /* Драматический наезд камеры на голову в точке гибели — до того, как
       сервер уберёт игрока из состояния и координаты станут недоступны. */
    beginDeathZoom((Number(mine.x) || 0) + 0.5, (Number(mine.y) || 0) + 0.5);
    /* Момент смерти стоит увидеть: модалка мгновенно накрывала кадр, в
       котором игрока убили. Держим паузу, пока идёт hitstop + вспышка. */
    beginDeathSlowMo();
  }
}

/* Первое сообщение инициализации от сервера (размеры поля, начальная
   косметика, id игрока и т.п.). Всё, что тело переприсваивает, живёт в
   client_store.js и правится на месте; в ctx остались только вызовы наружу. */
export function onInit(msg, ctx) {
  const {
    markJoinFunnelInit,
    rejoinFinish,
    addToast,
    t,
    applyMatchPhase,
    resetClientForNewMatch,
    hideMatchOverlay,
    showMatchOverlay,
    renderMatchResults,
    updateMatchCountdown,
    setRoomsCreateOpen,
    updateRoomsCreateUi,
    hideMenuOverlay,
    hideOverlays,
    syncMenuOnboardingUi,
    obResetMatch,
    obAnnounceShop,
    ownerFillStyleCache,
    botArchByPlayer,
    wsSend,
    onCosmetics,
    renderTopHud
  } = ctx;

  markJoinFunnelInit();
  session.W = msg.w;
  session.H = msg.h;
  session.N = session.W * session.H;
  session.tickMs = msg.tickMs;
  if (typeof msg?.tick === 'number' && Number.isFinite(msg.tick)) {
    match.lastEventsTick = msg.tick;
    match.lastEventsAt = Date.now();
  }
  session.you = Number(msg.you) || 0;
  session.mapCells = msg.mapCells || session.N;
  session.roomId = msg.room ?? null;
  session.roomLimit = msg.roomLimit ?? null;

  // K7: вход в комнату состоялся — цель реконнекта обновлена, флаг «ушёл сам» снят.
  session.rejoinRoomId = session.roomId;
  session.userLeftRoom = false;
  const wasRejoin = session.rejoinPending;
  if (wasRejoin) {
    rejoinFinish();
    addToast('✅', t('net.rejoined'), null, null, { key: 'net_reconnect' });
  }

  match.seq = Number(msg?.matchSeq) || 0;
  match.endTick = Number(msg?.matchEnd) || 0;
  match.ended = !!msg?.matchEnded;
  match.resetAt = Number(msg?.matchReset) || 0;
  // C2: фаза приходит прямо в init — при входе посреди матча баннер не нужен.
  match.phaseBannerSeq = Number(msg?.phase) === PHASE_FINAL ? match.seq : -1;
  applyMatchPhase(msg?.phase, msg?.phaseUntil, false, match.seq);

  match.continuePending = false;
  if (match.continueTimeout) {
    clearTimeout(match.continueTimeout);
    match.continueTimeout = 0;
  }
  if (match.ended) {
    if (msg?.matchResults) {
      match.lastResults = msg.matchResults;
      renderMatchResults(match.lastResults);
    }
    updateMatchCountdown();
    showMatchOverlay();
  } else {
    resetClientForNewMatch();
    hideMatchOverlay();
  }

  rooms.createPending = false;
  setRoomsCreateOpen(false);
  updateRoomsCreateUi();
  rooms.selectedId = null;

  hideMenuOverlay();
  hideOverlays();

  session.started = true;
  /* F13: раньше подсказка гасилась прямо здесь, ещё до того как игрок её
     прочитал. Теперь её снимает первое реальное действие (см. setDir). */
  syncMenuOnboardingUi();
  // C9: реконнект не считается новым входом в матч.
  obResetMatch(!wasRejoin);
  obAnnounceShop();
  try {
    document.body.classList.add('inGame');
  } catch {}

  world.gridOwner = new Uint16Array(session.N);
  world.trailOwner = new Uint16Array(session.N);
  world.minimapGridOwner = new Uint16Array(session.N);
  world.gridFillAt = new Float32Array(session.N);
  world.coolSeenAt = new Float32Array(session.N);

  /* K2: вход в комнату — новый набор номеров игроков. Всё, что кэшируется по
     номеру, обязано умереть здесь, иначе чужие цвета и «ботовость» приезжают
     из прошлой комнаты. C7: имена и косметика чистятся именно тут, а не на
     границе матча — см. комментарий в resetClientForNewMatch. */
  world.colors.clear();
  world.botIds.clear();
  world.nameById.clear();
  world.nameEnById.clear();
  world.captureAnchorByOwner.clear();
  world.coolDeadlineByOwner.clear();
  world.lastRoi = null;
  ownerFillStyleCache.clear();
  minimapOwnerRgbCache.clear();
  cos.terrByPlayer.clear();
  cos.deathByPlayer.clear();
  cos.titleByPlayer.clear();
  botArchByPlayer.clear();

  const mm = dom.minimap;
  const mmCtx = mm.getContext('2d');
  mm.width = session.W;
  mm.height = session.H;
  // Саму карту наполняют chunk-сообщения сервера.
  world.minimapImage = mmCtx.createImageData(session.W, session.H);
  mmCtx.imageSmoothingEnabled = true;
  mmCtx.imageSmoothingQuality = 'high';

  if (session.name) wsSend('setName', { name: session.name });
  /* Спавн в текущей комнате (без rejoin). Без этого игрок остаётся мёртвым и
     не может двигаться. */
  wsSend('respawn', {});

  me.kills = 0;
  me.streak = 0;

  if (msg?.cosmetics) onCosmetics(msg.cosmetics);
  renderTopHud();
}

