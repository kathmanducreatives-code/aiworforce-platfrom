#!/usr/bin/env bash
# Own fresh PostgreSQL container only. Never reads a supplied database URL or hosted secret.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
bin="${POSTGREST_BIN:-$(command -v postgrest)}"
name="agentory-outpost-native-$(openssl rand -hex 5)"
pw="$(openssl rand -hex 24)"
auth_pw="$(openssl rand -hex 24)"
jwt_secret="$(openssl rand -hex 32)"
cid=""; rest_pid=""; auth_cid=""; auth_network=""; auth_url=""
log="$(mktemp)"
mutant_sql=""; access_mutant_sql=""; lifecycle_mutant_sql=""
cleanup() {
  if [ -n "$rest_pid" ]; then kill "$rest_pid" 2>/dev/null || true; wait "$rest_pid" 2>/dev/null || true; fi
  if [ -n "$auth_cid" ]; then docker rm -f "$auth_cid" >/dev/null 2>&1 || true; fi
  if [ -n "$cid" ]; then docker rm -f "$cid" >/dev/null 2>&1 || true; fi
  if [ -n "$auth_network" ]; then docker network rm "$auth_network" >/dev/null 2>&1 || true; fi
  rm -f "$log"
  if [ -n "$mutant_sql" ]; then rm -f "$mutant_sql"; fi
  if [ -n "$access_mutant_sql" ]; then rm -f "$access_mutant_sql"; fi
  if [ -n "$lifecycle_mutant_sql" ]; then rm -f "$lifecycle_mutant_sql"; fi
}
trap cleanup EXIT
start_postgres() {
  docker run --rm -d --name "$name" --label agentory.disposable=outpost-native \
    -e "POSTGRES_PASSWORD=$pw" -p 127.0.0.1::5432 "$@" postgres:17.6
}
if [ "${OUTPOST_NATIVE_AUTH:-0}" = 1 ] || [ "${OUTPOST_NATIVE_CONTEXT_AUDIT:-0}" = 1 ] || [ "${OUTPOST_NATIVE_LIFECYCLE_AUTH:-0}" = 1 ]; then
  auth_network="${name}-auth"
  docker network create --label agentory.disposable=outpost-native "$auth_network" >/dev/null
  # Attach at creation: a later network connect can change the selected bridge
  # and invalidate the published localhost mapping on Linux runners.
  cid="$(start_postgres --network "$auth_network")"
else
  cid="$(start_postgres)"
fi
pg_port="$(docker port "$cid" 5432/tcp | sed 's/127.0.0.1://')"
case "$pg_port" in ''|*[!0-9]*) echo 'invalid loopback database port' >&2; exit 2;; esac
db_url="postgres://postgres:$pw@127.0.0.1:$pg_port/postgres"
ready=0
for _ in $(seq 1 60); do
  # A container-local socket can answer during initdb's temporary server, which
  # then shuts down. Require the final server on the actual published TCP path.
  if psql "$db_url" -XAtqc 'select 1' >/dev/null 2>&1; then ready=1; break; fi
  sleep 0.5
