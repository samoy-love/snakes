/*
 * public/client_net.js — исполняемые тесты.
 *
 * Здесь живут два уже случавшихся продакшн-бага, и оба тихие:
 *
 *  C9-a «бэкофф залипал на 500 мс». Счётчик попыток сбрасывался прямо в
 *       onopen. Против сервера, который соединение ПРИНИМАЕТ и тут же
 *       закрывает (лимит комнат, рестарт, rate-limit), клиент долбился
 *       каждые полсекунды — со всех вкладок всех игроков сразу.
 *  C9-b «двойная обработка обрыва». onerror и onclose ведут в один
 *       обработчик; без защёлки один обрыв давал два прикладных onClose
 *       (два тоста, два showMenuOverlay) и два запланированных реконнекта.
 *
 * Поэтому тесты ниже написаны как утверждения о ЗАДЕРЖКАХ и о СПИСКЕ живых
 * таймеров, а не о побочных эффектах: залипший бэкофф видно только так.
 *
 * Всё детерминировано: фальшивые таймеры/часы, фальшивый WebSocket
 * (сокеты не открываются сами), фальшивый Math.random.
 *
 * Каждый нетривиальный тест подписан: какую поломку он ловит.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createNetModule } from '../public/client_net.js';
import {
  installFakeTimers,
  installRandom,
  installWebSocket,
  installLocation,
  captureConsole,
  WS_STATES
} from './helpers/env_mock.mjs';

/**
 * Общий стенд: часы + сокеты + location + Math.random, плюс журнал вызовов
 * прикладных колбэков. random по умолчанию 0.5 — джиттер ровно x1.0,
 * то есть задержка равна «чистому» экспоненциальному шагу.
 */
function setup(opts = {}) {
  const timers = installFakeTimers(1_000_000);
  const rnd = installRandom(opts.random ?? [0.5]);
  const wsEnv = installWebSocket();
  const locEnv = installLocation(opts.location ?? { protocol: 'https:', host: 'snakes.example' });

  const log = {
    open: [],
    close: [],
    status: 0,
    text: [],
    binary: [],
    bytesIn: [],
    bytesOut: []
  };

  const net = createNetModule({
    t: (k) => String(k),
    wsQuery: opts.wsQuery,
    onOpen: (api) => log.open.push(api),
    onClose: (ev) => log.close.push(ev),
    onStatusChange: () => {
      log.status++;
    },
    onTextMsg: opts.onTextMsg ?? ((type, data) => log.text.push([type, data])),
    onBinaryMsg: opts.onBinaryMsg ?? ((buf) => log.binary.push(buf)),
    onBytesIn: (n) => log.bytesIn.push(n),
    onBytesOut: (n) => log.bytesOut.push(n),
    ...(opts.netOpts || {})
  });

  return {
    net,
    log,
    timers,
    rnd,
    ws: wsEnv,
    /** Задержка ближайшего одноразового таймера — это и есть бэкофф. */
    pendingDelay() {
      const once = timers.pending().filter((t) => !t.every);
      assert.equal(once.length, 1, `ожидался ровно один одноразовый таймер, есть ${once.length}`);
      return once[0].in;
    },
    onceTimers: () => timers.pending().filter((t) => !t.every),
    restore() {
      locEnv.restore();
      wsEnv.restore();
      rnd.restore();
      timers.restore();
    }
  };
}

/** Полный цикл «сокет открылся и через upMs оборвался». Возвращает задержку до реконнекта. */
function cycle(env, upMs) {
  const sock = env.ws.last();
  sock.fireOpen();
  env.timers.advance(upMs);
  sock.fireClose();
  return env.pendingDelay();
}

// --- URL --------------------------------------------------------------------

test('wsUrl: схема берётся из протокола страницы', () => {
  // Ловит: жёстко зашитый ws:// — на https-странице такой сокет
  // блокируется браузером как mixed content, игра просто не подключается.
  let env = setup();
  try {
    env.net.connect();
    assert.equal(env.ws.last().url, 'wss://snakes.example/ws');
  } finally {
    env.restore();
  }

  env = setup({ location: { protocol: 'http:', host: 'localhost:8080' } });
  try {
    env.net.connect();
    assert.equal(env.ws.last().url, 'ws://localhost:8080/ws');
  } finally {
    env.restore();
  }
});

