# HTTP: кэширование и эндпоинты

Что отдаётся браузеру и с какими заголовками.

## Кэширование статики

`client.js` (~490 КБ) и `style.css` (~180 КБ) раньше отдавались с
`Cache-Control: no-store` и качались заново при каждом F5. Сборщика в проекте
нет и вводить его не планируется, поэтому версионирование сделано через query.

Как это работает:

1. `public/index.html` ссылается на собственную статику как
   `/client.js?v=__BUILD__` — литеральный плейсхолдер.
2. Выкатка подменяет `__BUILD__` на идентификатор релиза
   (`20260802-010203-abc1234`) **в копии, которая уезжает на сервер**. В
   репозитории литерал остаётся как есть.
3. Ответ получает `Cache-Control: public, max-age=31536000, immutable`, только
   если в query есть непустой `v`, отличный от литерала `__BUILD__`. Иначе —
   `no-store`. HTML — всегда `no-store`: именно в нём записан текущий `?v=`.

Правило продублировано в двух местах и обязано совпадать:

| Где | Что |
| --- | --- |
| `internal/httpx/middleware.go`, `isVersionedAsset` / `CacheStaticMiddleware` | Когда статику отдаёт сам Go-процесс |
| Конфигурация nginx в deploy-kit, map'ы `$snakes_asset_cc` / `$snakes_asset_pragma` / `$snakes_asset_expires` | Когда статику отдаёт nginx (в проде — всегда: он читает `public/` с диска и делает `proxy_hide_header Cache-Control`) |

Проверка (значение `v` произвольное, лишь бы не пустое и не `__BUILD__`):

```sh
curl -sI 'http://127.0.0.1:3000/client.js'          | grep -i cache-control
# Cache-Control: no-store
curl -sI 'http://127.0.0.1:3000/client.js?v=rel-1'  | grep -i cache-control
# Cache-Control: public, max-age=31536000, immutable
```

**Ограничение.** `client.js` — ES-модуль и импортирует соседние
(`client_errors.js`, `client_audio.js`, `client_fx.js`, `client_net.js`) по
относительным путям. Query из `<script src>` импортами **не наследуется**, их
URL в `index.html` не прописан, поэтому версионировать их через query нельзя —
они осознанно остаются на `no-store`. Суммарно это ~20 КБ против 490 КБ
`client.js`. Если понадобится закрыть и их, вариантов два: import map в
`index.html` (тоже штампуется деплоем) или замена `no-store` на
`no-cache` + `ETag`, чтобы вместо перекачки был `304`.

## HTTP-эндпоинты

| Путь | Код | Описание |
| --- | --- | --- |
| `GET /` | 200 | `public/index.html`. В проде отдаётся nginx-ом напрямую с диска |
| `GET /client.js`, `/style.css`, … | 200 | Статика из `./public` относительно рабочей директории (`mustCwd()` в `main.go`) |
| `GET /emoji-64/*.png` | 200 | Спрайты эмодзи, кэш на год |
| `GET /favicon.ico` | 204 | Пустой ответ, чтобы не ловить 404 в логах |
| `GET /healthz` | 200 `ok` | Liveness. На нём же завязан `HEALTH` в `.deploy-kit/prod.env` |
| `GET /readyz` | 200 `ready` / 503 | Readiness. 503 `not ready: <причина>`, если хранилище профилей ушло в read-only |
| `GET /metrics` | 200 | Prometheus text exposition format (`text/plain; version=0.0.4`): `snakes_ws_active`, `snakes_ws_connections_total`, `snakes_rooms`, `snakes_build_info` и остальные — см. [метрики](metrics.md). Регистрируется на игровом порту, только когда `METRICS_ADDR` пуст |
| `GET /ws` | 101 / 403 | WebSocket. 403 при неразрешённом `Origin` |

`/metrics` наружу закрыт с двух сторон. Когда задан `METRICS_ADDR` (штатная
выкатка), эндпоинт живёт **только** на этом отдельном слушателе и на игровом
порту не регистрируется вообще; Prometheus ходит туда с адреса docker-моста, см.
[метрики](metrics.md). Когда `METRICS_ADDR` пуст (локальный запуск), эндпоинт
остаётся на игровом порту, а тот по умолчанию слушает loopback. Публичный
server-блок nginx в любом случае отдаёт на `/metrics` `404` — но полагаться на
одну эту строчку в чужом репозитории больше не нужно.

---
