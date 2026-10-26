# Independent agency-only TEST verification — 2026-10-26

**Agency-only real-GPT execution: NO-GO pending hosted preflight and explicit approvals. Offline candidate/security: PASS.** Ready to request TEST-only setup and a providers-off rehearsal; do not run the paid step before that rehearsal passes. **Full Phase 1 FAIL; Phase 2 unstarted; P1–P8 disabled; paid A7 NO-GO.** Client-management completion is not a prerequisite for the bounded agency-only test described here.

No PR was merged, no deployment/hosted write/migration or paid model/provider operation occurred. No secret values were read. GitHub CI and disposable local services used synthetic fixtures and scripted vendors.

## Exact candidates and source pins

| Item | Exact source |
|---|---|
| Accepted Brain #178 | `86d33d6fab97f5b8e1fa68a89edb42bf31973417` |
| UI-2 #187 | `14e0363a9e763819c342a6991d54da92b91b68d1` |
| Original agency bundle #188 | `508d438f8b68ee0a2dca849649d5d79a262e2ccf` |
| Latest #189, on #179 | `5c2ff31890e2aa5fb60cc458d5dc2862453ee825` |
| #190, on #186 | `949a2c5ea4bb68461df978a0415fe0047e9bd4b9` |
| Broad #185 integration tested | `1e12c240ced29df7201f260001296fd98d9efdea` |
| Smaller agency candidate, full CI | `336e7107e572d70fc7b5b6ec04063c9604de82eb` |
| Same application/workflow source + independent audit additions | **`0cbe2f31b4e581a7d1e4d0a0a7fa58b817bca13e`**, `codex/agency-only-test-verification` |

The smaller candidate starts at #188 and adds #189/#190; #186's held membership writers arrive as a source dependency. It excludes the #185 pilot implementation and #184. Its application, worker, scripts, workflow and frontend trees are identical between336e7107 and0cbe2f31. The successor adds only offline audit files. No separate PR or competing owner implementation was created.

Resolutions preserve both held README blocks and both complete mutation blocks. `discoveryScenario.ts` uses Backend's reviewed combination: both scenario option sets, removal hook on #158's vendorResponder path. The CI planner's exact helper closure includes `effectFenceMission`. All134 mutation proofs execute and kill their mutants; no assertion or security check was weakened. The original three independent execution/parent/member/effect reproduction files are byte-identical to #1850a175f89; hashes are in the manifest.

## Independent results

