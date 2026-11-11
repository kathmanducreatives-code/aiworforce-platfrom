#!/usr/bin/env bash
# VALIDATE THE ORION PILOT SEED + CLEANUP ON A DISPOSABLE LOOPBACK DATABASE. Never remote.
#
#   PG_ADMIN_URL=postgres://postgres:…@127.0.0.1:5433/postgres scripts/test-project/validate-orion-pilot-seed.sh
#
# Builds a throwaway database from the repository schema (tests/db-contract/bootstrap.sh),
# adds a pre-existing "customer" workspace with its own rows, then checks:
#   1. seed creates exactly the two fixed fictional workspaces and their rows
#   2. leads cover qualified + rejected (with recorded reasons); signals cover
#      recent / stale / contradicted, each with occurred_at, observed_at and a source_url
#   3. no tasks / missions / outreach rows are created
#   4. a second seed run is refused and creates no duplicates
#   5. cleanup removes ONLY the fictional rows; the pre-existing workspace is byte-identical
# and drops the database, whatever happened.
set -euo pipefail
admin="${PG_ADMIN_URL:?set PG_ADMIN_URL to a loopback postgres superuser URL}"
case "$admin" in postgres://*@127.0.0.1:*|postgres://*@localhost:*|postgresql://*@127.0.0.1:*|postgresql://*@localhost:*) ;;
  *) echo "refusing: PG_ADMIN_URL must be loopback" >&2; exit 2 ;; esac
root="$(cd "$(dirname "$0")/../.." && pwd)"
db="orion_seed_check_$(openssl rand -hex 3)"
base="${admin%/*}"; url="$base/$db"
cleanup() { psql "$admin" -X -q -c "drop database if exists $db with (force)" >/dev/null 2>&1 || true; }
trap cleanup EXIT
psql "$admin" -X -q -c "create database $db" >/dev/null
PGOPTIONS="-c client_min_messages=warning" "$root/tests/db-contract/bootstrap.sh" "$url" >/dev/null 2>&1
q() { psql "$url" -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }
uid() { python3 -c "import uuid;print(uuid.uuid4())"; }
O=$(uid); E=$(uid); V=$(uid); X=$(uid); C=$(uid); CW=$(uid)
q "insert into auth.users (id,email) values ('$O','o@pilot.test'),('$E','e@pilot.test'),('$V','v@pilot.test'),('$X','x@pilot.test'),('$C','c@customer.test')"
# A pre-existing customer workspace that must be untouched.
q "insert into public.workspaces (id,name) values ('$CW','Existing customer (fictional)');
   insert into public.workspace_members (workspace_id,user_id,role) values ('$CW','$C','owner');
   insert into public.accounts (workspace_id,name,domain) values ('$CW','Existing Account','existing.example');"
fingerprint() { q "select md5(string_agg(t::text, '|' order by t::text)) from (
  select row(w.*)::text t from public.workspaces w where w.id='$CW' union all
  select row(m.id,m.workspace_id,m.user_id,m.role)::text from public.workspace_members m where m.workspace_id='$CW' union all
  select row(a.id,a.workspace_id,a.name,a.domain)::text from public.accounts a where a.workspace_id='$CW') s"; }
before="$(fingerprint)"
tasks_before="$(q "select count(*) from public.tasks")"
seed() { psql "$url" -X -q -At -v ON_ERROR_STOP=1 --single-transaction -v owner="'$O'" -v editor="'$E'" -v viewer="'$V'" -v outsider="'$X'" \
  -f "$root/scripts/test-project/orion-pilot-seed.sql"; }
fail() { echo "FAIL: $*" >&2; exit 1; }
seed >/dev/null
P=a71a0000-0000-4000-8000-0000000011a1; I=a71a0000-0000-4000-8000-0000000011a2
[ "$(q "select count(*) from public.workspaces where id in ('$P','$I')")" = 2 ] || fail "two pilot workspaces"
[ "$(q "select count(*) from public.lead_candidates where workspace_id='$P' and status='qualified'")" = 2 ] || fail "2 qualified leads"
[ "$(q "select count(*) from public.lead_candidates where workspace_id='$P' and status='rejected' and coalesce(reason,'')<>''")" = 2 ] || fail "2 rejected leads with recorded reasons"
[ "$(q "select count(*) from public.signal_events where workspace_id='$P' and occurred_at > now() - interval '30 days' and lifecycle_status='active'")" -ge 2 ] || fail "recent signals"
[ "$(q "select count(*) from public.signal_events where workspace_id='$P' and occurred_at < now() - interval '90 days'")" = 1 ] || fail "one stale signal"
[ "$(q "select count(*) from public.signal_events where workspace_id='$P' and lifecycle_status='contradicted'")" = 1 ] || fail "one contradicted signal"
[ "$(q "select count(*) from public.signal_events where workspace_id in ('$P','$I') and (occurred_at is null or observed_at is null or coalesce(source_url,'')='')")" = 0 ] || fail "every signal has timestamps and a source"
[ "$(q "select count(*) from public.signal_events where workspace_id='$I'")" = 1 ] || fail "isolation canary present only in the isolation workspace"
[ "$(q "select count(*) from public.signal_events where workspace_id='$P' and normalized_value::text like '%Zephyr%'")" = 0 ] || fail "canary not in the pilot"
[ "$(q "select count(*) from public.company_brain where workspace_id in ('$P','$I')")" = 0 ] || fail "no Company Brain written"
[ "$(q "select count(*) from public.tasks")" = "$tasks_before" ] || fail "no tasks / missions created"
echo "PASS seed: 2 workspaces; 2 qualified + 2 rejected leads with reasons; recent, stale (130 d) and contradicted signals with timestamps + sources; canary isolated; no Brain; no tasks"
if seed >/dev/null 2>&1; then fail "a second seed run must be refused"; fi
[ "$(q "select count(*) from public.signal_events where dedupe_key like 'orion-pilot:%'")" = 5 ] || fail "no duplicates after a refused re-run"
echo "PASS re-run: refused, no duplicates"
psql "$url" -X -q -At -v ON_ERROR_STOP=1 --single-transaction -f "$root/scripts/test-project/orion-pilot-cleanup.sql" >/dev/null
[ "$(q "select count(*) from public.workspaces where id in ('$P','$I')")" = 0 ] || fail "pilot workspaces removed"
[ "$(q "select count(*) from public.signal_events where dedupe_key like 'orion-pilot:%'")" = 0 ] || fail "pilot signals removed"
[ "$(q "select count(*) from public.accounts where workspace_id in ('$P','$I')")" = 0 ] || fail "pilot accounts removed"
[ "$(fingerprint)" = "$before" ] || fail "the pre-existing workspace changed"
echo "PASS cleanup: only the fictional pilot rows removed; pre-existing workspace unchanged"
