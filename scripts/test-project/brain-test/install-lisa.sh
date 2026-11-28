#!/usr/bin/env bash
# INSTALL THE LISA SIGNALS ENGINE ON BRAIN TEST — fixture mode, one workspace.
# PREPARED; RUN ONLY WITH THE OWNER'S APPROVAL.
#
#   scripts/test-env/brain-test lisa --workspace <fixture-workspace-uuid>             # dry run: plan + read-only preflight
#   scripts/test-env/brain-test lisa --workspace <uuid> --postflight                  # read-only checks after an install
#   scripts/test-env/brain-test lisa --workspace <uuid> --execute --confirm jekgwafobrzamoupehnn
#
# Target FIXED: jekgwafobrzamoupehnn (Brain TEST). Production, ATLAS TEST and every other ref are
# refused. Brain TEST is NOT rebuilt; Northwind is NOT modified (the fixture workspace must be a
# different workspace — synthetic signals never go into Northwind).
#
# What --execute does, in order (stops at the first failure):
#   1. Preflight (read-only): Brain V2 + workforce_v2_security present (browser roles cannot
#      write signal_events), the workspace exists and is not Northwind, no paid signal provider
#      key, no LISA schedule flag, no active cron job that calls LISA or monitoring.
#   2. Migrations (held), each in ONE transaction, skipped when already present, then verified:
#        20261111120000_lisa_signal_engine       (scan-run ledger, record/transition RPCs)
#        20261128140000_signals_monitoring_plans (plans + monitoring_plan_decide)
#        20261128150000_signals_canonical_reviews (signal_reviews.signal_event_id)
#      Additive only. Rollbacks: supabase/migrations-held/rollback/*.down.sql, reverse order.
#   3. Functions (no Docker; one-file bundles via --use-api): lisa-monitor, pilot-chat,
#      run-radar-scan, run-monitoring-scan.
#   4. Flags, scoped to ONE workspace:
#        LISA_V2_ENABLED=true   LISA_V2_WORKSPACES=<uuid>
#        LISA_FIXTURE_MODE=true LISA_FIXTURE_WORKSPACES=<uuid>
#      Never set (refused if present): LISA_V2_SCHEDULE_ENABLED, FIRECRAWL_API_KEY.
#      No cron job is created or enabled.
#   5. Postflight (read-only): the checks below, plus Northwind's signal and review counts unchanged.
#
# Rollback: unset the four flags; apply the three rollbacks in reverse order; redeploy the previous
# pilot-chat / run-radar-scan / run-monitoring-scan bundle; delete lisa-monitor (Brain TEST only).
set -euo pipefail
REF=jekgwafobrzamoupehnn
ws=""; execute=0; confirm=""; postflight_only=0
while [ $# -gt 0 ]; do case "$1" in
  --workspace) ws="${2:-}"; shift 2 ;;
  --execute) execute=1; shift ;;
  --confirm) confirm="${2:-}"; shift 2 ;;
  --postflight) postflight_only=1; shift ;;
  *) echo "unknown argument: $1" >&2; exit 2 ;;
esac; done
refuse() { echo "refusing: $*" >&2; exit 1; }
echo "$ws" | grep -Eq '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' || refuse "--workspace must be the Brain TEST fixture workspace UUID"
root="$(cd "$(dirname "$0")/../../.." && pwd)"; held="$root/supabase/migrations-held"
MIGRATIONS="20261111120000_lisa_signal_engine 20261128140000_signals_monitoring_plans 20261128150000_signals_canonical_reviews"
FUNCTIONS="lisa-monitor pilot-chat run-radar-scan run-monitoring-scan"
for m in $MIGRATIONS; do [ -f "$held/$m.sql" ] && [ -f "$held/rollback/$m.down.sql" ] || refuse "missing $m (or its rollback)"; done
FORBIDDEN_SECRETS='^(LISA_V2_SCHEDULE_ENABLED|FIRECRAWL_API_KEY)$'

echo "LISA (fixture mode) on Brain TEST ($REF), workspace $ws"
echo "  migrations: $MIGRATIONS"
echo "  functions:  $FUNCTIONS"
echo "  flags:      LISA_V2_ENABLED=true LISA_V2_WORKSPACES=$ws LISA_FIXTURE_MODE=true LISA_FIXTURE_WORKSPACES=$ws"
echo "  NOT set:    LISA_V2_SCHEDULE_ENABLED, FIRECRAWL_API_KEY (no paid provider call is possible); no cron job"

