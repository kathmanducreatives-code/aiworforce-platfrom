#!/usr/bin/env bash
# Apply the HELD provider-connections migration to a DISPOSABLE local database
# and run its assertions:
#
#   tests/db-contract/provider-connections/check.sh <postgres-url-on-localhost>
#
# Order: the lane's Supabase shim, the held schema baseline, the test-only
# Vault shim (vault_shim.sql), the held migration, assertions.sql. Refuses any
# URL that is not localhost. Nothing here can reach a hosted project.
set -euo pipefail
url="${1:?usage: check.sh <postgres-url>}"
case "$url" in
  postgres://*@127.0.0.1:*|postgres://*@localhost:*|postgresql://*@127.0.0.1:*|postgresql://*@localhost:*) ;;
  *) echo "refusing: only a localhost database" >&2; exit 2 ;;
esac
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
apply() { psql "$url" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$1" >/dev/null || { echo "FAILED ${1#$root/}" >&2; exit 1; }; echo "applied ${1#$root/}"; }
apply "$root/tests/db-contract/sql/00_supabase_shim.sql"
PGOPTIONS="-c client_min_messages=warning" apply "$root/supabase/migrations-held/20260816120000_baseline_schema.sql"
apply "$here/vault_shim.sql"
apply "$root/supabase/migrations-held/20261027120000_provider_connections.sql"
psql "$url" -X -q -v ON_ERROR_STOP=1 -At -f "$here/assertions.sql"