test('wsUrl: wsQuery — функция, строка, с «?» и без, пустая', () => {
  // Ловит: потерю токена профиля в query (A1: идентичность игрока) и
  // двойной «??» при уже готовой строке с вопросительным знаком.
  const cases = [
    [undefined, 'wss://snakes.example/ws'],
    [() => '', 'wss://snakes.example/ws'],
    [() => null, 'wss://snakes.example/ws'],
    [() => 't=abc', 'wss://snakes.example/ws?t=abc'],
    [() => '?t=abc', 'wss://snakes.example/ws?t=abc'],
    ['t=raw', 'wss://snakes.example/ws?t=raw'],
    ['', 'wss://snakes.example/ws']
  ];
  for (const [wsQuery, expect] of cases) {
    const env = setup({ wsQuery });
    try {
      env.net.connect();
      assert.equal(env.ws.last().url, expect, `wsQuery=${String(wsQuery)}`);
    } finally {
      env.restore();
    }
  }
});

test('wsQuery пересчитывается на каждом подключении', () => {
  // Ловит: кеширование query на момент создания модуля. Токен выдаётся
  // сервером в hello уже ПОСЛЕ первого соединения — закешированный пустой
  // query означал бы, что игрок навсегда остаётся анонимом после реконнекта.
  let tok = '';
  const env = setup({ wsQuery: () => (tok ? `t=${tok}` : '') });
  try {
    env.net.connect();
    assert.equal(env.ws.last().url, 'wss://snakes.example/ws');
    tok = 'xyz';
    env.ws.last().fireClose();
    env.timers.advance(600);
    assert.equal(env.ws.sockets.length, 2);
    assert.equal(env.ws.last().url, 'wss://snakes.example/ws?t=xyz');
  } finally {
    env.restore();
  }
});

test('connect: конструктор WebSocket бросил — модуль выживает и не планирует реконнект', () => {
  // Ловит: непойманное исключение new WebSocket (бывает при заблокированных
  // сокетах в корпоративных прокси) — оно ронялo бы весь client.js на старте.
  const timers = installFakeTimers();
  const rnd = installRandom([0.5]);
  const loc = installLocation();
  const prevWS = globalThis.WebSocket;
  globalThis.WebSocket = function () {
    throw new Error('blocked');
  };
  try {
    const net = createNetModule({});
    assert.doesNotThrow(() => net.connect());
    assert.equal(net.isConnected(), false);
    assert.equal(timers.count(), 0);
  } finally {
    globalThis.WebSocket = prevWS;
    loc.restore();
    rnd.restore();
    timers.restore();
  }
});

test('connect: сокету выставлен binaryType=arraybuffer', () => {
  // Ловит: потерю строки binaryType. По умолчанию браузер отдаёт Blob,
  // и весь бинарный протокол уходит в медленную async-ветку через
  // Blob.arrayBuffer() — кадры мира начинают приходить с задержкой в тик.
  const env = setup();
  try {
    env.net.connect();
    assert.equal(env.ws.last().binaryType, 'arraybuffer');
  } finally {
    env.restore();
  }
});

// --- бэкофф: главный сценарий ----------------------------------------------

test('C9-a: серия коротких сессий даёт РАСТУЩУЮ задержку', () => {
  // Ловит: возврат сброса wsReconnectAttempt в onopen. Сервер, который
  // принимает соединение и сразу закрывает (лимит соединений, рестарт,
  // rate-limit), при таком сбросе получает от каждого клиента новый коннект
  // каждые ~500 мс и не может выйти из перегрузки.
  const env = setup();
  try {
    env.net.connect();

    const delays = [];
    for (let i = 0; i < 6; i++) {
      // «принял и тут же закрыл» — аптайм 0 мс, до SETTLE_MS далеко
      const d = cycle(env, 0);
      delays.push(d);
      env.timers.advance(d); // дождаться реконнекта
    }

    assert.deepEqual(delays, [500, 1000, 2000, 4000, 5000, 5000]);
    // Именно строгий рост первых шагов — то, что ломалось.
    assert.ok(delays[1] > delays[0], 'вторая попытка должна ждать дольше первой');
  } finally {
    env.restore();
  }
});

test('C9-a: одна длинная стабильная сессия сбрасывает бэкофф', () => {
  // Ловит: обратную поломку — «никогда не сбрасываем». Тогда игрок, у
  // которого связь моргнула днём, к вечеру ждёт переподключения по 5 секунд
  // после каждого чиха, хотя канал давно здоров.
  const env = setup();
  try {
    env.net.connect();

    assert.equal(cycle(env, 0), 500);
    env.timers.advance(500);
    assert.equal(cycle(env, 0), 1000); // бэкофф вырос
    env.timers.advance(1000);

    // Теперь сокет живёт дольше окна «отстоя» (SETTLE_MS = 5000).
    const sock = env.ws.last();
    sock.fireOpen();
    env.timers.advance(6000);
    sock.fireClose();

    assert.equal(env.pendingDelay(), 500, 'после стабильной сессии бэкофф должен обнулиться');
  } finally {
    env.restore();
  }
});