if [ $execute = 0 ] && [ $postflight_only = 0 ] && [ -z "${TEST_DB_URL:-}" ]; then
  echo "dry run only (no DB access in this shell, so no preflight). Run via scripts/test-env/brain-test lisa … for the read-only preflight;"
  echo "add --execute --confirm $REF after the owner approves."; exit 0
fi
[ -n "${TEST_DB_URL:-}" ] && [ -n "${PGPASSFILE:-}" ] || refuse "run through: scripts/test-env/brain-test lisa … (it provides the Keychain-scoped DB access)"
case "$TEST_DB_URL" in *"$REF"*) ;; *) refuse "TEST_DB_URL does not name $REF" ;; esac
case "$TEST_DB_URL" in *ohsdatpvfdjdemstoiuj*|*tlvnfrxzjhsjgdofwehb*|*luvostyizefajbltukkc*) refuse "TEST_DB_URL names a protected project" ;; esac
secret_names() {
  local out; out="$(supabase secrets list --project-ref "$REF")" || { echo "refusing: could not list Brain TEST secret names" >&2; exit 1; }
  echo "$out" | awk -F'|' 'NR>2 {gsub(/ /,"",$1); if ($1!="") print $1}'
}
q() { psql -w "$TEST_DB_URL" -X -At -v ON_ERROR_STOP=1 -c "$1"; }
has_fn() { q "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='$1'"; }
has_table() { q "select count(*) from information_schema.tables where table_schema='public' and table_name='$1'"; }
has_col() { q "select count(*) from information_schema.columns where table_schema='public' and table_name='$1' and column_name='$2'"; }
northwind_counts() {
  q "select coalesce(string_agg(w.id::text || '=' || (select count(*) from public.signal_events e where e.workspace_id=w.id) || '/' ||
       (select count(*) from public.signals s where s.workspace_id=w.id) || '/' ||
       (select count(*) from public.signal_reviews r where r.workspace_id=w.id), ','), 'none')
     from public.workspaces w where w.name ilike '%northwind%'"
}
cron_jobs() {
  local active="true"
  if [ "$(q "select count(*) from information_schema.tables where table_schema='cron' and table_name='job'")" = 1 ]; then
    [ "$(q "select count(*) from information_schema.columns where table_schema='cron' and table_name='job' and column_name='active'")" = 1 ] && active="active"
    q "select count(*) from cron.job where $active and (command ilike '%lisa%' or command ilike '%monitoring-scan%' or command ilike '%radar-scan%')" \
      || { echo "refusing: could not read cron.job" >&2; exit 1; }
  else echo 0; fi
}

preflight() {
  echo "== preflight (read-only)"
  [ "$(has_fn company_brain_provenanced_write)" -ge 1 ] || refuse "Brain V2 schema missing (Brain TEST is not built; this installer does not rebuild it)"
  [ "$(q "select count(*) from pg_policies where schemaname='public' and tablename='signal_events' and cmd in ('INSERT','UPDATE','DELETE')")" = 0 ] \
    || refuse "browser roles can still write signal_events (workforce_v2_security not applied); LISA must stay off"
  [ "$(has_table signal_events)" = 1 ] && [ "$(has_table monitoring_subjects)" = 1 ] && [ "$(has_table signal_reviews)" = 1 ] || refuse "signal tables missing"
  name="$(q "select name from public.workspaces where id = '$ws'")"
  [ -n "$name" ] || refuse "workspace $ws does not exist on Brain TEST (create a separate fixture workspace in the app first)"
  echo "$name" | grep -qi northwind && refuse "workspace $ws is Northwind — fixture signals never go into Northwind; use a separate fixture workspace"
  [ "$(cron_jobs)" = 0 ] || refuse "an active cron job calls LISA / monitoring / radar; cron must stay detached"
  if [ -n "${SUPABASE_ACCESS_TOKEN:-}" ]; then
    names="$(secret_names)"
    bad="$(echo "$names" | grep -E "$FORBIDDEN_SECRETS" || true)"
    [ -z "$bad" ] || { echo "refusing: these must not be set on Brain TEST for this install:"; echo "$bad" | sed 's/^/  /'; exit 1; }
  else echo "  (no CLI token in this shell: secret names not checked)"; fi
  echo "  ok: Brain V2 + signal write lockdown present; workspace \"$name\" (not Northwind); no paid key, no schedule flag, no LISA cron"
  echo "  LISA engine: $( [ "$(has_fn lisa_record_signal)" -ge 1 ] && echo present || echo absent ) · plans: $( [ "$(has_table monitoring_plans)" = 1 ] && echo present || echo absent ) · canonical reviews: $( [ "$(has_col signal_reviews signal_event_id)" = 1 ] && echo present || echo absent )"
  echo "  Northwind signal_events/signals/reviews: $(northwind_counts)"
}

