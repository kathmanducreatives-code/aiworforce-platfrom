#!/usr/bin/env bash
# THE LEAD V2 WORKER, AGAINST LOCAL SUPABASE ONLY.
#
# Reads the local stack's URL and secret key from `supabase status` — never a
# hosted value, and never the production Railway environment. The hosted worker
# is untouched by this; this is a second, local process.
#
# NO PROVIDER KEYS are exported, so a mission that reaches a paid boundary is
# refused by the tool layer instead of spending. Add one here only when you
# intend to spend.
#
#   bash scripts/local-supabase/start-local-worker.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

json=$(supabase status -o json)
export SUPABASE_URL=$(printf '%s' "$json" | python3 -c "import json,sys;print(json.load(sys.stdin).get('API_URL','http://127.0.0.1:54321'))")
export SUPABASE_SERVICE_ROLE_KEY=$(printf '%s' "$json" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('SECRET_KEY') or d.get('SERVICE_ROLE_KEY'))")

case "$SUPABASE_URL" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "refusing: SUPABASE_URL is not local ($SUPABASE_URL)" >&2; exit 1 ;;
esac

# ── THE LOCAL MODEL STUB, OPT-IN ─────────────────────────────────────────────
# The execution planner is a model call, so with no key the pipeline stops at
# `no_api_key` and nothing below planning can be exercised. With this set, the
# planner talks to scripts/local-supabase/model-stub.ts instead. The key is a
# placeholder and the endpoint override is loopback-only (gptProvider refuses
# any other host), so this cannot reach a paid provider.
#
#   USE_LOCAL_MODEL_STUB=1 bash scripts/local-supabase/start-local-worker.sh
if [ -n "${USE_LOCAL_MODEL_STUB:-}" ]; then
  export OPENAI_API_KEY="local-stub-placeholder-not-a-real-key"
  export OPENAI_BASE_URL="http://127.0.0.1:${MODEL_STUB_PORT:-8791}/v1"
  echo "model stub → $OPENAI_BASE_URL (no paid provider is reachable)"
fi

# The seeded local workspace. V2 is on for it and nothing else.
export LEAD_V2_WORKER_WORKSPACES="${LEAD_V2_WORKER_WORKSPACES:-00000000-0000-4000-a000-000000000001}"
export LEAD_WORKER_ID="${LEAD_WORKER_ID:-local-dev-worker}"
export PORT="${PORT:-8790}"

# Parity flags, and spend held at zero.
export LEAD_CREDIT_ENFORCEMENT="${LEAD_CREDIT_ENFORCEMENT:-enforce}"
export MODEL_SPEND_ENFORCEMENT="${MODEL_SPEND_ENFORCEMENT:-enforce}"
# A NOMINAL POSITIVE CEILING, NOT ZERO. `resolveCeiling` treats a non-positive
# ceiling as `ceiling_misconfigured` and refuses every model call with HTTP 429
# — including the deterministic paths that never spend — so a 0 here stops the
# run before a task row exists (queue 2e213c08 failed this way 5 times).
# Spend is held at zero by the ABSENCE OF PROVIDER KEYS above, which is the
# guarantee that actually holds; this number only has to be configured.
# It matches supabase/functions/.env.local, which already carries 1.
export MODEL_SPEND_CEILING_USD="${MODEL_SPEND_CEILING_USD:-1}"
# BOTH halves of the ceiling must be configured — the gate reads a budget, not a
# number, so a missing period is `ceiling_misconfigured` exactly like a zero
# ceiling is. supabase/functions/.env.local carries the same pair.
export MODEL_SPEND_PERIOD_DAYS="${MODEL_SPEND_PERIOD_DAYS:-1}"
export EVIDENCE_ENRICHMENT="${EVIDENCE_ENRICHMENT:-off}"
export LINEAGE_LEASE_ENFORCED="${LINEAGE_LEASE_ENFORCED:-true}"
export SIGNALS_V2="${SIGNALS_V2:-true}"

echo "local worker → $SUPABASE_URL (workspace $LEAD_V2_WORKER_WORKSPACES, health :$PORT)"
exec deno run --allow-env --allow-net --allow-read worker/main.ts
