#!/usr/bin/env bash
# SELF-TEST for agentory-test-env against a REAL local Postgres, with a fake Keychain.
# Never touches a hosted project. Creates and drops one throwaway local role.
#
#   AGENTORY_SELFTEST_ADMIN_URL=postgres://postgres:<local>@127.0.0.1:5432/postgres scripts/test-env/selftest.sh
set -uo pipefail
ADMIN="${AGENTORY_SELFTEST_ADMIN_URL:?set AGENTORY_SELFTEST_ADMIN_URL to a LOCAL Postgres superuser URL}"
case "$ADMIN" in postgres://*@127.0.0.1:*|postgres://*@localhost:*|postgresql://*@127.0.0.1:*|postgresql://*@localhost:*) ;; *) echo "refusing: local Postgres only" >&2; exit 2 ;; esac
TOOL="$(cd "$(dirname "$0")" && pwd)/agentory-test-env"
T="$(mktemp -d "${TMPDIR:-/tmp}/agentory-selftest.XXXXXX")"; mkdir -p "$T/bin"
LPORT="$(echo "$ADMIN" | sed -E 's#.*:([0-9]+)/.*#\1#')"
ROLE=postgres.tlvnfrxzjhsjgdofwehb
PW='Te:st\pw-'"$(head -c9 /dev/urandom | base64 | tr -dc a-zA-Z0-9)"; printf '%s' "$PW" > "$T/secret"; chmod 600 "$T/secret"
psql -X -q "$ADMIN" -c "drop role if exists \"$ROLE\"" -c "create role \"$ROLE\" login password '$(printf '%s' "$PW" | sed "s/'/''/g")'" || exit 2
trap 'psql -X -q "$ADMIN" -c "drop role if exists \"$ROLE\"" >/dev/null 2>&1; rm -rf "$T"' EXIT
cat > "$T/bin/security" <<'EOF'
#!/usr/bin/env bash
case "$1" in find-generic-password) [ "${FAKE_KEYCHAIN_EMPTY:-0}" = 1 ] && exit 44; cat "$FAKE_SECRET"; echo ;; *) exit 1 ;; esac
EOF
chmod +x "$T/bin/security"
export AGENTORY_SECURITY_BIN="$T/bin/security" FAKE_SECRET="$T/secret" AGENTORY_TEST_LOCAL=1
export AGENTORY_TEST_CONF=/nonexistent HOME="$T/home"; mkdir -p "$HOME"
export TMPDIR="$T/tmp"; mkdir -p "$TMPDIR"
export AGENTORY_TEST_PGHOST=127.0.0.1 AGENTORY_TEST_PGPORT="$LPORT" AGENTORY_TEST_PGDATABASE=postgres AGENTORY_TEST_PGUSER="$ROLE"
unset PGPASSWORD PGPASSFILE
pass=0; fail=0
ok() { echo "PASS  $1"; pass=$((pass+1)); }
ko() { echo "FAIL  $1"; fail=$((fail+1)); }
leftover() { ls -A "$TMPDIR" | grep -c agentory-pgpass || true; }
nosecret() { grep -qF -- "$PW" "$1" && return 1 || return 0; }

# 1 check: read-only, authenticated, no prompt (stdin closed)
out="$T/o1"; "$TOOL" check </dev/null >"$out" 2>&1; rc=$?
[ $rc = 0 ] && grep -q "read-only=on (a write inside it was refused)" "$out" && grep -q "postgres.tlvnfrxzjhsjgdofwehb @ postgres" "$out" && ok "check authenticates read-only" || { ko "check ($rc)"; cat "$out"; }
nosecret "$out" && ok "check never prints the password" || ko "check printed the password"
[ "$(leftover)" = 0 ] && ok "check removes the password file" || ko "check left a password file"

# 1b the pooler case: startup options are not honoured, the session default is read-WRITE.
#    The check must still report read-only=on and prove a write is refused.
out="$T/o1b"; PGOPTIONS='-c default_transaction_read_only=off' "$TOOL" check </dev/null >"$out" 2>&1; rc=$?
[ $rc = 0 ] && grep -q "read-only=on (a write inside it was refused)" "$out" && ok "read-only enforced in the transaction, not via PGOPTIONS" || { ko "pooler case ($rc)"; cat "$out"; }

# 2 run: file is 0600 in a 0700 dir, scoped to exactly one line; command exit code propagates; file removed
out="$T/o2"; "$TOOL" run -- bash -c '
  f="$PGPASSFILE"; d="$(dirname "$f")"
  echo "PERMS $(stat -c %a "$f" 2>/dev/null || stat -f %Lp "$f") $(stat -c %a "$d" 2>/dev/null || stat -f %Lp "$d") LINES $(wc -l < "$f")"
  echo "SCOPE $(cut -d: -f1-4 "$f")"
  echo "URL $TEST_DB_URL PGPASSWORD=${PGPASSWORD:-unset}"
  psql -w -X -At -c "select 41+1"; echo "$f" > '"$T"'/path; exit 7' </dev/null >"$out" 2>&1; rc=$?
