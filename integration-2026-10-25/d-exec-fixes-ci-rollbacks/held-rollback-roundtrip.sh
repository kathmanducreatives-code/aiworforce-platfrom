#!/usr/bin/env bash
# Rollback round trips for every held migration that ships a rollback, on a
# fresh LOCAL database. Usage: roundtrip.sh <repo-root> <admin-url-base>
set -uo pipefail
root="$1"; base="$2"; held="$root/supabase/migrations-held"; out="$(dirname "$0")"
db="rt_$(date +%s)"; psql "$base/postgres" -XAtqc "create database $db" >/dev/null
url="$base/$db"
/usr/lib/postgresql/17/bin/pg_dump --version >/dev/null || exit 2
"$root/tests/db-contract/bootstrap.sh" "$url" > "$out/bootstrap.log" 2>&1 || { tail -5 "$out/bootstrap.log"; exit 1; }
dump() { /usr/lib/postgresql/17/bin/pg_dump -s -O --no-comments "$url" | grep -vE '^(--|SET |SELECT pg_catalog.set_config|\\(un)?restrict )' | sed '/^$/d' > "$1"; }
apply() { psql "$url" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$1" >/dev/null 2>"$out/err.txt"; }
dump "$out/full.sql"
# Only those the bootstrap applied (it is the TEST order).
applied=($(grep -oE 'applied supabase/migrations-held/[0-9]{14}[^ ]*\.sql' "$out/bootstrap.log" | sed 's#applied supabase/migrations-held/##'))
with_down=()
for f in "${applied[@]}"; do [ -f "$held/rollback/${f%.sql}.down.sql" ] && with_down+=("$f"); done
echo "held applied: ${#applied[@]}; with rollback: ${#with_down[@]}"
fail=0
# Stack order: before each rollback (last first) snapshot the schema, roll it
# back (it must change something), then re-apply forward; after each re-apply
# the schema must equal its snapshot exactly.
for ((i=${#with_down[@]}-1; i>=0; i--)); do f="${with_down[$i]}"
  dump "$out/pre-$i.sql"
  if ! apply "$held/rollback/${f%.sql}.down.sql"; then echo "FAIL down  $f: $(head -2 "$out/err.txt")"; fail=1; continue; fi
  dump "$out/post-$i.sql"
  cmp -s "$out/pre-$i.sql" "$out/post-$i.sql" && { echo "FAIL down  $f: its rollback changed nothing"; fail=1; }
done
for ((i=0; i<${#with_down[@]}; i++)); do f="${with_down[$i]}"
  if ! apply "$held/$f"; then echo "FAIL up    $f: $(head -2 "$out/err.txt")"; fail=1; continue; fi
  dump "$out/re-$i.sql"
  if cmp -s "$out/re-$i.sql" "$out/pre-$i.sql"; then echo "ok   down+up restores the schema exactly: $f"
  else echo "FAIL up    $f: schema differs from before its rollback"; diff "$out/pre-$i.sql" "$out/re-$i.sql" | head -8; fail=1; fi
done
dump "$out/after-all.sql"
cmp -s "$out/after-all.sql" "$out/full.sql" && echo "ok   full stack identical after teardown and reapply" || { echo "FAIL full stack differs"; fail=1; }
psql "$base/postgres" -XAtqc "drop database $db with (force)" >/dev/null
exit $fail
