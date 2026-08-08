/*
 * Визуальное состояние собственного следа — второй чистый кусок, вынесенный
 * из draw() (client.js, ~1180 строк, самая рискованная функция клиента,
 * см. §6.4 отчёта разведки от 2026-08-05), после dirVec (#49).
 *
 * Сверяется со старой инлайновой формулой на сетке значений.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { trailRiskFor, trailVisualState } from '../public/client_trail_style.js';

const PULSE_FROM = 22;

// Старая инлайновая реализация из draw() до выноса — эталон для сверки.
function oldTrailState(trailLen, fxEnabled, reducedMotion, nowFrame) {
  const trailRisk = trailLen <= PULSE_FROM ? 0 : Math.min(1, (trailLen - PULSE_FROM) / 55);
  const trailPulse =
    trailRisk <= 0 || !fxEnabled || reducedMotion ? 0 : trailRisk * (0.5 + 0.5 * Math.sin(nowFrame * 0.0115));
  return {
    ownAlpha: Math.min(0.98, 0.85 + 0.11 * trailPulse),
    otherAlpha: 0.74,
    ownStroke: `rgba(255,255,255,${(0.45 + 0.4 * trailPulse).toFixed(3)})`
  };
}

test('trailVisualState сверяется со старой формулой на сетке значений', () => {
  const lengths = [0, 10, 22, 23, 40, 60, 77, 78, 200];
  const fxOptions = [true, false];
  const reducedOptions = [true, false];
  const frames = [0, 137, 999.5, 12345.678];

  for (const trailLen of lengths) {
    for (const fxEnabled of fxOptions) {
      for (const reducedMotion of reducedOptions) {
        for (const nowFrame of frames) {
          const got = trailVisualState({ trailLen, pulseFrom: PULSE_FROM, fxEnabled, reducedMotion, nowFrame });
          const want = oldTrailState(trailLen, fxEnabled, reducedMotion, nowFrame);
          assert.equal(got.ownAlpha, want.ownAlpha, `ownAlpha: len=${trailLen} fx=${fxEnabled} rm=${reducedMotion} t=${nowFrame}`);
          assert.equal(got.otherAlpha, want.otherAlpha);
          assert.equal(got.ownStroke, want.ownStroke, `ownStroke: len=${trailLen} fx=${fxEnabled} rm=${reducedMotion} t=${nowFrame}`);
        }
      }
    }
  }
});

test('trailRiskFor: риск нулевой до порога включительно', () => {
  assert.equal(trailRiskFor(0, PULSE_FROM), 0);
  assert.equal(trailRiskFor(PULSE_FROM, PULSE_FROM), 0);
});

test('trailRiskFor: риск достигает максимума через 55 клеток после порога', () => {
  assert.equal(trailRiskFor(PULSE_FROM + 55, PULSE_FROM), 1);
  assert.equal(trailRiskFor(PULSE_FROM + 1000, PULSE_FROM), 1, 'риск не превышает 1');
});

test('trailVisualState: без риска пульса нет вне зависимости от эффектов', () => {
  const s = trailVisualState({ trailLen: 5, pulseFrom: PULSE_FROM, fxEnabled: true, reducedMotion: false, nowFrame: 500 });
  assert.equal(s.pulse, 0);
  assert.equal(s.ownAlpha, 0.85);
});

test('trailVisualState: prefers-reduced-motion гасит пульс даже при риске', () => {
  const s = trailVisualState({ trailLen: 100, pulseFrom: PULSE_FROM, fxEnabled: true, reducedMotion: true, nowFrame: 500 });
  assert.equal(s.pulse, 0);
});

test('trailVisualState: выключенные эффекты гасят пульс даже при риске', () => {
  const s = trailVisualState({ trailLen: 100, pulseFrom: PULSE_FROM, fxEnabled: false, reducedMotion: false, nowFrame: 500 });
  assert.equal(s.pulse, 0);
});
