#!/usr/bin/env bash
# FOLLOW A CANARY SESSION TO ITS REPORT. Read-only: it only reads GitHub.
#
#   scripts/test-project/canary/watch-session.sh <run id>
#
# Waits through the reviewer gate (printing the run link while it waits),
# follows the run to completion, downloads its non-secret audit and prints the
# one report: every check, the contract verdict, the queue, the session
# summary (counts, decisions, receipts and spend). The companies and their
# evidence stay in the isolated database: scripts/test-project/canary/session-report.sql.
set -euo pipefail
run="${1:?usage: watch-session.sh <run id>}"
[[ "$run" =~ ^[0-9]+$ ]] || { echo "not a run id: $run" >&2; exit 2; }
url="$(gh run view "$run" --json url -q .url)"
while [ "$(gh run view "$run" --json status -q .status)" = "waiting" ]; do
  echo "waiting for the discovery-test reviewer: $url"
  sleep 20
done
gh run watch "$run" --interval 15 --exit-status > /dev/null 2>&1 || true
conclusion="$(gh run view "$run" --json conclusion -q .conclusion)"
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
gh run download "$run" -n canary-session -D "$dir" > /dev/null 2>&1 || echo "(no session audit was uploaded)"
echo "════ canary session $run: $conclusion — $url"
[ -f "$dir/summary.txt" ] && grep -E '^(PASS|FAIL|INFO|STOPPED|EXECUTING|KICKOFF|READY|DONE)' "$dir/summary.txt" | grep -v '^PASS  U0'
[ -f "$dir/close/summary.txt" ] && { echo "──── after the worker"; grep -E '^(PASS|FAIL|INFO|RECONCILED|STOPPED|DONE)' "$dir/close/summary.txt" | grep -v '^PASS  U0'; }
[ -f "$dir/close/session-summary.txt" ] && { echo "──── session summary"; column -t -s '|' < "$dir/close/session-summary.txt"; }
[ "$conclusion" = "success" ]
