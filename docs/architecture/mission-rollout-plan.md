# Mission reliability overhaul: production rollout plan (owner-gated)

Every step that changes production or historical missions requires the owner's explicit approval. Nothing in this file has been applied.

## 0. Preconditions (each must be verified, not assumed)

| # | Check | How | Status |
|---|---|---|---|
| 0.1 | S1–S6 are on `launch/hardening` | `git merge-base --is-ancestor 613cac7 origin/launch/hardening` | blocked: only S1 had landed; #232 lands S2–S6 (tree identical to the reviewed #231 head) |
| 0.2 | CI green on `launch/hardening` at the landed commit | commit checks, CI gate | pending #232 |
| 0.3 | TEST runs the landed build | `x-agentory-build` on `lead-pipeline` and `provider-connections` | pending deploy |
| 0.4 | TEST smoke passes at that build (incl. P1, the `signal role` incident) | `agentory/test-smoke` status | pending |
| 0.5 | v3 on TEST: flag set, observed in the running service, smoke re-run | see §2 | pending |
| 0.6 | Live paraphrase study meets acceptance (§3) | `discovery-test-worker.yml` stage `study`, artifact | pending owner dispatch |
| 0.7 | Production replay and verdict replay reviewed | `docs/architecture/mission-migration/report.md` | ready |

## 1. Historical missions: migration preview (S5)

**Affected missions.** There are 49 of 83 stored missions whose meaning would change if run-agent were deployed without migration. The identities and diffs are in `mission-migration/report.md`, and the original and proposed criteria are in `report.json`. All 49 changes come from compiler rules merged **before** this overhaul (for example, a hard geography always carries a scope; "startup" read from a stage word is no requirement). The overhaul adds **none**: the production replay is identical before and after S1–S6.

| Category | Missions | Effect |
|---|---|---|
| Unscoped US / state geography → headquarters | 35 | narrows |
| "startup" hard → target | 18 | broadens |
| A restated constraint removed | 3 | broadens or neutral |
| `hiring_activity: sales roles` → unprovable | 1 | narrows (blocks qualification) |
| Either/or group added | 2 | broadens |

**Verdict impact.** 7 stored candidates have check-level changes and **0 have eligibility changes**.

**Known interpretation defects that Option A would PRESERVE (owner decision each):**

| Mission | Defect | Option A keeps | Alternative |
|---|---|---|---|
| Quality run Z08 | D4: "salespeople, sales reps, account executives, AEs" stored as `aes` only | AE-only hiring (narrowed) | Recompile from the request (S1 fixed D4): all four roles (broadens back to the request) |
| `missionHiringSalesRoles` ("actively hiring sales roles") | R2: the role was stored as an unrecognised constraint, so the hiring requirement carries no role | Hiring with no role | Recompile: hiring for sales roles (restores the role) |

**Options:**
- **A (recommended), freeze at today's production meaning.** Deploying changes no stored mission.
  - The plan covers 82 missions (1 has no criteria). It is verified: each mission is frozen, executes the release's exact criteria and IDs, keeps ORION's search vocabulary, and keeps its `missionHash`.
- **B, deploy without migration.** The 49 changes take effect on each mission's next run.
- **C, per mission.** Approve listed changes in `tests/fixtures/mission-semantics/production-replay-approved.json` and freeze the rest.

**Approval-hash compatibility.**
- `missionHash` covers query, type, entity, output, count, company profile, signals, decision-makers and capabilities. It does **not** cover criteria or the freeze fields.
- Freezing therefore changes no approval or signed plan token. This is pinned by `migrationReport.test.ts` and `missionCriteriaReader.test.ts`.

