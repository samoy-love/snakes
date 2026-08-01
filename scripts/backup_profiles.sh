#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# scripts/backup_profiles.sh - hourly + daily snapshots of profiles.json.
#
# Runs ON THE SERVER as root, driven by the systemd timer
# snakes-backup-profiles.timer (see deploy/systemd/). Installed to
# /usr/local/bin/snakes-backup-profiles.sh.
#
#   snakes-backup-profiles.sh            # take a snapshot + rotate
#   snakes-backup-profiles.sh --list     # show what is stored right now
#   snakes-backup-profiles.sh --restore <file>   # restore a snapshot (asks nothing)
#
# WHY: /var/lib/snakes/profiles.json is the ONLY copy of every player's
# balance, statistics and cosmetics. A truncated write, a bad deploy or an
# `rm` takes all of it with no way back.
#
# Layout:
#   /var/lib/snakes/backups/hourly/profiles-<YYYYmmdd-HH>.json   keep 48
#   /var/lib/snakes/backups/daily/profiles-<YYYYmmdd>.json       keep 14
#
# Permissions are never weaker than the source: dirs 0700, files 0600, owned
# by the service user (www-data). A snapshot that does not parse as JSON is
# refused, so a half-written source file can never evict good backups.
# ---------------------------------------------------------------------------
set -euo pipefail

SRC="${SNAKES_PROFILES:-/var/lib/snakes/profiles.json}"
BACKUP_ROOT="${SNAKES_BACKUP_ROOT:-/var/lib/snakes/backups}"
OWNER="${SNAKES_BACKUP_OWNER:-www-data:www-data}"
KEEP_HOURLY="${SNAKES_KEEP_HOURLY:-48}"
KEEP_DAILY="${SNAKES_KEEP_DAILY:-14}"

HOURLY_DIR="${BACKUP_ROOT}/hourly"
DAILY_DIR="${BACKUP_ROOT}/daily"

log() { printf '[snakes-backup] %s\n' "$*"; }
die() { printf '[snakes-backup][fail] %s\n' "$*" >&2; exit 1; }

valid_json() { python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$1" >/dev/null 2>&1; }

# rotate <dir> <keep> - delete all but the <keep> newest *.json by name.
rotate() {
  local dir="$1" keep="$2" f
  # names are timestamp-sorted, so lexical sort == chronological sort
  ls -1 "$dir"/profiles-*.json 2>/dev/null | sort -r | tail -n "+$((keep + 1))" | while read -r f; do
    log "rotating out $(basename "$f")"
    rm -f "$f"
  done
}

cmd_list() {
  local d
  for d in "$HOURLY_DIR" "$DAILY_DIR"; do
    echo "== $d"
    ls -la "$d" 2>/dev/null | tail -n +2 || echo "  (missing)"
  done
}

# Restore is deliberately explicit: it stops the service, swaps the file and
# starts it again, keeping a pre-restore copy of whatever was there.
cmd_restore() {
  local snap="$1"
  [ -f "$snap" ] || die "no such snapshot: $snap"
  valid_json "$snap" || die "snapshot is not valid JSON: $snap"
  local stamp; stamp="$(date -u +%Y%m%d-%H%M%S)"
  if [ -f "$SRC" ]; then
    cp -p "$SRC" "${BACKUP_ROOT}/pre-restore-${stamp}.json"
    log "current file saved as ${BACKUP_ROOT}/pre-restore-${stamp}.json"
  fi
  systemctl stop snakes || true
  install -m 0600 -o "${OWNER%%:*}" -g "${OWNER##*:}" "$snap" "$SRC"
  systemctl start snakes
  log "restored ${snap} -> ${SRC}"
}

cmd_backup() {
  [ -f "$SRC" ] || die "source not found: $SRC"
  valid_json "$SRC" || die "source is not valid JSON, refusing to snapshot: $SRC"

  install -d -m 0700 -o "${OWNER%%:*}" -g "${OWNER##*:}" "$BACKUP_ROOT" "$HOURLY_DIR" "$DAILY_DIR"

  local hstamp dstamp tmp
  hstamp="$(date -u +%Y%m%d-%H)"
  dstamp="$(date -u +%Y%m%d)"
  tmp="$(mktemp "${HOURLY_DIR}/.tmp-XXXXXX")"
  trap 'rm -f "$tmp"' EXIT

  cp "$SRC" "$tmp"
  valid_json "$tmp" || die "copy is not valid JSON (source changed mid-copy?)"
  chmod 0600 "$tmp"; chown "$OWNER" "$tmp"
  mv -f "$tmp" "${HOURLY_DIR}/profiles-${hstamp}.json"
  trap - EXIT
  log "hourly snapshot ${HOURLY_DIR}/profiles-${hstamp}.json ($(stat -c%s "${HOURLY_DIR}/profiles-${hstamp}.json") bytes)"

  # one daily copy per UTC day: the first run of the day creates it
  if [ ! -f "${DAILY_DIR}/profiles-${dstamp}.json" ]; then
    cp -p "${HOURLY_DIR}/profiles-${hstamp}.json" "${DAILY_DIR}/profiles-${dstamp}.json"
    log "daily snapshot ${DAILY_DIR}/profiles-${dstamp}.json"
  fi

  rotate "$HOURLY_DIR" "$KEEP_HOURLY"
  rotate "$DAILY_DIR" "$KEEP_DAILY"
}

case "${1:-}" in
  ""|--backup) cmd_backup;;
  --list)      cmd_list;;
  --restore)   shift; [ $# -eq 1 ] || die "usage: --restore <snapshot.json>"; cmd_restore "$1";;
  *) die "usage: $(basename "$0") [--backup|--list|--restore <file>]";;
esac
