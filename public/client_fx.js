export function createFxModule() {
  function addFxBurst(x, y, kind, getState, extra) {
    const st = typeof getState === 'function' ? getState() : null;
    const knd = String(kind || '');
    // Числовые всплытия (+247) — информация, а не украшение: их не гасит fxEnabled.
    if (!st?.fxEnabled && knd !== 'score') return;

    const xx = Number(x);
    const yy = Number(y);
    if (!Number.isFinite(xx) || !Number.isFinite(yy)) return;

    const arr = st?.fxBursts;
    if (!arr || !Array.isArray(arr)) return;

    const item = { t0: performance.now(), x: xx, y: yy, kind: knd };
    if (extra && typeof extra === 'object') Object.assign(item, extra);
    arr.push(item);
    const cap = 80;
    if (arr.length > cap) arr.splice(0, arr.length - cap);
  }

  // Направленная тряска: вектор (dirX, dirY) задаёт сторону толчка,
  // к нему подмешивается небольшой случайный джиттер. Без вектора —
  // прежнее чисто случайное поведение.
  function addShake(amount, getState, dirX, dirY) {
    const st = typeof getState === 'function' ? getState() : null;
    const intensity = Math.max(0, Number(st?.shakeIntensity) || 0);
    const a = Math.max(0, Math.min(1, Number(amount) || 0)) * intensity;
    if (a <= 0) return;

    // Меняем скорости через колбэк, чтобы состояние оставалось в client.js
    if (typeof st?.addShakeVel !== 'function') return;

    let dx = Number(dirX) || 0;
    let dy = Number(dirY) || 0;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 1e-4) {
      dx /= len;
      dy /= len;
    } else {
      const ang = Math.random() * Math.PI * 2;
      dx = Math.cos(ang);
      dy = Math.sin(ang);
    }

    const jitter = 0.30;
    st.addShakeVel(
      (dx * (1 - jitter) + (Math.random() - 0.5) * jitter) * 0.9 * a,
      (dy * (1 - jitter) + (Math.random() - 0.5) * jitter) * 0.9 * a
    );
  }

  return { addFxBurst, addShake };
}
