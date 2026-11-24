#!/usr/bin/env bash
# INSTALL CANDIDATE B'S THREE HELD SECURITY MIGRATIONS ON A NON-PRODUCTION
# SUPABASE PROJECT (agency-only TEST). Running it needs explicit approval.
#
#   TEST_PROJECT_REF=<ref> TEST_DB_URL='postgresql://…<ref>…' \
#     scripts/test-project/install-held-security.sh --confirm <ref>
#
# In this order, each in its own transaction, stopping at the first error:
#   20261025130000_tasks_commit_boundary        (#179: a task is written only by a member, under a plan of its workspace)
#   20261025150000_task_plans_parent_identity   (#189: a plan never moves workspace; a foreign task's plan id is never reused)
#   20261025160000_workspace_members_app_surface (#190: application roles never update/delete/truncate memberships)
# Nothing else: no client schema (#176/#186), no billing pair, no OWN-01, no pilot migration.
#
# Refuses, before any connection: an empty, live or abandoned ref; --confirm not
# repeating it; a TEST_DB_URL that does not name it or names a refused project.
# Refuses, after connecting but before writing: a BLOCK from the commit
# boundary's read-only preflight; a partial installation (some of the three
# triggers present). All three present: reports "already installed", writes nothing.
# Ends with preflight P15/P16 (the installed triggers and grants).
set -euo pipefail

REFUSED_REFS="ohsdatpvfdjdemstoiuj wqnigjhcwjxtmordrwno"
ref="${TEST_PROJECT_REF:-}"
url="${TEST_DB_URL:-}"
confirm=""
while [ $# -gt 0 ]; do
  case "$1" in
    --confirm) confirm="${2:-}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

refuse() { echo "refusing: $*" >&2; exit 1; }
[ -n "$ref" ] || refuse "TEST_PROJECT_REF is empty"
for r in $REFUSED_REFS; do
  [ "$ref" != "$r" ] || refuse "$ref is the live or the abandoned project, never a test target"
  case "$url" in *"$r"*) refuse "TEST_DB_URL names $r" ;; esac
done
[ "$confirm" = "$ref" ] || refuse "--confirm must repeat TEST_PROJECT_REF exactly"
case "$url" in
  postgres://*"$ref"*|postgresql://*"$ref"*) ;;
  *) refuse "TEST_DB_URL must be a postgres URL that names $ref" ;;
esac

root="$(cd "$(dirname "$0")/../.." && pwd)"
held="$root/supabase/migrations-held"
migrations=(
  20261025130000_tasks_commit_boundary.sql
  20261025150000_task_plans_parent_identity.sql
  20261025160000_workspace_members_app_surface.sql
)
for f in "${migrations[@]}"; do [ -f "$held/$f" ] || refuse "missing supabase/migrations-held/$f"; done
q() { psql "$url" -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }

q "select 1" >/dev/null || refuse "cannot connect to TEST_DB_URL"
present="$(q "select count(*) from pg_trigger t where not t.tgisinternal and t.tgname in
  ('tasks_commit_boundary', 'task_plans_parent_identity', 'workspace_members_app_surface', 'workspace_members_app_surface_truncate')")"
if [ "$present" = "4" ]; then
  echo "already installed: all four security triggers are present; nothing written"
else
  [ "$present" = "0" ] || refuse "a partial installation ($present of 4 security triggers present); resolve it by hand, with approval"
  pre="$(psql "$url" -X -At -F ' ' -v ON_ERROR_STOP=1 -f "$root/scripts/test-project/tasks-commit-boundary-preflight.sql")"
  echo "$pre" | sed 's/^/  preflight: /'
  ! echo "$pre" | grep -q '^BLOCK' || refuse "the commit boundary's preflight reports BLOCK; nothing was written"
  for f in "${migrations[@]}"; do
    psql "$url" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$held/$f" >/dev/null 2>&1 \
      || refuse "$f failed and was rolled back; the migrations before it stay installed"
    echo "applied supabase/migrations-held/$f"
  done
fi
check="$(q "select (select count(*) from pg_trigger t where not t.tgisinternal and t.tgenabled <> 'D' and t.tgname in
    ('tasks_commit_boundary', 'task_plans_parent_identity', 'workspace_members_app_surface', 'workspace_members_app_surface_truncate'))
  || ' ' || (not has_table_privilege('service_role', 'public.workspace_members', 'UPDATE')
         and not has_table_privilege('service_role', 'public.workspace_members', 'DELETE')
         and not has_table_privilege('service_role', 'public.workspace_members', 'TRUNCATE'))::text")"
[ "$check" = "4 true" ] || { echo "FAILED: security state after install is '$check' (want '4 true')" >&2; exit 1; }
echo "security migrations installed on $ref (P15 4, P16 ok)"
