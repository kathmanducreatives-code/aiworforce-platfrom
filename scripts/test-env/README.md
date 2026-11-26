# TEST database credentials: Keychain to a temporary PGPASSFILE

`agentory-test-env` gives TEST runners database access with no password prompt and no password on disk beyond a run. It holds no secrets, and nothing it creates belongs in the repository.

## One-time setup (macOS)

```bash
ln -sf "$PWD/scripts/test-env/agentory-test-env" ~/bin/agentory-test-env   # or have your existing agentory-test-env call it
```

```bash
mkdir -p ~/.config/agentory && cat > ~/.config/agentory/test-db.conf <<'EOF'
AGENTORY_TEST_PGHOST=aws-0-ap-northeast-2.pooler.supabase.com
AGENTORY_TEST_PGPORT=5432
AGENTORY_TEST_PGDATABASE=postgres
AGENTORY_TEST_PGUSER=postgres.tlvnfrxzjhsjgdofwehb
EOF
```

- Use the **session pooler** host and user shown for ATLAS TEST under Connect → Session pooler.
- This file holds settings only, never the password.

```bash
agentory-test-env store-password
```

```bash
agentory-test-env check
```

- **`store-password`:** the macOS `security` tool prompts for the password; it is never echoed. The Keychain item is service `agentory.test.postgres`, with account `user@host:port/db`.
- **`check`:** runs one query inside `BEGIN READ ONLY … ROLLBACK`, then proves the transaction is read-only by attempting a temporary-table write that the server must refuse. It prints `… · read-only=on (a write inside it was refused)`.
- **Through the session pooler, the user prints as `postgres`.** The pooler maps `postgres.<ref>` to `postgres`; this is expected.

## Every run: one command

```bash
agentory-test-env run -- scripts/test-project/r11-test-run.sh --confirm tlvnfrxzjhsjgdofwehb
```

```bash
agentory-test-env run -- scripts/test-project/openai-quota-probe.sh --confirm tlvnfrxzjhsjgdofwehb
```

**What `run` does:**
1. Refuses production (`ohsdatpvfdjdemstoiuj`) and any other project before Keychain is read.
2. Writes one pgpass line scoped to exactly `host:port:database:user`. The file is mode 0600, inside a 0700 directory.
3. Exports `PGPASSFILE` and a password-free `TEST_DB_URL`, and unsets `PGPASSWORD`.
4. Authenticates once with `psql -w`, which never prompts. If that fails it stops with **exit 3** before the runner starts.
5. Runs the runner.
6. Deletes the file on every exit, including errors, Ctrl-C, TERM and HUP. A file left by a killed run is swept on the next start.

**Cleanup always gets access.** The file stays until the runner has exited, so the runner's own cleanup still authenticates after a failed step. The runners also run every cleanup step even when one fails. They verify that 0 run records are left, and otherwise end with `CLEANUP FAILED` and exit 4.

**Run outside the wrapper,** with a `TEST_DB_URL` that has no usable password, the runners stop at once (exit 3) and print the command to use. They no longer hang on a password prompt.

## Self-test

```bash
AGENTORY_SELFTEST_ADMIN_URL=postgres://postgres:<local>@127.0.0.1:5432/postgres scripts/test-env/selftest.sh
```

This runs against a real **local** Postgres with a fake Keychain, and checks 23 things:
- file permissions and scope;
- escaping of `:` and `\`;
- exit-code pass-through;
- removal after failure and after TERM;
- the stale-file sweep;
- fail-early on a wrong password (exit 3, no prompt);
- that no password ever appears in output;
- refusal of production and foreign refs.

## Validation record

| Date | Where | Result |
|---|---|---|
| 2026-11-25 | Linux, local Postgres 17 (self-test) | 23/23 |
| 2026-11-26 | **macOS, owner's machine, ATLAS TEST via the session pooler, commit `e267a083`** | Keychain item saved; `check` authenticated with **no password prompt**. Installed as the alias `agentory-test-db`; the existing `agentory-test-env` shell function is kept. Output: `postgres @ postgres · read-only=off` (see the next row) |
| 2026-11-26 | Fix | `read-only=off` was real. The old check set read-only through `PGOPTIONS`, a startup option that the **Supabase pooler does not forward**. The probe itself was a single `SELECT`, so nothing was written. The check now enforces read-only inside the transaction and proves it with a refused write. The production backup script had the same dependency and is fixed the same way. Self-test 24/24, including a case where the session default is read-write |

**To confirm on macOS** (read-only, no cost): `agentory-test-db check`. It should end with `read-only=on (a write inside it was refused)`.
