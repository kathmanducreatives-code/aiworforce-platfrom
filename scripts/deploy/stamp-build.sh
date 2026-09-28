#!/usr/bin/env bash
# Stamp the edge functions with the commit being deployed, deploy, then restore.
#
#   scripts/deploy/stamp-build.sh stamp     # write buildStamp.generated.ts (refuses a dirty tree)
#   scripts/deploy/stamp-build.sh restore   # put the committed default back
#
# Use it around every `supabase functions deploy` (docs/launch/deployment-runbook.md):
# a function deployed unstamped reports "unstamped", which is the honest answer.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
FILE="$REPO/supabase/functions/_shared/buildStamp.generated.ts"
case "${1:-}" in
  stamp)
    if [ -n "$(git -C "$REPO" status --porcelain -- supabase/functions)" ]; then
      echo "refusing: supabase/functions has uncommitted changes — a stamp must name exactly what is deployed" >&2
      exit 1
    fi
    SHA="$(git -C "$REPO" rev-parse HEAD)"
    NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '%s\n' "// Written by scripts/deploy/stamp-build.sh for a deploy. NOT to be committed." \
      "export const BUILD = { sha: \"$SHA\", built_at: \"$NOW\" } as const;" > "$FILE"
    echo "stamped $SHA @ $NOW"
    ;;
  restore)
    git -C "$REPO" checkout -- supabase/functions/_shared/buildStamp.generated.ts
    echo "restored the committed default"
    ;;
  *) echo "usage: $0 stamp|restore" >&2; exit 2 ;;
esac
