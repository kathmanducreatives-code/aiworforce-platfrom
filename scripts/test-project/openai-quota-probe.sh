#!/usr/bin/env bash
# ONE CAPPED ORION TURN ON TEST: does the TEST OpenAI key answer again? Run in YOUR shell.
#
#   TEST_DB_URL=… ORION_PILOT_OWNER_EMAIL=… ORION_PILOT_OWNER_PASSWORD=… \
#     scripts/test-project/openai-quota-probe.sh --confirm tlvnfrxzjhsjgdofwehb
#
# Changes nothing on TEST except one conversation, which it deletes afterwards.
# It deploys nothing, sets no secret, and never reads a secret value.
#   1. TEST only: --confirm and TEST_DB_URL must name the TEST ref; production is refused.
#   2. Secret NAMES only: OPENAI_API_KEY and the spend safeguards must exist
#      (MODEL_SPEND_ENFORCEMENT, MODEL_SPEND_CEILING_USD, MODEL_SPEND_PERIOD_DAYS,
#      AGENTORY_DELEGATION_ENABLED). Terra, routing or model-family overrides are refused.
#   3. One pilot-chat turn as the fictional pilot owner: "Reply with the single word OK."
#      About two GPT-5.6 Luna calls (understanding + answer), about $0.002 observed.
#   4. PASS only if: HTTP 200, a non-empty answer, and every model call this probe
#      made is `succeeded`, priced, GPT-5.6 Luna and together cost <= $0.01.
#   5. Deletes the probe's conversation and messages. The spend ledger is kept.
set -euo pipefail
REF=tlvnfrxzjhsjgdofwehb; PROD=ohsdatpvfdjdemstoiuj
WS=a71a0000-0000-4000-8000-0000000011a1
ANON="${ORION_PILOT_ANON_KEY:-sb_publishable_xJyW_B57hr6_SMFQbf2KPg_7-Fdyrjp}"   # TEST's public publishable key
CAP_USD=0.01
[ "${1:-}" = "--confirm" ] && [ "${2:-}" = "$REF" ] || { echo "usage: $0 --confirm $REF" >&2; exit 2; }
cd "$(dirname "$0")/../.."
db="${TEST_DB_URL:?set TEST_DB_URL}"
case "$db" in *"$PROD"*) echo "refusing: TEST_DB_URL names production" >&2; exit 2 ;; *"$REF"*) ;; *) echo "refusing: TEST_DB_URL does not name $REF" >&2; exit 2 ;; esac
command -v psql >/dev/null && command -v curl >/dev/null && command -v jq >/dev/null || { echo "refusing: psql, curl and jq are required"; exit 2; }
q() { psql -w "$db" -X -At -v ON_ERROR_STOP=1 -c "$1"; }
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"
q "select 1" >/dev/null 2>&1 || { echo "refusing: cannot authenticate to the TEST database without a password prompt."; \
  echo "  run: scripts/test-env/agentory-test-env run -- $0 --confirm $REF"; exit 3; }

echo "== 2. TEST secrets (names only)"
names="$(npm run --silent supabase:test -- secrets list 2>/dev/null | awk -F'|' 'NR>2 {gsub(/ /,"",$1); if ($1!="") print $1}')"
[ -n "$names" ] || { echo "refusing: cannot list TEST secrets (CLI login / access to $REF?)"; exit 1; }
for k in OPENAI_API_KEY MODEL_SPEND_ENFORCEMENT MODEL_SPEND_CEILING_USD MODEL_SPEND_PERIOD_DAYS AGENTORY_DELEGATION_ENABLED; do
  echo "$names" | grep -qx "$k" && echo "  $k: present" || { echo "refusing: $k missing on TEST"; exit 1; }
done
bad="$(echo "$names" | grep -E '^AGENTORY_(TERRA|HYBRID|ROUTE)_|^AGENTORY_GPT_MODEL_FAMILY$' || true)"
[ -z "$bad" ] || { echo "refusing: Terra / routing / model-family overrides on TEST:"; echo "$bad"; exit 1; }

