# Метрики

`/metrics` отдаёт text exposition format Prometheus. Реализация своя
(`internal/metrics`), без `prometheus/client_golang`: формат — имя, метки,
число, перевод строки, а библиотека тянет за собой protobuf и expfmt ради трёх
десятков счётчиков.

Считается не только транспорт, но и то, как в игру играют.

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
| `snakes_profiles_read_only`, `snakes_profiles_save_errors_total` | Хранилище профилей: 1 в гейдже = сохранение запрещено после неудачной загрузки, прогресс игроков не переживёт рестарт |
| `snakes_ws_closed_total{reason}`, `snakes_ws_handshake_rejected_total{reason}`, `snakes_ratelimit_triggered_total{kind}` | Разрывы, отказы по Origin, срабатывания rate-limit |
| `snakes_ws_connections_total`, `snakes_ws_active`, `snakes_ws_write_errors_total`, `snakes_ws_dropped_messages_total` | Транспорт |
| `snakes_build_info{version,commit}` | Какая версия сейчас крутится |

Люди и боты разведены по разным счётчикам намеренно: без этого любая метрика
активности показывает заполнение комнаты ботами и перестаёт отвечать на вопрос,
играет ли кто-то живой.

## Отдельный слушатель

Сбор идёт из Prometheus в
[metrics.samoy.love](https://github.com/samoy-love/metrics.samoy.love), а тот живёт
в Docker и приходит с адреса моста. Игровой порт закрыт на loopback намеренно,
поэтому для сбора поднимается отдельный слушатель на `METRICS_ADDR`: он отдаёт
ровно `/metrics`, и открытие адреса моста не открывает заодно `/ws` и статику
мимо nginx.

Дополнительно юнит режет сеть на уровне ядра, см.
`deploy/systemd/snakes.service.d/10-metrics-scrape.conf`.

Когда `METRICS_ADDR` задан, `/metrics` регистрируется **только** на этом
слушателе: на игровом мультиплексоре — том самом, который проксирует nginx, —
эндпоинта нет вообще. Пусто (локальный запуск) — эндпоинт остаётся на игровом
порту, а тот по умолчанию слушает loopback.

`snakes_profiles_read_only` — метрика, ради которой стоит завести алерт: она
залипает в 1 до вмешательства оператора, а всё, что игроки заработают за это
время, теряется на ближайшем рестарте. Тот же признак виден снаружи как 503 на
`/readyz`.
