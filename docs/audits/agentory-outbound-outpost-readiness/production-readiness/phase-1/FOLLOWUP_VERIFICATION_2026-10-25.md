# Phase 1 follow-up: execution, membership, real workers and cache

**Phase1 FAIL; Phase2 unstarted; P1–P8 disabled; A7 NO-GO.** Independent
verification on draft185. No PR merge, deployment, hosted migration/write,
customer-data operation, paid API call or feature activation was performed.
Local assembly commits combine owner patches without editing their implementation.

## Pinned incoming work

| PR | Exact head |
|---|---|
|179|`083512424873ad9cb9f9a83dec5797fb6633cce9`|
|186|`bbbf3811566f4a1ccdf6b33f6c06602c0a3a358e`|
|158|`99bceba527811126ff7eeecd0d37a1c106e32372`|
|182|`f0798c88d737113d02b6f2c71838a2b9fa720551`|
|181|`90bd993f00ef248b3d810333b89d63e1e945d48e`|
|177|`05e288e1ea775e1efaf53581ed7bb4e0b6d032d4`|
|178|initial`aeeba016`; refreshed during audit to **`86d33d6fab97f5b8e1fa68a89edb42bf31973417`**|
|176|`1756b21717fd172cf256ca05bd1b3370248638a9`|
|169|`833affce5077ae5f50b53353cb84fa0e916918dc`|
|174|`96962e9a316e4a83c486ad2a3ba14cb259b35251`; §9 interfaces unchanged from86f29509|

Source09ef98f6a1b7664438e6dd39701dc1aac2c1ae94 contains the complete incoming
composition and verification tests. Previous185 sourceb91040cd and historical
receipts remain intact. Assembly conflicts were only the held README and
appended mutation blocks; both complete blocks were retained, with no behavioral
resolution or dropped proof. Exact159 SQL and170 workspace diff remain pinned
in the original disposable native composition; this is not a claim of hosted
application.107 remains excluded for its duplicate held migration version.

## Independent verdict

| Area | Verdict | Evidence and scope |
|---|---|---|
|AUTH-06|PASS|Original unchanged23/0 on latest Brain; writer lock9/0; no-write refusals and positives retained|
|OWN-01|PASS for workspace graph|Original unchanged raw/P1 reproductionPASS, owner8/0 including service writes and26 references; same-client ownership separate|
|EXEC-PLAN|FAIL overall; original repro fixed|Original assertionPASS; authenticated/service foreign plan_id and task_plan_id INSERT/PATCH controlsPASS. Service can still relocate a referenced parent plan across workspaces (1 mismatch)|
|EXEC-REVOKE|FAIL overall; original repro fixed|Original removal-before-task-write assertionPASS; two-session INSERT/DELETE serializationPASS. Removal after INSERT but before first model call still permits1 new model attempt|
|Membership writers|FAIL at raw app-role surface; RPC policyPASS|186's8/0 includes16 policy cases, session checks, grants/revisions and3 last-owner races. Raw service promotion and last-owner deletion bypass RPC restrictions|
|CACHE-SESSION|PASS on86d33d6f|Independent corrected repro red/green, key tests6/0 combined; real mounted actual app providers/page + real GoTrue5/0, including late responses and grant revocation|
|Autosave|PASS tested scope|Real-GoTrue24/0 including concurrent writes, activation, first insert, stale/no-copy preservation and logout; AUTH-06 remains authoritative|
|Client isolation|FAIL complete boundary|Canonical client Brain15/0 and cache closurePASS; immutable task pins, same-client descendants and pilot bridge not delivered|
|Task permissions|FAIL complete boundary|Original3 execution assertions and task trigger5/0 pass; pilot lifecycle/API68/0 and original sessions8/0 pass. Parent relocation and executable client binding remain open|
|Real-worker reliability|PASS offline tested scope|4 actual-process rehearsals: two SIGKILL/adoption paths, operator stop, zero-Apify kickoff. Providers/models scripted and fenced; no live-provider claim|
|Spending controls|FAIL overall authorization; bounded controlsPASS|No duplicate actor charges in retry/recovery; operator stop prevents new POSTs; zero-Apify enforced. A newly initiated model after membership loss remains an unauthorized spending risk|
|Integrated candidate|FAIL|Four supplemental native assertions fail; ordinary full CI is a separate regression gate|

Original `execution-integration-audit.test.ts` is byte-identical to185b91040cd
and now **3/3PASS**. Combined real-GoTrue native run is **56/0**: original3,
task commit5, membership8, canonical client15, autosave24, independent rollback1.
The original AUTH-0623 and OWN-01 reproductions are also unchanged. Nothing
that originally failed was weakened to obtain these passes.

## Remaining verified failures and corrections

### PLAN-PARENT — Backend179 (P1)

