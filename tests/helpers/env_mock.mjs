/*
 * Детерминированное окружение для модулей, которые общаются с браузером:
 * client_net.js (WebSocket + таймеры), client_audio.js (WebAudio + таймеры),
 * client_fx.js (performance.now + Math.random), client_errors.js (window).
 *
 * Почему свои фейки, а не t.mock.timers: модулям нужны не только таймеры, но и
 * согласованные с ними Date.now / performance.now (client_net.js меряет аптайм
 * сокета через Date.now, а лимитер client_audio.js — через performance.now).
 * Один общий счётчик миллисекунд гарантирует, что «прошло 5 секунд» означает
 * одно и то же для всех трёх источников времени. Плюс сами таймеры нужны
 * инспектируемыми: тест «пинг не течёт» — это утверждение о СПИСКЕ живых
 * таймеров, а не о побочных эффектах.
 *
 * Зависимостей нет: только встроенный JS.
 */

// --- фальшивые таймеры + часы -----------------------------------------------

export function installFakeTimers(startMs = 1_000_000) {
  const prev = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    dateNow: Date.now,
    perf: globalThis.performance
  };

  let now = startMs;
  let seq = 1;
  /** id -> { at, fn, every, args } */
  const timers = new Map();

  globalThis.setTimeout = (fn, ms, ...args) => {
    const id = seq++;
    timers.set(id, { at: now + Math.max(0, Number(ms) || 0), fn, every: 0, args });
    return id;
  };
  globalThis.setInterval = (fn, ms, ...args) => {
    const id = seq++;
    const p = Math.max(1, Number(ms) || 0);
    timers.set(id, { at: now + p, fn, every: p, args });
    return id;
  };
  globalThis.clearTimeout = (id) => {
    timers.delete(id);
  };
  globalThis.clearInterval = (id) => {
    timers.delete(id);
  };

  Date.now = () => now;
  // performance.now в Node живёт на прототипе; собственное свойство перекрывает
  // его и снимается восстановлением объекта целиком.
  Object.defineProperty(globalThis, 'performance', {
    value: { now: () => now },
    configurable: true,
    writable: true
  });

  // Ближайший по времени таймер, срабатывающий не позже target;
  // при равенстве времени — тот, что заведён раньше (порядок setTimeout).
  function nextBefore(target) {
    let best = null;
    for (const [id, t] of timers) {
      if (t.at > target) continue;
      if (!best || t.at < best[1].at || (t.at === best[1].at && id < best[0])) best = [id, t];
    }
    return best;
  }

  const api = {
    /** Продвинуть часы на ms, выполняя сработавшие таймеры по возрастанию времени. */
    advance(ms) {
      const target = now + Math.max(0, Number(ms) || 0);
      // Защита от вечного цикла, если таймер бесконечно переставляет сам себя.
      for (let guard = 0; guard < 100000; guard++) {
        const hit = nextBefore(target);
        if (!hit) break;
        const [id, t] = hit;
        now = Math.max(now, t.at);
        if (t.every) t.at = now + t.every;
        else timers.delete(id);
        t.fn(...t.args);
      }
      now = target;
      return api;
    },
    /** Текущее время фальшивых часов. */
    now: () => now,
    /** Живые таймеры: [{ id, at, in, every }] — для проверок «таймер не течёт». */
    pending() {
      return [...timers].map(([id, t]) => ({ id, at: t.at, in: t.at - now, every: t.every }));
    },
    /** Только периодические (setInterval) — пинг и т.п. */
    intervals() {
      return api.pending().filter((t) => t.every > 0);
    },
    count() {
      return timers.size;
    },
    restore() {
      globalThis.setTimeout = prev.setTimeout;
      globalThis.clearTimeout = prev.clearTimeout;
      globalThis.setInterval = prev.setInterval;
      globalThis.clearInterval = prev.clearInterval;
      Date.now = prev.dateNow;
      Object.defineProperty(globalThis, 'performance', {
        value: prev.perf,
        configurable: true,
        writable: true
      });
    }
  };

  return api;
}

// --- детерминированный Math.random ------------------------------------------

/**
 * Подменяет Math.random. seq — массив значений (циклически) или функция.
 * Возвращает { values, restore } — values копит выданные числа.
 */
export function installRandom(seq = [0.5]) {
  const prev = Math.random;
  const values = [];
  let i = 0;
  Math.random = () => {
    const v = typeof seq === 'function' ? seq(i) : seq[i % seq.length];
    i++;
    values.push(v);
    return v;
  };
  return {
    values,
    calls: () => i,
    restore() {
      Math.random = prev;
    }
  };
}

// --- перехват console --------------------------------------------------------

export function captureConsole() {
  const prevError = console.error;
  const prevWarn = console.warn;
  const errors = [];
  const warns = [];
  console.error = (...a) => errors.push(a);
  console.warn = (...a) => warns.push(a);
  return {
    errors,
    warns,
    restore() {
      console.error = prevError;
      console.warn = prevWarn;
    }
  };
}

