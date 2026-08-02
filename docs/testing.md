# Тесты

Прогон целиком, особенности Windows и клиентские тесты протокола.

## Тесты

```sh
gofmt -l .                 # должно быть пусто
go vet ./...
go build ./...
go test ./...
go test ./... -race        # нужен CGO и C-компилятор (на Windows — MinGW/TDM-GCC)
```

Через Makefile (проверено в Git Bash на Windows с GNU make из chocolatey):

```sh
make fmt-check     # падает, если есть неотформатированные файлы
make vet
make build         # на Windows кладёт snakes.exe
make test
make test-race-docker   # -race в контейнере golang:1.22, gcc на хосте не нужен
make node-check         # node --check по всем public/client*.js
make test-client        # клиентские тесты бинарного протокола (Node 22+)
make test-all           # go test + node-check + test-client
make golden             # перегенерировать эталон протокола после его изменения
make docker-build
make docker-up / make docker-down / make docker-logs
make clean
```

`make test-race` требует CGO и `gcc` в `PATH`. На типичной Windows-машине его
нет — используйте `make test-race-docker`, он даёт ровно то же окружение, что и
CI. Последний прогон `-race` (Linux, `golang:1.22`) прошёл чисто: `ok snakes 1.806s`.

Внимание, Windows: нужен именно GNU make из chocolatey
(`C:\ProgramData\chocolatey\bin\make.exe`). Make из чужой msys2-среды (например
`C:\devkitPro\msys2\usr\bin\make.exe`) приходит в рецепты с вычищенным
окружением и ломает `go build`; подробности — в шапке `Makefile`.

### Клиентские тесты протокола

`node --check` проверяет только синтаксис. При этом клиент разбирает бинарный
протокол по точным смещениям байтов, и рассинхрон кодера с декодером **трижды
за проект ломал игру молча**: пропадали киллфид, тосты, обновления заданий,
баланс валюты показывал мусор. Серверная сторона закрыта побайтовыми тестами в
`protocol_test.go`, клиентская — тестами в `tests/`:

```sh
make test-client          # или: node --test tests/*.test.mjs (нужен Node 22+)
```

Зависимостей нет — только `node:test` и `node:assert`.

| Файл | Что проверяет |
| --- | --- |
| `tests/golden/protocol_golden.json` | Эталонные буферы (base64) на все 21 типов событий, заголовок пакета со списком powerup, неизвестный тип, ROI-снапшот (fast и scan) и чанки миникарты (дельта и full). Генерируется из боевых Go-сериализаторов, лежит в репозитории **как данные** — для запуска тестов Go не нужен |
| `tests/protocol_golden.test.mjs` | Независимый декодер (смещения выписаны заново) прогоняет эталонные буферы и сверяет каждое поле. Значения полей-образцов различны (`A=0x1122`, `B=0x3344`, `X=0x5566`, `Y=0x7788`, `C=0x99AABBCC`, `D=0xDD`), поэтому перепутанный порядок или подменённая ширина обязательно дадут другое значение |
| `tests/client_contract.test.mjs` | Статическая сверка фактического `public/client.js` с эталоном: у каждого типа события есть обработчик, `need(...)` равен длине payload, последовательность ширин чтений (`getUint8/16/32`) совпадает с серверной раскладкой, сумма `o += N` сходится. Плюс `perPlayerV4` для ROI, формула размера чанка миникарты и фолбэк на неизвестный `kind` |

Двусторонняя защита: `TestProtocolGoldenExport` (Go) падает, если эталон отстал
от сериализаторов, а node-тесты падают, если от эталона отстал клиент. Между
ними рассинхрон не проходит незамеченным. После **осознанного** изменения
протокола:

```sh
make golden        # UPDATE_GOLDEN=1 go test -run TestProtocolGoldenExport .
make test-client   # и синхронно править public/client.js, пока не позеленеет
```

Тесты проверены на живых регрессиях — каждая из трёх исторических поломок
ловится:

| Внесённая поломка | Что падает |
| --- | --- |
| `kind=12` читает 11 байт вместо 3 | `client.js: kind=12 (EventContractComplete) читает 3 байт…` |
| у `kind=13` (Style) нет обработчика | «каждый тип события сервера имеет обработчик», «нет обработчиков несуществующих типов», проверка `kind=13` |
| два `u16` заменены на один `u32` (сумма та же) | проверка `kind=14` — не сходится последовательность ширин |

Синтаксис клиентских скриптов проверяется отдельно: `node --check public/client.js`
и `node --check public/client_*.js` (`make node-check`, нужен Node 22+ — он сам
определяет ES-модуль по синтаксису).

CI: `.github/workflows/ci.yml` — три job'а: **go** (gofmt / vet / build /
`test -race`), **js** (`node --check` по `public/client*.js` + клиентские тесты
протокола `node --test`) и **docker** (сборка образа, `docker run`, проверка
`/healthz`, `/readyz`, `/`, `/client.js`, `/style.css`, `/metrics`, заголовки
кэширования статики, рукопожатие `/ws` и отказ чужому origin'у, ожидание статуса
`healthy` у HEALTHCHECK и проба записи в каталог профилей от непривилегированного
пользователя).
`.github/workflows/docker.yml` — сборка и публикация образа в GHCR по push в
`master`/`main` и по тегам `v*`.

---
