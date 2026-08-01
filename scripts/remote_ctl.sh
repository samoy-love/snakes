#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# scripts/remote_ctl.sh - runs ON THE SERVER. Uploaded by deploy.sh/rollback.sh.
#
#   remote_ctl.sh activate <release-tarball> <release-name>
#   remote_ctl.sh rollback
#   remote_ctl.sh status
#
# Release layout:
#   $DEPLOY_PATH/releases/<name>/{snakes,public/}
#   $DEPLOY_PATH/current   -> active release   (symlink, switched atomically)
#   $DEPLOY_PATH/previous  -> last good release (symlink, used by rollback)
#
# Everything under $DEPLOY_PATH is root-owned; this script uses sudo.
# ---------------------------------------------------------------------------
set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-/opt/snakes}"
DEPLOY_SERVICE="${DEPLOY_SERVICE:-snakes}"
DEPLOY_RUN_USER="${DEPLOY_RUN_USER:-www-data}"
HEALTH_PORT="${HEALTH_PORT:-8090}"
HEALTH_PATH="${HEALTH_PATH:-/healthz}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_DELAY="${HEALTH_DELAY:-2}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"

RELEASES="${DEPLOY_PATH}/releases"
CURRENT="${DEPLOY_PATH}/current"
PREVIOUS="${DEPLOY_PATH}/previous"

log() { printf '[remote] %s\n' "$*"; }
die() { printf '[remote][fail] %s\n' "$*" >&2; exit 1; }

health_check() {
  local i code
  for i in $(seq 1 "$HEALTH_RETRIES"); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 \
            "http://127.0.0.1:${HEALTH_PORT}${HEALTH_PATH}" || true)"
    if [ "$code" = "200" ]; then
      log "health ok after ${i} attempt(s) (HTTP ${code})"
      return 0
    fi
    sleep "$HEALTH_DELAY"
  done
  log "health FAILED after ${HEALTH_RETRIES} attempts (last HTTP '${code:-none}')"
  return 1
}

# switch_to <absolute release dir> - atomic symlink swap.
switch_to() {
  local target="$1"
  # checked via sudo: the binary is root:$DEPLOY_RUN_USER 0750, so the deploying
  # user (e.g. ubuntu) has no permission bits on it itself.
  sudo test -x "${target}/snakes" || die "no executable at ${target}/snakes"
  sudo ln -sfn "$target" "${CURRENT}.tmp"
  sudo mv -Tf "${CURRENT}.tmp" "$CURRENT"
}

restart_service() {
  sudo systemctl restart "$DEPLOY_SERVICE"
}

prune_releases() {
  local keep="$KEEP_RELEASES" cur prev name
  cur="$(readlink -f "$CURRENT" 2>/dev/null || true)"
  prev="$([ -L "$PREVIOUS" ] && readlink -f "$PREVIOUS" 2>/dev/null || true)"
  # newest first; skip the first $keep, never delete current/previous
  ls -1 "$RELEASES" 2>/dev/null | sort -r | tail -n "+$((keep + 1))" | while read -r name; do
    local dir="${RELEASES}/${name}"
    [ "$dir" = "$cur" ] && continue
    [ "$dir" = "$prev" ] && continue
    log "pruning old release ${name}"
    sudo rm -rf "$dir"
  done
}

cmd_activate() {
  local tarball="$1" name="$2"
  [ -f "$tarball" ] || die "tarball not found: $tarball"
  local newdir="${RELEASES}/${name}"

  local old
  old="$(readlink -f "$CURRENT" 2>/dev/null || true)"
  log "current release: ${old:-<none>}"

  sudo mkdir -p "$newdir"
  sudo tar -xzf "$tarball" -C "$newdir"
  sudo chown -R "root:${DEPLOY_RUN_USER}" "$newdir"
  sudo chmod -R g+rX "$newdir"
  sudo chmod 0750 "${newdir}/snakes"
  rm -f "$tarball"
  log "unpacked release ${name}"

  # remember where to fall back to
  if [ -n "$old" ] && [ -d "$old" ]; then
    sudo ln -sfn "$old" "${PREVIOUS}.tmp"; sudo mv -Tf "${PREVIOUS}.tmp" "$PREVIOUS"
  fi

  switch_to "$newdir"
  log "symlink switched to ${newdir}"
  restart_service
  log "service ${DEPLOY_SERVICE} restarted"

  if health_check; then
    prune_releases
    log "DEPLOY OK release=${name}"
    return 0
  fi

  log "health check failed -> rolling back"
  sudo journalctl -u "$DEPLOY_SERVICE" -n 40 --no-pager || true
  if [ -n "$old" ] && [ -d "$old" ]; then
    switch_to "$old"
    restart_service
    if health_check; then
      log "ROLLED BACK to ${old}, service healthy"
    else
      log "ROLLBACK ALSO UNHEALTHY - manual intervention required"
    fi
  else
    log "no previous release to roll back to"
  fi
  die "deploy failed for release ${name}"
}

cmd_rollback() {
  local prev cur
  prev="$([ -L "$PREVIOUS" ] && readlink -f "$PREVIOUS" 2>/dev/null || true)"
  cur="$(readlink -f "$CURRENT" 2>/dev/null || true)"
  if [ -z "$prev" ] || [ ! -d "$prev" ]; then
    # fall back to the newest release that is not the current one
    prev="$(ls -1d "${RELEASES}"/*/ 2>/dev/null | sed 's#/$##' | sort -r \
            | grep -v "^${cur}$" | head -1 || true)"
  fi
  [ -n "$prev" ] && [ -d "$prev" ] || die "no previous release available"
  [ "$prev" = "$cur" ] && die "previous == current (${cur}), nothing to roll back to"

  log "rolling back ${cur} -> ${prev}"
  sudo ln -sfn "$cur" "${PREVIOUS}.tmp"; sudo mv -Tf "${PREVIOUS}.tmp" "$PREVIOUS"
  switch_to "$prev"
  restart_service
  health_check || die "rollback target ${prev} is unhealthy"
  log "ROLLBACK OK -> ${prev}"
}

cmd_status() {
  echo "current : $([ -L "$CURRENT" ] && readlink -f "$CURRENT" || echo '<none>')"
  echo "previous: $([ -L "$PREVIOUS" ] && readlink -f "$PREVIOUS" || echo '<none>')"
  echo "releases:"; ls -1 "$RELEASES" 2>/dev/null | sort -r || true
  echo "service : $(systemctl is-active "$DEPLOY_SERVICE" 2>/dev/null || true)"
  echo -n "health  : "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 5 \
    "http://127.0.0.1:${HEALTH_PORT}${HEALTH_PATH}" || echo "unreachable"
}

case "${1:-}" in
  activate) shift; cmd_activate "$@";;
  rollback) cmd_rollback;;
  status)   cmd_status;;
  *) die "usage: remote_ctl.sh {activate <tarball> <name>|rollback|status}";;
esac
