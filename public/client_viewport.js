/* Геометрия вида: сколько клеток клиент способен показать и что он просит
   у сервера, плюс пересчёт канваса при изменении размера окна.

   C2 «Адаптивный ROI». Раньше окно ROI на сервере было жёстко 80×56, и на
   портретном телефоне экран физически в него не влезал: масштаб приходилось
   зажимать снизу, а после резкого разворота внизу всё равно оставалась
   полоса тумана. Теперь клиент сообщает размер окна В КЛЕТКАХ, который
   реально способен нарисовать, а сервер подтверждает выданный:

     -> {"type":"viewport","data":{"w":46,"h":94}}
     <- {"type":"viewport","data":{"w":46,"h":94}}   // фактически выданное

   Границы приходят в hello.roi {w,h,minW,minH,maxW,maxH,maxArea,step}.
   Всё написано защищённо: старый сервер hello.roi не шлёт, ack не приходит,
   сообщение молча игнорируется — клиент работает как раньше на 80×56.

   Здесь же resize(): C5 — на iOS Safari при повороте экрана и при
   сворачивании адресной строки следующий кадр может не прийти вовсе
   (страница успевает уйти в фон), поэтому отложенный путь через rAF
   дополнен немедленным. */

import { dom } from './client_dom.js';
import { ROI_MARGIN_CELLS, baseCellFor } from './client_field_view.js';

/* Отправка в сокет и перерисовка превью меню приходят из initViewport(), а не
   импортом: сокет создаётся позже этого модуля, а превью тянет за собой весь
   магазин — импорт замкнул бы цикл ради двух вызовов. */
let send = () => false;
let onResized = () => {};

/* C2 «Адаптивный ROI». Раньше окно ROI на сервере было жёстко 80×56, и на
   портретном телефоне экран физически не влезал в него: масштаб приходилось
   зажимать снизу (см. draw()), а после резкого разворота внизу всё равно
   оставалась полоса тумана. Теперь сервер принимает сообщение
   `viewport {w,h}` — размер окна В КЛЕТКАХ, который клиент реально способен
   нарисовать, — и подтверждает выданный размер тем же типом сообщения.

   Контракт (ws.go, case "viewport" + hello.roi):
     → {"type":"viewport","data":{"w":46,"h":94}}
     ← {"type":"viewport","data":{"w":46,"h":94}}   // фактически выданное
   Границы приходят в hello.roi {w,h,minW,minH,maxW,maxH,maxArea,step}.

   Всё написано защищённо: если сервер старый — hello.roi нет, ack не придёт,
   сообщение молча проигнорируется, и клиент работает ровно как раньше на
   дефолтных 80×56. */
export const roiCaps = {
  w: 80,
  h: 56,
  minW: 40,
  minH: 28,
  maxW: 120,
  maxH: 120,
  maxArea: 6000,
  step: 8,
};
// Поддержку подтверждаем только по факту ack — до него доверяем world.lastRoi.
export const roi = { grant: null };
let viewportSentW = 0;
let viewportSentH = 0;
let viewportTimer = 0;

export function applyRoiCaps(src) {
  if (!src || typeof src !== 'object') return;
  for (const k of ['w', 'h', 'minW', 'minH', 'maxW', 'maxH', 'maxArea', 'step']) {
    const v = Number(src[k]);
    if (Number.isFinite(v) && v > 0) roiCaps[k] = Math.floor(v);
  }
}

/* Сколько клеток нужно, чтобы закрыть текущий вьюпорт. Базовый масштаб тот же,
   что в draw() (до клэмпа по ROI), плюс ROI_MARGIN_CELLS на гуляние окна:
   сервер снапит его по ROIStep и смещает вперёд по ходу движения.

   Масштаб берётся из baseCellFor(), а не считается здесь заново: формула жила
   в двух местах, и после появления потолка видимых клеток телефон просил у
   сервера окно под старый, неограниченный масштаб — вдвое больше того, что
   реально рисует. Лишняя половина окна — это лишняя сетка в каждом снапшоте,
   которую телефон качает и разбирает, чтобы никогда не показать. */
function computeViewportCells() {
  const cw = Math.max(1, Number(window.innerWidth) || 1);
  const chh = Math.max(1, Number(window.innerHeight) || 1);
  const cell = baseCellFor({ cw, viewH: chh });
  let w = Math.ceil(cw / cell) + ROI_MARGIN_CELLS;
  let h = Math.ceil(chh / cell) + ROI_MARGIN_CELLS;
  w = Math.max(roiCaps.minW, Math.min(roiCaps.maxW, w));
  h = Math.max(roiCaps.minH, Math.min(roiCaps.maxH, h));
  // Тот же порядок, что в clampViewport() на сервере: пропорционально, потом
  // подрезаем длинную сторону. Иначе наш «ожидаемый» размер разойдётся с
  // выданным и камера будет считать не по тому окну.
  if (w * h > roiCaps.maxArea) {
    const f = Math.sqrt(roiCaps.maxArea / (w * h));
    w = Math.max(roiCaps.minW, Math.floor(w * f));
    h = Math.max(roiCaps.minH, Math.floor(h * f));
    let guard = 4096;
    while (w * h > roiCaps.maxArea && guard-- > 0) {
      if (w - roiCaps.minW >= h - roiCaps.minH && w > roiCaps.minW) w--;
      else if (h > roiCaps.minH) h--;
      else break;
    }
  }
  return { w, h };
}

