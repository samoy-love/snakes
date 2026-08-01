export function createFxModule() {
  function addFxBurst(x, y, kind, getState) {
    const st = typeof getState === 'function' ? getState() : null;
    if (!st?.fxEnabled) return;

    const xx = Number(x);
    const yy = Number(y);
    if (!Number.isFinite(xx) || !Number.isFinite(yy)) return;

    const arr = st.fxBursts;
    if (!arr || !Array.isArray(arr)) return;

    arr.push({ t0: performance.now(), x: xx, y: yy, kind: String(kind || '') });
    const cap = 80;
    if (arr.length > cap) arr.splice(0, arr.length - cap);
  }

  function addShake(amount, getState) {
    const st = typeof getState === 'function' ? getState() : null;
    const intensity = Math.max(0, Number(st?.shakeIntensity) || 0);
    const a = Math.max(0, Math.min(1, Number(amount) || 0)) * intensity;
    if (a <= 0) return;

    // Меняем скорости через колбэк, чтобы состояние оставалось в client.js
    if (typeof st?.addShakeVel === 'function') {
      st.addShakeVel((Math.random() - 0.5) * 0.9 * a, (Math.random() - 0.5) * 0.9 * a);
    }
  }

  return { addFxBurst, addShake };
}
