#!/usr/bin/env bash
# DRESS REHEARSAL of the first TEST mission (agency-only, zero-Apify, real-GPT
# procedure) on a candidate tree, against a database built by the real
# build-test-schema.sh. Local only: OpenAI is scripted (tests/realprocess
# vendorPreload), Apify is denied at the Deno level as in providers=openai-only.
#   dress.sh <tree> <admin-url-base e.g. postgres://postgres:pw@127.0.0.1:5436> <db> <out>
set -euo pipefail
tree="$1"; base="$2"; db="$3"; out="$4"; mkdir -p "$out"; cd "$tree"
U="$base/$db"; WS=3b0f7c1e-9a2d-4c5b-8e6f-1a2b3c4d5e6f; USR=7d9e2f4a-6b8c-4d1e-9f3a-5b6c7d8e9f01
secret="$(openssl rand -hex 32)"; pw="$(openssl rand -hex 12)"; port=$(( 30000 + RANDOM % 20000 ))
here="$(cd "$(dirname "$0")" && pwd)"
psql "$U" -X -q -c "alter role authenticator with login password '$pw'"
hostport="${base##*@}"
PGRST_DB_URI="postgres://authenticator:$pw@$hostport/$db" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET="$secret" \
  PGRST_DB_EXTRA_SEARCH_PATH=public,extensions PGRST_SERVER_HOST=127.0.0.1 PGRST_SERVER_PORT="$port" PGRST_DB_POOL=4 \
  /opt/tools/postgrest > "$out/postgrest.log" 2>&1 & pg=$!
trap 'kill $pg 2>/dev/null || true; [ -n "${wk:-}" ] && kill $wk 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -fsS -o /dev/null "http://127.0.0.1:$port/" 2>/dev/null && break; sleep 0.5; done
REST="http://127.0.0.1:$port"; KEY="$(deno run -q "$here/mint.ts" "$secret" service_role)"
echo "== 1. preflight (read-only)"; psql "$U" -X -v workspace_id="$WS" -f scripts/test-project/real-gpt/preflight.sql | grep -cE "\| PASS$" | sed 's/^/PASS rows: /'
psql "$U" -X -v workspace_id="$WS" -f scripts/test-project/real-gpt/preflight.sql | grep -E "\| FAIL$" && { echo "PREFLIGHT FAIL"; exit 1; } || true
echo "== 2. prepare the kickoff (offline, --proposal: 0 model calls)"
# DRESS_COMPILE=scripted: the real compile path (one Luna call, its ledger row) against the scripted vendor; else --proposal.
if [ "${DRESS_COMPILE:-proposal}" = scripted ]; then compile_args=(); pre=(--preload "$here/compilePreload.ts"); else compile_args=(--proposal docs/launch/proposals/a7-reviewed-mission-proposal.json); pre=(); fi
DRESS_TREE="$tree" DRESS_COMPILE_LOG="$out/compile.log" OPENAI_API_KEY=scripted-no-network DB_CONTRACT_REST_URL="$REST" DB_CONTRACT_JWT_SECRET="$secret" DB_CONTRACT_PG_URL="$U" \
deno run -q --node-modules-dir=none --allow-env --allow-read --allow-write="$out" "${pre[@]}" scripts/test-project/real-gpt/prepare-real-gpt-kickoff.ts \
  --approved-by "dress rehearsal $(date -u +%F)" --out "$out" --workspace "$WS" --user "$USR" --pricing-version dress-v1 \
  --jobs-max 5000 --details-max 5000 --observed-at "$(date -u -d '-1 min' +%FT%TZ)" --price-source "synthetic dress rehearsal; not a vendor quote" \
  "${compile_args[@]}" | tail -3
