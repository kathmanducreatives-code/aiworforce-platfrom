#!/usr/bin/env bash
# R1.1 LIVE TEST VALIDATION ON TEST — ONE COMMAND, in YOUR shell. Never touches production.
#
#   TEST_DB_URL=postgres://…tlvnfrxzjhsjgdofwehb… \
#   ORION_PILOT_OWNER_EMAIL=… ORION_PILOT_OWNER_PASSWORD=… \
#   ORION_PILOT_OUTSIDER_EMAIL=… ORION_PILOT_OUTSIDER_PASSWORD=… \
#   scripts/test-project/r11-test-run.sh --confirm tlvnfrxzjhsjgdofwehb
#   (ORION_PILOT_OWNER_JWT / ORION_PILOT_OUTSIDER_JWT work instead of email + password.)
#
# Steps (any failure stops; cleanup of THIS run's records still happens):
#   1. TEST only: refs checked; the Supabase wrapper verifies TEST; TEST_DB_URL must name TEST.
#   2. secret NAMES: OPENAI key, evidence flag and spend ceiling must exist; Terra/routing
#      overrides refused. AGENTORY_DELEGATION_ENABLED is SET TO false if absent (TEST only).
#   3. snapshot of every table that outreach, scraping, enrichment, missions or drafts write.
#   4. seed the fictional R1.1 records (orion-r11-seed.sql).
#   5. deploy pilot-chat to TEST (bundled, secrets unchanged) and check its build = HEAD.
#   6. the 20-prompt live run + isolation probe (scripts/orion-pilot/run-r11.ts). No retries.
#   7. after-snapshot: content / tasks / drafts / approvals / missions / provider calls must be
#      unchanged; model spend for the run is summed from the ledger and must be ≤ $0.30.
#   8. cleanup: only this run's conversations + messages and the seeded records (counts shown
#      first). The model-call ledger is kept (it is the spend record).
set -euo pipefail
REF=tlvnfrxzjhsjgdofwehb
PROD=ohsdatpvfdjdemstoiuj
WS=a71a0000-0000-4000-8000-0000000011a1
ANON_DEFAULT=sb_publishable_xJyW_B57hr6_SMFQbf2KPg_7-Fdyrjp   # TEST's public publishable key
BUDGET_USD=0.30
[ "${1:-}" = "--confirm" ] && [ "${2:-}" = "$REF" ] || { echo "usage: $0 --confirm $REF" >&2; exit 2; }
cd "$(dirname "$0")/../.."
db="${TEST_DB_URL:?set TEST_DB_URL to the TEST database URL}"
case "$db" in *"$PROD"*) echo "refusing: TEST_DB_URL names production" >&2; exit 2 ;; *"$REF"*) ;; *) echo "refusing: TEST_DB_URL does not name $REF" >&2; exit 2 ;; esac
command -v psql >/dev/null && command -v deno >/dev/null || { echo "refusing: psql and deno are required"; exit 2; }
t() { npm run --silent supabase:test -- "$@"; }
q() { psql "$db" -X -At -v ON_ERROR_STOP=1 -c "$1"; }
[ "$(q "select count(*) from public.workspaces where id='$WS'")" = 1 ] || { echo "refusing: the fictional ORION pilot workspace is not on this database"; exit 1; }

echo "== 2. TEST secrets (names only)"
names="$(t secrets list 2>/dev/null | awk -F'|' 'NR>2 {gsub(/ /,"",$1); if ($1!="") print $1}')"
[ -n "$names" ] || { echo "refusing: cannot list TEST secrets (CLI login / access to $REF?)"; exit 1; }
has() { echo "$names" | grep -qx "$1"; }
for k in OPENAI_API_KEY AGENTORY_ORION_EVIDENCE_CONTEXT MODEL_SPEND_ENFORCEMENT MODEL_SPEND_CEILING_USD MODEL_SPEND_PERIOD_DAYS; do
  has "$k" && echo "  $k: present" || { echo "refusing: $k missing on TEST (scripts/test-project/orion-pilot-activate.sh sets the ORION pilot flags)"; exit 1; }
done
bad="$(echo "$names" | grep -E '^AGENTORY_(TERRA|HYBRID|ROUTE)_|^AGENTORY_GPT_MODEL_FAMILY$' || true)"
[ -z "$bad" ] || { echo "refusing: Terra / routing overrides on TEST:"; echo "$bad"; exit 1; }
if has AGENTORY_DELEGATION_ENABLED; then echo "  AGENTORY_DELEGATION_ENABLED: present (value not readable — this run FAILS if any draft is delegated)"
else echo "  AGENTORY_DELEGATION_ENABLED: absent → setting it to false on TEST"; t secrets set AGENTORY_DELEGATION_ENABLED=false >/dev/null; fi

