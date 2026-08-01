// Звуковая палитра игры.
//
// Общая шина: master(gain) -> DynamicsCompressor -> destination, поэтому
// аккорды и наложения не клиппируют. Поверх примитивов работает лимитер:
// не более LIMIT_MAX «событий» за LIMIT_WINDOW_MS, лишнее уходит в очередь
// с приоритетом (высокий приоритет вытесняет низкий).
export function createAudioModule() {
  let audioCtx = null;
  let master = null;
  let noiseBuf = null;
  let getStateFn = null;

  const LIMIT_WINDOW_MS = 250;
  const LIMIT_MAX = 4;
  const QUEUE_STALE_MS = 400;
  const QUEUE_CAP = 12;

  const recent = [];
  const queue = [];
  let drainTimer = 0;

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
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.85, ctx.currentTime);
      try {
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.setValueAtTime(-16, ctx.currentTime);
        comp.knee.setValueAtTime(26, ctx.currentTime);
        comp.ratio.setValueAtTime(12, ctx.currentTime);
        comp.attack.setValueAtTime(0.003, ctx.currentTime);
        comp.release.setValueAtTime(0.22, ctx.currentTime);
        g.connect(comp);
        comp.connect(ctx.destination);
      } catch {
        g.connect(ctx.destination);
      }
      master = g;
    } catch {
      master = null;
    }
    return master;
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

  function gate(prio, run) {
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

  function voice(opts) {
    const ctx = ensureAudioCtx();
    const out = bus();
    if (!ctx || !out) return;

    const o = opts || {};
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

    let src = null;
    let gain = null;
    let filt = null;
    try {
      gain = ctx.createGain();
      const t0 = ctx.currentTime + delay;
      const tPeak = t0 + attack;
      const tEnd = t0 + Math.max(attack + 0.01, dur);

      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), tPeak);
      gain.gain.exponentialRampToValueAtTime(0.0001, Math.max(tPeak + 0.01, t0 + decay));

      const fo = o.filter;
      if (fo && typeof fo === 'object') {
        filt = ctx.createBiquadFilter();
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
        gain.connect(filt);
        filt.connect(out);
      } else {
        gain.connect(out);
      }

      if (o.noise) {
        const buf = ensureNoiseBuffer(ctx);
        if (!buf) return;
        src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const off = Math.random() * Math.max(0.001, buf.duration - dur - 0.02);
        src.connect(gain);
        src.start(t0, Math.max(0, off));
        src.stop(tEnd + 0.02);
      } else {
        src = ctx.createOscillator();
        src.type = type;
        src.frequency.setValueAtTime(f0, t0);
        if (f1 != null && Math.abs(f1 - f0) > 0.5) {
          if (exp) src.frequency.exponentialRampToValueAtTime(Math.max(20, f1), tEnd);
          else src.frequency.linearRampToValueAtTime(f1, tEnd);
        }
        if (o.detune) {
          try {
            src.detune.setValueAtTime(clampNum(o.detune, -2400, 2400, 0), t0);
          } catch {}
        }
        src.connect(gain);
        src.start(t0);
        src.stop(tEnd + 0.02);
      }

      src.onended = () => {
        try {
          src?.disconnect();
        } catch {}
        try {
          filt?.disconnect();
        } catch {}
        try {
          gain?.disconnect();
        } catch {}
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

  // ——— публичные примитивы ———

  function tone(opts) {
    const o = opts || {};
    gate(o.prio ?? 1, () => voice(o));
  }

  function sweep(f0, f1, dur, type, opts) {
    const o = opts || {};
    gate(o.prio ?? 1, () =>
      voice({
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
        voice({
          ...o,
          type: o.type || 'sine',
          freq: list[i],
          dur,
          vol: per,
          delay: (Number(o.delay) || 0) + i * (Number(o.spread) || 0)
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
        voice({
          ...o,
          type: o.type || 'triangle',
          freq: list[i],
          dur,
          delay: (Number(o.delay) || 0) + i * step
        });
      }
    });
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

  return { configure, tone, sweep, noiseBurst, chord, arp, playBeep, resume };
}
