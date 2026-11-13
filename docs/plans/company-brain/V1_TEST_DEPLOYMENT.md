# Company Brain V1: TEST deployment plan

**Status: prepared, not executed.** Every step below needs your explicit approval. None of it touches production.

Machine-checked manifest: `scripts/test-project/brain-v1/manifest.json`
Validator (read-only; no network, no database connection): `node scripts/test-project/brain-v1/check-manifest.mjs [--db-url "$TEST_DB_URL"]`
Preflight (catalog `SELECT`s only): `scripts/test-project/brain-v1/preflight.sql`

## Blocker: decide before anything else

The isolated TEST project `tlvnfrxzjhsjgdofwehb` (agentory-discovery-test) has the trigger `discovery_test_no_company_brain` installed, and it is **always enabled**. I verified this on 2026-11-09 with a catalog-only query.

That trigger refuses every `company_brain` insert or update, on purpose. The project is the isolated Discovery smoke environment, and that environment must never contain a Brain (`scripts/test-project/sql/20261017120000_discovery_test_no_company_brain.sql`). This is also why TEST has 0 Brain rows. Preflight check **P1** fails on this project, and the plan stops there.

**Decision (2026-11-09):** the no-Brain guard stays, and no new hosted project will be created. Brain V1 is therefore verified in a **disposable, loopback-only stack** instead of a hosted TEST project. That stack is Docker Postgres 17.6 + pinned GoTrue + pinned PostgREST, and it runs the real handlers and the real page. See "Verify without a hosted project" below. Hosted verification stays blocked until a future, separate decision.

The TEST project also lacks the Brain write-hardening migrations. Browser insert and update policies on `company_brain` still exist there, and `company_brain_authorized_write` is missing. Steps 1–2 fix that.

## Order (after the blocker is resolved)

| Step | What | Check before | Rollback |
|---|---|---|---|
| 0 | `psql "$TEST_DB_URL" -f scripts/test-project/brain-v1/preflight.sql` | Every row `ok = t` | — (read-only) |
| 1 | Apply `supabase/migrations/20261023120000_company_brain_server_writes_only.sql` | Policy `company_brain_member_insert` exists | Header of that file |
| 2 | Apply `supabase/migrations/20261024120000_company_brain_authorized_writer.sql` | `company_brain_authorized_write` is missing | Header of that file |
| 3 | Apply `supabase/migrations-held/20261110120000_company_brain_memory.sql` | P4 (no memory tables yet) | The `Rollback` block in its header |
| 4 | Deploy functions `company-brain-memory`, `generate-company-brain-draft`, `setup-company-brain`, `daily-brief`, `run-monitoring-scan`, `run-radar-scan` with `--project-ref <TEST ref>` | `node scripts/verify-deploy-target.mjs --expect test` with `DEPLOY_SUPABASE_PROJECT_REF=<TEST ref>` | Redeploy the previous commit |
| 5 | `run-agent` (the LYRA content branch) | **Coordinate with the ATLAS track first** (shared function) | Redeploy the previous commit |
| 6 | Frontend preview with `VITE_SUPABASE_URL=https://<TEST ref>.supabase.co` and that project's publishable key | — | — |

Do **not** apply these to TEST: `20260825140000_monitoring_cron.sql` and `20260826170000_resume_stalled_leads_cron.sql`. Both schedule calls to the literal **production** URL. The validator refuses any migration that contains a hosted functions URL.

The memory functions and loader need no new secrets. `SIGNALS_V2=true` only matters for LISA monitoring writes.

## Verification on TEST (no paid calls)

1. Seed two fictional workspaces with an owner, an editor and a viewer each.
2. Through the app, check: the profile edit creates a revision; adding exclusions and preferences appears in "How agents use it"; a viewer gets no write buttons and a direct call returns 403.
3. Insert a LISA proposal by calling `company_brain_proposal_submit` as the service role with a fictional competitor. Approve it as the editor and confirm it appears in ORION's brief context.
4. Retract the fact and confirm it disappears from every agent block.
5. Generate the ORION brief: `daily-brief` runs deterministically. Its single optional model-wording call is bounded by the model-spend ceiling. Set the ceiling to 0 to stay free.

## Rollback

- **Database:** run the rollback block in the held migration's header in one transaction. The shared loader tolerates the tables being absent, so functions fall back to the profile alone.
- **Functions:** redeploy the previous commit's build.
- **Data:** memory rows can be redacted by an owner or admin (`company_brain_memory_redact`). Dropping the tables removes everything.

## Verify without a hosted project (what was actually run)

All of this runs in the cloud development container. Nothing leaves loopback.

```bash
dockerd >/tmp/dockerd.log 2>&1 &   # if the daemon is not already running
export POSTGREST_BIN=/path/to/postgrest-v12.2.3 CHROME_BIN=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome
```

Real GoTrue, real handlers, mid-request revocation, and ORION's real `daily-brief`:

```bash
tests/db-contract/run-with-gotrue.sh tests/db-contract/companyBrainMemoryEndToEnd.contract.test.ts
```

The real Company Brain page, signed in, in headless Chrome:

```bash
BRAIN_E2E_DENO_FLAGS="--allow-run --allow-write" tests/db-contract/run-with-gotrue.sh tests/browser/brainMemory.browser.test.ts
```

Memory contract and acceptance scenarios A–H (plain lane, local Postgres 17):

```bash
PG_ADMIN_URL=postgres://…@127.0.0.1:5433/postgres tests/db-contract/run.sh tests/db-contract/companyBrainMemory.contract.test.ts tests/db-contract/companyBrainAcceptance.contract.test.ts
```
