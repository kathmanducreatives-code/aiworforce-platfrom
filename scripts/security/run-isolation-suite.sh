#!/usr/bin/env bash
# Start the throwaway isolation stack (if needed) and run the two-workspace suite
# against it. Never touches production: see isolation-stack.sh.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_OUT="$("$REPO/scripts/security/isolation-stack.sh" up | grep -E '^[A-Z_]+=')"
val() { printf '%s\n' "$ENV_OUT" | sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p"; }
export ISOLATION_STACK=1
export ISO_API_URL="$(val API_URL)"
export ISO_ANON_KEY="$(val ANON_KEY)"
export ISO_SERVICE_ROLE_KEY="$(val SERVICE_ROLE_KEY)"
export ISO_DB_CONTAINER="supabase_db_agentory-isolation"
host="$(printf '%s' "$ISO_API_URL" | sed -E 's#^https?://##')"
cd "$REPO"
exec deno test --no-lock --allow-env --allow-read --allow-run=docker --allow-net="$host" tests/security/ "$@"
