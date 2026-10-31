#!/usr/bin/env bash
# EVERY CANARY STAGE, REHEARSED LOCALLY. Nothing leaves this machine.
#
#   PG_ADMIN_URL=postgres://postgres:…@127.0.0.1:5432/postgres scripts/test-project/canary/local-rehearsal.sh
#
# Builds a throwaway database the way the contract lane does, connected through
# a superuser role named like the isolated project's pooler user
# (postgres.tlvnfrxzjhsjgdofwehb) so the identity checks run for real; seeds the
# canary workspace; serves a stand-in Apify API (tests/infra/fixtures/fake-apify.ts)
# on localhost; then drives canary-stage.sh through verify → migrate → prepare
# (the reviewed proposal instead of the paid compile) → launch → reconcile, and
# every refusal on the way. Drops the database and the role at the end.
set -euo pipefail
admin="${PG_ADMIN_URL:?set PG_ADMIN_URL to a localhost postgres superuser URL}"
case "$admin" in postgres://*@127.0.0.1:*|postgres://*@localhost:*) ;; *) echo "refusing: localhost only" >&2; exit 2 ;; esac
root="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$root"
REF=tlvnfrxzjhsjgdofwehb
WS=40e2512f-09b6-433e-97fe-f9999a1f1897
SHA="$(git rev-parse HEAD)"
db="canary_rehearsal_$(openssl rand -hex 3)"
role="postgres.$REF"
pw="$(openssl rand -hex 16)"
hostport="${admin#*@}"; hostport="${hostport%%/*}"
url="postgres://$role:$pw@$hostport/$db"
tmp="$(mktemp -d)"
token="fake-$(openssl rand -hex 8)"
port=$((20000 + RANDOM % 20000))
server=""
cleanup() {
  [ -n "$server" ] && kill "$server" 2>/dev/null || true
  psql "$admin" -XAtq -c "drop database if exists \"$db\" with (force)" -c "drop role if exists \"$role\"" >/dev/null 2>&1 || true
  [ -n "${KEEP_REHEARSAL:-}" ] && cp -r "$tmp" "$KEEP_REHEARSAL"; rm -rf "$tmp"
}
trap cleanup EXIT

psql "$admin" -XAtq -c "create role \"$role\" login superuser password '$pw'" -c "create database \"$db\""
PGOPTIONS="-c client_min_messages=warning" tests/db-contract/bootstrap.sh "${admin%/*}/$db" > "$tmp/bootstrap.log" 2>&1 \
  || { tail -20 "$tmp/bootstrap.log"; exit 1; }
owner="$(cat /proc/sys/kernel/random/uuid)"
psql "$url" -XAtq -v ON_ERROR_STOP=1 <<SQL
insert into auth.users (id, email) values ('$owner', 'canary-owner@example.invalid');
insert into public.workspaces (id, name) values ('$WS', 'discovery-test');
insert into public.workspace_members (workspace_id, user_id, role) values ('$WS', '$owner', 'owner');
insert into public.agents (workspace_id, slug, name, role_prompt, department) values ('$WS', 'scout', 'Scout', 'x', 'research');
insert into public.workspace_credit_balances (workspace_id, balance_credits) values ('$WS', 10);
SQL
psql "$url" -XAtq -v ON_ERROR_STOP=1 -f scripts/local-supabase/01-local-cron-detach.sql > /dev/null

FAKE_APIFY_TOKEN="$token" FAKE_APIFY_RUN_LIST="$tmp/run-list.json" deno run --allow-net=127.0.0.1 --allow-env --allow-read tests/infra/fixtures/fake-apify.ts "$port" > "$tmp/apify.log" 2>&1 &
server=$!
for _ in $(seq 1 50); do curl -s "http://127.0.0.1:$port" >/dev/null 2>&1 && break; sleep 0.2; done