START="$(q "select now()")"
snap() { q "select concat_ws(' ',
  (select count(*) from public.content_item where workspace_id='$WS'),
  (select count(*) from public.tasks where workspace_id='$WS'),
  (select count(*) from public.outreach_drafts where workspace_id='$WS'),
  (select count(*) from public.approvals where workspace_id='$WS'),
  (select count(*) from public.saved_outputs where workspace_id='$WS'),
  (select count(*) from public.lead_mission_queue where workspace_id='$WS'),
  (select count(*) from public.provider_usage_ledger where workspace_id='$WS'),
  (select count(*) from public.lead_candidates where workspace_id='$WS'))"; }
LABELS="content_item tasks outreach_drafts approvals saved_outputs lead_mission_queue provider_usage_ledger lead_candidates"
echo "== 3. snapshot ($LABELS)"; before="$(snap)"; echo "  $before"

cleanup() {
  echo "== 8. cleanup (this run only)"
  conv="$(q "select count(*) from public.conversations where workspace_id='$WS' and created_at >= '$START'")"
  echo "  conversations created by this run: $conv (their messages go with them); seeded records: orion-r11-cleanup.sql"
  q "delete from public.messages where conversation_id in (select id from public.conversations where workspace_id='$WS' and created_at >= '$START')" >/dev/null
  q "delete from public.conversations where workspace_id='$WS' and created_at >= '$START'" >/dev/null
  psql "$db" -X -q -v ON_ERROR_STOP=1 --single-transaction -f scripts/test-project/orion-r11-cleanup.sql | tail -1
}
trap cleanup EXIT

echo "== 4. seed"
if [ "$(q "select count(*) from public.accounts where id::text like 'a71a1100-%'")" = 0 ]; then
  psql "$db" -X -q -v ON_ERROR_STOP=1 --single-transaction -f scripts/test-project/orion-r11-seed.sql | tail -1
else echo "  already present (left from an earlier run; cleanup removes it)"; fi

echo "== 5. deploy pilot-chat to TEST"
scripts/test-project/orion-pilot-deploy.sh --confirm "$REF" --skip-preflight | tail -3
head="$(git rev-parse HEAD)"
build="$(curl -sS -m 20 -X OPTIONS -D - -o /dev/null "https://$REF.supabase.co/functions/v1/pilot-chat" -H "Origin: https://x.example" -H "Access-Control-Request-Method: POST" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-agentory-build"{print $2}' | cut -d@ -f1)"
echo "  TEST pilot-chat build = ${build:-none} (HEAD $head)"
[ "${build%-dirty}" = "$head" ] || { echo "refusing: TEST is not serving this checkout's build"; exit 1; }

echo "== 6. live run"
rc=0
ORION_R11_APPROVED="I approve the ORION R1.1 TEST run on $REF" ORION_PILOT_SUPABASE_URL="https://$REF.supabase.co" \
ORION_PILOT_ANON_KEY="${ORION_PILOT_ANON_KEY:-$ANON_DEFAULT}" \
  deno run --allow-env --allow-net --allow-read --allow-write=. scripts/orion-pilot/run-r11.ts || rc=$?

echo "== 7. nothing executed, nothing created, spend"
after="$(snap)"; echo "  before: $before"; echo "  after:  $after"
[ "$after" = "$before" ] && echo "  ok: no content, task, draft, approval, mission, provider call or lead was created" \
  || { echo "  FAIL: a row was created in: $LABELS"; rc=1; }
spend="$(q "select coalesce(round(sum(coalesce(actual_cost_usd, estimated_cost_usd))::numeric, 4), 0) from public.lead_model_calls where workspace_id='$WS' and started_at >= '$START'")"
calls="$(q "select count(*) from public.lead_model_calls where workspace_id='$WS' and started_at >= '$START'")"
models="$(q "select coalesce(string_agg(distinct model, ', '), 'none') from public.lead_model_calls where workspace_id='$WS' and started_at >= '$START'")"
echo "  model spend this run: \$$spend over $calls calls ($models); budget \$$BUDGET_USD"
awk -v s="$spend" -v b="$BUDGET_USD" 'BEGIN{exit !(s<=b)}' || { echo "  FAIL: over budget"; rc=1; }
echo "$models" | grep -qiE 'claude|anthropic' && { echo "  FAIL: a non-OpenAI model answered ORION"; rc=1; }
[ "$rc" = 0 ] && echo "R1.1 TEST VALIDATION PASSED (transcript: r11-transcript.json)" || echo "R1.1 TEST VALIDATION FAILED — send me r11-transcript.json and this output"
exit $rc
