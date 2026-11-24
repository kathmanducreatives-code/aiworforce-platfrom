#!/usr/bin/env bash
# (RE)DEPLOY `pilot-chat` TO TEST AS ONE BUNDLED FILE — run in YOUR shell.
# DEPLOY ONLY: it never sets or unsets secrets (the evidence flags and the
# spending limit stay exactly as they are). TEST only, via `npm run supabase:test --`.
#
#   scripts/test-project/orion-pilot-deploy.sh --confirm tlvnfrxzjhsjgdofwehb
#
# Why bundled: a plain `functions deploy pilot-chat --use-api` uploads all 284
# source modules (~5.7 MB) and the API answers HTTP 413. The bundle is one
# ~1.4 MB file with the same code (scripts/test-project/build-pilot-chat-bundle.mjs).
#
# Preflight (names only, read-only): OPENAI_API_KEY present; no Terra / routing /
# model-family override; reports the evidence flags and spending limit as found.
set -euo pipefail
REF=tlvnfrxzjhsjgdofwehb
[ "${1:-}" = "--confirm" ] && [ "${2:-}" = "$REF" ] || { echo "usage: $0 --confirm $REF" >&2; exit 2; }
SKIP_PREFLIGHT=0; [ "${3:-}" = "--skip-preflight" ] && SKIP_PREFLIGHT=1
cd "$(dirname "$0")/../.."
t() { npm run --silent supabase:test -- "$@"; }
MAX_BYTES=4000000

[ -f node_modules/esbuild/package.json ] || { echo "refusing: esbuild missing — run 'npm install' in the repository first"; exit 1; }

if [ "$SKIP_PREFLIGHT" = 0 ]; then
  echo "== TEST secrets on $REF (names only, nothing is changed)"
  names="$(t secrets list 2>/dev/null | awk -F'|' 'NR>2 {gsub(/ /,"",$1); if ($1!="") print $1}')"
  [ -n "$names" ] || { echo "refusing: could not list TEST secrets (is the CLI logged in with access to $REF?)"; exit 1; }
  has() { echo "$names" | grep -qx "$1"; }
  has OPENAI_API_KEY && echo "  OPENAI_API_KEY: present" || { echo "refusing: OPENAI_API_KEY missing on TEST"; exit 1; }
  bad="$(echo "$names" | grep -E '^AGENTORY_(TERRA|HYBRID|ROUTE)_|^AGENTORY_GPT_MODEL_FAMILY$' || true)"
  [ -z "$bad" ] || { echo "refusing: Terra / routing / model-family secrets present:"; echo "$bad" | sed 's/^/    /'; exit 1; }
  for k in AGENTORY_ORION_EVIDENCE_CONTEXT AGENTORY_ORION_EVIDENCE_WORKSPACES MODEL_SPEND_ENFORCEMENT MODEL_SPEND_CEILING_USD MODEL_SPEND_PERIOD_DAYS; do
    has "$k" && echo "  $k: present (left unchanged)" || echo "  $k: ABSENT (not set by this script — run orion-pilot-activate.sh --check)"
  done
fi

echo "== build the single-file bundle"
OUT="$(mktemp -d "${TMPDIR:-/tmp}/pilot-chat-bundle.XXXXXX")"
trap 'rm -rf "$OUT"' EXIT
node scripts/test-project/build-pilot-chat-bundle.mjs "$OUT"
bytes=$(wc -c < "$OUT/supabase/functions/pilot-chat/index.ts" | tr -d ' ')
echo "  bundle: $bytes bytes"
[ "$bytes" -le "$MAX_BYTES" ] || { echo "refusing: bundle larger than $MAX_BYTES bytes"; exit 1; }
grep -q "project_id = \"$REF\"" "$OUT/supabase/config.toml" || { echo "refusing: bundle workdir does not name TEST"; exit 1; }

echo "== deploy pilot-chat (TEST only, --use-api, no Docker)"
t functions deploy pilot-chat --use-api --workdir "$OUT"

echo "== smoke (free: no token, so no model call)"
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "https://$REF.supabase.co/functions/v1/pilot-chat" -H 'Content-Type: application/json' -d '{}')"
echo "  POST without a token → HTTP $code (want 401)"
[ "$code" = "401" ] || { echo "WARNING: unexpected status; check the function logs before testing"; exit 1; }
echo "pilot-chat deployed on $REF (OpenAI-only: GPT-5.6 Luna). Secrets unchanged."
