/*
 * public/client_audio.js — исполняемые тесты.
 *
 * Модуль строит граф WebAudio на каждый звук. Три класса дорогих поломок:
 *
 *  1) ЛИМИТЕР. В перестрелке события летят десятками в секунду. Без
 *     ограничения «не более LIMIT_MAX за LIMIT_WINDOW_MS» получается каша,
 *     клиппинг и лавина узлов — это уже правили.
 *  2) ЧИСЛА. Любой NaN/Infinity в setValueAtTime — это исключение WebAudio,
 *     после которого голос не звучит вовсе. Все входы идут снаружи (сервер,
 *     настройки, вёрстка), поэтому кламп обязателен.
 *  3) МОЛЧАНИЕ. При выключенном звуке или громкости 0 не должно создаваться
 *     НИ ОДНОГО узла и даже AudioContext: на мобильных контекст сам по себе
 *     будит аудио-подсистему и ест батарею.
 *
 * Каждый нетривиальный тест подписан: какую поломку он ловит.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createAudioModule } from '../public/client_audio.js';
import {
  installFakeTimers,
  installRandom,
  installAudioEnv,
  badAudioNumbers,
  captureConsole
} from './helpers/env_mock.mjs';

/**
 * Стенд: фальшивые часы (performance.now лимитера + таймер очереди),
 * фальшивый Math.random (offset шума и заполнение буфера), мок AudioContext.
 * sampleRate маленький — буфер шума заполняется циклом по сэмплам.
 */
function setup(opts = {}) {
  const timers = installFakeTimers(100_000);
  const rnd = installRandom(opts.random ?? [0.5]);
  const env = installAudioEnv({ sampleRate: 64, ...opts.audio });
  const audio = createAudioModule();

  const state = {
    soundEnabled: opts.soundEnabled ?? true,
    soundVolume: opts.soundVolume ?? 1
  };
  if (opts.configure !== false) audio.configure(() => state);

  return {
    audio,
    state,
    timers,
    rnd,
    env,
    ctx: () => env.ctx(),
    log: () => env.ctx()?.__log ?? [],
    nodes: (kind) => (env.ctx()?.__nodes ?? []).filter((n) => n.__kind === kind),
    /** Частоты, поставленные осцилляторам — по ним видно, что и в каком порядке сыграло. */
    oscFreqs: () =>
      (env.ctx()?.__log ?? [])
        .filter((e) => e.op === 'param' && e.kind === 'osc' && e.name === 'frequency' && e.call === 'setValueAtTime')
        .map((e) => e.v),
    restore() {
      env.restore();
      rnd.restore();
      timers.restore();
    }
  };
}

// --- молчание ---------------------------------------------------------------

test('звук выключен: AudioContext даже не создаётся', () => {
  // Ловит: создание контекста до проверки настройки. Живой AudioContext на
  // мобильном держит аудио-подсистему разбуженной и ест батарею, даже когда
  // игрок выключил звук.
  const s = setup({ soundEnabled: false });
  try {
    s.audio.tone({ freq: 440 });
    s.audio.chord([440, 550], 200);
    s.audio.arp([440, 550], 90);
    s.audio.sweep(200, 800, 300);
    s.audio.noiseBurst(200, 'lowpass', 1200);
    assert.equal(s.env.ctorCalls(), 0);
  } finally {
    s.restore();
  }
});

test('громкость 0 или мусорная: ни одного узла', () => {
  // Ловит: потерю проверки volumeScale() <= 0 в gate. Ползунок на нуле
  // должен означать полную тишину, а не «тихо, но узлы всё равно строим».
  for (const v of [0, -1, NaN, 'abc', {}, [1, 2]]) {
    const s = setup();
    try {
      s.state.soundVolume = v;
      s.audio.tone({ freq: 440 });
      assert.equal(s.env.ctorCalls(), 0, `soundVolume=${String(v)}`);
    } finally {
      s.restore();
    }
  }
  // Отсутствующее поле громкости — тоже тишина, а не «по умолчанию громко».
  const s = setup();
  try {
    delete s.state.soundVolume;
    s.audio.tone({ freq: 440 });
    assert.equal(s.env.ctorCalls(), 0);
  } finally {
    s.restore();
  }
});

test('без configure и со сломанным getState — тишина, но не исключение', () => {
  // Ловит: обращение к состоянию без try/catch. getState зовётся из
  // client.js и может бросить в момент перезагрузки настроек.
  const s = setup({ configure: false });
  try {
    assert.doesNotThrow(() => s.audio.tone({ freq: 440 }));
    assert.equal(s.env.ctorCalls(), 0);

    s.audio.configure(() => {
      throw new Error('state broken');
    });
    assert.doesNotThrow(() => s.audio.tone({ freq: 440 }));
    assert.equal(s.env.ctorCalls(), 0);

    s.audio.configure('not a function');
    assert.doesNotThrow(() => s.audio.tone({ freq: 440 }));
  } finally {
    s.restore();
  }
});

test('AudioContext недоступен или бросает — модуль молчит без падения', () => {
  // Ловит: непойманное исключение конструктора. В Safari до жеста
  // пользователя и в части WebView создание контекста бросает.
  for (const audioOpts of [{ noAudioCtor: true }, { throwOnCtor: true }]) {
    const s = setup({ audio: audioOpts });
    try {
      assert.doesNotThrow(() => s.audio.tone({ freq: 440 }));
      assert.doesNotThrow(() => s.audio.resume());
    } finally {
      s.restore();
    }
  }
});