passed=0
run() {   # run <name> <expect 0|1> <stage> [env…]
  local name="$1" want="$2" stage="$3"; shift 3
  local out="$tmp/$name"; mkdir -p "$out"
  set +e
  env -i PATH="$PATH" HOME="$HOME" TEST_DB_URL="$url" APIFY_API_TOKEN="$token" APIFY_API_BASE="http://127.0.0.1:$port" \
    CANARY_APIFY_NET="127.0.0.1:$port" CANARY_LOCAL_REHEARSAL=1 CANARY_PRIOR_PREPARES=0 EXPECTED_SHA="$SHA" CANARY_AUDIT_DIR="$out/audit" "$@" \
    scripts/test-project/canary/canary-stage.sh "$stage" > "$out/log" 2>&1
  local code=$?
  set -e
  local got=$([ $code -eq 0 ] && echo 0 || echo 1)
  if [ "$got" = "$want" ]; then passed=$((passed + 1)); echo "ok   $name (exit $code)"
  else echo "FAIL $name: expected exit $want, got $code"; tail -25 "$out/log"; exit 1; fi
  # The token never reaches a log or an audit file.
  ! grep -rq "$token" "$out" || { echo "FAIL $name: the Apify token leaked into the output"; exit 1; }
  ! grep -rq "$pw" "$out" || { echo "FAIL $name: the database password leaked into the output"; exit 1; }
}
expect() { grep -q -- "$2" "$tmp/$1/log" || { echo "FAIL $1: missing '$2'"; tail -25 "$tmp/$1/log"; exit 1; }; }
cap() { psql "$url" -XAt -c "select pg_get_constraintdef(oid) from pg_constraint where conname = 'discovery_smoke_authorizations_provider_polls_check'"; }

# ── identity refusals, before anything else ──
run identity-prod 1 verify TEST_DB_URL="postgres://postgres.ohsdatpvfdjdemstoiuj:x@127.0.0.1:1/postgres"
expect identity-prod "names a PRODUCTION project"
run identity-other 1 migrate CANARY_APPROVAL="apply 20261029120000_smoke_read_cap_seven to $REF" TEST_DB_URL="${admin%/*}/$db"
expect identity-other "local rehearsal on 127.0.0.1, user postgres"
expect identity-other "is malformed or not the isolated project"

# ── a malformed TEST_DB_URL is named precisely, before psql — never a local-socket fallback ──
good="$url"
run url-leading-space 1 verify APIFY_USERNAME=canaryaccount TEST_DB_URL=" $good"
expect url-leading-space "remove 1 leading and 0 trailing whitespace"
run url-quoted 1 verify APIFY_USERNAME=canaryaccount TEST_DB_URL="\"$good\""
expect url-quoted "remove the quotes"
run url-psql-pasted 1 verify APIFY_USERNAME=canaryaccount TEST_DB_URL="psql $good"
expect url-psql-pasted "a pasted psql command"
run url-jdbc 1 verify APIFY_USERNAME=canaryaccount TEST_DB_URL="jdbc:$good"
expect url-jdbc "a jdbc: prefix"
run url-placeholder 1 verify APIFY_USERNAME=canaryaccount TEST_DB_URL="postgresql://postgres.$REF:[YOUR-PASSWORD]@127.0.0.1:5432/postgres"
expect url-placeholder "placeholder"
for n in url-leading-space url-quoted url-psql-pasted url-jdbc url-placeholder; do
  ! grep -q "s.PGSQL" "$tmp/$n/log" || { echo "FAIL $n: psql fell back to a local socket"; exit 1; }
  expect "$n" "PASS  apify"   # the free Apify checks still ran
done

# ── verify without the database secret: the free Apify checks still run, then it stops ──
run verify-no-db 1 verify APIFY_USERNAME=canaryaccount TEST_DB_URL=
expect verify-no-db "PASS  apify"
expect verify-no-db "TEST_DB_URL is not set"
run migrate-no-db 1 migrate CANARY_APPROVAL="apply 20261029120000_smoke_read_cap_seven to $REF" TEST_DB_URL=

