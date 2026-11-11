#!/usr/bin/env bash
# ACTIVATE THE ORION EVIDENCE PILOT ON TEST — run in YOUR shell (Supabase CLI logged in).
# NEEDS EXPLICIT APPROVAL. Never touches production: every command goes through
# `npm run supabase:test --`, which pins --project-ref tlvnfrxzjhsjgdofwehb.
#
#   scripts/test-project/orion-pilot-activate.sh --confirm tlvnfrxzjhsjgdofwehb
#
# 1. checks the chat model keys exist on TEST (names only — values are never read)
# 2. sets the pilot flags + a pilot spend ceiling (see below)
# 3. deploys pilot-chat (bundled by the Supabase API, no Docker)
# 4. smoke: the endpoint answers 401 without a token
#
# SPEND: MODEL_SPEND_CEILING_USD=0.49 per workspace over MODEL_SPEND_PERIOD_DAYS=7,
# enforced before every turn. A turn's worst case is about $0.05 (Luna understanding
# + a Terra-5.6 repair + Haiku reply at their output caps), so pilot + isolation
# workspaces together stay under $0.60. NOTE: these are project-wide TEST secrets,
# so lead-pipeline on TEST is held to the same ceiling until the pilot is deactivated.
# Terra and hybrid routing are NOT set and stay off.
set -euo pipefail
REF=tlvnfrxzjhsjgdofwehb
[ "${1:-}" = "--confirm" ] && [ "${2:-}" = "$REF" ] || { echo "usage: $0 --confirm $REF" >&2; exit 2; }
cd "$(dirname "$0")/../.."
t() { npm run --silent supabase:test -- "$@"; }

echo "== 1. chat model keys on TEST (names only)"
names="$(t secrets list 2>/dev/null | awk -F'|' 'NR>2 {gsub(/ /,"",$1); print $1}')"
missing=0
for k in OPENAI_API_KEY ANTHROPIC_API_KEY; do
  if echo "$names" | grep -qx "$k"; then echo "  $k: present"; else echo "  $k: MISSING"; missing=1; fi
done
[ "$missing" = 0 ] || { echo "refusing: set the missing key(s) on TEST first (npm run supabase:test -- secrets set NAME=…)"; exit 1; }
for k in MODEL_SPEND_CEILING_USD MODEL_SPEND_PERIOD_DAYS MODEL_SPEND_ENFORCEMENT; do
  if echo "$names" | grep -qx "$k"; then echo "  NOTE: $k already exists and will be overwritten — record its value to restore it later"; fi
done

echo "== 2. pilot flags + spend ceiling"
t secrets set \
  AGENTORY_ORION_EVIDENCE_CONTEXT=true \
  AGENTORY_ORION_EVIDENCE_WORKSPACES=a71a0000-0000-4000-8000-0000000011a1 \
  MODEL_SPEND_ENFORCEMENT=enforce MODEL_SPEND_CEILING_USD=0.49 MODEL_SPEND_PERIOD_DAYS=7

echo "== 3. deploy pilot-chat"
t functions deploy pilot-chat --use-api

echo "== 4. smoke"
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "https://$REF.supabase.co/functions/v1/pilot-chat" -H 'Content-Type: application/json' -d '{}')"
echo "  POST without a token → HTTP $code (want 401)"
[ "$code" = "401" ] || { echo "WARNING: unexpected status; check the function logs before testing"; exit 1; }
echo "ORION pilot active on $REF. Terra / hybrid routing: off."
