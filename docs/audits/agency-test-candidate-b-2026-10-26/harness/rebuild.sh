#!/usr/bin/env bash
# Rebuild the local TEST stand-in: rebuild.sh <tree> <port> <ref>
set -euo pipefail
tree="$1"; port="$2"; REF="$3"; cd "$tree"; export PGPASSWORD=localpw
WS=3b0f7c1e-9a2d-4c5b-8e6f-1a2b3c4d5e6f; USR=7d9e2f4a-6b8c-4d1e-9f3a-5b6c7d8e9f01
U="postgres://postgres:localpw@127.0.0.1:$port/$REF"
psql -h 127.0.0.1 -p "$port" -U postgres -X -q -c "drop database if exists $REF" -c "create database $REF" >/dev/null
psql "$U" -X -q -v ON_ERROR_STOP=1 -f tests/db-contract/sql/00_supabase_shim.sql >/dev/null 2>&1
TEST_PROJECT_REF=$REF TEST_DB_URL="$U" scripts/test-project/build-test-schema.sh --confirm $REF --with-held-admission --with-test-no-brain-guard > "$(dirname "$0")/build-$REF.log" 2>&1
echo "build=$? applied=$(grep -c '^applied' "$(dirname "$0")/build-$REF.log")"
if [ "${DRESS_SECURITY:-0}" = 1 ]; then
  # Candidate B: the three held security migrations, each after its read-only preflight, each in one transaction.
  psql "$U" -X -At -F ' ' -f scripts/test-project/tasks-commit-boundary-preflight.sql | tee "$(dirname "$0")/cb-preflight-$REF.txt" | grep -q '^BLOCK' && { echo "COMMIT-BOUNDARY PREFLIGHT BLOCK"; exit 1; }
  for m in 20261025130000_tasks_commit_boundary 20261025150000_task_plans_parent_identity 20261025160000_workspace_members_app_surface; do
    psql "$U" -X -q -v ON_ERROR_STOP=1 --single-transaction -f supabase/migrations-held/$m.sql >/dev/null && echo "applied held $m"
  done
fi
psql "$U" -X -q -v ON_ERROR_STOP=1 <<SQL
insert into auth.users (id, email) values ('$USR', 'operator@test.invalid');
insert into public.workspaces (id, name) values ('$WS', 'TEST workspace') on conflict do nothing;
insert into public.workspace_members (workspace_id, user_id, role) values ('$WS', '$USR', 'owner') on conflict do nothing;
insert into public.agents (workspace_id, slug, name, role_prompt, department) values ('$WS', 'scout', 'Scout', 'Find and verify the requested company using source evidence.', 'research') on conflict do nothing;
insert into public.workspace_credit_balances (workspace_id, balance_credits) values ('$WS', 10) on conflict (workspace_id) do update set balance_credits = 10;
SQL
echo seeded
