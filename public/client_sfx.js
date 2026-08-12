/* J16-J18 — звуковая палитра.

   Один осциллятор на всю игру, никаких сэмплов: звуки собираются из тонов,
   свипов, аккордов и шумовых всплесков (движок — client_audio.js).

   Палитра разложена по частотам, и это не украшение, а способ различать
   события не глядя на экран:
     низ    70-350 Гц, sawtooth  — опасность (смерть, убийство, взрыв);
     середина 350-700 Гц, triangle — прогресс (захват, контракт, дейлик);
     верх   700-1400 Гц, sine     — награда (ачивка, джекпот, победа).
   Свипы отведены под временные состояния (модификатор раунда, разгон).

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

export const sfx = {
  // ——— низ 70-350 Гц: опасность ———
  death() {
    audio.sweep(330, 82, 750, 'sawtooth', {
      vol: 0.9,
      attack: 0.012,
      decay: 0.72,
      filter: { type: 'lowpass', freq: 1400, freq2: 160, q: 1.2 },
      prio: 5
    });
    audio.noiseBurst(240, 'lowpass', 420, { vol: 0.35, attack: 0.004, decay: 0.22, prio: 4 });
  },
  kill() {
    audio.noiseBurst(160, 'lowpass', 900, { vol: 0.45, attack: 0.003, decay: 0.14, prio: 4 });
    audio.sweep(180, 70, 220, 'sawtooth', { vol: 0.55, attack: 0.004, decay: 0.2, prio: 4 });
  },
  revenge() {
    audio.sweep(220, 96, 380, 'sawtooth', { vol: 0.7, attack: 0.006, decay: 0.34, prio: 4 });
    audio.tone({ type: 'triangle', freq: NOTE.E3, dur: 260, vol: 0.4, delay: 120, prio: 3 });
  },
  explode() {
    audio.noiseBurst(320, 'lowpass', 700, { vol: 0.55, cutoff2: 140, attack: 0.002, decay: 0.3, prio: 4 });
    audio.sweep(140, 62, 300, 'sawtooth', { vol: 0.5, prio: 3 });
  },

  // ——— середина 350-700 Гц, triangle: прогресс ———
  captureSmall() {
    audio.tone({ type: 'triangle', freq: NOTE.C5, dur: 100, vol: 0.28, attack: 0.004, prio: 1 });
  },
  captureBig() {
    audio.arp([NOTE.C4, NOTE.E4, NOTE.G4, NOTE.C5], 62, { type: 'triangle', vol: 0.5, dur: 150, prio: 3 });
  },
  contractAssigned() {
    audio.arp([NOTE.D4, NOTE.G4], 90, { type: 'triangle', vol: 0.45, dur: 190, prio: 2 });
  },
  contractDone() {
    audio.arp([NOTE.G4, NOTE.B4, NOTE.D5], 70, { type: 'triangle', vol: 0.5, dur: 200, prio: 3 });
  },
  dailyAssigned() {
    audio.arp([NOTE.C4, NOTE.F4], 100, { type: 'triangle', vol: 0.4, dur: 200, prio: 2 });
  },
  dailyDone() {
    audio.arp([NOTE.F4, NOTE.A4, NOTE.C5], 72, { type: 'triangle', vol: 0.5, dur: 200, prio: 3 });
  },
  bountyAssigned(vol) {
    audio.tone({ type: 'triangle', freq: NOTE.E4, dur: 150, vol: 0.42 * (vol ?? 1), prio: 2 });
    audio.tone({ type: 'triangle', freq: NOTE.A4, dur: 190, vol: 0.38 * (vol ?? 1), delay: 110, prio: 2 });
  },
  bountyClaimed() {
    audio.arp([NOTE.A4, NOTE.C5, NOTE.E5, NOTE.A5], 66, { type: 'triangle', vol: 0.55, dur: 200, prio: 4 });
  },
  pickup() {
    audio.tone({ type: 'triangle', freq: NOTE.G4, dur: 90, vol: 0.35, prio: 1 });
    audio.tone({ type: 'triangle', freq: NOTE.D5, dur: 110, vol: 0.3, delay: 55, prio: 1 });
  },
  powerUsed() {
    audio.tone({ type: 'square', freq: NOTE.E4, dur: 120, vol: 0.3, filter: { type: 'lowpass', freq: 1600 }, prio: 2 });
  },
  streak(step) {
    const n = Math.max(0, Math.min(10, Number(step) || 0));
    audio.tone({ type: 'triangle', freq: 440 * Math.pow(2, n / 12), dur: 110, vol: 0.42, prio: 2 });
  },

  // ——— верх 700-1400 Гц, sine/аккорды: награды ———
  achievement() {
    audio.chord([NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6], 520, { type: 'sine', vol: 0.7, spread: 22, prio: 5 });
    audio.tone({ type: 'sine', freq: NOTE.E7, dur: 220, vol: 0.22, delay: 150, attack: 0.004, prio: 3 });
  },
  jackpot() {
    audio.arp([NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.E6], 58, { type: 'triangle', vol: 0.55, dur: 200, prio: 5 });
    audio.chord([NOTE.C5, NOTE.G5, NOTE.C6], 620, { type: 'sine', vol: 0.55, delay: 300, prio: 4 });
  },
  victory() {
    audio.arp([NOTE.C5, NOTE.D5, NOTE.E5, NOTE.G5, NOTE.A5, NOTE.C6], 130, {
      type: 'triangle',
      vol: 0.5,
      dur: 240,
      prio: 6
    });
    audio.chord([NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6], 780, { type: 'sine', vol: 0.65, delay: 820, prio: 6 });
  },
  defeat() {
    audio.arp([NOTE.A4, NOTE.G4, NOTE.F4, NOTE.E4], 150, { type: 'triangle', vol: 0.45, dur: 300, prio: 6 });
    audio.chord([NOTE.A3, NOTE.C4, NOTE.E4], 700, { type: 'sine', vol: 0.5, delay: 620, prio: 5 });
  },
  firstCapture() {
    audio.arp([NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6], 90, { type: 'triangle', vol: 0.55, dur: 260, prio: 6 });
    audio.tone({ type: 'sine', freq: NOTE.E7, dur: 260, vol: 0.2, delay: 320, prio: 4 });
  },
  styleGain() {
    audio.tone({ type: 'sine', freq: NOTE.C6, dur: 120, vol: 0.24, prio: 1 });
  },

  // ——— свипы: временные состояния ———
  mutatorOn(vol) {
    audio.sweep(240, 720, 340, 'sawtooth', {
      vol: 0.45 * (vol ?? 1),
      filter: { type: 'lowpass', freq: 700, freq2: 2600 },
      prio: 2
    });
  },
  mutatorOff(vol) {
    audio.sweep(620, 220, 300, 'triangle', { vol: 0.35 * (vol ?? 1), prio: 1 });
  },
  speedOn() {
    audio.sweep(420, 980, 260, 'triangle', { vol: 0.4, prio: 2 });
  },

  // ——— комбо ———
  comboStep(semis) {
    const s = Math.max(0, Math.min(28, Number(semis) || 0));
    audio.tone({ type: 'triangle', freq: 392 * Math.pow(2, s / 12), dur: 110, vol: 0.34, prio: 2 });
  },
  comboBreak() {
    audio.sweep(520, 180, 260, 'sine', { vol: 0.28, prio: 1 });
  },

  ui() {
    audio.tone({ type: 'sine', freq: NOTE.A5, dur: 70, vol: 0.2, prio: 0 });
  },

  // J6: восходящий бип каскада результатов.
  countStep(i) {
    const n = Math.max(0, Math.min(8, Number(i) || 0));
    audio.tone({ type: 'sine', freq: 523.25 * Math.pow(2, (n * 2) / 12), dur: 110, vol: 0.26, prio: 2 });
  }
};
