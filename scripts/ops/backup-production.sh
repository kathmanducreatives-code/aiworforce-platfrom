#!/usr/bin/env bash
# VERIFIED, RESTORABLE BACKUP OF THE PRODUCTION DATABASE — READ-ONLY.
#
#   PROD_DB_URL='postgresql://postgres.ohsdatpvfdjdemstoiuj:…@…pooler.supabase.com:5432/postgres' \
#   BACKUP_DIR=/secure/place/outside/the/repo \
#     scripts/ops/backup-production.sh --confirm ohsdatpvfdjdemstoiuj
#
# Run it in the owner's shell, BEFORE any production migration. The free plan
# keeps no automatic backups, so this is the only way back.
#
# READ-ONLY BY CONSTRUCTION: every connection to production is opened with
# default_transaction_read_only=on, so neither the dump nor the counts can
# write. Nothing is restored to production; the restore check runs in a
# disposable LOCAL container of production's exact Postgres image.
#
#   1. preflight: the URL must name production, --confirm must repeat it, the
#      server must be production's major version, BACKUP_DIR must be outside the
#      repository and is created 0700.
#   2. counts BEFORE: exact row counts of every table in public, auth and
#      storage, and a catalogue fingerprint (public functions, policies,
#      triggers, columns).
#   3. dump with Postgres 17 tools (docker, image ${PG_TOOLS_IMAGE}):
#        db.dump     pg_dump -Fc of the whole database (schema, data, RLS, grants)
#        roles.sql   the cluster's custom roles, without passwords
#        SHA256SUMS
#   4. counts AFTER. If anything changed while dumping, the run FAILS: take it
#      again in a quiet window (the dump is one snapshot; the counts are not).
#   5. RESTORE CHECK: a fresh ${RESTORE_IMAGE} container (production's image)
#      restores db.dump into a new database. Every table's row count must equal
#      the BEFORE count, the catalogue fingerprint must match, and the restore
#      may only report allow-listed errors: pg_cron/pg_net, which cannot live
#      outside the `postgres` database, and the supabase_functions_admin role.
#   6. manifest.json: what was checked, and the result. The container is removed.
#
# The dump holds customer data and auth users. Keep BACKUP_DIR encrypted and off
# shared storage; never commit it. Storage OBJECTS (files) are not in a database
# dump — the counts report whether any exist.
#
# Rehearsal only: --rehearsal accepts a localhost URL instead of production.
set -euo pipefail
PROD=ohsdatpvfdjdemstoiuj
PG_TOOLS_IMAGE="${PG_TOOLS_IMAGE:-postgres:17.6}"
RESTORE_IMAGE="${RESTORE_IMAGE:-supabase/postgres:17.6.1.155}"
url="${PROD_DB_URL:-}"; out="${BACKUP_DIR:-}"; confirm=""; rehearsal=0
while [ $# -gt 0 ]; do case "$1" in
  --confirm) confirm="${2:-}"; shift 2 ;;
  --rehearsal) rehearsal=1; shift ;;
  *) echo "unknown argument: $1" >&2; exit 2 ;;
esac; done
refuse() { echo "refusing: $*" >&2; exit 1; }
root="$(cd "$(dirname "$0")/../.." && pwd)"

# ── 1. preflight ─────────────────────────────────────────────────────────────
[ -n "$url" ] || refuse "PROD_DB_URL is empty"
if [ $rehearsal -eq 1 ]; then
  case "$url" in postgres://*@127.0.0.1:*|postgresql://*@127.0.0.1:*) ;; *) refuse "--rehearsal only accepts a 127.0.0.1 URL" ;; esac
  [ "$confirm" = "rehearsal" ] || refuse "--rehearsal needs --confirm rehearsal"
else
  [ "$confirm" = "$PROD" ] || refuse "--confirm must be $PROD"
  case "$url" in *"$PROD"*) ;; *) refuse "PROD_DB_URL does not name $PROD" ;; esac
