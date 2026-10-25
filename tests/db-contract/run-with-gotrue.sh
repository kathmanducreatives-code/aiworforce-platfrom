#!/usr/bin/env bash
# The database-contract lane WITH a real GoTrue (real sign-up, real sessions,
# real logout) — for the Company Brain end-to-end tests:
#
#   POSTGREST_BIN=/path/to/postgrest tests/db-contract/run-with-gotrue.sh [test files…]
#
# Everything is disposable and loopback-only, and removed on exit:
#   1. a postgres:17.6 container and a pinned GoTrue container on a private
#      Docker network (labelled agentory.disposable=brain-e2e);
#   2. GoTrue migrates its own `auth` schema first; then the lane's bootstrap
#      (tests/db-contract/bootstrap.sh) builds the app schema on the same
#      database — its shim keeps the real auth tables;
#   3. PostgREST on a free localhost port;
#   4. the tests run with BRAIN_E2E_AUTH_URL set, so they sign up real users and
#      send real access tokens. Mail is auto-confirmed locally; nothing is sent.
#      BRAIN_E2E_DENO_FLAGS adds permissions a test needs (the mounted browser
#      test spawns Vite and headless Chrome: --allow-run --allow-write).
# Same GoTrue image and digest as tests/outpost-native/run.sh. No production
# URL, key or secret is read; every credential is minted here.
set -euo pipefail
bin="${POSTGREST_BIN:?set POSTGREST_BIN to the postgrest binary}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
name="brain-e2e-$(openssl rand -hex 4)"
pw="$(openssl rand -hex 16)"
jwt_secret="$(openssl rand -hex 32)"
auth_pw="$(openssl rand -hex 16)"
log="$(mktemp)"
pgrst_pid=""
cleanup() {
  [ -n "$pgrst_pid" ] && kill "$pgrst_pid" 2>/dev/null && wait "$pgrst_pid" 2>/dev/null || true
  docker rm -f "$name-auth" "$name" >/dev/null 2>&1 || true
  docker network rm "$name-net" >/dev/null 2>&1 || true
  rm -f "$log"
}
trap cleanup EXIT

docker network create --label agentory.disposable=brain-e2e "$name-net" >/dev/null
cid="$(docker run --rm -d --name "$name" --network "$name-net" --label agentory.disposable=brain-e2e \
  -e "POSTGRES_PASSWORD=$pw" -p 127.0.0.1::5432 postgres:17.6)"
pg_port="$(docker port "$cid" 5432/tcp | sed 's/127.0.0.1://')"
case "$pg_port" in ''|*[!0-9]*) echo 'invalid loopback database port' >&2; exit 2;; esac
db_url="postgres://postgres:$pw@127.0.0.1:$pg_port/postgres"
for _ in $(seq 1 60); do psql "$db_url" -XAtqc 'select 1' >/dev/null 2>&1 && break; sleep 0.5; done
psql "$db_url" -XAtqc 'select 1' >/dev/null
psql "$db_url" -X -q -v ON_ERROR_STOP=1 -c 'create schema auth'

auth_cid="$(docker run -d --name "$name-auth" --network "$name-net" --label agentory.disposable=brain-e2e -p 127.0.0.1::9999 \
  -e GOTRUE_API_HOST=0.0.0.0 -e PORT=9999 -e API_EXTERNAL_URL=http://127.0.0.1:9999 \
  -e GOTRUE_SITE_URL=http://127.0.0.1:9999 -e GOTRUE_DB_DRIVER=postgres \
  -e "DATABASE_URL=postgres://postgres:$pw@$name:5432/postgres?sslmode=disable&search_path=auth,public,extensions" \
  -e GOTRUE_DB_NAMESPACE=auth -e "GOTRUE_JWT_SECRET=$jwt_secret" \
  -e GOTRUE_JWT_EXP=3600 -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
  -e GOTRUE_JWT_ADMIN_ROLES=service_role -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true \
  -e GOTRUE_MAILER_AUTOCONFIRM=true -e GOTRUE_DISABLE_SIGNUP=false \
  -e GOTRUE_EXTERNAL_PHONE_ENABLED=false \
  ghcr.io/supabase/gotrue:v2.197.0@sha256:1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b)"
auth_port="$(docker port "$auth_cid" 9999/tcp | sed 's/127.0.0.1://')"
case "$auth_port" in ''|*[!0-9]*) echo 'invalid loopback auth port' >&2; exit 2;; esac
auth_url="http://127.0.0.1:$auth_port"
ready=0
for _ in $(seq 1 120); do curl -fsS -o /dev/null "$auth_url/health" 2>/dev/null && { ready=1; break; }; sleep 0.5; done
if [ "$ready" -ne 1 ]; then docker logs "$auth_cid" 2>&1 | tail -12 | sed -E 's#postgres://[^ ]*#[redacted-db-url]#g' >&2; exit 1; fi

PGOPTIONS="-c client_min_messages=warning" "$root/tests/db-contract/bootstrap.sh" "$db_url" >"$log" 2>&1 || { tail -20 "$log" >&2; exit 1; }
psql "$db_url" -X -q -c "alter role authenticator with login password '$auth_pw'" >/dev/null

port=$(( 30000 + RANDOM % 20000 ))
PGRST_DB_URI="postgres://authenticator:$auth_pw@127.0.0.1:$pg_port/postgres" \
PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET="$jwt_secret" \
PGRST_DB_MAX_ROWS=1000 PGRST_DB_EXTRA_SEARCH_PATH=public,extensions \
PGRST_SERVER_HOST=127.0.0.1 PGRST_SERVER_PORT="$port" PGRST_DB_POOL=4 \
  "$bin" >"$log" 2>&1 &
pgrst_pid=$!
for _ in $(seq 1 60); do
  kill -0 "$pgrst_pid" 2>/dev/null || { cat "$log" >&2; exit 1; }
  curl -fsS -o /dev/null "http://127.0.0.1:$port/" 2>/dev/null && break
  sleep 0.5
done
echo "real GoTrue $(curl -fsS "$auth_url/health" | head -c 120); postgrest :$port; postgres $(psql "$db_url" -XAtc 'show server_version')"

set +e
DB_CONTRACT_REST_URL="http://127.0.0.1:$port" DB_CONTRACT_JWT_SECRET="$jwt_secret" DB_CONTRACT_PG_URL="$db_url" \
BRAIN_E2E_AUTH_URL="$auth_url" \
  deno test --node-modules-dir=none --allow-read --allow-env --allow-net=127.0.0.1,localhost --no-prompt ${BRAIN_E2E_DENO_FLAGS:-} \
    "${@:-$root/tests/db-contract/brainAutosaveEndToEnd.contract.test.ts}"
status=$?
set -e
[ $status -ne 0 ] && { echo "--- postgrest log ---"; tail -20 "$log"; }
exit $status