# ── verify: read-only, cap 5 reported; no expected username → REVIEW → verify fails, but runs every check ──
run verify-no-username 1 verify
expect verify-no-username "REVIEW"
expect verify-no-username "PASS  preflight"
expect verify-no-username "INFO  read cap now: 5"
expect verify-no-username "PASS  kickoff valid"
! grep -q canaryaccount "$tmp/verify-no-username/log" || { echo "FAIL: the username must be masked"; exit 1; }
run verify 0 verify APIFY_USERNAME=canaryaccount
expect verify "PASS  apify"
expect verify "PASS  no conflicting work"
expect verify "PASS  budget"
expect verify "INFO  B6 LIMITATION"
expect verify "PASS  permissions"
expect verify "this verify session is read-only"
expect verify "INFO   account hard limit"

# ── migrate ──
run migrate-no-approval 1 migrate CANARY_APPROVAL="yes"
[[ "$(cap)" == *"<= 5)"* ]] || { echo "FAIL: migrated without approval"; exit 1; }
run migrate 0 migrate CANARY_APPROVAL="apply 20261029120000_smoke_read_cap_seven to $REF"
expect migrate "PASS  applied"
[[ "$(cap)" == *"<= 7)"* ]] || { echo "FAIL: the cap is not 7"; exit 1; }
run migrate-again 1 migrate CANARY_APPROVAL="apply 20261029120000_smoke_read_cap_seven to $REF"
expect migrate-again "already applied"

# ── prepare (the reviewed proposal stands in for the paid compile) ──
run prepare-no-approval 1 prepare APIFY_USERNAME=canaryaccount CANARY_APPROVER="rehearsal" CANARY_APPROVAL="go"
run prepare-wrong-account 1 prepare APIFY_USERNAME=oldaccount CANARY_APPROVER="rehearsal" \
  CANARY_APPROVAL="compile canary kickoff at $SHA" CANARY_OFFLINE_PROPOSAL=docs/launch/proposals/canary-funding-reviewed-mission-proposal.json
expect prepare-wrong-account "FAIL  apify"
run prepare 0 prepare APIFY_USERNAME=canaryaccount CANARY_APPROVER="rehearsal operator" \
  CANARY_APPROVAL="compile canary kickoff at $SHA" CANARY_OFFLINE_PROPOSAL=docs/launch/proposals/canary-funding-reviewed-mission-proposal.json
expect prepare "KICKOFF READY (not executed)"
kick="$tmp/prepare/audit/kickoff"
ksha="$(cat "$tmp/prepare/audit/kickoff.sha256")"
[ "$(psql "$url" -XAt -c "select count(*) from public.lead_mission_queue")" = "0" ] || { echo "FAIL: prepare wrote to the queue"; exit 1; }

# ── launch ──
run launch-wrong-phrase 1 launch APIFY_USERNAME=canaryaccount KICKOFF_DIR="$kick" KICKOFF_SHA256="$ksha" CANARY_APPROVAL="launch"
cp -r "$kick" "$tmp/tampered"; sed -i 's/"apify:atomus~linkedin-company-scraper":1/"apify:atomus~linkedin-company-scraper":2/' "$tmp/tampered/kickoff.sql"
run launch-tampered 1 launch APIFY_USERNAME=canaryaccount KICKOFF_DIR="$tmp/tampered" KICKOFF_SHA256="$ksha" CANARY_APPROVAL="launch canary $ksha on $REF with a software-enforced \$3 budget"
expect launch-tampered "not the approved file"
[ "$(psql "$url" -XAt -c "select count(*) from public.lead_mission_queue")" = "0" ] || { echo "FAIL: a refused launch wrote"; exit 1; }
run launch 0 launch APIFY_USERNAME=canaryaccount KICKOFF_DIR="$kick" KICKOFF_SHA256="$ksha" CANARY_APPROVAL="launch canary $ksha on $REF with a software-enforced \$3 budget"
expect launch "PASS  queue:"
run launch-again 1 launch APIFY_USERNAME=canaryaccount KICKOFF_DIR="$kick" KICKOFF_SHA256="$ksha" CANARY_APPROVAL="launch canary $ksha on $REF with a software-enforced \$3 budget"
expect launch-again "conflicting work"

run launch-old-phrase 1 launch APIFY_USERNAME=canaryaccount KICKOFF_DIR="$kick" KICKOFF_SHA256="$ksha" CANARY_APPROVAL="launch canary $ksha on $REF"
expect launch-old-phrase "software-enforced"

