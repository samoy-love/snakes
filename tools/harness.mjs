/*
 * tools/harness.mjs — offline visual harness for the Snakes client.
 *
 * Purpose: the browser panel available to the agents in this environment reports
 * requestAnimationFrame = 0 fps, document.hidden = true and a 0x0 canvas, so no
 * one has ever *seen* the playfield. This harness boots the real, unmodified
 * public/client.js inside Node:
 *
 *   - DOM comes from jsdom, loading the real public/index.html;
 *   - <canvas> is backed by @napi-rs/canvas, so every 2D call really rasterises;
 *   - WebSocket comes from `ws`, so the client talks to the real Go server;
 *   - requestAnimationFrame is a manual queue we pump by hand, so frames are
 *     deterministic and we can snapshot any one of them to PNG.
 *
 * NOTHING here is loaded by the game at runtime. tools/ has its own package.json
 * and its own node_modules; public/ stays dependency-free.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import WebSocketImpl from 'ws';
import { createCanvas, Path2D, DOMMatrix, ImageData } from '@napi-rs/canvas';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const SHOT_DIR = path.join(HERE, 'shots');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- canvas --
 * jsdom ships no 2D context. We graft @napi-rs/canvas onto
 * HTMLCanvasElement: width/height become real accessors that resize the
 * backing surface, and getContext('2d') hands out the native context.
 */
function installCanvas(win) {
  const proto = win.HTMLCanvasElement.prototype;
  const backing = new WeakMap();

  function attrNum(el, name, dflt) {
    const raw = el.getAttribute(name);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
  }
  function surface(el) {
    let b = backing.get(el);
    if (!b) {
      b = createCanvas(attrNum(el, 'width', 300), attrNum(el, 'height', 150));
      backing.set(el, b);
    }
    return b;
  }
  function dim(name, dflt) {
    return {
      configurable: true,
      get() {
        return surface(this)[name] || dflt;
      },
      set(v) {
        const n = Math.max(1, Math.floor(Number(v) || 0));
        const b = surface(this);
        if (b[name] !== n) b[name] = n;
        this.setAttribute(name, String(n));
      },
    };
  }
  Object.defineProperty(proto, 'width', dim('width', 300));
  Object.defineProperty(proto, 'height', dim('height', 150));

  proto.getContext = function getContext(type) {
    if (String(type).toLowerCase() !== '2d') return null;
    // Cache: the client grabs the context once and keeps it forever, and a
    // fresh context per call would silently drop the setTransform() from
    // resize().
    if (!this.__ctx2d) {
      const c = surface(this).getContext('2d');
      /* The client builds offscreen tiles with document.createElement('canvas')
       * and feeds them to createPattern/drawImage. Those are jsdom elements,
       * which the native context does not recognise — unwrap them to the
       * backing surface, otherwise every patterned territory throws and the
       * field renders flat. */
      const unwrap = (img) => (img && backing.has(img) ? backing.get(img) : img);
      const cp = c.createPattern.bind(c);
      c.createPattern = (img, rep) => cp(unwrap(img), rep);
      const di = c.drawImage.bind(c);
      c.drawImage = (img, ...rest) => di(unwrap(img), ...rest);
      this.__ctx2d = c;
    }
    return this.__ctx2d;
  };
  proto.toDataURL = function toDataURL() {
    return `data:image/png;base64,${surface(this).toBuffer('image/png').toString('base64')}`;
  };
  proto.__surface = function __surface() {
    return surface(this);
  };
  win.__canvasSurface = (el) => surface(el);
}

/* ------------------------------------------------------------------ rAF --
 * A manual frame queue. pump() drains exactly the callbacks that were pending
 * when it was called, so a self-rescheduling loop like draw() advances by
 * exactly one frame per pump.
 */
function installRaf(win) {
  let seq = 1;
  let queue = [];
  win.requestAnimationFrame = (cb) => {
    const id = seq++;
    queue.push({ id, cb });
    return id;
  };
  win.cancelAnimationFrame = (id) => {
    queue = queue.filter((r) => r.id !== id);
  };
  win.__pumpFrame = () => {
    const batch = queue;
    queue = [];
    const ts = performance.now();
    for (const r of batch) {
      try {
        r.cb(ts);
      } catch (e) {
        win.__frameErrors.push(String(e && e.stack ? e.stack : e));
      }
    }
    return batch.length;
  };
  win.__frameErrors = [];
}

/* Minimal stubs for the handful of browser APIs jsdom lacks and the client
 * actually touches. Kept deliberately small: anything bigger would start
 * simulating the browser instead of exercising the client. */
