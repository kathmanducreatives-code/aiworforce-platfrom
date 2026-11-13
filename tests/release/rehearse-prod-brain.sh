#!/usr/bin/env bash
# REHEARSE the Company Brain release chain on a LOCAL production-shaped clone.
#   tests/release/rehearse-prod-brain.sh postgres://postgres@127.0.0.1:5432/postgres
set -euo pipefail
url="${1:?postgres url}"
case "$url" in postgres://*@127.0.0.1:*|postgres://*@localhost:*) ;; *) echo "refusing: localhost only" >&2; exit 2;; esac
root="$(cd "$(dirname "$0")/../.." && pwd)"; db="prod_brain_rehearsal_$$"; base="${url%/*}"
psql "$url" -X -q -c "create database $db" >/dev/null
trap 'psql "$url" -X -q -c "drop database if exists $db" >/dev/null' EXIT
u="$base/$db"
run() { psql "$u" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$1" >/dev/null 2>&1 || { echo "FAILED ${1#$root/}"; psql "$u" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$1" 2>&1 | tail -3; exit 1; }; echo "applied ${1#$root/}"; }
probe() { psql "$u" -X -q -f "$root/tests/release/prod_brain_probe.sql" 2>&1 | grep -o 'PROBE.*' | sed "s/^PROBE/$1:/"; }
rowhash() { psql "$u" -X -Atq -c "select md5(row(workspace_id,company_name,what_we_do,who_we_sell_to,voice_and_tone,do_not_say,examples,updated_at,updated_by,id,profile,onboarding_completed,created_at,onboarding_completed_at)::text) from public.company_brain"; }
run "$root/tests/release/prod_security_clone.sql"
run "$root/tests/release/prod_brain_clone.sql"
h0=$(rowhash); echo "existing brain row md5=$h0"; probe BEFORE
run "$root/supabase/migrations/20261023120000_company_brain_server_writes_only.sql"
run "$root/supabase/migrations/20261024120000_company_brain_authorized_writer.sql"
run "$root/supabase/migrations-held/20261110120000_company_brain_memory.sql"
h1=$(rowhash); echo "existing brain row md5=$h1 $([ "$h0" = "$h1" ] && echo UNCHANGED || echo CHANGED)"
probe AFTER