# ── reconcile (as after a run: the mission ended, its authorization stopped) ──
qid="$(cat "$tmp/launch/audit/queue_id")"
psql "$url" -XAtq -c "update public.lead_mission_queue set status = 'complete' where id = '$qid'" \
  -c "select public.stop_discovery_smoke('$qid', 'rehearsal: the mission is over')" > /dev/null
run reconcile 0 reconcile
expect reconcile "PASS  post-run checks C01–C10"
expect reconcile "reconciliation SQL generated for review (not executed)"

# ── the $3 canary budget: an attempt that already spent $2.95 leaves too little for another ──
auth="$(psql "$url" -XAt -c "select id from public.discovery_smoke_authorizations where queue_id = '$qid'")"
psql "$url" -XAtq -v ON_ERROR_STOP=1 -c "insert into public.discovery_smoke_operations
    (authorization_id, operation_key, task_id, generation, kind, actor, template_id, payload_hash, committed_microusd)
  values ('$auth', 'rehearsal-spent', gen_random_uuid(), 1, 'model', 'openai:gpt-5.6-luna', 'model', repeat('a', 64), 2950000)" > /dev/null
run verify-budget-spent 1 verify APIFY_USERNAME=canaryaccount
expect verify-budget-spent "FAIL  B4"
expect verify-budget-spent "INFO  B6"
run prepare-budget-spent 1 prepare APIFY_USERNAME=canaryaccount CANARY_APPROVER="rehearsal operator" \
  CANARY_APPROVAL="compile canary kickoff at $SHA" CANARY_OFFLINE_PROPOSAL=docs/launch/proposals/canary-funding-reviewed-mission-proposal.json
expect prepare-budget-spent "FAIL  B4"
psql "$url" -XAtq -c "delete from public.discovery_smoke_operations where operation_key = 'rehearsal-spent'" > /dev/null

# ── unlaunched compiles count: an unknown count refuses; 117 earlier prepares exhaust the $3 ──
run budget-unknown-prepares 1 verify APIFY_USERNAME=canaryaccount CANARY_PRIOR_PREPARES=
expect budget-unknown-prepares "could not count earlier prepare runs"
run budget-many-prepares 1 prepare APIFY_USERNAME=canaryaccount CANARY_APPROVER="rehearsal operator" CANARY_PRIOR_PREPARES=117 \
  CANARY_APPROVAL="compile canary kickoff at $SHA" CANARY_OFFLINE_PROPOSAL=docs/launch/proposals/canary-funding-reviewed-mission-proposal.json
expect budget-many-prepares "117 earlier prepare compile"
expect budget-many-prepares "FAIL  B4"

# ══ FAST CANARY MODE: one approved contract, end to end ══════════════════════
# Local-rehearsal overrides are refused outright under GitHub Actions.
run override-under-actions 1 verify GITHUB_ACTIONS=true CANARY_OFFLINE_PROPOSAL=docs/launch/proposals/canary-funding-reviewed-mission-proposal.json
expect override-under-actions "is a local-rehearsal override and is refused in GitHub Actions"
C="$tmp/contracts"; mkdir -p "$C"
# The session variants are built on CONTRACT 3 (the next contract to run): the
# consumed Contract 2 no longer passes A10/A11 — its limits could not finish the
# pool it bought. Override with REHEARSAL_CONTRACT for another proposal.
BASE_CONTRACT="${REHEARSAL_CONTRACT:-docs/launch/proposals/canary-session-contract-3.json}"
mkc() { jq "$2" "$BASE_CONTRACT" > "$C/$1.json"; sha256sum "$C/$1.json" | cut -d' ' -f1; }
sess() {   # sess <name> <expect> <contract> [env…]
  local name="$1" want="$2" file="$C/$3.json"; shift 3
  local h; h="$(sha256sum "$file" | cut -d' ' -f1)"
  run "$name" "$want" session APIFY_USERNAME=canaryaccount CANARY_APPROVER="rehearsal operator" CANARY_SESSION_CONTRACT="$file" \
    CANARY_APPROVAL="run canary session $h at $SHA" CANARY_OFFLINE_PROPOSAL=docs/launch/proposals/canary-funding-reviewed-mission-proposal.json "$@"
}
mkc fresh '.id = "rehearsal-1"' > /dev/null
mkc expired '.id = "rehearsal-expired" | .expires_at = "2026-01-01T00:00:00Z"' > /dev/null
mkc manual '.id = "rehearsal-manual" | .auto_execute = false' > /dev/null
mkc narrow '.id = "rehearsal-narrow" | del(.actors["apify:atomus~linkedin-company-scraper"]) | .spending.max_provider_microusd = (.spending.max_provider_microusd - 3550) | .spending.max_session_microusd = (.spending.max_session_microusd - 3550)' > /dev/null
mkc wide '.id = "rehearsal-wide" | .actors["apify:atomus~linkedin-company-scraper"].max_starts = 2' > /dev/null
mkc pvalyou '.id = "rehearsal-pvalyou" | .actors["apify:pvalyou~company-record"] = {"max_starts":1,"max_units":1,"unit":"company","max_microusd":40050}' > /dev/null