`task-parent-membership-audit.test.ts`: create a valid A task→A plan as service,
then PATCH the parent `task_plans.workspace_id` toB. Actual PostgREST200;
native join finds1 task whose workspace differs from its plan. The task-only
trigger cannot preserve integrity when the parent changes. Protect parent
relocation as well as child writes, e.g. suitable native composite constraints
or an equivalent invariant guard, with concurrent parent/child and legitimate
nonpilot controls. Do not silently move/reassign records.

The trigger correctly checks both plan columns for authenticated/service writes.
Its documented trusted administrative postgres exception is distinguished from
application service-role access; no finding here relies on administrative bypass.

### EXEC-EFFECT — Backend179 (P1)

`post-insert-revocation-audit.test.ts`: actual `handleRunAgent` creates a
synthetic Scribe task. After the actual INSERT commits, the test commits member
removal and returns the original response. The handler then invokes the generic
model transport (Anthropic): `removed:true,inserted:true,model_attempts:1`.
A503 response is mocked; **no external request is sent**. An identical authorized
control reaches1 attempt andPASSes; revoked case requires0 andFAILs.

No model had started before removal, so this is not legitimate settlement of an
already-issued call. Require the owned live-authorization/admission boundary
before new operations; preserve failed-attempt accounting, existing spending
limits, retries and settlement. Do not create another ledger or model router.

### MEMBER-SURFACE — Backend186/shared Brain permissions (P1)

Two assertions in `task-parent-membership-audit.test.ts` use actual service-role
PostgREST writes: raw viewer→owner PATCH returns200, and deleting the only owner
returns200 with0 owners left. Native policy can be bypassed outside the guarded
RPCs. This does **not** claim service credentials are exposed to customers.

Restrict raw service UPDATE/DELETE/TRUNCATE or provide equivalent native invariant
enforcement, preserving legitimate provisioning INSERTs, approved definer writers
and nonpilot flows. Promotion remains `promotion_unsupported` until the product
policy is agreed. Browser/RPC denial alone does not establish a single native
writer boundary. Both positive authenticated/service own-plan inserts pass.

Supplemental result: **2 positivesPASS /4 securityFAIL**, independently reproduced
on Ubuntu by the required native workflow. Responsible owners received exact
reproductions; Codex added tests only, not competing implementations.

## Cache harness correction and actual mounted acceptance

The unchanged historical cache harness throws on the correct authorization
refusal before reaching its original `checks===2` assertion. The raw failure
and original source are preserved. Codex corrected expected-denial handling and
safe diagnostic logging, kept the count assertion intact, and **added** explicit
no-Brain/no-list assertions. Against oldb91040cd it remains1PASS/1FAIL with0 checks
and prior data visible; against86d33d6f it passes2/0. Together with the owner key
suite it passes6/0. This is not falsely labelled an unchanged-filePASS.

Mounted5/0 uses real GoTrue sign-in/sign-out, PostgreSQL/PostgREST, actual Brain
handler and actual AuthProvider/WorkspaceProvider/QueryClient/page in headless
Chrome with a fresh profile. A→logout→B has no A client name/content/cache/storage;
a held A response never reachesB; A re-entry works; grant revocation refuses a
save and removes the client after reload. Synthetic screenshots are preserved.
The initial attempt failed only because a supplied screenshot output directory
had not been created; it was created and the unchanged test rerun.

## Worker, spending, rollback and platform checks

The real-process suite passed4/4 locally with actual worker processes, SIGKILL,
native queue/ledger/credits and scripted transports. Retry/adoption buys jobs
once and company details once; both charged once, balance8/reserved0. Operator
stop records no later vendor/model POST, only pre-stop job charge, balance9/0,
terminal task and final stopped authorization. A test-only no-op-stop negative
control fails the original assertion (0/1;3 filtered), buying the second actor
and making3 model POSTs. Its temporary copy never enters the candidate.

158's CI selects realprocess with DB/worker/path changes. Its gate rejects a
missing/skipped/failed required job, and its shell requires at least4 executed
rehearsals.182's default `providers=openai-only` unsets APIFY_API_TOKEN and denies
`api.apify.com:443`; exact-port denial matters on Deno2.8.2. Permission probes
query the actual shell/Deno permissions without connecting. Only an explicit
separately authorized paid mode enables Apify. No TEST worker was dispatched.

179/186 rollback round-trip1/0 compares native function definitions and ACLs,
preserves membership/grant rows and176 hooks, and reapplies in dependency order.
Bootstrap installs176 before186; task trigger and OWN-01 remain held. Unique
migration-version scanning is retained; no hosted application is authorized.

Local edge9414/0 before the frontend-only cache follow-up; portable infra218/0.
The3 Linux worker-permission tests need GNU timeout, absent locally; they run
unchanged in Ubuntu CI. Initial local realprocess launcher rejected a Deno
symlink alias; rerun allowed only the same executable's two paths plus psql,
not arbitrary programs, and passed4/4. CI runs the owner's unmodified wrapper.
Local attempts/platform errors remain in the evidence, not hidden as passes.

