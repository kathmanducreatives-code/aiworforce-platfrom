#!/usr/bin/env bash
# THE RAILWAY API, AGAINST LOCAL SUPABASE ONLY.
#
# The same process and the same code Railway runs — `worker/main.ts` with
# AGENTORY_ROLE set — pointed at the local stack. Nothing hosted is touched and
# nothing here can reach production: the URL is read from `supabase status` and
# refused unless it is loopback, exactly as start-local-worker.sh does.
#
#   bash scripts/local-supabase/start-local-api.sh              # api + worker
#   AGENTORY_ROLE=api bash scripts/local-supabase/start-local-api.sh   # api only
#
# Routes are served at http://127.0.0.1:$PORT/api/<function>, and /health is the
# worker's own endpoint, unchanged.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

json=$(supabase status -o json)
py() { printf '%s' "$json" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('$1') or '')"; }

export SUPABASE_URL=$(py API_URL)
export SUPABASE_SERVICE_ROLE_KEY=$(py SECRET_KEY)
[ -n "$SUPABASE_SERVICE_ROLE_KEY" ] || export SUPABASE_SERVICE_ROLE_KEY=$(py SERVICE_ROLE_KEY)
export SUPABASE_ANON_KEY=$(py ANON_KEY)
# THE GATE VERIFIES SIGNATURES FOR REAL LOCALLY. Production sets this from the
# project's JWT secret; without it the gate defers to the handler's getUser,
# which is the same decision made one layer later.
export SUPABASE_JWT_SECRET=$(py JWT_SECRET)

case "$SUPABASE_URL" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "refusing: SUPABASE_URL is not local ($SUPABASE_URL)" >&2; exit 1 ;;
esac

# `both` by default: one process serving the API and claiming missions, which is
# the shape recommended for Railway. `AGENTORY_ROLE=api` serves only.
export AGENTORY_ROLE="${AGENTORY_ROLE:-both}"
export AGENTORY_API_ROUTES="${AGENTORY_API_ROUTES:-*}"
export PORT="${PORT:-8795}"

# WHERE THE SERVER'S OWN HAND-OFFS GO. Unset, orchestrate would kick off to the
# local edge runtime; set, it hands off to this process instead, which is what
# makes a local run exercise the migrated path end to end.
export AGENTORY_API_URL="${AGENTORY_API_URL:-http://127.0.0.1:$PORT}"
export AGENTORY_API_FUNCTIONS="${AGENTORY_API_FUNCTIONS:-*}"

if [ -n "${USE_LOCAL_MODEL_STUB:-}" ]; then
  export OPENAI_API_KEY="local-stub-placeholder-not-a-real-key"
  export OPENAI_BASE_URL="http://127.0.0.1:${MODEL_STUB_PORT:-8791}/v1"
  echo "model stub → $OPENAI_BASE_URL (no paid provider is reachable)"
fi

export LEAD_V2_WORKER_WORKSPACES="${LEAD_V2_WORKER_WORKSPACES:-00000000-0000-4000-a000-000000000001}"
export LEAD_WORKER_ID="${LEAD_WORKER_ID:-local-dev-api}"
export LEAD_CREDIT_ENFORCEMENT="${LEAD_CREDIT_ENFORCEMENT:-enforce}"
export MODEL_SPEND_ENFORCEMENT="${MODEL_SPEND_ENFORCEMENT:-enforce}"
export MODEL_SPEND_CEILING_USD="${MODEL_SPEND_CEILING_USD:-1}"
export MODEL_SPEND_PERIOD_DAYS="${MODEL_SPEND_PERIOD_DAYS:-1}"
export EVIDENCE_ENRICHMENT="${EVIDENCE_ENRICHMENT:-off}"
export LINEAGE_LEASE_ENFORCED="${LINEAGE_LEASE_ENFORCED:-true}"
export SIGNALS_V2="${SIGNALS_V2:-true}"

echo "local api ($AGENTORY_ROLE) → $SUPABASE_URL, routes $AGENTORY_API_ROUTES on :$PORT"
exec deno run --allow-env --allow-net --allow-read worker/main.ts
