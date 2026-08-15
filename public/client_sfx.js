/* J16-J18 — звуковая палитра.

   Никаких сэмплов: звуки собираются из тонов, свипов, аккордов и шумовых
   всплесков (движок — client_audio.js).

   Палитра разложена по частотам, и это не украшение, а способ различать
   события не глядя на экран:
     низ    70-350 Гц, sawtooth  — опасность (смерть, убийство, взрыв);
     середина 350-700 Гц, triangle — прогресс (захват, контракт, дейлик);
     верх   700-1400 Гц, sine     — награда (ачивка, джекпот, победа).
   Свипы отведены под временные состояния (модификатор раунда, разгон).

   Внутри полосы звук собран из слоёв, а не из одного осциллятора: удар — это
   щелчок атаки, тело и суб, награда — колокол с частотной модуляцией поверх
   аккорда. Один осциллятор на событие давал ровно ту разницу, из-за которой
   игра звучит как бипер: слышно, что событие произошло, но не слышно, какое
   именно и насколько оно крупное.

   Каждый звук обёрнут в audio.event(): слои проходят лимитер как одно
   событие. Иначе в перестрелке щелчок убийства проходил сразу, а его же суб
   уезжал в очередь и догонял через четверть секунды — вместо удара
   получались два несвязанных звука. Там же живёт и просадка громкости
   (`duck`): она обязана срабатывать только когда событие реально играет, а
   не когда лимитер его выбросил.

   Пространство даёт общий посыл в реверб (`send`) — короткий у частых
   событий, длинный у редких.

   События с координатами принимают панораму (-1 слева, +1 справа) — её
   считает sfxPanFrom() в client_fx_rt.js от позиции своей головы. Убийство
   за спиной слышно с той стороны, где оно случилось.

   Громкость и признак «звук включён» читаются из настроек в момент
   воспроизведения, а не при создании модуля: игрок двигает ползунок во время
   матча, и снимок значений отстал бы на всю сессию. Пресет эффектов
   («Спокойно» тише, «Казино» громче) домножается тут же. */

import { createAudioModule } from './client_audio.js';
import { settings } from './client_store.js';
import { fxVolumeScale } from './client_fx_preset.js';

const audio = createAudioModule();

function audioState() {
  return {
    soundEnabled: settings.soundEnabled && !settings.soundMutedByBlur,
    soundVolume: Math.max(0, Math.min(1, (Number(settings.soundVolume) || 0) * fxVolumeScale()))
  };
}

audio.configure(audioState);

/* Проверочный сигнал из настроек: единственное место, где тон задаётся
   вызывающим, а не палитрой. */
export function playBeep(freq, ms, vol) {
  audio.playBeep(freq, ms, vol, audioState);
}

// Ноты (Гц)
const NOTE = {
  C3: 130.81,
  E3: 164.81,
  G3: 196.0,
  A3: 220.0,
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  F4: 349.23,
  G4: 392.0,
  A4: 440.0,
  B4: 493.88,
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
  G5: 783.99,
  A5: 880.0,
  C6: 1046.5,
  E6: 1318.51,
  G6: 1567.98,
  C7: 2093.0,
  E7: 2637.02
};

// Панорама приходит из мира и может быть чем угодно — приводим к [-1, 1].
function pan(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-1, Math.min(1, n));
}

/* Лестница серии: раскладывает номер шага на три независимые оси.

   Подъём «на два полутона за шаг» упирался в потолок: после четырнадцатого
   захвата подряд звук переставал меняться вовсе, и самая длинная серия в
   матче звучала ровно как средняя. Потолок неизбежен — выше четырёх
   килогерц слушать нечего, — поэтому расти должна не только высота:

     ступень  — мажорная пентатоника, пять нот; любая пара звучит согласно,
                поэтому серия остаётся музыкой, а не сиреной;
     октава   — две штуки, полный проход лестницы занимает десять шагов;
     виток    — каждые десять шагов вся лестница поднимается на тон и
                обрастает слоем: квинта, октава сверху, суб снизу.

   Оси перемножаются, поэтому одинаково звучащих шагов не остаётся там, где
   игрок способен их различить: тридцатый захват подряд — это не «тот же
   писк», а более плотный аккорд на тон выше пятнадцатого. */
const PENTA = [0, 2, 4, 7, 9];

