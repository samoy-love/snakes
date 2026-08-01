#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# scripts/remote_ctl.sh - runs ON THE SERVER. Uploaded by deploy.sh/rollback.sh.
#
#   remote_ctl.sh activate <release-tarball> <release-name>
#   remote_ctl.sh activate-detached <release-tarball> <release-name>
#   remote_ctl.sh await <release-name>
#   remote_ctl.sh rollback
#   remote_ctl.sh status
#
# Release layout:
#   $DEPLOY_PATH/releases/<name>/{snakes,public/}
#   $DEPLOY_PATH/current   -> active release   (symlink, switched atomically)
#   $DEPLOY_PATH/previous  -> last good release (informational)
#   $DEPLOY_PATH/rejected  -> newline-separated release names that failed and
#                             must never be rolled back INTO
#
# Everything under $DEPLOY_PATH is root-owned; this script uses sudo.
#
# Two properties this script is responsible for:
#
#   * SURVIVING A BROKEN SSH. `activate` switches the symlink, restarts and
#     only then health-checks; the health-check window is the longest part of
#     the run. If the caller's ssh dies inside it, a plain foreground command
#     gets SIGHUP and the auto-rollback never happens - leaving `current`
#     pointing at a release that was never proven healthy. `activate-detached`
#     therefore runs the real work as a transient systemd unit, which is a
#     child of PID 1 and outlives the ssh session; `await` reconnects and
#     picks up the result.
#
#   * MUTUAL EXCLUSION. A manual deploy racing a CI deploy would interleave
#     symlink switches. Every mutating command takes an flock first.
# ---------------------------------------------------------------------------
set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-/opt/snakes}"
DEPLOY_SERVICE="${DEPLOY_SERVICE:-snakes}"
DEPLOY_RUN_USER="${DEPLOY_RUN_USER:-www-data}"
DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-/etc/snakes/snakes.env}"
HEALTH_PORT="${HEALTH_PORT:-8090}"
HEALTH_PATH="${HEALTH_PATH:-/healthz}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_DELAY="${HEALTH_DELAY:-2}"
PUBLIC_HEALTH_URL="${PUBLIC_HEALTH_URL:-https://snakes.samoy.love/healthz}"
PUBLIC_HEALTH_RETRIES="${PUBLIC_HEALTH_RETRIES:-10}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
LOCK_WAIT="${LOCK_WAIT:-600}"
AWAIT_RETRIES="${AWAIT_RETRIES:-240}"

RELEASES="${DEPLOY_PATH}/releases"
CURRENT="${DEPLOY_PATH}/current"
PREVIOUS="${DEPLOY_PATH}/previous"
REJECTED="${DEPLOY_PATH}/rejected"
LOCK_FILE="${DEPLOY_LOCK_FILE:-${DEPLOY_PATH}/.deploy.lock}"

SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

log() { printf '[remote] %s\n' "$*"; }
die() { printf '[remote][fail] %s\n' "$*" >&2; exit 1; }

status_file() { printf '%s/.status-%s' "$DEPLOY_PATH" "$1"; }

# --- locking ---------------------------------------------------------------
# The lock file lives under $DEPLOY_PATH (root-owned), so it is created once
# with sudo and handed to the deploying user; flock itself then needs no sudo
# and behaves the same when the script runs as root inside the transient unit.
take_lock() {
  [ -z "${SNAKES_LOCK_HELD:-}" ] || return 0
  if [ ! -e "$LOCK_FILE" ]; then
    sudo install -m 0644 -o "$(id -un)" -g "$(id -gn)" /dev/null "$LOCK_FILE"
  fi
  export SNAKES_LOCK_HELD=1
  log "waiting for the deploy lock (${LOCK_FILE}, up to ${LOCK_WAIT}s)"
  exec flock -w "$LOCK_WAIT" "$LOCK_FILE" "$SELF" "$@"
}

# --- health ----------------------------------------------------------------
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

# The local check talks to 127.0.0.1:8090 and therefore says nothing about
# nginx, TLS or DNS: a broken vhost used to still produce "DEPLOY OK" while the
# site was down for everyone. This one goes in through the front door.
public_health_check() {
  [ -n "$PUBLIC_HEALTH_URL" ] || { log "public healthcheck skipped (no URL)"; return 0; }
  local i code
  for i in $(seq 1 "$PUBLIC_HEALTH_RETRIES"); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$PUBLIC_HEALTH_URL" || true)"
    if [ "$code" = "200" ]; then
      log "public health ok: ${PUBLIC_HEALTH_URL} -> ${code}"
      return 0
    fi
    sleep 3
  done
  log "public health FAILED: ${PUBLIC_HEALTH_URL} -> '${code:-none}'"
  return 1
}

