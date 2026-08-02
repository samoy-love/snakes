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
| `server.go`, `isVersionedAsset` / `cacheStaticMiddleware` | Когда статику отдаёт сам Go-процесс |
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
| `GET /` | 200 | `public/index.html`. В compose отдаётся nginx-ом напрямую с диска |
| `GET /client.js`, `/style.css`, … | 200 | Статика из `./public` относительно рабочей директории (`mustCwd()` в `server.go`) |
| `GET /emoji-64/*.png` | 200 | Спрайты эмодзи, кэш на год |
| `GET /favicon.ico` | 204 | Пустой ответ, чтобы не ловить 404 в логах |
| `GET /healthz` | 200 `ok` | Liveness. На нём же завязан HEALTHCHECK контейнера |
| `GET /readyz` | 200 `ready` | Readiness |
| `GET /metrics` | 200 | JSON: `wsConnections`, `wsActive`, `wsWriteErrors`, `wsDropped` |
| `GET /ws` | 101 / 403 | WebSocket. 403 при неразрешённом `Origin` |

`/metrics` наружу закрыт: публичный server-блок nginx отдаёт на него `404`
безусловно, а сами метрики доступны на отдельном слушателе `nginx:8081`, который
compose наружу не публикует.

---
