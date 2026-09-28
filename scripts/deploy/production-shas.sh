#!/usr/bin/env bash
# READ-ONLY: which commit is each production surface running?
#
#   AGENTORY_SITE_URL=https://… AGENTORY_API_URL=https://… SUPABASE_URL=https://….supabase.co \
#     scripts/deploy/production-shas.sh
#
# Netlify: /version.json. Railway: /health (build.sha). Edge functions: the
# x-agentory-build header on an unauthenticated OPTIONS preflight — no auth, no
# side effect, no spend.
set -uo pipefail
FUNCTIONS="pilot-chat orchestrate run-agent enqueue-lead-mission approve-and-continue firecrawl-scrape send-scheduled-emails continue-workflow resume-stalled-leads"
row() { printf '%-26s %s\n' "$1" "$2"; }
if [ -n "${AGENTORY_SITE_URL:-}" ]; then
  row "netlify" "$(curl -fsS "${AGENTORY_SITE_URL%/}/version.json" 2>/dev/null | tr -d '\n ' || echo 'unreachable / no version.json (built before stamping)')"
fi
if [ -n "${AGENTORY_API_URL:-}" ]; then
  row "railway /health" "$(curl -fsS "${AGENTORY_API_URL%/}/health" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("build","no build field (deployed before stamping)"))' 2>/dev/null || echo unreachable)"
fi
if [ -n "${SUPABASE_URL:-}" ]; then
  for f in $FUNCTIONS; do
    h="$(curl -sS -o /dev/null -D - -X OPTIONS "${SUPABASE_URL%/}/functions/v1/$f" -H 'Origin: https://agentory.invalid' -H 'Access-Control-Request-Method: POST' 2>/dev/null | tr -d '\r' | awk -F': ' 'tolower($1)=="x-agentory-build"{print $2}')"
    row "fn:$f" "${h:-no header (deployed before stamping)}"
  done
fi
