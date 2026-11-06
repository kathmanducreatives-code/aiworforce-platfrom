# Agentory — development checkpoint (resume here)

**Updated:** 2026-11-05. No secrets in this file. Each claim says how it was verified.

## 1. Where the code is

| | |
|---|---|
| Main development branch | `launch/hardening` @ `5c91efd` (merge of #236) |
| This work | branch `claude/magical-dirac-c7okyr`, three commits on `5c91efd` (+ #238's commit cherry-picked) |
| TEST project | `tlvnfrxzjhsjgdofwehb` (agentory-discovery-test) |
| Production project | `ohsdatpvfdjdemstoiuj`: **untouched by this work** |

### PR state (verified on GitHub 2026-11-05)

| PR | State | Notes |
|---|---|---|
| #232–#236 | **merged** into `launch/hardening` | ancestry checked: `66a3e1b` (#234), `bfc61de` (#235), `5c91efd` (#236) |
| #237 opt-in hiring check by company | **OPEN, not merged** | The handoff said it was merged; it is not. CI was green on its head. It is "behind" but merges cleanly onto `launch/hardening` and onto this branch. It changes paid behaviour, so it needs owner review. |
| #238 provider summary card | **OPEN, not merged** | Auto-merge never completed. Its commit is included in this branch's PR, which supersedes it. |

## 2. TEST deployment (verified)

- The `TEST deploy @ 5c91efd` workflow succeeded, and the commit statuses are success:
  - `agentory/test-smoke`: "TEST READY";
  - `agentory/test-interpretation`: contract v3, understanding `mission-understanding-v1`, 0 rejected, criteria frozen.
- `lead-pipeline` v22 runs build `bfc61de` (#235). #236 changed no function code, so it was correctly not redeployed. `provider-connections` v15 runs `c776ed8`.
- TEST flags, from the smoke report:
  - **on:** `LEAD_PIPELINE_ENABLED`, `PROVIDER_DISCOVERY_ENABLED`, `PROVIDER_APIFY_DISCOVERY_ENABLED`, and both allowlists (TEST workspace only);
  - **off:** `PROVIDER_LEADOCEAN_ENABLED` (every LeadOcean strategy plans as "leadocean disabled (feature flag off)"), Apollo, phones, signals, evidence cache.
- TEST DB (read-only):
  - `workspace_provider_connections`: **0 rows**;
  - `provider_usage_ledger`: **0 rows**;
  - comparison prior spend (`provider-cmp-prior-spend.sql`): `{apifyUsd: 0, leadoceanRecords: 0}`.
- Ops health has failed on every scheduled run since 2026-11-04 14:50:
  - `worker /health` returns HTTP 404;
  - 1 mission has been unclaimed for about 22 days.
  - This is the Railway worker. It predates this work and is not caused by it.

## 3. Provider identities (read-only, free)

- **Apify (this session's connected account):** username `Prasidha`.
  - Paying STARTER plan, created 2026-10-24, $19 monthly cap.
  - $0.46 used in the cycle 2026-10-24 → 11-23.
  - **The TEST worker token is this account:** TEST `lead_execution_calls` run ids `8PmW7c0f6oJDQdxJQ` and `UAx1AUEtj7uswX6bd` (2026-10-30) appear in its run history.
  - The `lead-pipeline` **Edge Function's** Apify token has never made a call, so its account is proven only by the first live run id (check it in Apify's run list).
- **LeadOcean (this session's connector):** account `prasidha@agentory.space`, **free plan**.
  - Lifetime ceiling 1,000 records; 47 used, 953 left; requests are refused past the ceiling.
  - Not connected to the TEST workspace.

## 4. Gated runs dispatched (waiting for the owner)

Both are pinned to `launch/hardening` @ `5c91efd3f6a9269af7c21372755ee71485b16ec2`:

- run 41990176436, **study**, with `canary_approval="run the live paraphrase study within 2 USD"`. It is waiting for the `discovery-test` Environment reviewer. Offline before dispatch:
  - guard tests 6/6;
  - dry run 165 calls, $0.577 worst-case reserved, 0 errors.
- run 41990179846, **verify**: read-only, free. It is queued behind the study (one run at a time).

The study has **never run before**: the workflow's earlier runs contain no `study` stage.

## 5. What this branch adds

1. **Dashboard:** `StrategyDiscoveryPanel` on the mission card, behind `VITE_STRATEGY_DISCOVERY=true`.
   - Flow: plan → approve the worst case → run; it renders `ProviderRunSummaryCard`, the overlap, every company's verdict, checks, gaps, links, signals and conflicts. Nothing is counted on the client.
   - Tests: `tests/frontend/strategyDiscovery.test.ts` (11, on real-executor runs).
2. **Live comparison harness hardening** (`scripts/test-project/provider-live-comparison.ts`):
   - one shot across invocations (TEST ledger prior spend);
   - all plans ready before any purchase;
   - stops on unknown spend;
   - requires `AGENTORY_PROVIDER_LIVE_TESTS=enabled`.
   - Tests: 10.
3. **Migration rollback fix:** `rollback.sql` had dropped the mission's own null fields; it now restores the export exactly.
   - Postgres rehearsal: 83/83 byte-identical; freeze 82/83; idempotent.
   - Regression test in `migrationReport.test.ts`.

### Test results on this branch (2026-11-05)

| Suite | Result | Baseline |
|---|---|---|
| `npm run test:ui` | 744 passed, 0 failed | 733 (+11 new) |
| `npm run test:ui:node` | 9 passed | |
| ratchets | tsc 23/23, eslint 1275/1275 | unchanged |
| `npm run build` | ok | |
| infra `tests/infra/` | 299 passed, 0 failed | 289 reported earlier (+4 new, +6 from #236) |
| edge `tests/edge-functions/` | 9,577 passed, 0 failed (+ the new migration test, 7/7 in its file) | 9,566 reported earlier |
| Replay Lab (`test:lead-v2-readiness`) | 280 passed, 0 failed, 1 documented known gap; SAFE FOR PRODUCTION SMOKE: YES | 280 |

## 6. Blockers and owner decisions

1. **Approve the two waiting runs** (study, then verify) in GitHub: Actions → the run → Review deployments → `discovery-test`.
2. **LeadOcean on TEST.** These are commercial and account decisions; they were not taken here.
   - Decide whether the free-plan LeadOcean account may be used commercially.
   - If yes, set the TEST Edge Function secrets `PROVIDER_LEADOCEAN_ENABLED=true` and `LEADOCEAN_COMMERCIAL_TERMS_CONFIRMED=true`.
   - Connect the key through Agentory's provider connection flow (the `provider-connections` function → Vault) for TEST workspace `40e2512f-…1897`. Never paste the key into chat.
3. **Live comparison.** It needs an **owner/admin** TEST login, because `strategy_run` is owner/admin only and the TEST workspace has 1 owner and 1 member. Run it after item 2, from a trusted machine:
   - `PROVIDER_CMP_PRIOR_SPEND` = the JSON from `scripts/test-project/provider-cmp-prior-spend.sql` on TEST;
   - `PROVIDER_LIVE_APPROVAL="run the provider comparison within 0.25 USD and 25 LeadOcean records"`;
   - `AGENTORY_PROVIDER_LIVE_TESTS=enabled`;
   - run `--dry-run` first.
4. **#237:** review and merge, or close. The hiring check is off by default.
5. **Production migration:** Option A, the Z08 and R2 decisions, and the deploy sequence are unchanged (`docs/architecture/mission-rollout-plan.md`). Regenerate `rollback.sql` with the fixed script.
6. **Railway worker** `/health` returns 404. Ops health has been red since 2026-11-04.

## 6a. Canary verify run 41990179846 (2026-11-05): two failures, both explained

The study run 41990176436 succeeded.

**1. `apify: REVIEW account identity` (an operator input, not a defect).**
- `verify` was dispatched without `apify_username`, so `apify-account-check.ts` received no `--expect-username`.
- It then reports REVIEW by design. `local-rehearsal.sh` pins exactly this as `verify-no-username`.
- Fix: dispatch with `apify_username=Prasidha`. The account is confirmed by its run history (§3).

**2. `preflight: P09 … exactly 10 credits (balance=8, reserved=0)`. The 2 credits were legitimately consumed.**
- TEST `credit_transactions`, workspace `40e2512f…`:
  - grant +10 (10-18);
  - session 1 job search refused by Apify (`apify_unauthorized`), refunded (10-30 10:20);
  - session 2 `apify_linkedin_job_search` charged 1 and `apify_linkedin_company_details` charged 1 (10-30 12:00, Apify runs `8PmW7c0f6oJDQdxJQ` and `UAx1AUEtj7uswX6bd`).
  - Result: 10 − 2 = 8, 0 reserved; no open liability (P11).
- The defect: P09 is the zero-Apify A7 judge's exact starting balance. The canary reuses that preflight, but it is paid and keeps the credits its starts reserve, so P09 could never pass again after its first successful session.
- **Fix:** the canary judges the credit row with its own rule, **C09: none reserved, balance ≥ 3**. That is one attempt: one start each of jobs, details and Atomus (K09), 1 credit each.
  - P09 stays in the audit as written. The A7 preflight and judge are unchanged.
  - No credits were added.

## 6b. 2026-11-05 afternoon: verified findings

- **#240 merged** as `dd8755f`; all CI green. Verify was re-dispatched at `dd8755f` with `apify_username=Prasidha`; it is waiting for the Environment review.
- **Live paraphrase study** (run 41990176436): acceptance **not met**, v3 rollout blocked. See `docs/benchmarks/live-paraphrase/2026-11-05.md`.
  - 58.2 % correct, 1 collapsed contrast, 9 cases all wrong.
  - Failures: 36 compiler-side, 24 clarification, 6 wrong understanding, 3 incomplete responses.
  - The harness now records whole answers, so the next run pins the compiler fields.
- **TEST deploy @ `0f604af` failed.**
  - Nothing was deployed. Smoke P0 got HTTP 500 because `strategy_plan` threw `MissionNeedsClarificationError`: the model asked a question about the smoke query.
  - Fixed: a clarification is now **422 `{status: needs_clarification, questions, error}`**, and the smoke names it.
- **Production Railway worker down since ~2026-10-13** (read-only evidence):
  - production `lead_mission_queue` has had no claim or completion since 10-13 09:05; one `resumable` mission has waited since 10-13 09:54;
  - every ops-health run since 10-19 fails `worker_unhealthy: HTTP 404, status error`.
  - That JSON 404 is Railway's edge answering with no application behind the domain, not the worker's own plain-text 404.
  - **Owner:** in Railway, check the worker service exists and has an active deployment and that the domain matches the `WORKER_HEALTH_URL` secret. Redeploy (`railway.json`, `worker/Dockerfile`) or update the secret. Then decide on the 10-13 `resumable` mission (let it resume, or cancel it).
- **LeadOcean on TEST.**
  - Enabling it does not trip the smoke: it is not a forbidden flag, and P4 accepts `apify_plus_leadocean`.
  - The connect path needs the two flags, a TEST workspace owner/admin, and Settings → Integrations (shown with `VITE_PROVIDER_DISCOVERY=true`), or a `provider-connections` `connect` call.

## 7. Next executable step

After the study artifact `live-paraphrase-study-5c91efd…` exists:
- classify each failure as model / compiler / evidence / harness, using rollout plan §3's acceptance criteria;
- record the result in `docs/architecture/mission-reliability-progress.md`.

## 8. 2026-11-06: Mission Contract v4 migration (branch `claude/magical-dirac-c7okyr`, PR #244)

**Status vocabulary:** implemented → tested → integrated → production-ready → production-enabled.

| Component | Status | Where |
|---|---|---|
| Contract, v4 interpreter, compiler, boundary, invariants | implemented, tested, integrated (TEST `lead-pipeline` behind a flag) | `_shared/missionContract/` |
| Company Brain → contract (precedence, conflicts visible) | implemented, tested, integrated (`lead-pipeline` contract mode; pilot-chat v4 card) | `missionContract/brain.ts` |
| Production chat: binding stamp + observe-mode Start check | implemented, tested, integrated (always on; metadata and logs only) | pilot-chat |
| Production chat: shadow / v4 card / enforced binding / canary scope | implemented, tested, integrated behind flags that are OFF | pilot-chat, `chatIntegration.ts` |
| Pre-execution integrity of v4 missions | implemented, tested, integrated | orchestrate, run-agent (covers the worker) |
| Version boundary (run-time readers use the contract for v4) | implemented, tested, integrated | `authority.ts`; run-agent, leadSearchIntent, leadIntentModel, leadDiscoveryStrategy, leadCapabilityEngine |
| Independent live v4 study | **not run.** The `discovery-test` Environment rejects non-protected branches (run 42190289471, $0) | needs #244 merged |
| TEST enablement (`AGENTORY_MISSION_CONTRACT_V4`) | **not done** (owner). TEST `lead-pipeline` is v25 = pre-#244 code | after merge + deploy |
| Production | **unchanged.** Not production-ready until G2 passes and rollout stages 1–3 hold | `docs/architecture/mission-contract-rollout.md` |

**Next steps, in order:**

1. Owner reviews and merges #244.
2. Dispatch `discovery-test-worker.yml` with these inputs (owner approves the Environment run):
   - `ref`: `launch/hardening`
   - `canary_stage`: `study_v4`
   - `expected_sha`: the merge SHA
   - `confirm_project_ref`: `tlvnfrxzjhsjgdofwehb`
   - `canary_approval`: `run the live paraphrase study within 2 USD`
3. Analyse the artifact `live-paraphrase-study-v4-<sha>`. The gate is at least 157/165.
4. Owner sets `AGENTORY_MISSION_CONTRACT_V4=enabled` on TEST `lead-pipeline`. Then run the TEST smoke and one approved plan → run.
5. Production rollout stages 1–5 (each owner-approved).