test('C9-a: сессия короче окна отстоя бэкофф не сбрасывает', () => {
  // Ловит: уменьшение SETTLE_MS до нуля/секунды. Граница именно тут:
  // 4999 мс аптайма — ещё не «доказанное» соединение.
  const env = setup();
  try {
    env.net.connect();
    assert.equal(cycle(env, 0), 500);
    env.timers.advance(500);

    assert.equal(cycle(env, 4999), 1000, 'сессия 4999 мс не должна считаться стабильной');
  } finally {
    env.restore();
  }
});

test('C9-a: таймер отстоя привязан к своему сокету', () => {
  // Ловит: гонку «старый settle-таймер обнуляет бэкофф уже другого сокета».
  // Без сверки ws === sock живущий сокет №2 унаследовал бы сброс от
  // сокета №1 и бэкофф снова залип бы на полу.
  const env = setup();
  try {
    env.net.connect();
    const s1 = env.ws.last();
    s1.fireOpen();
    env.timers.advance(4000); // отстой ещё не дозрел
    s1.fireClose();
    assert.equal(env.pendingDelay(), 500);
    env.timers.advance(500);

    const s2 = env.ws.last();
    s2.fireOpen();
    env.timers.advance(1500); // суммарно > 5000 от старта s1, но s2 молод
    s2.fireClose();
    assert.equal(env.pendingDelay(), 1000, 'молодой сокет не должен унаследовать сброс');
  } finally {
    env.restore();
  }
});

test('джиттер зажат в [0.75, 1.25] от экспоненциального шага', () => {
  // Ловит: раздутый или потерянный джиттер. Слишком узкий — все клиенты
  // возвращаются синхронно и добивают сервер пачкой; слишком широкий —
  // отдельные вкладки уходят в многосекундное молчание.
  for (const [r, expect] of [
    [0, 375], // 500 * 0.75
    [0.999999, 625], // 500 * ~1.25
    [0.5, 500]
  ]) {
    const env = setup({ random: [r] });
    try {
      env.net.connect();
      assert.equal(cycle(env, 0), expect, `random=${r}`);
    } finally {
      env.restore();
    }
  }
});

test('бэкофф никогда не превышает 5 секунд даже при худшем джиттере', () => {
  // Ловит: снятие Math.min(5000, ...) или рост показателя выше 2^6 —
  // тогда после десятка обрывов клиент замолкал бы на минуты и игрок
  // считал бы, что сервер лежит.
  const env = setup({ random: [0.999999] });
  try {
    env.net.connect();
    const delays = [];
    for (let i = 0; i < 12; i++) {
      const d = cycle(env, 0);
      assert.ok(d >= 300 && d <= 5000, `шаг ${i}: задержка ${d}`);
      delays.push(d);
      env.timers.advance(d);
    }
    // На «полке» задержка обязана упереться в потолок, а не расти дальше.
    assert.deepEqual(delays.slice(5), Array(7).fill(5000));
  } finally {
    env.restore();
  }
});

test('реконнект не планируется дважды: повторный обрыв не удваивает таймеры', () => {
  // Ловит: потерю ранней проверки `if (wsReconnectTimer) return` —
  // два таймера означают два новых сокета, и число соединений удваивается
  // на каждом обрыве (лавина).
  const env = setup();
  try {
    env.net.connect();
    const s = env.ws.last();
    s.fireOpen();
    s.fireClose();
    s.fireClose();
    s.fireError();
    assert.equal(env.onceTimers().length, 1);
    env.timers.advance(5000);
    assert.equal(env.ws.sockets.length, 2, 'должен появиться ровно один новый сокет');
  } finally {
    env.restore();
  }
});

test('явный connect() отменяет запланированный реконнект', () => {
  // Ловит: утечку таймера реконнекта при ручном подключении — иначе
  // сработавший позже таймер создаёт второй сокет поверх свежего.
  const env = setup();
  try {
    env.net.connect();
    env.ws.last().fireClose();
    assert.equal(env.onceTimers().length, 1);

    env.net.connect();
    assert.equal(env.ws.sockets.length, 2);
    assert.equal(env.onceTimers().length, 0, 'старый таймер реконнекта должен быть снят');

    env.timers.advance(10000);
    assert.equal(env.ws.sockets.length, 2, 'лишних сокетов быть не должно');
  } finally {
    env.restore();
  }
});

