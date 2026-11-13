#!/usr/bin/env bash
# PRODUCTION RELEASE R1 — ORION (OpenAI-only) + Company Brain. Run in YOUR shell
# (Bash 4+; Supabase CLI logged in) from a CLEAN checkout of the DEPLOYMENT-TOOL commit.
#
#   scripts/release/deploy-production-release.sh --check  --confirm ohsdatpvfdjdemstoiuj --sha <APP_SHA> --tool-sha <TOOL_SHA>
#   scripts/release/deploy-production-release.sh --deploy --confirm ohsdatpvfdjdemstoiuj --sha <APP_SHA> --tool-sha <TOOL_SHA>
#
# TWO SHAs, NEVER CONFUSED (hotfix 2026-11-13):
#   --sha       the APPROVED APPLICATION RELEASE (R1: 3bef8fd03998c4133b9bebaf87acdd03a3dad5f9).
#               The five functions are built from a clean worktree of EXACTLY this commit,
#               with the builder at this commit, so every bundle and every live
#               x-agentory-build header names THIS SHA.
#   --tool-sha  the commit of THIS SCRIPT (must equal HEAD of the checkout you run it from;
#               must contain --sha). It changes how the release is executed, never what is built.
#
# --check   READ-ONLY: checkout, live builds, secret NAMES, bundles. Changes nothing.
# --deploy  The same checks, then, in order — any failure stops before the next step:
#   5. BACKUPS: every function this release replaces is downloaded into
#      release-backups/r1-<UTC>/supabase/functions/<fn>/ (explicit --workdir; the
#      Supabase wrapper runs from the repo root), each one VALIDATED (source files,
#      a server entry point, a sha256 manifest), and the repo's own
#      supabase/functions/ proven untouched. No backup → no production write.
#   6. flags: AGENTORY_DELEGATION_ENABLED=false, AGENTORY_ORION_EVIDENCE_CONTEXT=true;
#      MODEL_SPEND_* only if ALL absent (enforce / 3.00 / 7) — existing ones preserved.
#   7. deploy the five bundles (company-brain-memory, generate-company-brain-draft,
#      setup-company-brain, daily-brief, pilot-chat — chat last).
#   8. verify: each x-agentory-build == --sha, no-token POST == 401, kept functions unmoved.
# Database migrations are NOT in this script (already applied; never re-run here).
# Untouched: run-agent, orchestrate, enqueue-lead-mission, continue-workflow,
# resume-stalled-leads, lead/provider functions, monitoring, cron, frontend.
set -euo pipefail
REF=ohsdatpvfdjdemstoiuj
MODE="${1:-}"; APP_SHA=""; TOOL_SHA=""
{ [ "$MODE" = "--check" ] || [ "$MODE" = "--deploy" ]; } && [ "${2:-}" = "--confirm" ] && [ "${3:-}" = "$REF" ] \
  && [ "${4:-}" = "--sha" ] && APP_SHA="${5:-}" && [ "${6:-}" = "--tool-sha" ] && TOOL_SHA="${7:-}" \
  && [ -n "$APP_SHA" ] && [ -n "$TOOL_SHA" ] \
  || { echo "usage: $0 --check|--deploy --confirm $REF --sha <APP_SHA> --tool-sha <TOOL_SHA>" >&2; exit 2; }
[ "${BASH_VERSINFO[0]:-0}" -ge 4 ] || { echo "refusing: Bash 4+ required (this is Bash ${BASH_VERSION:-?})" >&2; exit 2; }
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export SUPABASE_TARGET=production
# The wrapper anchors its own paths to the repo root; we also always call it FROM the root.
p() { ( cd "$ROOT" && npm run --silent supabase:prod -- "$@" ); }
RELEASE_FUNCTIONS="pilot-chat daily-brief generate-company-brain-draft setup-company-brain company-brain-memory"
REPLACED_FUNCTIONS="pilot-chat daily-brief generate-company-brain-draft setup-company-brain"  # company-brain-memory is new
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
# Diagnostics without secrets: redact tokens, JWTs, keys, passwords, auth headers.
sanitize() { sed -E \
  -e 's/sbp_[A-Za-z0-9]{20,}/sbp_<redacted>/g' \
  -e 's/sb_(secret|publishable)_[A-Za-z0-9_-]{10,}/sb_\1_<redacted>/g' \
  -e 's/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/<jwt-redacted>/g' \
  -e 's/([Bb]earer|[Aa]uthorization:?|apikey:?) +[^ ]+/\1 <redacted>/g' \
  -e 's/([Pp][Aa][Ss][Ss][Ww][Oo]?[Rr]?[Dd]|[Tt][Oo][Kk][Ee][Nn]|[Ss][Ee][Cc][Rr][Ee][Tt])=[^ &]+/\1=<redacted>/g'; }
