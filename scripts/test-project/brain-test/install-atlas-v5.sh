#!/usr/bin/env bash
# INSTALL THE ATLAS V5 DISCOVERY ENGINE ON BRAIN TEST — for the integrated
# Company Brain + ATLAS test. PREPARED; RUN ONLY WITH THE OWNER'S APPROVAL.
#
#   scripts/test-env/brain-test atlas-v5 --workspace <brain-test-workspace-uuid>            # dry run: prints the plan
#   scripts/test-env/brain-test atlas-v5 --workspace <uuid> --execute --confirm jekgwafobrzamoupehnn
#
# Target FIXED: jekgwafobrzamoupehnn (Brain TEST). Production and ATLAS TEST are
# never touched; ATLAS TEST's own deploy tooling is not used (it is pinned to ATLAS TEST).
#
# What --execute does, in order (stops at the first failure):
#   1. Preflight: Brain V2 schema present (company_brain_provenanced_write), the
#      workspace exists, NO `APIFY_API_TOKEN` secret on the project (Apify execution
#      stays impossible until the owner approves the pilot and sets one separately).
#   2. Migrations (ATLAS session's list, 2026-11-28), each in one transaction, then verified:
#        20261027120000_provider_connections
#        20261031120000_lead_pipeline_checkpoints
#        20261108120000_lead_pipeline_one_lead_per_company
#      (Not applied: the evidence cache and the V2 smoke-admission migrations.)
#   3. Functions: lead-pipeline, provider-connections (explicit --project-ref; one-file bundles via --use-api, no Docker).
#   4. Flags, allowlisted to ONE workspace:
#        LEAD_PIPELINE_ENABLED=enabled            LEAD_PIPELINE_WORKSPACES=<uuid>
#        PROVIDER_DISCOVERY_ENABLED=enabled       PROVIDER_DISCOVERY_WORKSPACES=<uuid>
#        PROVIDER_APIFY_DISCOVERY_ENABLED=enabled AGENTORY_MISSION_CONTRACT_V4=enabled
#      Kept UNSET (and refused if present): PROVIDER_APOLLO_ENABLED, LEAD_PIPELINE_PHONES_ENABLED,
#      LEAD_PIPELINE_SIGNALS_ENABLED, DISCOVERY_EVIDENCE_CACHE_ENABLED, any PROVIDER_LEADOCEAN_*,
#      APIFY_API_TOKEN. Plan tokens are signed with a key derived from the service-role
#      key (lead-pipeline planSigner): no new secret.
#   With no Apify token, strategy_plan works (planning, Brain context, costed plan) and a
#   strategy_run cannot buy anything. That is the intended state for UI testing.
#
# Rollback: the three migrations' rollback/*.down.sql in reverse order; unset the flags;
# delete the two functions (Brain TEST only).
set -euo pipefail
REF=jekgwafobrzamoupehnn
ws=""; execute=0; confirm=""
while [ $# -gt 0 ]; do case "$1" in
  --workspace) ws="${2:-}"; shift 2 ;;
  --execute) execute=1; shift ;;
  --confirm) confirm="${2:-}"; shift 2 ;;
  *) echo "unknown argument: $1" >&2; exit 2 ;;
esac; done
refuse() { echo "refusing: $*" >&2; exit 1; }
echo "$ws" | grep -Eq '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' || refuse "--workspace must be the Brain TEST workspace UUID"
root="$(cd "$(dirname "$0")/../../.." && pwd)"; held="$root/supabase/migrations-held"
MIGRATIONS="20261027120000_provider_connections 20261031120000_lead_pipeline_checkpoints 20261108120000_lead_pipeline_one_lead_per_company"
for m in $MIGRATIONS; do [ -f "$held/$m.sql" ] && [ -f "$held/rollback/$m.down.sql" ] || refuse "missing $m (or its rollback)"; done
FORBIDDEN_SECRETS='^(APIFY_API_TOKEN|PROVIDER_APOLLO_ENABLED|APOLLO_COMMERCIAL_TERMS_CONFIRMED|LEAD_PIPELINE_PHONES_ENABLED|LEAD_PIPELINE_SIGNALS_ENABLED|DISCOVERY_EVIDENCE_CACHE_ENABLED|PROVIDER_LEADOCEAN_[A-Z_]*|LEADOCEAN_COMMERCIAL_TERMS_CONFIRMED)$'