test('обрывы двух сокетов подряд дают один таймер реконнекта', () => {
  // Ловит: потерю проверки `if (wsReconnectTimer) return` в scheduleReconnect.
  // Осиротевший сокет (ручной connect() поверх живого) умирает отдельно от
  // текущего; без проверки каждый такой обрыв добавлял бы свой таймер, а
  // каждый таймер — свой сокет: число соединений удваивается на ровном месте.
  const env = setup();
  try {
    env.net.connect();
    const s1 = env.ws.last();
    s1.fireOpen();
    env.net.connect(); // s1 остаётся висеть, текущим становится s2
    const s2 = env.ws.last();

    s1.fireClose();
    s2.fireClose();

    assert.equal(env.onceTimers().length, 1);
    env.timers.advance(5000);
    assert.equal(env.ws.sockets.length, 3, 'должен появиться ровно один новый сокет');
  } finally {
    env.restore();
  }
});

test('явный connect() снимает и таймер отстоя предыдущего сокета', () => {
  // Ловит: утечку settle-таймера при ручном переподключении. Оставшийся
  // таймер сработал бы уже на другом сокете и обнулил бэкофф не по делу.
  const env = setup();
  try {
    env.net.connect();
    env.ws.last().fireOpen();
    assert.equal(env.onceTimers().length, 1, 'после открытия должен быть таймер отстоя');

    env.net.connect();
    assert.equal(env.onceTimers().length, 0);
    assert.equal(env.timers.intervals().length, 1, 'пинг при этом не должен дублироваться');
  } finally {
    env.restore();
  }
});

// --- C9-b: одна обработка обрыва -------------------------------------------

test('C9-b: onerror + onclose дают ровно один прикладной onClose', () => {
  // Ловит: снятие защёлки deadSock. Браузер при обрыве стреляет обоими
  // событиями; двойной onClose в client.js — это два тоста «переподключаюсь»
  // и два перехода в меню, а также два запланированных реконнекта.
  const env = setup();
  try {
    env.net.connect();
    const s = env.ws.last();
    s.fireOpen();
    s.fireDrop(); // onerror, следом onclose — как в браузере

    assert.equal(env.log.close.length, 1);
    assert.equal(env.onceTimers().length, 1);
  } finally {
    env.restore();
  }
});

test('C9-b: защёлка не мешает следующему обрыву следующего сокета', () => {
  // Ловит: слишком широкую защёлку (например, булев флаг вместо ссылки на
  // сокет) — тогда второй обрыв за сессию не дошёл бы до приложения и игрок
  // остался бы с «онлайн» в интерфейсе при мёртвом сокете.
  const env = setup();
  try {
    env.net.connect();
    env.ws.last().fireOpen();
    env.ws.last().fireDrop();
    env.timers.advance(600);

    env.ws.last().fireOpen();
    env.ws.last().fireDrop();

    assert.equal(env.log.close.length, 2);
  } finally {
    env.restore();
  }
});

test('C9-b: событие обрыва прокидывается в прикладной колбэк', () => {
  const env = setup();
  try {
    env.net.connect();
    const s = env.ws.last();
    s.fireOpen();
    s.fireClose({ type: 'close', code: 1006, reason: 'gone' });
    assert.equal(env.log.close[0].code, 1006);
  } finally {
    env.restore();
  }
});

test('бросивший onClose не мешает реконнекту', () => {
  // Ловит: снятие try/catch вокруг прикладного onClose. Исключение в
  // обработчике (например, обращение к ещё не созданному DOM-узлу)
  // оставляло бы клиент навсегда без переподключения.
  const env = setup({ netOpts: { onClose: () => { throw new Error('ui blew up'); } } });
  try {
    env.net.connect();
    env.ws.last().fireOpen();
    env.ws.last().fireClose();
    assert.equal(env.onceTimers().length, 1);
    env.timers.advance(600);
    assert.equal(env.ws.sockets.length, 2);
  } finally {
    env.restore();
  }
});

// --- пинг -------------------------------------------------------------------

test('пинг заводится при открытии и шлёт rttPing раз в секунду', () => {
  // Ловит: потерю пинга — без него измерение RTT мертво, а мобильные NAT
  // и прокси молча выкидывают простаивающее соединение через ~60 секунд.
  const env = setup();
  try {
    env.net.connect();
    assert.equal(env.timers.intervals().length, 0, 'до открытия пинга быть не должно');

    const s = env.ws.last();
    s.fireOpen();
    assert.equal(env.timers.intervals().length, 1);
    assert.equal(env.timers.intervals()[0].every, 1000);

    env.timers.advance(3000);
    assert.equal(s.sent.length, 3);
    const msg = JSON.parse(s.sent[0]);
    assert.equal(msg.type, 'rttPing');
    assert.equal(typeof msg.data.t, 'number');
    assert.ok(Number.isFinite(msg.data.t));
  } finally {
    env.restore();
  }
});

