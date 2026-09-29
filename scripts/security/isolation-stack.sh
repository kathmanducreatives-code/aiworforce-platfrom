#!/usr/bin/env bash
# A THROWAWAY LOCAL SUPABASE FOR THE TWO-WORKSPACE ISOLATION SUITE.
#
# Real Postgres + RLS, real GoTrue (real user JWTs), real PostgREST — built from
# THIS repository's schema, in timestamp order: the held baseline, then every
# migration (held ones included, because production runs them). Nothing here
# can reach production: it is a separate project id on separate ports, and it
# never reads supabase/config.toml (which names the production project id).
#
#   scripts/security/isolation-stack.sh up     # start (idempotent), print env
#   scripts/security/isolation-stack.sh env    # print env for the test
#   scripts/security/isolation-stack.sh down   # stop and delete its volumes
#
# The test: ISOLATION_STACK=1 deno test --allow-net=127.0.0.1 --allow-env --allow-read tests/security/
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="${ISOLATION_STACK_DIR:-${TMPDIR:-/tmp}/agentory-isolation-stack}"
PROJECT="agentory-isolation"
BASE_PORT="${ISOLATION_STACK_BASE_PORT:-55420}"

prepare() {
  rm -rf "$DIR"
  mkdir -p "$DIR"
  (cd "$DIR" && supabase init --force >/dev/null 2>&1 || (cd "$DIR" && supabase init >/dev/null))
  local cfg="$DIR/supabase/config.toml"
  python3 - "$cfg" "$PROJECT" "$BASE_PORT" <<'PY'
import re, sys
p, project, base = sys.argv[1], sys.argv[2], int(sys.argv[3])
s = open(p).read()
s = re.sub(r'^project_id = ".*"', f'project_id = "{project}"', s, count=1, flags=re.M)
def section(name, body):
    global s
    m = re.search(r'^\[' + re.escape(name) + r'\]\n(.*?)(?=^\[)', s, flags=re.M | re.S)
    if m:
        block = body(m.group(1))
        s = s[:m.start(1)] + block + s[m.end(1):]
def port(n):
    return lambda b: re.sub(r'^port = \d+', f'port = {n}', b, count=1, flags=re.M)
def off(b):
    return re.sub(r'^enabled = true', 'enabled = false', b, count=1, flags=re.M)
section("api", port(base + 1))
section("db", lambda b: re.sub(r'^shadow_port = \d+', f'shadow_port = {base}', port(base + 2)(b), count=1, flags=re.M))
section("db.pooler", port(base + 9))
section("studio", lambda b: off(port(base + 3)(b)))
section("inbucket", lambda b: off(port(base + 4)(b)))
section("analytics", lambda b: off(port(base + 7)(b)))
for name in ("edge_runtime",):
    section(name, off)
# Email confirmation off: the suite creates users through the admin API.
s = re.sub(r'^enable_confirmations = true', 'enable_confirmations = false', s, flags=re.M)
open(p, "w").write(s)
PY
  mkdir -p "$DIR/supabase/migrations"
  # Production has pg_cron and pg_net enabled, but no migration creates them
  # (the cron migrations assume them). A fresh database needs them first.
  cat > "$DIR/supabase/migrations/20260816115900_local_extensions.sql" <<'SQL'
create extension if not exists pg_cron;
create extension if not exists pg_net;
SQL
  # Timestamp order across both folders; the README in migrations-held is not SQL.
  # psql meta-commands (pg_dump's `\restrict`/`\unrestrict`) are not SQL; the
  # migration runner cannot execute them, so the local copy drops them.
  for f in "$REPO"/supabase/migrations-held/*.sql "$REPO"/supabase/migrations/*.sql; do
    grep -v '^\\' "$f" > "$DIR/supabase/migrations/$(basename "$f")"
  done
}

case "${1:-up}" in
  up)
    if ! (cd "$DIR" 2>/dev/null && supabase status >/dev/null 2>&1); then
      prepare
      (cd "$DIR" && supabase start)
    fi
    # ── A STALE STACK MUST NOT PASS ─────────────────────────────────────────
    # `supabase start` reuses running containers without applying anything, so
    # a stack started earlier (another checkout, another TMPDIR) keeps its OLD
    # schema — and the suite then passes without ever seeing a new table
    # (2026-09-29: beta_access_requests was "covered" by a 15-hour-old stack).
    # The newest migration this repo has must be the newest the stack applied.
    want="$(ls "$REPO"/supabase/migrations/*.sql | xargs -n1 basename | sort | tail -1 | cut -d_ -f1)"
    have="$(docker exec "supabase_db_${PROJECT}" psql -U postgres -tA \
      -c "select max(version) from supabase_migrations.schema_migrations" 2>/dev/null | tr -d '[:space:]')"
    if [ "$want" != "$have" ]; then
      echo "STALE ISOLATION STACK: newest applied migration '${have:-none}', this repo's newest '$want'." >&2
      echo "Run: $0 down   (then up again)" >&2
      exit 3
    fi
    (cd "$DIR" && supabase status -o env)
    ;;
  env)
    (cd "$DIR" && supabase status -o env)
    ;;
  down)
    # By PROJECT, not by directory: a stack started from another checkout or
    # another TMPDIR is still this project, and must still go.
    supabase stop --project-id "$PROJECT" --no-backup >/dev/null 2>&1 || true
    (cd "$DIR" 2>/dev/null && supabase stop --no-backup) || true
    rm -rf "$DIR"
    ;;
  *) echo "usage: $0 up|env|down" >&2; exit 2 ;;
esac
