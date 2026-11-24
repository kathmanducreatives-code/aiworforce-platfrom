#!/usr/bin/env bash
# DRY RUN of scripts/release/deploy-production-release.sh against STUBS only
# (tests/release/stubs: supabase CLI + curl). Nothing real is contacted.
#   tests/release/dry-run-release.sh <ok|fail|empty|repo> [--check]
# Prints the script's output and the ordered list of would-be production writes.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
scenario="${1:-ok}"; mode="${2:---deploy}"
APP=3bef8fd03998c4133b9bebaf87acdd03a3dad5f9
TOOL="$(git rev-parse HEAD)"
st="$(mktemp -d)"; export STUB_LOG="$st/log" STUB_STATE="$st" STUB_DOWNLOAD="$scenario" STUB_APP_SHA="$APP"
export STUB_SECRETS="OPENAI_API_KEY ANTHROPIC_API_KEY MODEL_SPEND_ENFORCEMENT MODEL_SPEND_CEILING_USD MODEL_SPEND_PERIOD_DAYS"
before_repo="$(git status --porcelain -- supabase/functions)"
PATH="$ROOT/tests/release/stubs:$PATH" bash scripts/release/deploy-production-release.sh "$mode" --confirm ohsdatpvfdjdemstoiuj --sha "$APP" --tool-sha "$TOOL"
rc=$?
echo "--- exit=$rc; would-be production writes, in order:"
grep -nE "supabase (secrets set|functions deploy)" "$STUB_LOG" | sed -E 's/ \| cwd=.*//' || echo "  (none)"
echo "--- downloads (cwd):"; grep -E "functions download" "$STUB_LOG" | sed -E 's#cwd='"$ROOT"'#cwd=<repo>#' | sed 's/^/  /' || true
git checkout -q -- supabase/functions 2>/dev/null; git clean -qfd -- supabase/functions 2>/dev/null
[ "$(git status --porcelain -- supabase/functions)" = "$before_repo" ] || echo "!! repo supabase/functions changed"
rm -rf "$st"; exit $rc