fi
[ -n "$out" ] || refuse "BACKUP_DIR is empty"
mkdir -p "$out"; out="$(cd "$out" && pwd)"
case "$out/" in "$root/"*) refuse "BACKUP_DIR is inside the repository" ;; esac
chmod 700 "$out"
command -v docker >/dev/null && docker info >/dev/null 2>&1 || refuse "docker is required (Postgres 17 tools and the restore check)"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"; dir="$out/prod-$stamp"; mkdir -m 700 "$dir"
# Postgres 17 client tools; read-only session for every production connection.
pgt() { docker run --rm -i --network host -e PGOPTIONS='-c default_transaction_read_only=on' \
          -v "$dir:/out" "$PG_TOOLS_IMAGE" "$@"; }
q() { pgt psql "$url" -X -At -v ON_ERROR_STOP=1 -c "$1"; }

ver="$(q "show server_version_num")" || refuse "cannot connect"
[ "${ver:0:2}" = "17" ] || refuse "server is Postgres $ver; this procedure is for Postgres 17"
[ "$(q "show default_transaction_read_only")" = "on" ] || refuse "the session is not read-only"
echo "connected read-only: Postgres $ver"

# ── 2. counts + fingerprint ──────────────────────────────────────────────────
COUNTS_SQL="$(cat <<'SQL'
select c.table_schema || '.' || c.table_name || E'\t' ||
       (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', c.table_schema, c.table_name), false, true, '')))[1]::text
  from information_schema.tables c
 where c.table_type = 'BASE TABLE' and c.table_schema in ('public','auth','storage')
 order by 1;
SQL
)"
# search_path is pinned: policy expressions are printed relative to it, and the
# production login and the restore login have different defaults.
FINGER_SQL="$(cat <<'SQL'
set search_path = pg_catalog;
select 'functions' || E'\t' || md5(coalesce(string_agg(p.proname || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.proname, md5(pg_get_functiondef(p.oid))), ''))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f';
select 'policies' || E'\t' || md5(coalesce(string_agg(tablename || ':' || policyname || ':' || cmd || ':' || coalesce(qual,'') || ':' || coalesce(with_check,''), ',' order by tablename, policyname), ''))
  from pg_policies where schemaname = 'public';
select 'triggers' || E'\t' || md5(coalesce(string_agg(c.relname || ':' || t.tgname, ',' order by c.relname, t.tgname), ''))
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and not t.tgisinternal;
select 'columns' || E'\t' || md5(coalesce(string_agg(table_name || '.' || column_name || ':' || data_type, ',' order by table_name, column_name), ''))
  from information_schema.columns where table_schema = 'public';
SQL
)"
snapshot() { pgt psql "$url" -X -At -v ON_ERROR_STOP=1 -c "$COUNTS_SQL"; }
fingerprint() { pgt psql "$url" -X -At -v ON_ERROR_STOP=1 -c "$FINGER_SQL"; }
snapshot > "$dir/counts.before.tsv"
fingerprint > "$dir/fingerprint.tsv"
echo "counted $(wc -l < "$dir/counts.before.tsv") tables; storage objects: $(awk -F'\t' '$1=="storage.objects"{print $2}' "$dir/counts.before.tsv")"

# ── 3. dump ──────────────────────────────────────────────────────────────────
# BACKUP_EXCLUDE_SCHEMAS="a b": only if pg_dump reports "permission denied" on a
# platform-owned schema. Each one excluded is recorded in manifest.json.
excl=(); for x in ${BACKUP_EXCLUDE_SCHEMAS:-}; do excl+=(-N "$x"); done
pgt pg_dump "$url" -Fc -Z 6 "${excl[@]}" -f /out/db.dump
pgt pg_dumpall --dbname="$url" --roles-only --no-role-passwords -f /out/roles.sql 2>/dev/null \
  || echo "note: roles could not be listed with this login (expected on Supabase); the restore relies on the platform's roles"
( cd "$dir" && sha256sum db.dump $( [ -f roles.sql ] && echo roles.sql ) > SHA256SUMS )
echo "dumped: $(du -h "$dir/db.dump" | cut -f1)"

# ── 4. counts after ──────────────────────────────────────────────────────────
snapshot > "$dir/counts.after.tsv"
if ! cmp -s "$dir/counts.before.tsv" "$dir/counts.after.tsv"; then
  diff "$dir/counts.before.tsv" "$dir/counts.after.tsv" | head -20 >&2
  echo "FAILED: production changed while dumping; take the backup again in a quiet window" >&2; exit 1