done
if [ "$ready" -ne 1 ]; then docker logs "$cid" 2>&1 | tail -20 >&2; exit 1; fi
# Optional actual GoTrue catalog/session lane. No managed-auth fixture in this mode.
if [ "${OUTPOST_NATIVE_AUTH:-0}" = 1 ] || [ "${OUTPOST_NATIVE_CONTEXT_AUDIT:-0}" = 1 ] || [ "${OUTPOST_NATIVE_LIFECYCLE_AUTH:-0}" = 1 ]; then
  psql "$db_url" -X -q -v ON_ERROR_STOP=1 -c 'create schema auth'
  # Official GHCR mirror has the identical pinned OCI index/platform digests;
  # ECR returned Data limit exceeded on CI. No mutable tag or test bypass.
  auth_cid="$(docker run -d --name "${name}-auth" --network "$auth_network" \
    --label agentory.disposable=outpost-native -p 127.0.0.1::9999 \
    -e GOTRUE_API_HOST=0.0.0.0 -e PORT=9999 -e API_EXTERNAL_URL=http://127.0.0.1:9999 \
    -e GOTRUE_SITE_URL=http://127.0.0.1:9999 -e GOTRUE_DB_DRIVER=postgres \
    -e "DATABASE_URL=postgres://postgres:$pw@$name:5432/postgres?sslmode=disable&search_path=auth,public,extensions" \
    -e GOTRUE_DB_NAMESPACE=auth -e "GOTRUE_JWT_SECRET=$jwt_secret" \
    -e GOTRUE_JWT_EXP=3600 -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
    -e GOTRUE_JWT_ADMIN_ROLES=service_role -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true \
    -e GOTRUE_MAILER_AUTOCONFIRM=true -e GOTRUE_DISABLE_SIGNUP=false \
    -e GOTRUE_EXTERNAL_PHONE_ENABLED=false \
    ghcr.io/supabase/gotrue:v2.197.0@sha256:1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b)"
  auth_port="$(docker port "$auth_cid" 9999/tcp | sed 's/127.0.0.1://')" || { docker logs "$auth_cid" 2>&1 | tail -12 | sed -E 's#postgres://[^ ]*#[redacted-db-url]#g'; exit 1; }
  case "$auth_port" in ''|*[!0-9]*) echo 'invalid loopback auth port' >&2; exit 2;; esac
  auth_url="http://127.0.0.1:$auth_port"
  auth_ready=0
  for _ in $(seq 1 90); do
    if curl -fsS -o /dev/null "$auth_url/health" 2>/dev/null; then auth_ready=1; break; fi
    sleep 0.5
  done
  if [ "$auth_ready" -ne 1 ]; then
    # Do not print database URLs or issued tokens in failure logs.
    docker logs "$auth_cid" 2>&1 | tail -12 | sed -E 's#postgres://[^ ]*#[redacted-db-url]#g' >&2
    exit 1
  fi
fi
"$root/tests/db-contract/bootstrap.sh" "$db_url" >"$log" 2>&1 || { tail -20 "$log" >&2; docker logs "$cid" 2>&1 | tail -10 >&2; exit 1; }
if [ "${OUTPOST_NATIVE_AUTH:-0}" != 1 ] && [ "${OUTPOST_NATIVE_CONTEXT_AUDIT:-0}" != 1 ] && [ "${OUTPOST_NATIVE_LIFECYCLE_AUTH:-0}" != 1 ]; then
  psql "$db_url" -X -q -v ON_ERROR_STOP=1 --single-transaction \
    -f "$root/tests/outpost-native/auth-sessions.fixture.sql"
fi
# Optional exact owner dependency, never a hosted target or arbitrary SQL override.
# CI prepares this file from pinned #159; offline runs supply the same local file.
if [ -n "${OUTPOST_NATIVE_MEMBERSHIP_SQL:-}" ]; then
  checksum="$(shasum -a 256 "$OUTPOST_NATIVE_MEMBERSHIP_SQL" | cut -d ' ' -f 1)"
  if [ "$checksum" != 5fb203974a2f79b8d94f3988aec8807c96fb2dae3de17486ecdd803a33970311 ]; then
    echo 'membership dependency checksum mismatch' >&2; exit 2
  fi
  psql "$db_url" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$OUTPOST_NATIVE_MEMBERSHIP_SQL"
  echo 'Owner dependency #159 exact SQL applied to this disposable database only'
