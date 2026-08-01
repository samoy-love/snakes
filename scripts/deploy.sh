#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# scripts/deploy.sh - idempotent zero-config deploy of the Snakes server.
#
#   ./scripts/deploy.sh              # build + ship + activate + healthcheck
#   SKIP_TESTS=1 ./scripts/deploy.sh # skip `go test ./...`
#
# Works from Git Bash on Windows (plink/pscp) and from Linux CI (ssh/scp);
# the transport is detected automatically, see scripts/lib_deploy.sh.
#
# On a failed health check the server side automatically switches the `current`
# symlink back to the previous release, restarts, and this script exits non-zero.
#
# Configuration - all via environment, no secrets in this file:
#   DEPLOY_HOST DEPLOY_USER DEPLOY_KEY DEPLOY_PORT DEPLOY_PATH DEPLOY_SERVICE
#   DEPLOY_RUN_USER DEPLOY_ENV_FILE HEALTH_PORT HEALTH_PATH HEALTH_RETRIES
#   HEALTH_DELAY PUBLIC_HEALTH_URL PUBLIC_HEALTH_RETRIES KEEP_RELEASES
#   DEPLOY_GOOS DEPLOY_GOARCH DEPLOY_TRANSPORT SKIP_TESTS
#
# Two deploys can never run at the same time: the server side takes an flock
# before touching any symlink, so a manual run racing a CI run simply queues.
# ---------------------------------------------------------------------------
set -euo pipefail
# shellcheck source=scripts/lib_deploy.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib_deploy.sh"

cd "$REPO_ROOT"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
GIT_SHA="$(git rev-parse --short "${DEPLOY_REF:-HEAD}" 2>/dev/null || echo nogit)"
RELEASE="${STAMP}-${GIT_SHA}"

# Build metadata baked into the binary (see the Version/Commit/BuildTime vars in
# main.go). Computed here, while the working directory is still the git repo:
# with DEPLOY_REF set we cd into a pristine `git archive` export below, which is
# not a repository and where `git rev-parse` would fail.
GIT_SHA_FULL="$(git rev-parse "${DEPLOY_REF:-HEAD}" 2>/dev/null || echo nogit)"
if [ -n "$(git status --porcelain 2>/dev/null || true)" ] && [ -z "${DEPLOY_REF:-}" ]; then
  GIT_SHA_FULL="${GIT_SHA_FULL}-dirty"
fi
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# DEPLOY_REF=<git ref> builds from a pristine export of that ref instead of the
# working tree - use it when the checkout has unrelated local modifications.
SRC_DIR="$REPO_ROOT"
if [ -n "${DEPLOY_REF:-}" ]; then
  SRC_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t snakes-src)"
  trap 'rm -rf "$SRC_DIR"' EXIT
  log "exporting ${DEPLOY_REF} (${GIT_SHA}) -> ${SRC_DIR}"
  git archive --format=tar "$DEPLOY_REF" | tar -x -C "$SRC_DIR" \
    || die "git archive ${DEPLOY_REF} failed"
  cd "$SRC_DIR"
fi

detect_transport
log "transport=${DEPLOY_TRANSPORT} target=${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}"
log "release=${RELEASE} goos=${DEPLOY_GOOS} goarch=${DEPLOY_GOARCH}"

# --- 1. verify the tree builds and tests pass ------------------------------
log "go build ./..."
go build ./... || die "go build failed - refusing to deploy"
if [ "${SKIP_TESTS:-0}" != "1" ]; then
  log "go test ./..."
  go test ./... || die "go test failed - refusing to deploy"
else
  warn "SKIP_TESTS=1: tests were not run"
fi

# --- 2. build the static Linux binary --------------------------------------
STAGE="$(mktemp -d 2>/dev/null || mktemp -d -t snakes)"
trap 'rm -rf "$STAGE"; if [ "$SRC_DIR" != "$REPO_ROOT" ]; then rm -rf "$SRC_DIR"; fi' EXIT
log "building static binary -> ${STAGE}/snakes"
log "stamping version=${RELEASE} commit=${GIT_SHA_FULL} buildTime=${BUILD_TIME}"
# -X fills main.Version/main.Commit/main.BuildTime, which the app logs on start
# ("snakes build version=...") and reports to the client in `hello`. Without
# them production reported version=dev and there was no way to tell from a
# running binary which release it actually is.
CGO_ENABLED=0 GOOS="$DEPLOY_GOOS" GOARCH="$DEPLOY_GOARCH" \
  go build -trimpath \
    -ldflags "-s -w -X main.Version=${RELEASE} -X main.Commit=${GIT_SHA_FULL} -X main.BuildTime=${BUILD_TIME}" \
    -o "${STAGE}/snakes" . || die "cross-build failed"

