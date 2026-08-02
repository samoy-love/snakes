# Snakes — многопользовательский захват территории

[![CI](https://github.com/tr0llex/snakes/actions/workflows/ci.yml/badge.svg)](https://github.com/tr0llex/snakes/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/tr0llex/snakes/branch/main/graph/badge.svg)](https://codecov.io/gh/tr0llex/snakes)
[![прод](https://img.shields.io/website?url=https%3A%2F%2Fsnakes.samoy.love&up_message=online&up_color=2ea043&down_message=offline&label=snakes.samoy.love)](https://snakes.samoy.love)

Браузерная игра в жанре splix.io: змейка ползает по общему полю 200×140 клеток и
закрашивает его своим цветом. Внутри своей территории змейка в безопасности; стоит
выйти за границу — за головой тянется **след**. Чтобы забрать землю, надо вернуться
к себе и **замкнуть петлю**: всё внутри контура переходит игроку, отбирая клетки у
соперников. Смерть — от столкновения со своим или чужим следом, от выхода за поле и
от лобовых. Убитый теряет всю территорию. Чем крупнее заход, тем больше куш и тем
выше риск: длинный след — приглашение его пересечь.

Матч длится **5 минут** (3000 тиков по 100 мс), между матчами 15 секунд на таблицу
результатов. Комнаты создаются автоматически: до 16 живых игроков, свободные места
добираются **ботами** с полноценным ИИ — они планируют заходы, оценивают свободное
место, считают путь обратно и уклоняются от чужих следов.

Поверх базовой механики — слой прогрессии: бонусы (щит, рывок, мега-рывок, «нова»),
мутаторы матча, награда за голову, серии убийств и месть. За контракты и ежедневки
начисляется валюта **«Стиль»**, на неё в магазине покупается косметика пяти
категорий. Прогресс привязан к анонимному профилю и переживает перезагрузку.

Играть: **[snakes.samoy.love](https://snakes.samoy.love)**

## Стек

**Сервер** — Go 1.22, единственная внешняя зависимость `nhooyr.io/websocket`.
Никакой БД: профили лежат в JSON-файле, состояние матча — в памяти.

**Клиент** — vanilla JS (ES-модули) и Canvas 2D, без сборщика и фреймворков.

**Прод** — systemd-юнит за системным nginx, выкатка через
[deploy-kit](https://github.com/tr0llex/deploy-kit).

## Быстрый старт

Нужен Go 1.22+.

```bash
go run .
```

Открыть <http://localhost:3000>. Статика раздаётся из `./public` **относительно
рабочей директории**, поэтому запускать надо из корня репозитория.

Для локального запуска `WS_ORIGINS` не нужен: loopback-origin разрешён отдельно
(`WS_ALLOW_LOCALHOST`). Профили лягут в `./data/profiles.json`.

## Структура

| Путь | Назначение |
| --- | --- |
| `main.go` | Точка входа: окружение, роутинг (`/ws`, `/healthz`, `/readyz`, `/metrics`, статика), middleware, graceful shutdown |
| `internal/game/` | Игровое ядро вокруг `Room`: сетка и захват территории (`grid.go`), матчи и рассылка (`room.go`), боты (`bot_ai.go`), экономика — бонусы, контракты, ежедневки, ачивки, косметика (`economy.go`), сериализация на провод (`wire.go`), WebSocket-команды (`ws.go`) |
| `internal/protocol/` | Бинарный протокол: размеры поля, коды событий, побайтовая раскладка |
| `internal/httpx/` | Транспорт: allowlist origin'ов, per-IP rate-limit, IP за прокси, заголовки и кэширование статики |
| `internal/profiles/` | Профили: HMAC-токены личности, атомарная запись, TTL, автосейв, лимиты |
| `internal/metrics/` | Счётчики и выдача `/metrics` в формате Prometheus |
| `internal/botnames/` | Пулы ников ботов и подбор уникального имени |
| `internal/sanitize/` | Единые правила чистки имён, чата, названий комнат и полей лога |
| `internal/envcfg/` | Разбор настроек из окружения |
| `public/` | Клиент: рендер, ввод, UI, сетевой слой, эффекты, звук |
| `deploy/systemd/` | Юнит, drop-in'ы и таймер часовых снимков `profiles.json` |
| `scripts/backup_profiles.sh` | Сам скрипт снимков: единственная защита прогресса игроков |
| `tests/` | Клиентские тесты протокола на Node и эталонные буферы |
| `.deploy-kit/` | Описание цели выкатки |

Подробности — в [docs/](docs/): [протокол](docs/protocol.md),
[HTTP и кэширование](docs/http.md), [безопасность](docs/security.md),
[тесты](docs/testing.md).

## Конфигурация

| Переменная | Дефолт | Описание |
| --- | --- | --- |
| `PORT` | `3000` | Порт HTTP/WebSocket-сервера |
| `BIND_ADDR` | `127.0.0.1` | Интерфейс привязки. Дефолт — только loopback: снаружи сервер доступен через nginx, напрямую — нет |
| `ROOM_LIMIT` | `16` | Максимум живых игроков в комнате |
| `MATCH_DURATION_TICKS` | `3000` | Длительность матча в тиках (тик = 100 мс) |
| `MATCH_INTERMISSION_TICKS` | `150` | Пауза между матчами в тиках |
| `WS_ORIGINS` | `http(s)://snakes.samoy.love` | Origin'ы, которым разрешено рукопожатие `/ws`. Иначе 403 |
| `WS_ALLOW_LOCALHOST` | `1` | Пропускать ли loopback-origin мимо allowlist. **В проде обязательно `0`** — иначе любая локально запущенная страница получает валидный Origin |
| `PROFILE_SECRET` | *(случайный)* | HMAC-ключ подписи токенов личности. **В проде задавать обязательно**, см. [безопасность](docs/security.md) |
| `PROFILES_PATH` | `./data/profiles.json` | Путь к файлу профилей. На проде — `/var/lib/snakes/profiles.json` |
| `TRUSTED_PROXIES` | `127.0.0.1/8,::1` | Чьему `X-Forwarded-For` можно верить |
| `MAX_ROOMS` | `64` | Потолок числа живых комнат (~500 КБ каждая) |
| `MAX_PROFILES` | `50000` | Потолок числа профилей: сохранение маршалит весь набор целиком |
| `PROFILE_EMPTY_TTL_HOURS` | `6` | Через сколько часов вычищается профиль без прогресса (с прогрессом — 90 дней) |
| `BOT_DEATH_SNAP` | *(пусто)* | Отладочный «снап» бота при смерти. В проде не нужен |
| `METRICS_ADDR` | *(пусто)* | Адрес отдельного слушателя метрик (`host:port`). Пусто — отдельного слушателя нет, см. [Метрики](#метрики) |

Фактические лимиты сервер печатает в лог при старте — там же версия сборки:

```
snakes build version=... commit=... buildTime=...
limits roomLimit=16 maxRooms=64 maxProfiles=50000 wsAllowLocalhost=false
```

Версия вшивается линкером (`-X main.Version=...`) на выкатке и отдаётся клиенту в
пакете `hello` и в `/version.json`. Ручная `go build` без `-ldflags` даёт
`version=dev` — на проде это означает, что бинарь собран мимо пайплайна.

Шаблон конфигурации — `.env.example`. Тест `env_docs_test.go` следит, чтобы каждая
`os.Getenv` в коде была описана и здесь, и в шаблоне.

## Метрики

`/metrics` отдаёт text exposition format Prometheus. Реализация своя
(`internal/metrics`), без `prometheus/client_golang`: формат — имя, метки,
число, перевод строки, а библиотека тянет за собой protobuf и expfmt ради трёх
десятков счётчиков.

Считается не только транспорт, но и то, как в игру играют:

| Метрика | О чём |
| --- | --- |
| `snakes_rooms`, `snakes_players`, `snakes_bots`, `snakes_matches_running` | Что происходит прямо сейчас |
| `snakes_matches_total`, `snakes_match_duration_seconds`, `snakes_match_survivors` | Матчи: сколько, как долго, сколько игроков доживает до конца |
| `snakes_tick_duration_seconds` | Время обсчёта тика при бюджете 100 мс |
| `snakes_cells_captured_total`, `snakes_loops_closed_total` | Территория и замкнутые петли |
| `snakes_kills_total`, `snakes_deaths_total{reason}` | Смерти по причинам: `self_trail`, `trail_cut`, `head_on`, `wall` |
| `snakes_powerup_pickups_total{type}`, `snakes_mutators_activated_total{mutator}` | Бонусы по типам и сработавшие мутаторы |
| `snakes_contracts_completed_total{type}`, `snakes_dailies_completed_total{type}` | Выполненные контракты и ежедневки |
| `snakes_style_awarded_total{reason}`, `snakes_cosmetics_purchased_total{category}` | Начисленный «Стиль» по поводам и покупки косметики |
| `snakes_ws_closed_total{reason}`, `snakes_ws_handshake_rejected_total{reason}`, `snakes_ratelimit_triggered_total{kind}` | Разрывы, отказы по Origin, срабатывания rate-limit |
| `snakes_ws_connections_total`, `snakes_ws_active`, `snakes_ws_write_errors_total`, `snakes_ws_dropped_messages_total` | Транспорт |
| `snakes_build_info{version,commit}` | Какая версия сейчас крутится |

Сбор идёт из Prometheus в `samoy-monitoring`, а тот живёт в Docker и приходит с
адреса моста. Игровой порт закрыт на loopback намеренно, поэтому для сбора
поднимается отдельный слушатель на `METRICS_ADDR` — он отдаёт ровно `/metrics`,
и открытие адреса моста не открывает заодно `/ws` и статику мимо nginx.
Дополнительно юнит режет сеть на уровне ядра, см.
`deploy/systemd/snakes.service.d/10-metrics-scrape.conf`.

## Тесты

```bash
make test-all          # go test + node --check + клиентские тесты протокола
make test-race-docker  # -race в контейнере, gcc на хосте не нужен
make golden            # перегенерировать эталон протокола после его изменения
```

Красный прогон останавливает выкатку. Подробности и особенности Windows —
[docs/testing.md](docs/testing.md).

## Выкатка

Прод: systemd-юнит `snakes.service` за системным nginx, атомарные релизы с
автооткатом. Клиент и сервер едут **одним артефактом** — у них общий бинарный
протокол, и разъехавшиеся версии ломают разбор пакетов.

```bash
dk deploy snakes          # выкатить
dk rollback snakes --list # какие релизы лежат на сервере
```

Конфигурация nginx и сами скрипты — в
[deploy-kit](https://github.com/tr0llex/deploy-kit); в этом репозитории лежит
только описание цели `.deploy-kit/prod.env`.

Профили игроков — единственные данные, которых нет больше нигде. Их снимает
systemd-таймер: 48 часовых копий и 14 суточных, снимок с битым JSON отвергается.