// --- шина -------------------------------------------------------------------

test('шина: master -> общий выход -> компрессор -> destination, и строится один раз', () => {
  // Ловит: потерю компрессора (аккорды и наложения начинают клиппировать)
  // и пересоздание шины на каждый звук (утечка узлов + скачки громкости).
  //
  // Шин две: общий выход (front) и просадка (master). Крупное событие
  // приглушает master, но само идёт в front — иначе удар глушит сам себя.
  const s = setup();
  try {
    s.audio.tone({ freq: 440 });
    s.audio.tone({ freq: 550 });

    const comps = s.nodes('compressor');
    assert.equal(comps.length, 1);
    const out = s.nodes('gain')[0];
    const master = s.nodes('gain')[1];
    assert.equal(out.__connected[0], comps[0]);
    assert.equal(comps[0].__connected[0], s.ctx().destination);
    assert.equal(master.__connected[0], out);
    // общий выход + просадка + по одному gain на голос
    assert.equal(s.nodes('gain').length, 4);
    assert.equal(s.env.ctorCalls(), 1);
  } finally {
    s.restore();
  }
});

test('шина: обычный голос идёт через просадку, front — мимо неё', () => {
  // Ловит: возврат к одной шине. Если голоса крупного события снова попадут
  // в master, duck() под тем же событием прижмёт его собственный удар — ровно
  // то, ради чего шина и разделена.
  const s = setup();
  try {
    s.audio.tone({ freq: 440 });
    s.audio.tone({ freq: 550, front: true });

    const out = s.nodes('gain')[0];
    const master = s.nodes('gain')[1];
    assert.equal(s.nodes('gain')[2].__connected[0], master, 'обычный голос — в просадку');
    assert.equal(s.nodes('gain')[3].__connected[0], out, 'front-голос — в общий выход');
  } finally {
    s.restore();
  }
});

test('duck: просадка ведёт master вниз и обязательно возвращает к единице', () => {
  // Ловит: застрявшую просадку. Если обратный пандус потеряется, вся игра
  // после первой же смерти навсегда останется вдвое тише.
  const s = setup();
  try {
    s.audio.tone({ freq: 440 });
    const master = s.nodes('gain')[1];
    const before = master.gain.__calls.length;

    s.audio.duck(0.5, 400);

    const calls = master.gain.__calls.slice(before);
    assert.deepEqual(
      calls.map((c) => c[0]),
      ['cancelScheduledValues', 'setValueAtTime', 'linearRampToValueAtTime', 'linearRampToValueAtTime']
    );
    assert.equal(calls[2][1], 0.5);
    assert.equal(calls[3][1], 1);
    assert.ok(calls[3][2] > calls[2][2], 'возврат позже провала');
  } finally {
    s.restore();
  }
});

test('duck: нулевая и мусорная величина ничего не трогают', () => {
  // Ловит: NaN в setValueAtTime — после него автоматика параметра ломается
  // целиком, и громкость больше не восстановится.
  const s = setup();
  try {
    s.audio.tone({ freq: 440 });
    const master = s.nodes('gain')[1];
    const before = master.gain.__calls.length;
    s.audio.duck(0, 400);
    assert.equal(master.gain.__calls.length, before);
    for (const junk of [NaN, Infinity, -1, 'abc', null, undefined, {}]) {
      assert.doesNotThrow(() => s.audio.duck(junk, junk));
    }
    assert.deepEqual(badAudioNumbers(s.log()), []);
  } finally {
    s.restore();
  }
});

test('шина: без компрессора master подключается напрямую к выходу', () => {
  // Ловит: отсутствие запасного пути. DynamicsCompressor есть не везде;
  // без fallback игра теряет звук целиком, а не только компрессию.
  const s = setup({ audio: { noCompressor: true } });
  try {
    s.audio.tone({ freq: 440 });
    assert.equal(s.nodes('compressor').length, 0);
    assert.equal(s.nodes('gain')[0].__connected[0], s.ctx().destination);
    assert.ok(s.oscFreqs().length > 0, 'звук всё равно должен играть');
  } finally {
    s.restore();
  }
});

test('шина: недоступный createGain — тишина без исключения', () => {
  // Ловит: непойманное исключение при построении шины. Если браузер
  // отказал в узлах (лимит узлов, контекст закрыт), игра должна просто
  // онеметь, а не уронить кадр.
  const timers = installFakeTimers(100_000);
  const rnd = installRandom([0.5]);
  const prevWindow = globalThis.window;
  const had = 'window' in globalThis;
  globalThis.window = {
    AudioContext: function () {
      return {
        state: 'running',
        currentTime: 10,
        sampleRate: 64,
        destination: {},
        createGain() {
          throw new Error('node limit');
        }
      };
    }
  };
  try {
    const audio = createAudioModule();
    audio.configure(() => ({ soundEnabled: true, soundVolume: 1 }));
    assert.doesNotThrow(() => audio.tone({ freq: 440 }));
    assert.doesNotThrow(() => audio.tone({ freq: 550 }));
    assert.equal(timers.count(), 0, 'без шины очередь заводиться не должна');
  } finally {
    if (had) globalThis.window = prevWindow;
    else delete globalThis.window;
    rnd.restore();
    timers.restore();
  }
});

