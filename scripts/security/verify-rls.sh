#!/usr/bin/env bash
# Run the READ-ONLY RLS / grant verification against a database.
#
#   scripts/security/verify-rls.sh <database-url>          # prints the JSON report
#   scripts/security/verify-rls.sh <database-url> --strict # exit 1 on any failed check
#
# For production, use a read-only role's connection string if one exists; the
# SQL itself runs in a READ ONLY transaction and only reads the catalog either
# way. Uses a local psql if present, otherwise psql inside a throwaway container.
set -euo pipefail
URL="${1:?usage: verify-rls.sh <database-url> [--strict]}"
STRICT="${2:-}"
SQL="$(dirname "$0")/verify-rls.sql"
if command -v psql >/dev/null 2>&1; then
  OUT="$(psql "$URL" -At -v ON_ERROR_STOP=1 -f "$SQL")"
else
  OUT="$(docker run --rm -i --network host postgres:15-alpine psql "$URL" -At -v ON_ERROR_STOP=1 < "$SQL")"
fi
JSON="$(printf '%s\n' "$OUT" | grep '^{')"
printf '%s\n' "$JSON"
if [ "$STRICT" = "--strict" ]; then
  printf '%s' "$JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); bad=[c["check"] for c in d["checks"] if not c["ok"]]; print("FAILED: "+", ".join(bad) if bad else "ALL CHECKS PASS", file=sys.stderr); sys.exit(1 if bad else 0)'
fi
