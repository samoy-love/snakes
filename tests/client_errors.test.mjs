/*
 * public/client_errors.js — исполняемые тесты.
 *
 * Модуль крошечный, но это единственное место, откуда в продакшне видно
 * необработанные исключения клиента. Две поломки здесь стоят дорого:
 * (1) обработчик не повесился — падения молча теряются;
 * (2) обработчик сам бросил на событии без полей — и браузер получает
 *     исключение внутри обработчика исключений.
 *
 * Каждый нетривиальный тест подписан: какую поломку он ловит.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { installErrorLogging } from '../public/client_errors.js';
import { installWindowEvents, captureConsole } from './helpers/env_mock.mjs';

test('installErrorLogging: вешает обработчики на оба глобальных события', () => {
  // Ловит: потерю одного из двух addEventListener. Без 'unhandledrejection'
  // в лог не попадает ни один провалившийся await — а это большая часть
  // клиентских ошибок (fetch, decode, WebAudio).
  const win = installWindowEvents();
  try {
    installErrorLogging();
    assert.equal(win.of('error').length, 1);
    assert.equal(win.of('unhandledrejection').length, 1);
    assert.equal(win.listeners.length, 2);
  } finally {
    win.restore();
  }
});

test('installErrorLogging: без window не падает и ничего не вешает', () => {
  // Ловит: обращение к window до проверки typeof — модуль импортируется
  // первой строкой client.js, любое исключение здесь убивает всю загрузку.
  const had = 'window' in globalThis;
  const prev = globalThis.window;
  delete globalThis.window;
  try {
    assert.doesNotThrow(() => installErrorLogging());
  } finally {
    if (had) globalThis.window = prev;
  }
});

test('installErrorLogging: error логирует error, message или само событие', () => {
  // Ловит: сужение цепочки ev.error || ev.message || ev. Разные браузеры
  // заполняют разные поля; если оставить только ev.error, ошибки из
  // кросс-доменных скриптов («Script error.») исчезнут из лога совсем.
  const win = installWindowEvents();
  const con = captureConsole();
  try {
    installErrorLogging();
    const h = win.of('error')[0];

    const err = new Error('boom');
    h({ error: err, message: 'msg' });
    h({ message: 'only message' });
    h({ type: 'error' });

    assert.equal(con.errors.length, 3);
    assert.deepEqual(
      con.errors.map((a) => a[0]),
      ['client_error', 'client_error', 'client_error']
    );
    assert.equal(con.errors[0][1], err);
    assert.equal(con.errors[1][1], 'only message');
    assert.deepEqual(con.errors[2][1], { type: 'error' });
  } finally {
    con.restore();
    win.restore();
  }
});

test('installErrorLogging: unhandledrejection логирует reason или событие', () => {
  const win = installWindowEvents();
  const con = captureConsole();
  try {
    installErrorLogging();
    const h = win.of('unhandledrejection')[0];

    h({ reason: 'why' });
    h({ type: 'unhandledrejection' });

    assert.deepEqual(
      con.errors.map((a) => a[0]),
      ['client_unhandledrejection', 'client_unhandledrejection']
    );
    assert.equal(con.errors[0][1], 'why');
  } finally {
    con.restore();
    win.restore();
  }
});

test('installErrorLogging: событие без полей и null не роняют обработчик', () => {
  // Ловит: снятие optional chaining (ev?.error). Обработчик ошибок, который
  // сам бросает на пустом событии, превращает одну ошибку в бесконечный
  // каскад: исключение внутри 'error' снова стреляет 'error'.
  const win = installWindowEvents();
  const con = captureConsole();
  try {
    installErrorLogging();
    for (const h of [win.of('error')[0], win.of('unhandledrejection')[0]]) {
      assert.doesNotThrow(() => h(undefined));
      assert.doesNotThrow(() => h(null));
      assert.doesNotThrow(() => h({}));
    }
    assert.equal(con.errors.length, 6);
  } finally {
    con.restore();
    win.restore();
  }
});

test('installErrorLogging: сломанная console не роняет обработчик', () => {
  // Ловит: снятие try/catch вокруг console.error. На части встроенных
  // браузеров (WebView внутри мессенджеров) console бывает урезана.
  const win = installWindowEvents();
  const prev = console.error;
  console.error = () => {
    throw new Error('no console');
  };
  try {
    installErrorLogging();
    assert.doesNotThrow(() => win.of('error')[0]({ message: 'x' }));
    assert.doesNotThrow(() => win.of('unhandledrejection')[0]({ reason: 'x' }));
  } finally {
    console.error = prev;
    win.restore();
  }
});
