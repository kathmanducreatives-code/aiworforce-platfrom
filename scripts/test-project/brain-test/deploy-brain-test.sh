#!/usr/bin/env bash
# DEPLOY THE COMPANY BRAIN V2 FUNCTIONS TO THE DEDICATED BRAIN TEST PROJECT.
# Needs the owner's approval and a Supabase CLI login (or SUPABASE_ACCESS_TOKEN) that can see that project.
#
#   BRAIN_TEST_PROJECT_REF=<ref> scripts/test-project/brain-test/deploy-brain-test.sh \
#     --confirm <ref> --spend-ceiling-usd <approved limit>
#
# Refuses production, ATLAS TEST, AgriDrone and the abandoned project before
# calling the CLI. Deploys with an explicit --project-ref (never the config.toml
# default). Functions: docs/plans/company-brain/V2_RELEASE_MANIFEST.md §3, less
# run-agent (shared with ATLAS; not needed for acceptance).
#
# Sets NON-SECRET configuration on the Brain TEST project only:
#   MODEL_SPEND_ENFORCEMENT=enforce       the ceiling acts (fail-closed)
#   MODEL_SPEND_CEILING_USD=<limit>       per workspace, per period; pilot-chat
#   MODEL_SPEND_PERIOD_DAYS=30            checks it before every model call
#   AGENTORY_ROUTE_MAX_USD_PER_CALL=0.05  worst-case admission per call
#   AGENTORY_DELEGATION_ENABLED=false     ORION delegation stays off
# OPENAI_API_KEY is a secret value: the owner sets it in the dashboard, or leaves
# it unset and runs acceptance without --allow-orion-chat. This script never reads it.
set -euo pipefail
REFUSED="ohsdatpvfdjdemstoiuj tlvnfrxzjhsjgdofwehb luvostyizefajbltukkc wqnigjhcwjxtmordrwno"
ref="${BRAIN_TEST_PROJECT_REF:-}"; confirm=""; ceiling=""
while [ $# -gt 0 ]; do case "$1" in
  --confirm) confirm="${2:-}"; shift 2 ;;
  --spend-ceiling-usd) ceiling="${2:-}"; shift 2 ;;
  *) echo "unknown argument: $1" >&2; exit 2 ;;
esac; done
refuse() { echo "refusing: $*" >&2; exit 1; }
[ -n "$ref" ] || refuse "BRAIN_TEST_PROJECT_REF is empty"
for r in $REFUSED; do [ "$ref" != "$r" ] || refuse "$ref is never the Brain TEST target"; done
[ "$confirm" = "$ref" ] || refuse "--confirm must repeat BRAIN_TEST_PROJECT_REF exactly"
echo "$ceiling" | grep -Eq '^[0-9]*\.?[0-9]+$' && awk -v c="$ceiling" 'BEGIN { exit !(c > 0 && c <= 1) }' \
  || refuse "--spend-ceiling-usd must be a positive amount no larger than 1.00 (e.g. 0.25)"
command -v supabase >/dev/null && command -v docker >/dev/null && docker info >/dev/null 2>&1 || refuse "the supabase CLI and a running Docker are required"
# Credentials: SUPABASE_ACCESS_TOKEN (never printed), or an existing `supabase login`.
# Either way, the login must be able to see THIS project before anything is changed.
supabase projects list 2>/dev/null | grep -q "$ref" \
  || refuse "the Supabase CLI cannot see project $ref (run 'supabase login', or set SUPABASE_ACCESS_TOKEN for an account in its organization)"
root="$(cd "$(dirname "$0")/../../.." && pwd)"; cd "$root"
FUNCTIONS="generate-company-brain-draft setup-company-brain company-brain-memory pilot-chat daily-brief run-radar-scan run-monitoring-scan"
supabase secrets set --project-ref "$ref" \
  MODEL_SPEND_ENFORCEMENT=enforce MODEL_SPEND_CEILING_USD="$ceiling" MODEL_SPEND_PERIOD_DAYS=30 \
  AGENTORY_ROUTE_MAX_USD_PER_CALL=0.05 AGENTORY_DELEGATION_ENABLED=false >/dev/null
echo "configured: spend ceiling \$$ceiling per workspace per 30 days; delegation off"
for f in $FUNCTIONS; do
  echo "deploying $f → $ref"
  # --use-docker bundles locally: a plain upload of pilot-chat's ~280 modules is refused (HTTP 413).
  supabase functions deploy "$f" --project-ref "$ref" --use-docker >/dev/null
done
echo "secret NAMES on $ref (values are never shown):"
supabase secrets list --project-ref "$ref" | awk -F'|' 'NR>2 {gsub(/ /,"",$1); if ($1!="") print "  " $1}'