test('шина: приостановленный контекст возобновляется', () => {
  // Ловит: потерю ctx.resume(). После автопаузы (сворачивание вкладки)
  // контекст остаётся suspended и игра навсегда немеет.
  const s = setup({ audio: { state: 'suspended' } });
  try {
    s.audio.tone({ freq: 440 });
    assert.ok(s.ctx().resumeCalls >= 1);
  } finally {
    s.restore();
  }
});

test('resume(): не создаёт лишних контекстов и не падает без звука', () => {
  const s = setup();
  try {
    s.audio.tone({ freq: 440 });
    const before = s.env.ctorCalls();
    s.audio.resume();
    assert.equal(s.env.ctorCalls(), before);
    assert.ok(s.ctx().resumeCalls >= 1);
  } finally {
    s.restore();
  }
});

// --- лимитер и очередь ------------------------------------------------------

test('лимитер: за окно проходит не более LIMIT_MAX звуков', () => {
  // Ловит: снятие/ослабление лимитера. В перестрелке события летят
  // десятками в секунду — без ограничения получается каша и клиппинг,
  // а число узлов WebAudio растёт лавиной.
  const s = setup();
  try {
    for (let i = 0; i < 10; i++) s.audio.tone({ freq: 300 + i });
    assert.equal(s.oscFreqs().length, 4, 'мгновенно должно сыграть ровно 4');
  } finally {
    s.restore();
  }
});

test('лимитер: отложенные звуки доигрывают после окна', () => {
  // Ловит: молчаливую потерю очереди — важные звуки (гибель, захват) не
  // должны исчезать только потому, что попали в плотный момент.
  const s = setup();
  try {
    for (let i = 0; i < 6; i++) s.audio.tone({ freq: 300 + i });
    assert.equal(s.oscFreqs().length, 4);

    s.timers.advance(300); // окно 250 мс истекло, drain сработал
    assert.equal(s.oscFreqs().length, 6);
  } finally {
    s.restore();
  }
});

test('лимитер: окно скользящее — новый звук после паузы проходит сразу', () => {
  // Ловит: замену скользящего окна на «раз в 250 мс не больше 4 суммарно
  // за всё время» — редкие одиночные звуки не должны задерживаться.
  const s = setup();
  try {
    for (let i = 0; i < 4; i++) s.audio.tone({ freq: 300 + i });
    s.timers.advance(1000);
    s.audio.tone({ freq: 999 });
    assert.equal(s.oscFreqs().at(-1), 999);
    assert.equal(s.timers.count(), 0, 'одиночный звук не должен заводить таймер очереди');
  } finally {
    s.restore();
  }
});

test('event: слои одного звука стоят в окне лимитера как один звук', () => {
  // Ловит: возврат к «лимитер считает голоса». Удар — это щелчок, тело и
  // суб; если каждый слой занимает своё место в окне, то на четыре слоя
  // приходится всё окно, и уже второе событие подряд начинает рассыпаться.
  const s = setup();
  try {
    const layered = () => {
      s.audio.tone({ freq: 100 });
      s.audio.tone({ freq: 200 });
      s.audio.tone({ freq: 300 });
    };
    for (let i = 0; i < 4; i++) s.audio.event(3, layered);
    assert.equal(s.oscFreqs().length, 12, 'четыре события по три слоя проходят целиком');

    s.audio.event(3, layered);
    assert.equal(s.oscFreqs().length, 12, 'пятое событие уже за окном');
  } finally {
    s.restore();
  }
});

test('event: отложенное событие доигрывает целиком, а не по слоям', () => {
  // Ловит: расползание слоёв по времени. Ради этого слои и группируются:
  // щелчок, ушедший в очередь без своего суба, звучит как чужой звук.
  const s = setup();
  try {
    for (let i = 0; i < 4; i++) s.audio.tone({ freq: 10 + i });
    s.audio.event(5, () => {
      s.audio.tone({ freq: 700 });
      s.audio.noiseBurst(80, 'lowpass', 900);
      s.audio.tone({ freq: 900 });
    });
    assert.equal(s.oscFreqs().length, 4, 'событие целиком ушло в очередь');

    s.timers.advance(300);
    assert.deepEqual(s.oscFreqs().slice(-2), [700, 900]);
    assert.equal(s.nodes('bufsrc').length, 1, 'шумовой слой пришёл вместе с тоновыми');
  } finally {
    s.restore();
  }
});

test('event: при выключенном звуке слои даже не считаются', () => {
  const s = setup({ soundEnabled: false });
  try {
    let built = 0;
    s.audio.event(5, () => {
      built++;
      s.audio.tone({ freq: 440 });
    });
    assert.equal(built, 0);
    assert.equal(s.env.ctorCalls(), 0);
  } finally {
    s.restore();
  }
});

test('duck: при выключенном звуке не будит AudioContext', () => {
  // Ловит: просадку в обход настройки. duck() зовётся первой строкой
  // крупных событий, и без этой проверки выключенный звук всё равно
  // создавал бы контекст — то есть держал бы разбуженной аудио-подсистему
  // телефона ровно теми же событиями, что и раньше.
  const s = setup({ soundEnabled: false });
  try {
    s.audio.duck(0.5, 400);
    assert.equal(s.env.ctorCalls(), 0);
  } finally {
    s.restore();
  }
});

