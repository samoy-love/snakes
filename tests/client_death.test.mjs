import test from 'node:test';
import assert from 'node:assert/strict';
import { DEATH_REASON, deathReasonSuffix } from '../public/client_death.js';

test('deathReasonSuffix сопоставляет известные причины их суффиксам', () => {
  assert.equal(deathReasonSuffix(DEATH_REASON.CUT), 'cut');
  assert.equal(deathReasonSuffix(DEATH_REASON.HEADON), 'headon');
  assert.equal(deathReasonSuffix(DEATH_REASON.SELFTRAIL), 'selftrail');
  assert.equal(deathReasonSuffix(DEATH_REASON.WALL), 'wall');
});

test('deathReasonSuffix возвращает пустую строку для неизвестной/нулевой причины', () => {
  assert.equal(deathReasonSuffix(0), '');
  assert.equal(deathReasonSuffix(99), '');
  assert.equal(deathReasonSuffix(undefined), '');
  assert.equal(deathReasonSuffix(null), '');
});

test('deathReasonSuffix принимает числа как строки (бинарный протокол шлёт uint8)', () => {
  assert.equal(deathReasonSuffix('1'), 'cut');
});