fi
if [ -n "${OUTPOST_NATIVE_BRAIN_SQL:-}" ]; then
  checksum="$(shasum -a 256 "$OUTPOST_NATIVE_BRAIN_SQL" | cut -d ' ' -f 1)"
  if [ "$checksum" != d490ead239fbffbbe9467a09eac314d1d1eee705ca231ff08ff5b2b2a34f7340 ]; then
    echo 'Brain dependency checksum mismatch' >&2; exit 2
  fi
  active_brain="$root/supabase/migrations/20261023120000_company_brain_server_writes_only.sql"
  if [ -f "$active_brain" ] && cmp -s "$active_brain" "$OUTPOST_NATIVE_BRAIN_SQL"; then
    echo 'Owner dependency #169 exact SQL already applied by disposable bootstrap'
  else
    psql "$db_url" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$OUTPOST_NATIVE_BRAIN_SQL"
    echo 'Owner dependency #169 exact SQL applied to disposable database only'
  fi
  # Do not infer installed grants from a filename or a passing exit code.
  locked="$(psql "$db_url" -XAtqc "select not has_table_privilege('authenticated','public.company_brain','UPDATE') and not has_table_privilege('anon','public.company_brain','INSERT')")"
  if [ "$locked" != t ]; then echo 'Brain native grant preflight failed' >&2; exit 1; fi
fi
native_sql="$root/supabase/migrations-held/20261022140824_outpost_native_identity_security.sql"
if [ "${OUTPOST_NATIVE_OMIT_OWNER_GUARD:-0}" = 1 ]; then
  mutant_sql="$(mktemp)"
  sed '/-- MUTATION_OWNER_GUARD_BEGIN/,/-- MUTATION_OWNER_GUARD_END/d' "$native_sql" > "$mutant_sql"
  native_sql="$mutant_sql"
  echo 'MUTANT: bound-task ownership guard intentionally removed (negative control)'
fi
psql "$db_url" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$native_sql"
access_sql="$root/supabase/migrations-held/20261023061143_outpost_pilot_api_authorization.sql"
if [ "${OUTPOST_NATIVE_OMIT_TASK_READ_GUARD:-0}" = 1 ]; then
  access_mutant_sql="$(mktemp)"
  sed '/^create policy outpost_bound_task_read /,+1d' "$access_sql" > "$access_mutant_sql"
  access_sql="$access_mutant_sql"
  echo 'MUTANT: public pilot task read guard intentionally removed'
fi
psql "$db_url" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$access_sql"
if [ "${OUTPOST_NATIVE_LIFECYCLE:-0}" = 1 ] || [ "${OUTPOST_NATIVE_LIFECYCLE_AUTH:-0}" = 1 ] || [ "${OUTPOST_NATIVE_TASK_GUARDS:-0}" = 1 ]; then
  lifecycle_sql="$root/supabase/migrations-held/20261023101216_outpost_pilot_task_registration_lifecycle.sql"
  if [ "${OUTPOST_NATIVE_OMIT_LIFECYCLE_GUARD:-0}" = 1 ]; then
    lifecycle_mutant_sql="$(mktemp)"
    sed '/-- MUTATION_LIFECYCLE_GUARD_BEGIN/,/-- MUTATION_LIFECYCLE_GUARD_END/d' "$lifecycle_sql" > "$lifecycle_mutant_sql"
    lifecycle_sql="$lifecycle_mutant_sql"
    echo 'MUTANT: pilot lifecycle guard intentionally removed'
  fi
  psql "$db_url" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$lifecycle_sql"
