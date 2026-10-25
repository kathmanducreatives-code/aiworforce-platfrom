# Nosh pilot: authoritative progress tracker

**Customer pilot readiness: FAIL. P1–P8 disabled. A7 NO-GO.**

Last continuation: **2026-10-25 Asia/Kathmandu**, isolated draft **#185**.
AUTH-06 independently **23/0 PASS**; OWN-01 native workspace integrity **PASS**;
client Brain/real-GoTrue autosave **15/0 and19/0 PASS**. Overall Phase1 remains
**FAIL**: new native foreign-plan and post-removal task persistence failures,
a client-session cache gap, and undelivered member writers/task pins/client
parent/bridge integration. See the dated receipt below; historical failed
receipts remain preserved. Phase2 is unstarted and P1–P8/A7 stay off.
Read [MASTER_PLAN.md](MASTER_PLAN.md) before resuming. This tracker supersedes
historical phase-number status in `docs/audits/.../production-readiness/`; those
files remain immutable receipts of narrower previous work. Production-readiness
Phase 0–8 below is distinct from the historical P1–P8 feature implementation.

## Phase status and next authorization

| Phase | Status | Branch / PR | Validation | Remaining blockers |
| --- | --- | --- | --- | --- |
| 0 — architecture/readiness audit | COMPLETE / reviewed; Phase 1 authorized | `codex/nosh-readiness-master-plan`; draft #152, stacked on #151 | repository/PR/CI/interface audit; documentation checks in phase receipt | DEC-01 target chosen in Phase 1 approval; shared contract still open |
| 1 — native security | PARTIAL / AUTH-06 and OWN-01 verified, overall FAIL | `codex/nosh-phase1-client-contract-gates` on #172; previous PRs preserved | previous owned native proofs pass; draft185: AUTH23/0, OWN-018/0 + original reproductionPASS, client15/0, real-login19/0, pilot68/0+8/0; edge9401/0; infra214/0; execution1/2FAIL; cache1/1FAIL | Backend EXEC-PLAN/EXEC-REVOKE; Brain CACHE-SESSION; member writers/task pins; same-client parent constraints; Codex canonical bridge/global locks; complete integrated acceptance |
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

