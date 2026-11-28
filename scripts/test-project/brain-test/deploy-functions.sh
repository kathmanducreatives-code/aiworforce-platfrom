# Sourced by deploy-brain-test.sh and install-atlas-v5.sh. NO DOCKER.
#
#   brain_test_deploy_functions <ref> <function>...
#
# Each function is bundled locally into ONE file (scripts/test-project/build-pilot-chat-bundle.mjs,
# target brain-test: esbuild inlines every local _shared module; https:/npm:/jsr:/node: imports stay
# external and are resolved by Supabase), then deployed with `supabase functions deploy --use-api`
# (server-side bundling, no Docker). A plain --use-api upload of pilot-chat's ~284 source modules
# is refused with HTTP 413; the single file is ~1.4 MB. Same proven path as TEST and the R1 release.
#
# Refuses before any upload: a ref other than Brain TEST, a bundle whose generated config names
# another project, a bundle with a relative import left in it, or one over 4 MB.
# verify_jwt stays true for every function (repo config.toml sets no override).
brain_test_deploy_functions() {
  local ref="$1"; shift
  case "$ref" in
    jekgwafobrzamoupehnn) ;;
    brainrehearsalzzzzzz) [ "${BRAIN_TEST_REHEARSAL:-0}" = 1 ] || { echo "refusing: rehearsal ref outside rehearsal mode" >&2; return 1; } ;;
    *) echo "refusing: bundled deploy targets Brain TEST only (got $ref)" >&2; return 1 ;;
  esac
  command -v node >/dev/null || { echo "refusing: node is required to bundle (no Docker needed)" >&2; return 1; }
  local root; root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
  [ -d "$root/node_modules/esbuild" ] || { echo "refusing: esbuild missing; run npm ci in $root" >&2; return 1; }
  local out; out="$(mktemp -d "${TMPDIR:-/tmp}/brain-test-bundle.XXXXXX")"
  local fn f bytes
  for fn in "$@"; do
    ( cd "$root" && node scripts/test-project/build-pilot-chat-bundle.mjs "$out" "$fn" brain-test >/dev/null ) \
      || { echo "refusing: $fn did not bundle" >&2; rm -rf "$out"; return 1; }
    f="$out/supabase/functions/$fn/index.ts"
    bytes=$(wc -c < "$f" | tr -d ' ')
    [ "$bytes" -le 4000000 ] || { echo "refusing: $fn bundle is $bytes bytes (> 4 MB)" >&2; rm -rf "$out"; return 1; }
    if grep -Eq "(from|import)[[:space:]]*\(?[\"']\.\.?/" "$f"; then
      echo "refusing: $fn bundle still has a relative import (a local module was not inlined)" >&2; rm -rf "$out"; return 1
    fi
    printf "  bundled %-30s %s bytes\n" "$fn" "$bytes"
  done
  { echo "project_id = \"$ref\""; for fn in "$@"; do printf '\n[functions.%s]\nverify_jwt = true\n' "$fn"; done; } > "$out/supabase/config.toml"
  grep -q "ohsdatpvfdjdemstoiuj\|tlvnfrxzjhsjgdofwehb" "$out/supabase/config.toml" && { echo "refusing: bundle config names a protected project" >&2; rm -rf "$out"; return 1; }
  for fn in "$@"; do
    echo "  deploying $fn → $ref (--use-api, server-side bundling)"
    supabase functions deploy "$fn" --project-ref "$ref" --use-api --workdir "$out" >/dev/null \
      || { echo "refusing: deploy of $fn failed; functions after it were not deployed" >&2; rm -rf "$out"; return 1; }
  done
  rm -rf "$out"
}