fi
psql "$db_url" -X -q -c "alter role authenticator with login password '$auth_pw'"
# Intentionally expose the private schema IN THIS TEST ONLY: prove RLS still
# denies foreign rows/writes even after a mistaken PostgREST exposure setting.
# Kernel-selected ports avoid occupied random guesses. A concurrent listener may
# still win after the probe closes: retry ONLY bind failures, at most 3 launches,
# before any test runs. Never retry an assertion, Auth request or database effect.
free_rest_port() {
  python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()'
}
rest_port="${OUTPOST_NATIVE_FIRST_REST_PORT:-$(free_rest_port)}"
case "$rest_port" in ''|*[!0-9]*) echo 'invalid loopback REST port' >&2; exit 2;; esac
# A response from some other HTTP server is not readiness. A test-only invoker
# function returns this disposable database's nonce; it exposes no application
# data and is never part of a migration or a hosted schema.
probe_nonce="$(openssl rand -hex 24)"
psql "$db_url" -X -q -v ON_ERROR_STOP=1 -c "create function public.outpost_test_instance() returns text language sql immutable security invoker set search_path='' as 'select ''$probe_nonce''::text'"
start_postgrest() {
  PGRST_DB_URI="postgres://authenticator:$auth_pw@127.0.0.1:$pg_port/postgres" \
  PGRST_DB_SCHEMAS=public,outpost_private PGRST_DB_ANON_ROLE=anon \
  PGRST_JWT_SECRET="$jwt_secret" PGRST_DB_POOL=4 PGRST_DB_MAX_ROWS=1000 \
  PGRST_DB_EXTRA_SEARCH_PATH=public,extensions PGRST_SERVER_HOST=127.0.0.1 \
  PGRST_SERVER_PORT="$rest_port" "$bin" >"$log" 2>&1 &
  rest_pid=$!
  for _ in $(seq 1 60); do
    kill -0 "$rest_pid" 2>/dev/null || return 1
    if [ "$(curl -fsS -H 'Accept: application/json' "http://127.0.0.1:$rest_port/rpc/outpost_test_instance" 2>/dev/null)" = "\"$probe_nonce\"" ]; then
      kill -0 "$rest_pid" 2>/dev/null && return 0
      return 1
    fi
    sleep 0.5
  done
  return 2
}
for attempt in 1 2 3; do
  if start_postgrest; then break; else startup_rc=$?; fi
  # Reap before another launch. Do not hide crashes/schema failures/timeouts.
  if [ "$startup_rc" -eq 1 ]; then wait "$rest_pid" 2>/dev/null || true; rest_pid=""; fi
  if [ "$startup_rc" -eq 1 ] && grep -Eq 'Address( already)? in use' "$log" && [ "$attempt" -lt 3 ]; then
    echo 'Local REST bind collision; choosing a new port before tests' >&2
    rest_port="$(free_rest_port)"
    continue
  fi
  cat "$log" >&2
  exit 1
done
echo "Disposable PostgreSQL 17.6 + $("$bin" --version); private-schema exposure is test-only"
set +e
if [ -n "${OUTPOST_NATIVE_OWNER_BRAIN_CONTRACT:-}" ]; then
  checksum="$(shasum -a 256 "$OUTPOST_NATIVE_OWNER_BRAIN_CONTRACT" | cut -d ' ' -f 1)"
  if [ "$checksum" != b139086ca9ab87a3a4b19545660a9dfc5789242343903cc982642d0835de98c9 ]; then echo 'owner contract checksum mismatch' >&2; exit 2; fi
  DB_CONTRACT_REST_URL="http://127.0.0.1:$rest_port" DB_CONTRACT_JWT_SECRET="$jwt_secret" \
  DB_CONTRACT_PG_URL="$db_url" deno test --node-modules-dir=none --allow-read --allow-env \
    --allow-net=127.0.0.1,localhost --no-prompt "$OUTPOST_NATIVE_OWNER_BRAIN_CONTRACT"
elif [ "${OUTPOST_NATIVE_LIFECYCLE_AUTH:-0}" = 1 ]; then
  DB_CONTRACT_REST_URL="http://127.0.0.1:$rest_port" DB_CONTRACT_JWT_SECRET="$jwt_secret" \
  DB_CONTRACT_PG_URL="$db_url" OUTPOST_NATIVE_AUTH_URL="$auth_url" \
    deno test --node-modules-dir=none --allow-read --allow-env \
      --allow-net=127.0.0.1,localhost --no-prompt "$root/tests/outpost-native/registration-auth.test.ts"
elif [ "${OUTPOST_NATIVE_LIFECYCLE:-0}" = 1 ]; then
  DB_CONTRACT_REST_URL="http://127.0.0.1:$rest_port" DB_CONTRACT_JWT_SECRET="$jwt_secret" \
  DB_CONTRACT_PG_URL="$db_url" OUTPOST_NATIVE_OMIT_LIFECYCLE_GUARD="${OUTPOST_NATIVE_OMIT_LIFECYCLE_GUARD:-0}" \
    deno test --node-modules-dir=none --allow-read --allow-env \
      --allow-net=127.0.0.1,localhost --no-prompt "$root/tests/outpost-native/task-lifecycle.test.ts" "$root/tests/outpost-native/api-security.test.ts"
elif [ "${OUTPOST_NATIVE_CONTEXT_AUDIT:-0}" = 1 ]; then
  DB_CONTRACT_REST_URL="http://127.0.0.1:$rest_port" DB_CONTRACT_JWT_SECRET="$jwt_secret" \
  DB_CONTRACT_PG_URL="$db_url" OUTPOST_NATIVE_AUTH_URL="$auth_url" \
    deno run --node-modules-dir=none --allow-read --allow-env \
      --allow-net=127.0.0.1,localhost --no-prompt "$root/tests/outpost-native/context-audit.ts"
elif [ "${OUTPOST_NATIVE_SURFACE_AUDIT:-0}" = 1 ]; then
  DB_CONTRACT_REST_URL="http://127.0.0.1:$rest_port" DB_CONTRACT_JWT_SECRET="$jwt_secret" \
  DB_CONTRACT_PG_URL="$db_url" deno run --node-modules-dir=none --allow-read --allow-env \
    --allow-net=127.0.0.1,localhost --no-prompt "$root/tests/outpost-native/surface-audit.ts"
elif [ "${OUTPOST_NATIVE_AUTH:-0}" = 1 ]; then
  DB_CONTRACT_REST_URL="http://127.0.0.1:$rest_port" DB_CONTRACT_JWT_SECRET="$jwt_secret" \
  DB_CONTRACT_PG_URL="$db_url" OUTPOST_NATIVE_AUTH_URL="$auth_url" \
    deno test --node-modules-dir=none --allow-read --allow-env \
      --allow-net=127.0.0.1,localhost --no-prompt "$root/tests/outpost-native/session-security.test.ts"
elif [ "${OUTPOST_NATIVE_PUBLIC_AUDIT:-0}" = 1 ]; then
  DB_CONTRACT_REST_URL="http://127.0.0.1:$rest_port" DB_CONTRACT_JWT_SECRET="$jwt_secret" \
  DB_CONTRACT_PG_URL="$db_url" deno run --node-modules-dir=none --allow-read --allow-env \
    --allow-net=127.0.0.1,localhost --no-prompt "$root/tests/outpost-native/public-task-audit.ts"
else
  DB_CONTRACT_REST_URL="http://127.0.0.1:$rest_port" DB_CONTRACT_JWT_SECRET="$jwt_secret" \
  DB_CONTRACT_PG_URL="$db_url" OUTPOST_NATIVE_MEMBERSHIP_SQL="${OUTPOST_NATIVE_MEMBERSHIP_SQL:-}" OUTPOST_NATIVE_OMIT_TASK_READ_GUARD="${OUTPOST_NATIVE_OMIT_TASK_READ_GUARD:-0}" OUTPOST_NATIVE_OMIT_OWNER_GUARD="${OUTPOST_NATIVE_OMIT_OWNER_GUARD:-0}" \
    deno test --node-modules-dir=none --allow-read --allow-env \
    --allow-net=127.0.0.1,localhost --no-prompt "$root/tests/outpost-native/identity.test.ts" "$root/tests/outpost-native/api-security.test.ts"
fi
status=$?
set -e
if [ "$status" -ne 0 ]; then
  tail -15 "$log" >&2
  if [ -n "$auth_cid" ]; then docker logs "$auth_cid" 2>&1 | tail -12 | sed -E 's#postgres://[^ ]*#[redacted-db-url]#g' >&2; fi
fi
exit "$status"