test('приоритет: важный звук вытесняет мелкий из очереди', () => {
  // Ловит: очередь FIFO вместо приоритетной. Тогда в бою «гибель» звучала
  // бы после десятка «шуршаний», то есть уже не в тот момент.
  const s = setup();
  try {
    for (let i = 0; i < 4; i++) s.audio.tone({ freq: 100 + i, prio: 0 });
    s.audio.tone({ freq: 700, prio: 1 });
    s.audio.tone({ freq: 900, prio: 9 }); // важный, пришёл последним
    s.audio.tone({ freq: 800, prio: 5 });

    s.timers.advance(300);
    const played = s.oscFreqs().slice(4);
    assert.deepEqual(played, [900, 800, 700], 'порядок должен быть по приоритету, не по времени');
  } finally {
    s.restore();
  }
});

test('очередь: протухшие звуки отбрасываются, а не играют с опозданием', () => {
  // Ловит: снятие QUEUE_STALE_MS. Звук события, случившегося секунду назад,
  // играть уже вредно: он рассинхронизирован с картинкой и воспринимается
  // как «эхо» чужих действий.
  const s = setup();
  try {
    for (let i = 0; i < 4; i++) s.audio.tone({ freq: 100 + i, prio: 5 });
    for (let i = 0; i < 12; i++) s.audio.tone({ freq: 500 + i, prio: 1 });

    s.timers.advance(2000); // очередь успевает протухнуть
    const total = s.oscFreqs().length;
    assert.ok(total > 4, 'часть очереди должна была сыграть');
    assert.ok(total < 16, `протухшее не должно доигрывать, сыграло ${total}`);
    assert.equal(s.timers.count(), 0, 'таймер очереди не должен остаться висеть');
  } finally {
    s.restore();
  }
});

test('очередь: длина ограничена, лишним жертвуется самый неважный', () => {
  // Ловит: снятие QUEUE_CAP. Очередь без потолка растёт вместе с потоком
  // событий, и память вместе с ней.
  const s = setup();
  try {
    for (let i = 0; i < 4; i++) s.audio.tone({ freq: 100 + i, prio: 9 });
    // 14 кандидатов на 12 мест: приоритеты 1..14, вылететь должны 1 и 2.
    for (let i = 1; i <= 14; i++) s.audio.tone({ freq: 1000 + i, prio: i });

    s.timers.advance(300); // первая порция слива: 4 самых приоритетных
    const played = s.oscFreqs().slice(4);
    assert.equal(played.length, 4);
    assert.deepEqual(played, [1014, 1013, 1012, 1011]);
    // Выброшенные из-за потолка так и не сыграют.
    s.timers.advance(5000);
    const all = s.oscFreqs();
    assert.ok(!all.includes(1001), 'самый неважный должен быть вытеснен');
    assert.ok(!all.includes(1002));
  } finally {
    s.restore();
  }
});

test('исключение внутри голоса не рвёт лимитер', () => {
  // Ловит: снятие try/catch в gate/voice. Одна ошибка WebAudio не должна
  // оставлять счётчик лимитера в неконсистентном состоянии.
  const s = setup();
  const con = captureConsole();
  try {
    s.audio.tone({ freq: 440 });
    const ctx = s.ctx();
    const good = ctx.createGain;
    ctx.createGain = () => {
      throw new Error('oom');
    };
    assert.doesNotThrow(() => s.audio.tone({ freq: 550 }));
    assert.equal(con.errors[0][0], 'audio_voice_error');
    ctx.createGain = good;
    assert.doesNotThrow(() => s.audio.tone({ freq: 660 }));
    assert.equal(s.oscFreqs().at(-1), 660);
  } finally {
    con.restore();
    s.restore();
  }
});

// --- числа ------------------------------------------------------------------

test('никаких NaN/Infinity в расписании параметров при любом мусоре на входе', () => {
  // Ловит: потерю clampNum на любом из входов. NaN в setValueAtTime — это
  // исключение WebAudio: голос не звучит вовсе, а в консоли пусто, потому
  // что исключение съедает внешний catch.
  const s = setup();
  const junk = [undefined, null, NaN, Infinity, -Infinity, 'abc', {}, [], true];
  try {
    for (const j of junk) {
      s.audio.tone({ freq: j, dur: j, vol: 1, delay: j, attack: j, decay: j, detune: j });
      s.timers.advance(300);
      // Те же грабли на новых входах: панорама приходит из мира, посыл и
      // перегруз — из палитры, модуляция считается от частоты.
      s.audio.tone({ freq: 440, vol: 1, pan: j, send: j, drive: j, bend: j, unison: j, unisonCents: j });
      s.timers.advance(300);
      s.audio.tone({ freq: 440, vol: 1, fm: { ratio: j, index: j }, vibrato: { rate: j, cents: j, delay: j } });
      s.timers.advance(300);
      s.audio.sweep(j, j, j, 'square');
      s.timers.advance(300);
      s.audio.chord([440, j, 550], j, { vol: j, spread: j });
      s.timers.advance(300);
      s.audio.arp([440, 550], j, { dur: j });
      s.timers.advance(300);
      s.audio.noiseBurst(j, 'lowpass', j, { q: j, cutoff2: j });
      s.timers.advance(300);
    }
    const bad = badAudioNumbers(s.log());
    assert.deepEqual(bad, [], `нечисловые аргументы: ${JSON.stringify(bad.slice(0, 3))}`);
    assert.ok(s.oscFreqs().length > 0, 'при мусоре модуль должен играть значения по умолчанию');
  } finally {
    s.restore();
  }
});

