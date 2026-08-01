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

Четыре свойства, на которые стоит обратить внимание:

* **Обрыв ssh не срывает авто-откат.** Активация запускается не как обычная
  foreground-команда по ssh, а как transient systemd-юнит
  (`systemd-run --unit=snakes-deploy-<релиз> --wait --pipe`). Юнит — потомок PID 1,
  поэтому SIGHUP от умершего ssh до него не доходит и healthcheck с авто-откатом
  досчитывается до конца. `deploy.sh`, потеряв соединение, переподключается и
  забирает результат командой `remote_ctl.sh await <релиз>`.
* **Два деплоя одновременно невозможны.** `remote_ctl.sh` берёт `flock` на
  `/opt/snakes/.deploy.lock` до любых действий с симлинками, поэтому ручной запуск
  во время CI-деплоя просто встаёт в очередь (до `LOCK_WAIT` секунд).
* **Healthcheck ходит и через nginx.** Локальная проверка `127.0.0.1:8090`
  ничего не говорит про nginx/TLS/DNS: при сломанном vhost деплой рапортовал
  «OK» на лежащем сайте. Теперь после локальной проверки идёт публичная по
  `PUBLIC_HEALTH_URL`. Её провал — ошибка деплоя, но **без отката**: релиз тут ни
  при чём, чинить надо nginx.
* **`PROFILE_SECRET` проверяется ДО переключения симлинка.** Если `/etc/snakes/snakes.env`
  пропал или переменная пуста, сервер стартанул бы с эфемерным ключом и разом
  обесценил все токены игроков — это не лечится откатом. Проверяется только факт
  наличия непустого значения, само значение нигде не печатается.

Повторный `rollback.sh` **шагает вниз по списку релизов**, а не прыгает между
двумя последними: каждый отвергнутый релиз записывается в `/opt/snakes/rejected`
и больше никогда не становится целью отката.

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
| `PUBLIC_HEALTH_URL` | `https://snakes.samoy.love/healthz` | публичный healthcheck ЧЕРЕЗ nginx; пустая строка — пропустить |
| `PUBLIC_HEALTH_RETRIES` | `10` | попыток публичного healthcheck (пауза 3 с) |
| `DEPLOY_ENV_FILE` | `/etc/snakes/snakes.env` | env-файл юнита; проверяется на непустой `PROFILE_SECRET` до переключения симлинка |
| `LOCK_WAIT` | `600` | сколько секунд ждать чужой деплой на блокировке |
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
| `scripts/remote_ctl.sh` | серверная часть: блокировка, распаковка, симлинк, рестарт, healthcheck (локальный + публичный), авто-откат, чистка |
| `scripts/backup_profiles.sh` | бэкап `profiles.json` (ставится на сервер как `/usr/local/bin/snakes-backup-profiles.sh`) |
| `deploy/systemd/snakes-backup-profiles.{service,timer}` | часовой таймер этого бэкапа |
| `.github/workflows/deploy.yml` | деплой по тегу `v*` и по кнопке |


---

## Бэкапы профилей игроков

`/var/lib/snakes/profiles.json` — **единственная** копия балансов, статистики и
косметики всех игроков. Деплой её не трогает, но испорченная запись, неудачный
`rm` или потеря диска забирают всё сразу.

Снапшоты снимает systemd-таймер `snakes-backup-profiles.timer` (раз в час,
`Persistent=true`, разброс до 2 минут):

```
/var/lib/snakes/backups/hourly/profiles-<YYYYmmdd-HH>.json   последние 48
/var/lib/snakes/backups/daily/profiles-<YYYYmmdd>.json       последние 14
```

Права не слабее исходных: каталоги `0700`, файлы `0600`, владелец `www-data`.
Файл, который не парсится как JSON, снапшотом не становится — недописанный
исходник не может вытеснить хорошие бэкапы.

Установка (идемпотентна):

```bash
sudo install -m 0755 scripts/backup_profiles.sh /usr/local/bin/snakes-backup-profiles.sh
sudo install -m 0644 deploy/systemd/snakes-backup-profiles.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/snakes-backup-profiles.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now snakes-backup-profiles.timer
```

Проверка и восстановление:

```bash
sudo /usr/local/bin/snakes-backup-profiles.sh            # снять снапшот прямо сейчас
sudo /usr/local/bin/snakes-backup-profiles.sh --list     # что лежит
sudo systemctl list-timers snakes-backup-profiles.timer

# Восстановление: останавливает snakes, кладёт снапшот на место, стартует обратно.
# Текущий файл при этом сохраняется как backups/pre-restore-<таймштамп>.json.
sudo /usr/local/bin/snakes-backup-profiles.sh --restore   /var/lib/snakes/backups/daily/profiles-20260801.json
```

Восстановление проверено вживую: снапшот → `--restore` → sha256 совпал,
`systemctl is-active snakes` = `active`, `https://snakes.samoy.love/healthz` = 200.
