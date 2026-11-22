#!/usr/bin/env bash
# DEPLOY THE COMPANY BRAIN V2 FUNCTIONS TO THE DEDICATED BRAIN TEST PROJECT.
# Needs the owner's approval and a SUPABASE_ACCESS_TOKEN that can reach that project.
#
#   BRAIN_TEST_PROJECT_REF=<ref> scripts/test-project/brain-test/deploy-brain-test.sh --confirm <ref>
#
# Refuses production, ATLAS TEST and AgriDrone before calling the CLI. Deploys
# with an explicit --project-ref (never the config.toml default). Functions:
# the release manifest (docs/plans/company-brain/V2_RELEASE_MANIFEST.md).
set -euo pipefail
REFUSED="ohsdatpvfdjdemstoiuj tlvnfrxzjhsjgdofwehb luvostyizefajbltukkc wqnigjhcwjxtmordrwno"
ref="${BRAIN_TEST_PROJECT_REF:-}"; confirm=""
while [ $# -gt 0 ]; do case "$1" in --confirm) confirm="${2:-}"; shift 2 ;; *) echo "unknown argument: $1" >&2; exit 2 ;; esac; done
refuse() { echo "refusing: $*" >&2; exit 1; }
[ -n "$ref" ] || refuse "BRAIN_TEST_PROJECT_REF is empty"
for r in $REFUSED; do [ "$ref" != "$r" ] || refuse "$ref is never the Brain TEST target"; done
[ "$confirm" = "$ref" ] || refuse "--confirm must repeat BRAIN_TEST_PROJECT_REF exactly"
[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] || refuse "SUPABASE_ACCESS_TOKEN is not set (never printed)"
root="$(cd "$(dirname "$0")/../../.." && pwd)"; cd "$root"
FUNCTIONS="generate-company-brain-draft setup-company-brain company-brain-memory pilot-chat daily-brief run-agent run-radar-scan run-monitoring-scan"
for f in $FUNCTIONS; do
  echo "deploying $f → $ref"
  supabase functions deploy "$f" --project-ref "$ref" >/dev/null
done
echo "done. Secrets: none are required for Brain V2; ORION chat needs OPENAI_API_KEY only if --allow-orion-chat is used."