START="$(q "select now()")"
cleanup() {
  local rc=$?; set +e
  n="$(q "select count(*) from public.conversations where workspace_id='$WS' and created_at >= '$START'")"
  q "delete from public.messages where conversation_id in (select id from public.conversations where workspace_id='$WS' and created_at >= '$START')" >/dev/null
  q "delete from public.conversations where workspace_id='$WS' and created_at >= '$START'" >/dev/null
  left="$(q "select count(*) from public.conversations where workspace_id='$WS' and created_at >= '$START'")"
  if [ "$left" = 0 ]; then echo "== 5. cleanup VERIFIED: ${n:-?} probe conversation(s) removed, 0 left"
  else echo "== 5. CLEANUP FAILED: ${left:-unknown} probe conversation(s) left"; rc=4; fi
  exit "$rc"
}
trap cleanup EXIT

echo "== 3. one ORION turn"
tok="$(curl -sS -m 30 -X POST "https://$REF.supabase.co/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d "$(jq -n --arg e "${ORION_PILOT_OWNER_EMAIL:?}" --arg p "${ORION_PILOT_OWNER_PASSWORD:?}" '{email:$e,password:$p}')" | jq -r '.access_token // empty')"
[ -n "$tok" ] || { echo "refusing: TEST sign-in failed for the pilot owner"; exit 1; }
resp="$(curl -sS -m 90 -w '\n%{http_code}' -X POST "https://$REF.supabase.co/functions/v1/pilot-chat" -H "apikey: $ANON" -H "Authorization: Bearer $tok" \
  -H "Content-Type: application/json" -d "{\"message\":\"Reply with the single word OK.\",\"workspace_id\":\"$WS\",\"client_timezone\":\"UTC\"}")"
http="$(echo "$resp" | tail -1)"; body="$(echo "$resp" | sed '$d')"
answer_len="$(echo "$body" | jq -r '(.message.content // "") | length' 2>/dev/null || echo 0)"
route="$(echo "$body" | jq -r '.message.metadata.chat_brain.route // "-"' 2>/dev/null || echo -)"
echo "  HTTP $http, route $route, answer $answer_len chars"

echo "== 4. the model calls this probe made"
q "select status || ' ' || model || ' ' || coalesce(failure_code,'-') || ' \$' || coalesce(round(coalesce(actual_cost_usd, estimated_cost_usd)::numeric,5)::text,'UNPRICED')
     from public.lead_model_calls where workspace_id='$WS' and started_at >= '$START' order by started_at" | sed 's/^/  /'
calls="$(q "select count(*) from public.lead_model_calls where workspace_id='$WS' and started_at >= '$START'")"
bad_calls="$(q "select count(*) from public.lead_model_calls where workspace_id='$WS' and started_at >= '$START'
  and (status <> 'succeeded' or coalesce(actual_cost_usd, estimated_cost_usd) is null or model <> 'gpt-5.6-luna')")"
spend="$(q "select coalesce(sum(coalesce(actual_cost_usd, estimated_cost_usd)),0) from public.lead_model_calls where workspace_id='$WS' and started_at >= '$START'")"
echo "  $calls call(s), \$$spend (cap \$$CAP_USD)"
ok=1
[ "$http" = 200 ] || { echo "  FAIL: HTTP $http"; ok=0; }
[ "$answer_len" -gt 0 ] || { echo "  FAIL: empty answer"; ok=0; }
[ "$calls" -ge 1 ] || { echo "  FAIL: no model call was recorded"; ok=0; }
[ "$bad_calls" = 0 ] || { echo "  FAIL: $bad_calls call(s) failed, unpriced or not GPT-5.6 Luna"; ok=0; }
awk -v s="$spend" -v c="$CAP_USD" 'BEGIN{exit !(s<=c)}' || { echo "  FAIL: over the \$$CAP_USD cap"; ok=0; }
[ $ok = 1 ] && echo "OPENAI PROBE PASSED" || echo "OPENAI PROBE FAILED"
[ $ok = 1 ]