echo "ATLAS V5 on Brain TEST ($REF), workspace $ws"
echo "  migrations: $MIGRATIONS"
echo "  functions:  lead-pipeline provider-connections"
echo "  flags:      LEAD_PIPELINE_ENABLED, PROVIDER_DISCOVERY_ENABLED, PROVIDER_APIFY_DISCOVERY_ENABLED,"
echo "              AGENTORY_MISSION_CONTRACT_V4 = enabled; both allowlists = $ws"
echo "  NOT set:    APIFY_API_TOKEN (no paid execution possible), Apollo, phones, signals, evidence cache, LeadOcean"
[ $execute = 1 ] || { echo "dry run only. Add --execute --confirm $REF after the owner approves."; exit 0; }
[ "$confirm" = "$REF" ] || refuse "--execute needs --confirm $REF"
[ -n "${TEST_DB_URL:-}" ] && [ -n "${PGPASSFILE:-}" ] || refuse "run through: scripts/test-env/brain-test atlas-v5 … (it provides the Keychain-scoped DB access)"
case "$TEST_DB_URL" in *"$REF"*) ;; *) refuse "TEST_DB_URL does not name $REF" ;; esac
case "$TEST_DB_URL" in *ohsdatpvfdjdemstoiuj*|*tlvnfrxzjhsjgdofwehb*) refuse "TEST_DB_URL names a protected project" ;; esac
[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] || refuse "no Brain TEST CLI token (brain-test store-keys)"
supabase projects list 2>/dev/null | grep -q "$REF" || refuse "the CLI token cannot see $REF"
q() { psql -w "$TEST_DB_URL" -X -At -v ON_ERROR_STOP=1 -c "$1"; }

echo "== 1. preflight"
[ "$(q "select count(*) from pg_proc where proname = 'company_brain_provenanced_write'")" -ge 1 ] || refuse "Brain V2 schema missing (run: brain-test build)"
[ "$(q "select count(*) from public.workspaces where id = '$ws'")" = 1 ] || refuse "workspace $ws does not exist on Brain TEST"
names="$(supabase secrets list --project-ref "$REF" | awk -F'|' 'NR>2 {gsub(/ /,"",$1); if ($1!="") print $1}')"
bad="$(echo "$names" | grep -E "$FORBIDDEN_SECRETS" || true)"
[ -z "$bad" ] || { echo "refusing: these must not be set on Brain TEST for this install:"; echo "$bad" | sed 's/^/  /'; exit 1; }
echo "  ok: Brain V2 present, workspace exists, no Apify token or forbidden flag"

echo "== 2. migrations"
for m in $MIGRATIONS; do
  echo "  applying $m"; psql -w "$TEST_DB_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$held/$m.sql" >/dev/null
done
for t in workspace_provider_connections lead_pipeline_checkpoints; do
  [ "$(q "select count(*) from information_schema.tables where table_schema='public' and table_name='$t'")" = 1 ] || refuse "verification: table $t missing"
done
[ "$(q "select count(*) from pg_indexes where schemaname='public' and indexname='lead_candidates_pipeline_account_uniq'")" = 1 ] || refuse "verification: one-lead-per-company index missing"
echo "  ok: provider_connections + checkpoints tables and the one-lead-per-company index present"

echo "== 3. functions"
# No Docker: one-file bundles, deployed with --use-api (deploy-functions.sh).
. "$root/scripts/test-project/brain-test/deploy-functions.sh"
brain_test_deploy_functions "$REF" lead-pipeline provider-connections

echo "== 4. flags (one workspace)"
supabase secrets set --project-ref "$REF" \
  LEAD_PIPELINE_ENABLED=enabled LEAD_PIPELINE_WORKSPACES="$ws" \
  PROVIDER_DISCOVERY_ENABLED=enabled PROVIDER_DISCOVERY_WORKSPACES="$ws" \
  PROVIDER_APIFY_DISCOVERY_ENABLED=enabled AGENTORY_MISSION_CONTRACT_V4=enabled >/dev/null
names="$(supabase secrets list --project-ref "$REF" | awk -F'|' 'NR>2 {gsub(/ /,"",$1); if ($1!="") print $1}')"
! echo "$names" | grep -qE "$FORBIDDEN_SECRETS" || refuse "a forbidden secret appeared; stop and report"
echo "done. Planning works for workspace $ws; no paid run is possible (no APIFY_API_TOKEN)."
echo "Secret NAMES now set:"; echo "$names" | sed 's/^/  /'
