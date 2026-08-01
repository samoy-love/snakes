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

GO_IMAGE := golang:1.22

# Клиентские тесты: чистый Node без зависимостей (node:test + node:assert).
# 22.x нужен и для `node --check` (сам определяет ES-модуль по синтаксису),
# и для стабильного `node --test` со списком файлов.
NODE       ?= node
CLIENT_JS  := public/client.js public/client_audio.js public/client_errors.js \
              public/client_fx.js public/client_net.js
CLIENT_TESTS := tests/protocol_golden.test.mjs tests/client_contract.test.mjs

.PHONY: help run build test test-race test-race-docker test-client test-all vet fmt fmt-check \
        golden node-check docker-build docker-up docker-down docker-logs clean

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
	@echo "  vet          — go vet ./..."
	@echo "  fmt          — gofmt -w ."
	@echo "  fmt-check    — падает, если есть неотформатированные файлы"
	@echo "  docker-build — docker build -t $(IMAGE):$(TAG) ."
	@echo "  docker-up    — docker compose up -d --build"
	@echo "  docker-down  — docker compose down"
	@echo "  docker-logs  — docker compose logs -f"
	@echo "  clean        — удалить бинарь и dist/"

run:
	go run .

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
	UPDATE_GOLDEN=1 go test -run TestProtocolGoldenExport .
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

docker-build:
	docker build \
		--build-arg VERSION=$(VERSION) \
		--build-arg COMMIT=$(COMMIT) \
		--build-arg BUILD_TIME=$(BUILD_TIME) \
		-t $(IMAGE):$(TAG) .

docker-up:
	docker compose up -d --build

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f --tail=100

clean:
	go clean
	rm -f snakes snakes.exe
	rm -rf dist