queue="$(grep -A1 'insert into public.lead_mission_queue' "$out/kickoff.sql" | grep -oE "[0-9a-f-]{36}" | head -1)"; echo "queue $queue"
grep -qF '{"apify:harvestapi~linkedin-job-search":0,"apify:harvestapi~linkedin-company":0}'"'"'::jsonb, 300)' "$out/kickoff.sql" && echo "zero-start authorization: both actors 0 starts" || { echo "ZERO-START MAP MISSING"; exit 1; }
echo "== 3. start the worker (openai-only: no Apify token, Deno denies api.apify.com:443), then run kickoff.sql"
events="$out/events.jsonl"; : > "$events"
# DRESS_PROVIDERS=off: no model key at all and Deno denies api.openai.com too (the providers-off session).
if [ "${DRESS_PROVIDERS:-openai}" = off ]; then worker_openai=(); extra_deny=",api.openai.com:443"; else worker_openai=(OPENAI_API_KEY=scripted-no-network); extra_deny=""; fi
env -i PATH="$PATH" HOME="$HOME" DENO_DIR="${DENO_DIR:-$HOME/.cache/deno}" \
  DB_CONTRACT_REST_URL="$REST" DB_CONTRACT_JWT_SECRET="$secret" DB_CONTRACT_PG_URL="$U" \
  SUPABASE_URL="$REST" SUPABASE_SERVICE_ROLE_KEY="$KEY" SUPABASE_ANON_KEY="$KEY" ${worker_openai[@]+"${worker_openai[@]}"} \
  LEAD_V2_WORKER_WORKSPACES="$WS" AGENTORY_ROLE=worker PORT=$(( port + 1 )) LEAD_WORKER_IDLE_POLL_MS=500 \
  LEAD_CREDIT_ENFORCEMENT=enforce LINEAGE_LEASE_ENFORCED=true DISCOVERY_SMOKE_ADMISSION=enforce LEAD_V2_SMOKE_WALL_CLOCK=enforce \
  LEAD_V2_SMOKE_ORCHESTRATION=minimal LEAD_STRATEGIST_PROVIDER=openai LEAD_V2_MISSION_PROVIDER_USD_CAP=0.20 LEAD_V2_MISSION_CREDIT_CAP=5 \
  LEAD_MAX_AUTO_CONTINUATIONS=1 MODEL_SPEND_ENFORCEMENT=enforce MODEL_SPEND_CEILING_USD=0.05 MODEL_SPEND_PERIOD_DAYS=1 MODEL_RUN_MAX_CALLS=2 \
  LEAD_WORKER_MAX_RUNTIME_MS=150000 REHEARSAL_EVENTS="$events" REHEARSAL_SCENARIO='{}' \
  deno run --node-modules-dir=none --allow-env --allow-read --allow-write="$events" --allow-net=127.0.0.1,localhost,0.0.0.0 \
    --deny-net=api.apify.com:443$extra_deny --preload tests/realprocess/vendorPreload.ts worker/main.ts > "$out/worker.log" 2>&1 & wk=$!
sleep 3
psql "$U" -X -q -v ON_ERROR_STOP=1 -f "$out/kickoff.sql"
echo "kickoff committed; waiting for the mission to end"
for _ in $(seq 1 240); do
  s="$(psql "$U" -XAtc "select status from public.lead_mission_queue where id = '$queue'")"
  case "$s" in complete|failed|cancelled) break ;; esac; sleep 1
done
echo "queue: $s"; kill -TERM $wk; wait $wk 2>/dev/null || true; wk=""
echo "== 4. evidence + judge"
psql "$U" -X -At -v queue_id="$queue" -f scripts/test-project/real-gpt/real-gpt-evidence.sql > "$out/evidence.json"
deno run -q --node-modules-dir=none --allow-read scripts/test-project/real-gpt/judge-real-gpt-run.ts $([ "${DRESS_PROVIDERS:-openai}" = off ] && echo --providers-off) "$out/evidence.json" | tee "$out/judge.txt" | tail -6 || echo "(judge exit non-zero)"
echo "== 5. reconciliation (read-only)"
psql "$U" -X -v queue_id="$queue" -f scripts/test-project/smoke-reconciliation.sql 2>&1 | tail -4
psql "$U" -X -v queue_id="$queue" -f scripts/test-project/smoke-credit-reconciliation.sql 2>&1 | tail -4
echo "== vendor traffic: $(grep -c '"type":"vendor"' "$events") vendor, $(grep -c 'api.apify.com' "$events" || true) Apify, $(grep -c '"type":"forbidden"' "$events" || true) forbidden"
psql "$U" -XAtc "select 'balance='||balance_credits||' reserved='||reserved_credits from public.workspace_credit_balances where workspace_id='$WS'"