# Portable SHA-256 (Linux coreutils or macOS shasum); same output format.
sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }

echo "== 1. checkout (tool $TOOL_SHA → app $APP_SHA)"
[ "$(git rev-parse HEAD)" = "$TOOL_SHA" ] || { echo "refusing: HEAD is $(git rev-parse HEAD), not the deployment-tool commit $TOOL_SHA"; exit 1; }
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "refusing: uncommitted changes in the checkout"; exit 1; }
git cat-file -e "$APP_SHA^{commit}" 2>/dev/null || { echo "refusing: app commit $APP_SHA is not in this clone (git fetch origin)"; exit 1; }
[ "$(git rev-parse "$APP_SHA^{commit}")" = "$APP_SHA" ] || { echo "refusing: --sha must be the full 40-character commit"; exit 1; }
git merge-base --is-ancestor "$APP_SHA" HEAD || { echo "refusing: the tool commit does not contain the approved app commit $APP_SHA"; exit 1; }
[ -f node_modules/esbuild/package.json ] || { echo "refusing: run 'npm install' first"; exit 1; }
echo "  tool HEAD = $TOOL_SHA (clean); app release = $APP_SHA (ancestor)"

echo "== 2. live builds (read-only)"
fail=0
pc="$(build_of pilot-chat)"
if [ "$pc" = "$EXPECT_PILOT_CHAT_BEFORE" ] || [ "$pc" = "$APP_SHA" ]; then echo "  pilot-chat: $pc"; else echo "  pilot-chat: ${pc:-none} — MOVED since the baseline"; fail=1; fi
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
has ANTHROPIC_API_KEY && echo "  ANTHROPIC_API_KEY: present (Brain drafting / briefs / agents, not ORION chat)" || echo "  ANTHROPIC_API_KEY: absent — Brain AI drafting and briefs fall back to gpt-4.1-mini where declared, else report no provider"
bad="$(echo "$names" | grep -E '^AGENTORY_(TERRA|HYBRID|ROUTE)_|^AGENTORY_GPT_MODEL_FAMILY$' || true)"
[ -z "$bad" ] || { echo "refusing: Terra / routing / model-family secrets present:"; echo "$bad"; exit 1; }
n=0; for k in MODEL_SPEND_ENFORCEMENT MODEL_SPEND_CEILING_USD MODEL_SPEND_PERIOD_DAYS; do has "$k" && { echo "  $k: present (preserved)"; n=$((n+1)); } || echo "  $k: absent"; done
case "$n" in 3) spend=preserve;; 0) spend=absent; echo "  → no spend ceiling: --deploy sets enforce / 3.00 USD / 7 days";; *) echo "refusing: spend ceiling partly configured"; exit 1;; esac
for k in AGENTORY_DELEGATION_ENABLED AGENTORY_ORION_EVIDENCE_CONTEXT AGENTORY_ORION_EVIDENCE_WORKSPACES; do has "$k" && echo "  $k: present" || echo "  $k: absent"; done

echo "== 4. bundles (built from the app commit $APP_SHA)"
BUILD_TREE="$ROOT/.release-build/app-$APP_SHA"   # inside the repo so node_modules resolve
git worktree remove --force "$BUILD_TREE" >/dev/null 2>&1 || true
rm -rf "$BUILD_TREE"
git worktree add --detach "$BUILD_TREE" "$APP_SHA" >/dev/null 2>&1 || { echo "refusing: cannot create a worktree of $APP_SHA"; exit 1; }
OUT="$(mktemp -d "${TMPDIR:-/tmp}/agentory-r1.XXXXXX")"
cleanup() { rm -rf "$OUT"; git -C "$ROOT" worktree remove --force "$BUILD_TREE" >/dev/null 2>&1 || true; }
trap cleanup EXIT
[ "$(git -C "$BUILD_TREE" rev-parse HEAD)" = "$APP_SHA" ] && [ -z "$(git -C "$BUILD_TREE" status --porcelain)" ] \
  || { echo "refusing: the app worktree is not a clean checkout of $APP_SHA"; exit 1; }
for fn in $RELEASE_FUNCTIONS; do
  ( cd "$BUILD_TREE" && node scripts/test-project/build-pilot-chat-bundle.mjs "$OUT" "$fn" production >/dev/null ) \
    || { echo "refusing: $fn did not build at $APP_SHA"; exit 1; }
  printf "  %-30s %s bytes\n" "$fn" "$(wc -c < "$OUT/supabase/functions/$fn/index.ts" | tr -d ' ')"
  grep -Eq "\"sha\": ?\"$APP_SHA\"" "$OUT/supabase/functions/$fn/index.ts" || { echo "refusing: $fn bundle is not stamped $APP_SHA"; exit 1; }
