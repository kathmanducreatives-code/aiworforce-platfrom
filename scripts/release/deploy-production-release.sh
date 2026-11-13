#!/usr/bin/env bash
# PRODUCTION RELEASE R1 — ORION (OpenAI-only) + Company Brain. Run in YOUR shell,
# Supabase CLI logged in, from a CLEAN checkout of the approved release commit.
#
#   scripts/release/deploy-production-release.sh --check  --confirm ohsdatpvfdjdemstoiuj --sha <RELEASE_SHA>
#   scripts/release/deploy-production-release.sh --deploy --confirm ohsdatpvfdjdemstoiuj --sha <RELEASE_SHA>
#
# --check   READ-ONLY. Verifies the checkout, the live builds this release
#           replaces or keeps, and secret NAMES (never values). Changes nothing.
# --deploy  Runs the same checks, then:
#             1. backs up every function it will replace (functions download);
#                stops before any change if a backup fails;
#             2. sets AGENTORY_DELEGATION_ENABLED=false and
#                AGENTORY_ORION_EVIDENCE_CONTEXT=true (before chat changes);
#                MODEL_SPEND_* only if ALL are absent (enforce / 3.00 / 7);
#                existing spend settings are preserved, partial ones refused;
#             3. deploys the five release functions as single-file bundles
#                stamped with the release SHA (no Docker; avoids HTTP 413);
#             4. verifies each function's x-agentory-build header names the
#                release SHA and that a POST without a token is 401.
# The DATABASE MIGRATIONS are NOT in this script: they are applied first, through
# the reviewed migration channel, after approval (docs/release/2026-11-12-r1/).
# Untouched: run-agent, orchestrate, enqueue-lead-mission, continue-workflow,
# resume-stalled-leads, lead/provider functions, monitoring, cron jobs.
set -euo pipefail
REF=ohsdatpvfdjdemstoiuj
MODE="${1:-}"; SHA=""
{ [ "$MODE" = "--check" ] || [ "$MODE" = "--deploy" ]; } && [ "${2:-}" = "--confirm" ] && [ "${3:-}" = "$REF" ] && [ "${4:-}" = "--sha" ] && SHA="${5:-}" \
  || { echo "usage: $0 --check|--deploy --confirm $REF --sha <RELEASE_SHA>" >&2; exit 2; }
cd "$(dirname "$0")/../.."
export SUPABASE_TARGET=production
p() { npm run --silent supabase:prod -- "$@"; }
RELEASE_FUNCTIONS="pilot-chat daily-brief generate-company-brain-draft setup-company-brain company-brain-memory"
# Live builds at the 2026-11-12 baseline (x-agentory-build). A moved build = stop.
declare -A EXPECT_KEPT=(
  [run-agent]=e4da19e8828898f05414da953a13acb74c74e6a4
  [orchestrate]=b51ad3dddf2604f9d218d7c495e17e22d20932db
  [enqueue-lead-mission]=b51ad3dddf2604f9d218d7c495e17e22d20932db
  [continue-workflow]=b51ad3dddf2604f9d218d7c495e17e22d20932db
  [resume-stalled-leads]=b51ad3dddf2604f9d218d7c495e17e22d20932db
)
EXPECT_PILOT_CHAT_BEFORE=86ac1b922f8519f75760642bb09cceef096168eb
build_of() { curl -sS -m 20 -X OPTIONS -D - -o /dev/null "https://$REF.supabase.co/functions/v1/$1" \
  -H "Origin: https://agentory.space" -H "Access-Control-Request-Method: POST" 2>/dev/null | tr -d '\r' \
  | awk -F': ' 'tolower($1)=="x-agentory-build"{print $2}' | cut -d@ -f1; }

echo "== 1. checkout"
[ "$(git rev-parse HEAD)" = "$SHA" ] || { echo "refusing: HEAD is $(git rev-parse HEAD), not the approved $SHA"; exit 1; }
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "refusing: uncommitted changes in the checkout"; exit 1; }
[ -f node_modules/esbuild/package.json ] || { echo "refusing: run 'npm install' first"; exit 1; }
echo "  HEAD = $SHA (clean)"

echo "== 2. live builds (read-only)"
fail=0
pc="$(build_of pilot-chat)"
if [ "$pc" = "$EXPECT_PILOT_CHAT_BEFORE" ] || [ "$pc" = "$SHA" ]; then echo "  pilot-chat: $pc"; else echo "  pilot-chat: $pc — MOVED since the baseline"; fail=1; fi
for fn in "${!EXPECT_KEPT[@]}"; do
  b="$(build_of "$fn")"
  if [ "$b" = "${EXPECT_KEPT[$fn]}" ]; then echo "  $fn: $b (kept)"; else echo "  $fn: ${b:-none} — expected ${EXPECT_KEPT[$fn]}"; fail=1; fi
done
[ "$fail" = 0 ] || { echo "refusing: production changed since the 2026-11-12 baseline; re-review first"; exit 1; }

