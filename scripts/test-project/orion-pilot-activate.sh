#!/usr/bin/env bash
# ACTIVATE THE ORION EVIDENCE PILOT ON TEST — run in YOUR shell (Supabase CLI logged in).
# Never touches production: every command goes through `npm run supabase:test --`,
# which pins --project-ref tlvnfrxzjhsjgdofwehb.
#
#   scripts/test-project/orion-pilot-activate.sh --check  --confirm tlvnfrxzjhsjgdofwehb
#       READ-ONLY. Lists secret NAMES (never values) and reports what --deploy would do.
#
#   scripts/test-project/orion-pilot-activate.sh --deploy --confirm tlvnfrxzjhsjgdofwehb [--set-pilot-ceiling]
#       Sets the two evidence flags (pilot workspace only) and deploys pilot-chat.
#
# SPENDING LIMIT (MODEL_SPEND_*) IS PROJECT-WIDE, so it is PRESERVED:
#   * all three already exist  → left untouched; pilot-chat uses the existing limit.
#   * only some exist          → refuses (incomplete config; decide by hand).
#   * none exist               → pilot-chat would refuse every turn (fail-closed
#     `ceiling_misconfigured`). --deploy refuses unless you add --set-pilot-ceiling,
#     which sets enforce / $0.49 per workspace / 7 days. Effect on other TEST
#     functions: only `daily-brief` reads these (lead-pipeline and
#     provider-connections do not), and it would go from refusing model calls to
#     allowed up to the same $0.49 per workspace per 7 days.
#
# MODELS: ORION chat is OpenAI-only and needs only OPENAI_API_KEY (ANTHROPIC_API_KEY
# is neither required nor used by it). Understanding and answers: GPT-5.6 Luna; a
# malformed understanding gets one GPT-5.6 Terra repair. No Anthropic fallback.
# Terra-6.1 / hybrid routing: never set here; --deploy refuses if any
# AGENTORY_TERRA_*, AGENTORY_HYBRID_*, AGENTORY_ROUTE_* or AGENTORY_GPT_MODEL_FAMILY
# secret exists on TEST (the last would move ORION off GPT-5.6 Luna).
# Rollback: scripts/test-project/orion-pilot-deactivate.sh (reads the state file
# written below, so it only unsets the spending limit if THIS script set it).
set -euo pipefail
REF=tlvnfrxzjhsjgdofwehb
PILOT_WS=a71a0000-0000-4000-8000-0000000011a1
MODE="${1:-}"
{ [ "$MODE" = "--check" ] || [ "$MODE" = "--deploy" ]; } && [ "${2:-}" = "--confirm" ] && [ "${3:-}" = "$REF" ] \
  || { echo "usage: $0 --check|--deploy --confirm $REF [--set-pilot-ceiling]" >&2; exit 2; }
SET_CEILING=0; [ "${4:-}" = "--set-pilot-ceiling" ] && SET_CEILING=1
cd "$(dirname "$0")/../.."
STATE=.orion-pilot-activation.state
t() { npm run --silent supabase:test -- "$@"; }

echo "== TEST secrets on $REF (names only)"
names="$(t secrets list 2>/dev/null | awk -F'|' 'NR>2 {gsub(/ /,"",$1); if ($1!="") print $1}')"
[ -n "$names" ] || { echo "refusing: could not list TEST secrets (is the CLI logged in with access to $REF?)"; exit 1; }
has() { echo "$names" | grep -qx "$1"; }

block=0
# ORION chat is OpenAI-only: understanding, answers and repair all run on OpenAI.
if has OPENAI_API_KEY; then echo "  OPENAI_API_KEY: present (required)"; else echo "  OPENAI_API_KEY: MISSING (required)"; block=1; fi
has ANTHROPIC_API_KEY && echo "  ANTHROPIC_API_KEY: present (not used by ORION chat)" \
  || echo "  ANTHROPIC_API_KEY: absent (fine: not used by ORION chat)"
routing="$(echo "$names" | grep -E '^AGENTORY_(TERRA|HYBRID|ROUTE)_|^AGENTORY_GPT_MODEL_FAMILY$' || true)"
if [ -n "$routing" ]; then echo "  Terra / routing / model-family secrets present (must be absent):"; echo "$routing" | sed 's/^/    /'; block=1
else echo "  Terra / hybrid routing / model-family override: none (ORION uses GPT-5.6 Luna)"; fi
for k in AGENTORY_ORION_EVIDENCE_CONTEXT AGENTORY_ORION_EVIDENCE_WORKSPACES; do
  has "$k" && echo "  $k: already set (will be overwritten with the pilot value)" || echo "  $k: not set"
done

n=0; for k in MODEL_SPEND_ENFORCEMENT MODEL_SPEND_CEILING_USD MODEL_SPEND_PERIOD_DAYS; do
  if has "$k"; then echo "  $k: present (will be preserved)"; n=$((n+1)); else echo "  $k: absent"; fi
done
case "$n" in
  3) spend="preserve"; echo "  → spending limit exists; it will NOT be changed. pilot-chat will use it." ;;
  0) spend="absent";   echo "  → no spending limit: pilot-chat refuses every turn until one exists."
                       echo "    --set-pilot-ceiling would set enforce / 0.49 USD / 7 days (also applies to daily-brief)." ;;
  *) spend="partial";  echo "  → spending limit only partly configured: refusing to guess; fix by hand."; block=1 ;;
esac
echo "  pilot-chat currently deployed: $(t functions list 2>/dev/null | grep -qw pilot-chat && echo yes || echo no)"

if [ "$MODE" = "--check" ]; then
  [ "$block" = 0 ] && echo "CHECK OK (read-only, nothing changed)." || echo "CHECK FOUND BLOCKERS (read-only, nothing changed)."
  exit 0
fi

[ "$block" = 0 ] || { echo "refusing to deploy: resolve the blockers above"; exit 1; }
if [ "$spend" = "absent" ] && [ "$SET_CEILING" != 1 ]; then
  echo "refusing to deploy: no spending limit exists; re-run with --set-pilot-ceiling once approved"; exit 1
fi

echo "== evidence flags (pilot workspace only)"
t secrets set AGENTORY_ORION_EVIDENCE_CONTEXT=true AGENTORY_ORION_EVIDENCE_WORKSPACES=$PILOT_WS
ceiling_set=0
if [ "$spend" = "absent" ]; then
  echo "== pilot spending limit (approved via --set-pilot-ceiling)"
  t secrets set MODEL_SPEND_ENFORCEMENT=enforce MODEL_SPEND_CEILING_USD=0.49 MODEL_SPEND_PERIOD_DAYS=7
  ceiling_set=1
fi
printf 'ceiling_set=%s\nactivated_at=%s\n' "$ceiling_set" "$(date -u +%FT%TZ)" > "$STATE"

echo "== deploy pilot-chat (bundled by the Supabase API, no Docker)"
t functions deploy pilot-chat --use-api

echo "== smoke"
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "https://$REF.supabase.co/functions/v1/pilot-chat" -H 'Content-Type: application/json' -d '{}')"
echo "  POST without a token → HTTP $code (want 401)"
[ "$code" = "401" ] || { echo "WARNING: unexpected status; check the function logs before testing"; exit 1; }
echo "ORION pilot active on $REF (OpenAI-only: GPT-5.6 Luna). Evidence: pilot workspace only. Terra / hybrid routing: off."