[ -d "${SRC_DIR}/public" ] || die "public/ directory not found"
cp -r "${SRC_DIR}/public" "${STAGE}/public"

# --- 2a. versioned static --------------------------------------------------
#
# public/index.html references its own static as `/client.js?v=__BUILD__`.
# The literal is replaced here, in the copy that ships, and never in the repo:
# a working tree that still says __BUILD__ is what makes `go run .` serve
# Cache-Control: no-store (see isVersionedAsset in server.go), so local
# development never fights a year-long immutable cache.
#
# Every release gets a fresh RELEASE string, so every deploy produces new URLs
# and the immutable answer can never pin a user to an old bundle.
#
# Note: `sed -i` is deliberately not used - BSD/macOS sed wants an argument to
# -i and GNU sed does not, and this script runs from Git Bash, Linux CI and
# occasionally macOS.
stamp_build() {
  local f="$1"
  [ -f "$f" ] || return 0
  sed "s/__BUILD__/${RELEASE}/g" "$f" > "${f}.stamped" && mv "${f}.stamped" "$f"
}
STAMPED=0
for f in "${STAGE}"/public/*.html; do
  [ -e "$f" ] || continue
  if grep -q '__BUILD__' "$f" 2>/dev/null; then
    stamp_build "$f"
    STAMPED=$((STAMPED + 1))
  fi
done
if [ "$STAMPED" -gt 0 ]; then
  log "static versioning: stamped ?v=${RELEASE} in ${STAMPED} html file(s)"
  if grep -rq '__BUILD__' "${STAGE}/public" 2>/dev/null; then
    die "__BUILD__ still present in the staged public/ after stamping"
  fi
else
  warn "static versioning: no __BUILD__ placeholder found in public/*.html - assets will be served with no-store"
fi

TARBALL="${STAGE}/release.tgz"
tar -czf "$TARBALL" -C "$STAGE" snakes public
log "artifact $(du -h "$TARBALL" | cut -f1) ready"

# --- 3. ship ---------------------------------------------------------------
REMOTE_TGZ="/tmp/snakes-release-${RELEASE}.tgz"
log "uploading -> ${REMOTE_TGZ}"
rcopy "$TARBALL" "$REMOTE_TGZ"
REMOTE_CTL="$(ship_remote_helper "$RELEASE")"

# --- 4. activate (atomic switch + restart + healthcheck + auto-rollback) ----
#
# `activate-detached` runs the real work as a transient systemd unit on the
# server. The dangerous window is between the symlink switch and the end of the
# health check (up to 60s): as a plain foreground ssh command the remote script
# died of SIGHUP if the connection dropped there, so the auto-rollback never ran
# and `current` stayed on an unverified release. As a systemd unit the work is
# a child of PID 1 and finishes regardless; if our ssh dies we simply reconnect
# and ask for the result with `await`.
log "activating release on the server"
if ! rrun "$(remote_env) '$REMOTE_CTL' activate-detached '$REMOTE_TGZ' '$RELEASE'"; then
  warn "the activate connection returned non-zero - reconnecting to find out what actually happened"
  if rrun "$(remote_env) '$REMOTE_CTL' await '$RELEASE'"; then
    log "activation completed successfully on the server despite the interrupted connection"
  else
    rrun "rm -f '$REMOTE_CTL' '$REMOTE_TGZ'" || true
    die "deploy failed; the server rolled back to the previous release (see output above)"
  fi
fi
rrun "rm -f '$REMOTE_CTL'" || true

# --- 5. report -------------------------------------------------------------
log "post-deploy status:"
STAT_CTL="$(ship_remote_helper "status-${RELEASE}")"
rrun "$(remote_env) '$STAT_CTL' status; rm -f '$STAT_CTL'"
log "DEPLOY OK: ${RELEASE}"
