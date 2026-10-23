#!/usr/bin/env bash
# Disposable CI checkout only: prove omission of the EXISTING P1 verifier is caught.
# No runtime bypass flag, signing key, provider or alternative verifier is added.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
file="$root/supabase/functions/_shared/pilot/pilotTaskRegistration.ts"
saved="$(mktemp)"; log="$(mktemp)"
cp "$file" "$saved"
cleanup() { cp "$saved" "$file"; rm -f "$saved" "$log"; }
trap cleanup EXIT
# Only this explicitly marked owned verifier call is removed. Restore on all exits.
sed '/MUTATION_P1_VERIFICATION_BEGIN/,/MUTATION_P1_VERIFICATION_END/d' "$saved" > "$file"
if OUTPOST_NATIVE_LIFECYCLE=1 "$root/tests/outpost-native/run.sh" > "$log" 2>&1; then
  echo 'P1 verifier omission survived registration contracts' >&2; exit 1
fi
# Unused P1 imports do not fail Deno type checking; these must be semantic failures.
sed 's/\x1b\[[0-9;]*m//g' "$log" | grep -q 'forged mac never captures a binding.*FAILED'
sed 's/\x1b\[[0-9;]*m//g' "$log" | grep -q 'forged payload never captures a binding.*FAILED'
echo 'P1 verifier omission caught by real forged-MAC and altered-payload registration tests'
