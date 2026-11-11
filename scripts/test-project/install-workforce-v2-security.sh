#!/usr/bin/env bash
# INSTALL THE WORKFORCE V2 SECURITY MIGRATION ON THE TEST PROJECT. NEEDS EXPLICIT APPROVAL.
#
#   TEST_PROJECT_REF=tlvnfrxzjhsjgdofwehb TEST_DB_URL='postgresql://…tlvnfrxzjhsjgdofwehb…' \
#     scripts/test-project/install-workforce-v2-security.sh --confirm tlvnfrxzjhsjgdofwehb [--rollback]
#
# Applies supabase/migrations-held/20261113120000_workforce_v2_security.sql in ONE
# transaction (or, with --rollback, its rollback file). Afterwards browser roles
# can READ signal_events / signal_event_evidence / monitoring_subjects / approvals
# and cannot write them; the service role still can.
#
# Refuses, before any connection: an empty, live or abandoned ref; --confirm not
# repeating it; a TEST_DB_URL that does not name it or names a refused project.
# Refuses, after connecting but before writing: a preflight BLOCK (a required
# table or has_workspace_access() missing). Already installed → writes nothing.
# Ends by checking the catalog: no non-SELECT policy and no INSERT/UPDATE/DELETE
# grant for anon/authenticated on the four tables (or the reverse for --rollback).
set -euo pipefail

REFUSED_REFS="ohsdatpvfdjdemstoiuj wqnigjhcwjxtmordrwno"
ref="${TEST_PROJECT_REF:-}"
url="${TEST_DB_URL:-}"
confirm=""
mode="install"
while [ $# -gt 0 ]; do
  case "$1" in
    --confirm) confirm="${2:-}"; shift 2 ;;
    --rollback) mode="rollback"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

refuse() { echo "refusing: $*" >&2; exit 1; }
[ -n "$ref" ] || refuse "TEST_PROJECT_REF is empty"
for r in $REFUSED_REFS; do
  [ "$ref" != "$r" ] || refuse "$ref is the live or the abandoned project, never a test target"
  case "$url" in *"$r"*) refuse "TEST_DB_URL names $r" ;; esac
done
[ "$confirm" = "$ref" ] || refuse "--confirm must repeat TEST_PROJECT_REF exactly"
case "$url" in
  postgres://*"$ref"*|postgresql://*"$ref"*) ;;
  *) refuse "TEST_DB_URL must be a postgres URL that names $ref" ;;
esac

root="$(cd "$(dirname "$0")/../.." && pwd)"
fwd="$root/supabase/migrations-held/20261113120000_workforce_v2_security.sql"
back="$root/supabase/migrations-held/rollback/20261113120000_workforce_v2_security.down.sql"
# Second held fix, same gate: the model-spend view stops bypassing RLS.
fwd2="$root/supabase/migrations-held/20261114120000_lead_model_calls_view_lockdown.sql"
back2="$root/supabase/migrations-held/rollback/20261114120000_lead_model_calls_view_lockdown.down.sql"
[ -f "$fwd" ] && [ -f "$back" ] && [ -f "$fwd2" ] && [ -f "$back2" ] || refuse "missing a migration or its rollback"
q() { psql "$url" -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }

q "select 1" >/dev/null || refuse "cannot connect to TEST_DB_URL"
pre="$(psql "$url" -X -At -F ' ' -v ON_ERROR_STOP=1 -f "$root/scripts/test-project/workforce-v2-security-preflight.sql")"
echo "$pre" | sed 's/^/  preflight: /'
! echo "$pre" | grep -q '^BLOCK' || refuse "preflight reports BLOCK; nothing was written"

writes="$(q "select count(*) from pg_policies where schemaname='public' and cmd <> 'SELECT'
  and tablename in ('approvals','signal_events','signal_event_evidence','monitoring_subjects')")"
if [ "$mode" = "install" ]; then
  if [ "$writes" = "0" ]; then echo "already installed: no browser write policy remains; nothing written"; else
    psql "$url" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$fwd" >/dev/null || refuse "migration failed and was rolled back"
    echo "applied supabase/migrations-held/20261113120000_workforce_v2_security.sql"
  fi
  psql "$url" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$fwd2" >/dev/null || refuse "view lockdown failed and was rolled back"
  echo "applied supabase/migrations-held/20261114120000_lead_model_calls_view_lockdown.sql (idempotent)"
  want_policies=0; want_grants=0; want_reads=4
else
  psql "$url" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$back2" >/dev/null || refuse "view rollback failed and was rolled back"
  psql "$url" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$back" >/dev/null || refuse "rollback failed and was rolled back"
  echo "applied the ROLLBACK (member write access restored — both findings reopened)"
  # After rollback, approvals are readable through the restored FOR ALL policy
  # (cmd ALL, not SELECT), so three SELECT policies remain on the other tables.
  want_policies=10; want_grants=1; want_reads=3
fi

policies="$(q "select count(*) from pg_policies where schemaname='public' and cmd <> 'SELECT'
  and tablename in ('approvals','signal_events','signal_event_evidence','monitoring_subjects')")"
grants="$(q "select (count(*) > 0)::int from information_schema.role_table_grants where table_schema='public'
  and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE')
  and table_name in ('approvals','signal_events','signal_event_evidence','monitoring_subjects')")"
reads="$(q "select count(*) from pg_policies where schemaname='public' and cmd = 'SELECT'
  and tablename in ('approvals','signal_events','signal_event_evidence','monitoring_subjects')")"
echo "  after: non-SELECT policies=$policies (want $want_policies), browser write grants=$grants (want $want_grants), SELECT policies=$reads (want >= $want_reads)"
[ "$policies" = "$want_policies" ] && [ "$grants" = "$want_grants" ] && [ "$reads" -ge "$want_reads" ] || { echo "FAILED: unexpected catalog state" >&2; exit 1; }
view="$(q "select (coalesce(array_to_string(reloptions, ','), '') like '%security_invoker=true%')::int
  || ' ' || (select count(*) from information_schema.role_table_grants where table_schema='public'
     and table_name='lead_model_calls' and grantee in ('anon','authenticated'))
  from pg_class where oid = 'public.lead_model_calls'::regclass")"
echo "  after: lead_model_calls security_invoker / browser grants = $view"
if [ "$mode" = "install" ]; then [ "$view" = "1 0" ] || { echo "FAILED: lead_model_calls not locked down" >&2; exit 1; }
else [ "${view%% *}" = "0" ] || { echo "FAILED: lead_model_calls rollback incomplete" >&2; exit 1; }; fi
echo "workforce v2 security: $mode verified on $ref"
