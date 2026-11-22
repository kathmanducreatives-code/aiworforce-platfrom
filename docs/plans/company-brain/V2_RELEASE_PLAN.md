# Company Brain V2 foundation release (B2.0–B2.3): release candidate and live plan

**Release candidate branch:** `claude/company-brain-v2-rc`. It is B2.0–B2.3 merged with the latest `launch/hardening` (`c114a37d`, ATLAS V4 PRs #275 and #276). The merge was clean.

**Follow-on:** B2.4 is on `claude/company-brain-v2-b24`, built on the RC. It ships after the RC.

## What is in the release

| Area | Change |
|---|---|
| B2.0 | Truthful readiness, guided completion and suggestions. Every suggestion needs explicit acceptance |
| B2.1 | One ICP: conflicts detected and resolved, and new contradictions refused |
| B2.2 | Provenance on every profile revision, decided by the server |
| B2.3 | Teach Agentory; proposal review with edit; dashboard strip; ORION offers to remember (pending until approved) |
| Fixes | Inline editor stale draft; the Brain page jumping to the tabs on load; the offer card shows the value actually remembered |

**Held migrations (additive; each has a verified rollback):**
- `20261122120000_company_brain_provenance` (B2.2): new revision columns, the revision trigger, and the `company_brain_provenanced_write` wrapper. `company_brain_authorized_write` is unchanged.
- `20261122130000_company_brain_memory_activation` (B2.3): decision proposals, `company_brain_proposal_submit`.

**Dependencies:**
- Production already has V1 memory and the write-hardening (`ENVIRONMENT_INVENTORY.md`), so nothing else is needed.
- On a fresh database, the order is: hardening → V1 → B2.2 → B2.3.
- The rollback order is B2.3, then B2.2. Each was checked: apply, roll back, re-apply, plus a second apply to prove it is idempotent.

**Degrades safely:** the new function code runs on a database without the new migrations.
- Without B2.2, the writer falls back to `company_brain_authorized_write` and revisions read as "unrecorded".
- Without B2.3, a decision offer is simply not made.
- So the migrations and the functions can be deployed in either order. Migrations first is recommended.

## Validation on the final combined tree
The combined tree is RC + R1.2.1 (`tmp/rc-plus-r121`): the exact state after both are integrated.

| CI step | Result |
|---|---|
| Type-check: every edge function (except `mcp`, as CI) + worker | pass |
| Edge-function tests | 10,285 passed, 1 failed. The failure is `fundingWindowRequirement` RECENCY, a date-dependent ATLAS test that also fails on `launch/hardening`. Reported to the ATLAS session with a likely clock-leak diagnosis |
| Lead V2 quality regressions | 74 / 0 |
| Deploy-safety (infra) | 335 / 0 |
| QA harness | 55 / 0 and 30 / 0 |
| Replay Lab readiness | "SAFE FOR PRODUCTION SMOKE: YES" |
| UI tests (Deno / Node) | 812 / 0 and 13 / 0 |
| tsc / eslint ratchets | 23 / 1,265 (baseline) |
| Production build | pass |
| Database contract lane | **479 / 0** |
| Real-process rehearsals | 4 / 4. Needs `TMPDIR` set to a writable directory in this container; the same is true on `launch/hardening` |
| Mutation proof | see the final report |
| Browser, real stack (completion, memory, cache session) | 4/4, 4/4, 5/5 |
| ATLAS golden contract | unchanged |

## Integration order
1. **R1.2.1 → `launch/hardening`** (`claude/r1.2.1-workspace-binding`), once the owner's TEST run passes. It is small, its migration is already on TEST, and it is independent of the Brain.
2. **The Company Brain V2 RC → `launch/hardening`.** Both change `pilot-chat`; the merge is clean and the combined tree is validated above. The binding check runs before the user's turn is recorded and the memory offer after it, so a refused cross-workspace chat never produces an offer.
3. **B2.4 → `launch/hardening`**, after step 2. Its deploy includes `run-agent`, which is shared with the ATLAS track and needs coordination.
4. `launch/hardening` → `main` (Lovable builds production's frontend from `main`).

## Remaining steps for a complete live release
Every step needs the owner's explicit approval. Production stays read-only until each one is approved.

**Hosted validation**, before production (`BRAIN_TEST_ENVIRONMENT_OPTIONS.md`):
1. Decide on a Brain test project. The recommendation is a separate project, leaving the ATLAS TEST guard intact.
2. If approved, set it up: baseline, migrations, held Brain chain, deploy the Brain functions, seed fictional workspaces.
3. Renew the GitHub `supabase-test` `SUPABASE_ACCESS_TOKEN` (expired, HTTP 401).
4. Run the acceptance guides there (`V2_B20_B21_IMPLEMENTATION.md` §6, `V2_B22_B23_IMPLEMENTATION.md`).

**Production** (`ohsdatpvfdjdemstoiuj`; verify the ref before every command):

5. **Preflight (read-only):** the catalog shows V1 present, no `source_kind` column, no `company_brain_provenanced_write`, and `proposal_submit` without decisions. Record the current function versions for rollback:

   | Function | Current version |
   |---|---|
   | `generate-company-brain-draft` | v46 |
   | `setup-company-brain` | v51 |
   | `company-brain-memory` | v1 |
   | `pilot-chat` | v211 |
   | `daily-brief` | v49 |

6. **Apply `20261122120000` (B2.2), then verify:** the columns exist; a test revision on a fictional internal workspace records `founder`.
7. **Apply `20261122130000` (B2.3), then verify:** a decision proposal submits on the fictional workspace.
8. **Deploy, with an explicit `--project-ref` and `verify-deploy-target --expect production`:** `generate-company-brain-draft`, `setup-company-brain`, `company-brain-memory`, and `pilot-chat` (B2.3 offer + R1.2.1 binding).
9. **Frontend:** merge to `main` so Lovable builds it.
10. **Smoke** on the fictional internal workspace: Brain page readiness and provenance; Teach Agentory (one decision, one conflict confirmation); one chat offer → Remember → a new chat knows it; the dashboard strip. There are no paid calls in any of these steps.
11. **Rollback, if needed:** redeploy the recorded function versions, then run B2.3 down, then B2.2 down.

**Housekeeping**, in the same release: move `20261110120000_company_brain_memory.sql` (already in production as `20261113080619`) from `migrations-held/` into `supabase/migrations/` under the recorded version, so the repo matches the hosted history.

**Out of scope, unchanged:** ATLAS discovery and `BrainMergeInput` authority; monitoring stays contained (no scheduler change); ORION delegation stays off; manual LISA scans stay available.
