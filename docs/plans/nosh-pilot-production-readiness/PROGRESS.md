# Nosh pilot: authoritative progress tracker

**Customer pilot readiness: FAIL. P1–P8 disabled. A7 NO-GO.**

Last audit: 2026-10-23 Asia/Kathmandu; Phase 1 approved in user message following #152.
Readiness remains FAIL; owned access fixes are implemented below; shared contracts remain required.
Read [MASTER_PLAN.md](MASTER_PLAN.md) before resuming. This tracker supersedes
historical phase-number status in `docs/audits/.../production-readiness/`; those
files remain immutable receipts of narrower previous work. Production-readiness
Phase 0–8 below is distinct from the historical P1–P8 feature implementation.

## Phase status and next authorization

| Phase | Status | Branch / PR | Validation | Remaining blockers |
| --- | --- | --- | --- | --- |
| 0 — architecture/readiness audit | COMPLETE / reviewed; Phase 1 authorized | `codex/nosh-readiness-master-plan`; draft #152, stacked on #151 | repository/PR/CI/interface audit; documentation checks in phase receipt | DEC-01 target chosen in Phase 1 approval; shared contract still open |
| 1 — native security | PARTIAL / owned pilot corrections PASS, overall FAIL | `codex/nosh-phase1-access-fixes` on #155; #151/#155 preserved | integrated native 68/0 with exact #159 SQL; actual context-session PASS; edge 9203/0; infra 196/0; UI 722+5/0; GoTrue 5/0 | shared nonpilot Brain role writes; same-workspace multi-client parent/Brain/permissions contract; legacy service routes and original-task registration/lifecycle; complete integrated acceptance |
| 2 — transactional persistence | PENDING / NOT APPROVED | no implementation PR yet; P3/P5/P6/P7 interfaces are not persistence | offline contracts only; no native durable import/snapshot/review/approval adapter | Phase 1; DATA-01/02; REPLAY-01; original-task lifecycle and shared receipt contract |
| 3 — legacy executor containment | PENDING / NOT APPROVED | owner #145/#149/#150 are dependencies, not pilot containment completion | no complete pilot route-by-route native acceptance | Phase 1/2; backend EXEC-01; Brain context seam |
| 4 — recovery/spending | PENDING / NOT APPROVED | owner #150 plus future FIN-01 successor | mocked P4/P8 safeguards; no native pilot shared-ledger recovery proof | Phase 2/3; FIN-01/02; MODEL-01; no competing ledger |
| 5 — native import-to-export | PENDING / NOT APPROVED | no native journey PR yet; #148 is narrower offline acceptance | synthetic injected journey exists; complete application/database workflow NOT TESTED | Phases 1–4; UI-01; EVID-01; durable confirm/task/writer/resolver wiring |
| 6 — local acceptance | PENDING / NOT APPROVED | future exact combined candidate | combined native/browser/crash/security suite NOT TESTED | Phases 1–5; INT-01; owner integrations; DEC-01 positive same-workspace requirement or explicit revision |
| 7 — hosted TEST | BLOCKED / NOT APPROVED | no executed hosted plan | no target-deployment/catalog/runtime receipt | Phase 6; named target preflight; specific hosted migration/deploy/synthetic-write approval |
| 8 — release/customer readiness | BLOCKED / NOT APPROVED | no release candidate | no real-model or Nosh acceptance receipt | Phase 7; QUALITY-01; owner compatibility; separate merge/deploy/paid/data/activation approval |

**Current phase is Phase 1 and is already authorized.** All independent safe
work in the access-fix successor is implemented/tested; shared fixes depend on
AUTH-01/EXEC-01 coordination as explicitly required by the user. No routine
technical decision is being returned for permission. The user selected one agency
workspace with multiple isolated client accounts and separate client Brain;
DEC-01 product direction is resolved. Do not ask the user to choose again.

Do not advance to Phase 2 while Phase 1 acceptance is FAIL. Resume the remaining
Phase 1 shared fixes when the agreed owner contracts/patches arrive, then rerun
native mandatory red-to-green and legitimate workflow controls. Phase 2 still
requires separate approval after Phase 1 is actually complete.

## Active worktree and immutable resume points

