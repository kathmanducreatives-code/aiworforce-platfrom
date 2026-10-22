# Nosh pilot: authoritative progress tracker

**Customer pilot readiness: FAIL. P1–P8 disabled. A7 NO-GO.**

Last audit: 2026-10-23 Asia/Kathmandu (GitHub refresh 2026-10-22T18:38Z).
Read [MASTER_PLAN.md](MASTER_PLAN.md) before resuming. This tracker supersedes
historical phase-number status in `docs/audits/.../production-readiness/`; those
files remain immutable receipts of narrower previous work. Production-readiness
Phase 0–8 below is distinct from the historical P1–P8 feature implementation.

## Phase status and next authorization

| Phase | Status | Branch / PR | Validation | Remaining blockers |
| --- | --- | --- | --- | --- |
| 0 — architecture/readiness audit | COMPLETE (roadmap awaiting review) | `codex/nosh-readiness-master-plan`; documentation PR linked below | repository/PR/CI/interface audit; documentation checks in phase receipt | User review; DEC-01 and owner contracts are planned dependencies, not assumed approvals |
| 1 — native security | PARTIAL; new work NOT APPROVED | historical foundation `codex/outpost-native-security`, #151, `001fa9db9a1a07266dfc700b0d7a21fbc322c7df` | 42 native identity passed; 2 intended ownership-mutant failures; public-task viewer probe FAIL; standard/full CI FAIL | SEC-01..04; CI-01; DEC-01; AUTH-01/EXEC-01; real GoTrue/session proof; native public API/Edge ownership |
| 2 — transactional persistence | PENDING / NOT APPROVED | no implementation PR yet; P3/P5/P6/P7 interfaces are not persistence | offline contracts only; no native durable import/snapshot/review/approval adapter | Phase 1; DATA-01/02; REPLAY-01; original-task lifecycle and shared receipt contract |
| 3 — legacy executor containment | PENDING / NOT APPROVED | owner #145/#149/#150 are dependencies, not pilot containment completion | no complete pilot route-by-route native acceptance | Phase 1/2; backend EXEC-01; Brain context seam |
| 4 — recovery/spending | PENDING / NOT APPROVED | owner #150 plus future FIN-01 successor | mocked P4/P8 safeguards; no native pilot shared-ledger recovery proof | Phase 2/3; FIN-01/02; MODEL-01; no competing ledger |
| 5 — native import-to-export | PENDING / NOT APPROVED | no native journey PR yet; #148 is narrower offline acceptance | synthetic injected journey exists; complete application/database workflow NOT TESTED | Phases 1–4; UI-01; EVID-01; durable confirm/task/writer/resolver wiring |
| 6 — local acceptance | PENDING / NOT APPROVED | future exact combined candidate | combined native/browser/crash/security suite NOT TESTED | Phases 1–5; INT-01; owner integrations; DEC-01 positive same-workspace requirement or explicit revision |
| 7 — hosted TEST | BLOCKED / NOT APPROVED | no executed hosted plan | no target-deployment/catalog/runtime receipt | Phase 6; named target preflight; specific hosted migration/deploy/synthetic-write approval |
| 8 — release/customer readiness | BLOCKED / NOT APPROVED | no release candidate | no real-model or Nosh acceptance receipt | Phase 7; QUALITY-01; owner compatibility; separate merge/deploy/paid/data/activation approval |

Next phase after user continuation: **Phase 1 — finish native security**, not Phase
2. There is no authorization to begin Phase 1 implementation in the Phase 0
request. “Proceed with the next phase” approves safe local work in Phase 1 only,
subject to owner coordination; it does not resolve DEC-01 or approve external actions.

## Active worktree and immutable resume points

- Documentation branch: `codex/nosh-readiness-master-plan`.
- Worktree: `/Users/prasidha/Downloads/screeningpilot-main/nosh-readiness-master-plan`.
- Base: #151 `001fa9db9a1a07266dfc700b0d7a21fbc322c7df`.
- Documentation publication SHA/PR: use the branch's Git history and the draft PR
  linked in the final phase receipt; no self-referential commit SHA is fabricated.
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

**Validation:** documentation-only checks verify relative links, existing code
paths, all nine phase sections/twelve fields, blocker coverage, and whitespace.
Exact command/results and draft PR/head are reported with this phase publication.
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
| DEC-01 | one client/workspace versus requested two clients within workspace | user + Brain/backend | OPEN. Recommended smallest pilot remains separate client workspaces, but changing requested same-workspace positive test requires explicit user agreement. Otherwise scope client-owned Brain/memory/roles/credentials/storage and coordinated migration into Phases 1/2. |
| AUTH-01 | role-aware Brain/context/direct API/session and revoke locking | Company Brain Claude | OPEN; use #147 discussion; current owner/admin-only pilot rule preserved; editor/viewer matrix must be agreed/tested |
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

## Exact next-phase task list (not started)

1. Refresh PRs, CI and owner replies; retain #151 as PARTIAL; open isolated Phase 1
   branch only after phase approval.
2. SEC-01: retain `OUTPOST_NATIVE_PUBLIC_AUDIT=1 tests/outpost-native/run.sh` as the
   failing reproduction. Inventory effective public.tasks SELECT/ALL policies,
   associated artifacts/views/RPCs and service-backed readers. Obtain narrow
   owner-agreed policy/Edge authorization contract; fix viewer access while
   proving intended owner/admin/nonpilot/service behavior.
3. DEC-01: obtain tenancy decision before final schema/role scope. Preserve one-
   client constraint in the meantime; do not claim two same-workspace clients work.
4. CI-01: schema-qualified RLS parser correction with positive/missing-RLS/mutation
   controls, no allow-list and no dropped tests.
5. Complete native parent/grants/session/Brain/Edge route matrix and real disposable
   GoTrue proofs under AUTH-01/EXEC-01; promote public probe to required acceptance.
6. Run relevant local/CI tests, review held migrations/rollback, publish separate
   security draft(s); record exact results and owner blockers; stop at Phase 1 end.

Do not begin persistence, provider calls or UI enablement to work around a blocked
security contract. Later-phase owner interface discussions are preparation only,
not authorization to implement those phases.

## Approval ledger

| Action | State |
| --- | --- |
| Phase 0 audit/docs/draft PR and GitHub coordination | AUTHORIZED |
| New Phase 1 implementation | WAITING for roadmap review / user continuation |
| Phase 2–6 implementation | NOT APPROVED; each needs its own continuation |
| Disposable local SQL/tests | allowed within a subsequently approved implementation phase; none needed/performed for this docs phase |
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
