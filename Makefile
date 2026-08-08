# Snakes — сборка и повседневные команды.
#
# Среда разработки — Windows + Git Bash, CI — Linux, поэтому цели написаны
# переносимо: без bashism-ов, без find/xargs, без `rm -rf` по путям с пробелами.
#
# ВНИМАНИЕ (Windows). Нужен именно нативный GNU make — `choco install make`,
# он ставится в C:\ProgramData\chocolatey\bin\make.exe. Проверено: с ним
# работают все цели.
# НЕ подходит make из чужой msys2-среды (например C:\devkitPro\msys2\usr\bin\make.exe,
# который часто оказывается раньше в PATH). Он перезапускает msys2-runtime и
# приходит в рецепты с вычищенным окружением: USERPROFILE/TMP/TEMP/OS пустые,
# HOME подменён на /home/<user>. Симптомы:
#   go: module cache not found: neither GOMODCACHE nor GOPATH is set
#   go: creating work dir: mkdir C:\WINDOWS\go-build...: Access is denied
# Плюс `ifeq ($(OS),Windows_NT)` ниже не срабатывает и бинарь собирается без .exe.
# Починить это из Makefile нельзя (переменных нет и в самом процессе make),
# лечится только правильным make: `command -v make` должен указывать на choco.

SHELL := /bin/sh

BINARY   := snakes
ifeq ($(OS),Windows_NT)
BINARY   := snakes.exe
endif

PKG      := ./...
IMAGE    := snakes
TAG      := local

VERSION    ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
COMMIT     ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)
BUILD_TIME ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)

LDFLAGS := -s -w -X main.Version=$(VERSION) -X main.Commit=$(COMMIT) -X main.BuildTime=$(BUILD_TIME)

GO_IMAGE := golang:1.25