test('частота зажимается в 20..8000 Гц', () => {
  // Ловит: снятие клампа частоты. Выше половины sampleRate осциллятор
  // даёт алиасинг (свист), ниже 20 Гц — щелчки в динамике.
  const s = setup();
  try {
    s.audio.tone({ freq: 1e9 });
    s.audio.tone({ freq: 0.0001 });
    s.audio.tone({ freq: -500 });
    s.audio.tone({ freq: 'abc' }); // мусор -> значение по умолчанию
    assert.deepEqual(s.oscFreqs(), [8000, 20, 20, 440]);
  } finally {
    s.restore();
  }
});

test('длительность зажимается: звук не длится дольше 4 секунд', () => {
  // Ловит: снятие клампа dur. Осциллятор с dur из битого пакета мог бы
  // остаться звучать до конца сессии — гудок поверх всей игры.
  const s = setup();
  try {
    s.audio.tone({ freq: 440, dur: 1e9 });
    const osc = s.nodes('osc')[0];
    const t0 = s.ctx().currentTime;
    const stop = osc.__stopped[0];
    assert.ok(stop <= t0 + 4 + 0.05, `stop=${stop}`);
    assert.ok(stop > t0, 'звук должен иметь положительную длину');
  } finally {
    s.restore();
  }
});

test('громкость складывается из vol и настройки игрока', () => {
  // Ловит: игнор ползунка громкости — vol из вызова не должен обходить
  // пользовательскую настройку.
  const s = setup({ soundVolume: 0.5 });
  try {
    s.audio.tone({ freq: 440, vol: 1 });
    const peaks = s
      .log()
      .filter((e) => e.op === 'param' && e.kind === 'gain' && e.call === 'exponentialRampToValueAtTime');
    assert.ok(Math.abs(peaks[0].v - 0.5) < 1e-9, `peak=${peaks[0].v}`);
  } finally {
    s.restore();
  }
});

test('vol=0 при включённом звуке: голос не строит источник', () => {
  // Ловит: потерю ранней проверки vol <= 0 в voice — иначе создавался бы
  // полный граф ради тишины.
  const s = setup();
  try {
    s.audio.tone({ freq: 440, vol: 0 });
    assert.equal(s.nodes('osc').length, 0);
  } finally {
    s.restore();
  }
});

// --- форма голоса -----------------------------------------------------------

test('sweep: заметная разница частот даёт скольжение, незаметная — нет', () => {
  // Ловит: ramp на каждый вызов (лишнее расписание) и, наоборот, потерю
  // скольжения — свип превращается в ровный тон.
  const s = setup();
  try {
    s.audio.sweep(200, 800, 300, 'sawtooth');
    let ramps = s.log().filter((e) => e.kind === 'osc' && e.call === 'exponentialRampToValueAtTime');
    assert.equal(ramps.length, 1);
    assert.equal(ramps[0].v, 800);
    assert.equal(s.nodes('osc')[0].type, 'sawtooth');

    s.audio.sweep(400, 400.2, 300);
    ramps = s.log().filter((e) => e.kind === 'osc' && e.call === 'exponentialRampToValueAtTime');
    assert.equal(ramps.length, 1, 'разница 0.2 Гц не должна порождать скольжение');
  } finally {
    s.restore();
  }
});

test('exp:false переводит скольжение в линейное', () => {
  const s = setup();
  try {
    s.audio.sweep(200, 800, 300, 'sine', { exp: false });
    const lin = s.log().filter((e) => e.kind === 'osc' && e.call === 'linearRampToValueAtTime');
    assert.equal(lin.length, 1);
    assert.equal(lin[0].v, 800);
  } finally {
    s.restore();
  }
});

test('фильтр: узел вставляется между голосом и шиной', () => {
  // Ловит: разрыв цепочки gain -> filter -> master. Если фильтр создан, но
  // не подключён, звук идёт мимо него (или пропадает совсем).
  const s = setup();
  try {
    s.audio.tone({ freq: 440, filter: { type: 'bandpass', freq: 900, freq2: 300, q: 4 } });
    const filt = s.nodes('biquad')[0];
    const master = s.nodes('gain')[1];
    const voiceGain = s.nodes('gain')[2];
    assert.equal(filt.type, 'bandpass');
    assert.equal(voiceGain.__connected[0], filt);
    assert.equal(filt.__connected[0], master);
    assert.deepEqual(filt.Q.__calls[0], ['setValueAtTime', 4, s.ctx().currentTime]);
  } finally {
    s.restore();
  }
});

// --- пространство и характер ------------------------------------------------

