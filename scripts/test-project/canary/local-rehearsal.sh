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
  rm -rf "$tmp"
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

FAKE_APIFY_TOKEN="$token" deno run --allow-net=127.0.0.1 --allow-env tests/infra/fixtures/fake-apify.ts "$port" > "$tmp/apify.log" 2>&1 &
server=$!
for _ in $(seq 1 50); do curl -s "http://127.0.0.1:$port" >/dev/null 2>&1 && break; sleep 0.2; done

passed=0
run() {   # run <name> <expect 0|1> <stage> [env…]
  local name="$1" want="$2" stage="$3"; shift 3
  local out="$tmp/$name"; mkdir -p "$out"
  set +e
  env -i PATH="$PATH" HOME="$HOME" TEST_DB_URL="$url" APIFY_API_TOKEN="$token" APIFY_API_BASE="http://127.0.0.1:$port" \
    CANARY_APIFY_NET="127.0.0.1:$port" EXPECTED_SHA="$SHA" CANARY_AUDIT_DIR="$out/audit" "$@" \
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
expect identity-prod "names a production project"
run identity-other 1 migrate CANARY_APPROVAL="apply 20261029120000_smoke_read_cap_seven to $REF" TEST_DB_URL="${admin%/*}/$db"
expect identity-other "does not name the canary project"

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
run launch-tampered 1 launch APIFY_USERNAME=canaryaccount KICKOFF_DIR="$tmp/tampered" KICKOFF_SHA256="$ksha" CANARY_APPROVAL="launch canary $ksha on $REF"
expect launch-tampered "not the approved file"
[ "$(psql "$url" -XAt -c "select count(*) from public.lead_mission_queue")" = "0" ] || { echo "FAIL: a refused launch wrote"; exit 1; }
run launch 0 launch APIFY_USERNAME=canaryaccount KICKOFF_DIR="$kick" KICKOFF_SHA256="$ksha" CANARY_APPROVAL="launch canary $ksha on $REF"
expect launch "PASS  queue:"
run launch-again 1 launch APIFY_USERNAME=canaryaccount KICKOFF_DIR="$kick" KICKOFF_SHA256="$ksha" CANARY_APPROVAL="launch canary $ksha on $REF"
expect launch-again "conflicting work"

# ── reconcile (as after a run: the mission ended, its authorization stopped) ──
qid="$(cat "$tmp/launch/audit/queue_id")"
psql "$url" -XAtq -c "update public.lead_mission_queue set status = 'complete' where id = '$qid'" \
  -c "select public.stop_discovery_smoke('$qid', 'rehearsal: the mission is over')" > /dev/null
run reconcile 0 reconcile
expect reconcile "PASS  post-run checks C01–C10"
expect reconcile "reconciliation SQL generated for review (not executed)"

# ── a price above the approved maximum blocks every paid stage ──
kill "$server"; FAKE_APIFY_TOKEN="$token" FAKE_APIFY_PRICE_BUMP=0.0001 deno run --allow-net=127.0.0.1 --allow-env tests/infra/fixtures/fake-apify.ts "$port" > "$tmp/apify2.log" 2>&1 &
server=$!
for _ in $(seq 1 50); do curl -s "http://127.0.0.1:$port" >/dev/null 2>&1 && break; sleep 0.2; done
run verify-overpriced 1 verify APIFY_USERNAME=canaryaccount
expect verify-overpriced "FAIL   jobs price"

echo "local rehearsal: $passed stage runs as expected; no secret in any output"