run session-wrong-phrase 1 session APIFY_USERNAME=canaryaccount CANARY_APPROVER=x CANARY_SESSION_CONTRACT="$C/fresh.json" CANARY_APPROVAL="run canary session"
expect session-wrong-phrase "approval phrase does not match"
sess session-expired 1 expired
expect session-expired "FAIL  A03 not expired"
sess session-wider-than-caps 1 wide
expect session-wider-than-caps "FAIL  A05"
sess session-unapproved-actor 1 pvalyou
expect session-unapproved-actor "FAIL  A05"
sess session-plan-outside-contract 1 narrow
expect session-plan-outside-contract "FAIL  S06"
expect session-plan-outside-contract "OUTSIDE the contract"
sess session-history-unreadable 1 fresh CANARY_PRIOR_PREPARES=
expect session-history-unreadable "could not count earlier prepare runs"
[ "$(psql "$url" -XAt -c "select count(*) from public.lead_mission_queue where status = 'queued'")" = "0" ] || { echo "FAIL: a refused session wrote"; exit 1; }
sess session-manual 0 manual
expect session-manual "KICKOFF READY (not executed: the contract does not authorize automatic execution)"
[ "$(psql "$url" -XAt -c "select count(*) from public.lead_mission_queue where status = 'queued'")" = "0" ] || { echo "FAIL: a manual contract executed"; exit 1; }

sess session 0 fresh
expect session "PASS  the generated plan satisfies the contract exactly"
expect session "PASS  queue:"
expect session "READY FOR THE WORKER"
squeue="$(cat "$tmp/session/audit/queue_id")"
# Interrupted: the worker never ran. The kickoff is single-use and blocks any other paid start.
sess session-duplicate 1 fresh
expect session-duplicate "has already been used"
mkc fresh2 '.id = "rehearsal-2"' > /dev/null
sess session-while-interrupted 1 fresh2
expect session-while-interrupted "conflicting work"

# Partially completed: two purchases, one Apify reports, one with no run id (uncertain).
sauth="$(psql "$url" -XAt -c "select id from public.discovery_smoke_authorizations where queue_id = '$squeue'")"
psql "$url" -XAtq -v ON_ERROR_STOP=1 -c "update public.lead_mission_queue set status = 'complete' where id = '$squeue'" \
  -c "insert into public.discovery_smoke_operations (authorization_id, operation_key, task_id, generation, kind, actor, template_id, payload_hash, committed_microusd, provider_run_id)
      values ('$sauth', 'rehearsal-jobs', gen_random_uuid(), 1, 'provider', 'apify:harvestapi~linkedin-job-search', 'jobs', repeat('b', 64), 2000, 'run-jobs-c3'),
             ('$sauth', 'rehearsal-uncertain', gen_random_uuid(), 1, 'provider', 'apify:harvestapi~linkedin-company', 'details', repeat('c', 64), 4050, null),
             ('$sauth', 'rehearsal-over', gen_random_uuid(), 1, 'provider', 'apify:atomus~linkedin-company-scraper', 'atomus', repeat('d', 64), 10550, 'run-over'),
             ('$sauth', 'rehearsal-wrong', gen_random_uuid(), 1, 'provider', 'apify:harvestapi~linkedin-company', 'details', repeat('e', 64), 4050, 'run-wrong')" > /dev/null
