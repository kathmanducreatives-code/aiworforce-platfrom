#!/usr/bin/env bash
# PRODUCTION RELEASE R1.1 — ORION intelligence and chat routing. ONE FUNCTION: pilot-chat.
# Run in YOUR shell (Bash 4+; Supabase CLI logged in) from a CLEAN checkout of the tool commit.
#
#   scripts/release/deploy-r11-pilot-chat.sh --check    --confirm ohsdatpvfdjdemstoiuj --sha <APP_SHA> --tool-sha <TOOL_SHA>
#   scripts/release/deploy-r11-pilot-chat.sh --deploy   --confirm ohsdatpvfdjdemstoiuj --sha <APP_SHA> --tool-sha <TOOL_SHA>
#   scripts/release/deploy-r11-pilot-chat.sh --rollback --confirm ohsdatpvfdjdemstoiuj --backup release-backups/r11-<UTC>
#
# --sha       the APPROVED R1.1 application commit; pilot-chat is built from a clean worktree
#             of exactly this commit, so the live x-agentory-build header names it.
# --tool-sha  the commit of THIS SCRIPT (= HEAD of the checkout; must contain --sha).
#
# SCOPE, AND NOTHING ELSE:
#   - deploys pilot-chat only. The other R1 functions (daily-brief, generate-company-brain-draft,
#     setup-company-brain, company-brain-memory) and every kept function must be unmoved,
#     before and after.
#   - changes NO secret. AGENTORY_DELEGATION_ENABLED and AGENTORY_ORION_EVIDENCE_CONTEXT must
#     already exist (R1 set them to false / true); this script only checks their names.
#   - no database step, no frontend step, no cron, no paid work.
# --deploy order: checks → validated backup of the live pilot-chat → deploy → verify.
# --rollback: redeploys the backed-up pilot-chat source (no build, no secrets) and verifies.
set -euo pipefail
REF=ohsdatpvfdjdemstoiuj
R1_SHA=3bef8fd03998c4133b9bebaf87acdd03a3dad5f9
MODE="${1:-}"; APP_SHA=""; TOOL_SHA=""; BACKUP=""
usage() { echo "usage: $0 --check|--deploy --confirm $REF --sha <APP_SHA> --tool-sha <TOOL_SHA>" >&2
          echo "       $0 --rollback --confirm $REF --backup release-backups/r11-<UTC>" >&2; exit 2; }
[ "${2:-}" = "--confirm" ] && [ "${3:-}" = "$REF" ] || usage
case "$MODE" in
  --check|--deploy) [ "${4:-}" = "--sha" ] && APP_SHA="${5:-}" && [ "${6:-}" = "--tool-sha" ] && TOOL_SHA="${7:-}" \
                      && [ -n "$APP_SHA" ] && [ -n "$TOOL_SHA" ] || usage ;;
  --rollback) [ "${4:-}" = "--backup" ] && BACKUP="${5:-}" && [ -n "$BACKUP" ] || usage ;;
  *) usage ;;
esac
[ "${BASH_VERSINFO[0]:-0}" -ge 4 ] || { echo "refusing: Bash 4+ required (this is Bash ${BASH_VERSION:-?})" >&2; exit 2; }
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export SUPABASE_TARGET=production
p() { ( cd "$ROOT" && npm run --silent supabase:prod -- "$@" ); }
declare -A EXPECT_KEPT=(
  [daily-brief]=$R1_SHA [generate-company-brain-draft]=$R1_SHA [setup-company-brain]=$R1_SHA [company-brain-memory]=$R1_SHA
  [run-agent]=e4da19e8828898f05414da953a13acb74c74e6a4
  [orchestrate]=b51ad3dddf2604f9d218d7c495e17e22d20932db
  [enqueue-lead-mission]=b51ad3dddf2604f9d218d7c495e17e22d20932db
  [continue-workflow]=b51ad3dddf2604f9d218d7c495e17e22d20932db
  [resume-stalled-leads]=b51ad3dddf2604f9d218d7c495e17e22d20932db
)
build_of() { curl -sS -m 20 -X OPTIONS -D - -o /dev/null "https://$REF.supabase.co/functions/v1/$1" \
  -H "Origin: https://agentory.space" -H "Access-Control-Request-Method: POST" 2>/dev/null | tr -d '\r' \
  | awk -F': ' 'tolower($1)=="x-agentory-build"{print $2}' | cut -d@ -f1; }