[ $rc = 7 ] && ok "run propagates the command's exit code" || { ko "run exit code ($rc)"; cat "$out"; }
grep -q "PERMS 600 700 LINES 1" "$out" && ok "password file 0600, directory 0700, one line" || { ko "perms"; cat "$out"; }
grep -q "SCOPE 127.0.0.1:$LPORT:postgres:postgres.tlvnfrxzjhsjgdofwehb" "$out" && ok "scoped to exactly host:port:database:user" || { ko "scope"; cat "$out"; }
grep -q "^42$" "$out" && ok "psql -w authenticates from the file (password with ':' and '\\\\' escaped)" || { ko "auth from file"; cat "$out"; }
grep -q "PGPASSWORD=unset" "$out" && grep -q "URL postgresql://postgres.tlvnfrxzjhsjgdofwehb@127.0.0.1:$LPORT/postgres" "$out" && ok "TEST_DB_URL is password-free; PGPASSWORD unset" || { ko "url/env"; cat "$out"; }
[ ! -e "$(cat "$T/path")" ] && [ "$(leftover)" = 0 ] && ok "file removed after a FAILING command" || ko "file left after failure"
nosecret "$out" && ok "run output never contains the password" || ko "run printed the password"

# 3 cleanup inside the command can authenticate AFTER the command fails (EXIT trap)
"$TOOL" run -- bash -c 'trap "psql -w -X -At -c \"select 99\" > '"$T"'/trap.out" EXIT; false' </dev/null >/dev/null 2>&1
grep -q "^99$" "$T/trap.out" && ok "a failing command's own cleanup still authenticates" || ko "trap cleanup could not authenticate"

# 4 wrong password: fails EARLY with exit 3, never prompts, command never starts
printf 'wrong-password' > "$T/secret.bad"
out="$T/o4"; FAKE_SECRET="$T/secret.bad" "$TOOL" run -- bash -c 'echo STARTED' </dev/null >"$out" 2>&1; rc=$?
[ $rc = 3 ] && ! grep -q STARTED "$out" && grep -q "authentication FAILED" "$out" && ok "wrong password: exit 3 before the command, no prompt" || { ko "wrong password ($rc)"; cat "$out"; }
grep -qF "wrong-password" "$out" && ko "printed the wrong password" || ok "failure output never contains the password"
[ "$(leftover)" = 0 ] && ok "file removed after an auth failure" || ko "file left after auth failure"

# 5 no Keychain item
out="$T/o5"; FAKE_KEYCHAIN_EMPTY=1 "$TOOL" check </dev/null >"$out" 2>&1; rc=$?
[ $rc = 3 ] && grep -q "store-password" "$out" && ok "missing Keychain item: exit 3 with the fix" || { ko "missing keychain ($rc)"; cat "$out"; }

# 6 production and foreign projects are refused before Keychain is read
for case in "AGENTORY_TEST_PGUSER=postgres.ohsdatpvfdjdemstoiuj" "AGENTORY_TEST_PGHOST=db.ohsdatpvfdjdemstoiuj.supabase.co" \
            "AGENTORY_TEST_REF=ohsdatpvfdjdemstoiuj" "AGENTORY_TEST_PGUSER=postgres.luvostyizefajbltukkc" "AGENTORY_TEST_PGUSER=postgres"; do
  out="$T/o6"; env "$case" AGENTORY_SECURITY_BIN=/bin/false "$TOOL" check </dev/null >"$out" 2>&1; rc=$?
  [ $rc = 2 ] && grep -q refusing "$out" && ok "refused: $case" || { ko "not refused: $case ($rc)"; cat "$out"; }
done

# 7 Ctrl-C / TERM while the command runs: file removed
"$TOOL" run -- sleep 30 </dev/null >/dev/null 2>&1 & wp=$!
sleep 2; [ "$(leftover)" = 1 ] && ok "file exists while the command runs" || ko "no file during run"
kill -TERM $wp; wait $wp 2>/dev/null; sleep 0.5; pkill -f "^sleep 30$" 2>/dev/null
[ "$(leftover)" = 0 ] && ok "TERM: file removed" || ko "TERM left a file"

# 8 a killed wrapper's leftover is swept by the next run
mkdir -m 700 "$TMPDIR/agentory-pgpass.999999.abcdef"; printf 'x' > "$TMPDIR/agentory-pgpass.999999.abcdef/pgpass"
"$TOOL" check </dev/null >/dev/null 2>&1
[ "$(leftover)" = 0 ] && ok "stale file from a killed wrapper swept" || ko "stale file not swept"

echo "== $pass passed, $fail failed"
[ $fail = 0 ]
