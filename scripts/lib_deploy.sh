# shellcheck shell=bash
# ---------------------------------------------------------------------------
# scripts/lib_deploy.sh - shared configuration and transport helpers.
#
# Sourced by scripts/deploy.sh and scripts/rollback.sh. Not executable on its
# own. Contains no secrets: everything is taken from the environment.
# ---------------------------------------------------------------------------

set -euo pipefail

# --- configuration (env with sane defaults) --------------------------------
DEPLOY_HOST="${DEPLOY_HOST:-207.127.93.34}"
DEPLOY_USER="${DEPLOY_USER:-ubuntu}"
DEPLOY_KEY="${DEPLOY_KEY:-}"            # path to a private key (.pem/.ppk); empty = ssh-agent / default key
DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/snakes}"
DEPLOY_SERVICE="${DEPLOY_SERVICE:-snakes}"
DEPLOY_RUN_USER="${DEPLOY_RUN_USER:-www-data}"
HEALTH_PORT="${HEALTH_PORT:-8090}"
HEALTH_PATH="${HEALTH_PATH:-/healthz}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"  # attempts
HEALTH_DELAY="${HEALTH_DELAY:-2}"       # seconds between attempts
# The local healthcheck hits 127.0.0.1:$HEALTH_PORT and so proves nothing about
# nginx/TLS/DNS. The public one goes in through the front door; set it to an
# empty string to skip it (e.g. when deploying a host without a domain yet).
PUBLIC_HEALTH_URL="${PUBLIC_HEALTH_URL:-https://snakes.samoy.love/healthz}"
PUBLIC_HEALTH_RETRIES="${PUBLIC_HEALTH_RETRIES:-10}"
# EnvironmentFile of the systemd unit; checked for a non-empty PROFILE_SECRET
# before the release symlink is switched.
DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-/etc/snakes/snakes.env}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
DEPLOY_GOOS="${DEPLOY_GOOS:-linux}"
# NOTE: the production host is an Oracle Ampere box -> aarch64. Override with
# DEPLOY_GOARCH=amd64 when targeting an x86_64 server.
DEPLOY_GOARCH="${DEPLOY_GOARCH:-arm64}"
DEPLOY_TRANSPORT="${DEPLOY_TRANSPORT:-auto}"   # auto | ssh | putty

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*" >&2; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

# --- transport autodetection ------------------------------------------------
PLINK_BIN="${PLINK_BIN:-}"
PSCP_BIN="${PSCP_BIN:-}"

find_putty() {
  if [ -n "$PLINK_BIN" ] && [ -n "$PSCP_BIN" ]; then return 0; fi
  local c
  for c in plink "/c/Program Files/PuTTY/plink" "/c/Program Files/PuTTY/plink.exe" \
           "/c/Program Files (x86)/PuTTY/plink.exe"; do
    if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then PLINK_BIN="$c"; break; fi
  done
  for c in pscp "/c/Program Files/PuTTY/pscp" "/c/Program Files/PuTTY/pscp.exe" \
           "/c/Program Files (x86)/PuTTY/pscp.exe"; do
    if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then PSCP_BIN="$c"; break; fi
  done
  [ -n "$PLINK_BIN" ] && [ -n "$PSCP_BIN" ]
}

detect_transport() {
  if [ "$DEPLOY_TRANSPORT" != "auto" ]; then
    [ "$DEPLOY_TRANSPORT" = "putty" ] && { find_putty || die "DEPLOY_TRANSPORT=putty but plink/pscp not found"; }
    return 0
  fi
  # A PuTTY .ppk key can only be used by plink/pscp.
  case "$DEPLOY_KEY" in
    *.ppk)
      find_putty || die "DEPLOY_KEY is a .ppk file but plink/pscp were not found in PATH"
      DEPLOY_TRANSPORT=putty; return 0;;
  esac
  if command -v ssh >/dev/null 2>&1 && command -v scp >/dev/null 2>&1; then
    DEPLOY_TRANSPORT=ssh
  elif find_putty; then
    DEPLOY_TRANSPORT=putty
  else
    die "no usable transport: neither ssh/scp nor plink/pscp found"
  fi
}

# rrun <command string> - run a command on the remote host.
rrun() {
  local cmd="$1"
  if [ "$DEPLOY_TRANSPORT" = "putty" ]; then
    if [ -n "$DEPLOY_KEY" ]; then
      "$PLINK_BIN" -batch -P "$DEPLOY_PORT" -i "$DEPLOY_KEY" "${DEPLOY_USER}@${DEPLOY_HOST}" "$cmd"
    else
      "$PLINK_BIN" -batch -P "$DEPLOY_PORT" "${DEPLOY_USER}@${DEPLOY_HOST}" "$cmd"
    fi
  else
    local -a opts=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -p "$DEPLOY_PORT")
    [ -n "$DEPLOY_KEY" ] && opts+=(-i "$DEPLOY_KEY")
    ssh "${opts[@]}" "${DEPLOY_USER}@${DEPLOY_HOST}" "$cmd"
  fi
}

# rcopy <local file> <remote path>
rcopy() {
  local src="$1" dst="$2"
  if [ "$DEPLOY_TRANSPORT" = "putty" ]; then
    if [ -n "$DEPLOY_KEY" ]; then
      "$PSCP_BIN" -batch -P "$DEPLOY_PORT" -i "$DEPLOY_KEY" "$src" "${DEPLOY_USER}@${DEPLOY_HOST}:${dst}"
    else
      "$PSCP_BIN" -batch -P "$DEPLOY_PORT" "$src" "${DEPLOY_USER}@${DEPLOY_HOST}:${dst}"
    fi
  else
    local -a opts=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -P "$DEPLOY_PORT")
    [ -n "$DEPLOY_KEY" ] && opts+=(-i "$DEPLOY_KEY")
    scp "${opts[@]}" "$src" "${DEPLOY_USER}@${DEPLOY_HOST}:${dst}"
  fi
}

# ship_remote_helper - upload scripts/remote_ctl.sh to the remote /tmp and echo
# its remote path on stdout.
ship_remote_helper() {
  local stamp="$1"
  local remote="/tmp/snakes-remote-ctl-${stamp}.sh"
  rcopy "${REPO_ROOT}/scripts/remote_ctl.sh" "$remote" >&2
  rrun "chmod +x '$remote'" >&2
  printf '%s' "$remote"
}

# remote_env - the environment prefix passed to remote_ctl.sh.
remote_env() {
  printf "DEPLOY_PATH='%s' DEPLOY_SERVICE='%s' DEPLOY_RUN_USER='%s' DEPLOY_ENV_FILE='%s' HEALTH_PORT='%s' HEALTH_PATH='%s' HEALTH_RETRIES='%s' HEALTH_DELAY='%s' PUBLIC_HEALTH_URL='%s' PUBLIC_HEALTH_RETRIES='%s' KEEP_RELEASES='%s'" \
    "$DEPLOY_PATH" "$DEPLOY_SERVICE" "$DEPLOY_RUN_USER" "$DEPLOY_ENV_FILE" \
    "$HEALTH_PORT" "$HEALTH_PATH" "$HEALTH_RETRIES" "$HEALTH_DELAY" \
    "$PUBLIC_HEALTH_URL" "$PUBLIC_HEALTH_RETRIES" "$KEEP_RELEASES"
}
