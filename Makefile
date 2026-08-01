# Snakes — сборка и повседневные команды.
#
# Среда разработки — Windows + Git Bash, CI — Linux, поэтому цели написаны
# переносимо: без bashism-ов, без find/xargs, без `rm -rf` по путям с пробелами.
# На Windows make берётся из Git for Windows / choco install make.

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

.PHONY: help run build test test-race vet fmt fmt-check docker-build docker-up docker-down clean

help:
	@echo "Доступные цели:"
	@echo "  run          — go run . (http://localhost:3000)"
	@echo "  build        — сборка бинаря $(BINARY)"
	@echo "  test         — go test ./..."
	@echo "  test-race    — go test ./... -race (нужен CGO и C-компилятор)"
	@echo "  vet          — go vet ./..."
	@echo "  fmt          — gofmt -w ."
	@echo "  fmt-check    — падает, если есть неотформатированные файлы"
	@echo "  docker-build — docker build -t $(IMAGE):$(TAG) ."
	@echo "  docker-up    — docker compose up -d --build"
	@echo "  docker-down  — docker compose down"
	@echo "  clean        — удалить бинарь и dist/"

run:
	go run .

build:
	go build -trimpath -ldflags "$(LDFLAGS)" -o $(BINARY) .

test:
	go test $(PKG)

test-race:
	CGO_ENABLED=1 go test $(PKG) -race

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

clean:
	go clean
	rm -f snakes snakes.exe
	rm -rf dist