function installStubs(win) {
  win.matchMedia = (q) => ({
    matches: false,
    media: String(q || ''),
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  });
  /* WebSocket spy: the harness records every JSON frame in both directions so
   * a scenario can assert on the wire protocol (e.g. "did the client send a
   * `viewport` message, and what did the server grant?") instead of guessing. */
  win.__wsSent = [];
  win.__wsRecv = [];
  class SpyWebSocket extends WebSocketImpl {
    constructor(...a) {
      super(...a);
      this.addEventListener('message', (ev) => {
        if (typeof ev.data === 'string') {
          try {
            win.__wsRecv.push(JSON.parse(ev.data));
          } catch {}
        }
      });
    }
    send(data) {
      let parsed = null;
      if (typeof data === 'string' || data instanceof Uint8Array) {
        try {
          parsed = JSON.parse(Buffer.from(data).toString('utf8'));
          win.__wsSent.push(parsed);
        } catch {}
      }
      /* A/B switch for C2: drop the client's `viewport` request so the server
       * falls back to the historical fixed 80x56 ROI. That is the only honest
       * way to photograph the "before" state of the portrait fog band. */
      if (win.__blockViewport && parsed?.type === 'viewport') return;
      return super.send(data);
    }
  }
  win.WebSocket = SpyWebSocket;
  win.AudioContext = undefined;
  win.webkitAudioContext = undefined;
  if (!win.crypto) win.crypto = globalThis.crypto;
  if (!win.crypto.getRandomValues) win.crypto.getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  win.scrollTo = () => {};
  // Canvas-adjacent constructors jsdom does not provide; the client uses Path2D
  // for the cooling-territory dashes and the capture seams.
  win.Path2D = Path2D;
  win.DOMMatrix = DOMMatrix;
  win.ImageData = ImageData;
  win.twemoji = { parse() {} };
  // visualViewport: the client (C5) subscribes to it; give it a real
  // EventTarget so the harness can fire resize on it like iOS Safari does.
  const vv = new win.EventTarget();
  vv.width = win.innerWidth;
  vv.height = win.innerHeight;
  vv.scale = 1;
  vv.offsetTop = 0;
  vv.offsetLeft = 0;
  Object.defineProperty(win, 'visualViewport', { value: vv, configurable: true, writable: true });
}

function setViewport(win, w, h, dpr) {
  Object.defineProperty(win, 'innerWidth', { value: w, configurable: true, writable: true });
  Object.defineProperty(win, 'innerHeight', { value: h, configurable: true, writable: true });
  Object.defineProperty(win, 'devicePixelRatio', { value: dpr, configurable: true, writable: true });
  if (win.visualViewport) {
    win.visualViewport.width = w;
    win.visualViewport.height = h;
  }
  if (win.document?.documentElement) {
    Object.defineProperty(win.document.documentElement, 'clientWidth', { value: w, configurable: true });
    Object.defineProperty(win.document.documentElement, 'clientHeight', { value: h, configurable: true });
  }
}

/**
 * Boot the real client.
 * @param {object} o
 * @param {number} o.width   CSS viewport width  (e.g. 390 for a phone)
 * @param {number} o.height  CSS viewport height (e.g. 844)
 * @param {number} [o.dpr]
 * @param {string} [o.origin] server origin, must match WS_ORIGINS
 * @param {string} [o.lang]  'ru' | 'en'
 * @param {object} [o.storage] localStorage seed
 */
