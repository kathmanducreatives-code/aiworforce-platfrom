#!/usr/bin/env bash
# REHEARSE the production security migrations on a LOCAL production-shaped clone.
# Localhost only. Applies the exact held files, then their rollbacks, then again.
#   tests/release/rehearse-prod-security.sh postgres://postgres@127.0.0.1:5432/postgres
set -euo pipefail
url="${1:?postgres url}"
case "$url" in postgres://*@127.0.0.1:*|postgres://*@localhost:*) ;; *) echo "refusing: localhost only" >&2; exit 2;; esac
root="$(cd "$(dirname "$0")/../.." && pwd)"
db="prod_security_rehearsal_$$"
base="${url%/*}"
psql "$url" -X -q -c "create database $db" >/dev/null
trap 'psql "$url" -X -q -c "drop database if exists $db" >/dev/null' EXIT
u="$base/$db"
run() { psql "$u" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$1" >/dev/null; echo "applied ${1#$root/}"; }
probe() { psql "$u" -X -q -f "$root/tests/release/prod_security_probe.sql" 2>&1 | grep -o 'PROBE.*' | sed "s/^PROBE/$1:/"; }
counts() { psql "$u" -X -Atq -c "select 'rows: approvals='||(select count(*) from approvals)||' signals='||(select count(*) from signal_events)||' ledger='||(select count(*) from lead_execution_calls)||' policies_nonselect='||(select count(*) from pg_policies where tablename in ('approvals','signal_events','signal_event_evidence','monitoring_subjects') and cmd<>'SELECT')||' view_opts='||coalesce((select array_to_string(reloptions,',') from pg_class where oid='public.lead_model_calls'::regclass),'(none)')"; }
run "$root/tests/release/prod_security_clone.sql"
counts; probe BEFORE
run "$root/supabase/migrations-held/20261113120000_workforce_v2_security.sql"
run "$root/supabase/migrations-held/20261114120000_lead_model_calls_view_lockdown.sql"
counts; probe AFTER
run "$root/supabase/migrations-held/rollback/20261114120000_lead_model_calls_view_lockdown.down.sql"
run "$root/supabase/migrations-held/rollback/20261113120000_workforce_v2_security.down.sql"
counts; probe ROLLED_BACK
run "$root/supabase/migrations-held/20261113120000_workforce_v2_security.sql"
run "$root/supabase/migrations-held/20261114120000_lead_model_calls_view_lockdown.sql"
counts; probe REAPPLIED
