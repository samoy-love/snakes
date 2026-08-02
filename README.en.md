# Snakes

[Русский](README.md) · English

[![CI](https://github.com/tr0llex/snakes/actions/workflows/ci.yml/badge.svg)](https://github.com/tr0llex/snakes/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/tr0llex/snakes/branch/main/graph/badge.svg)](https://codecov.io/gh/tr0llex/snakes)
[![prod](https://img.shields.io/website?url=https%3A%2F%2Fsnakes.samoy.love&up_message=online&up_color=2ea043&down_message=offline&label=snakes.samoy.love)](https://snakes.samoy.love)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Multiplayer territory capture in the browser, for anyone who wants a five-minute
match without an account: **[snakes.samoy.love](https://snakes.samoy.love)**,
one tab, arrow keys or a swipe.

Leave your own land and a trail follows your head; close the loop, come home,
and everything inside the contour is yours. Let someone cross that trail and you
lose the whole estate at once. Death does not wipe the land immediately — it
**cools down** for fifteen seconds, and a reclaim during that window gives back
55% of the connected patch, so losing is a short chance to strike back rather
than a reset to zero.

| A match | The main menu |
|---|---|
| ![A match: rival territories, a trail, the capture effect](docs/img/match.svg) | ![The main menu](docs/img/menu.svg) |

## How it works

**A hand-rolled binary protocol, because the tick budget is 100 ms.** The field
is 200×140 cells and every client is served on every tick; JSON of that shape
would spend the budget on serialisation alone. Game state travels as binary
frames — ROI, events, minimap chunks — with 21 kinds of game event. The main
channel is ROI: a client receives only the window of the map around its own head
(80×56 cells by default, fitted to its viewport), in full or as a delta against
the tick it already acknowledged. The minimap ships as 10×10 chunks and
afterwards only the changed ones.

**Protocol drift is caught from both sides, because it used to break the game
silently.** The byte layout drifted between server and client three times over
the life of the project: the page still opened, the killfeed and the balance
just went quiet. Now the golden buffers are captured from the production Go
serialisers and committed as data, an independent JS decoder replays them field
by field, and `public/client.js` is additionally checked against the golden
statically — every event kind has a handler, read widths and offset sums add up.
A Go test fails if the golden lags behind the serialisers; the node tests fail if
the client lags behind the golden.

**A client with no build step, because the deploy is one artifact.** Vanilla JS
(ES modules) and Canvas 2D: the browser loads the files as they are — no npm
runtime, no bundler, no framework. The only third-party library, twemoji, is
vendored next to the code. Client and server share the binary protocol, so they
ship together and cache busting is a query version stamped at deploy time; see
[docs/http.md](docs/http.md).

**Identity without accounts, because a login form would cost more than it
protects.** No passwords and no email: the server issues an HMAC-SHA256 signed
token that the client presents when reconnecting. Progress — balance, cosmetics,
achievements — survives a reload and cannot be forged into someone else's
profile; see [docs/security.md](docs/security.md).

**Bots that read as opponents, because an empty room is a dead product.** Free
seats are filled with bots — 14 in an empty room, fewer as humans arrive, down
to four — and they run three difficulty tiers and four behaviour archetypes
(Farmer, Aggressor, Coward, Territorial), each with its own appetite for risk and
loop length. Hunting is bounded on purpose: at most three hunters per victim, and
a bot drives straight at its target for a few ticks before the strike, which is a
visible wind-up a human can still react to.

## Stack

**Client** — vanilla JS (ES modules) and Canvas 2D, no build step; interface in
Russian and English, 349 keys per dictionary.

**Server** — Go 1.25 with `github.com/coder/websocket` as the only external
dependency. No database: profiles live in a JSON file, match state in memory.
Metrics are exposed in the Prometheus text format by 30-odd counters of our own,
see [docs/metrics.md](docs/metrics.md).

**Production** — a `snakes.service` systemd unit behind the system nginx,
released through [deploy-kit](https://github.com/tr0llex/deploy-kit).

## Quick start

Requires Go 1.25+.

```bash
go run .
```

Open <http://localhost:3000>. Static files are served from `./public` **relative
to the working directory**, so run it from the repository root. `WS_ORIGINS` is
not needed locally — loopback origins are allowed separately
(`WS_ALLOW_LOCALHOST`) — and profiles land in `./data/profiles.json`.

Every setting, its default and its reason: [docs/config.md](docs/config.md); the
template to copy is `.env.example`.

## Layout

| Path | Purpose |
| --- | --- |
| `main.go` | Entry point: environment, routing (`/ws`, `/healthz`, `/readyz`, `/metrics`, static), middleware, graceful shutdown |
| `internal/game/` | The game core around `Room`: grid and capture (`grid.go`), matches and broadcast (`room.go`), bots (`bot_ai.go`), economy — pickups, contracts, dailies, achievements, cosmetics (`economy.go`), wire serialisation (`wire.go`), WebSocket commands (`ws.go`) |
| `internal/protocol/` | The binary protocol: field geometry, event codes, byte layout |
| `internal/httpx/` | Transport: origin allowlist, per-IP rate limits, client IP behind a proxy, headers and static caching |
| `internal/profiles/` | Profiles: HMAC identity tokens, atomic writes, TTL, autosave, caps |
| `internal/metrics/` | Counters and the Prometheus `/metrics` exposition |
| `internal/botnames/` | Bot nickname pools and unique-name picking |
| `internal/sanitize/` | One set of rules for names, chat, room titles and log fields |
| `internal/envcfg/` | Parsing settings out of the environment |
| `public/` | The client: rendering, input, UI, networking, effects, sound |
| `tests/` | Client-side protocol tests on Node plus the golden buffers |
| `tools/` | Offline visual harness; nothing here is ever served to a browser |
| `scripts/backup_profiles.sh` | The snapshot script: the only safety net for player progress |
| `deploy/systemd/` | Unit, drop-ins and the timer for hourly `profiles.json` snapshots |
| `.deploy-kit/` | Deployment target description |

More detail in [docs/](docs/): [protocol](docs/protocol.md),
[HTTP and caching](docs/http.md), [security](docs/security.md),
[configuration](docs/config.md), [metrics](docs/metrics.md),
[testing](docs/testing.md). The documents are written in Russian.

## Tests

187 Go tests (398 including subtests) and 242 client-side checks in `tests/`.
Coverage is 75.7% of statements overall and 81.5% in `internal/game`; the number
in the badge comes from Codecov, not from this file.

```bash
make test-all          # go test + node --check + client protocol tests
make test-race-docker  # -race in a container, no gcc needed on the host
make golden            # regenerate the protocol golden after changing it
```

CI gates gofmt, `go vet`, staticcheck, the build, `go test -race -short` plus a
full non-race run, `node --check` over the client, and the 58 protocol checks
that keep client and server in sync. A red run stops the deploy. Details,
including Windows quirks, are in [docs/testing.md](docs/testing.md).

## Deployment

```bash
dk deploy snakes          # deploy
dk rollback snakes --list # list releases on the server
```

Atomic releases with automatic rollback; client and server ship as **one
artifact**, because versions that drift apart break packet parsing. The nginx
configuration and the release scripts live in
[deploy-kit](https://github.com/tr0llex/deploy-kit); this repository only holds
the target description in `.deploy-kit/prod.env`.

Player profiles are the only data that exists nowhere else. A systemd timer
snapshots them: 48 hourly copies and 14 daily ones, and a snapshot with broken
JSON is rejected.

## Part of samoy.love

`samoy.love` reads as the owner's surname, Samoylov. One domain, one server, one
release pipeline, one status page.

| Service | What it is | Repository |
| --- | --- | --- |
| [samoy.love](https://samoy.love) | Personal page and project showcase | [tr0llex/samoy.love](https://github.com/tr0llex/samoy.love) |
| [snakes.samoy.love](https://snakes.samoy.love) | This game | [tr0llex/snakes](https://github.com/tr0llex/snakes) |
| [metro.samoy.love](https://metro.samoy.love) | Offline PWA with the Moscow Metro diagram | [tr0llex/metro-map](https://github.com/tr0llex/metro-map) |
| [launcher.samoy.love](https://launcher.samoy.love) | ChillHub, a game launcher for Windows | [tr0llex/chillhub](https://github.com/tr0llex/chillhub) |
| [status.samoy.love](https://status.samoy.love) | Uptime, versions, incidents | [tr0llex/status.samoy.love](https://github.com/tr0llex/status.samoy.love) |
| Monitoring | Prometheus, Grafana, traffic from nginx logs | [tr0llex/metrics.samoy.love](https://github.com/tr0llex/metrics.samoy.love) |

They all ship through one tool,
[deploy-kit](https://github.com/tr0llex/deploy-kit): one target description in
the repository, one `release.sh` on the server, one nginx configuration for
everything. Adding a service to the row costs a single `.deploy-kit/*.env` file.

## Contacts and license

Alexey Samoylov — <alex@samoy.love>, [t.me/tr0llex](https://t.me/tr0llex),
[github.com/tr0llex](https://github.com/tr0llex).

MIT, see [LICENSE](LICENSE). Bundled third-party assets keep their own terms:
[docs/notices.md](docs/notices.md).