test('панорама: узел появляется только при ненулевом pan и зажимается', () => {
  // Ловит: панорамирование каждого голоса. Событие в центре экрана обязано
  // идти без лишнего узла, иначе на каждый мелкий захват приходится ещё один
  // элемент графа — а их за матч тысячи.
  const s = setup();
  try {
    s.audio.tone({ freq: 440 });
    assert.equal(s.nodes('panner').length, 0);

    s.audio.tone({ freq: 440, pan: 9 });
    const p = s.nodes('panner')[0];
    assert.equal(p.pan.__calls[0][1], 1, 'панорама зажата в [-1, 1]');
    const master = s.nodes('gain')[1];
    assert.equal(s.nodes('gain')[3].__connected[0], p, 'голос -> панорама');
    assert.equal(p.__connected[0], master, 'панорама -> шина');
  } finally {
    s.restore();
  }
});

test('панорама: браузер без StereoPanner всё равно играет звук', () => {
  // Ловит: обязательность узла. StereoPannerNode не везде есть; без
  // запасного пути событие пропадёт целиком вместо потери стерео.
  const s = setup({ audio: { noPanner: true } });
  try {
    s.audio.tone({ freq: 440, pan: -1 });
    assert.equal(s.nodes('panner').length, 0);
    assert.deepEqual(s.oscFreqs(), [440]);
  } finally {
    s.restore();
  }
});

test('реверб: свёртка строится один раз, а возврат идёт мимо просадки', () => {
  // Ловит: пересчёт импульсного отклика на каждый звук (полторы секунды
  // стереошума прямо в кадре смерти) и возврат хвоста в просаженную шину —
  // тогда реверб крупного события душит сам себя.
  const s = setup();
  try {
    s.audio.tone({ freq: 440, send: 0.5 });
    s.audio.tone({ freq: 550, send: 0.5 });

    const conv = s.nodes('convolver');
    assert.equal(conv.length, 1);
    const out = s.nodes('gain')[0];
    const wet = conv[0].__connected[0];
    assert.equal(wet.__connected[0], out, 'хвост возвращается в общий выход');
  } finally {
    s.restore();
  }
});

test('реверб: без send посыл не строится вовсе', () => {
  const s = setup();
  try {
    s.audio.tone({ freq: 440 });
    assert.equal(s.nodes('convolver').length, 0);
  } finally {
    s.restore();
  }
});

test('реверб: браузер без Convolver — сухой звук, но звук', () => {
  const s = setup({ audio: { noConvolver: true } });
  try {
    s.audio.tone({ freq: 440, send: 0.7 });
    assert.deepEqual(s.oscFreqs(), [440]);
  } finally {
    s.restore();
  }
});

test('перегруз: shaper встаёт перед огибающей и компенсирует громкость', () => {
  // Ловит: перегруз после огибающей. Насыщение имеет смысл только до неё:
  // иначе оно срезает спад, и удар превращается в ровный гудок.
  const s = setup();
  try {
    s.audio.tone({ freq: 440 });
    assert.equal(s.nodes('shaper').length, 0);

    s.audio.tone({ freq: 440, drive: 1 });
    const shaper = s.nodes('shaper')[0];
    assert.ok(shaper.curve && shaper.curve.length > 0, 'кривая задана');
    const gains = s.nodes('gain');
    const voiceGain = gains[3];
    const pre = gains[4];
    const post = gains[5];
    assert.equal(pre.__connected[0], shaper, 'подкачка -> shaper');
    assert.equal(shaper.__connected[0], post, 'shaper -> компенсация');
    assert.equal(post.__connected[0], voiceGain, 'компенсация -> огибающая');
    assert.ok(pre.gain.__calls[0][1] > 1 && post.gain.__calls[0][1] < 1);
  } finally {
    s.restore();
  }
});

test('перегруз: браузер без WaveShaper — чистый звук, но звук', () => {
  const s = setup({ audio: { noShaper: true } });
  try {
    s.audio.tone({ freq: 440, drive: 1 });
    assert.deepEqual(s.oscFreqs(), [440]);
  } finally {
    s.restore();
  }
});

test('унисон: копии расстроены симметрично, а суммарная громкость не растёт', () => {
  // Ловит: унисон «в лоб». Три копии на полной громкости — это +9 дБ и
  // клиппинг на каждом крупном захвате.
  const s = setup();
  try {
    s.audio.tone({ freq: 440, vol: 1, unison: 3, unisonCents: 12 });
    const oscs = s.nodes('osc');
    assert.equal(oscs.length, 3);
    // Средняя копия идёт без расстройки, и узлу её не задают вовсе — ноль
    // здесь означает «detune не трогали».
    const cents = oscs.map((o) => o.detune.__calls[0]?.[1] ?? 0);
    assert.deepEqual(cents, [-12, 0, 12]);
    const peak = s.nodes('gain')[2].gain.__calls.find((c) => c[0] === 'exponentialRampToValueAtTime')[1];
    assert.ok(peak < 0.7, `каждая копия тише одиночного голоса: ${peak}`);
  } finally {
    s.restore();
  }
});

test('унисон: единица и мусор дают ровно один голос', () => {
  const s = setup();
  try {
    s.audio.tone({ freq: 440, unison: 1 });
    s.timers.advance(300);
    s.audio.tone({ freq: 440, unison: 'abc' });
    assert.equal(s.nodes('osc').length, 2);
    assert.equal(s.nodes('panner').length, 0, 'без унисона панораму не разводим');
  } finally {
    s.restore();
  }
});