run session-close-partial 1 session-close CANARY_QUEUE_ID="$squeue"
expect session-close-partial "authorization stopped"
expect session-close-partial "RECONCILED run run-jobs-c3: SUCCEEDED"
expect session-close-partial "run run-over (apify:atomus~linkedin-company-scraper): not reconciled automatically"
expect session-close-partial "run run-wrong (apify:harvestapi~linkedin-company): not reconciled automatically"
expect session-close-partial "3 provider purchase(s) UNCERTAIN or over their cap"
expect session-close-partial "provider charged (Apify receipts)"
# The uncertain purchase blocks every later paid operation, a new contract included.
sess session-after-uncertain 1 fresh2
expect session-after-uncertain "unreconciled purchase"
[ "$(psql "$url" -XAt -c "select count(*) from public.discovery_smoke_reconciliations r join public.discovery_smoke_authorizations a on a.id = r.authorization_id where a.queue_id = '$squeue'")" = "1" ] \
  || { echo "FAIL: exactly one purchase must be reconciled"; exit 1; }
# The administrator records what Apify reports. A run WITHOUT a run id that Apify
# has no record of is NO_RUN; the others at Apify's own figures — never at the cap.
psql "$url" -XAtq -c "select public.reconcile_discovery_smoke_operation('$squeue', 'rehearsal-uncertain', 0, 'rehearsal: Apify shows no run', 'NO_RUN')" \
  -c "select public.reconcile_discovery_smoke_operation('$squeue', 'rehearsal-wrong', 1000, 'rehearsal: Apify run-wrong, reviewed', 'SUCCEEDED')" \
  -c "select public.reconcile_discovery_smoke_operation('$squeue', 'rehearsal-over', 20000, 'rehearsal: Apify run-over at its own figure', 'SUCCEEDED')" > /dev/null
# Recorded truthfully above its maximum, the over-cap purchase STAYS open liability:
# the approved bound was wrong, and no new paid operation may start on top of it.
sess session-after-over-cap 1 fresh2
expect session-after-over-cap "unreconciled purchase"
# THROWAWAY DATABASE ONLY, not an operator procedure: the rehearsal removes its
# own synthetic purchases to go on. On the real project an over-cap purchase is
# resolved by the database owner reviewing the catalog, never by entering a lower figure.
psql "$url" -XAtq -c "delete from public.discovery_smoke_reconciliations where operation_key like 'rehearsal-%'" \
  -c "delete from public.discovery_smoke_operations where operation_key like 'rehearsal-%'" > /dev/null
sess session-second-contract 0 fresh2
expect session-second-contract "READY FOR THE WORKER"
s2="$(cat "$tmp/session-second-contract/audit/queue_id")"
psql "$url" -XAtq -c "update public.lead_mission_queue set status = 'complete' where id = '$s2'" > /dev/null
run session-close-clean 0 session-close CANARY_QUEUE_ID="$s2"
expect session-close-clean "every provider purchase reconciled"