function ladder(step) {
  const n = Math.max(0, Math.min(200, Math.round(Number(step) || 0)));
  const deg = PENTA[n % PENTA.length];
  const oct = Math.floor(n / PENTA.length) % 2;
  const cycle = Math.min(4, Math.floor(n / (PENTA.length * 2)));
  return {
    n,
    cycle,
    // Тон за виток — модуляция вверх, но по-прежнему в пентатонике.
    freq: NOTE.G4 * Math.pow(2, (cycle * 2 + deg + 12 * oct) / 12)
  };
}

export const sfx = {
  // ——— низ 70-350 Гц: опасность ———

  /* Смерть — единственное событие, которому отдаётся вся сцена: остальное
     проседает почти вдвое, тон валится с 330 до 82 Гц за первые полсекунды,
     под ним падает суб, сверху шипит хвост с длинным посылом в реверб. */
  death(p) {
    audio.event(5, () => {
      audio.duck(0.45, 700);
      audio.sweep(330, 82, 750, 'sawtooth', {
        vol: 0.9,
        attack: 0.012,
        decay: 0.72,
        bend: 520,
        drive: 0.35,
        unison: 3,
        unisonCents: 14,
        filter: { type: 'lowpass', freq: 1400, freq2: 160, q: 1.2 },
        send: 0.3,
        pan: pan(p),
        front: true
      });
      audio.tone({
        type: 'sine',
        freq: 150,
        freq2: 44,
        dur: 620,
        bend: 220,
        vol: 0.85,
        attack: 0.004,
        decay: 0.5,
        front: true
      });
      audio.noiseBurst(520, 'lowpass', 900, {
        vol: 0.35,
        cutoff2: 180,
        attack: 0.004,
        decay: 0.44,
        send: 0.45,
        pan: pan(p) * 0.6,
        front: true
      });
    });
  },

  /* Убийство — короткий удар из трёх слоёв: щелчок (высокочастотный шум),
     тело (пила с быстрым спадом высоты) и суб. Слышно, что попал, даже
     когда экран занят вспышкой. */
  kill(p) {
    audio.event(4, () => {
      audio.duck(0.22, 220);
      audio.noiseBurst(70, 'highpass', 2600, { vol: 0.4, attack: 0.001, decay: 0.05, pan: pan(p), front: true });
      audio.sweep(300, 84, 260, 'sawtooth', {
        vol: 0.6,
        attack: 0.002,
        decay: 0.2,
        bend: 90,
        drive: 0.45,
        filter: { type: 'lowpass', freq: 2600, freq2: 500 },
        send: 0.16,
        pan: pan(p),
        front: true
      });
      audio.tone({ type: 'sine', freq: 120, freq2: 48, dur: 240, bend: 110, vol: 0.7, attack: 0.002, decay: 0.2, front: true });
    });
  },

  /* Реванш — тот же удар, но с ответной нотой снизу вверх: обидчик ответил
     за своё. */
  revenge(p) {
    audio.event(4, () => {
      audio.duck(0.25, 320);
      audio.sweep(240, 96, 380, 'sawtooth', {
        vol: 0.7,
        attack: 0.006,
        decay: 0.34,
        bend: 180,
        drive: 0.3,
        unison: 2,
        send: 0.2,
        pan: pan(p),
        front: true
      });
      audio.tone({ type: 'triangle', freq: NOTE.E3, freq2: NOTE.E4, dur: 300, bend: 240, vol: 0.42, delay: 120, send: 0.3, front: true });
    });
  },

  /* Взрыв — шум с завалом полосы вниз плюс просевший суб: чем ниже уезжает
     фильтр, тем крупнее кажется воронка. */
  explode(p) {
    audio.event(4, () => {
      audio.duck(0.35, 420);
      audio.noiseBurst(620, 'lowpass', 3600, {
        vol: 0.6,
        cutoff2: 120,
        attack: 0.001,
        decay: 0.5,
        drive: 0.3,
        send: 0.5,
        pan: pan(p),
        front: true
      });
      audio.sweep(190, 46, 460, 'sawtooth', {
        vol: 0.6,
        bend: 200,
        drive: 0.4,
        unison: 2,
        unisonCents: 20,
        filter: { type: 'lowpass', freq: 900, freq2: 180 },
        pan: pan(p),
        front: true
      });
    });
  },

  // ——— середина 350-700 Гц, triangle: прогресс ———

  /* Мелкий захват звучит десятки раз за матч, поэтому он короткий, тихий и
     почти сухой: всё, что длиннее ста миллисекунд, к третьей минуте
     раздражает. Поверх него идёт ступень серии — она и несёт развитие. */
  captureSmall(p) {
    audio.event(1, () => {
      audio.tone({
        type: 'triangle',
        freq: NOTE.C5,
        dur: 110,
        vol: 0.26,
        attack: 0.003,
        decay: 0.09,
        fm: { ratio: 3, index: 0.6 },
        send: 0.1,
        pan: pan(p) * 0.5
      });
    });
  },

  /* Крупный — тот же мотив, но развёрнутый в арпеджио с унисоном, хвостом и
     низом: разница слышна сразу, считать проценты не нужно. */
  captureBig(p) {
    audio.event(3, () => {
      audio.arp([NOTE.C4, NOTE.E4, NOTE.G4, NOTE.C5], 62, {
        type: 'triangle',
        vol: 0.5,
        dur: 170,
        unison: 2,
        unisonCents: 9,
        fm: { ratio: 2, index: 0.5 },
        send: 0.24,
        pan: pan(p) * 0.5
      });
      audio.tone({ type: 'sine', freq: 98, freq2: 65, dur: 220, bend: 120, vol: 0.4 });
    });
  },

  contractAssigned() {
    audio.event(2, () => {
      audio.arp([NOTE.D4, NOTE.G4], 90, { type: 'triangle', vol: 0.45, dur: 190, send: 0.2 });
    });
  },
  contractDone() {
    audio.event(3, () => {
      audio.arp([NOTE.G4, NOTE.B4, NOTE.D5], 70, {
        type: 'triangle',
        vol: 0.5,
        dur: 220,
        unison: 2,
        fm: { ratio: 2, index: 0.4 },
        send: 0.3
      });
    });
  },
  dailyAssigned() {
    audio.event(2, () => {
      audio.arp([NOTE.C4, NOTE.F4], 100, { type: 'triangle', vol: 0.4, dur: 200, send: 0.2 });
    });
  },
  dailyDone() {
    audio.event(3, () => {
      audio.arp([NOTE.F4, NOTE.A4, NOTE.C5], 72, {
        type: 'triangle',
        vol: 0.5,
        dur: 220,
        unison: 2,
        fm: { ratio: 2, index: 0.4 },
        send: 0.3
      });
    });
  },

  /* Метка охоты: своя цель звучит в полный голос, чужая — вполовину тише
     (vol приходит от вызывающего). */
  bountyAssigned(vol) {
    const v = Number.isFinite(Number(vol)) ? Math.max(0, Math.min(1, Number(vol))) : 1;
    audio.event(2, () => {
      audio.tone({ type: 'triangle', freq: NOTE.E4, dur: 160, vol: 0.42 * v, fm: { ratio: 1.5, index: 0.8 }, send: 0.25 });
      audio.tone({ type: 'triangle', freq: NOTE.A4, dur: 200, vol: 0.38 * v, delay: 110, fm: { ratio: 1.5, index: 0.8 }, send: 0.25 });
    });
  },
  bountyClaimed() {
    audio.event(4, () => {
      audio.duck(0.2, 300);
      audio.arp([NOTE.A4, NOTE.C5, NOTE.E5, NOTE.A5], 66, {
        type: 'triangle',
        vol: 0.55,
        dur: 220,
        unison: 2,
        fm: { ratio: 3, index: 0.5 },
        send: 0.35,
        front: true
      });
    });
  },

  pickup(p) {
    audio.event(1, () => {
      audio.tone({ type: 'triangle', freq: NOTE.G4, dur: 90, vol: 0.35, fm: { ratio: 4, index: 0.5 }, send: 0.14, pan: pan(p) * 0.5 });
      audio.tone({ type: 'triangle', freq: NOTE.D5, dur: 120, vol: 0.3, delay: 55, fm: { ratio: 4, index: 0.5 }, send: 0.2, pan: pan(p) * 0.5 });
    });
  },
  powerUsed(p) {
    audio.event(2, () => {
      audio.tone({
        type: 'square',
        freq: NOTE.E4,
        dur: 140,
        vol: 0.3,
        drive: 0.25,
        filter: { type: 'lowpass', freq: 1600 },
        send: 0.18,
        pan: pan(p) * 0.5
      });
    });
  },

  /* Серия убийств — та же лестница, что и у комбо, но плотнее: каждый виток
     добавляет квинту, а с третьего — суб. */
  streak(step) {
    const { freq, cycle, n } = ladder(step);
    audio.event(2, () => {
      audio.tone({
        type: 'triangle',
        freq,
        dur: 130,
        vol: 0.42,
        fm: { ratio: 2, index: 0.4 + Math.min(1.2, n * 0.08) },
        send: Math.min(0.45, 0.18 + cycle * 0.06)
      });
      if (cycle >= 1) audio.tone({ type: 'triangle', freq: freq * 1.5, dur: 150, vol: 0.22, delay: 45, send: 0.3 });
      if (cycle >= 3) audio.tone({ type: 'sine', freq: freq / 4, dur: 200, vol: 0.3 });
    });
  },

  // ——— верх 700-1400 Гц, sine/аккорды: награды ———

  /* Ачивка — колокол: несущая с ратио 3.5 даёт неровный спектр, который ухо
     читает как металл, а не как синус. Аккорд под ним держит тональность. */
  achievement() {
    audio.event(5, () => {
      audio.duck(0.25, 500);
      audio.tone({ type: 'sine', freq: NOTE.C6, dur: 900, vol: 0.5, attack: 0.003, decay: 0.8, fm: { ratio: 3.5, index: 2.4 }, send: 0.6, front: true });
      audio.chord([NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6], 560, {
        type: 'sine',
        vol: 0.6,
        spread: 22,
        width: 0.45,
        vibrato: { rate: 5, cents: 8, delay: 180 },
        send: 0.45,
        front: true
      });
      audio.tone({ type: 'sine', freq: NOTE.E7, dur: 240, vol: 0.2, delay: 150, attack: 0.004, send: 0.5, front: true });
    });
  },

  jackpot() {
    audio.event(5, () => {
      audio.duck(0.3, 600);
      audio.arp([NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.E6], 58, {
        type: 'triangle',
        vol: 0.55,
        dur: 220,
        unison: 2,
        fm: { ratio: 3, index: 0.8 },
        send: 0.4,
        front: true
      });
      audio.chord([NOTE.C5, NOTE.G5, NOTE.C6], 700, {
        type: 'sine',
        vol: 0.55,
        delay: 300,
        width: 0.5,
        vibrato: { rate: 6, cents: 10, delay: 200 },
        send: 0.55,
        front: true
      });
      audio.tone({ type: 'sine', freq: NOTE.C7, dur: 700, vol: 0.22, delay: 320, fm: { ratio: 2.5, index: 1.6 }, send: 0.7, front: true });
    });
  },

  victory() {
    audio.event(6, () => {
      audio.duck(0.3, 800);
      audio.arp([NOTE.C5, NOTE.D5, NOTE.E5, NOTE.G5, NOTE.A5, NOTE.C6], 130, {
        type: 'triangle',
        vol: 0.5,
        dur: 260,
        unison: 2,
        unisonCents: 10,
        fm: { ratio: 2, index: 0.5 },
        send: 0.4,
        front: true
      });
      audio.chord([NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6], 900, {
        type: 'sine',
        vol: 0.65,
        delay: 820,
        spread: 26,
        width: 0.5,
        vibrato: { rate: 5.5, cents: 10, delay: 260 },
        send: 0.6,
        front: true
      });
      audio.tone({ type: 'sine', freq: NOTE.C7, dur: 900, vol: 0.18, delay: 860, fm: { ratio: 3.5, index: 2 }, send: 0.7, front: true });
    });
  },

  /* Поражение — то же построение, что и победа, но нисходящее и в миноре, с
     низким тянущимся хвостом вместо колокола. */
  defeat() {
    audio.event(6, () => {
      audio.duck(0.3, 800);
      audio.arp([NOTE.A4, NOTE.G4, NOTE.F4, NOTE.E4], 150, { type: 'triangle', vol: 0.45, dur: 320, unison: 2, send: 0.35, front: true });
      audio.chord([NOTE.A3, NOTE.C4, NOTE.E4], 820, {
        type: 'sine',
        vol: 0.5,
        delay: 620,
        spread: 30,
        width: 0.4,
        vibrato: { rate: 4, cents: 14, delay: 300 },
        send: 0.5,
        front: true
      });
      audio.tone({ type: 'sine', freq: 110, freq2: 82, dur: 900, bend: 700, vol: 0.4, delay: 640, decay: 0.8, front: true });
    });
  },

  firstCapture() {
    audio.event(6, () => {
      audio.duck(0.25, 500);
      audio.arp([NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6], 90, {
        type: 'triangle',
        vol: 0.55,
        dur: 280,
        unison: 2,
        fm: { ratio: 2, index: 0.6 },
        send: 0.45,
        front: true
      });
      audio.tone({ type: 'sine', freq: NOTE.E7, dur: 280, vol: 0.2, delay: 320, send: 0.6, front: true });
    });
  },

  /* Покупка в магазине. Раньше здесь звучал playBeep(880) — ровно тот
     голый синус, ради ухода от которого палитра и заведена: покупка
     звучала как системный бип, а не как награда. */
  purchase() {
    audio.event(3, () => {
      audio.tone({ type: 'sine', freq: NOTE.A5, dur: 320, vol: 0.35, fm: { ratio: 3.5, index: 1.6 }, send: 0.4 });
      audio.tone({ type: 'triangle', freq: NOTE.E5, dur: 200, vol: 0.28, delay: 90, send: 0.3 });
      audio.tone({ type: 'sine', freq: NOTE.A3, dur: 260, vol: 0.3, attack: 0.004 });
    });
  },

  styleGain() {
    audio.event(1, () => {
      audio.tone({ type: 'sine', freq: NOTE.C6, dur: 130, vol: 0.24, fm: { ratio: 3, index: 0.5 }, send: 0.25 });
    });
  },

  // ——— свипы: временные состояния ———
  mutatorOn(vol) {
    const v = Number.isFinite(Number(vol)) ? Math.max(0, Math.min(1, Number(vol))) : 1;
    audio.event(2, () => {
      audio.sweep(240, 720, 340, 'sawtooth', {
        vol: 0.45 * v,
        unison: 3,
        unisonCents: 16,
        drive: 0.2,
        filter: { type: 'lowpass', freq: 700, freq2: 2600 },
        send: 0.3
      });
    });
  },
  mutatorOff(vol) {
    const v = Number.isFinite(Number(vol)) ? Math.max(0, Math.min(1, Number(vol))) : 1;
    audio.event(1, () => {
      audio.sweep(620, 220, 300, 'triangle', { vol: 0.35 * v, unison: 2, send: 0.25 });
    });
  },
  speedOn(p) {
    audio.event(2, () => {
      audio.sweep(420, 980, 280, 'triangle', {
        vol: 0.4,
        unison: 2,
        unisonCents: 12,
        fm: { ratio: 1.5, index: 0.5 },
        send: 0.25,
        pan: pan(p) * 0.5
      });
    });
  },

  // ——— комбо ———

  /* Ступень комбо: номер шага цепочки, а не полутона. Раскладку по высоте,
     плотности и хвосту делает ladder() — см. комментарий к нему; здесь
     только слои, которые она включает. */
  comboStep(step) {
    const { freq, cycle } = ladder(step);
    audio.event(2, () => {
      audio.tone({
        type: 'triangle',
        freq,
        dur: 120,
        vol: 0.34,
        fm: { ratio: 2, index: 0.3 + cycle * 0.35 },
        filter: { type: 'lowpass', freq: 1800 + cycle * 900 },
        send: Math.min(0.5, 0.12 + cycle * 0.09)
      });
      // Квинта со второго витка, октава сверху с третьего, суб с четвёртого:
      // высота почти упёрлась в потолок, поэтому дальше растёт плотность.
      if (cycle >= 1) audio.tone({ type: 'triangle', freq: freq * 1.5, dur: 140, vol: 0.18, delay: 40, send: 0.28 });
      if (cycle >= 2) audio.tone({ type: 'sine', freq: freq * 2, dur: 160, vol: 0.14, delay: 70, send: 0.35 });
      if (cycle >= 3) audio.tone({ type: 'sine', freq: freq / 4, dur: 190, vol: 0.26, attack: 0.003 });
    });
  },

  /* Обрыв цепочки — падение с той высоты, где цепочка оборвалась: чем
     длиннее была серия, тем заметнее провал. */
  comboBreak(step) {
    const { freq } = ladder(step);
    audio.event(1, () => {
      audio.sweep(freq, Math.max(60, freq / 3), 300, 'sine', { vol: 0.28, bend: 220, send: 0.2 });
    });
  },

  ui() {
    audio.event(0, () => {
      audio.tone({ type: 'sine', freq: NOTE.A5, dur: 70, vol: 0.2, attack: 0.002, decay: 0.05, fm: { ratio: 5, index: 0.4 } });
    });
  },

  // J6: восходящий бип каскада результатов.
  countStep(i) {
    const n = Math.max(0, Math.min(8, Number(i) || 0));
    audio.event(2, () => {
      audio.tone({
        type: 'sine',
        freq: 523.25 * Math.pow(2, (n * 2) / 12),
        dur: 120,
        vol: 0.26,
        fm: { ratio: 3, index: 0.4 },
        send: 0.2
      });
    });
  }
};