- Active Phase 1 branch: `codex/nosh-phase1-access-fixes` (successor on #155).
- Worktree: `/Users/prasidha/Downloads/screeningpilot-main/nosh-phase1-access-fixes`.
- Phase 1 base: #152 `32097823562b5282972047f86beb0b826e4e663c`; exact new head/PR is in its publication receipt.
- Historical #151 base: `001fa9db9a1a07266dfc700b0d7a21fbc322c7df`.
- Documentation PR: [#152](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/152),
  stacked on #151. Initial plan commit: `6bb7adcb` (full SHA in Git history).
  The final publication commit is recorded in the PR phase receipt, avoiding a
  self-referential commit hash in this file.
- Current launch: `8b0e2b6bdb20d6fe30542da39f0170d514d52746`.
- Historical implementation PR/heads and bases: MASTER_PLAN section 2.
- Do not edit the dirty Claude checkout
  `/Users/prasidha/Downloads/screeningpilot-main/aiworforce-platfrom` or the unrelated
  `agridrone` checkout. Existing Supabase containers are not test targets.

Safe resumption inventory (read-only):

```sh
git status --short
git fetch origin
gh pr view 151 --repo kathmanducreatives-code/aiworforce-platfrom --json headRefOid,baseRefName,comments,statusCheckRollup
gh pr list --repo kathmanducreatives-code/aiworforce-platfrom --state open --limit 40 --json number,title,headRefOid,baseRefName
```

After approved phase selection, create a new isolated successor branch. Do not
rewrite the documentation PR or #151 into an implementation PR. If launch/owner
heads change, refresh inventory and coordinate the integration before edits.

## Phase 0 receipt

**Scope:** audit/planning/documentation only. No SQL, runtime, test, workflow,
qualification, Brain, executor or ledger implementation was changed. No new native
SQL/test execution or paid activity was performed for Phase 0.

**Audit performed:** fetched current origin; inspected all P1–P8/#151 PR heads and
bases; read #122's approved design; reconstructed actual store/handler/UI flow;
reviewed native held migration, rollback, P8 SQL alternatives and native reports;
inspected existing CI job logs and #147/#150 discussions; mapped every known
readiness blocker to owner/phase/proof. Latest owner heads match the inventory;
no incoming approval/handoff completion was found in those discussions.

**Output:** MASTER_PLAN supplies the 0–8 roadmap, dependency and review order,
per-phase twelve fields, blocker/test ledger, first implementation task,
continuation/approval protocol, and release/rollback boundaries. The new two-client
same-workspace requirement is explicitly unresolved rather than dropped.

**Validation: PASS.** Python read-only checks: nine phases × twelve required fields,
nine tracker rows, nineteen blocker gates, four relative links and balanced code
fences. Verified exact existing/owner/proposed file distinctions. Staged diff
contains only these two Markdown files; `git diff --cached --check` passed.
Draft #152 is the reviewable deliverable; final head is recorded in its receipt.
Runtime claims below are historical receipts, not reexecuted Phase 0 results.

**Result:** Phase 0 COMPLETE; roadmap review pending. No customer-pilot PASS.
No later phase begins until the user says to proceed.

## Verified evidence at historical #151 head

| Evidence | Exact result / source | Limit |
| --- | --- | --- |
| Native identity | 42 passed, 0 failed; [CI 39796963782](https://github.com/kathmanducreatives-code/aiworforce-platfrom/actions/runs/39796963782) | real PostgreSQL/PostgREST; synthetic JWT/auth.sessions; not GoTrue or full app |
| Ownership mutation | remove only guard: 39 passed, 2 failed, 1 ignored | expected two target failures; rollback-reapply deliberately omitted only for mutant; real suite ignores none |
| Public task exposure | authenticated same-workspace viewer: HTTP 200, one synthetic task payload row; private bindings invisible | actual direct-API leak; not a cross-workspace exploit; mandatory SEC-01 FAIL |
| PR CI | [39796963761](https://github.com/kathmanducreatives-code/aiworforce-platfrom/actions/runs/39796963761) aggregate FAIL | infra RLS source scanner CI-01; not a green PR |
| Manual full CI | [39797152548](https://github.com/kathmanducreatives-code/aiworforce-platfrom/actions/runs/39797152548) aggregate FAIL | same scanner assertion; successful native contract/mutation steps do not override failure |
| Edge/frontend | edge 9,194/0; frontend 722/0, build/type/lint passed in previous receipts/CI | no new Phase 0 runtime checks; no integrated native pilot claim |
| Private foundation workflow | success, public readiness probe failed with continue-on-error | narrow job green is not readiness; make public probe required after coordinated fix |
| Hosted/customer/live models | NOT TESTED / NOT AUTHORIZED | no deployment, real record or paid call inferred from mocks |

CI-01 exact failure: `tests/infra/rlsCoversEveryTable.test.ts` uses an optional
`public.` prefix then captures a single identifier; a qualified private table is
captured as `outpost_private`, while ENABLE RLS parser cannot match the dotted
name. Job `119886543404` reports **186 infrastructure tests passed, 1 failed**,
asserting `outpost_private` lacks RLS. Actual held SQL enables/forces RLS on
`outpost_private.clients` and `outpost_private.task_bindings`; native tests prove
this narrow foundation. Correct the scanner with schema-aware adversaries in
Phase 1; do not allow-list the schema, remove held migrations, or mute the test.

## Decision and handoff queue

| ID | Decision / contract | Owner | Status / next action |
| --- | --- | --- | --- |
| DEC-01 | one agency workspace with multiple isolated client accounts | user direction; Brain/backend contract | TARGET RESOLVED by Phase 1 user approval. Shared client parent/roles/Brain/memory/session contract OPEN; proposed CLIENT_CONTRACT.md posted; no shared schema change or assumed positive acceptance. |
| AUTH-01 | role-aware Brain/context/direct API/session and revoke locking | Company Brain Claude | OPEN; #147 requests include confirmed viewer Brain PATCH, arbitrary foreign membership owner self-insert and actual handler new-session resume. No incoming contract agreement found. |
| EXEC-01 | scoped public task policy/owner guard, immutable inputs versus lifecycle versions, all entry guards | Backend Claude | OPEN; use #150/#145 discussion; no shared file edits without coordination |
| FIN-01 | stable model operation key, durable reserve/settle/accepted output, shared ledger | Backend Claude | OPEN; #150 adopts purchased provider runs but still may rerun model planning; no pilot ledger |
| QUAL-01/E01 | read-only canonical seam and semantic support prompt/stance | Backend Claude | independent owner work #144; no changes in this docs PR; no second semantic evaluator or qualification authority |
| Nosh-01 | exact iGTM/Jungler identities; Apollo CRM-of-record status | Nosh/user | UNVERIFIED; verify before future connectors; not needed to implement approved CSV-only draft workflow |
| Nosh-02 | approved export/list/client ownership, model account/data-sharing, manual CSV format/destination, caller usefulness | Nosh/user | release acceptance input; no real records or API assumptions now |

Existing outgoing handoffs:

- [Brain scope and native task leak](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/147#issuecomment-6343156124).
- [Backend public task leak](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/150#issuecomment-6343156764).
- [Native owner-guard proposal before implementation](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/150#issuecomment-6342986078).
- [#151 historical phase receipt](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/151#issuecomment-6343566400).

A posted comment is not owner consent. Link any new owner replies/deliveries and
pin their commit/tests before changing this status.

## Remaining Phase 1 closure tasks

1. Obtain AUTH-01/EXEC-01 owner replies to the posted client/public-policy/session
   contracts; pin their exact branches/files and ownership to avoid overlap.
2. Close SEC-01/02/05 together with legitimate onboarding/invitation/nonpilot
   controls: viewer task reads/writes, Brain writes and arbitrary membership
   self-enrollment must be denied natively and through alternative routes.
3. Implement the owner-agreed multi-client parent/Brain/memory/role/version contract
   and signed-task original-session adapter. User direction is already recorded;
   do not ask them to choose tenancy again or remove uniqueness alone.
4. Prove native/client ownership and real Edge handling across all listed paths,
   sessions and allowed task lifecycle changes. Preserve existing P1 HMAC and
   source/frozen context/model policies; do not introduce an alternative authority.
5. Make the public surface/context audits required acceptance once fixed; run
   red-to-green tests, full relevant CI and target mutations at exact combined SHA.
6. Update phase status only when every mandatory security criterion passes.
   Phase 2 needs user approval after actual Phase 1 completion.

Scanner CI-01 is fixed and covered in the successor draft. The independent native
and GoTrue test additions are complete. Shared runtime/schema fixes are blocked
under the user's explicit coordination-before-shared-schema instruction, not
because routine local work needs permission.

## Approval ledger

| Action | State |
| --- | --- |
| Phase 0 audit/docs/draft PR and GitHub coordination | AUTHORIZED |
| Phase 1 safe local implementation/tests/draft PR | AUTHORIZED by explicit Phase 1 request; shared schema/permissions still require owner coordination |
| Phase 2–6 implementation | NOT APPROVED; each needs its own continuation |
| Disposable local SQL/tests | AUTHORIZED for Phase 1; existing held/baseline SQL and isolated GoTrue migrations exercised in owned disposable containers only |
| Hosted TEST preparation | future Phase 7 only after local gates; no execution approval |
| Hosted migration/deployment/data writes/TEST activation | NOT AUTHORIZED; require named target/action approval |
| Merge/rebase owner PRs or overwrite owner branch | NOT AUTHORIZED |
| Real customer imports/model calls/provider calls/keys/billing | NOT AUTHORIZED |
| Customer feature activation/outreach/Apollo API/write-back | NOT AUTHORIZED |
| A7 | NO-GO |

## Update format for every future phase receipt

Append, never overwrite historical proof:

- Phase/date; approved scope and approval reference.
- Branch, PR, exact base/head, schema checksums and owner dependency heads.
- Changed files/APIs/DB objects and behavior; security/compatibility review.
- Commands, environment (disposable/native/mock/browser/hosted), counts, failed or
  unrun cases, receipt/CI URLs and exact SHA applicability.
- Acceptance ledger: each required gate PASS/FAIL/BLOCKED with expected/actual.
- Migration/rollback/refusal results and data/accounting reconciliation.
- Owner decisions and handoffs; unresolved risks and customer verdict.
- Complete/PARTIAL/BLOCKED; next objective and explicit additional approvals.
- Stop awaiting user continuation; never implicitly promote code-written to done.

## Phase 1 receipt — independent implementation complete; full phase FAIL

Base #152 `32097823562b5282972047f86beb0b826e4e663c`; isolated
`codex/nosh-phase1-security`. Draft [#155](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/155),
initial implementation commit `8b89e2cb6c7cd7b3e762de5a909dfc7c556d793e`.
Exact final head/CI receipts are in its publication comment (no self-referential hash).

**Implemented:** schema-aware RLS scanner repair without allow-list or removed
security checks; nine parser adversaries; native editor/member/admin role tests;
digest-pinned actual GoTrue session lane; stricter public audit positive controls;
native table/policy/grant/parent/view/routine inventory; deterministic public
write/membership/Brain and actual handler session reproductions; client contract.
No shared runtime/schema/Brain/executor/ledger/qualification files changed.

**Passed:** scanner+parser 18/0, full infra 196/0, edge 9,194/0, native identity/roles
46/0, actual GoTrue private predicate 5/0; ownership guard mutant: 43 passed / 2 required failures / 1 ignored
(rollback-reapply omitted only on the mutant); Deno check/lint, shell and whitespace checks passed. GitHub
CI status is reported at the exact publication head; no historical red head is
retroactively relabeled green.

**Failed:** native viewer public task SELECT (200/one row) and PATCH (204, data
changed); viewer Brain PATCH (204, data changed); foreign-workspace owner
self-insert (201, foreign task visibility 0→1); actual handlePilotContext resume
with new session/same actor (200; private RLS correctly denies). Actual GoTrue
logout does deny original token via the handler (401); foreign workspace is 403.
Same-workspace multi-client positive workflow and full Edge/browser permission
closure remain BLOCKED, not tested as successful using duplicate-enrollment denial.

Evidence and exact source/roots:
[Phase 1 receipt](../../audits/agentory-outbound-outpost-readiness/production-readiness/phase-1/README.md),
[native JSON](../../audits/agentory-outbound-outpost-readiness/production-readiness/phase-1/native-surfaces.json),
[handler/session JSON](../../audits/agentory-outbound-outpost-readiness/production-readiness/phase-1/context-session.json),
[client contract](../../audits/agentory-outbound-outpost-readiness/production-readiness/phase-1/CLIENT_CONTRACT.md).

Coordination before shared edits:
[#147 contract](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/147#issuecomment-6357401702),
[#150 contract](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/150#issuecomment-6357402131),
[#147 escalation](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/147#issuecomment-6357465613),
[#150 escalation](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/150#issuecomment-6357465931),
[#147 session gap](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/147#issuecomment-6357559381),
[#150 session gap](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/150#issuecomment-6357559673).
No owner agreement/overlap handoff was received at last check. As required by the
user and MASTER_PLAN, no coordinated shared SQL/permission/session/Brain change is
implemented on silence. A proposed restrictive task policy is not claimed fixed.

New read-only dependency inventory: #153 `c742af5db3aabd497d5ee3dcb621b2afb1fd0bbd`
held credit reaper (billing approval required), and #154
`551d84bf788a9195d7e3fd01914945bc130e0392` stacked on #150 (verified gate-run adoption).
Neither delivers FIN-01 model replay identity. No overlapping accounting edits.

**Remaining phase objective:** close owner-agreed client permissions, native public
policies/ownership, membership onboarding/invitation and application signed-task
session contract; required native red-to-green and authorized/nonpilot controls;
positive two-client/same-workspace Brain/data isolation. Then complete Phase 1
acceptance before requesting Phase 2. Phase 2 is not started/approved.

No hosted/production changes, new application migrations, merge, deployment, real
customer import, paid calls, outreach, credential/billing modification or feature
activation. Existing local Supabase stacks unchanged. P1–P8 disabled; A7 NO-GO.

## Phase 1 access-correction continuation — 2026-10-23

This continuation implements the owned pilot/API corrections rather than stopping
at #155's red audits. Full receipt and exact reproduction commands:
[ACCESS_FIXES.md](../../audits/agentory-outbound-outpost-readiness/production-readiness/phase-1/ACCESS_FIXES.md),
with machine-readable `access-fixes.json` alongside it. Publication head and CI
are recorded in the successor draft PR. No Phase 2 work started.

**Closed locally in the owned integrated candidate:** pilot viewer public-task
read, browser task mutation/marker replacement, enrolled Brain app-role raw writes,
and original-session bypass in exposed P1/P2/P3 store access. Original owner/admin,
refresh and validated bound-service positives remain; unrelated nonpilot owner/
service operations pass. Missing native registration/API fails closed. All enrolled
Brain writes intentionally frozen pending approved writer; not an editable pilot.

**Shared membership update:** owner #159 `572dca5c8d9c7f121731456801a035cfb6186b1e`
now provides the hotfix. Exact unchanged SQL is SHA-pinned and consumed only in
our local/CI disposable integrated lane. Native self-join denied, provisioning and
idempotency pass. Owner reports manual production/TEST application with catalog
receipt; reviewed, not independently queried. Do not apply it again blindly.

**Validation:** integrated native 68/0; actual GoTrue 5/0; actual handler original/
refresh/service 200 and wrong-session/demotion/revocation denied; edge 9203/0;
infra 196/0; frontend Deno 722/0 and Node 5/0; edge/worker check, frontend type/lint
ratchets and build pass. Guard mutation tests produce the expected named failures.
Public task and handler acceptance are required CI steps now; broad-surface red
evidence remains explicit. See successor CI receipt for exact final-head results.

**Still FAIL:** integrated native surface audit proves nonpilot viewer Brain PATCH
204 with changed row. Brain owner must deliver role-aware canonical table/handler
writes, including service-backed pre-model authorization. Agency multi-client
interface direction is recorded in CLIENT_CONTRACT v1, but canonical parent/
client-grant/Brain-version DDL awaits owner acknowledgment and positive same-
workspace acceptance. Shared executor containment and trusted native task
registration/lifecycle/revocation contract remain unimplemented in this slice.
No owner branch, qualification, shared ledger or Brain writer edits.

Next action is the remaining **Phase 1** shared integration and native security
acceptance, not Phase 2. P1–P8 disabled, A7 NO-GO, no hosted changes/deploy/paid calls.
