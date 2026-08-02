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

## Выкатка

Механика — в общем пайплайне [deploy-kit](https://github.com/tr0llex/deploy-kit).
Что именно катится, описано в [`.deploy-kit/prod.env`](../.deploy-kit/prod.env).

```bash
# из GitHub Actions: тег v* либо Actions -> Deploy -> Run workflow
# локально тем же контрактом:
deploy-kit/bin/deploy --config .deploy-kit/prod.env
deploy-kit/bin/deploy --config .deploy-kit/prod.env --dry-run
```

Клиент и сервер едут **одним артефактом**: у них общий бинарный протокол, и
разъехавшиеся версии ломают разбор пакетов молча — страница откроется, а игра
развалится.

Перед выкаткой обязателен полный регресс с `-race`: комнаты, профили, лимитеры,
ИИ ботов и экономика работают в разных горутинах, и гонка там не роняет процесс
громко, а тихо портит балансы игроков.

Автодеплой по мержу сознательно не заведён: перезапуск прерывает идущие матчи,
состояние комнат живёт в памяти.

## Как откатиться

Релизы лежат на сервере, пересборка не нужна:

```bash
ssh ubuntu@<host> 'sudo /opt/deploy-kit/rollback.sh --app snakes --root /opt/snakes --list'
ssh ubuntu@<host> 'sudo /opt/deploy-kit/rollback.sh --app snakes --root /opt/snakes     --unit snakes.service --health https://snakes.samoy.love/healthz'
```

При провале healthcheck выкатка откатывается сама — это проверено на живом
сервере: релиз без бита запуска не поднялся, и прод вернулся на предыдущий.

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
   `/opt/deploy-kit/rollback.sh` (см. раздел «Как откатиться»), затем `journalctl -u snakes -n 100`.
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