echo "== 3. secrets (names only)"
names="$(p secrets list 2>/dev/null | awk -F'|' 'NR>2 {gsub(/ /,"",$1); if ($1!="") print $1}')"
[ -n "$names" ] || { echo "refusing: cannot list production secret names (CLI login / access?)"; exit 1; }
has() { echo "$names" | grep -qx "$1"; }
has OPENAI_API_KEY && echo "  OPENAI_API_KEY: present" || { echo "refusing: OPENAI_API_KEY missing (ORION chat is OpenAI-only)"; exit 1; }
has ANTHROPIC_API_KEY && echo "  ANTHROPIC_API_KEY: present (used by Brain drafting / briefs / agents, not ORION chat)" || echo "  ANTHROPIC_API_KEY: absent — Brain AI drafting and briefs fall back to gpt-4.1-mini where declared, else report no provider"
bad="$(echo "$names" | grep -E '^AGENTORY_(TERRA|HYBRID|ROUTE)_|^AGENTORY_GPT_MODEL_FAMILY$' || true)"
[ -z "$bad" ] || { echo "refusing: Terra / routing / model-family secrets present:"; echo "$bad"; exit 1; }
n=0; for k in MODEL_SPEND_ENFORCEMENT MODEL_SPEND_CEILING_USD MODEL_SPEND_PERIOD_DAYS; do has "$k" && { echo "  $k: present (preserved)"; n=$((n+1)); } || echo "  $k: absent"; done
case "$n" in 3) spend=preserve;; 0) spend=absent; echo "  → no spend ceiling: --deploy sets enforce / 3.00 USD / 7 days";; *) echo "refusing: spend ceiling partly configured"; exit 1;; esac
for k in AGENTORY_DELEGATION_ENABLED AGENTORY_ORION_EVIDENCE_CONTEXT AGENTORY_ORION_EVIDENCE_WORKSPACES; do has "$k" && echo "  $k: present" || echo "  $k: absent"; done

echo "== 4. bundles"
OUT="$(mktemp -d "${TMPDIR:-/tmp}/agentory-r1.XXXXXX")"
for fn in $RELEASE_FUNCTIONS; do
  node scripts/test-project/build-pilot-chat-bundle.mjs "$OUT" "$fn" production >/dev/null
  printf "  %-30s %s bytes\n" "$fn" "$(wc -c < "$OUT/supabase/functions/$fn/index.ts" | tr -d ' ')"
  grep -Eq "\"sha\": ?\"$SHA\"" "$OUT/supabase/functions/$fn/index.ts" || { echo "refusing: $fn bundle is not stamped $SHA"; exit 1; }
done
# one config naming production and every release function
{ echo "project_id = \"$REF\""; for fn in $RELEASE_FUNCTIONS; do printf '\n[functions.%s]\nverify_jwt = true\n' "$fn"; done; } > "$OUT/supabase/config.toml"

if [ "$MODE" = "--check" ]; then rm -rf "$OUT"; echo "CHECK OK (read-only; nothing changed)."; exit 0; fi

echo "== 5. backups (before any change)"
BK="release-backups/r1-$(date -u +%Y%m%dT%H%M%SZ)"; mkdir -p "$BK"
for fn in pilot-chat daily-brief generate-company-brain-draft setup-company-brain; do
  ( cd "$BK" && SUPABASE_TARGET=production node ../../scripts/supabase-target.mjs production -- functions download "$fn" --use-api >/dev/null 2>&1 \
      || SUPABASE_TARGET=production node ../../scripts/supabase-target.mjs production -- functions download "$fn" >/dev/null 2>&1 ) \
    && echo "  backed up $fn → $BK" || { echo "refusing: could not back up $fn; nothing was changed"; exit 1; }
done

echo "== 6. flags (before chat changes)"
p secrets set AGENTORY_DELEGATION_ENABLED=false AGENTORY_ORION_EVIDENCE_CONTEXT=true
[ "$spend" = absent ] && p secrets set MODEL_SPEND_ENFORCEMENT=enforce MODEL_SPEND_CEILING_USD=3.00 MODEL_SPEND_PERIOD_DAYS=7
printf 'release=%s\nspend_set_by_release=%s\nbackups=%s\n' "$SHA" "$([ "$spend" = absent ] && echo 1 || echo 0)" "$BK" > "$BK/STATE"

echo "== 7. deploy (single-file bundles, --use-api)"
for fn in company-brain-memory generate-company-brain-draft setup-company-brain daily-brief pilot-chat; do
  p functions deploy "$fn" --use-api --workdir "$OUT"
done
rm -rf "$OUT"

echo "== 8. verify"
ok=1
for fn in $RELEASE_FUNCTIONS; do
  b="$(build_of "$fn")"; code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "https://$REF.supabase.co/functions/v1/$fn" -H 'Content-Type: application/json' -d '{}')"
  printf "  %-30s build=%s  no-token POST=%s\n" "$fn" "${b:-none}" "$code"
  { [ "$b" = "$SHA" ] && [ "$code" = 401 ]; } || ok=0
done
for fn in "${!EXPECT_KEPT[@]}"; do [ "$(build_of "$fn")" = "${EXPECT_KEPT[$fn]}" ] || { echo "  $fn MOVED"; ok=0; }; done
[ "$ok" = 1 ] && echo "RELEASE R1 BACKEND DEPLOYED on $REF @ $SHA. Backups: $BK" || { echo "VERIFY FAILED — see docs/release/2026-11-12-r1/ROLLBACK.md"; exit 1; }
