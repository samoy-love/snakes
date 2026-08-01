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
#   DEPLOY_RUN_USER HEALTH_PORT HEALTH_PATH HEALTH_RETRIES HEALTH_DELAY
#   KEEP_RELEASES DEPLOY_GOOS DEPLOY_GOARCH DEPLOY_TRANSPORT SKIP_TESTS
# ---------------------------------------------------------------------------
set -euo pipefail
# shellcheck source=scripts/lib_deploy.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib_deploy.sh"

cd "$REPO_ROOT"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
GIT_SHA="$(git rev-parse --short "${DEPLOY_REF:-HEAD}" 2>/dev/null || echo nogit)"
RELEASE="${STAMP}-${GIT_SHA}"

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
CGO_ENABLED=0 GOOS="$DEPLOY_GOOS" GOARCH="$DEPLOY_GOARCH" \
  go build -trimpath -ldflags "-s -w" -o "${STAGE}/snakes" . || die "cross-build failed"

[ -d "${SRC_DIR}/public" ] || die "public/ directory not found"
cp -r "${SRC_DIR}/public" "${STAGE}/public"

TARBALL="${STAGE}/release.tgz"
tar -czf "$TARBALL" -C "$STAGE" snakes public
log "artifact $(du -h "$TARBALL" | cut -f1) ready"

# --- 3. ship ---------------------------------------------------------------
REMOTE_TGZ="/tmp/snakes-release-${RELEASE}.tgz"
log "uploading -> ${REMOTE_TGZ}"
rcopy "$TARBALL" "$REMOTE_TGZ"
REMOTE_CTL="$(ship_remote_helper "$RELEASE")"

# --- 4. activate (atomic switch + restart + healthcheck + auto-rollback) ----
log "activating release on the server"
if ! rrun "$(remote_env) '$REMOTE_CTL' activate '$REMOTE_TGZ' '$RELEASE'"; then
  rrun "rm -f '$REMOTE_CTL' '$REMOTE_TGZ'" || true
  die "deploy failed; the server rolled back to the previous release (see output above)"
fi
rrun "rm -f '$REMOTE_CTL'" || true

# --- 5. report -------------------------------------------------------------
log "post-deploy status:"
STAT_CTL="$(ship_remote_helper "status-${RELEASE}")"
rrun "$(remote_env) '$STAT_CTL' status; rm -f '$STAT_CTL'"
log "DEPLOY OK: ${RELEASE}"