# ══ A START APIFY REFUSED (run 41038537870: HTTP 403) → NO_RUN, ONLY ON TWO RECORDS ══
# Each purchase below has no run id. NO_RUN needs BOTH the worker's ledger
# showing exactly one refused start (400–403, no run) AND Apify's complete run
# list showing no run in the window. Every other shape stays open.
nr_purchase() {   # nr_purchase <key> <actor> <template> <committed> [admitted at, default 10 minutes ago] → task id
  local t; t="$(cat /proc/sys/kernel/random/uuid)"
  psql "$url" -XAtq -v ON_ERROR_STOP=1 -c "insert into public.discovery_smoke_operations (authorization_id, operation_key, task_id, generation, kind, actor, template_id, payload_hash, committed_microusd, admitted_at)
    values ('$s2auth', '$1', '$t', 1, 'provider', '$2', '$3', encode(sha256(convert_to('$1', 'utf8')), 'hex'), $4, ${5:-now() - interval '10 minutes'})" > /dev/null
  echo "$t"
}
nr_ledger() {     # nr_ledger <task> <capability> <status> <metadata json> [started at, default 10 minutes ago]
  psql "$url" -XAtq -v ON_ERROR_STOP=1 -c "insert into public.lead_execution_calls (workspace_id, task_id, stage, reason, provider_id, logical_call_key, status, provider_run_id, metadata, started_at)
    values ('$WS', '$1', 'discovery', 'canary', 'apify', '$1:$2:' || gen_random_uuid(), '$3', null, '$4'::jsonb, ${5:-now() - interval '10 minutes'})" > /dev/null
}
s2auth="$(psql "$url" -XAt -c "select id from public.discovery_smoke_authorizations where queue_id = '$s2'")"
t1="$(nr_purchase nr-refused apify:harvestapi~linkedin-job-search jobs 4000)"
nr_ledger "$t1" apify_linkedin_job_search failed '{"status":403,"start_refused":true,"vendor_error_type":"insufficient-permissions"}'
t2="$(nr_purchase nr-run-exists apify:harvestapi~linkedin-company details 4050)"
nr_ledger "$t2" apify_linkedin_company_details failed '{"status":403,"start_refused":true}'
t3="$(nr_purchase nr-ambiguous apify:atomus~linkedin-company-scraper atomus 10550)"
nr_ledger "$t3" apify_funding_atomus failed '{"status":0}'
nr_purchase nr-no-ledger apify:harvestapi~linkedin-job-search jobs 4000 > /dev/null
# A 403 without the start_refused flag, written after the flag existed: not proof of a refused START.
t4="$(nr_purchase nr-unflagged apify:atomus~linkedin-company-scraper atomus 10550)"
nr_ledger "$t4" apify_funding_atomus failed '{"status":403}'
# The first live session's shape: a 403 row from before the flag existed (named as LEGACY).
t5="$(nr_purchase nr-legacy apify:harvestapi~linkedin-company details 4050 "'2026-10-30T10:20:28.879Z'")"
nr_ledger "$t5" apify_linkedin_company_details failed '{"status":403}' "'2026-10-30T10:20:27.962Z'"
# Admitted just now: the window has not settled, so the listing is never complete.
t6="$(nr_purchase nr-unsettled apify:harvestapi~linkedin-job-search jobs 4000 "now()")"
nr_ledger "$t6" apify_linkedin_job_search failed '{"status":403,"start_refused":true}' "now()"
ago="$(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%S.000Z)"
# Apify lists a run for the company-details actor inside the window (the 403 was not the whole story).
printf '{"harvestapi~linkedin-company":[{"id":"run-surprise","startedAt":"%s","status":"SUCCEEDED"}]}\n' "$ago" > "$tmp/run-list.json"
# Bound to the account that made the start: another account's empty list proves nothing.
run evidence-other-account 0 evidence APIFY_USERNAME=oldaccount
expect evidence-other-account "INCOMPLETE: not the expected account"
! grep -q "^NO_RUN\|PROPOSED" "$tmp/evidence-other-account/log" || { echo "FAIL evidence-other-account: proposed a NO_RUN"; exit 1; }
run evidence-no-username 1 evidence
expect evidence-no-username "evidence needs apify_username"
# Read-only: proposes, writes nothing.
run evidence 0 evidence APIFY_USERNAME=canaryaccount
expect evidence "this evidence session is read-only"
expect evidence "evidence account: username"
expect evidence "OPEN  apify:atomus~linkedin-company-scraper (nr-unflagged)"
expect evidence "flagged 'no'"
expect evidence "NO_RUN  apify:harvestapi~linkedin-company (nr-legacy)"
expect evidence "LEGACY row: no start_refused flag"
expect evidence "OPEN  apify:harvestapi~linkedin-job-search (nr-unsettled)"
expect evidence "the window has not settled"
expect evidence "NO_RUN  apify:harvestapi~linkedin-job-search (nr-refused): ledger: 1 refused start, HTTP 403"
expect evidence "OPEN  apify:harvestapi~linkedin-company (nr-run-exists)"
expect evidence "runs in window 1"
expect evidence "OPEN  apify:atomus~linkedin-company-scraper (nr-ambiguous)"
expect evidence "HTTP '0'"
expect evidence "OPEN  apify:harvestapi~linkedin-job-search (nr-no-ledger)"
expect evidence "ledger rows 0"
expect evidence "PROPOSED (not executed):"
expect evidence "select public.reconcile_discovery_smoke_operation('$s2', 'nr-refused', 0, 'Apify run list for harvestapi~linkedin-job-search"
expect evidence "permission level LIMITED_PERMISSIONS"
[ "$(grep -c "reconcile_discovery_smoke_operation" "$tmp/evidence/audit/no-run.sql")" = "2" ] || { echo "FAIL evidence: exactly two NO_RUN proposals"; exit 1; }
[ "$(psql "$url" -XAt -c "select count(*) from public.discovery_smoke_reconciliations where operation_key like 'nr-%'")" = "0" ] \
  || { echo "FAIL evidence: the read-only stage wrote a reconciliation"; exit 1; }