// --- подставной WebSocket ----------------------------------------------------

export const WS_STATES = { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 };

/**
 * Класс-заглушка WebSocket. Сокеты не открываются сами: тест руками зовёт
 * sock.fireOpen() / fireMessage() / fireClose() / fireError(). Так проверяемы
 * и «сервер принял и сразу закрыл», и «onerror пришёл раньше onclose».
 *
 * Возвращает { Ctor, sockets, restore } и ставит глобальный WebSocket.
 */
export function installWebSocket(opts = {}) {
  const sockets = [];
  const prev = globalThis.WebSocket;
  const had = 'WebSocket' in globalThis;

  class FakeWebSocket {
    constructor(url) {
      if (typeof opts.onConstruct === 'function') opts.onConstruct(url, sockets.length);
      this.url = url;
      this.readyState = WS_STATES.CONNECTING;
      this.binaryType = 'blob';
      this.sent = [];
      this.closed = 0;
      this.onopen = null;
      this.onclose = null;
      this.onerror = null;
      this.onmessage = null;
      sockets.push(this);
    }

    send(payload) {
      if (this.throwOnSend) throw new Error('send failed');
      this.sent.push(payload);
    }

    close() {
      this.closed++;
      this.readyState = WS_STATES.CLOSING;
    }

    // --- ручное управление из теста ---
    fireOpen() {
      this.readyState = WS_STATES.OPEN;
      this.onopen?.({ type: 'open' });
      return this;
    }

    fireMessage(data) {
      return this.onmessage?.({ data });
    }

    fireError(ev) {
      this.readyState = WS_STATES.CLOSED;
      this.onerror?.(ev ?? { type: 'error' });
      return this;
    }

    fireClose(ev) {
      this.readyState = WS_STATES.CLOSED;
      this.onclose?.(ev ?? { type: 'close', code: 1006 });
      return this;
    }

    /** «onerror, следом onclose» — ровно то, что делает браузер при обрыве. */
    fireDrop(ev) {
      this.fireError(ev);
      this.fireClose(ev);
      return this;
    }
  }

  FakeWebSocket.CONNECTING = WS_STATES.CONNECTING;
  FakeWebSocket.OPEN = WS_STATES.OPEN;
  FakeWebSocket.CLOSING = WS_STATES.CLOSING;
  FakeWebSocket.CLOSED = WS_STATES.CLOSED;

  globalThis.WebSocket = FakeWebSocket;

  return {
    Ctor: FakeWebSocket,
    sockets,
    last: () => sockets[sockets.length - 1],
    restore() {
      if (had) globalThis.WebSocket = prev;
      else delete globalThis.WebSocket;
    }
  };
}

export function installLocation(loc = { protocol: 'https:', host: 'snakes.example' }) {
  const prev = globalThis.location;
  const had = 'location' in globalThis;
  Object.defineProperty(globalThis, 'location', {
    value: loc,
    configurable: true,
    writable: true
  });
  return {
    restore() {
      if (had) {
        Object.defineProperty(globalThis, 'location', {
          value: prev,
          configurable: true,
          writable: true
        });
      } else {
        delete globalThis.location;
      }
    }
  };
}

// --- подставной WebAudio -----------------------------------------------------

/*
 * Мок AudioContext. Пишет в общий журнал ctx.__log все создания узлов,
 * соединения, отсоединения, старты/стопы и вызовы AudioParam. Тестам нужен
 * именно граф и расписание параметров: «сколько узлов создано», «куда
 * подключён master», «есть ли NaN в setValueAtTime», «отсоединились ли узлы
 * после onended».
 */
function makeParam(node, name, log) {
  const calls = [];
  const p = {
    value: 0,
    __calls: calls,
    setValueAtTime(v, t) {
      calls.push(['setValueAtTime', v, t]);
      log.push({ op: 'param', node: node.__id, kind: node.__kind, name, call: 'setValueAtTime', v, t });
      p.value = v;
      return p;
    },
    linearRampToValueAtTime(v, t) {
      calls.push(['linearRampToValueAtTime', v, t]);
      log.push({ op: 'param', node: node.__id, kind: node.__kind, name, call: 'linearRampToValueAtTime', v, t });
      return p;
    },
    exponentialRampToValueAtTime(v, t) {
      calls.push(['exponentialRampToValueAtTime', v, t]);
      log.push({ op: 'param', node: node.__id, kind: node.__kind, name, call: 'exponentialRampToValueAtTime', v, t });
      return p;
    },
    cancelScheduledValues(t) {
      calls.push(['cancelScheduledValues', t]);
      return p;
    }
  };
  return p;
}

