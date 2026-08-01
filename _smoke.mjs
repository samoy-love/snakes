// Грубый DOM-стаб, чтобы прогнать client.js на ReferenceError/TDZ при загрузке.
const noop = () => {};

function makeCtx() {
  return new Proxy(
    {
      canvas: { width: 100, height: 100 },
      measureText: () => ({ width: 10 }),
      createLinearGradient: () => ({ addColorStop: noop }),
      createRadialGradient: () => ({ addColorStop: noop }),
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h })
    },
    {
      get(t, k) {
        if (k in t) return t[k];
        return noop;
      },
      set(t, k, v) {
        t[k] = v;
        return true;
      }
    }
  );
}

class El {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.childNodes = [];
    this.style = new Proxy({ setProperty: noop, removeProperty: noop }, { get: (t, k) => (k in t ? t[k] : ''), set: (t, k, v) => ((t[k] = v), true) });
    this.dataset = {};
    this.classList = {
      _s: new Set(),
      add: function (...c) { c.forEach((x) => this._s.add(x)); },
      remove: function (...c) { c.forEach((x) => this._s.delete(x)); },
      toggle: function (c, f) { if (f === undefined) f = !this._s.has(c); f ? this._s.add(c) : this._s.delete(c); return f; },
      contains: function (c) { return this._s.has(c); }
    };
    this.attributes = {};
    this.textContent = '';
    this.value = '';
    this.options = [];
    this.parentElement = null;
    this.offsetWidth = 100;
    this.offsetTop = 0;
    this.width = 100;
    this.height = 100;
  }
  appendChild(c) { this.children.push(c); this.childNodes.push(c); if (c) c.parentElement = this; return c; }
  insertBefore(c, ref) { this.children.push(c); if (c) c.parentElement = this; return c; }
  removeChild(c) { return c; }
  remove() {}
  replaceChildren(...c) { this.children = c.filter(Boolean); this.childNodes = this.children; }
  append(...c) { c.forEach((x) => this.appendChild(x)); }
  prepend(c) { this.children.unshift(c); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  addEventListener() {}
  removeEventListener() {}
  setAttribute(k, v) { this.attributes[k] = v; }
  getAttribute(k) { return this.attributes[k] ?? null; }
  removeAttribute(k) { delete this.attributes[k]; }
  hasAttribute(k) { return k in this.attributes; }
  getAttributeNames() { return Object.keys(this.attributes); }
  cloneNode() { return new El(this.tagName); }
  getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  getContext() { return makeCtx(); }
  focus() {}
  blur() {}
  scrollTo() {}
  scrollIntoView() {}
  setPointerCapture() {}
  contains() { return false; }
  click() {}
}

const registry = new Map();
function getEl(id) {
  if (!registry.has(id)) registry.set(id, new El('div'));
  return registry.get(id);
}

const documentStub = {
  body: new El('body'),
  documentElement: new El('html'),
  head: new El('head'),
  activeElement: null,
  getElementById: (id) => getEl(id),
  createElement: (tag) => new El(tag),
  createDocumentFragment: () => new El('fragment'),
  createTextNode: (txt) => ({ textContent: txt }),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: noop,
  removeEventListener: noop,
  visibilityState: 'visible'
};

globalThis.window = {
  innerWidth: 1280,
  innerHeight: 800,
  devicePixelRatio: 1,
  addEventListener: noop,
  removeEventListener: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop }),
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  location: { protocol: 'http:', host: 'localhost', href: 'http://localhost/' },
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: noop,
  AudioContext: function () {
    return new Proxy({ currentTime: 0, state: 'running', sampleRate: 48000, destination: {} }, { get: (t, k) => (k in t ? t[k] : () => new Proxy({}, { get: () => noop })) });
  },
  WebSocket: function () { return new Proxy({}, { get: () => noop }); },
  localStorage: null
};
globalThis.document = documentStub;
Object.defineProperty(globalThis, 'navigator', { value: { language: 'ru-RU', userAgent: 'node', clipboard: {} }, configurable: true });
globalThis.location = window.location;
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = noop;
globalThis.matchMedia = window.matchMedia;
globalThis.AudioContext = window.AudioContext;
globalThis.WebSocket = window.WebSocket;
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};
window.localStorage = globalThis.localStorage;



try {
  await import('./public/client.js');
  console.log('MODULE_LOADED_OK');
} catch (e) {
  console.error('LOAD_ERROR:', e && e.stack ? e.stack.split('\n').slice(0, 12).join('\n') : e);
  process.exitCode = 1;
}