test('пинг гасится при обрыве и не течёт между переподключениями', () => {
  // Ловит: забытый clearInterval. Каждый реконнект добавлял бы ещё один
  // интервал: после часа в метро клиент шлёт десятки пингов в секунду и
  // сам себя роняет по трафику.
  const env = setup();
  try {
    env.net.connect();
    for (let i = 0; i < 5; i++) {
      assert.equal(env.ws.sockets.length, i + 1, `цикл ${i}: должен быть свежий сокет`);
      env.ws.last().fireOpen();
      env.timers.advance(1500);
      env.ws.last().fireDrop();
      assert.equal(env.timers.intervals().length, 0, `цикл ${i}: интервал должен быть снят`);
      env.timers.advance(5100); // потолок бэкоффа — реконнект точно сработал
    }

    env.ws.last().fireOpen();
    assert.equal(env.timers.intervals().length, 1, 'после пяти циклов интервал должен быть один');
  } finally {
    env.restore();
  }
});

test('после обрыва в мёртвый сокет ничего не шлётся', () => {
  // Ловит: пинг, продолжающий стучать в закрытый сокет — это исключение
  // на каждом тике и мусор в консоли.
  const env = setup();
  try {
    env.net.connect();
    const s = env.ws.last();
    s.fireOpen();
    env.timers.advance(2000);
    const before = s.sent.length;
    s.fireDrop();
    env.timers.advance(10000);
    assert.equal(s.sent.length, before);
  } finally {
    env.restore();
  }
});

test('после обрыва таймеров не остаётся, кроме одного реконнекта', () => {
  // Ловит: утечку settle-таймера при обрыве (он привязан к сокету и должен
  // сниматься вместе с ним).
  const env = setup();
  try {
    env.net.connect();
    const s = env.ws.last();
    s.fireOpen();
    env.timers.advance(1000);
    s.fireDrop();
    assert.equal(env.timers.count(), 1, JSON.stringify(env.timers.pending()));
  } finally {
    env.restore();
  }
});

// --- markHealthy ------------------------------------------------------------

test('markHealthy: сам по себе бэкофф не обнуляет — только сокращает окно', () => {
  // Ловит: возврат к «сбрасываем прямо на hello». Сервер отправляет hello
  // ДО любого закрытия по политике (комната переполнена, версия клиента
  // устарела) — сброс на самом сообщении снова прижимает бэкофф к 500 мс
  // и превращает клиент в долбилку.
  const env = setup();
  try {
    env.net.connect();
    assert.equal(cycle(env, 0), 500);
    env.timers.advance(500);

    const s = env.ws.last();
    s.fireOpen();
    env.net.markHealthy(); // hello пришёл сразу
    env.timers.advance(1000); // но сокет прожил меньше SETTLE_HELLO_MS
    s.fireClose();

    assert.equal(env.pendingDelay(), 1000, 'hello сам по себе не должен сбрасывать бэкофф');
  } finally {
    env.restore();
  }
});

test('markHealthy: после SETTLE_HELLO_MS аптайма бэкофф обнуляется досрочно', () => {
  // Ловит: потерю сокращённого окна. Без него честный игрок ждёт полные
  // 5 секунд отстоя, хотя приложение уже подтвердило рабочий канал.
  const env = setup();
  try {
    env.net.connect();
    assert.equal(cycle(env, 0), 500);
    env.timers.advance(500);

    const s = env.ws.last();
    s.fireOpen();
    env.net.markHealthy();
    env.timers.advance(2000); // ровно SETTLE_HELLO_MS — окно дозрело
    s.fireClose();

    assert.equal(env.pendingDelay(), 500, 'сокет с hello и 2 с аптайма считается здоровым');
  } finally {
    env.restore();
  }
});

test('markHealthy: поздний hello при уже набранном аптайме сбрасывает сразу', () => {
  // Ловит: ветку «up >= SETTLE_HELLO_MS» — без неё поздний hello ставил бы
  // ещё один лишний таймер вместо мгновенного сброса.
  const env = setup();
  try {
    env.net.connect();
    assert.equal(cycle(env, 0), 500);
    env.timers.advance(500);

    const s = env.ws.last();
    s.fireOpen();
    env.timers.advance(2500);
    env.net.markHealthy();
    // Сброс должен произойти немедленно, без ожидания SETTLE_MS.
    assert.equal(env.timers.count(), 1, 'должен остаться только пинг');
    s.fireClose();
    assert.equal(env.pendingDelay(), 500);
  } finally {
    env.restore();
  }
});

test('markHealthy: без соединения и без накопленного бэкоффа — no-op', () => {
  const env = setup();
  try {
    assert.doesNotThrow(() => env.net.markHealthy());
    env.net.connect();
    assert.doesNotThrow(() => env.net.markHealthy()); // ещё не открыт
    env.ws.last().fireOpen();
    const before = env.timers.count();
    env.net.markHealthy(); // бэкофф нулевой — ничего не меняется
    assert.equal(env.timers.count(), before);
  } finally {
    env.restore();
  }
});