**Rollback.** `rollback.sql` writes back each exported mission exactly (guarded on the frozen state), so `criteria`, `criteria_contract_version`, `criteria_fingerprint` and `criteria_freeze_origin` return to their exported values. Re-derivation resumes.
- **Re-verified on Postgres 2026-11-05 (and fixed).** The rehearsal used a throwaway local Postgres 16, the 83 persisted missions as an export, and release `e4da19e8`.
  - The earlier `rollback.sql` was **not** exact. It dropped every null-valued key of the mission, including the mission's own fields such as `requested_count: null`, which `missionHash` covers. Only 29 of 83 rows round-tripped.
  - `migrationSql` now restores the export itself. Results: freeze changes 82 of 83 rows (1 has no criteria); rollback restores **83 of 83 byte-identical**; both scripts are idempotent.
  - Pinned by `migrationReport.test.ts`, which fails on the old behaviour.
- Any `rollback.sql` generated before this fix must be regenerated.

## 2. TEST: enable contract v3

1. Set the TEST secret `AGENTORY_MISSION_CONTRACT=v3` (Supabase dashboard; edge-function secrets apply to new isolates).
2. Prove it is live in the RUNNING service, not merely configured: run one TEST plan, then read the mission it stored. The mission must carry `understanding.version === "mission-understanding-v1"`, and it is present only when the deployed compiler asked the model for the v3 schema and validated its answer. Nothing logs the schema name, so the stored mission is the proof.
3. Re-run the TEST smoke (dispatch `deploy-test-functions.yml` with `force=true`).
4. **Rollback:** unset the secret (v1 behaviour is byte-identical).

## 3. Live paraphrase study (`discovery-test-worker.yml`, stage `study`)

**Running it.** It is a stage of the one workflow allowed to read TEST secrets (that isolation rule is enforced by `testWorkerProposal.test.ts`). Dispatch with:
- `canary_stage=study`
- `confirm_project_ref=tlvnfrxzjhsjgdofwehb`
- `expected_sha` = the landed commit
- `canary_approval="run the live paraphrase study within 2 USD"`

The stage reads only `TEST_OPENAI_API_KEY`, reaches only `api.openai.com`, and enforces at most 180 calls and $2 at the transport. The cap is fixed, not an input. It runs the guard tests first, then a dry run, then the live study, and uploads the report as an artifact. `liveStudyWorkflow.test.ts` pins all of this.

**Acceptance criteria (proposed):**
- ≥ 90% of phrasings correct;
- 0 collapsed contrast pairs;
- no case where every phrasing is wrong;
- every failure classified as **model** (invalid or wrong understanding) or **compiler** (correct understanding executed wrongly).

**Gate.** Any **compiler** failure blocks the rollout until it is fixed. Model failures are fixed through the contract instructions, then the study is re-run within the remaining budget.

## 4. Production deployment sequence (owner approval at each step)

1. **Export** stored missions read-only from production (`task_plans.steps[i].metadata.tool_input.lead_mission`), then run:
   `deno run -A scripts/dev/migration-report.ts --release-dir <e4da19e8 checkout> --missions export.json`
   Review `report.md`, `freeze.sql` and `rollback.sql`. Decide Z08 and the R2 mission.
2. **Back up** `task_plans`, or at least the exported rows.
3. **Apply** `freeze.sql` (Option A) in one transaction. Each statement only touches a mission unchanged since the export.
4. **Verify:** re-export and confirm every mission reads `frozen`; the production replay of the export must show 0 changes against the new build.
5. **Deploy** a new pinned release. `deploy-held-back-functions.yml` is pinned to release `e4da19e8`, which covers run-agent only; pilot-chat stays on `86ac1b92`, and the worker bundles run-agent. The overhaul needs:
   - **run-agent:** the reader, the matcher and R7;
   - **pilot-chat:** the freeze at approval, and clarification questions;
   - **the worker:** it bundles run-agent.

   Updating that release definition is an owner-reviewed workflow change, and its semantic replay gate must pass, or each difference must be approved.
6. **Keep v1 in production at first** (`AGENTORY_MISSION_CONTRACT` unset). Observe the `[run-agent][criteria] freeze:` log lines: stored missions should read `frozen`, new ones `frozen`, and none `void`.
7. **Enable v3 in production** only after the TEST study meets acceptance and TEST has run v3 cleanly.
8. **Rollback at any step:**
   - redeploy the previous release (step 5);
   - `rollback.sql` (step 3);
   - unset the flag (step 7).