## Reproduce in disposable local environments only

```sh
# Real GoTrue + fresh PG17.6/PostgREST; unchanged original and owner contracts.
POSTGREST_BIN=/path/to/postgrest tests/db-contract/run-with-gotrue.sh \
 tests/outpost-native/execution-integration-audit.test.ts \
 tests/db-contract/taskCommitBoundary.contract.test.ts \
 tests/db-contract/workspaceMemberWriters.contract.test.ts \
 tests/db-contract/clientCompanyBrain.contract.test.ts \
 tests/db-contract/brainAutosaveEndToEnd.contract.test.ts \
 tests/outpost-native/security-rollback-audit.test.ts
#56/0
POSTGREST_BIN=/path/to/postgrest tests/db-contract/run-with-gotrue.sh \
 tests/outpost-native/task-parent-membership-audit.test.ts \
 tests/outpost-native/post-insert-revocation-audit.test.ts
#2PASS/4FAIL, all native; external transports fenced
node --test tests/outpost-native/cache-session-audit.test.cjs tests/frontend/brainCacheSessionKeys.test.cjs
#6/0
# CHROME_BIN is optional on macOS; supply a local Chrome binary elsewhere.
# Omit BRAIN_BROWSER_OUT to have the test create a fresh output directory.
BRAIN_E2E_DENO_FLAGS='--allow-run --allow-write' POSTGREST_BIN=/path/to/postgrest \
 tests/db-contract/run-with-gotrue.sh tests/browser/brainCacheSession.browser.test.ts
#5/0
# Fresh own loopback PG only; runner refuses non-local DB URLs.
PG_ADMIN_URL=postgres://postgres:DISPOSABLE@127.0.0.1:LOCAL/postgres \
 POSTGREST_BIN=/path/to/postgrest tests/realprocess/run.sh
#4/0; also executed by full CI
```

Full-CI and native workflow receipts/tallies are recorded in the adjacent
`followup-2026-10-25/manifest.json`. All commands use synthetic fixtures and
throwaway native databases. No live GPT/Apify or customer workflow is simulated
as verified.

## Exact next owners/actions

- Backend179: close PLAN-PARENT and EXEC-EFFECT with native/per-effect proofs.
- Backend186 + Brain shared permissions: close raw membership-DML bypasses;
  preserve last-owner policy and unsupported promotions across app write surfaces.
- Backend: immutable task grant/session pins, per-effect consumption and parent
  **client** identity constraints; workspace-only parent FKs are insufficient.
- Codex pilot owner: canonical private-client composite bridge and global lock
  alignment, then same-workspace A/B native/replay acceptance.
- Brain CACHE-SESSION is independently verified closed; do not keep reporting
  its historical failure as current. Client isolation as a whole staysFAIL.

Phase1 may pass only when all those required native gates pass on the combined
implementation. Phase2 needs separate approval afterward. A7 also requires its
independent strict qualification, reliability, deployment/target, provider,
financial and separately authorized TEST acceptance. Ordinary CI success never
provides merge/deploy/paid/activation authority.

## Completed CI receipts

Verified source **09ef98f6a1b7664438e6dd39701dc1aac2c1ae94**:

- [Full40202500235](https://github.com/kathmanducreatives-code/aiworforce-platfrom/actions/runs/40202500235):
  **SUCCESS,17/17 jobs,30/30 DB contract files,119/119 mutation proofs,
  real workers4/4**, edge9414/0, infra221/0, UI682/0, Node9/0,
  type/lint ratchets/build/ReplayPASS. This includes the latest cache fix.
- [Native40202502983](https://github.com/kathmanducreatives-code/aiworforce-platfrom/actions/runs/40202502983):
  **FAIL only at the required supplemental acceptance step**:2 positivesPASS,
  PLAN-PARENT, raw promotion, raw last-owner DELETE and EXEC-EFFECT4FAIL.
  Original execution3/0 and client/autosave24/0 pass in that same Ubuntu workflow.
- Independent real mounted browser5/0, real-GoTrue combined56/0 and original
  AUTH-0623/0 are preserved separately. All screenshots are synthetic.
- The first assembled full workflow failed an obsolete verifier dependency-set
  expectation after158 added scenario consumers. The own assertion was widened
  to require all10 actual dependent suites; no scanner/gate was weakened.
  The subsequent full workflow passed. Local Linux-only command limitations
  were not treated as product/security failures.

The publication successor adds documentation/evidence only and preserves these
exact application/test/workflow trees. Ordinary CI green is not the required
security acceptance; **Phase1 remainsFAIL** until the four supplemental failures
and remaining client integration gates pass on their delivered implementations.
