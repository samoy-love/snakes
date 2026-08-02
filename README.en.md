# Snakes

[Русский](README.md) · English

[![CI](https://github.com/tr0llex/snakes/actions/workflows/ci.yml/badge.svg)](https://github.com/tr0llex/snakes/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/tr0llex/snakes/branch/main/graph/badge.svg)](https://codecov.io/gh/tr0llex/snakes)
[![prod](https://img.shields.io/website?url=https%3A%2F%2Fsnakes.samoy.love&up_message=online&up_color=2ea043&down_message=offline&label=snakes.samoy.love)](https://snakes.samoy.love)

Multiplayer territory capture in the browser. Leave your own land and a trail
follows your head; close the loop, come home, and everything inside the contour
becomes yours. Let someone cross that trail and you lose the whole estate.

Play: **[snakes.samoy.love](https://snakes.samoy.love)** — no sign-up, one tab,
arrow keys or swipe.

## How the game works

The field is 200×140 cells, one tick is 100 ms. A match runs five minutes in
three phases: expansion (first 1:30, more pickups, no bounty), conflict, and
the finale (last 1:30, capture is worth double). Fifteen seconds of scoreboard
between matches.

Death does not erase territory at once. The land of a fallen player **cools
down** for fifteen seconds, and during that window it can be taken back —
a reclaim returns 55% of the connected patch. Losing becomes a short chance to
strike back rather than a reset to zero.

A room holds up to 16 humans, and the empty seats are filled with bots: 14 in
an empty room, fewer as real players arrive, down to four. The bots are not
scenery — three difficulty tiers and four behaviour archetypes (Farmer,
Aggressor, Coward, Territorial), each with its own appetite for risk and its
own loop length. The Farmer draws wide loops and lives off its estate, the
Aggressor goes for heads. Hunting is bounded: at most three hunters on one
victim, and a bot drives straight at its target for a few ticks before the
strike — a visible wind-up you can still react to.

On top of the mechanics sits a progression layer: four pickups (shield, dash,
mega-dash, nova), match mutators, bounties, kill streaks and revenge.
Contracts, daily goals and 21 achievements pay out **Style**, the currency that
buys cosmetics in the shop — seven categories of eight items each. Titles are
earned from achievements only and are never sold. Progress lives in an
anonymous profile and survives a reload.

## What is interesting under the hood

**A hand-rolled binary protocol.** Game state travels as binary frames rather
than JSON: four message types and 21 kinds of game event. The main channel is
ROI — every client receives only the window of the map around its own head
(80×56 cells), fitted to its viewport, either in full or as a delta against the
tick it already knows. The minimap ships as 10×10 chunks and afterwards only
the changed ones.

**Protocol drift is caught from both sides.** The byte layout drifted between
server and client three times over the life of the project, breaking the game
silently. Now the golden buffers are captured from the production Go
serialisers and stored in the repository as data, an independent JS decoder
replays them field by field, and `public/client.js` is additionally checked
against the golden statically: every event kind has a handler, read widths and
offset sums add up. A Go test fails if the golden lags behind the serialisers;
the node tests fail if the client lags behind the golden.

**A client with no build step.** Vanilla JS (ES modules) and Canvas 2D: the
browser loads the files as they are — no npm runtime, no bundler, no framework.
The single third-party library is twemoji, vendored next to the code. Cache
busting is done with a query version stamped at deploy time, see
[docs/http.md](docs/http.md).

**Identity without accounts.** No passwords, no email: the server issues an
HMAC-SHA256 signed token that the client presents when reconnecting. Someone
else's profile — balance and cosmetics included — cannot be forged, see
[docs/security.md](docs/security.md).

**Tests are a gate.** 176 Go tests and 242 client tests; coverage is 81% for Go
and 99% of lines for the client modules, and `-race` is mandatory. For visual
checks there is an offline harness in `tools/`: the real `public/client.js`
boots inside Node on jsdom with a real canvas and a live WebSocket connection
to the server, and any frame can be snapshotted to PNG.

## Stack

**Server** — Go 1.25, with `github.com/coder/websocket` as the only external
dependency. No database: profiles live in a JSON file, match state in memory.

**Client** — vanilla JS (ES modules) and Canvas 2D, interface in Russian and
English (349 keys per dictionary).

**Production** — a systemd unit behind the system nginx, deployed with
[deploy-kit](https://github.com/tr0llex/deploy-kit).

## Quick start

Requires Go 1.25+.

```bash
go run .
```

Open <http://localhost:3000>. Static files are served from `./public`
**relative to the working directory**, so run it from the repository root.

`WS_ORIGINS` is not needed locally: loopback origins are allowed separately
(`WS_ALLOW_LOCALHOST`). Profiles land in `./data/profiles.json`.

## Layout

| File | Purpose |
| --- | --- |
| `server.go` | `main()`, routing (`/ws`, `/healthz`, `/readyz`, `/metrics`, static), cache and header middleware, graceful shutdown |
| `main.go` | Field and tick constants, environment configuration, shared helpers |
| `room.go` | Room and match: tick loop, phases, pickups, mutators, bounty |
| `grid.go` | Grid, flood-fill capture, cooling territory and reclaim |
| `bot_ai.go` | Bot AI: tiers, archetypes, hunting, loop planning |
| `economy.go` | Style, contracts, dailies, achievements, titles, shop |
| `protocol.go` | Binary protocol: message types, events, ROI, minimap |
| `ws.go` | WebSocket handler: origin allowlist, per-IP rate limits, command parsing |
| `profiles.go` | Profiles: HMAC identity tokens, atomic writes, TTL, autosave |
| `public/` | Client: rendering, input, UI, networking, effects, sound |
| `tests/` | Client-side protocol tests on Node plus the golden buffers |
| `tools/` | Offline visual harness; nothing here is ever served to a browser |
| `deploy/systemd/` | Unit and timer for hourly `profiles.json` snapshots |
| `.deploy-kit/` | Deployment target description |

More detail in [docs/](docs/): [protocol](docs/protocol.md),
[HTTP and caching](docs/http.md), [security](docs/security.md),
[testing](docs/testing.md). The documents are written in Russian.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP/WebSocket port |
| `BIND_ADDR` | `127.0.0.1` | Bind interface. Loopback by default: the outside world reaches the server through nginx, never directly |
| `ROOM_LIMIT` | `16` | Maximum humans per room |
| `MATCH_DURATION_TICKS` | `3000` | Match length in ticks (one tick = 100 ms) |
| `MATCH_INTERMISSION_TICKS` | `150` | Pause between matches, in ticks |
| `WS_ORIGINS` | `http(s)://snakes.samoy.love` | Origins allowed to complete the `/ws` handshake. Everything else gets 403 |
| `WS_ALLOW_LOCALHOST` | `1` | Whether loopback origins bypass the allowlist. **Must be `0` in production** — otherwise any locally served page carries a valid Origin |
| `PROFILE_SECRET` | *(random)* | HMAC key for identity tokens. **Mandatory in production**, see [security](docs/security.md) |
| `PROFILES_PATH` | `./data/profiles.json` | Profile file path. In production: `/var/lib/snakes/profiles.json` |
| `TRUSTED_PROXIES` | `127.0.0.1/8,::1` | Whose `X-Forwarded-For` may be trusted |
| `MAX_ROOMS` | `64` | Cap on live rooms (~500 KB each) |
| `MAX_PROFILES` | `50000` | Cap on profiles: saving marshals the whole set at once |
| `PROFILE_EMPTY_TTL_HOURS` | `6` | When a profile without progress is swept (with progress: 90 days) |
| `BOT_DEATH_SNAP` | *(empty)* | Debug snapshot of a bot on death. Not needed in production |

The server prints the effective limits and the build version at startup:

```
snakes build version=... commit=... buildTime=...
limits roomLimit=16 maxRooms=64 maxProfiles=50000 wsAllowLocalhost=false
```

The version is injected by the linker (`-X main.Version=...`) at deploy time
and handed to the client in the `hello` message and at `/version.json`. A plain
`go build` without `-ldflags` yields `version=dev` — in production that means
the binary was built outside the pipeline.

The configuration template is `.env.example`. The `env_docs_test.go` test keeps
every `os.Getenv` in the code documented both here and in the template.

## Tests

```bash
make test-all          # go test + node --check + client protocol tests
make test-race-docker  # -race in a container, no gcc needed on the host
make golden            # regenerate the protocol golden after changing it
```

A red run stops the deploy. Details, including Windows quirks, are in
[docs/testing.md](docs/testing.md).

## Deployment

Production is a `snakes.service` systemd unit behind the system nginx, with
atomic releases and automatic rollback. Client and server ship as **one
artifact** — they share the binary protocol, and versions that drift apart
break packet parsing.

```bash
dk deploy snakes          # deploy
dk rollback snakes --list # list releases on the server
```

The nginx configuration and the scripts themselves live in
[deploy-kit](https://github.com/tr0llex/deploy-kit); this repository only holds
the target description in `.deploy-kit/prod.env`.

Player profiles are the only data that exists nowhere else. A systemd timer
snapshots them: 48 hourly copies and 14 daily ones, and a snapshot with broken
JSON is rejected.

## Ecosystem

`samoy.love` reads as the owner's surname — that pun is the naming scheme of
the whole ecosystem. Snakes lives on one subdomain next to
[metro.samoy.love](https://metro.samoy.love),
[launcher.samoy.love](https://launcher.samoy.love) and
[status.samoy.love](https://status.samoy.love).

The projects differ, the engineering base does not: the same repository
conventions (a `CLAUDE.md` in every root), the same deployment path through
[deploy-kit](https://github.com/tr0llex/deploy-kit) — one target description in
the repository, one `release.sh` on the server — and one nginx configuration
for all of them. Adding a new service to the row costs a single
`.deploy-kit/*.env` file.

Written by Alexey Samoylov, <alex@samoy.love>.
