// Звуковой движок игры.
//
// Общая шина: голоса -> master(gain) -> DynamicsCompressor -> destination,
// поэтому аккорды и наложения не клиппируют. Параллельно master идёт
// возвратный тракт ревербератора: голос отправляет в него часть сигнала
// (`send`), и события перестают звучать «внутри головы» — у палитры
// появляется общее помещение.
//
// Импульсный отклик реверба, шум и волновая кривая перегруза считаются
// один раз при первом звуке и живут до конца сессии: генерация полутора
// секунд стереошума в момент гибели стоила бы кадра.
//
// Поверх примитивов работает лимитер: не более LIMIT_MAX «событий» за
// LIMIT_WINDOW_MS, лишнее уходит в очередь с приоритетом (высокий приоритет
// вытесняет низкий). Считаются именно события палитры, а не голоса: у
// одного удара их может быть четыре — щелчок, тело, суб и хвост.
export function createAudioModule() {
  let audioCtx = null;
  let master = null;
  let front = null;
  let reverbIn = null;
  let reverbFailed = false;
  let noiseBuf = null;
  let driveCurve = null;
  let getStateFn = null;

  const LIMIT_WINDOW_MS = 250;
  const LIMIT_MAX = 4;
  const QUEUE_STALE_MS = 400;
  const QUEUE_CAP = 12;

  const recent = [];
  const queue = [];
  let drainTimer = 0;
  // Глубина «одного события»: пока она больше нуля, примитивы играют мимо
  // лимитера — см. event().
  let inEvent = 0;

  function configure(fn) {
    getStateFn = typeof fn === 'function' ? fn : null;
  }

  function readState() {
    try {
      return typeof getStateFn === 'function' ? getStateFn() : null;
    } catch {
      return null;
    }
  }

  function ensureAudioCtx() {
    if (audioCtx) return audioCtx;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    } catch {
      return null;
    }
    return audioCtx;
  }

  function bus() {
    const ctx = ensureAudioCtx();
    if (!ctx) return null;
    try {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    } catch {}
    if (master) return master;
    try {
      // Две шины, а не одна: под крупным событием общая громкость проседает
      // (duck), но само это событие проседать не должно — иначе удар глушит
      // сам себя. Обычные голоса идут в master, крупные — в front, минуя
      // просадку; дальше оба сходятся в общий выход и компрессор.
      const outG = ctx.createGain();
      outG.gain.setValueAtTime(0.85, ctx.currentTime);
      try {
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.setValueAtTime(-16, ctx.currentTime);
        comp.knee.setValueAtTime(26, ctx.currentTime);
        comp.ratio.setValueAtTime(12, ctx.currentTime);
        comp.attack.setValueAtTime(0.003, ctx.currentTime);
        comp.release.setValueAtTime(0.22, ctx.currentTime);
        outG.connect(comp);
        comp.connect(ctx.destination);
      } catch {
        outG.connect(ctx.destination);
      }
      const duckG = ctx.createGain();
      duckG.gain.setValueAtTime(1, ctx.currentTime);
      duckG.connect(outG);
      front = outG;
      master = duckG;
    } catch {
      front = null;
      master = null;
    }
    return master;
  }

  // Шина без просадки: сюда идут голоса самого события, которое её вызвало.
  function busFront() {
    return bus() ? front : null;
  }

  function volumeScale() {
    const st = readState();
    if (!st?.soundEnabled) return 0;
    const v = Number(st?.soundVolume);
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(1, v));
  }

  function clampNum(v, lo, hi, dflt) {
    const n = Number(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.max(lo, Math.min(hi, n));
  }

  function ensureNoiseBuffer(ctx) {
    if (noiseBuf) return noiseBuf;
    try {
      const len = Math.max(1, Math.floor(ctx.sampleRate * 1.0));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      noiseBuf = buf;
    } catch {
      noiseBuf = null;
    }
    return noiseBuf;
  }

  /* Реверб: синтетический импульсный отклик — стереошум с экспоненциальным
     затуханием и коротким нарастанием, чтобы хвост не начинался щелчком.
     Каналы считаются независимо: одинаковый шум слева и справа схлопнул бы
     помещение в точку по центру. Возврат приглушён фильтром — яркий хвост
     на верхних наградах звенел бы поверх всего. */
  function ensureReverb(ctx) {
    if (reverbIn) return reverbIn;
    // Одной неудачи достаточно: без этого флага каждый посыл заново считал
    // бы полторы секунды стереошума — и браузер без свёртки терял бы кадры
    // именно там, где звуков больше всего.
    if (reverbFailed) return null;
    // Хвост всегда возвращается в шину без просадки: реверб смерти не должен
    // прижиматься её же собственным duck-ом.
    const out = busFront();
    if (!out) {
      reverbFailed = true;
      return null;
    }
    try {
      const len = Math.max(1, Math.floor(ctx.sampleRate * 1.5));
      const ir = ctx.createBuffer(2, len, ctx.sampleRate);
      const rise = Math.max(1, Math.floor(ctx.sampleRate * 0.006));
      for (let ch = 0; ch < 2; ch++) {
        const data = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          const decay = Math.pow(1 - i / len, 2.8);
          const attack = i < rise ? i / rise : 1;
          data[i] = (Math.random() * 2 - 1) * decay * attack;
        }
      }
      const input = ctx.createGain();
      input.gain.setValueAtTime(1, ctx.currentTime);
      const damp = ctx.createBiquadFilter();
      damp.type = 'lowpass';
      damp.frequency.setValueAtTime(3200, ctx.currentTime);
      const conv = ctx.createConvolver();
      conv.buffer = ir;
      const wet = ctx.createGain();
      wet.gain.setValueAtTime(0.9, ctx.currentTime);
      input.connect(damp);
      damp.connect(conv);
      conv.connect(wet);
      wet.connect(out);
      reverbIn = input;
    } catch {
      reverbIn = null;
      reverbFailed = true;
    }
    return reverbIn;
  }

  /* Мягкое насыщение: та же кривая на все голоса, amount меняет только
     подмешивание. Ниже 1 кривая почти линейна, выше — добавляет гармоник,
     из-за которых пила читается как удар, а не как гудок. */
  function ensureDriveCurve(ctx) {
    if (driveCurve) return driveCurve;
    try {
      const n = 1024;
      const curve = new Float32Array(n);
      const k = 24;
      for (let i = 0; i < n; i++) {
        const x = (i * 2) / n - 1;
        curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
      }
      driveCurve = curve;
    } catch {
      driveCurve = null;
    }
    return driveCurve;
  }

  // ——— лимитер / очередь с приоритетом ———

  function pruneRecent(now) {
    while (recent.length && now - recent[0] > LIMIT_WINDOW_MS) recent.shift();
  }

  function scheduleDrain() {
    if (drainTimer) return;
    const now = performance.now();
    pruneRecent(now);
    const waitMs = recent.length ? Math.max(16, LIMIT_WINDOW_MS - (now - recent[0]) + 4) : 16;
    drainTimer = setTimeout(() => {
      drainTimer = 0;
      drainQueue();
    }, waitMs);
  }

  function drainQueue() {
    const now = performance.now();
    pruneRecent(now);
    for (let i = queue.length - 1; i >= 0; i--) {
      if (now - queue[i].at > QUEUE_STALE_MS) queue.splice(i, 1);
    }
    while (queue.length && recent.length < LIMIT_MAX) {
      let best = 0;
      for (let i = 1; i < queue.length; i++) {
        if (queue[i].prio > queue[best].prio) best = i;
      }
      const item = queue.splice(best, 1)[0];
      recent.push(performance.now());
      try {
        item.run();
      } catch {}
    }
    if (queue.length) scheduleDrain();
  }

  /* Событие целиком: все его слои проходят лимитер как один звук.

     Без этого удар распадался. Убийство — это щелчок, тело и суб, три
     отдельных вызова примитивов, то есть три места в окне лимитера из
     четырёх; в перестрелке щелчок проходил сразу, а суб уезжал в очередь и
     догонял его через четверть секунды — вместо удара получались два
     разных звука. Внутри event() примитивы играют напрямую, поэтому слои
     либо звучат все вместе, либо не звучат вовсе. */
  function event(prio, run) {
    gate(prio, () => {
      inEvent++;
      try {
        run();
      } finally {
        inEvent--;
      }
    });
  }

  function gate(prio, run) {
    // Слой внутри уже пропущенного события: место в окне занято целым
    // событием, второй раз платить за него нельзя.
    if (inEvent > 0) {
      try {
        run();
      } catch (e) {
        try {
          console.error('audio_error', e);
        } catch {}
      }
      return;
    }
    if (volumeScale() <= 0) return;
    if (!bus()) return;
    const now = performance.now();
    pruneRecent(now);
    if (recent.length < LIMIT_MAX) {
      recent.push(now);
      try {
        run();
      } catch (e) {
        try {
          console.error('audio_error', e);
        } catch {}
      }
      return;
    }
    queue.push({ prio: Number(prio) || 0, at: now, run });
    if (queue.length > QUEUE_CAP) {
      let worst = 0;
      for (let i = 1; i < queue.length; i++) {
        if (queue[i].prio < queue[worst].prio) worst = i;
      }
      queue.splice(worst, 1);
    }
    scheduleDrain();
  }

  // ——— низкоуровневый голос (без лимитера) ———

  /* Один голос — один источник со своей огибающей. Всё, что сложнее
     (унисон, суб, слои удара), собирается из нескольких вызовов: так каждый
     слой сам отвечает за свою длительность и сам за собой убирает узлы.

     Тракт: источник -> [перегруз] -> огибающая -> [фильтр] -> [панорама] ->
     master, и параллельно -> посыл в реверб. */
  function voice(opts) {
    const ctx = ensureAudioCtx();
    const o = opts || {};
    // Голоса самого «крупного» события идут мимо просадки — см. bus().
    const out = o.front ? busFront() : bus();
    if (!ctx || !out) return;

    const type = typeof o.type === 'string' ? o.type : 'sine';
    const f0 = clampNum(o.freq, 20, 8000, 440);
    const f1 = o.freq2 == null ? null : clampNum(o.freq2, 20, 8000, f0);
    const dur = clampNum(o.dur, 10, 4000, 180) / 1000;
    const delay = clampNum(o.delay, 0, 4000, 0) / 1000;
    const vol = clampNum(o.vol, 0, 4, 1) * volumeScale();
    if (vol <= 0) return;
    const attack = clampNum(o.attack, 0.001, 1, 0.008);
    const decay = clampNum(o.decay, 0.005, 4, Math.max(0.03, dur * 0.85));
    const exp = o.exp !== false;
    const pan = clampNum(o.pan, -1, 1, 0);
    const send = clampNum(o.send, 0, 1, 0);
    const drive = clampNum(o.drive, 0, 1, 0);

    const nodes = [];
    let src = null;
    try {
      const t0 = ctx.currentTime + delay;
      const tPeak = t0 + attack;
      const tEnd = t0 + Math.max(attack + 0.01, dur);
      // Высота доезжает до freq2 за bend, а не за всю длительность: у удара
      // спад тона занимает первые миллисекунды, дальше тянется только тело.
      const tBend = o.bend == null ? tEnd : t0 + clampNum(o.bend, 5, 4000, 100) / 1000;

      const gain = ctx.createGain();
      nodes.push(gain);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), tPeak);
      gain.gain.exponentialRampToValueAtTime(0.0001, Math.max(tPeak + 0.01, t0 + decay));

      // Хвост тракта: фильтр -> панорама -> master + посыл в реверб.
      let tail = gain;
      const fo = o.filter;
      if (fo && typeof fo === 'object') {
        const filt = ctx.createBiquadFilter();
        nodes.push(filt);
        filt.type = typeof fo.type === 'string' ? fo.type : 'lowpass';
        const c0 = clampNum(fo.freq, 20, 20000, 1200);
        filt.frequency.setValueAtTime(c0, t0);
        if (fo.freq2 != null) {
          const c1 = clampNum(fo.freq2, 20, 20000, c0);
          filt.frequency.exponentialRampToValueAtTime(Math.max(20, c1), tEnd);
        }
        try {
          filt.Q.setValueAtTime(clampNum(fo.q, 0.0001, 24, 1), t0);
        } catch {}
        tail.connect(filt);
        tail = filt;
      }

      if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
        try {
          const p = ctx.createStereoPanner();
          nodes.push(p);
          p.pan.setValueAtTime(pan, t0);
          tail.connect(p);
          tail = p;
        } catch {}
      }

      tail.connect(out);
      if (send > 0) {
        const rv = ensureReverb(ctx);
        if (rv) {
          const sg = ctx.createGain();
          nodes.push(sg);
          sg.gain.setValueAtTime(send, t0);
          tail.connect(sg);
          sg.connect(rv);
        }
      }

      // Голова тракта: то, во что включается источник.
      let head = gain;
      if (drive > 0) {
        const curve = ensureDriveCurve(ctx);
        if (curve) {
          try {
            const shaper = ctx.createWaveShaper();
            nodes.push(shaper);
            shaper.curve = curve;
            const pre = ctx.createGain();
            nodes.push(pre);
            // Перегруз съедает громкость тем сильнее, чем больше подкачка,
            // поэтому вход поднимаем, а выход тут же опускаем обратно.
            pre.gain.setValueAtTime(1 + drive * 6, t0);
            const post = ctx.createGain();
            nodes.push(post);
            post.gain.setValueAtTime(1 / (1 + drive * 2.2), t0);
            pre.connect(shaper);
            shaper.connect(post);
            post.connect(gain);
            head = pre;
          } catch {}
        }
      }

      if (o.noise) {
        const buf = ensureNoiseBuffer(ctx);
        if (!buf) return;
        src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const off = Math.random() * Math.max(0.001, buf.duration - dur - 0.02);
        src.connect(head);
        src.start(t0, Math.max(0, off));
        src.stop(tEnd + 0.02);
      } else {
        src = ctx.createOscillator();
        src.type = type;
        src.frequency.setValueAtTime(f0, t0);
        if (f1 != null && Math.abs(f1 - f0) > 0.5) {
          if (exp) src.frequency.exponentialRampToValueAtTime(Math.max(20, f1), tBend);
          else src.frequency.linearRampToValueAtTime(f1, tBend);
        }
        if (o.detune) {
          try {
            src.detune.setValueAtTime(clampNum(o.detune, -2400, 2400, 0), t0);
          } catch {}
        }

        /* Частотная модуляция: второй осциллятор пишет прямо в частоту
           несущей. Ratio задаёт характер (целое — колокол, дробное —
           металл), index — глубину в герцах относительно несущей. */
        if (o.fm && typeof o.fm === 'object') {
          try {
            const mod = ctx.createOscillator();
            nodes.push(mod);
            mod.type = typeof o.fm.type === 'string' ? o.fm.type : 'sine';
            const ratio = clampNum(o.fm.ratio, 0.05, 24, 2);
            mod.frequency.setValueAtTime(f0 * ratio, t0);
            const depth = ctx.createGain();
            nodes.push(depth);
            const idx = clampNum(o.fm.index, 0, 40, 2);
            depth.gain.setValueAtTime(f0 * idx, t0);
            // Модулятор гаснет быстрее несущей: так призвук слышен в атаке,
            // а хвост остаётся чистым тоном.
            depth.gain.exponentialRampToValueAtTime(Math.max(0.001, f0 * idx * 0.02), tEnd);
            mod.connect(depth);
            depth.connect(src.frequency);
            mod.start(t0);
            mod.stop(tEnd + 0.02);
          } catch {}
        }

        /* Вибрато — медленная качка высоты; отличает «живой» аккорд победы
           от синтетического аккорда меню. */
        if (o.vibrato && typeof o.vibrato === 'object') {
          try {
            const lfo = ctx.createOscillator();
            nodes.push(lfo);
            lfo.type = 'sine';
            lfo.frequency.setValueAtTime(clampNum(o.vibrato.rate, 0.1, 24, 5), t0);
            const amt = ctx.createGain();
            nodes.push(amt);
            amt.gain.setValueAtTime(clampNum(o.vibrato.cents, 0, 200, 12), t0);
            lfo.connect(amt);
            amt.connect(src.detune);
            lfo.start(t0 + clampNum(o.vibrato.delay, 0, 2000, 0) / 1000);
            lfo.stop(tEnd + 0.02);
          } catch {}
        }

        src.connect(head);
        src.start(t0);
        src.stop(tEnd + 0.02);
      }

      src.onended = () => {
        try {
          src?.disconnect();
        } catch {}
        for (let i = 0; i < nodes.length; i++) {
          try {
            nodes[i].disconnect();
          } catch {}
        }
      };
    } catch (e) {
      try {
        console.error('audio_voice_error', e);
      } catch {}
      try {
        src?.stop();
      } catch {}
    }
  }

  /* Унисон: несколько расстроенных копий вместо одного осциллятора. Пила в
     унисон — это разница между «пищит» и «звучит»; расстройка симметрична
     относительно центра, поэтому высота не уезжает. */
  function layers(o) {
    const n = Math.round(clampNum(o.unison, 1, 5, 1));
    if (n <= 1) {
      voice(o);
      return;
    }
    const cents = clampNum(o.unisonCents, 0, 60, 12);
    const per = clampNum(o.vol, 0, 4, 1) / Math.sqrt(n);
    for (let i = 0; i < n; i++) {
      const k = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
      voice({
        ...o,
        vol: per,
        detune: (Number(o.detune) || 0) + k * cents,
        // Разводим копии по панораме вокруг заданной позиции — звук
        // становится широким, но остаётся там, где произошло событие.
        pan: clampNum(o.pan, -1, 1, 0) * 0.75 + k * 0.22
      });
    }
  }

  // ——— публичные примитивы ———

  function tone(opts) {
    const o = opts || {};
    gate(o.prio ?? 1, () => layers(o));
  }

  function sweep(f0, f1, dur, type, opts) {
    const o = opts || {};
    gate(o.prio ?? 1, () =>
      layers({
        ...o,
        type: type || 'sine',
        freq: f0,
        freq2: f1,
        dur
      })
    );
  }

  function noiseBurst(dur, filterType, cutoff, opts) {
    const o = opts || {};
    gate(o.prio ?? 1, () =>
      voice({
        ...o,
        noise: true,
        dur,
        filter: filterType ? { type: filterType, freq: cutoff, freq2: o.cutoff2 ?? null, q: o.q } : null
      })
    );
  }

  function chord(freqs, dur, opts) {
    const list = Array.isArray(freqs) ? freqs.filter((f) => Number.isFinite(Number(f))) : [];
    if (!list.length) return;
    const o = opts || {};
    const per = clampNum(o.vol, 0, 4, 1) / Math.sqrt(list.length);
    gate(o.prio ?? 2, () => {
      for (let i = 0; i < list.length; i++) {
        layers({
          ...o,
          type: o.type || 'sine',
          freq: list[i],
          dur,
          vol: per,
          delay: (Number(o.delay) || 0) + i * (Number(o.spread) || 0),
          // Ноты аккорда расходятся по стереополю: снизу слева, сверху
          // справа — так слышно каждую, а не общую кашу.
          pan: clampNum(o.pan, -1, 1, 0) + (list.length > 1 ? ((i / (list.length - 1)) * 2 - 1) * clampNum(o.width, 0, 1, 0.35) : 0)
        });
      }
    });
  }

  function arp(notes, stepMs, opts) {
    const list = Array.isArray(notes) ? notes.filter((f) => Number.isFinite(Number(f))) : [];
    if (!list.length) return;
    const o = opts || {};
    const step = clampNum(stepMs, 10, 1000, 90);
    const dur = clampNum(o.dur, 10, 2000, step * 1.6);
    gate(o.prio ?? 2, () => {
      for (let i = 0; i < list.length; i++) {
        layers({
          ...o,
          type: o.type || 'triangle',
          freq: list[i],
          dur,
          delay: (Number(o.delay) || 0) + i * step
        });
      }
    });
  }

  /* Просадка общей громкости под крупное событие: на 30 мс мастер уходит
     вниз и возвращается за duck.ms. Это не эффект ради эффекта — без него
     смерть тонет в фоне захватов, которые идут в тот же момент. */
  function duck(amount, ms) {
    // При выключенном звуке просадка не должна создавать AudioContext:
    // живой контекст держит аудио-подсистему разбуженной и ест батарею.
    if (volumeScale() <= 0) return;
    const ctx = ensureAudioCtx();
    const g = bus();
    if (!ctx || !g) return;
    const a = clampNum(amount, 0, 0.9, 0.35);
    if (a <= 0) return;
    const back = clampNum(ms, 40, 2000, 260) / 1000;
    try {
      const now = ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(1 - a, now + 0.03);
      g.gain.linearRampToValueAtTime(1, now + 0.03 + back);
    } catch {}
  }

  // Обратная совместимость: старые вызовы playBeep продолжают работать.
  function playBeep(freq, ms, vol, getState) {
    if (typeof getState === 'function' && !getStateFn) configure(getState);
    tone({ type: 'sine', freq, dur: ms, vol, prio: 1 });
  }

  function resume() {
    try {
      ensureAudioCtx()?.resume?.().catch(() => {});
    } catch {}
  }

  return { configure, event, tone, sweep, noiseBurst, chord, arp, duck, playBeep, resume };
}