- Active Phase 1 branch: `codex/nosh-phase1-client-contract-gates` (test/readiness successor on #172 `2ffc6b5f22b5ce2d71c965054c06f5c34cfffce9`; #169/#171/#172 unchanged).
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
| DEC-01 | one agency workspace with multiple isolated client accounts | user direction; Brain/backend contract | TARGET RESOLVED. Canonical client_accounts/client_access_grants/client_company_brain agreed with A7 amendment; exact generation/locking delivery pending. No shared client DDL or fabricated same-workspace acceptance. |
| AUTH-01 | role-aware Brain/context/direct API/session and revoke locking | Company Brain Claude | PARTIAL: exact #159/#169/#170 composition passes; A1–A6 agreed, A7 amended; grant-generation/lock detail and canonical client schema/API delivery pending. Actual complete post-model transactional revocation proof still required. |
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

## Phase 1 task-security continuation — 2026-10-23

Active successor `codex/nosh-phase1-task-lifecycle` on #166 `4344dec0`.
Full behavior/security review, exact file list, native matrix, reproduction,
dependency SHAs and held rollback:
[TASK_SECURITY.md](../../audits/agentory-outbound-outpost-readiness/production-readiness/phase-1/TASK_SECURITY.md).
Machine-readable `task-security.json` accompanies it. Exact final commit and CI
are recorded in the successor publication receipt, not self-referential docs.

**New owned fixes:** unserved/default-off native prepare/register/cancel handler;
original P1 signer and verifier under one locked transaction; original Auth session
stamped into existing signed payload; private no-app-grant native registration;
immutable bound task/service claim/checkpoint/output fence; terminal cancellation;
OLD+NEW marker protection; replay/abort/rollback/concurrency limits. No task/lead
creation, actual execution, durable packets/reviews/model recovery or Phase 2 work.

**Native evidence:** 46 lifecycle +22 API tests (68/0), actual registration GoTrue
8/0, original native GoTrue 5/0, historical #166 baseline 68/0, actual context-
session original/refresh/service positives and wrong-session/demotion/revocation
refusals. P1 omission catches forged MAC/altered payload; lifecycle omission catches
six expected failures (61 pass/6 fail/one empty rollback omitted only mutant).
Normal tests ignore none. Final edge/infra/type/CI results are in publication receipt.

**Shared fix now delivered and tested:** exact source #169 `60be0471` (including
#147/#160) + #170 `cc83eb7e` independent diff + pinned #159 SQL + owned guards in a
fresh temporary tree, not an owner-branch merge. Owner pure role/workspace tests
13/0, native task/API 68/0, real Auth8/0, context-session and broad-surface audits
PASS, unchanged owner Brain native4/0. Viewer Brain PATCH now403/unchanged even
outside pilot; legitimate reads/provisioning/server writes remain. Enrolled pilot
Brain service writes intentionally stay frozen. Historical earlier FAIL receipts
are preserved; CI requires this exact owner-source composition to pass. This is
not a deployed or full live-handler/concurrent-revoke verification.

**Coordination:** [A1–A7 reply](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/166#issuecomment-6367855590)
agrees canonical client parent/composite binding/explicit grants for every role/
audited self-grants/versioned client Brain/one explicit-intent API. A7 amended for
live session and current authorization at final native write, terminal grant
generations and membership reduction visibility. Await owner confirmation of exact
generation/lock representation and delivery; no shared client DDL before that.
Backend pre-effect/immutable executable lifecycle handoff is still outstanding.

**Exact remaining Phase 1 blockers:**

1. Brain-owned client schema/API and final A7 locks/generations, then owned pilot
   same-client FK/descendant adapter and two-client **same-workspace** native tests.
2. Complete Backend-owned legacy/service pre-effect authorization and executable
   immutable-input/lifecycle contract. Database write denial is not pre-model or
   pre-purchase containment; no new engine/ledger is introduced.
3. Integrated table/view/RPC/Edge child-path isolation and legitimate invitation/
   nonpilot flows with concurrent revocation/regrant/session changes at the exact
   combined candidate. Existing privileged service reads remain a risk.

**Overall Phase 1 FAIL.** Continue these Phase 1 integrations when owners deliver;
do not start Phase 2. Later durable recovery/browser acceptance remains planned,
not quietly implemented. P1–P8 disabled; A7 NO-GO. No hosted migrations/writes,
deployment, paid calls, real records, sends, merges or customer activation.

CI follow-up in this successor: implementation head `b182e481` passed full CI
(all database/mutation shards), but dedicated native CI hit a pre-test random REST
port collision. Owned harness fix uses kernel-chosen ports, bounded bind-only
startup recovery and own-database nonce readiness. The required owner-integration
lane now forces a real occupied HTTP200 listener. No security assertion or model/
provider retry changed. See final-head receipt for the rerun, not the earlier head.

## Phase 1 actual Brain handler continuation — 2026-10-24

#171 is complete at `0d7cd07741aed8f20b824d90e45385629ff40412`; full CI39977607217
and native CI39977607221 pass. [Final receipt](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/171#issuecomment-6368455847).
No new edits to #171 or Claude's implementation. New isolated test/docs successor
`codex/nosh-phase1-brain-handler-audit` exercises unmodified exact #169 Edge handlers
with real disposable GoTrue/PostgREST/SQL. No live provider/model call.

**New verified AUTH-06 blocker:** `setup-company-brain/save_basics` and
`generate-company-brain-draft/update` commit after membership removal, demotion to
viewer or actual logout occurs between the initial authorization check and Brain
read/write. All six cases return200 with changed SQL; tests require401/403 and no
persisted edit. **17 controls PASS /6 deterministic failures**; valid owner/admin/
editor writes land, viewer/member/foreign/already-revoked/logged-out requests deny.
This supplements #169's correct raw-table browser closure, not a contradiction of
that narrower result. CAS checks content versions, not current permissions.

Evidence, source paths, exact scenario matrix and native writer handoff:
[BRAIN_HANDLER_AUTH.md](../../audits/agentory-outbound-outpost-readiness/production-readiness/phase-1/BRAIN_HANDLER_AUTH.md)
and synthetic JSON alongside it. Brain Claude owns the atomic role/session writer;
Codex supplies tests without duplicating the shared implementation. Model-action
and activation/concurrent revoke paths remain untested. The native CI audit is
explicitly failing; the required integrity check verifies all controls and exact
known failures and does **not** declare readiness. No tests are skipped.

Phase1 remains FAIL for AUTH-06 plus canonical client/grant/Brain generation/lock
contract, pilot same-client descendants and complete Backend pre-effect/lifecycle
containment. Phase2 not started. P1–P8 off; A7 NO-GO; no hosted/paid/customer effects.

## Phase 1 current-state continuation — 2026-10-24

Isolated successor `codex/nosh-phase1-client-contract-gates` on #1722ffc6b5f.
Re-read plans/Phase1 evidence, fetched origin, inspected #169/#171/#172 and open
owner branches/comments. #169 still60be0471: AUTH-06 fix not delivered. #1710d7cd077
and #1722ffc6b5f are open drafts, unchanged, full/native CI green. Read #172's
completed CI40078697596:17 passing/6 failing security assertions and explicit
readinessFAIL. No manual rerun or shared Brain implementation edits.

**Independent native checks completed:**
- Read-only catalog gate derives resources from actual P1 registry. Canonical
  client_accounts/client_access_grants/client_company_brain absent; pilot canonical
  FK absent;15 resources inventoried, direct canonical coverage0/15. BLOCKED/exit2,
  same-workspace behavioral isolation NOT TESTED. No synthetic client DDL.
- New OWN-01: actual signed-in A user cannot read B's prospect account but raw API
  stores contact A→B (201, SQL mismatch). Existing P1 prepare404 with no signature
  or binding; legitimate same-workspace control persists and prepares successfully.
  Actual local GoTrue/PostgREST/PG/P1 transaction, zero provider/model effects.
- Structural checker7/0; full infra203/0; type/lint/shell checks pass. Publication
  CI and exact final commit are recorded in the successor PR receipt.

Report/artifacts/commands:
[CLIENT_BOUNDARY_GATES.md](../../audits/agentory-outbound-outpost-readiness/production-readiness/phase-1/CLIENT_BOUNDARY_GATES.md).
OWN-01 requires shared native constraint/compatibility preflight and ownership
coordination before a held migration; no production/shared schema edited here.

Backend #150be625f46 unchanged; original signed client/session pre-effect and
executable lifecycle delivery still missing. Source inspection is not zero-effect
runtime proof. Handoff covers authoritative identity despite stripped markers,
all service/direct/worker/resume routes and preservation of nonpilot/spending rules.

**Phase1 FAIL.** Next: exact Brain fix→23/0 independent verification; final A7 and
canonical schema/API delivery→owned composite bridge/descendant and same-workspace
native tests; Backend guards→complete combined acceptance. Phase2 not started.
All customer pilot flags off; A7 NO-GO. No merges/deployment/hosted writes or
migrations, paid calls, real customer records or external actions.

Publication follow-up: b630ee00 full standard CI40097155626 passes. Native
40097155631 stopped at an existing mutation helper's sed/grep-q Broken pipe,
before the new audits. Consume the complete log without grep-q; both original
security failure assertions preserved. Targeted real P1 omission proof passes and
restores the source file. Final-head publication receipt records the rerun; no
runtime/security/budget changes and no historical failure relabeled green.

## Phase 1 acceptance preparation — #173 continuation (2026-10-24)

Continue on existing #173 `codex/nosh-phase1-client-contract-gates`, base head
6e854c9d, rather than opening another PR. Owner heads unchanged; no fix arrived.
Read current #169–#173 receipts and sent actionable owner checklists:
[Brain](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/169#issuecomment-6385018708),
[Backend](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/150#issuecomment-6385018852).
Brain owns all in-flight writer mutations plus final A7/canonical schema/API;
Backend owns/assigns OWN-01 constraint and all legacy pre-effect/lifecycle delivery.
Exact patch SHAs, migration requirements and compatibility controls requested.

**Completed independently:** test-only native effect fence and conformance tests;
real resource-parent/P1 path now records actual Auth/REST request effects and
fails if an external/late/invalid attempt is hidden. Approved origins only,
redirect refusal, cancellation/late-request handling, immutable/redacted evidence.
This does not authorize a request, simulate a successful model, alter budgeting
or prove every legacy route safe. Actual writer/ledger/queue assertions remain
separate and required.

**Results:** fence8/0; full infra211/0; new types/lint PASS. Native real GoTrue/
PostgREST/PG/P1 instrumented path observes5 local requests,0 external attempts;
valid parent persists/prepares; OWN-01 bad parent raw201 persists but P1 refuses404
with no signature/binding. Native command exits1 for the known integrity defect,
its evidence check passes. `effect-fence-native.json` preserves the complete trace.
No manual rerun of unchanged Brain23; publication CI retains existing regression
checks. Exact final-head CI is recorded in #173's publication receipt.

**Prepared acceptance:**
[INTEGRATION_ACCEPTANCE.md](../../audits/agentory-outbound-outpost-readiness/production-readiness/phase-1/INTEGRATION_ACCEPTANCE.md)
covers workspace/client ownership, grants/regrant, client Brain, removal/demotion/
logout in flight, original session/task lifecycle, legacy/direct/worker effects,
retry/resume and concurrent lock ordering. It identifies actual executable suites,
blocked APIs, deterministic barriers, positive controls and exact state/effect
assertions; no fake canonical tables or model/provider functionality.

**Still required:** delivered Brain fix→same23/0; final A7+canonical tables/API→
actual same-workspace client/grant/Brain matrix and owned bridge/descendants;
Backend OWN-01 and pre-effect/lifecycle patch→all entry/effect and retry proofs;
one combined candidate→all mandatory native acceptance. Phase1 FAIL, Phase2
unstarted, P1–P8 disabled, A7 NO-GO. No owner implementation edits or hosted/paid/
customer/merge/deploy effects. Verification readiness improved; no security
blocker is marked closed by this tooling alone.

## 2026-10-25 — owner integration and independent security verification (#185)

The [complete receipt](../../audits/agentory-outbound-outpost-readiness/production-readiness/phase-1/INTEGRATED_VERIFICATION_2026-10-25.md) pins every owner SHA, commands,
results, raw compressed logs and exact reproductions. Current source candidate
914a3a71 incorporates178/175/177/179/180/181/184 and original171–173 fixtures.
The original dirty worktree is preserved; no owner branch or implementation
was edited. AUTH-06 and OWN-01 are now narrow PASS, not pending fixes.

Two Backend179 failures are retained as required failing native acceptance:
foreign plan linkage and task creation after committed membership removal.
Brain178 has a source-grounded actual QueryClient cross-principal cache failure;
full mounted browser/session acceptance is still needed. Contract174 v2.2 O3 A
and O4 A are accepted, with explicit same-client parent-edge constraints and
atomic pin/registration requirements. Actual successor implementations remain
owned by Backend/Brain/Codex as detailed in the receipt. No duplicate ACL, ledger,
qualification implementation or new runtime feature was added.

Full local database289/1 has the known16.4 D1 test mismatch. Complete Ubuntu
12.2.3 CI40178721665 was dispatched at full level; its final result is recorded
in the dated receipt. The native workflow also retains the genuine execution
security failures; ordinary CI passing never changes Phase1 acceptance.

Next: obtain owner fixes and canonical task/descendant contracts, verify unchanged
reproductions, finish the Codex private-client bridge and same-workspace native
acceptance, then rerun the combined security boundary. **Do not start Phase2.**
No hosted migration/write, deployment, merge, paid provider/model, customer data,
feature activation or A7 execution occurred.

### Incoming Brain follow-up and full CI receipt (2026-10-25)

178 advanced toaeeba016 during verification. Its versioned first-save correction
was independently reproduced red on the old handler (0/1), then verified with
real-GoTrue24/0 on local assembly221da7ab. The patch preserves AUTH-06 and CAS;
original23 and pilot security are rerun. The earlier full CI40178721665 is
SUCCESS on914a3a71:16 jobs,22 contract files,98/98 mutation proofs. It does not
authorize customer use or claim coverage of later source changes. The final
verification commit and CI are linked from185. All execution/cache/shared client
integration blockers above remain, so Phase1FAIL and Phase2 unstarted.