test('FM: модулятор живёт ровно столько же, сколько несущая', () => {
  // Ловит: незакрытый модулятор. Осциллятор без stop() продолжает считаться
  // до конца сессии — за матч их набирается столько, что кадр проседает.
  const s = setup();
  try {
    s.audio.tone({ freq: 400, dur: 200, fm: { ratio: 3, index: 2 } });
    const oscs = s.nodes('osc');
    assert.equal(oscs.length, 2);
    const [carrier, mod] = oscs;
    assert.equal(mod.frequency.__calls[0][1], 1200, 'ratio считается от несущей');
    assert.equal(mod.__started.length, 1);
    assert.ok(mod.__stopped[0] >= carrier.__stopped[0], 'модулятор не переживает несущую');
  } finally {
    s.restore();
  }
});

test('bend: спад высоты укладывается в свой отрезок, а не в всю длительность', () => {
  // Ловит: потерю bend. Удар отличается от гудка именно тем, что высота
  // падает за первые миллисекунды, а тело тянется дальше.
  const s = setup();
  try {
    s.audio.tone({ freq: 300, freq2: 80, dur: 400, bend: 50 });
    const osc = s.nodes('osc')[0];
    const ramp = osc.frequency.__calls.find((c) => c[0] === 'exponentialRampToValueAtTime');
    const t0 = s.ctx().currentTime;
    assert.equal(ramp[1], 80);
    assert.ok(Math.abs(ramp[2] - (t0 + 0.05)) < 1e-6, `спад за 50 мс, а не за 400: ${ramp[2] - t0}`);
  } finally {
    s.restore();
  }
});

test('detune задаётся только когда запрошен и зажат по величине', () => {
  const s = setup();
  try {
    s.audio.tone({ freq: 440 });
    assert.equal(s.nodes('osc')[0].detune.__calls.length, 0);

    s.audio.tone({ freq: 440, detune: 1e6 });
    assert.equal(s.nodes('osc')[1].detune.__calls[0][1], 2400);
  } finally {
    s.restore();
  }
});

test('узлы отсоединяются после проигрывания', () => {
  // Ловит: потерю onended-уборки. Каждый несобранный узел остаётся
  // подключённым к шине; за матч их накапливаются тысячи, и WebAudio
  // начинает съедать кадр.
  const s = setup();
  try {
    s.audio.tone({ freq: 440, filter: { type: 'lowpass', freq: 900 } });
    const osc = s.nodes('osc')[0];
    const filt = s.nodes('biquad')[0];
    const gain = s.nodes('gain')[2];
    assert.equal(typeof osc.onended, 'function');

    osc.onended();
    assert.equal(osc.__disconnected, 1);
    assert.equal(filt.__disconnected, 1);
    assert.equal(gain.__disconnected, 1);
    // Обе шины живут дальше.
    assert.equal(s.nodes('gain')[0].__disconnected, 0);
    assert.equal(s.nodes('gain')[1].__disconnected, 0);
  } finally {
    s.restore();
  }
});

test('уборка не падает, если disconnect бросает', () => {
  const s = setup();
  try {
    s.audio.tone({ freq: 440 });
    const osc = s.nodes('osc')[0];
    osc.disconnect = () => {
      throw new Error('already gone');
    };
    assert.doesNotThrow(() => osc.onended());
  } finally {
    s.restore();
  }
});

// --- шум --------------------------------------------------------------------

test('noiseBurst: источник — буфер, зациклен, буфер считается один раз', () => {
  // Ловит: пересоздание буфера шума на каждый выстрел. Заполнение буфера —
  // цикл по сэмплам на секунду звука; в бою это заметная просадка кадра.
  const s = setup();
  try {
    s.audio.noiseBurst(120, 'lowpass', 1500);
    s.timers.advance(300);
    s.audio.noiseBurst(120, 'lowpass', 1500);

    assert.equal(s.ctx().createBufferCalls, 1);
    const src = s.nodes('bufsrc')[0];
    assert.equal(src.loop, true);
    assert.ok(src.buffer, 'буфер должен быть подставлен');
    assert.equal(s.nodes('osc').length, 0, 'шум не должен использовать осциллятор');
  } finally {
    s.restore();
  }
});

test('noiseBurst: смещение старта не выходит за буфер', () => {
  // Ловит: отрицательное или превышающее длину смещение — start() с таким
  // аргументом бросает, и выстрел остаётся беззвучным.
  const s = setup({ random: [0, 0.999999, 0.5] });
  try {
    for (let i = 0; i < 3; i++) {
      s.audio.noiseBurst(3000, 'lowpass', 1200); // dur больше длины буфера
      s.timers.advance(300);
    }
    for (const src of s.nodes('bufsrc')) {
      const [, off] = src.__started[0];
      assert.ok(Number.isFinite(off) && off >= 0, `off=${off}`);
      assert.ok(off <= 1, `off=${off}`);
    }
  } finally {
    s.restore();
  }
});

test('noiseBurst без фильтра подключается к шине напрямую', () => {
  const s = setup();
  try {
    s.audio.noiseBurst(120, null, 0);
    assert.equal(s.nodes('biquad').length, 0);
    assert.equal(s.nodes('bufsrc').length, 1);
  } finally {
    s.restore();
  }
});

