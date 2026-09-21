#!/usr/bin/env bash
# The local stack's URL and publishable key, in the shape Vite reads.
#   bash scripts/local-supabase/print-local-env.sh > .env.development.local
# Local dev keys only: `supabase status` prints the CLI's fixed local keys,
# which are not secrets and never leave this machine.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
json=$(supabase status -o json)
url=$(printf '%s' "$json" | python3 -c "import json,sys;print(json.load(sys.stdin).get('API_URL','http://127.0.0.1:54321'))")
key=$(printf '%s' "$json" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('PUBLISHABLE_KEY') or d.get('ANON_KEY'))")
cat <<ENV
# LOCAL SUPABASE — Vite loads this ONLY in dev, and it outranks .env.local
# (.env.[mode].local > .env.local), so production values in .env.local stay put.
VITE_SUPABASE_URL=$url
VITE_SUPABASE_PUBLISHABLE_KEY=$key
VITE_SUPABASE_ANON_KEY=$key
VITE_SUPABASE_PROJECT_ID=local
ENV
