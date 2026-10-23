#!/usr/bin/env bash
# Read-only Git objects -> disposable source tree; no merge or owner branch edits.
# CI prepares these exact reviewed objects. This script itself performs no fetch.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
brain=60be04712c41193da213a95c1918f7f4f9a4e645
workspace=cc83eb7ee3edf68192378ef68805a71b125edc59
launch=8b0e2b6bdb20d6fe30542da39f0170d514d52746
membership=572dca5c8d9c7f121731456801a035cfb6186b1e
combined="$(mktemp -d "${TMPDIR:-/tmp}/outpost-owner-integration.XXXXXX")"
cleanup() { rm -rf "$combined"; }
trap cleanup EXIT
for ref in "$brain" "$workspace" "$launch" "$membership"; do git -C "$root" cat-file -e "$ref^{commit}"; done
git -C "$root" archive "$brain" | tar -xf - -C "$combined"
# Apply only the reviewed independent workspace-selection diff; never overwrite
# canonical Brain changes with a whole file from a different branch.
git -C "$root" diff --binary "$launch" "$workspace" > "$combined/workspace.patch"
git -C "$combined" apply --check "$combined/workspace.patch"
git -C "$combined" apply "$combined/workspace.patch"
# Overlay ONLY owned pilot source/tests/held SQL. Shared Brain/qualification/
# execution/ledger implementations remain exact owner-source versions.
mkdir -p "$combined/supabase/functions/_shared" "$combined/tests" "$combined/supabase/migrations-held" \
  "$combined/docs/audits/agentory-outbound-outpost-readiness"
cp -R "$root/supabase/functions/_shared/pilot" "$combined/supabase/functions/_shared/"
for handler in pilot-scope pilot-context pilot-import; do
  cp -R "$root/supabase/functions/$handler" "$combined/supabase/functions/"
done
cp -R "$root/tests/outpost-native" "$combined/tests/"
cp -R "$root/docs/audits/agentory-outbound-outpost-readiness/production-readiness" "$combined/docs/audits/agentory-outbound-outpost-readiness/"
for file in 20261022140824_outpost_native_identity_security.sql 20261023061143_outpost_pilot_api_authorization.sql 20261023101216_outpost_pilot_task_registration_lifecycle.sql; do
  cp "$root/supabase/migrations-held/$file" "$combined/supabase/migrations-held/"
done
git -C "$root" show "$membership:supabase/migrations/20261022120000_close_workspace_self_join.sql" > "$combined/membership-159.sql"
export OUTPOST_NATIVE_MEMBERSHIP_SQL="$combined/membership-159.sql"
export OUTPOST_NATIVE_BRAIN_SQL="$combined/supabase/migrations/20261023120000_company_brain_server_writes_only.sql"
export OUTPOST_NATIVE_TASK_GUARDS=1
cd "$combined"
echo "SOURCE_MANIFEST pilot=$(git -C "$root" rev-parse HEAD) brain169=$brain workspace170=$workspace membership159=$membership"
deno test --node-modules-dir=none --allow-read --allow-env \
  tests/edge-functions/_shared/brainRole.test.ts tests/edge-functions/_shared/brainRoleParity.test.ts \
  tests/frontend/activeWorkspace.test.ts
OUTPOST_NATIVE_LIFECYCLE=1 tests/outpost-native/run.sh
OUTPOST_NATIVE_LIFECYCLE_AUTH=1 tests/outpost-native/run.sh
OUTPOST_NATIVE_CONTEXT_AUDIT=1 tests/outpost-native/run.sh
OUTPOST_NATIVE_SURFACE_AUDIT=1 tests/outpost-native/run.sh
OUTPOST_NATIVE_OWNER_BRAIN_CONTRACT="$combined/tests/db-contract/companyBrainServerWrites.contract.test.ts" tests/outpost-native/run.sh
echo 'INTEGRATED_OWNER_SECURITY=PASS; client-grant schema and legacy pre-effect execution remain separate gates; customer_pilot_ready=false'
