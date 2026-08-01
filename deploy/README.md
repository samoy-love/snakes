# Деплой Snakes на боевой сервер

## ⚠️ Главное предупреждение

На сервере живут **несколько чужих проектов**. В `/etc/nginx/sites-enabled/` три сайта:

| Файл | Проект | Можно трогать? |
|---|---|---|
| `snakes.conf` | наш | да |
| `metro.conf` | чужой | **НЕТ** |
| `chillhub-launcher.conf` | чужой | **НЕТ** |

Правила:

* Любое изменение nginx — только так: **бэкап → `sudo nginx -t` → и лишь при успехе `sudo systemctl reload nginx`** (именно `reload`, не `restart`).
* Сразу после reload проверить, что соседи живы:
  ```bash
  for h in metro.samoy.love launcher.samoy.love; do curl -s -o /dev/null -w "$h %{http_code}\n" https://$h/; done
  ```
* Штатный деплой приложения nginx **не трогает вообще** — скрипты работают только с `/opt/snakes` и юнитом `snakes`.

---

## Архитектура деплоя

```
/opt/snakes/
├── current   -> releases/<timestamp>-<sha>   симлинк на активный релиз
├── previous  -> releases/<timestamp>-<sha>   симлинк на предыдущий (для отката)
└── releases/
    ├── 20260801-172220-ebdfcc3/{snakes, public/}
    └── ...                                    хранятся последние KEEP_RELEASES (5)

/etc/systemd/system/snakes.service   юнит (User=www-data, WorkingDirectory=/opt/snakes/current)
/etc/snakes/snakes.env               переменные окружения (root:root 0600) — СЕКРЕТЫ ЗДЕСЬ
/var/lib/snakes/profiles.json        профили игроков (ПЕРЕЖИВАЕТ деплой)
/etc/nginx/sites-available/snakes.conf   TLS-терминация и проксирование на 127.0.0.1:8090
```

Ключевые факты о проде:

* Хост Oracle Ampere → **aarch64**. Собирать надо `GOARCH=arm64` (это дефолт в скриптах;
  для x86-сервера задайте `DEPLOY_GOARCH=amd64`).
* Приложение слушает **:8090** (порт 3000 занят docker-proxy другого проекта).
  Снаружи 8090 закрыт, доступ только через nginx.
* systemd-юнит ограничен `IPAddressAllow=localhost` + `ProtectSystem=strict`,
  запись разрешена только в `/var/lib/snakes`.
* Логи — в journald, отдельного файла лога нет, logrotate не нужен.

Деплой выполняется атомарно: новый релиз распаковывается рядом, затем симлинк `current`
переключается через `ln -sfn` + `mv -Tf` (atomic rename), сервис рестартует, и только
после успешного healthcheck релиз считается принятым. Если healthcheck не прошёл —
симлинк автоматически возвращается на прошлый релиз, сервис перезапускается,
скрипт завершается ненулевым кодом.

---

## Как задеплоить вручную

Из Git Bash на Windows (транспорт plink/pscp определяется автоматически по `.ppk`):

```bash
export DEPLOY_KEY="/c/Users/<вы>/Desktop/server access/oracle 2025-09-21.ppk"
export DEPLOY_REF=HEAD          # собрать чистый экспорт HEAD, а не рабочую копию
./scripts/deploy.sh
```

Из Linux/CI (транспорт ssh/scp):

```bash
export DEPLOY_HOST=207.127.93.34 DEPLOY_USER=ubuntu DEPLOY_KEY=~/.ssh/deploy_key
./scripts/deploy.sh
```

Скрипт сам: прогоняет `go build ./...` и `go test ./...` (пропустить — `SKIP_TESTS=1`),
кросс-собирает статический бинарь, упаковывает его с `public/`, заливает, активирует
и проверяет `/healthz`.

### Переменные окружения

| Переменная | Дефолт | Назначение |
|---|---|---|
| `DEPLOY_HOST` | `207.127.93.34` | хост |
| `DEPLOY_USER` | `ubuntu` | пользователь SSH (нужен passwordless sudo) |
| `DEPLOY_KEY` | пусто | путь к приватному ключу (`.ppk` → plink, иначе ssh) |
| `DEPLOY_PORT` | `22` | порт SSH |
| `DEPLOY_PATH` | `/opt/snakes` | корень релизов |
| `DEPLOY_SERVICE` | `snakes` | имя systemd-юнита |
| `DEPLOY_RUN_USER` | `www-data` | от кого работает сервис |
| `HEALTH_PORT` / `HEALTH_PATH` | `8090` / `/healthz` | локальный healthcheck |
| `HEALTH_RETRIES` / `HEALTH_DELAY` | `30` / `2` | до 60 секунд ожидания |
| `KEEP_RELEASES` | `5` | сколько релизов хранить |
| `DEPLOY_GOOS` / `DEPLOY_GOARCH` | `linux` / `arm64` | цель кросс-сборки |
| `DEPLOY_TRANSPORT` | `auto` | `auto` \| `ssh` \| `putty` |
| `DEPLOY_REF` | пусто | git-ref для чистой сборки вместо рабочей копии |
| `SKIP_TESTS` | `0` | `1` — не запускать `go test` |