# --- guards ----------------------------------------------------------------
# PROFILE_SECRET signs the player identity tokens. If the env file is gone the
# server starts with a random ephemeral key: every token in the wild becomes
# invalid at once and every profile (balance, cosmetics, stats) is orphaned.
# That is unrecoverable by rollback, so it is checked BEFORE the symlink moves.
# Only the presence of a value is ever tested; the value is never printed.
check_profile_secret() {
  sudo test -f "$DEPLOY_ENV_FILE" \
    || die "env file ${DEPLOY_ENV_FILE} is missing - PROFILE_SECRET would be regenerated and every player profile orphaned"
  sudo grep -qE '^[[:space:]]*PROFILE_SECRET[[:space:]]*=[[:space:]]*\S' "$DEPLOY_ENV_FILE" \
    || die "PROFILE_SECRET is empty or absent in ${DEPLOY_ENV_FILE} - refusing to deploy (all player profiles would be orphaned)"
  log "PROFILE_SECRET present in ${DEPLOY_ENV_FILE}"
}

# --- releases --------------------------------------------------------------
release_names_desc() { ls -1 "$RELEASES" 2>/dev/null | sort -r; }

is_rejected() { sudo grep -qxF "$1" "$REJECTED" 2>/dev/null; }

mark_rejected() {
  local name="$1"
  is_rejected "$name" && return 0
  printf '%s\n' "$name" | sudo tee -a "$REJECTED" >/dev/null
  log "release ${name} marked as rejected (rollback will never step back into it)"
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

set_previous() {
  local target="$1"
  [ -n "$target" ] && [ -d "$target" ] || return 0
  sudo ln -sfn "$target" "${PREVIOUS}.tmp"; sudo mv -Tf "${PREVIOUS}.tmp" "$PREVIOUS"
}

restart_service() {
  sudo systemctl restart "$DEPLOY_SERVICE"
}

# Called on BOTH the success and the failure path: a run of failed deploys used
# to leave one unpacked release directory each and nothing ever collected them.
prune_releases() {
  local keep="$KEEP_RELEASES" cur prev name dir
  cur="$(readlink -f "$CURRENT" 2>/dev/null || true)"
  prev="$([ -L "$PREVIOUS" ] && readlink -f "$PREVIOUS" 2>/dev/null || true)"
  # newest first; skip the first $keep, never delete current/previous
  release_names_desc | tail -n "+$((keep + 1))" | while read -r name; do
    dir="${RELEASES}/${name}"
    [ "$dir" = "$cur" ] && continue
    [ "$dir" = "$prev" ] && continue
    log "pruning old release ${name}"
    sudo rm -rf "$dir"
    sudo sed -i "\\#^${name}\$#d" "$REJECTED" 2>/dev/null || true
    sudo rm -f "$(status_file "$name")"
  done
}

# rollback_target <current release name> - the newest release strictly older
# than the current one that has not already been rejected.
#
# The old implementation just followed the `previous` symlink and set
# previous=current on the way out, so two rollbacks in a row ping-ponged
# between the same two releases and the second one landed back on the broken
# build. Walking the (timestamp-sorted) release list downwards instead makes
# repeated rollbacks step further and further back, which is what an operator
# actually means by "roll back again".
rollback_target() {
  local curname="$1" name
  for name in $(release_names_desc); do
    [ "$name" \< "$curname" ] || continue
    if is_rejected "$name"; then
      log "skipping rejected release ${name}" >&2
      continue
    fi
    sudo test -x "${RELEASES}/${name}/snakes" || continue
    printf '%s' "${RELEASES}/${name}"
    return 0
  done
  return 1
}

# --- commands --------------------------------------------------------------
cmd_activate() {
  local tarball="$1" name="$2"
  local newdir="${RELEASES}/${name}"

  # Cheapest, most destructive-if-missed check goes first.
  check_profile_secret
  [ -f "$tarball" ] || die "tarball not found: $tarball"

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
  set_previous "$old"

  switch_to "$newdir"
  log "symlink switched to ${newdir}"
  restart_service
  log "service ${DEPLOY_SERVICE} restarted"

  if health_check; then
    if public_health_check; then
      prune_releases
      log "DEPLOY OK release=${name}"
      return 0
    fi
    # The app is healthy on 127.0.0.1 - this is an nginx/TLS/DNS problem, not a
    # bad binary, so rolling the release back would fix nothing. Fail loudly
    # and leave the new release in place for a human to look at.
    prune_releases
    die "release ${name} is healthy locally but UNREACHABLE through ${PUBLIC_HEALTH_URL} - check nginx/TLS/DNS (the release was NOT rolled back)"
  fi

  log "health check failed -> rolling back"
  sudo journalctl -u "$DEPLOY_SERVICE" -n 40 --no-pager || true
  mark_rejected "$name"
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
  prune_releases
  die "deploy failed for release ${name}"
}

# activate-detached: the ssh-proof wrapper around `activate`.
#
# systemd-run makes the work a transient unit owned by PID 1, so a dropped ssh
# can no longer SIGHUP it half-way through the health-check window; --wait
# --pipe keep the normal foreground experience (streamed output, propagated
# exit code) while the connection is alive. The exit code is ALSO written to a
# status file so that `await` can report it after a reconnect.
cmd_activate_detached() {
  local tarball="$1" name="$2"
  local unit="snakes-deploy-${name}"
  local sf; sf="$(status_file "$name")"
  sudo rm -f "$sf"
  sudo systemctl reset-failed "$unit" 2>/dev/null || true
  log "running activation as transient unit ${unit} (survives an ssh drop)"
  sudo systemd-run --unit="$unit" --description="snakes deploy ${name}" --wait --pipe --collect \
    --setenv=SNAKES_LOCK_HELD=1 \
    --setenv=DEPLOY_PATH="$DEPLOY_PATH" \
    --setenv=DEPLOY_SERVICE="$DEPLOY_SERVICE" \
    --setenv=DEPLOY_RUN_USER="$DEPLOY_RUN_USER" \
    --setenv=DEPLOY_ENV_FILE="$DEPLOY_ENV_FILE" \
    --setenv=HEALTH_PORT="$HEALTH_PORT" \
    --setenv=HEALTH_PATH="$HEALTH_PATH" \
    --setenv=HEALTH_RETRIES="$HEALTH_RETRIES" \
    --setenv=HEALTH_DELAY="$HEALTH_DELAY" \
    --setenv=PUBLIC_HEALTH_URL="$PUBLIC_HEALTH_URL" \
    --setenv=PUBLIC_HEALTH_RETRIES="$PUBLIC_HEALTH_RETRIES" \
    --setenv=KEEP_RELEASES="$KEEP_RELEASES" \
    /bin/bash -c "'${SELF}' activate '${tarball}' '${name}'; rc=\$?; printf '%s' \"\$rc\" > '${sf}'; exit \$rc"
}

# await <release> - poll for the result of a detached activation. Used by
# deploy.sh when the activate connection died: the work itself kept running.
cmd_await() {
  # NB: separate statements on purpose - bash expands every word of a single
  # `local` before assigning any of them, so `local a="$1" b="${a}"` would blow
  # up under `set -u`.
  local name="$1"
  local unit="snakes-deploy-${name}"
  local sf i rc
  sf="$(status_file "$name")"
  log "awaiting the result of ${unit}"
  for i in $(seq 1 "$AWAIT_RETRIES"); do
    [ -f "$sf" ] && break
    sleep 2
  done
  [ -f "$sf" ] || die "no result from ${unit} after $((AWAIT_RETRIES * 2))s - inspect 'journalctl -u ${unit}' on the server"
  rc="$(cat "$sf" 2>/dev/null || echo 1)"
  sudo journalctl -u "$unit" --no-pager -o cat 2>/dev/null | tail -n 60 || true
  sudo rm -f "$sf"
  [ "$rc" = "0" ] || die "detached activation of ${name} exited ${rc}"
  log "detached activation of ${name} finished OK"
}

cmd_rollback() {
  local cur curname target next
  cur="$(readlink -f "$CURRENT" 2>/dev/null || true)"
  [ -n "$cur" ] || die "no current release"
  curname="$(basename "$cur")"

  target="$(rollback_target "$curname" || true)"
  [ -n "$target" ] && [ -d "$target" ] \
    || die "no older, non-rejected release to roll back to (current=${curname})"

  log "rolling back ${cur} -> ${target}"
  mark_rejected "$curname"
  next="$(rollback_target "$(basename "$target")" || true)"
  set_previous "$next"
  switch_to "$target"
  restart_service
  health_check || die "rollback target ${target} is unhealthy"
  public_health_check || log "WARNING: app is healthy locally but ${PUBLIC_HEALTH_URL} is not answering - check nginx"
  log "ROLLBACK OK -> ${target}"
}

cmd_status() {
  echo "current : $([ -L "$CURRENT" ] && readlink -f "$CURRENT" || echo '<none>')"
  echo "previous: $([ -L "$PREVIOUS" ] && readlink -f "$PREVIOUS" || echo '<none>')"
  echo "releases:"; release_names_desc || true
  echo "rejected:"; sudo cat "$REJECTED" 2>/dev/null || echo "  <none>"
  echo "service : $(systemctl is-active "$DEPLOY_SERVICE" 2>/dev/null || true)"
  echo "version : $(sudo journalctl -u "$DEPLOY_SERVICE" -n 200 --no-pager 2>/dev/null | grep -o 'snakes build version=.*' | tail -1 || echo unknown)"
  echo -n "health  : "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 5 \
    "http://127.0.0.1:${HEALTH_PORT}${HEALTH_PATH}" || echo "unreachable"
  echo -n "public  : "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 \
    "$PUBLIC_HEALTH_URL" || echo "unreachable"
}

case "${1:-}" in
  activate|activate-detached|rollback) take_lock "$@";;
esac

case "${1:-}" in
  activate)          shift; cmd_activate "$@";;
  activate-detached) shift; cmd_activate_detached "$@";;
  await)             shift; [ $# -eq 1 ] || die "usage: await <release>"; cmd_await "$1";;
  rollback)          cmd_rollback;;
  status)            cmd_status;;
  *) die "usage: remote_ctl.sh {activate <tarball> <name>|activate-detached <tarball> <name>|await <name>|rollback|status}";;
esac