export async function bootClient(o = {}) {
  const width = o.width || 1366;
  const height = o.height || 768;
  const dpr = o.dpr || 1;
  const origin = o.origin || 'http://localhost:3200';
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

  const dom = new JSDOM(html, {
    url: `${origin}/`,
    pretendToBeVisual: false,
    runScripts: 'outside-only',
    resources: undefined,
  });
  const win = dom.window;

  win.__blockViewport = !!o.blockViewport;
  installCanvas(win);
  installRaf(win);
  installStubs(win);
  setViewport(win, width, height, dpr);

  try {
    win.localStorage.clear();
  } catch {}
  win.localStorage.setItem('lang', o.lang || 'ru');
  for (const [k, v] of Object.entries(o.storage || {})) win.localStorage.setItem(k, String(v));

  // Publish the jsdom realm as the module-global environment. client.js is an
  // ES module that reads bare `document`, `location`, `localStorage`, ... at
  // evaluation time, so these must be live before the import.
  const shared = [
    'window', 'document', 'location', 'navigator', 'localStorage', 'sessionStorage',
    'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'WebSocket',
    'devicePixelRatio', 'innerWidth', 'innerHeight', 'visualViewport', 'screen',
    'HTMLCanvasElement', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent',
    'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'TouchEvent', 'UIEvent',
    // NB: setTimeout & co. stay Node's own — re-exporting jsdom's versions as
    // globals makes jsdom's internal timer bookkeeping recurse into itself.
    'getComputedStyle',
    'Image', 'DOMParser', 'MutationObserver', 'twemoji', 'scrollTo', 'history',
    'Path2D', 'DOMMatrix', 'ImageData',
  ];
  const saved = new Map();
  for (const k of shared) {
    saved.set(k, globalThis[k]);
    const v = k === 'window' ? win : win[k];
    if (v === undefined) continue;
    try {
      Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    } catch {}
  }
  globalThis.self = win;

  const errors = [];
  const warns = [];
  const origError = console.error;
  const origWarn = console.warn;
  console.error = (...a) => {
    errors.push(a.map(String).join(' '));
  };
  console.warn = (...a) => {
    warns.push(a.map(String).join(' '));
  };

  // Cache-bust so repeated boots inside one process re-evaluate the module.
  const url = `${pathToFileURL(path.join(PUBLIC_DIR, 'client.js')).href}?boot=${Date.now()}-${Math.random()}`;
  await import(url);

  const canvas = win.document.getElementById('game');

  const api = {
    win,
    dom,
    document: win.document,
    canvas,
    errors,
    warns,
    frameErrors: win.__frameErrors,
    restore() {
      console.error = origError;
      console.warn = origWarn;
      for (const [k, v] of saved) {
        try {
          Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
        } catch {}
      }
      try {
        dom.window.close();
      } catch {}
    },
    /** Run n animation frames at ~60 fps of real wall-clock time. */
    async frames(n = 1, gapMs = 16) {
      for (let i = 0; i < n; i++) {
        win.__pumpFrame();
        if (gapMs > 0) await sleep(gapMs);
      }
    },
    /** Resize like a real browser: mutate the viewport, then fire the events. */
    async resize(w, h, { orientation = false, visual = false } = {}) {
      setViewport(win, w, h, dpr);
      if (orientation) win.dispatchEvent(new win.Event('orientationchange'));
      else if (visual) win.visualViewport.dispatchEvent(new win.Event('resize'));
      else win.dispatchEvent(new win.Event('resize'));
      await api.frames(2);
    },
    click(id) {
      const el = win.document.getElementById(id);
      if (!el) throw new Error(`no #${id}`);
      el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
      return el;
    },
    key(code, key) {
      win.dispatchEvent(new win.KeyboardEvent('keydown', { code, key: key || code, bubbles: true }));
      win.document.dispatchEvent(new win.KeyboardEvent('keydown', { code, key: key || code, bubbles: true }));
    },
    /** Save the game canvas (or any canvas id) as PNG, over a dark backdrop. */
    snapshot(name, elId = 'game') {
      const el = win.document.getElementById(elId);
      const surf = win.__canvasSurface(el);
      const out = createCanvas(surf.width, surf.height);
      const c = out.getContext('2d');
      c.fillStyle = '#0b0e14';
      c.fillRect(0, 0, out.width, out.height);
      c.drawImage(surf, 0, 0);
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      const p = path.join(SHOT_DIR, `${name}.png`);
      fs.writeFileSync(p, out.toBuffer('image/png'));
      return p;
    },
    /** Rough ink coverage of a rect, in percent — lets a script assert that a
     *  region is not empty black (fog) without a human looking at it. */
    ink(x, y, w, h, elId = 'game') {
      const el = win.document.getElementById(elId);
      const surf = win.__canvasSurface(el);
      const cw = Math.min(w, surf.width - x);
      const chh = Math.min(h, surf.height - y);
      if (cw <= 0 || chh <= 0) return 0;
      const d = surf.getContext('2d').getImageData(x, y, cw, chh).data;
      let lit = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 8 && d[i] + d[i + 1] + d[i + 2] > 60) lit++;
      }
      return (lit / (d.length / 4)) * 100;
    },
    /** Mean RGB of a rect — useful for "is this tile my colour?" checks. */
    meanRGB(x, y, w, h, elId = 'game') {
      const el = win.document.getElementById(elId);
      const surf = win.__canvasSurface(el);
      const d = surf.getContext('2d').getImageData(x, y, w, h).data;
      let r = 0, g = 0, b = 0;
      const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
      }
      return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    },
  };
  return api;
}