fi

# ── 5. restore check (local, disposable) ─────────────────────────────────────
pw="$(head -c 18 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9')"; name="restore-check-$stamp"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$name" -e POSTGRES_PASSWORD="$pw" -p 127.0.0.1::5432 "$RESTORE_IMAGE" >/dev/null
port="$(docker port "$name" 5432/tcp | head -1 | sed 's/.*://')"
local_url="postgres://supabase_admin:$pw@127.0.0.1:$port"
# The LOCAL container: never production, so no read-only option (it must create a database).
lpg() { docker run --rm -i --network host -v "$dir:/out" "$PG_TOOLS_IMAGE" "$@"; }
for i in $(seq 1 90); do lpg psql "$local_url/postgres" -Atc "select 1" >/dev/null 2>&1 && break; sleep 2; done
lpg psql "$local_url/postgres" -Atqc "create database restore_check"
# No --exit-on-error: the allow-listed extension errors are expected; anything else fails below.
lpg pg_restore -d "$local_url/restore_check" /out/db.dump > "$dir/restore.log" 2>&1 || true
errors="$(grep -c '^pg_restore: error' "$dir/restore.log" || true)"
# Allow-list: pg_cron/pg_net live only in the `postgres` database, and the
# platform role supabase_functions_admin exists on Supabase but not in the image.
unexpected="$(grep '^pg_restore: error' "$dir/restore.log" \
  | grep -Ev 'can only create extension in database postgres|extension "pg_cron" does not exist|schema "cron" does not exist|relation "cron\.[a-z_]+" does not exist|schema "net" does not exist|role "supabase_functions_admin" does not exist' || true)"
rq() { lpg psql "$local_url/restore_check" -X -At -v ON_ERROR_STOP=1 -c "$1"; }
rq "$COUNTS_SQL" > "$dir/counts.restored.tsv"
rq "$FINGER_SQL" > "$dir/fingerprint.restored.tsv"
rows_ok=1; cmp -s "$dir/counts.before.tsv" "$dir/counts.restored.tsv" || rows_ok=0
cat_ok=1;  cmp -s "$dir/fingerprint.tsv" "$dir/fingerprint.restored.tsv" || cat_ok=0
[ $rows_ok -eq 1 ] || { diff "$dir/counts.before.tsv" "$dir/counts.restored.tsv" | head -20 >&2 || true; }
[ $cat_ok -eq 1 ] || { diff "$dir/fingerprint.tsv" "$dir/fingerprint.restored.tsv" >&2 || true; }
[ -z "$unexpected" ] || { echo "unexpected restore errors:" >&2; echo "$unexpected" | head -10 >&2; }

# ── 6. manifest ──────────────────────────────────────────────────────────────
verdict=PASS; { [ $rows_ok -eq 1 ] && [ $cat_ok -eq 1 ] && [ -z "$unexpected" ]; } || verdict=FAIL
cat > "$dir/manifest.json" <<JSON
{ "taken_at": "$stamp", "source": "$( [ $rehearsal -eq 1 ] && echo rehearsal || echo "$PROD" )", "server_version_num": "$ver",
  "tables": $(wc -l < "$dir/counts.before.tsv"), "dump_sha256": "$(cut -d' ' -f1 "$dir/SHA256SUMS" | head -1)",
  "restore_image": "$RESTORE_IMAGE", "excluded_schemas": "${BACKUP_EXCLUDE_SCHEMAS:-}", "row_counts_match": $([ $rows_ok -eq 1 ] && echo true || echo false),
  "catalogue_matches": $([ $cat_ok -eq 1 ] && echo true || echo false),
  "restore_errors": $errors, "unexpected_restore_errors": $([ -z "$unexpected" ] && echo 0 || echo "$unexpected" | wc -l),
  "verdict": "$verdict" }
JSON
echo "backup: $dir"; echo "verdict: $verdict (rows match: $rows_ok, catalogue matches: $cat_ok, restore errors: $errors, unexpected: $([ -z "$unexpected" ] && echo 0 || echo "$unexpected" | wc -l))"
[ "$verdict" = PASS ]
