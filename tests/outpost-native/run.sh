#!/usr/bin/env bash
# Own fresh PostgreSQL container only. Never reads a supplied database URL or hosted secret.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
bin="${POSTGREST_BIN:-$(command -v postgrest)}"
name="agentory-outpost-native-$(openssl rand -hex 5)"
pw="$(openssl rand -hex 24)"
auth_pw="$(openssl rand -hex 24)"
jwt_secret="$(openssl rand -hex 32)"
cid=""; rest_pid=""
log="$(mktemp)"
mutant_sql=""
cleanup() {
  if [ -n "$rest_pid" ]; then kill "$rest_pid" 2>/dev/null || true; wait "$rest_pid" 2>/dev/null || true; fi
  if [ -n "$cid" ]; then docker rm -f "$cid" >/dev/null 2>&1 || true; fi
  rm -f "$log"
  if [ -n "$mutant_sql" ]; then rm -f "$mutant_sql"; fi
}
trap cleanup EXIT
cid="$(docker run --rm -d --name "$name" --label agentory.disposable=outpost-native \
  -e "POSTGRES_PASSWORD=$pw" -p 127.0.0.1::5432 postgres:17.6)"
pg_port="$(docker port "$cid" 5432/tcp | sed 's/127.0.0.1://')"
case "$pg_port" in ''|*[!0-9]*) echo 'invalid loopback database port' >&2; exit 2;; esac
for _ in $(seq 1 60); do
  docker exec "$cid" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 0.5
done
db_url="postgres://postgres:$pw@127.0.0.1:$pg_port/postgres"
"$root/tests/db-contract/bootstrap.sh" "$db_url" >"$log" 2>&1 || { tail -20 "$log" >&2; exit 1; }
psql "$db_url" -X -q -v ON_ERROR_STOP=1 --single-transaction \
  -f "$root/tests/outpost-native/auth-sessions.fixture.sql"
native_sql="$root/supabase/migrations-held/20261022140824_outpost_native_identity_security.sql"
if [ "${OUTPOST_NATIVE_OMIT_OWNER_GUARD:-0}" = 1 ]; then
  mutant_sql="$(mktemp)"
  sed '/-- MUTATION_OWNER_GUARD_BEGIN/,/-- MUTATION_OWNER_GUARD_END/d' "$native_sql" > "$mutant_sql"
  native_sql="$mutant_sql"
  echo 'MUTANT: bound-task ownership guard intentionally removed (negative control)'
fi
psql "$db_url" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$native_sql"
psql "$db_url" -X -q -c "alter role authenticator with login password '$auth_pw'"
# Intentionally expose the private schema IN THIS TEST ONLY: prove RLS still
# denies foreign rows/writes even after a mistaken PostgREST exposure setting.
rest_port="$(( 30000 + RANDOM % 20000 ))"
PGRST_DB_URI="postgres://authenticator:$auth_pw@127.0.0.1:$pg_port/postgres" \
PGRST_DB_SCHEMAS=public,outpost_private PGRST_DB_ANON_ROLE=anon \
PGRST_JWT_SECRET="$jwt_secret" PGRST_DB_POOL=4 PGRST_DB_MAX_ROWS=1000 \
PGRST_DB_EXTRA_SEARCH_PATH=public,extensions PGRST_SERVER_HOST=127.0.0.1 \
PGRST_SERVER_PORT="$rest_port" "$bin" >"$log" 2>&1 &
rest_pid=$!
for _ in $(seq 1 60); do
  kill -0 "$rest_pid" 2>/dev/null || { cat "$log" >&2; exit 1; }
  curl -fsS -o /dev/null "http://127.0.0.1:$rest_port/" 2>/dev/null && break
  sleep 0.5
done
echo "Disposable PostgreSQL 17.6 + $("$bin" --version); private-schema exposure is test-only"
set +e
if [ "${OUTPOST_NATIVE_PUBLIC_AUDIT:-0}" = 1 ]; then
  DB_CONTRACT_REST_URL="http://127.0.0.1:$rest_port" DB_CONTRACT_JWT_SECRET="$jwt_secret" \
  DB_CONTRACT_PG_URL="$db_url" deno run --node-modules-dir=none --allow-read --allow-env \
    --allow-net=127.0.0.1,localhost --no-prompt "$root/tests/outpost-native/public-task-audit.ts"
else
  DB_CONTRACT_REST_URL="http://127.0.0.1:$rest_port" DB_CONTRACT_JWT_SECRET="$jwt_secret" \
  DB_CONTRACT_PG_URL="$db_url" OUTPOST_NATIVE_OMIT_OWNER_GUARD="${OUTPOST_NATIVE_OMIT_OWNER_GUARD:-0}" \
    deno test --node-modules-dir=none --allow-read --allow-env \
    --allow-net=127.0.0.1,localhost --no-prompt "$root/tests/outpost-native/identity.test.ts"
fi
status=$?
set -e
if [ "$status" -ne 0 ]; then tail -15 "$log" >&2; fi
exit "$status"
