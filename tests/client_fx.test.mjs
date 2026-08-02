/*
 * public/client_fx.js — исполняемые тесты.
 *
 * Два входа, оба зовутся из горячего игрового кода десятки раз в секунду:
 * addFxBurst кладёт запись в общий массив st.fxBursts (его потом рисует
 * client_cos_draw), addShake толкает камеру через колбэк st.addShakeVel.
 * Цена ошибок: неснятый кап -> массив всплытий растёт бесконечно и кадр
 * проседает; потеря исключения для kind === 'score' -> игрок перестаёт
 * видеть, за что ему начислили очки; неотнормированный вектор тряски ->
 * камера улетает.
 *
 * Каждый нетривиальный тест подписан: какую поломку он ловит.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createFxModule } from '../public/client_fx.js';
import { installFakeTimers, installRandom } from './helpers/env_mock.mjs';

function mkState(over = {}) {
  const st = {
    fxEnabled: true,
    fxBursts: [],
    shakeIntensity: 1,
    shakeVel: [],
    addShakeVel(vx, vy) {
      st.shakeVel.push([vx, vy]);
    },
    ...over
  };
  return st;
}

// --- addFxBurst -------------------------------------------------------------

test('addFxBurst: кладёт запись с координатами, видом и меткой времени', () => {
  const timers = installFakeTimers(5000);
  const { addFxBurst } = createFxModule();
  try {
    const st = mkState();
    addFxBurst(12, 34, 'eat', () => st);
    assert.equal(st.fxBursts.length, 1);
    assert.deepEqual(st.fxBursts[0], { t0: 5000, x: 12, y: 34, kind: 'eat' });
  } finally {
    timers.restore();
  }
});

test('addFxBurst: extra домешивается, но не подменяет базовые поля молча', () => {
  // Ловит: замену Object.assign(item, extra) на assign(extra, item) —
  // тогда сгорят передаваемые из client.js поля (текст всплытия, цвет),
  // и над змейкой будет пустая плашка.
  const timers = installFakeTimers(1000);
  const { addFxBurst } = createFxModule();
  try {
    const st = mkState();
    addFxBurst(1, 2, 'score', () => st, { text: '+247', color: 'hsl(210 78% 52%)' });
    assert.equal(st.fxBursts[0].text, '+247');
    assert.equal(st.fxBursts[0].color, 'hsl(210 78% 52%)');
    assert.equal(st.fxBursts[0].kind, 'score');
  } finally {
    timers.restore();
  }
});

test('addFxBurst: extra не объект — игнорируется, запись всё равно появляется', () => {
  const timers = installFakeTimers();
  const { addFxBurst } = createFxModule();
  try {
    const st = mkState();
    for (const bad of [null, undefined, 'str', 42, true]) addFxBurst(1, 2, 'eat', () => st, bad);
    assert.equal(st.fxBursts.length, 5);
  } finally {
    timers.restore();
  }
});

test('addFxBurst: при выключенных эффектах гасится всё, кроме score', () => {
  // Ловит: потерю исключения для 'score'. Числовые всплытия (+247) —
  // информация, а не украшение: игрок с выключенными эффектами перестанет
  // понимать, за что ему начислили очки.
  const timers = installFakeTimers();
  const { addFxBurst } = createFxModule();
  try {
    const st = mkState({ fxEnabled: false });
    addFxBurst(1, 2, 'eat', () => st);
    addFxBurst(1, 2, 'death', () => st);
    addFxBurst(1, 2, '', () => st);
    assert.equal(st.fxBursts.length, 0);

    addFxBurst(1, 2, 'score', () => st);
    assert.equal(st.fxBursts.length, 1);
    assert.equal(st.fxBursts[0].kind, 'score');
  } finally {
    timers.restore();
  }
});

test('addFxBurst: при включённых эффектах проходят любые виды', () => {
  const timers = installFakeTimers();
  const { addFxBurst } = createFxModule();
  try {
    const st = mkState();
    for (const k of ['eat', 'death', 'score', 'boost', '']) addFxBurst(1, 2, k, () => st);
    assert.equal(st.fxBursts.length, 5);
    assert.deepEqual(
      st.fxBursts.map((b) => b.kind),
      ['eat', 'death', 'score', 'boost', '']
    );
  } finally {
    timers.restore();
  }
});

test('addFxBurst: нечисловые координаты отбрасываются', () => {
  // Ловит: пропуск NaN/Infinity в массив всплытий. NaN-координата уходит
  // прямиком в ctx.arc/fillText и рвёт весь кадр: канвас молча бросает
  // остаток отрисовки, экран становится пустым.
  const timers = installFakeTimers();
  const { addFxBurst } = createFxModule();
  try {
    const st = mkState();
    for (const [x, y] of [
      [NaN, 1],
      [1, NaN],
      [Infinity, 1],
      [1, -Infinity],
      ['abc', 1],
      [undefined, 1],
      [null, undefined],
      [{}, 1]
    ]) {
      addFxBurst(x, y, 'eat', () => st);
    }
    assert.equal(st.fxBursts.length, 0);

    // Числовые строки и null (Number(null) === 0) — валидные координаты.
    addFxBurst('12', '0', 'eat', () => st);
    addFxBurst(null, 0, 'eat', () => st);
    assert.deepEqual(
      st.fxBursts.map((b) => [b.x, b.y]),
      [
        [12, 0],
        [0, 0]
      ]
    );
  } finally {
    timers.restore();
  }
});

test('addFxBurst: без состояния/без массива/без getState не падает', () => {
  // Ловит: обращение к st.fxBursts.push без проверок. addFxBurst зовётся
  // из обработчиков сетевых сообщений, которые приходят и до инициализации
  // игрового состояния.
  const timers = installFakeTimers();
  const { addFxBurst } = createFxModule();
  try {
    assert.doesNotThrow(() => addFxBurst(1, 2, 'score', null));
    assert.doesNotThrow(() => addFxBurst(1, 2, 'score', () => null));
    assert.doesNotThrow(() => addFxBurst(1, 2, 'score', () => ({ fxEnabled: true })));
    assert.doesNotThrow(() =>
      addFxBurst(1, 2, 'score', () => ({ fxEnabled: true, fxBursts: 'not-an-array' }))
    );
  } finally {
    timers.restore();
  }
});

test('addFxBurst: массив ограничен 80 записями, выживают последние', () => {
  // Ловит: снятие/ослабление капа. Массив всплытий перебирается на каждом
  // кадре — без капа бой на 8 игроков раздувает его до тысяч записей и
  // отрисовка кадра начинает стоить дороже самой игры.
  const timers = installFakeTimers();
  const { addFxBurst } = createFxModule();
  try {
    const st = mkState();
    for (let i = 0; i < 200; i++) addFxBurst(i, 0, 'eat', () => st);
    assert.equal(st.fxBursts.length, 80);
    assert.equal(st.fxBursts[0].x, 120);
    assert.equal(st.fxBursts[79].x, 199);
  } finally {
    timers.restore();
  }
});

test('addFxBurst: кап срабатывает и на уже переполненном снаружи массиве', () => {
  // Ловит: замену splice(0, len - cap) на «удалить одну запись» — тогда
  // массив, пришедший переполненным, никогда не вернётся к капу.
  const timers = installFakeTimers();
  const { addFxBurst } = createFxModule();
  try {
    const st = mkState({ fxBursts: Array.from({ length: 500 }, () => ({ kind: 'old' })) });
    addFxBurst(1, 2, 'eat', () => st);
    assert.equal(st.fxBursts.length, 80);
    assert.equal(st.fxBursts.at(-1).kind, 'eat');
  } finally {
    timers.restore();
  }
});

// --- addShake ---------------------------------------------------------------

test('addShake: вектор нормируется — длина толчка не зависит от длины вектора', () => {
  // Ловит: потерю нормировки (dx /= len). Тогда «толчок в сторону соседа»,
  // посчитанный в пикселях мира, вкачивал бы в камеру сотни единиц скорости
  // и экран улетал бы за пределы карты.
  const rnd = installRandom([0.5]); // джиттер ровно 0
  const timers = installFakeTimers();
  const { addShake } = createFxModule();
  try {
    const st = mkState();
    addShake(1, () => st, 1, 0);
    addShake(1, () => st, 1000, 0);
    const [a, b] = st.shakeVel;
    assert.deepEqual(a, b);
    // (dx*0.7 + 0) * 0.9 * a === 0.63
    assert.ok(Math.abs(a[0] - 0.63) < 1e-9, `vx=${a[0]}`);
    assert.ok(Math.abs(a[1]) < 1e-9, `vy=${a[1]}`);
  } finally {
    timers.restore();
    rnd.restore();
  }
});

test('addShake: направление сохраняется — толчок идёт вдоль заданного вектора', () => {
  // Ловит: перепутанные dx/dy или потерянный знак. Направленная тряска
  // должна «отбрасывать» камеру в ту же сторону, что и удар.
  const rnd = installRandom([0.5]);
  const { addShake } = createFxModule();
  try {
    const st = mkState();
    addShake(1, () => st, 0, -1);
    const [vx, vy] = st.shakeVel[0];
    assert.ok(Math.abs(vx) < 1e-9);
    assert.ok(Math.abs(vy + 0.63) < 1e-9, `vy=${vy}`);
  } finally {
    rnd.restore();
  }
});

test('addShake: без вектора берётся случайный угол, длина та же', () => {
  // Ловит: обрыв ветки «нулевой вектор» — без неё деление на len даёт NaN
  // в скорости камеры, и камера залипает навсегда (NaN не затухает).
  const rnd = installRandom([0, 0.5, 0.5]); // angle=0 -> (1,0); джиттер 0
  const { addShake } = createFxModule();
  try {
    const st = mkState();
    addShake(1, () => st, 0, 0);
    const [vx, vy] = st.shakeVel[0];
    assert.ok(Number.isFinite(vx) && Number.isFinite(vy));
    assert.ok(Math.abs(vx - 0.63) < 1e-9, `vx=${vx}`);
    assert.ok(Math.abs(vy) < 1e-9, `vy=${vy}`);
  } finally {
    rnd.restore();
  }
});

test('addShake: нечисловые направления не дают NaN в скорости камеры', () => {
  // Ловит: пропуск NaN в addShakeVel. Скорость камеры интегрируется —
  // один NaN отравляет её до конца матча, экран замирает или исчезает.
  // NB: бесконечность сюда намеренно не включена — на ней модуль СЕЙЧАС
  // отдаёт NaN (Infinity/Infinity при нормировке), см. отчёт.
  const rnd = installRandom([0.25, 0.5, 0.75]);
  const { addShake } = createFxModule();
  try {
    const st = mkState();
    for (const [dx, dy] of [
      [NaN, NaN],
      ['a', 'b'],
      [undefined, undefined],
      [null, null],
      [{}, []]
    ]) {
      addShake(1, () => st, dx, dy);
    }
    assert.equal(st.shakeVel.length, 5);
    for (const [vx, vy] of st.shakeVel) {
      assert.ok(Number.isFinite(vx), `vx=${vx}`);
      assert.ok(Number.isFinite(vy), `vy=${vy}`);
    }
  } finally {
    rnd.restore();
  }
});

test('addShake: джиттер держится в разумных рамках при любом Math.random', () => {
  // Ловит: раздутый множитель джиттера. При jitter = 0.30 и любом random
  // из [0,1) компонента не должна выходить за 0.9 * a по модулю — иначе
  // «лёгкая дрожь» превращается в рывок через пол-экрана.
  const rnd = installRandom([0, 0.999999, 0.5, 0.1, 0.9]);
  const { addShake } = createFxModule();
  try {
    const st = mkState();
    for (let i = 0; i < 40; i++) addShake(1, () => st, 1, 0);
    for (const [vx, vy] of st.shakeVel) {
      assert.ok(Math.abs(vx) <= 0.9 + 1e-9, `vx=${vx}`);
      assert.ok(Math.abs(vy) <= 0.9 + 1e-9, `vy=${vy}`);
      // Основная часть — направленная: джиттер не должен переворачивать знак.
      assert.ok(vx > 0, `vx=${vx}`);
    }
  } finally {
    rnd.restore();
  }
});

test('addShake: amount зажат в [0,1] и умножается на shakeIntensity', () => {
  // Ловит: снятие клампа amount. Сервер шлёт «силу» события; неограниченное
  // значение из битого пакета выкинуло бы камеру с карты.
  const rnd = installRandom([0.5]);
  const { addShake } = createFxModule();
  try {
    const st = mkState();
    addShake(1, () => st, 1, 0);
    addShake(1000, () => st, 1, 0);
    assert.deepEqual(st.shakeVel[0], st.shakeVel[1]);

    const half = mkState({ shakeIntensity: 0.5 });
    addShake(1, () => half, 1, 0);
    assert.ok(Math.abs(half.shakeVel[0][0] - st.shakeVel[0][0] / 2) < 1e-9);
  } finally {
    rnd.restore();
  }
});

test('addShake: нулевая интенсивность или нулевая сила — колбэк не зовётся', () => {
  // Ловит: игнор пользовательской настройки «тряска выключена». Это ещё и
  // настройка доступности: часть игроков от тряски укачивает.
  const rnd = installRandom([0.5]);
  const { addShake } = createFxModule();
  try {
    const off = mkState({ shakeIntensity: 0 });
    addShake(1, () => off, 1, 0);
    assert.equal(off.shakeVel.length, 0);

    const st = mkState();
    addShake(0, () => st, 1, 0);
    addShake(-5, () => st, 1, 0);
    addShake(NaN, () => st, 1, 0);
    addShake('nope', () => st, 1, 0);
    assert.equal(st.shakeVel.length, 0);

    const bad = mkState({ shakeIntensity: NaN });
    addShake(1, () => bad, 1, 0);
    assert.equal(bad.shakeVel.length, 0);
  } finally {
    rnd.restore();
  }
});

test('addShake: без состояния или без addShakeVel не падает', () => {
  const rnd = installRandom([0.5]);
  const { addShake } = createFxModule();
  try {
    assert.doesNotThrow(() => addShake(1, null, 1, 0));
    assert.doesNotThrow(() => addShake(1, () => null, 1, 0));
    assert.doesNotThrow(() => addShake(1, () => ({ shakeIntensity: 1 }), 1, 0));
    assert.doesNotThrow(() =>
      addShake(1, () => ({ shakeIntensity: 1, addShakeVel: 'nope' }), 1, 0)
    );
  } finally {
    rnd.restore();
  }
});
