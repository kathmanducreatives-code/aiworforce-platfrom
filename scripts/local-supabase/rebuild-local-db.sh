#!/usr/bin/env bash
# REBUILD THE LOCAL DATABASE FROM THE REPO'S OWN SQL — LOCAL ONLY.
#
# `supabase db reset` applies `supabase/migrations/` alone, and those are
# INCREMENTAL: they alter tables the baseline creates. The baseline itself is
# held out of that directory on purpose (see supabase/migrations-held/README.md:
# the directory is synced to the production-connected repo, and replaying a
# 2026-08-16 dump against production could restore policies later migrations
# dropped). So a fresh database is built the way that README prescribes —
# baseline first, then every migration in timestamp order — and this script is
# the thing that does it, against localhost and nothing else.
#
# SAFETY: the connection string is hard-coded to the CLI's local database
# (127.0.0.1:54322). It takes no arguments, reads no env for its target, and
# refuses to run if that port is not the local Supabase database.
#
#   ./scripts/local-supabase/rebuild-local-db.sh            # schema + dev seed
#   ./scripts/local-supabase/rebuild-local-db.sh --no-seed  # schema only
set -euo pipefail

DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HELD="$ROOT/supabase/migrations-held"
MIGRATIONS="$ROOT/supabase/migrations"
SEED="$ROOT/scripts/local-supabase/seed-dev.sql"
BOOTSTRAP="$ROOT/scripts/local-supabase/00-local-bootstrap.sql"

# The CLI's own database container, so no psql client is needed on the host.
# Either way the target is the local stack and nothing else.
DB_CONTAINER="${LOCAL_SUPABASE_DB_CONTAINER:-supabase_db_ohsdatpvfdjdemstoiuj}"

if command -v psql >/dev/null 2>&1; then
  psql_sql() { command psql "$DB_URL" -v ON_ERROR_STOP=1 -tAc "$1"; }
  psql_file() { command psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$1"; }
else
  psql_sql() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
  psql_file() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$1"; }
fi

# ── THE GUARD: LOCAL, OR NOTHING ──────────────────────────────────────────────
# The CLI's local database, reached on loopback or through its own container.
# If that is not what answers, stop.
if ! psql_sql "select 1" >/dev/null 2>&1; then
  echo "refusing: no local Supabase database (container $DB_CONTAINER / 127.0.0.1:54322)" >&2
  echo "         run: supabase --workdir scripts/local-supabase/workdir start" >&2
  exit 1
fi
host_is_local=$(psql_sql "select inet_server_addr() is null or inet_server_addr() <<= inet '127.0.0.0/8' or inet_server_addr() <<= inet '172.16.0.0/12'" | tr -d '[:space:]')
if [ "$host_is_local" != "t" ]; then
  echo "refusing: the database that answered is not the local one" >&2
  exit 1
fi

echo "== local database: $DB_URL"

# ── 1. EXTENSIONS THE HOSTED PROJECT ALREADY HAS ─────────────────────────────
# The baseline dump creates none: production had them before it was taken.
echo "== extensions"
psql_file "$BOOTSTRAP"

# ── 2. THE BASELINE, THEN EVERY MIGRATION IN TIMESTAMP ORDER ─────────────────
# Held and shipped migrations are interleaved by their timestamp prefix, which
# is the order production applied them in.
echo "== baseline schema"
psql_file "$HELD/20260816120000_baseline_schema.sql"

echo "== migrations"
# Held files that a local database needs, interleaved with the shipped
# migrations by their timestamp prefix — the order production applied them in.
FILES=()
while IFS= read -r line; do FILES+=("$line"); done < <(
  {
    ls "$MIGRATIONS"/*.sql 2>/dev/null || true
    ls "$HELD"/20260910140000_lead_mission_v2_claim.sql 2>/dev/null || true
    ls "$HELD"/20260912160000_content_format_model.sql 2>/dev/null || true
    ls "$HELD"/20260915120000_sweep_skips_v2_queue_tasks.sql 2>/dev/null || true
  } | while IFS= read -r p; do printf '%s\t%s\n' "$(basename "$p")" "$p"; done | sort | cut -f2
)
applied=0; skipped=0
for f in "${FILES[@]}"; do
  name="$(basename "$f")"
  if psql_file "$f" >/dev/null 2>"$ROOT/.local-migration-error"; then
    applied=$((applied + 1))
  else
    # ── PRODUCTION-ONLY DEPENDENCIES ARE SKIPPED, NEVER WEAKENED ────────────
    # The three cron migrations schedule `net.http_post` calls that read a
    # secret from `vault.decrypted_secrets` — a hosted secret this machine does
    # not have, and must not. Nothing local needs the schedules: the sweeper and
    # the monitoring tick are invoked directly in development. The migration
    # files are left exactly as production needs them.
    if grep -qE "vault\.decrypted_secrets|cron\.schedule" "$f"; then
      echo "   skipped (hosted cron/vault): $name"
      skipped=$((skipped + 1))
    else
      echo "   FAILED: $name" >&2
      cat "$ROOT/.local-migration-error" >&2
      rm -f "$ROOT/.local-migration-error"
      exit 1
    fi
  fi
done
rm -f "$ROOT/.local-migration-error"
echo "   applied $applied, skipped $skipped"

# ── 2b. NO LOCAL SCHEDULE MAY CALL THE HOSTED PROJECT ────────────────────────
# The cron migrations schedule `net.http_post` at the literal hosted URL. They
# apply fine locally and would then fire at the restricted production project
# every few minutes. Removed here, locally; the migrations are untouched.
echo "== detaching hosted cron schedules"
psql_file "$ROOT/scripts/local-supabase/01-local-cron-detach.sql"

# ── 3. DEV SEED ──────────────────────────────────────────────────────────────
if [ "${1:-}" != "--no-seed" ]; then
  echo "== dev seed"
  psql_file "$SEED"
fi

echo "== done"
psql_sql "select count(*) || ' tables' from information_schema.tables where table_schema='public'"