export function createMockAudioContext(opts = {}) {
  const log = [];
  const nodes = [];
  let ids = 0;

  const ctx = {
    __log: log,
    __nodes: nodes,
    currentTime: opts.currentTime == null ? 10 : opts.currentTime,
    sampleRate: opts.sampleRate == null ? 48000 : opts.sampleRate,
    state: opts.state || 'running',
    resumeCalls: 0,
    createBufferCalls: 0,
    resume() {
      ctx.resumeCalls++;
      ctx.state = 'running';
      return Promise.resolve();
    }
  };

  function node(kind, extra = {}) {
    const n = {
      __id: ++ids,
      __kind: kind,
      __connected: [],
      __disconnected: 0,
      connect(dst) {
        n.__connected.push(dst);
        log.push({ op: 'connect', from: n.__id, fromKind: kind, to: dst?.__id ?? 'destination', toKind: dst?.__kind ?? 'destination' });
        return dst;
      },
      disconnect() {
        n.__disconnected++;
        log.push({ op: 'disconnect', node: n.__id, kind });
      },
      ...extra
    };
    nodes.push(n);
    log.push({ op: 'create', node: n.__id, kind });
    return n;
  }

  ctx.destination = { __id: 0, __kind: 'destination' };

  ctx.createGain = () => {
    const n = node('gain');
    n.gain = makeParam(n, 'gain', log);
    return n;
  };

  ctx.createBiquadFilter = () => {
    const n = node('biquad');
    n.type = 'lowpass';
    n.frequency = makeParam(n, 'frequency', log);
    n.Q = makeParam(n, 'Q', log);
    return n;
  };

  ctx.createDynamicsCompressor = () => {
    if (opts.noCompressor) throw new Error('no compressor');
    const n = node('compressor');
    for (const p of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[p] = makeParam(n, p, log);
    return n;
  };

  ctx.createOscillator = () => {
    const n = node('osc');
    n.type = 'sine';
    n.frequency = makeParam(n, 'frequency', log);
    n.detune = makeParam(n, 'detune', log);
    n.onended = null;
    n.__started = [];
    n.__stopped = [];
    n.start = (t) => {
      n.__started.push(t);
      log.push({ op: 'start', node: n.__id, kind: 'osc', t });
    };
    n.stop = (t) => {
      n.__stopped.push(t);
      log.push({ op: 'stop', node: n.__id, kind: 'osc', t });
    };
    return n;
  };

  ctx.createBufferSource = () => {
    const n = node('bufsrc');
    n.buffer = null;
    n.loop = false;
    n.onended = null;
    n.__started = [];
    n.__stopped = [];
    n.start = (t, off) => {
      n.__started.push([t, off]);
      log.push({ op: 'start', node: n.__id, kind: 'bufsrc', t, off });
    };
    n.stop = (t) => {
      n.__stopped.push(t);
      log.push({ op: 'stop', node: n.__id, kind: 'bufsrc', t });
    };
    return n;
  };

  ctx.createBuffer = (channels, len, rate) => {
    ctx.createBufferCalls++;
    const data = new Float32Array(len);
    return {
      __kind: 'buffer',
      numberOfChannels: channels,
      length: len,
      sampleRate: rate,
      duration: len / rate,
      getChannelData: () => data
    };
  };

  return ctx;
}

/**
 * Ставит window.AudioContext, возвращающий createMockAudioContext.
 * ctors — счётчик конструирований (проверка «при выключенном звуке контекст
 * даже не создаётся»).
 */
export function installAudioEnv(opts = {}) {
  const prevWindow = globalThis.window;
  const hadWindow = 'window' in globalThis;
  const made = [];

  function Ctx() {
    if (opts.throwOnCtor) throw new Error('no audio');
    const c = createMockAudioContext(opts);
    made.push(c);
    return c;
  }

  globalThis.window = opts.noAudioCtor ? {} : { AudioContext: Ctx };

  return {
    made,
    ctx: () => made[made.length - 1],
    ctorCalls: () => made.length,
    restore() {
      if (hadWindow) globalThis.window = prevWindow;
      else delete globalThis.window;
    }
  };
}

/** Все числовые аргументы вызовов AudioParam — для проверки «нет NaN». */
export function badAudioNumbers(log) {
  const bad = [];
  for (const e of log) {
    for (const k of ['v', 't', 'off']) {
      if (!(k in e)) continue;
      const n = e[k];
      if (n == null) continue;
      if (typeof n !== 'number' || !Number.isFinite(n)) bad.push({ ...e, badKey: k });
    }
  }
  return bad;
}

// --- подставной window для installErrorLogging -------------------------------

export function installWindowEvents(extra = {}) {
  const prev = globalThis.window;
  const had = 'window' in globalThis;
  const listeners = [];
  globalThis.window = {
    addEventListener(type, fn, o) {
      listeners.push({ type, fn, o });
    },
    removeEventListener(type, fn) {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    ...extra
  };
  return {
    listeners,
    of: (type) => listeners.filter((l) => l.type === type).map((l) => l.fn),
    restore() {
      if (had) globalThis.window = prev;
      else delete globalThis.window;
    }
  };
}