sanitize() { sed -E \
  -e 's/sbp_[A-Za-z0-9]{20,}/sbp_<redacted>/g' \
  -e 's/sb_(secret|publishable)_[A-Za-z0-9_-]{10,}/sb_\1_<redacted>/g' \
  -e 's/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/<jwt-redacted>/g' \
  -e 's/([Bb]earer|[Aa]uthorization:?|apikey:?) +[^ ]+/\1 <redacted>/g' \
  -e 's/([Pp][Aa][Ss][Ss][Ww][Oo]?[Rr]?[Dd]|[Tt][Oo][Kk][Ee][Nn]|[Ss][Ee][Cc][Rr][Ee][Tt])=[^ &]+/\1=<redacted>/g'; }
sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
kept_ok() {
  local bad=0
  for fn in "${!EXPECT_KEPT[@]}"; do
    b="$(build_of "$fn")"
    if [ "$b" = "${EXPECT_KEPT[$fn]}" ]; then echo "  $fn: $b (unmoved)"; else echo "  $fn: ${b:-none} — expected ${EXPECT_KEPT[$fn]}"; bad=1; fi
  done
  return $bad
}
post_401() { curl -s -o /dev/null -w '%{http_code}' -X POST "https://$REF.supabase.co/functions/v1/pilot-chat" -H 'Content-Type: application/json' -d '{}'; }

# ── ROLLBACK ──────────────────────────────────────────────────────────────
if [ "$MODE" = "--rollback" ]; then
  BK="$ROOT/${BACKUP#$ROOT/}"
  [ -f "$BK/STATE" ] && [ -f "$BK/MANIFEST.sha256" ] && [ -f "$BK/supabase/config.toml" ] || { echo "refusing: $BACKUP is not an R1.1 backup (STATE / MANIFEST / config missing)"; exit 1; }
  grep -qx "project_id = \"$REF\"" "$BK/supabase/config.toml" || { echo "refusing: the backup workdir does not name production"; exit 1; }
  ( cd "$BK" && find supabase/functions -type f | sort | while IFS= read -r f; do sha256 "$f"; done ) | diff -q - "$BK/MANIFEST.sha256" >/dev/null \
    || { echo "refusing: backup files do not match MANIFEST.sha256"; exit 1; }
  before="$(awk -F= '$1=="live_pilot_chat_before"{print $2}' "$BK/STATE")"
  grep -q '^\[functions.pilot-chat\]' "$BK/supabase/config.toml" || printf '\n[functions.pilot-chat]\nverify_jwt = true\n' >> "$BK/supabase/config.toml"
  echo "== rollback: redeploy the backed-up pilot-chat (build before R1.1: ${before:-unknown})"
  p functions deploy pilot-chat --use-api --workdir "$BK"
  b="$(build_of pilot-chat)"; code="$(post_401)"
  echo "  pilot-chat build=${b:-none} no-token POST=$code"
  [ "$code" = 401 ] && { [ -z "$before" ] || [ "$b" = "$before" ]; } && echo "ROLLED BACK pilot-chat on $REF to ${b:-the backup}. Secrets were not touched." \
    || { echo "ROLLBACK VERIFY FAILED — check the function in the dashboard"; exit 1; }
  exit 0
fi

