# Company Brain V2: pending live TEST gates (consolidated register)

Everything below is verified locally on a disposable, loopback-only stack: Postgres 17, GoTrue, PostgREST, the real handlers and the real page in headless Chrome. **Nothing here has run on a hosted project.** Each gate needs explicit approval, and none touches production.

## Blockers (decide before any gate)

| # | Blocker | Owner / action |
|---|---|---|
| B1 | The isolated TEST project `tlvnfrxzjhsjgdofwehb` has the always-on trigger `discovery_test_no_company_brain`, which refuses every `company_brain` write by design (decision of 2026-11-09). | User: keep it (verify on a new disposable project or the local stack only), or approve a separate Brain test project |
| B2 | The GitHub `supabase-test` environment's `SUPABASE_ACCESS_TOKEN` is expired (HTTP 401). | User: renew it |
| B3 | TEST lacks the Brain write-hardening migrations (`20261023120000`, `20261024120000`). | Apply in order, per `V1_TEST_DEPLOYMENT.md` |

## Gates, in dependency order

| # | Gate | Depends on | Rollback |
|---|---|---|---|
| G1 | Apply held `20261110120000_company_brain_memory.sql` (V1 memory) | B1, B3 | Header of that file |
| G2 | Apply held `20261122120000_company_brain_provenance.sql` (B2.2) | G1 | `rollback/20261122120000_…down.sql` (verified locally: apply, roll back, re-apply) |
| G3 | Apply held `20261122130000_company_brain_memory_activation.sql` (B2.3) | G1 | `rollback/20261122130000_…down.sql` |
| G4 | Deploy `generate-company-brain-draft`, `setup-company-brain`, `company-brain-memory` to TEST | G1–G3, B2 | Redeploy the previous commit |
| G5 | Deploy `pilot-chat` to TEST (ORION memory offer). **Shared with R1.2.1** (`claude/r1.2.1-workspace-binding` also changes pilot-chat): merge order needed | G4, R1.2.1 decision | Redeploy the previous commit |
| G6 | Frontend preview against TEST | G4 | — |
| G7 | Run the manual acceptance guides (`V2_B20_B21_IMPLEMENTATION.md` §6, `V2_B22_B23_IMPLEMENTATION.md`) on a fictional workspace | G6 | — |
| G8 | Confirm on TEST: one ATLAS search still reads the stored profile (`BrainMergeInput` golden), and memory-folded knowledge reaches ORION only | G7 | — |

Do **not** apply `20260825140000_monitoring_cron.sql` or `20260826170000_resume_stalled_leads_cron.sql` to TEST: both call the production URL. Scheduled monitoring stays off.

## Local-only findings to carry into TEST
- `tests/browser/brainCacheSession.browser.test.ts` launches Chrome without `--no-sandbox`. In a root container, Chrome does not start, so the test needs a `CHROME_BIN` wrapper that adds the flag. Not changed here, because the test file is not part of this work.
- `tests/edge-functions/_shared/fundingWindowRequirement.test.ts` (ATLAS) compares a fixture dated 2024-11-21 with today, so it started failing on 2026-11-22. Reported to the ATLAS owner and not changed here.

## Other pending items (not Brain V2)
- R1.2.1 (`claude/r1.2.1-workspace-binding`): waiting for the user's TEST run. Its held migration `20261121120000_conversation_workspace_guard` is applied to TEST only.
