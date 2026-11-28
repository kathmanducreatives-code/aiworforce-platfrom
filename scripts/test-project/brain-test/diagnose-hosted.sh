#!/usr/bin/env bash
# READ-ONLY hosted diagnostic for Brain TEST (called by `scripts/test-env/brain-test diagnose`).
# Needs SUPABASE_ACCESS_TOKEN (the Brain TEST CLI token from Keychain). Changes nothing.
#   1. deployed functions (name, version, updated) — do they match the checkout?
#   2. edge requests to the Company Brain functions in the last 6 hours: method, HTTP status, time
#   3. function errors and warnings logged in the last 6 hours
# The token is passed to curl through a header file descriptor, never on the command line.
set -euo pipefail
REF=jekgwafobrzamoupehnn
[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] || { echo "no SUPABASE_ACCESS_TOKEN" >&2; exit 1; }
echo "== checkout: $(git -C "$(dirname "$0")" rev-parse HEAD)"
echo "== 1. deployed functions on $REF"
supabase functions list --project-ref "$REF" 2>&1 | sed 's/^/  /'
start="$(date -u -v-6H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '6 hours ago' +%Y-%m-%dT%H:%M:%SZ)"
end="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
logs() {
  curl -sS -G "https://api.supabase.com/v1/projects/$REF/analytics/endpoints/logs.all" \
    -H @<(printf 'Authorization: Bearer %s\n' "$SUPABASE_ACCESS_TOKEN") \
    --data-urlencode "iso_timestamp_start=$start" --data-urlencode "iso_timestamp_end=$end" \
    --data-urlencode "sql=$1"
  echo
}
echo "== 2. edge requests to Company Brain functions (newest first)"
logs "select datetime(timestamp) as at, request.method, response.status_code, request.url, m.execution_time_ms
  from function_edge_logs cross join unnest(metadata) as m cross join unnest(m.request) as request cross join unnest(m.response) as response
  where request.url like '%company-brain%' or request.url like '%setup-company-brain%'
  order by timestamp desc limit 40"
echo "== 3. function errors and warnings (newest first)"
logs "select datetime(timestamp) as at, m.level, m.function_id, event_message
  from function_logs cross join unnest(metadata) as m
  where m.level in ('error', 'warning')
  order by timestamp desc limit 40"