Секретов в репозитории нет: ключ передаётся путём, а `PROFILE_SECRET` живёт
только в `/etc/snakes/snakes.env` на сервере.

---

## Как откатиться

```bash
./scripts/rollback.sh            # current <-> previous, рестарт, healthcheck
./scripts/rollback.sh --status   # что задеплоено сейчас, какие релизы есть
```

Откат делает то же самое атомарное переключение симлинка и падает с ненулевым кодом,
если целевой релиз не поднялся. Откатиться можно и вручную:

```bash
sudo ln -sfn /opt/snakes/releases/<нужный> /opt/snakes/current.tmp
sudo mv -Tf /opt/snakes/current.tmp /opt/snakes/current
sudo systemctl restart snakes
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8090/healthz
```

---

## Логи и диагностика

```bash
sudo journalctl -u snakes -f              # хвост в реальном времени
sudo journalctl -u snakes -n 200 --no-pager
sudo journalctl -u snakes --since '1 hour ago' | grep -i error
systemctl status snakes
journalctl --disk-usage                   # journald общий на всех, следите за размером
```

Полезные строки в логе:

* `profiles_loaded path=... count=N` — профили подхватились при старте;
* `PROFILE_SECRET is not set: ... progress will NOT survive a restart` — **авария**,
  см. ниже;
* `cosmetics_txn ...` — покупки в магазине.

Проверки снаружи:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://snakes.samoy.love/healthz     # 200
curl -s -o /dev/null -w '%{http_code}\n' https://snakes.samoy.love/metrics     # 403 (закрыт)
# WebSocket: обязательно --http1.1, иначе curl уйдёт в HTTP/2 и вернёт 426
curl -s -i --http1.1 -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  -H 'Origin: https://snakes.samoy.love' https://snakes.samoy.love/ws | head -1   # 101
```

---

## Конфиги и данные

| Что | Где |
|---|---|
| Переменные окружения / секреты | `/etc/snakes/snakes.env` (root:root 0600) |
| Профили игроков | `/var/lib/snakes/profiles.json` (www-data, 0600) |
| systemd-юнит | `/etc/systemd/system/snakes.service` |
| nginx нашего сайта | `/etc/nginx/sites-available/snakes.conf` |
| TLS Let's Encrypt | `/etc/letsencrypt/live/snakes.samoy.love/` |

Обязательные значения в `snakes.env`:

* `PORT=8090`
* `PROFILE_SECRET=<32 байта hex>` — **если пусто, прогресс всех игроков обнулится при
  каждом рестарте** (сервер сгенерирует эфемерный секрет и все токены станут невалидными).
* `PROFILES_PATH=/var/lib/snakes/profiles.json` — **должен быть ВНЕ `/opt/snakes/releases/...`**,
  иначе прогресс сотрётся при следующем деплое.
* `WS_ORIGINS=https://snakes.samoy.love,http://snakes.samoy.love`
* `TRUSTED_PROXIES=127.0.0.1/8,::1`

После правки `snakes.env`: `sudo systemctl restart snakes` (nginx трогать не надо).

---

## Что делать при инциденте

1. **Сайт лёг сразу после деплоя.** Скрипт откатывается сам. Если нет —
   `./scripts/rollback.sh`, затем `journalctl -u snakes -n 100`.
2. **Сервис не стартует.** `systemctl status snakes` + `journalctl -u snakes -n 100`.
   Частые причины: битый `snakes.env`, занятый порт 8090, бинарь не той архитектуры
   (`file /opt/snakes/current/snakes` должен показывать `ARM aarch64`).
3. **502 от nginx.** Приложение не слушает 8090: `ss -lntp | grep 8090`,
   `curl -sI http://127.0.0.1:8090/healthz`. nginx при этом трогать не нужно.
4. **У всех игроков пропал прогресс.** Проверить `PROFILE_SECRET` и `PROFILES_PATH`
   в `/etc/snakes/snakes.env` и наличие `/var/lib/snakes/profiles.json`.
   Файл пишется атомарно (temp + rename), раз в 30 секунд и при остановке.
5. **Упал соседний сайт.** Значит кто-то менял nginx. Откатить конфиг из бэкапа
   (`/etc/nginx/sites-available/*.bak-*`), `sudo nginx -t`, `sudo systemctl reload nginx`.
6. **Кончилось место.** Смотреть `journalctl --disk-usage` (журнал общий для всех
   проектов) и `du -sh /opt/snakes/releases/*`. Старые релизы чистит сам деплой
   (`KEEP_RELEASES`), вручную — `sudo journalctl --vacuum-time=14d`
   (осторожно: затрагивает логи чужих сервисов тоже).

---

## Файлы деплоя в репозитории

| Файл | Назначение |
|---|---|
| `scripts/deploy.sh` | сборка + доставка + активация + healthcheck + авто-откат |
| `scripts/rollback.sh` | откат на предыдущий релиз одной командой |
| `scripts/lib_deploy.sh` | конфигурация и выбор транспорта (ssh/scp либо plink/pscp) |
| `scripts/remote_ctl.sh` | серверная часть: распаковка, симлинк, рестарт, healthcheck, чистка |
| `.github/workflows/deploy.yml` | деплой по тегу `v*` и по кнопке |
