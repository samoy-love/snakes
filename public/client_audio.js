export function createAudioModule() {
  let audioCtx = null;

  function ensureAudioCtx() {
    if (audioCtx) return audioCtx;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
      return audioCtx;
    } catch {
      return null;
    }
  }

  function playBeep(freq, ms, vol, getState) {
    const st = typeof getState === 'function' ? getState() : null;
    const soundEnabled = !!st?.soundEnabled;
    const soundVolume = Number(st?.soundVolume ?? 0);
    if (!soundEnabled) return;

    const ctx = ensureAudioCtx();
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    } catch {}

    const f = Math.max(30, Math.min(4000, Number(freq) || 0));
    const dur = Math.max(10, Math.min(1200, Number(ms) || 0));
    const v = Math.max(0, Math.min(1, (Number(vol) || 1) * (Number(soundVolume) || 0)));
    if (v <= 0 || !Number.isFinite(f) || !Number.isFinite(dur)) return;

    let osc;
    let gain;
    try {
      osc = ctx.createOscillator();
      gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, ctx.currentTime);

      const t0 = ctx.currentTime;
      const t1 = t0 + dur / 1000;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, v), t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t1);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t1 + 0.02);
      osc.onended = () => {
        try {
          osc.disconnect();
        } catch {}
        try {
          gain.disconnect();
        } catch {}
      };
    } catch (e) {
      try {
        console.error('playBeep_error', e);
      } catch {}
      try {
        osc?.stop();
      } catch {}
    }
  }

  return { playBeep };
}