echo "== 1. checkout (tool $TOOL_SHA → app $APP_SHA)"
[ "$(git rev-parse HEAD)" = "$TOOL_SHA" ] || { echo "refusing: HEAD is $(git rev-parse HEAD), not the deployment-tool commit $TOOL_SHA"; exit 1; }
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "refusing: uncommitted changes in the checkout"; exit 1; }
git cat-file -e "$APP_SHA^{commit}" 2>/dev/null || { echo "refusing: app commit $APP_SHA is not in this clone (git fetch origin)"; exit 1; }
[ "$(git rev-parse "$APP_SHA^{commit}")" = "$APP_SHA" ] || { echo "refusing: --sha must be the full 40-character commit"; exit 1; }
git merge-base --is-ancestor "$APP_SHA" HEAD || { echo "refusing: the tool commit does not contain the approved app commit $APP_SHA"; exit 1; }
git merge-base --is-ancestor "$R1_SHA" "$APP_SHA" || { echo "refusing: $APP_SHA does not contain R1 ($R1_SHA)"; exit 1; }
[ -f node_modules/esbuild/package.json ] || { echo "refusing: run 'npm install' first"; exit 1; }
echo "  tool HEAD = $TOOL_SHA (clean); app release = $APP_SHA (contains R1)"

echo "== 2. live builds (read-only)"
pc="$(build_of pilot-chat)"
if [ "$pc" = "$R1_SHA" ] || [ "$pc" = "$APP_SHA" ]; then echo "  pilot-chat: $pc"; else echo "  pilot-chat: ${pc:-none} — expected R1 ($R1_SHA)"; echo "refusing: production moved; re-review first"; exit 1; fi
kept_ok || { echo "refusing: a function outside this release is not where R1 left it"; exit 1; }

echo "== 3. secrets (names only; NONE are changed by this script)"
names="$(p secrets list 2>/dev/null | awk -F'|' 'NR>2 {gsub(/ /,"",$1); if ($1!="") print $1}')"
[ -n "$names" ] || { echo "refusing: cannot list production secret names (CLI login / access?)"; exit 1; }
has() { echo "$names" | grep -qx "$1"; }
for k in OPENAI_API_KEY AGENTORY_DELEGATION_ENABLED AGENTORY_ORION_EVIDENCE_CONTEXT MODEL_SPEND_ENFORCEMENT MODEL_SPEND_CEILING_USD MODEL_SPEND_PERIOD_DAYS; do
  has "$k" && echo "  $k: present" || { echo "refusing: $k missing (R1 sets it; this release relies on it and does not set secrets)"; exit 1; }
done
bad="$(echo "$names" | grep -E '^AGENTORY_(TERRA|HYBRID|ROUTE)_|^AGENTORY_GPT_MODEL_FAMILY$' || true)"
[ -z "$bad" ] || { echo "refusing: Terra / routing / model-family secrets present:"; echo "$bad"; exit 1; }

echo "== 4. bundle (built from the app commit $APP_SHA)"
BUILD_TREE="$ROOT/.release-build/app-$APP_SHA"
git worktree remove --force "$BUILD_TREE" >/dev/null 2>&1 || true
rm -rf "$BUILD_TREE"
git worktree add --detach "$BUILD_TREE" "$APP_SHA" >/dev/null 2>&1 || { echo "refusing: cannot create a worktree of $APP_SHA"; exit 1; }
OUT="$(mktemp -d "${TMPDIR:-/tmp}/agentory-r11.XXXXXX")"
cleanup() { rm -rf "$OUT"; git -C "$ROOT" worktree remove --force "$BUILD_TREE" >/dev/null 2>&1 || true; }
trap cleanup EXIT
( cd "$BUILD_TREE" && node scripts/test-project/build-pilot-chat-bundle.mjs "$OUT" pilot-chat production >/dev/null ) \
  || { echo "refusing: pilot-chat did not build at $APP_SHA"; exit 1; }
bytes=$(wc -c < "$OUT/supabase/functions/pilot-chat/index.ts" | tr -d ' ')
echo "  pilot-chat $bytes bytes"
[ "$bytes" -le 4000000 ] || { echo "refusing: bundle larger than 4,000,000 bytes"; exit 1; }
grep -Eq "\"sha\": ?\"$APP_SHA\"" "$OUT/supabase/functions/pilot-chat/index.ts" || { echo "refusing: bundle is not stamped $APP_SHA"; exit 1; }
for marker in orion-intelligence-v1 orion-draft-v1 orion-workspace-facts-v1; do
  grep -q "$marker" "$OUT/supabase/functions/pilot-chat/index.ts" || { echo "refusing: bundle lacks $marker (not an R1.1 build)"; exit 1; }