test('сломанный createBuffer: шум молчит, но модуль жив', () => {
  const s = setup();
  try {
    s.audio.tone({ freq: 440 });
    s.ctx().createBuffer = () => {
      throw new Error('no buffer');
    };
    s.timers.advance(300);
    assert.doesNotThrow(() => s.audio.noiseBurst(120, 'lowpass', 1200));
    assert.equal(s.nodes('bufsrc').length, 0);
    s.timers.advance(300);
    s.audio.tone({ freq: 660 });
    assert.equal(s.oscFreqs().at(-1), 660, 'обычные тоны должны продолжать работать');
  } finally {
    s.restore();
  }
});

// --- аккорд и арпеджио ------------------------------------------------------

test('chord: играет все ноты, мусорные отбрасываются', () => {
  // Ловит: попадание NaN-ноты в осциллятор и потерю фильтрации массива.
  const s = setup();
  try {
    s.audio.chord([440, 'nope', 550, NaN, 660, undefined, {}], 200);
    assert.deepEqual(s.oscFreqs(), [440, 550, 660]);
    // null проходит фильтр (Number(null) === 0) и обязан быть зажат клампом
    // частоты, а не уехать нулём в осциллятор.
    s.timers.advance(300);
    s.audio.chord([null], 200);
    assert.equal(s.oscFreqs().at(-1), 20);
  } finally {
    s.restore();
  }
});

test('chord: громкость делится на корень из числа нот', () => {
  // Ловит: сложение громкостей без нормировки — аккорд из шести нот
  // уходит в клиппинг и звучит грязью.
  const s = setup();
  try {
    s.audio.chord([440, 550, 660, 770], 200, { vol: 1 });
    const peaks = s
      .log()
      .filter((e) => e.kind === 'gain' && e.call === 'exponentialRampToValueAtTime' && e.v > 0.001)
      .map((e) => e.v);
    assert.equal(peaks.length, 4);
    for (const p of peaks) assert.ok(Math.abs(p - 0.5) < 1e-9, `peak=${p}`);
  } finally {
    s.restore();
  }
});

test('chord: пустой или не-массив — тишина, контекст не создаётся', () => {
  const s = setup();
  try {
    for (const bad of [[], null, undefined, 'abc', 42, ['a', 'b']]) s.audio.chord(bad, 200);
    assert.equal(s.env.ctorCalls(), 0);
  } finally {
    s.restore();
  }
});

test('chord: spread разносит ноты по времени', () => {
  // Ловит: потерю раскладки delay — аккорд с spread должен звучать
  // «перебором», иначе теряется отличие от обычного аккорда.
  const s = setup();
  try {
    s.audio.chord([440, 550, 660], 200, { spread: 20, delay: 10 });
    const starts = s.nodes('osc').map((n) => n.__started[0]);
    const t = s.ctx().currentTime;
    assert.deepEqual(
      starts.map((v) => Math.round((v - t) * 1000)),
      [10, 30, 50]
    );
  } finally {
    s.restore();
  }
});

test('arp: шаг задаёт задержки нот и зажимается', () => {
  // Ловит: потерю накопления задержки (i * step) — арпеджио схлопнулось бы
  // в один аккорд; и снятие клампа шага — из битого значения получилась бы
  // мелодия длиной в минуты.
  const s = setup();
  try {
    s.audio.arp([440, 550, 660], 100);
    let starts = s.nodes('osc').map((n) => n.__started[0]);
    const t = s.ctx().currentTime;
    assert.deepEqual(
      starts.map((v) => Math.round((v - t) * 1000)),
      [0, 100, 200]
    );
    assert.equal(s.nodes('osc')[0].type, 'triangle');

    s.timers.advance(500);
    s.audio.arp([440, 550], 1e9); // шаг зажат до 1000 мс
    starts = s.nodes('osc').slice(3).map((n) => n.__started[0]);
    assert.equal(Math.round((starts[1] - starts[0]) * 1000), 1000);
  } finally {
    s.restore();
  }
});

test('arp: пустой список — тишина', () => {
  const s = setup();
  try {
    s.audio.arp([], 90);
    s.audio.arp(null, 90);
    s.audio.arp(['x'], 90);
    assert.equal(s.env.ctorCalls(), 0);
  } finally {
    s.restore();
  }
});

// --- совместимость ----------------------------------------------------------

test('playBeep: старый вызов работает и умеет сам подцепить состояние', () => {
  // Ловит: разрыв обратной совместимости. playBeep остался в старых местах
  // client.js и передаёт getState четвёртым аргументом.
  const s = setup({ configure: false });
  try {
    s.audio.playBeep(880, 120, 1, () => s.state);
    assert.deepEqual(s.oscFreqs(), [880]);

    // Повторный вызов не должен перенастраивать источник состояния.
    s.audio.playBeep(990, 120, 1, () => ({ soundEnabled: false, soundVolume: 0 }));
    assert.deepEqual(s.oscFreqs(), [880, 990]);
  } finally {
    s.restore();
  }
});

test('configure: смена настроек влияет на следующий звук', () => {
  // Ловит: кеширование громкости на момент configure — выключение звука
  // в меню должно действовать сразу, а не после перезагрузки страницы.
  const s = setup();
  try {
    s.audio.tone({ freq: 440 });
    assert.equal(s.oscFreqs().length, 1);
    s.state.soundEnabled = false;
    s.timers.advance(300);
    s.audio.tone({ freq: 550 });
    assert.equal(s.oscFreqs().length, 1, 'после выключения новых голосов быть не должно');
  } finally {
    s.restore();
  }
});
