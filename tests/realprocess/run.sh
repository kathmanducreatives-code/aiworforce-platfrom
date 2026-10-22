#!/usr/bin/env bash
# The real-process crash rehearsal on the contract lane's disposable database:
#   PG_ADMIN_URL=… POSTGREST_BIN=… tests/realprocess/run.sh
# Not part of CI. It needs to spawn worker processes (--allow-run) and write
# their event files; the lane's own runner grants neither.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
DB_CONTRACT_EXTRA_DENO_FLAGS="--allow-run=$(readlink -f "$(command -v deno)") --allow-write" \
  exec "$root/tests/db-contract/run.sh" "$root/tests/realprocess/workerKill.rehearsal.ts"