done
printf 'project_id = "%s"\n\n[functions.pilot-chat]\nverify_jwt = true\n' "$REF" > "$OUT/supabase/config.toml"

if [ "$MODE" = "--check" ]; then echo "CHECK OK (read-only; nothing changed). app=$APP_SHA tool=$TOOL_SHA"; exit 0; fi

echo "== 5. backup of the live pilot-chat (before any change)"
BK="$ROOT/release-backups/r11-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BK/supabase/functions"
printf 'project_id = "%s"\n\n[functions.pilot-chat]\nverify_jwt = true\n' "$REF" > "$BK/supabase/config.toml"
repo_fn_state() { git -C "$ROOT" status --porcelain -- supabase/functions; }
before_state="$(repo_fn_state)"
log="$BK/download-pilot-chat.log"
if ! p functions download pilot-chat --use-api --workdir "$BK" >"$log" 2>&1; then
  echo "  --use-api download failed; retrying with the CLI default" >>"$log"
  p functions download pilot-chat --workdir "$BK" >>"$log" 2>&1 \
    || { echo "refusing: could not back up pilot-chat; nothing was changed. Diagnostics (sanitized):"; tail -n 25 "$log" | sanitize | sed 's/^/    /'; exit 1; }
fi
dir="$BK/supabase/functions/pilot-chat"
files="$(find "$dir" -type f \( -name '*.ts' -o -name '*.js' -o -name '*.tsx' -o -name '*.mjs' \) 2>/dev/null || true)"
[ -n "$files" ] || { echo "refusing: backup has no source files; nothing was changed. Diagnostics (sanitized):"; tail -n 25 "$log" | sanitize | sed 's/^/    /'; exit 1; }
bkbytes=$(cat $files | wc -c | tr -d ' ')
[ "$bkbytes" -ge 200 ] || { echo "refusing: backup implausibly small ($bkbytes bytes); nothing was changed"; exit 1; }
grep -lqE 'Deno\.serve|serve\(|addEventListener\(' $files || { echo "refusing: backup has no server entry point; nothing was changed"; exit 1; }
[ "$(repo_fn_state)" = "$before_state" ] || { echo "refusing: the download changed the repository's supabase/functions/; nothing was changed in production"; exit 1; }
( cd "$BK" && find supabase/functions -type f | sort | while IFS= read -r f; do sha256 "$f"; done ) > "$BK/MANIFEST.sha256"
printf 'release=r1.1\napp_release=%s\ndeployment_tool=%s\nlive_pilot_chat_before=%s\n' "$APP_SHA" "$TOOL_SHA" "$pc" > "$BK/STATE"
echo "  backed up pilot-chat → ${dir#$ROOT/} ($bkbytes bytes); manifest: ${BK#$ROOT/}/MANIFEST.sha256"

echo "== 6. deploy pilot-chat (single-file bundle, --use-api; no secret is touched)"
p functions deploy pilot-chat --use-api --workdir "$OUT"

echo "== 7. verify"
b="$(build_of pilot-chat)"; code="$(post_401)"
echo "  pilot-chat build=${b:-none} no-token POST=$code"
ok=1; { [ "$b" = "$APP_SHA" ] && [ "$code" = 401 ]; } || ok=0
kept_ok || ok=0
[ "$ok" = 1 ] && echo "RELEASE R1.1 DEPLOYED on $REF: pilot-chat app $APP_SHA via tool $TOOL_SHA. Backup: ${BK#$ROOT/}" \
  || { echo "VERIFY FAILED — roll back with: $0 --rollback --confirm $REF --backup ${BK#$ROOT/}"; exit 1; }