/* Сброс «что уже отправлено»: после реконнекта сервер про наше окно не
   помнит, и без сброса клиент считал бы, что просить нечего. */
export function forgetSentViewport() {
  viewportSentW = 0;
  viewportSentH = 0;
}

/* Сервер подтверждает фактически выданное окно — оно может быть меньше
   запрошенного (потолок по площади), и камера обязана считать по нему. */
export function applyViewportGrant(d) {
  const gw = Number(d?.w);
  const gh = Number(d?.h);
  if (Number.isFinite(gw) && gw > 0 && Number.isFinite(gh) && gh > 0) {
    roi.grant = { w: Math.floor(gw), h: Math.floor(gh) };
  }
}

export function sendViewportNow() {
  let want;
  try {
    want = computeViewportCells();
  } catch {
    return;
  }
  if (want.w === viewportSentW && want.h === viewportSentH) return;
  // Не отправлено — не запоминаем: иначе после реконнекта сервер останется на
  // дефолте, а клиент будет думать, что попросил.
  if (!send('viewport', { w: want.w, h: want.h })) return;
  viewportSentW = want.w;
  viewportSentH = want.h;
}

/* Дебаунс: поворот экрана и сворачивание адресной строки на iOS дают серию
   событий подряд, а каждое из них — это перестройка ROI на сервере. */
function scheduleViewportSend(delayMs = 250) {
  if (viewportTimer) clearTimeout(viewportTimer);
  viewportTimer = setTimeout(() => {
    viewportTimer = 0;
    sendViewportNow();
  }, Math.max(0, delayMs));
}


/* Потолок плотности буфера канваса.

   Телефоны давно приехали на devicePixelRatio 3: на iPhone Pro Max
   полноэкранный канвас — это 1320x2868 ≈ 3.8 Мпикс, вдвое больше, чем у
   десктопа в 1920x1080, и каждый fillRect поля закрашивает втрое больше
   физических пикселей. Поле собрано из плоских прямоугольников и текста, и
   разница между 2x и 3x на них глазом не ловится — в отличие от разницы в
   частоте кадров. */
const MAX_DPR = 2;

function resize() {
  const ctx = dom.canvas?.getContext?.('2d');
  if (!ctx) return;
  const dpr = Math.min(MAX_DPR, Math.max(1, Number(window.devicePixelRatio) || 1));
  dom.canvas.width = Math.floor(window.innerWidth * dpr);
  dom.canvas.height = Math.floor(window.innerHeight * dpr);
  dom.canvas.style.width = `${window.innerWidth}px`;
  dom.canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
}

let resizeRaf = 0;

// C5: общий хвост пересчёта — и для отложенного, и для немедленного пути.
function afterResize() {
  // C3: панель «Ваш облик» тянется по ширине колонки меню.
  try {
    onResized();
  } catch {}
  // C2: новый размер вьюпорта — новая просьба к серверу, с дебаунсом.
  scheduleViewportSend();
}

function scheduleResize() {
  if (resizeRaf) return;
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = 0;
    resize();
    afterResize();
  });
}

/* C5: `resize` откладывался до следующего кадра, а на iOS Safari при повороте
   экрана и при сворачивании/разворачивании адресной строки следующий кадр
   может не прийти вовсе (страница успевает уйти в фон) — канвас оставался в
   старом размере, и поле рисовалось с обрезанным или растянутым краем.
   Поворот и visualViewport пересчитываем немедленно, а отложенный путь
   отменяем, чтобы он не перезаписал результат теми же числами. */
function resizeNow() {
  if (resizeRaf) {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = 0;
  }
  resize();
  afterResize();
}

/* Слушатели вешаются из initViewport(), а не при загрузке модуля: до того,
   как готов сокет, просить у сервера окно бессмысленно. */
export function initViewport(ctx) {
  send = typeof ctx?.send === 'function' ? ctx.send : send;
  onResized = typeof ctx?.onResized === 'function' ? ctx.onResized : onResized;

  window.addEventListener('resize', scheduleResize);
  window.addEventListener('orientationchange', () => {
    resizeNow();
    /* На части устройств innerWidth/innerHeight на момент orientationchange ещё
       старые — добираем повторным пересчётом после того, как браузер применит
       новую метрику. Оба вызова идемпотентны. */
    setTimeout(resizeNow, 60);
    setTimeout(resizeNow, 300);
  });
  try {
    // Клавиатура и сворачивание адресной строки меняют visualViewport, но не
    // всегда дают window.resize.
    window.visualViewport?.addEventListener?.('resize', resizeNow);
    window.screen?.orientation?.addEventListener?.('change', resizeNow);
  } catch {}
  resize();
}
