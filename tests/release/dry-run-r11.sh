#!/usr/bin/env bash
# DRY RUN of scripts/release/deploy-r11-pilot-chat.sh against STUBS only
# (tests/release/stubs: supabase CLI + curl, with R1 already live). Nothing real is contacted.
#   tests/release/dry-run-r11.sh <ok|fail|empty|repo|nosecret> [--check]   (APP = TOOL = HEAD)
#   tests/release/dry-run-r11.sh rollback                                   (deploy, then roll back)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
scenario="${1:-ok}"; mode="${2:---deploy}"
APP="$(git rev-parse HEAD)"; TOOL="$APP"
st="$(mktemp -d)"; export STUB_LOG="$st/log" STUB_STATE="$st" STUB_APP_SHA="$APP" STUB_BASELINE=r1
export STUB_DOWNLOAD="$scenario"; [ "$scenario" = rollback ] || [ "$scenario" = nosecret ] && STUB_DOWNLOAD=ok
export STUB_SECRETS="OPENAI_API_KEY ANTHROPIC_API_KEY MODEL_SPEND_ENFORCEMENT MODEL_SPEND_CEILING_USD MODEL_SPEND_PERIOD_DAYS AGENTORY_DELEGATION_ENABLED AGENTORY_ORION_EVIDENCE_CONTEXT"
[ "$scenario" = nosecret ] && STUB_SECRETS="${STUB_SECRETS% AGENTORY_DELEGATION_ENABLED AGENTORY_ORION_EVIDENCE_CONTEXT}"
before_repo="$(git status --porcelain -- supabase/functions)"
run() { PATH="$ROOT/tests/release/stubs:$PATH" bash scripts/release/deploy-r11-pilot-chat.sh "$@"; }
run "$mode" --confirm ohsdatpvfdjdemstoiuj --sha "$APP" --tool-sha "$TOOL"; rc=$?
if [ "$scenario" = rollback ] && [ "$rc" = 0 ]; then
  bk="$(ls -d release-backups/r11-* | tail -1)"
  rm -f "$st/deployed-pilot-chat"; export STUB_APP_SHA=3bef8fd03998c4133b9bebaf87acdd03a3dad5f9
  echo "=== rollback from $bk"; run --rollback --confirm ohsdatpvfdjdemstoiuj --backup "$bk"; rc=$?
fi
echo "--- exit=$rc; would-be production writes, in order:"
grep -nE "supabase (secrets set|secrets unset|functions deploy|functions delete|db )" "$STUB_LOG" | sed -E 's/ \| cwd=.*//' || echo "  (none)"
echo "--- downloads (cwd):"; grep -E "functions download" "$STUB_LOG" | sed -E 's#cwd='"$ROOT"'#cwd=<repo>#' | sed 's/^/  /' || true
git checkout -q -- supabase/functions 2>/dev/null; git clean -qfd -- supabase/functions 2>/dev/null
[ "$(git status --porcelain -- supabase/functions)" = "$before_repo" ] || echo "!! repo supabase/functions changed"
rm -rf "$st"; exit $rc
