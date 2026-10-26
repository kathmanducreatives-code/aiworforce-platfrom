#!/usr/bin/env bash
# Build a DISPOSABLE database for the database-contract lane.
#
#   tests/db-contract/bootstrap.sh <postgres-url>
#
# Applies, in order: the Supabase platform shim (sql/00_supabase_shim.sql),
# the held schema baseline, every migration in supabase/migrations/, the held
# Lead V2 queue migrations, the held billing fix, the held smoke admission,
# then the held Phase 3c client schema. The held files are applied HERE ONLY — to a throwaway database
# this lane creates and destroys. They are not approved for production
# (supabase/migrations-held/README.md) and nothing in this lane can reach
# production: the URL must point at localhost, which is checked below.
set -euo pipefail
url="${1:?usage: bootstrap.sh <postgres-url>}"
case "$url" in
  postgres://*@127.0.0.1:*|postgres://*@localhost:*|postgresql://*@127.0.0.1:*|postgresql://*@localhost:*) ;;
  *) echo "refusing: the contract lane only builds a database on localhost" >&2; exit 2 ;;
esac
root="$(cd "$(dirname "$0")/../.." && pwd)"
held="$root/supabase/migrations-held"
# The held Lead V2 queue chain, in dependency order (see the held README).
held_v2=(
  20260910140000_lead_mission_v2_claim.sql
  20260915120000_sweep_skips_v2_queue_tasks.sql
  20261003120000_lead_mission_v2_continuations_not_retries.sql
  20261011120000_lead_mission_v2_productive_continuation_no_backoff.sql
  20261019120000_lead_mission_v2_exhausted_lease_terminal.sql
)
# The held billing fix: refunded credit keys are re-armed, not replayed.
held_billing=(
  20261015130000_credits_rearm_settled_key.sql
)
# The held smoke admission: one durable authorization per queue row. Depends on
# the V2 chain above.
held_admission=(
  20261015140000_discovery_smoke_admission.sql
)
# The held Company Brain Phase 3c client schema: canonical clients, grant
# generations, one Brain per client (#174, proposal; not approved).
held_client=(
  20261024160000_client_company_brain.sql
  # Backend's canonical membership writers (#174 O3 A, §9.4); need the triggers above.
  20261025140000_workspace_member_writers.sql
  # The direct-write boundary: application roles change memberships only through those writers.
  20261025160000_workspace_members_app_surface.sql
  # Immutable task pins (#174 §9.1): client tasks carry the authorization they were created under.
  20261025170000_task_client_pins.sql
)
# DB_CONTRACT_OMIT_HELD names ONE file to leave out: a held file, or a file in
# supabase/migrations/ by its basename. It is for tests/db-contract/mutation.sh,
# which proves the credit, admission and membership tests fail without their
# migrations; nothing else sets it.
omit="${DB_CONTRACT_OMIT_HELD:-}"
apply() {
  psql "$url" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$1" >/dev/null \
    || { echo "FAILED applying ${1#$root/}" >&2; exit 1; }
  echo "applied ${1#$root/}"
}
apply "$root/tests/db-contract/sql/00_supabase_shim.sql"
apply "$held/20260816120000_baseline_schema.sql"
for f in $(ls "$root/supabase/migrations/"*.sql | sort); do
  if [ "$(basename "$f")" = "$omit" ]; then echo "omitted ${f#$root/} (mutation proof)"; continue; fi
  apply "$f"
done
for f in "${held_v2[@]}" "${held_billing[@]}" "${held_admission[@]}" "${held_client[@]}"; do
  if [ "$f" = "$omit" ]; then echo "omitted $f (mutation proof)"; continue; fi
  apply "$held/$f"
done
# PostgREST reads its schema cache once at start; nothing else to reload here.
echo "database ready"