# Клиентские тесты: чистый Node без зависимостей (node:test + node:assert).
# 22.x нужен и для `node --check` (сам определяет ES-модуль по синтаксису),
# и для стабильного `node --test` со списком файлов.
NODE       ?= node
# Списки собираются шаблоном, а не перечислением: перечисление уже разъезжалось
# с каталогом — client_i18n/color/cos_draw/util не проверялись `node --check`
# вовсе, а из тестов гонялись два файла из одиннадцати.
CLIENT_JS    := $(wildcard public/client*.js)
CLIENT_TESTS := $(wildcard tests/*.test.mjs)

.PHONY: help run run-visual build test test-race test-race-docker test-client test-all vet fmt fmt-check \
        golden node-check test-visual test-visual-update clean

help:
	@echo "Доступные цели:"
	@echo "  run          — go run . (http://localhost:3000)"
	@echo "  build        — сборка бинаря $(BINARY)"
	@echo "  test         — go test ./..."
	@echo "  test-race    — go test ./... -race (нужен CGO и gcc в PATH)"
	@echo "  test-race-docker — то же в контейнере $(GO_IMAGE) (gcc не нужен)"
	@echo "  node-check   — node --check по всем public/client*.js"
	@echo "  test-client  — клиентские тесты протокола (node --test, без зависимостей)"
	@echo "  test-all     — go test + node-check + test-client"
	@echo "  golden       — перегенерировать tests/golden/protocol_golden.json"
	@echo "  test-visual  — визуальные тесты экранов (Playwright, tests/visual)"
	@echo "  test-visual-update — перезаписать эталонные скриншоты"
	@echo "  vet          — go vet ./..."
	@echo "  fmt          — gofmt -w ."
	@echo "  fmt-check    — падает, если есть неотформатированные файлы"
	@echo "  clean        — удалить бинарь и dist/"

# Сервер читает ТОЛЬКО окружение (см. docs/config.md), поэтому .env подхватываем
# здесь: голый `go run .` уходит в прод-дефолт WS_ORIGINS, и локальный клиент
# получает 403 на /ws — кнопка «Играть» молча не работает.
run:
	@if [ -f .env ]; then \
		set -a; . ./.env; set +a; go run .; \
	else \
		go run .; \
	fi

build:
	go build -trimpath -ldflags "$(LDFLAGS)" -o $(BINARY) .

test:
	go test $(PKG)

# Нужен C-компилятор. На типичной Windows-машине gcc нет — тогда
# используйте test-race-docker, он даёт тот же результат, что и CI.
test-race:
	CGO_ENABLED=1 go test $(PKG) -race

# Гонки прогоняются в linux-контейнере: это ровно то окружение, в котором
# гоняет CI, и gcc на хосте не требуется.
#
# MSYS_NO_PATHCONV/MSYS2_ARG_CONV_EXCL обязательны в Git Bash: без них msys
# переписывает аргумент `-w /src` в `C:/Program Files/Git/src`, и docker падает
# с "the working directory ... is invalid". На Linux/macOS переменные просто
# игнорируются.
test-race-docker:
	MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' \
	docker run --rm -v "$(CURDIR):/src" -w /src $(GO_IMAGE) \
		go test $(PKG) -race -count=1

# Клиент разбирает бинарный протокол по точным смещениям байтов, и рассинхрон
# кодера с декодером трижды ломал игру молча. Эти тесты гоняют эталонные буферы
# (снятые с Go-сериализаторов) через независимый декодер и статически сверяют
# фактический public/client.js с эталоном. Внешних зависимостей нет.
test-client:
	$(NODE) --test $(CLIENT_TESTS)

# Сервер для визуальных тестов. .env здесь НЕ читается сознательно: скриншот,
# зависящий от локальных настроек разработчика, эталоном быть не может — у
# одного ROOM_LIMIT=16, у другого 4, и «регрессия» окажется чужим .env.
# Профили пишутся в одноразовый каталог: иначе накопленные монеты и купленная
# косметика меняют магазин от прогона к прогону.
# Порт отдельный (8099), а не 3000/8080 из .env: визуальный прогон не должен
# падать оттого, что рядом уже поднят сервер для ручной проверки.
# MATCH_DURATION_TICKS короткий (900 тиков = 90 c) — тесты доводят матч до
# конца по-настоящему (см. tests/visual/screens.spec.mjs), а не подделывают
# оверлей итогов мимо client.js; 5 минут дефолта сделали бы прогон нежизнеспособным.
# Комната тикает от старта процесса, а не от первого join, поэтому игровой
# тест в спеке идёт первым — ему нужен весь этот бюджет на смерть и итоги.
# Параметризован портом и путём профилей: playwright.config.mjs поднимает
# ТРИ таких сервера (по одному на вьюпорт) на разных портах, чтобы тесты
# вьюпортов гонялись параллельно, а не по очереди на одном общем матче —
# иначе прогон трёх вьюпортов последовательно занимал ~6 минут вместо ~2.
VISUAL_PORT ?= 8099
VISUAL_PROFILES_PATH ?= tests/visual/.tmp/profiles.json

run-visual:
	PORT=$(VISUAL_PORT) \
	BIND_ADDR=127.0.0.1 \
	ROOM_LIMIT=16 \
	MATCH_DURATION_TICKS=900 \
	MATCH_INTERMISSION_TICKS=150 \
	WS_ORIGINS=http://localhost:$(VISUAL_PORT),http://127.0.0.1:$(VISUAL_PORT) \
	WS_ALLOW_LOCALHOST=0 \
	PROFILE_SECRET=visual-tests-fixed-key \
	PROFILES_PATH=$(VISUAL_PROFILES_PATH) \
	go run .

# Скриншоты экранов сверяются с эталонами из tests/visual/*.spec.mjs-snapshots.
# Сервер поднимает сам Playwright (см. webServer в playwright.config.mjs).
test-visual:
	cd tests/visual && npm install --no-audit --no-fund && npx playwright test

# Только после ОСОЗНАННОЙ правки дизайна: перезаписывает эталоны.
# Diff обязателен к просмотру глазами — иначе регрессия въезжает в эталон.
test-visual-update:
	cd tests/visual && npm install --no-audit --no-fund && npx playwright test --update-snapshots

node-check:
	@status=0; \
	for f in $(CLIENT_JS); do \
		[ -e "$$f" ] || continue; \
		echo "check $$f"; \
		$(NODE) --check "$$f" || status=1; \
	done; \
	exit $$status

# Полный локальный аналог CI (кроме -race: для него есть test-race-docker).
test-all: test node-check test-client

# Перегенерация эталона после ОСОЗНАННОГО изменения протокола. После неё
# обязательно прогнать test-client: клиент придётся править синхронно.
golden:
	UPDATE_GOLDEN=1 go test -run TestProtocolGoldenExport ./internal/game
	@echo "эталон обновлён; проверьте клиент: make test-client"

vet:
	go vet $(PKG)

fmt:
	gofmt -w .

fmt-check:
	@out=`gofmt -l .`; \
	if [ -n "$$out" ]; then \
		echo "Неотформатированные файлы (запустите make fmt):"; \
		echo "$$out"; \
		exit 1; \
	fi


clean:
	go clean
	rm -f snakes snakes.exe
	rm -rf dist