// --- send / isConnected -----------------------------------------------------

test('send: до открытия и после обрыва возвращает false и ничего не шлёт', () => {
  // Ловит: отправку в CONNECTING-сокет — браузер бросает InvalidStateError,
  // и первый же setName на старте убивал бы обработчик.
  const env = setup();
  try {
    assert.equal(env.net.send('a', {}), false);
    env.net.connect();
    assert.equal(env.net.isConnected(), false);
    assert.equal(env.net.send('a', {}), false);
    assert.equal(env.ws.last().sent.length, 0);

    env.ws.last().fireOpen();
    assert.equal(env.net.isConnected(), true);
    assert.equal(env.net.send('a', { b: 1 }), true);

    env.ws.last().fireDrop();
    assert.equal(env.net.isConnected(), false);
    assert.equal(env.net.send('a', {}), false);
    assert.equal(env.ws.sockets[0].sent.length, 1);
  } finally {
    env.restore();
  }
});

test('send: формат кадра — {type, data}', () => {
  // Ловит: смену формы кадра. Сервер разбирает строго {type, data};
  // любая перестановка полей = молчаливый отказ всех команд игрока.
  const env = setup();
  try {
    env.net.connect();
    env.ws.last().fireOpen();
    env.net.send('join', { roomId: 7, mode: 'id' });
    assert.deepEqual(JSON.parse(env.ws.last().sent[0]), {
      type: 'join',
      data: { roomId: 7, mode: 'id' }
    });
  } finally {
    env.restore();
  }
});

test('send: исключение сокета не роняет вызывающего, а возвращает false', () => {
  // Ловит: снятие try/catch вокруг ws.send. Сокет может умереть между
  // проверкой readyState и самой отправкой — это гонка, а не редкость.
  const env = setup();
  const con = captureConsole();
  try {
    env.net.connect();
    const s = env.ws.last();
    s.fireOpen();
    s.throwOnSend = true;
    assert.equal(env.net.send('a', {}), false);
    assert.equal(con.errors[0][0], 'ws_send_error');
  } finally {
    con.restore();
    env.restore();
  }
});

test('send: исходящий трафик считается в БАЙТАХ, а не в символах', () => {
  // Ловит: подмену TextEncoder на payload.length. Имена игроков — кириллица
  // и эмодзи; счётчик по символам занижает трафик вдвое-вчетверо, и
  // диагностика «сколько ест игра» врёт.
  const env = setup();
  try {
    env.net.connect();
    env.ws.last().fireOpen();
    env.net.send('setName', { name: 'Змейка🐍' });
    const payload = env.ws.last().sent[0];
    assert.equal(env.log.bytesOut.at(-1), new TextEncoder().encode(payload).length);
    assert.ok(env.log.bytesOut.at(-1) > payload.length, 'байт должно быть больше, чем символов');
  } finally {
    env.restore();
  }
});

test('onOpen получает send и вызывается один раз на открытие', () => {
  const env = setup();
  try {
    env.net.connect();
    env.ws.last().fireOpen();
    assert.equal(env.log.open.length, 1);
    assert.equal(typeof env.log.open[0].send, 'function');
    assert.equal(env.log.open[0].send('hi', {}), true);
  } finally {
    env.restore();
  }
});

test('бросивший onOpen не мешает пингу и статусу', () => {
  // Ловит: снятие try/catch вокруг onOpen. В client.js там дёргается DOM
  // (refreshRoomsBtn?.click()) — исключение оставляло бы соединение без
  // пинга и без обновления интерфейса.
  const env = setup({ netOpts: { onOpen: () => { throw new Error('dom'); } } });
  const con = captureConsole();
  try {
    env.net.connect();
    env.ws.last().fireOpen();
    assert.equal(con.errors[0][0], 'ws_onopen_handler_error');
    assert.equal(env.timers.intervals().length, 1);
    assert.equal(env.net.isConnected(), true);
  } finally {
    con.restore();
    env.restore();
  }
});

// --- разбор входящих --------------------------------------------------------

test('текстовое сообщение: JSON разбирается, трафик считается в байтах', () => {
  const env = setup();
  try {
    env.net.connect();
    const s = env.ws.last();
    s.fireOpen();
    const raw = JSON.stringify({ type: 'hello', data: { token: 'тк', roomLimit: 8 } });
    s.fireMessage(raw);

    assert.deepEqual(env.log.text[0], ['hello', { token: 'тк', roomLimit: 8 }]);
    assert.equal(env.log.bytesIn.at(-1), new TextEncoder().encode(raw).length);
  } finally {
    env.restore();
  }
});

