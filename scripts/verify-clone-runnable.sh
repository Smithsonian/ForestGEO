#!/usr/bin/env bash
set -euo pipefail
fail=0
check() { if [ "$1" -ne "$2" ]; then echo "FAIL: $3 (got $1, want $2)"; fail=1; else echo "ok: $3"; fi; }

echo "note: sampledata is intentionally external (removed in 'removing data files'); local-db-setup tolerates its absence"

backups=$(git ls-files frontend/backups | wc -l | tr -d ' ')
check "$backups" 0 "frontend/backups not tracked"
logs=$(git ls-files '*deployment_log*' | wc -l | tr -d ' ')
check "$logs" 0 "deployment logs not tracked"
[ "$(git ls-files frontend/scripts | wc -l | tr -d ' ')" -gt 0 ] && echo "ok: scripts tracked" || { echo "FAIL: scripts untracked"; fail=1; }
exit $fail