done
{ echo "project_id = \"$REF\""; for fn in $RELEASE_FUNCTIONS; do printf '\n[functions.%s]\nverify_jwt = true\n' "$fn"; done; } > "$OUT/supabase/config.toml"

if [ "$MODE" = "--check" ]; then echo "CHECK OK (read-only; nothing changed). app=$APP_SHA tool=$TOOL_SHA"; exit 0; fi

echo "== 5. backups (before any change)"
BK="$ROOT/release-backups/r1-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BK/supabase/functions"
printf 'project_id = "%s"\n' "$REF" > "$BK/supabase/config.toml"   # the backup workdir names ONLY production
repo_fn_state() { git -C "$ROOT" status --porcelain -- supabase/functions; }
before_state="$(repo_fn_state)"
for fn in $REPLACED_FUNCTIONS; do
  log="$BK/download-$fn.log"
  if ! p functions download "$fn" --use-api --workdir "$BK" >"$log" 2>&1; then
    echo "  --use-api download of $fn failed; retrying with the CLI default" >>"$log"
    if ! p functions download "$fn" --workdir "$BK" >>"$log" 2>&1; then
      echo "refusing: could not back up $fn; nothing was changed. Diagnostics (sanitized):"
      tail -n 25 "$log" | sanitize | sed 's/^/    /'
      exit 1
    fi
  fi
  dir="$BK/supabase/functions/$fn"
  files="$(find "$dir" -type f \( -name '*.ts' -o -name '*.js' -o -name '*.tsx' -o -name '*.mjs' \) 2>/dev/null || true)"
  [ -n "$files" ] || { echo "refusing: backup of $fn has no source files under $dir; nothing was changed. Diagnostics (sanitized):"; tail -n 25 "$log" | sanitize | sed 's/^/    /'; exit 1; }
  bytes=$(cat $files | wc -c | tr -d ' ')
  [ "$bytes" -ge 200 ] || { echo "refusing: backup of $fn is implausibly small ($bytes bytes); nothing was changed"; exit 1; }
  grep -lqE 'Deno\.serve|serve\(|addEventListener\(' $files || { echo "refusing: backup of $fn has no server entry point; nothing was changed"; exit 1; }
  echo "  backed up $fn → ${dir#$ROOT/} ($(echo "$files" | wc -l | tr -d ' ') files, $bytes bytes)"
done
[ "$(repo_fn_state)" = "$before_state" ] || { echo "refusing: the download changed the repository's supabase/functions/; nothing was changed in production"; exit 1; }
( cd "$BK" && find supabase/functions -type f | sort | while IFS= read -r f; do sha256 "$f"; done ) > "$BK/MANIFEST.sha256"
printf 'app_release=%s\ndeployment_tool=%s\nlive_pilot_chat_before=%s\nspend_set_by_release=%s\n' \
  "$APP_SHA" "$TOOL_SHA" "$pc" "$([ "$spend" = absent ] && echo 1 || echo 0)" > "$BK/STATE"
echo "  all $(echo $REPLACED_FUNCTIONS | wc -w | tr -d ' ') backups validated; manifest: ${BK#$ROOT/}/MANIFEST.sha256"

echo "== 6. flags (before chat changes)"
p secrets set AGENTORY_DELEGATION_ENABLED=false AGENTORY_ORION_EVIDENCE_CONTEXT=true
[ "$spend" = absent ] && p secrets set MODEL_SPEND_ENFORCEMENT=enforce MODEL_SPEND_CEILING_USD=3.00 MODEL_SPEND_PERIOD_DAYS=7

echo "== 7. deploy (single-file bundles, --use-api)"
for fn in company-brain-memory generate-company-brain-draft setup-company-brain daily-brief pilot-chat; do
  p functions deploy "$fn" --use-api --workdir "$OUT"
done

echo "== 8. verify"
ok=1
for fn in $RELEASE_FUNCTIONS; do
  b="$(build_of "$fn")"; code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "https://$REF.supabase.co/functions/v1/$fn" -H 'Content-Type: application/json' -d '{}')"
  printf "  %-30s build=%s  no-token POST=%s\n" "$fn" "${b:-none}" "$code"
  { [ "$b" = "$APP_SHA" ] && [ "$code" = 401 ]; } || ok=0
done
for fn in "${!EXPECT_KEPT[@]}"; do [ "$(build_of "$fn")" = "${EXPECT_KEPT[$fn]}" ] || { echo "  $fn MOVED"; ok=0; }; done
[ "$ok" = 1 ] && echo "RELEASE R1 BACKEND DEPLOYED on $REF: app $APP_SHA via tool $TOOL_SHA. Backups: ${BK#$ROOT/}" \
  || { echo "VERIFY FAILED — see docs/release/2026-11-12-r1/ROLLBACK.md (backups: ${BK#$ROOT/})"; exit 1; }