postflight() {
  echo "== postflight (read-only)"
  [ "$(has_fn lisa_record_signal)" -ge 1 ] && [ "$(has_fn lisa_claim_scan_run)" -ge 1 ] || refuse "verification: LISA RPCs missing"
  [ "$(has_table lisa_scan_runs)" = 1 ] && [ "$(has_table monitoring_plans)" = 1 ] || refuse "verification: LISA tables missing"
  [ "$(has_fn monitoring_plan_decide)" -ge 1 ] || refuse "verification: monitoring_plan_decide missing"
  [ "$(has_col signal_reviews signal_event_id)" = 1 ] || refuse "verification: signal_reviews.signal_event_id missing"
  [ "$(q "select count(*) from pg_class where relname in ('monitoring_plans','lisa_scan_runs') and relrowsecurity")" = 2 ] || refuse "verification: RLS off on a new table"
  [ "$(q "select count(*) from information_schema.routine_privileges where routine_schema='public' and routine_name='lisa_record_signal' and grantee in ('anon','authenticated')")" = 0 ] \
    || refuse "verification: lisa_record_signal is callable by browser roles"
  [ "$(cron_jobs)" = 0 ] || refuse "verification: an active cron job calls LISA / monitoring / radar"
  echo "  enabled monitoring_subjects in $ws: $(q "select count(*) from public.monitoring_subjects where workspace_id='$ws' and enabled")"
  echo "  plans in $ws: $(q "select coalesce(string_agg(status || '=' || n, ', '), 'none') from (select status, count(*) n from public.monitoring_plans where workspace_id='$ws' group by status) x")"
  echo "  Northwind signal_events/signals/reviews: $(northwind_counts)"
  echo "  ok: schema, grants, RLS and cron verified"
}

if [ $postflight_only = 1 ]; then postflight; exit 0; fi
preflight
[ $execute = 1 ] || { echo "dry run only. Add --execute --confirm $REF after the owner approves."; exit 0; }
[ "$confirm" = "$REF" ] || refuse "--execute needs --confirm $REF"
[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] || refuse "no Brain TEST CLI token (brain-test store-keys)"
supabase projects list 2>/dev/null | grep -q "$REF" || refuse "the CLI token cannot see $REF"
before="$(northwind_counts)"

echo "== migrations"
for m in $MIGRATIONS; do
  case "$m" in
    *lisa_signal_engine) present="$(has_fn lisa_record_signal)" ;;
    *monitoring_plans)   present="$(has_table monitoring_plans)" ;;
    *canonical_reviews)  present="$(has_col signal_reviews signal_event_id)" ;;
  esac
  if [ "$present" -ge 1 ]; then echo "  $m already present — skipped"; continue; fi
  echo "  applying $m"; psql -w "$TEST_DB_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$held/$m.sql" >/dev/null
done

echo "== functions"
. "$root/scripts/test-project/brain-test/deploy-functions.sh"
# shellcheck disable=SC2086
brain_test_deploy_functions "$REF" $FUNCTIONS

echo "== flags (one workspace)"
supabase secrets set --project-ref "$REF" \
  LISA_V2_ENABLED=true LISA_V2_WORKSPACES="$ws" LISA_FIXTURE_MODE=true LISA_FIXTURE_WORKSPACES="$ws" >/dev/null
names="$(secret_names)"
! echo "$names" | grep -qE "$FORBIDDEN_SECRETS" || refuse "a forbidden secret appeared; stop and report"

postflight
after="$(northwind_counts)"
[ "$before" = "$after" ] || refuse "Northwind counts changed during install ($before → $after); stop and report"
echo "done. LISA runs in fixture mode for workspace $ws only; no provider key, no schedule, no cron."
