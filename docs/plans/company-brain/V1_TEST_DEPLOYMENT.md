# Company Brain V1: TEST deployment plan

**Status: prepared, not executed.** Every step below needs your explicit approval. None of it touches production.

Machine-checked manifest: `scripts/test-project/brain-v1/manifest.json`
Validator (read-only; no network, no database connection): `node scripts/test-project/brain-v1/check-manifest.mjs [--db-url "$TEST_DB_URL"]`
Preflight (catalog `SELECT`s only): `scripts/test-project/brain-v1/preflight.sql`

## Blocker: decide before anything else

The isolated TEST project `tlvnfrxzjhsjgdofwehb` (agentory-discovery-test) has the trigger `discovery_test_no_company_brain` installed, and it is **always enabled**. I verified this on 2026-11-09 with a catalog-only query.

That trigger refuses every `company_brain` insert or update, on purpose. The project is the isolated Discovery smoke environment, and that environment must never contain a Brain (`scripts/test-project/sql/20261017120000_discovery_test_no_company_brain.sql`). This is also why TEST has 0 Brain rows. Preflight check **P1** fails on this project, and the plan stops there.

You have two options:

1. **Recommended:** create a separate Brain TEST project (e.g. `agentory-brain-test`), build it with `scripts/test-project/build-test-schema.sh` *without* `--with-test-no-brain-guard`, and set its ref as `target.ref`. The Discovery smoke environment stays exactly as it is.
2. Approve a reviewed removal of the guard on `tlvnfrxzjhsjgdofwehb`. This breaks the Discovery smoke admission contract, which assumes no Brain exists on that project.

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