test('битый JSON не роняет модуль и не зовёт прикладной обработчик', () => {
  // Ловит: JSON.parse без try/catch. Обрезанный фрейм (это бывает при
  // разрыве на мобильной сети) убивал бы onmessage целиком: соединение
  // формально живо, но клиент больше не видит ни одного сообщения.
  const env = setup();
  try {
    env.net.connect();
    const s = env.ws.last();
    s.fireOpen();

    for (const bad of ['{"type":', 'not json', '', '{oops}', 'undefined']) {
      assert.doesNotThrow(() => s.fireMessage(bad));
    }
    assert.equal(env.log.text.length, 0);
    // Трафик всё равно посчитан — байты по проводу пришли.
    assert.equal(env.log.bytesIn.length, 5);

    // И главное: следующее валидное сообщение обрабатывается как ни в чём не бывало.
    s.fireMessage(JSON.stringify({ type: 'ok', data: 1 }));
    assert.deepEqual(env.log.text[0], ['ok', 1]);
  } finally {
    env.restore();
  }
});

test('валидный JSON без type/data не роняет обработчик', () => {
  // Ловит: снятие optional chaining на msg?.type — сервер (или прокси)
  // может прислать голый литерал.
  const env = setup();
  try {
    env.net.connect();
    env.ws.last().fireOpen();
    for (const raw of ['null', '123', '"str"', '[]', '{}']) {
      assert.doesNotThrow(() => env.ws.last().fireMessage(raw));
    }
    assert.equal(env.log.text.length, 5);
    assert.deepEqual(env.log.text.at(-1), [undefined, undefined]);
  } finally {
    env.restore();
  }
});

test('исключение в onTextMsg логируется и не убивает сокет', () => {
  // Ловит: снятие try/catch вокруг прикладного обработчика. Одна ошибка
  // отрисовки в ответ на одно сообщение не должна разрывать соединение.
  let calls = 0;
  const env = setup({
    onTextMsg: () => {
      calls++;
      throw new Error('render blew up');
    }
  });
  const con = captureConsole();
  try {
    env.net.connect();
    const s = env.ws.last();
    s.fireOpen();
    assert.doesNotThrow(() => s.fireMessage('{"type":"a"}'));
    assert.doesNotThrow(() => s.fireMessage('{"type":"b"}'));
    assert.equal(calls, 2);
    assert.equal(con.errors.length, 2);
    assert.equal(con.errors[0][0], 'ws_text_handler_error');
    assert.equal(env.net.isConnected(), true);
  } finally {
    con.restore();
    env.restore();
  }
});

test('бинарное сообщение: ArrayBuffer уходит в onBinaryMsg, байты считаются', () => {
  // Ловит: путаницу веток text/binary — весь мир (сегменты, территория)
  // приходит бинарём, ошибка здесь = чёрный экран при живом соединении.
  const env = setup();
  try {
    env.net.connect();
    const s = env.ws.last();
    s.fireOpen();
    const buf = new Uint8Array([1, 2, 3, 4, 5]).buffer;
    s.fireMessage(buf);

    assert.equal(env.log.binary.length, 1);
    assert.equal(env.log.binary[0], buf);
    assert.equal(env.log.bytesIn.at(-1), 5);
    assert.equal(env.log.text.length, 0);
  } finally {
    env.restore();
  }
});

test('исключение в onBinaryMsg логируется и не убивает сокет', () => {
  const env = setup({
    onBinaryMsg: () => {
      throw new Error('decode');
    }
  });
  const con = captureConsole();
  try {
    env.net.connect();
    const s = env.ws.last();
    s.fireOpen();
    assert.doesNotThrow(() => s.fireMessage(new Uint8Array([1]).buffer));
    assert.equal(con.errors[0][0], 'ws_binary_handler_error');
    assert.equal(env.net.isConnected(), true);
  } finally {
    con.restore();
    env.restore();
  }
});

test('Blob-подобные данные разбираются через arrayBuffer()', async () => {
  // Ловит: потерю запасной ветки. Если binaryType по какой-то причине не
  // применился (старый WebView), данные приходят Blob-ом — без этой ветки
  // мир просто не декодируется, и это не видно ни по одной ошибке.
  const env = setup();
  try {
    env.net.connect();
    const s = env.ws.last();
    s.fireOpen();
    const buf = new Uint8Array([7, 7, 7]).buffer;
    await s.fireMessage({ arrayBuffer: () => Promise.resolve(buf) });

    assert.equal(env.log.binary.length, 1);
    assert.equal(env.log.binary[0], buf);
    assert.equal(env.log.bytesIn.at(-1), 3);
  } finally {
    env.restore();
  }
});

