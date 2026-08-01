# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1: build
# ---------------------------------------------------------------------------
FROM golang:1.22-alpine AS builder

WORKDIR /src

# Зависимости кэшируются отдельным слоем: пока go.mod/go.sum не меняются,
# `go mod download` не перезапускается.
COPY go.mod go.sum ./
RUN go mod download

# Исходники.
COPY . .

ARG VERSION=dev
ARG COMMIT=unknown
ARG BUILD_TIME=unknown

# -s -w выкидывают таблицу символов и DWARF (образ меньше).
# -X проставляет main.Version/main.Commit/main.BuildTime, если такие переменные
# в пакете main существуют. Сейчас их в коде НЕТ; фактическая сборка показала,
# что линкер молча игнорирует -X для несуществующего символа и не падает.
# ARG-и объявлены ДО этого шага, иначе их изменение не инвалидирует кэш слоя.
RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags "-s -w -X main.Version=${VERSION} -X main.Commit=${COMMIT} -X main.BuildTime=${BUILD_TIME}" \
    -o /out/snakes .

# ---------------------------------------------------------------------------
# Stage 2: runtime
# ---------------------------------------------------------------------------
FROM alpine:3.20

# ca-certificates — на будущее (исходящих HTTPS-запросов сейчас нет).
# wget для HEALTHCHECK ставить не нужно: он есть в busybox.
RUN apk add --no-cache ca-certificates \
    && addgroup -g 10001 -S snakes \
    && adduser -u 10001 -S -G snakes -h /app snakes

WORKDIR /app

COPY --from=builder /out/snakes /app/snakes
# Сервер раздаёт статику из ./public относительно рабочей директории
# (см. mustCwd() в server.go), поэтому public/ обязателен в образе.
COPY --chown=10001:10001 public /app/public

# Каталог профилей игроков (PROFILES_PATH по умолчанию ./data/profiles.json).
RUN mkdir -p /app/data && chown -R 10001:10001 /app/data

USER 10001:10001

ENV PORT=3000 \
    PROFILES_PATH=/app/data/profiles.json

EXPOSE 3000

# VOLUME здесь НЕ объявляем намеренно: каждый `docker run` без -v плодил бы
# анонимный том с профилями, который потом никто не находит. Постоянное
# хранилище задаётся явно — именованным томом snakes_data в docker-compose.yml.

# /healthz есть в server.go и отдаёт 200. wget берётся из busybox alpine.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:${PORT}/healthz || exit 1

ENTRYPOINT ["/app/snakes"]