# session-close applies only the NO_RUN that both records support.
run session-close-no-run 1 session-close CANARY_QUEUE_ID="$s2" APIFY_USERNAME=canaryaccount
expect session-close-no-run "RECONCILED apify:harvestapi~linkedin-job-search as NO_RUN"
expect session-close-no-run "OPEN  apify:harvestapi~linkedin-company"
expect session-close-no-run "RECONCILED apify:harvestapi~linkedin-company as NO_RUN"
expect session-close-no-run "5 provider purchase(s) UNCERTAIN or over their cap"
[ "$(psql "$url" -XAt -c "select string_agg(operation_key || '=' || vendor_status || '/' || vendor_microusd, ',' order by operation_key) from public.discovery_smoke_reconciliations where operation_key like 'nr-%'")" = "nr-legacy=NO_RUN/0,nr-refused=NO_RUN/0" ] \
  || { echo "FAIL session-close-no-run: only nr-refused and nr-legacy may be reconciled, as NO_RUN at 0"; exit 1; }
# An incomplete Apify listing (more than 20 pages of newer runs) is not proof of absence.
psql "$url" -XAtq -c "delete from public.discovery_smoke_reconciliations where operation_key = 'nr-refused'" > /dev/null
jq -n '{"harvestapi~linkedin-job-search": [range(0; 2001) | {id: "r\(.)", startedAt: "2099-01-01T00:00:00.000Z", status: "SUCCEEDED"}]}' > "$tmp/run-list.json"
run evidence-incomplete-listing 0 evidence APIFY_USERNAME=canaryaccount
expect evidence-incomplete-listing "listing INCOMPLETE"
expect evidence-incomplete-listing "OPEN  apify:harvestapi~linkedin-job-search (nr-refused)"
psql "$url" -XAtq -c "delete from public.discovery_smoke_operations where operation_key like 'nr-%'" \
  -c "delete from public.lead_execution_calls where task_id in ('$t1', '$t2', '$t3', '$t4', '$t5', '$t6')" > /dev/null
rm -f "$tmp/run-list.json"

# ── a price above the approved maximum blocks every paid stage ──
kill "$server"; FAKE_APIFY_TOKEN="$token" FAKE_APIFY_PRICE_BUMP=0.0001 deno run --allow-net=127.0.0.1 --allow-env --allow-read tests/infra/fixtures/fake-apify.ts "$port" > "$tmp/apify2.log" 2>&1 &
server=$!
for _ in $(seq 1 50); do curl -s "http://127.0.0.1:$port" >/dev/null 2>&1 && break; sleep 0.2; done
run verify-overpriced 1 verify APIFY_USERNAME=canaryaccount
expect verify-overpriced "FAIL   jobs price"

echo "local rehearsal: $passed stage runs as expected; no secret in any output"
