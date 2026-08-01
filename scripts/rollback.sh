#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# scripts/rollback.sh - one-command rollback to the previous release.
#
#   ./scripts/rollback.sh            # switch `current` -> `previous`, restart, healthcheck
#   ./scripts/rollback.sh --status   # just show what is deployed right now
#
# Uses the same environment variables as scripts/deploy.sh (see lib_deploy.sh).
# Exits non-zero if the rollback target does not come up healthy.
# ---------------------------------------------------------------------------
set -euo pipefail
# shellcheck source=scripts/lib_deploy.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib_deploy.sh"

detect_transport
STAMP="$(date -u +%Y%m%d-%H%M%S)"
CTL="$(ship_remote_helper "rb-${STAMP}")"

ACTION=rollback
[ "${1:-}" = "--status" ] && ACTION=status

log "transport=${DEPLOY_TRANSPORT} action=${ACTION} target=${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}"
rc=0
rrun "$(remote_env) '$CTL' $ACTION" || rc=$?
rrun "rm -f '$CTL'" || true
[ "$rc" -eq 0 ] || die "rollback failed (exit $rc)"
[ "$ACTION" = "rollback" ] && log "ROLLBACK OK"
exit 0