| Gate | Result / evidence |
|---|---|
| Original EXEC-PLAN / EXEC-REVOKE | PASS3/3 unchanged |
| Original supplemental PLAN-PARENT, MEMBER-SURFACE and EXEC-EFFECT | PASS6/6 unchanged: the previous4 failures now pass, both positives preserved |
| Additional native parent deletion/recreation concurrency | PASS1/1: deletion waits behind task's parent key-share; task commits; foreign recreation23503;0 mismatches |
| Full focused native security / legitimate controls | PASS36/36: task commit5, parent4, effect3, settlement mission2, surface5, writers8, independent9 |
| Original AUTH-06 | PASS23/23 unchanged, including removal/demotion/logout and zero unauthorized writes |
| Agency TEST / admission / ledger / guard / judge contracts | PASS92/92 on the smaller candidate |
| Real-worker crash/adoption/stop/zero-Apify | PASS4/4 locally; PASS4/4 in both independently dispatched CI candidates |
| Agency profile **without canonical client tables or RPCs** | PASS11/11; native original reproductions, concurrency and actual mission path.0 providers/polls/qualified, bounded model attempts, honest budget_exhausted |
| Mounted UI-2 real GoTrue cross-session/cache/revocation | PASS5/5 on broad candidate; independently PASS5/5 on smaller candidate |
| Real-GoTrue autosave | PASS24/24 on smaller candidate |
| Held179/186/189/190 rollback round trip | PASS1/1: exact function definitions/ACLs, membership privileges, data and176 hooks preserved |
| Broad integration full CI | [40283377613](https://github.com/kathmanducreatives-code/aiworforce-platfrom/actions/runs/40283377613): PASS17/17,34/34 contract files,134/134 mutants |
| Broad required native security CI | [40283377704](https://github.com/kathmanducreatives-code/aiworforce-platfrom/actions/runs/40283377704): PASS, including the previously failing required gate |
| Smaller agency candidate full CI | [40284128653](https://github.com/kathmanducreatives-code/aiworforce-platfrom/actions/runs/40284128653): PASS17/17,34/34 contract files,134/134 mutants; edge8953/0, UI709/0, real workers4/0 |

The whole-mission effect control proves that an already-bought provider run can still be polled/settled, exactly one purchase is charged, no second purchase/model starts after removal, and reaping releases the unstarted hold (balance9, reserved0). Authorized identical missions still qualify synthetic evidence. Canonical membership administration, provisioning INSERTs, FK cascades and last-owner races remain functional. The trusted postgres administrative role is deliberately distinct from the constrained application service role.

#189's standalone CI still fails the two known `fundingRecencyFallback` clock assertions because that branch lacks #181. Both combined candidates contain #181 and pass the edge suite; this is not an unresolved security regression. Initial duplicate/superseded own CI runs were cancelled; only final source receipts above determine acceptance.

## What #189/#190 actually close

- `tasks_commit_boundary` locks parent plans and membership while checking workspace ownership; `task_plans_parent_identity` also prevents application-role identity relocation and foreign reuse of a deleted plan ID. The additional independent concurrency test proves the parent lock, rather than assuming a sequential proof covers races.
- `_shared/effectFence.ts:76–109` rechecks membership before a new external operation, carries admission marks and permits settlement/abort. It does not replace admission, ledger, qualification or future client/session pin authorization. No budget/call-cap increase.
- `20261025160000_workspace_members_app_surface.sql` revokes service UPDATE/DELETE/TRUNCATE and has invoker-role triggers defending later re-grants. Definer RPC policy stays in186. Provisioning INSERT remains trusted; this is not a general-purpose end-user invite/promotion API.
- T01's GPT completion transport and the manual worker workflow are byte-identical to188. Existing completion-validation, refusal and admission tests remain in the green suites.

## UI-2 review scope

187 changes only frontend/tests relative to178. `CompanyBrainDashboard.tsx:137–147` captures the client/workspace/principal key **before** enqueue, drops a queued save if that key changed, and retains the late-response/version guard. The four page-save source-contract tests pass within709 UI tests. Real mounted cross-session and grant-revocation acceptance passes5/5; actual autosave/revision concurrency passes24/24.

A supplemental browser experiment for two queued inline edits did not establish the required DOM interactions (the second editor did not open); it is **not** counted as a product failure or a passing race test. The experiment is retained locally and handed to Brain; no original assertion was changed. The specific queued-save race is code/source-contract reviewed, not independently dynamically proven by that experiment. It is outside the agency TEST path, which neither opens the Brain UI nor loads a Brain row.

One initial mounted run in the new worktree failed to mount because that worktree lacked frontend dependencies. After reusing the existing installed dependencies, the unchanged mounted suite passed5/5. The earlier combined log is preserved: autosave24 and rollback1 passed there; its4 mount failures are not hidden or counted as security passes. The initial additional plan-race harness awaited a correctly blocked DELETE; corrected synchronization explicitly asserts that wait and passes. Product protections were unchanged.

## Agency-only boundary versus full-client release

The agency-only run uses one synthetic workspace, one authorized member, no customer data, no Company Brain row, no client/pilot markers, and client/readiness flags off. `legacyExecutionGuard` still rejects request/stored-task client and pilot markers. It uses the real compiler/planner/runner/persistence/accounting with providers off or zero-Apify. It must persist/qualify **zero companies**.

`run-agency-profile.py` builds a loopback-only disposable native profile from unchanged migration sources, excluding the held176/186 client schema/RPCs and retaining independent task/parent/ownership and190 app-role protections. The test asserts all three client tables are absent before running the mission. It does not omit a security assertion or claim that this profile enables membership administration. Trusted operator SQL can manage the isolated test fixture; public/member-management workflows are not under test there.

**Not agency-only blockers:**191 immutable client pins,192 client pin consumption,193 same-client descendants, Codex private-client bridge/global-lock alignment, first-client/grant management, P5/P7 durable pilot storage and draft export. They remain mandatory for their actual client/pilot enablement paths.191–193 are delivered drafts, not independently accepted by this report. Full Phase1 staysFAIL.

## Read-only operational findings and owners

| Requirement | Actual state / next owner action |
|---|---|
| Exact nonproduction target | discovery-test var names a distinct project (`tlvnfrxzjhsjgdofwehb`); TEST workspace var exists. Secret **names** exist; values, hosted schema, data and deployed source are UNVERIFIED. Operator must supply a fresh read-only preflight. |
| Standard CLI safety | `scripts/supabase-target.mjs` still maps test and production to the live project. Never use npm supabase:test, generic db push or config defaults for this run. Dedicated worker explicitly refuses both live/former refs. |
| Dispatch policy | Environment has required reviewer, admins cannot bypass; currently only **branch launch/hardening** allowed. Runbook tag dispatch is not authorized by that policy. Backend must correct procedure; owner must approve an exact candidate-branch/tag policy change or separately approve source integration to launch, followed by revalidation. |
| Credentials / Apify | TEST_APIFY_API_TOKEN secret name exists, contrary to the runbook's absence prerequisite. No secret changed. `providers=openai-only` unsets it and Deno denies api.apify.com:443; both are tested. Operator must confirm effective isolation and forbid openai-and-apify. |
| Held security migrations | Fresh-schema builder does not install179's task trigger or189's parent trigger. Backend owns an exact target-specific installation manifest/preflight. Code merge alone does not install SQL. |
| Price/model authorization | Actual approved model availability, current observed prices and enforceable TEST-project spend controls remain UNVERIFIED. Names/runbook prices are not receipts. Verify before the preparer's first paid call. |
| Providers-off acceptance | Not yet run hosted. Separate explicit authorization needed for TEST kickoff writes/worker dispatch; no model credentials available to that session. |
| Paid real-GPT acceptance | Not yet authorized/run. Requires providers-off PASS and a separate capped authorization,25 judge rows including manual vendor/accounting sign-offs. |

Environment/policy/secret-name metadata is committed; no secret values or customer records. No deployment receipt was established from the inspected Environment metadata.

## Minimum release / TEST installation sequence — proposal only

1. **Approve the exact worker source.** #188 alone is insufficient: include #179→#189 latest. Verified review branch0cbe2f31 also includes190/186 held source. No need to deploy187/178 frontend or any Edge Function to test the in-process worker (`worker/main.ts:153`, `worker/leadMissionRunner.ts`). Do not separately merge superseded Brain167/168/183. Do not merge188 as a vehicle.
2. **Choose the approved dispatch route.** The shortest isolated route requires no PR merge: explicitly allow only `codex/agency-only-test-verification` in discovery-test, record its approved SHA, and verify the Actions checkout SHA before reviewer approval. This policy change needs owner approval. If keeping launch-only policy, integrate reviewed owner PRs to launch in dependency order and rerun full/native acceptance on that resulting SHA instead. No source movement or policy change was performed here.
3. **Read-only hosted preflight first.** Confirm URL/ref, no production overlap, exact synthetic workspace/member, no active/claimable mission, no outstanding liability/credits, no customer records or Brain row, no hosted-calling cron. If a Brain exists, do not delete it: use a separately approved synthetic workspace. Preserve all existing data. The guarded fresh-schema builder is for an **empty** new project only; never run it blindly on the existing TEST project.
4. **Approve only missing TEST SQL, individually.** Fresh-project baseline/active migrations → held V2 chain → held admission `20261015140000` → TEST-only no-Brain guard → independent OWN01 `20261025120000` → task commit `20261025130000` → parent identity `20261025150000` → app membership surface `20261025160000`. Preflight task/parent invariants and compare catalog/grants; rerun P01–P14 and schema S checks. Current billing decisions remain separately held; zero-Apify makes no paid provider purchase.176/186 client schema/RPCs and all pilot migrations are unnecessary for this isolated agency profile. The190 trigger itself has no176/186 DDL dependency, independently proven by11/11; it does not supply a membership-management API.
5. **Providers-off first (separate approval).** No OpenAI/Apify/Anthropic/Firecrawl/Lovable credentials in the worker session. Prepare reviewed proposal with no network/zero compile calls; review its SQL; one approved kickoff/worker session, openai-only. Expected blocked/refused-before-execution,0 model/provider rows,0 purchases,0 leads, unchanged balance/0 reserved. Inspect terminal and reconciliation evidence, not merely worker exit0/124. Never dispatch from an unapproved moving ref.
6. **Then separately approve model-only.** Dedicated TEST OpenAI credential, verified model/prices. Runtime ≤4 attempts and≤$0.05; provider0 starts/reads/$0.00;≤300s and existing≤2 slices; unchanged overall A7 ceilings. Preparatory compilation is separate:≤2 calls/≤$0.02496, so combined test authorization≤$0.07488 (rounded≤$0.075). No extra automatic retries. Missing/unsupported model or any preflight FAIL stops the run. Read receipts and sign manual R4/M6; honest budget_exhausted and zero qualified/persisted leads are expected.
7. **Stop/reconcile/retain.** Operator stop authorization, drain/cancel bounded worker, verify queue terminal, no open authorization/liability,0 credits reserved, no duplicate charges; preserve ledger and evidence. Stop before any paid A7/provider approval.

Rollback: stop and settle first; revert the approved worker source only after all sessions stop. Prefer leaving backward-compatible security SQL installed. The down scripts restore broader service privileges and therefore require separate review/approval; never run a blanket rollback, erase TEST data, reinstall old writable permissions or delete ledger evidence. If ever approved, reverse190 before186 and parent189 before179;176 and AUTH06 remain untouched. Native exact round trips prove mechanics, not authorization to reopen access.

## Reproduction commands

Use `codex/agency-only-test-verification` at0cbe2f31 (ordinary full CI source336e7107 has identical application/workflow trees). Deno2.8.2, PG17.6, local PostgREST16.4; CI uses pinned12.2.3. Installed frontend dependencies and Chrome are required for browser tests.

```sh
POSTGREST_BIN=/path/to/postgrest python3 tests/outpost-native/run-agency-profile.py
POSTGREST_BIN=/path/to/postgrest tests/db-contract/run-with-gotrue.sh \
  tests/outpost-native/execution-integration-audit.test.ts \
  tests/outpost-native/task-parent-membership-audit.test.ts \
  tests/outpost-native/post-insert-revocation-audit.test.ts \
  tests/db-contract/taskPlanParentIdentity.contract.test.ts \
  tests/db-contract/effectFence.contract.test.ts tests/db-contract/effectFenceMission.contract.test.ts \
  tests/db-contract/workspaceMembersAppSurface.contract.test.ts \
  tests/db-contract/workspaceMemberWriters.contract.test.ts tests/db-contract/taskCommitBoundary.contract.test.ts
BRAIN_E2E_DENO_FLAGS='--allow-run --allow-write' POSTGREST_BIN=/path/to/postgrest \
  tests/db-contract/run-with-gotrue.sh tests/browser/brainCacheSession.browser.test.ts
POSTGREST_BIN=/path/to/postgrest tests/db-contract/run-with-gotrue.sh \
  tests/db-contract/brainAutosaveEndToEnd.contract.test.ts tests/outpost-native/followup-rollback.audit.test.ts
# On a freshly generated disposable loopback PG only:
PG_ADMIN_URL=<local-only> POSTGREST_BIN=/path/to/postgrest tests/db-contract/run.sh \
  tests/db-contract/modelOnlySmoke.contract.test.ts tests/db-contract/realGptPreflight.contract.test.ts \
  tests/db-contract/realGptJudge.contract.test.ts tests/db-contract/legacyPreEffectGuard.contract.test.ts \
  tests/db-contract/smokeAdmission.contract.test.ts tests/db-contract/smokeAdmissionRuntime.contract.test.ts \
  tests/db-contract/smokeCreditReconciliation.contract.test.ts
PG_ADMIN_URL=<local-only> POSTGREST_BIN=/path/to/postgrest tests/realprocess/run.sh
```

AUTH06 unchanged23 uses #185's `OUTPOST_NATIVE_BRAIN_HANDLER_AUDIT=1 tests/outpost-native/run.sh`; that original harness includes the pilot fixture and is intentionally not copied into the minimal worker candidate. Local macOS real-worker launcher permits both original/resolved Deno executable paths; Ubuntu unmodified owner launcher passes. No provider network is used by these tests.

[Evidence manifest, raw compressed receipts and CI metadata](agency-test-2026-10-26/manifest.json). Publication successor contains documentation/audit additions only; runtime/workflow identity is explicitly checked.
