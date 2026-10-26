#!/usr/bin/env bash
# The checklist's hosted sequence, rehearsed locally on ONE database with the branch's own tooling:
#   build (--with-held-security) → seed-agency-test.sql → preflight → providers-off run + judge
#   → stop the authorization → preflight again → scripted-GPT zero-Apify run + judge → final preflight.
#   operator-sequence.sh <tree> <port> <db> <outdir>
set -euo pipefail
tree="$1"; port="$2"; db="$3"; out="$4"; here="$(cd "$(dirname "$0")" && pwd)"; export PGPASSWORD=localpw
WS=3b0f7c1e-9a2d-4c5b-8e6f-1a2b3c4d5e6f; USR=7d9e2f4a-6b8c-4d1e-9f3a-5b6c7d8e9f01
base="postgres://postgres:localpw@127.0.0.1:$port"; U="$base/$db"; mkdir -p "$out"; cd "$tree"
echo "== tree $(git rev-parse HEAD)"
psql -h 127.0.0.1 -p "$port" -U postgres -X -q -c "drop database if exists $db" -c "create database $db" >/dev/null 2>&1
psql "$U" -X -q -v ON_ERROR_STOP=1 -f tests/db-contract/sql/00_supabase_shim.sql >/dev/null 2>&1
TEST_PROJECT_REF=$db TEST_DB_URL="$U" scripts/test-project/build-test-schema.sh --confirm $db --with-held-admission --with-test-no-brain-guard --with-held-security > "$out/build.log" 2>&1
echo "build: $(grep -c '^applied' "$out/build.log") applied; $(tail -1 "$out/build.log")"
psql "$U" -Xqc "insert into auth.users (id, email) values ('$USR', 'operator@test.invalid')"
psql "$U" -X -v ON_ERROR_STOP=1 --single-transaction -v workspace_id=$WS -v user_id=$USR -f scripts/test-project/seed-agency-test.sql > "$out/seed.txt" 2>&1
grep -E "credits|member role" "$out/seed.txt"
pf() { PGOPTIONS='-c default_transaction_read_only=on' psql "$U" -X -v workspace_id=$WS -f scripts/test-project/real-gpt/preflight.sql > "$out/preflight-$1.txt"
       echo "preflight $1: $(grep -c '| PASS$' "$out/preflight-$1.txt") PASS, $(grep -c '| INFO$' "$out/preflight-$1.txt") INFO, $(grep -c '| FAIL$' "$out/preflight-$1.txt") FAIL $(grep '| FAIL$' "$out/preflight-$1.txt" | awk -F'|' '{print $1}' | tr -d ' \n')"; }
pf 1-initial
echo "== providers-off"
DRESS_PROVIDERS=off "$here/dress.sh" "$tree" "$base" "$db" "$out/off" > "$out/off.log" 2>&1 || true
grep -E "^queue|AUTOMATIC|vendor traffic|balance=" "$out/off.log"
q="$(grep -m1 '^queue ' "$out/off.log" | awk '{print $2}')"
pf 2-after-off
psql "$U" -XAtc "select public.stop_discovery_smoke('$q', 'providers-off rehearsal complete')" > /dev/null && echo "stopped authorization of $q"
pf 3-after-stop
echo "== scripted-GPT zero-Apify"
DRESS_COMPILE=scripted "$here/dress.sh" "$tree" "$base" "$db" "$out/gpt" > "$out/gpt.log" 2>&1 || true
grep -E "^queue|AUTOMATIC|vendor traffic|balance=" "$out/gpt.log"
q2="$(grep -m1 '^queue ' "$out/gpt.log" | awk '{print $2}')"
psql "$U" -XAtc "select public.stop_discovery_smoke('$q2', 'zero-Apify rehearsal complete')" > /dev/null && echo "stopped authorization of $q2"
pf 4-final