test('исключение в onBinaryMsg на Blob-ветке тоже ловится', async () => {
  const env = setup({
    onBinaryMsg: () => {
      throw new Error('decode');
    }
  });
  const con = captureConsole();
  try {
    env.net.connect();
    const s = env.ws.last();
    s.fireOpen();
    await s.fireMessage({ arrayBuffer: () => Promise.resolve(new Uint8Array([1]).buffer) });
    assert.equal(con.errors[0][0], 'ws_binary_handler_error');
  } finally {
    con.restore();
    env.restore();
  }
});

test('данные неизвестного вида игнорируются молча', () => {
  const env = setup();
  try {
    env.net.connect();
    const s = env.ws.last();
    s.fireOpen();
    for (const d of [null, undefined, 42, true, {}]) assert.doesNotThrow(() => s.fireMessage(d));
    assert.equal(env.log.binary.length, 0);
    assert.equal(env.log.text.length, 0);
  } finally {
    env.restore();
  }
});

test('счётчики трафика: бросивший onBytesIn/onBytesOut не мешает разбору', () => {
  // Ловит: снятие try/catch вокруг счётчиков — телеметрия не должна иметь
  // возможности сломать сам протокол.
  const env = setup({
    netOpts: {
      onBytesIn: () => {
        throw new Error('counter');
      },
      onBytesOut: () => {
        throw new Error('counter');
      }
    }
  });
  try {
    env.net.connect();
    const s = env.ws.last();
    s.fireOpen();
    assert.equal(env.net.send('a', {}), true);
    assert.doesNotThrow(() => s.fireMessage('{"type":"x","data":2}'));
    assert.deepEqual(env.log.text[0], ['x', 2]);
  } finally {
    env.restore();
  }
});

// --- статус -----------------------------------------------------------------

test('statusSuffix: четыре состояния различимы', () => {
  // Ловит: слипшиеся ветки статуса. Это единственная обратная связь игроку
  // о том, что происходит со связью; «offline» вместо «reconnecting»
  // заставляет перезагружать страницу и терять комнату.
  const env = setup();
  try {
    assert.equal(env.net.statusSuffix(), ' • net.offline');

    env.net.connect();
    assert.equal(env.ws.last().readyState, WS_STATES.CONNECTING);
    assert.equal(env.net.statusSuffix(), ' • net.connecting');

    env.ws.last().fireOpen();
    assert.equal(env.net.statusSuffix(), '');

    env.ws.last().fireClose();
    assert.equal(env.net.statusSuffix(), ' • net.reconnecting');
  } finally {
    env.restore();
  }
});

test('statusSuffix: без переводчика отдаёт ключи, а не падает', () => {
  const timers = installFakeTimers();
  const loc = installLocation();
  const wsEnv = installWebSocket();
  try {
    const net = createNetModule({});
    assert.equal(net.statusSuffix(), ' • net.offline');
  } finally {
    wsEnv.restore();
    loc.restore();
    timers.restore();
  }
});

test('onStatusChange дёргается на подключении, открытии и обрыве', () => {
  // Ловит: потерю уведомления в одной из точек — интерфейс комнат тогда
  // застывает в состоянии, которого уже нет.
  const env = setup();
  try {
    env.net.connect();
    assert.equal(env.log.status, 1);
    env.ws.last().fireOpen();
    assert.equal(env.log.status, 2);
    env.ws.last().fireDrop();
    assert.equal(env.log.status, 3, 'двойное событие обрыва не должно давать двойной статус');
  } finally {
    env.restore();
  }
});

test('бросивший onStatusChange не мешает работе', () => {
  const env = setup({
    netOpts: {
      onStatusChange: () => {
        throw new Error('ui');
      }
    }
  });
  try {
    assert.doesNotThrow(() => env.net.connect());
    assert.doesNotThrow(() => env.ws.last().fireOpen());
    assert.doesNotThrow(() => env.ws.last().fireClose());
    assert.equal(env.onceTimers().length, 1);
  } finally {
    env.restore();
  }
});

test('модуль работает и вовсе без колбэков', () => {
  // Ловит: обращение к opts.* без проверки типа — фабрика должна быть
  // устойчива к частичной конфигурации.
  const timers = installFakeTimers();
  const rnd = installRandom([0.5]);
  const loc = installLocation();
  const wsEnv = installWebSocket();
  try {
    const net = createNetModule();
    net.connect();
    const s = wsEnv.last();
    assert.doesNotThrow(() => s.fireOpen());
    assert.doesNotThrow(() => net.send('a', {}));
    assert.doesNotThrow(() => s.fireMessage('{"type":"x"}'));
    assert.doesNotThrow(() => s.fireMessage(new Uint8Array([1]).buffer));
    assert.doesNotThrow(() => s.fireDrop());
    assert.doesNotThrow(() => timers.advance(2000));
  } finally {
    wsEnv.restore();
    loc.restore();
    rnd.restore();
    timers.restore();
  }
});
