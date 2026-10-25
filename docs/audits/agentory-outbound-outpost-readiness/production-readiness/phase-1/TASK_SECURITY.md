# Phase 1: original-session task registration and lifecycle containment

**Owned disabled foundation: PASS locally. Full Phase 1/customer readiness: FAIL.**
2026-10-23. Successor `codex/nosh-phase1-task-lifecycle` on #166
`4344dec0e224d9766b3919c91a61b8066d17e16f`. Exact publication head and GitHub CI
receipts are in the successor draft PR. Phase 2 has not started. P1–P8 stay off;
A7 remains NO-GO. No deployed/live customer capability is claimed.

## Actual change and boundary

The new **unserved**, default-disabled `handlePilotTaskRegistration` composes the
existing Supabase Auth verification, P1 enrollment/HMAC/resource verifier and an
injected native transaction. There is no default database connection, Deno.serve,
new role, signing key, qualification authority or model/provider call.

- `prepare` signs **an existing owned ready task**, stamps the Auth-verified
  original session into P1's existing payload hash, then registers the exact image
  in the same transaction. Task and lead creation are not implemented.
- `register` verifies an already signed task. A missing signed original-session
  stamp refuses new registration; older envelopes are not repaired automatically.
- `cancel` permits original-session ready → cancelled only. Replay returns the
  existing outcome; reopening, status claims, outputs and execution are refused.
- Every action derives actor/session from a bearer first validated by Auth. Only
  exact operation fields are accepted. Client identity comes from P1 enrollment,
  not an Apollo ID, UI approval, metadata role or supplied authorization boolean.
- The native store uses parameterized queries and one READ COMMITTED transaction.
  Parent task → enrollment → current membership → original Auth session locks
  protect authorization and exact image checks. Resource/Brain reads take share
  locks. Local lock/statement/idle limits prevent unbounded database waits.
- Native failures, conflicts and cancellation abort without automatic retries.
  A lost response replays the same image/binding; preparation failures roll back
  both P1 signature and registration. No budget/admission counters are reset.

Held SQL `20261023101216_outpost_pilot_task_registration_lifecycle.sql` requires
#151 identity + #166 access containment. Its four private transaction functions
have empty search_path and **no EXECUTE grant for PUBLIC/anon/authenticated/service_role**.
The trusted injected database host must preserve that boundary. SQL does not
verify a HMAC independently; the original P1 verifier runs while those locks are
held. An omission mutation proves forged signatures otherwise reach registration.
Database administrators remain privileged trusted operators, not constrained users.

Triggers deny app-role pilot INSERTs, marker stripping, owner/workspace changes,
registered payload/checkpoint/output writes, status claims, removal and history
TRUNCATE. Both OLD and NEW images are checked, including adding a pilot marker and
starting it in a single UPDATE. The only internal lifecycle exception is exact
terminal cancellation under the original live principal. Nonpilot task execution
continues through the existing native claim/fenced-write functions.

## Exact owned files

- `_shared/pilot/pilotTaskRegistration.ts`: pure authenticated prepare/register/cancel handler.
- `_shared/pilot/pilotTaskNativeStore.ts`: injected real transaction adapter.
- `_shared/pilot/pilotScope.ts`: optional server-origin session passed into original signer only; old callers unchanged.
- Held migration above; `native-task-rollback.sql` alongside this report.
- `tests/edge-functions/pilotTaskRegistration.test.ts`.
- `tests/outpost-native/{task-lifecycle,registration-auth}.test.ts` and `lib/taskRegistration.ts`.
- `tests/outpost-native/{run.sh,fixture.ts,api-security.test.ts}`: real database/auth fixtures and exact shared dependency composition.
- `tests/outpost-native/{mutate-registration-verifier,integrate-brain-owner,test-bind-collision}.sh`.
- `.github/workflows/outpost-native-security.yml`: required native/GoTrue/mutation/owner-source gates; historical red controls retained separately.
- This report, JSON receipt, client contract and authoritative plan/progress tracker.

Shared modules above are under `supabase/functions/`. No Brain writer/schema,
run-agent, orchestrate, worker, ledger or qualification implementation was edited.

## Adversarial results

| Test / real path | Expected and observed | Status |
| --- | --- | --- |
| Disabled handler / enrollment | refuses before database/provider work | PASS |
| Valid owner/admin, P1 resources + live original session | prepare/register, exact replay, one binding | PASS |
| Editor/viewer/revoked/foreign actor | no binding or task change | PASS |
| Forged MAC, altered signed payload, unsigned registration | refused by original P1 verification | PASS |
| Missing/wrong original session, new login, fake validly signed nonexistent session | refused | PASS |
| Real GoTrue refresh / logout | same-session refresh succeeds; logout refuses | PASS |
| Foreign resources/client or injected actor/session/verified flag/action | no authorization or signing | PASS |
| Shared admin attempting another actor's task | refused despite workspace role | PASS |
| Bound owner/workspace/payload mutation + restoration | native mutation refused; no A→B→A revival | PASS |
| Actual `claimContinuationViaRpc` with a valid existing checkpoint | pilot denied (42501), nonpilot claimed | PASS |
| Actual `fencedTaskUpdate` and service PostgREST writes | pilot refused; nonpilot change verified in SQL | PASS |
| Marker addition + running status in same UPDATE; already-running marking | refused | PASS |
| Cancel/replay/reopen | terminal cancel succeeds once; reopen/read through old snapshot denied | PASS |
| Lost prepare/register/cancel response | replay preserves exact task/binding, no reset | PASS |
| Error after stamping/signing or after binding; request abort | transaction rolls back, no partial authorization | PASS |
| Concurrent same task / resource IDs shared by clients in separate workspaces | serialization and no contamination | PASS |
| Concurrent owner/membership/session mutation | locks serialize; later revocation denies new access | PASS |
| Expiry during transaction, stale expected row, repeatable-read transaction | refuses; rollback | PASS |
| Pooled transaction reuse | claims/timeouts do not leak | PASS |
| Private RPC grants, function search_path, populated rollback | app-role EXECUTE denied; fixed path; rollback refuses populated identity | PASS |
| Same-workspace client A and B with separate grants/Brains | owner schema not delivered; historical uniqueness remains | BLOCKED |
| Every legacy route before data/model/purchase effects | no complete owner contract/route suite yet | BLOCKED |
| Full browser import → approved export / durable model recovery | later phases, not authorized or implemented here | NOT TESTED |
| Hosted/live customer/paid provider execution | no authorization; no attempt | NOT TESTED |

## Reproduction and evidence

Use only a disposable local database. `run.sh` creates/removes its own fresh
PostgreSQL 17.6 container and loopback PostgREST. Real Auth lanes start digest-pinned
local GoTrue. Unit mocks replace Auth/provider transport only; no simulated success
is used for database/P1/claim/write behavior. No model or external provider is called.

```sh
# Fetch reviewed Git objects; no merge and no hosted operation.
git fetch --no-tags origin 572dca5c8d9c7f121731456801a035cfb6186b1e 60be04712c41193da213a95c1918f7f4f9a4e645 cc83eb7ee3edf68192378ef68805a71b125edc59 8b0e2b6bdb20d6fe30542da39f0170d514d52746
git show 572dca5c8d9c7f121731456801a035cfb6186b1e:supabase/migrations/20261022120000_close_workspace_self_join.sql > /tmp/outpost-membership-159.sql
OUTPOST_NATIVE_MEMBERSHIP_SQL=/tmp/outpost-membership-159.sql OUTPOST_NATIVE_LIFECYCLE=1 tests/outpost-native/run.sh
OUTPOST_NATIVE_MEMBERSHIP_SQL=/tmp/outpost-membership-159.sql OUTPOST_NATIVE_LIFECYCLE_AUTH=1 tests/outpost-native/run.sh
OUTPOST_NATIVE_MEMBERSHIP_SQL=/tmp/outpost-membership-159.sql tests/outpost-native/mutate-registration-verifier.sh
# Mutates only a disposable SQL copy; MUST fail the named native security tests.
OUTPOST_NATIVE_MEMBERSHIP_SQL=/tmp/outpost-membership-159.sql OUTPOST_NATIVE_LIFECYCLE=1 OUTPOST_NATIVE_OMIT_LIFECYCLE_GUARD=1 tests/outpost-native/run.sh
# Materializes exact owner source in a temporary tree; deletes it on exit.
tests/outpost-native/integrate-brain-owner.sh

deno test --no-check --allow-read --allow-env tests/edge-functions/
deno test --allow-read --allow-env --allow-run tests/infra/
deno check --node-modules-dir=none supabase/functions/_shared/pilot/pilotTaskRegistration.ts supabase/functions/_shared/pilot/pilotTaskNativeStore.ts tests/outpost-native/task-lifecycle.test.ts tests/outpost-native/registration-auth.test.ts
```

Local results: native task/API **68/0** (46 lifecycle + 22 API), real registration
Auth **8/0**, original native Auth **5/0**, baseline #166 native **68/0**, actual
context original/refresh/service success with wrong-session/demotion/revocation
refusal. P1-verifier omission catches forged-MAC and altered-payload cases;
lifecycle-guard omission produces **six required failures** (61 passed, 6 failed,
1 empty rollback test omitted only on the mutant). Normal suites ignore none.
Full edge **9,226/0**, infra **196/0**, new module/native type checks and six-file
lint PASS. Final-head GitHub CI results are recorded in the publication receipt; the first local infra invocation omitted `--allow-run` and had six harness
permission failures, then was rerun with the exact CI command. No assertion changed.

### Shared Brain composition, actual tested versions

`integrate-brain-owner.sh` materializes #169's complete source, checks/applies only
#170's independent diff in that temporary tree, then overlays **owned pilot files**.
No owner branch, shared source or Git history is modified/merged. Manifest:

| Component | Exact tested object |
| --- | --- |
| Launch | `8b0e2b6bdb20d6fe30542da39f0170d514d52746` (T01/Q1–Q4) |
| Brain #147 → #160 → #169 | `60be04712c41193da213a95c1918f7f4f9a4e645` |
| Workspace choice #170 | `cc83eb7ee3edf68192378ef68805a71b125edc59` diff from launch |
| Membership #159 SQL | `572dca5c8d9c7f121731456801a035cfb6186b1e`; SQL SHA256 `5fb203974a2f79b8d94f3988aec8807c96fb2dae3de17486ecdd803a33970311` |
| Brain #169 SQL | SHA256 `d490ead239fbffbbe9467a09eac314d1d1eee705ca231ff08ff5b2b2a34f7340` |
| Unmodified owner native test | SHA256 `b139086ca9ab87a3a4b19545660a9dfc5789242343903cc982642d0835de98c9` |

**PASS:** owner role/parity/workspace pure tests 13/0; actual native task/API 68/0;
real registration Auth 8/0; actual context-session audit; broad native surface
audit; unmodified owner Brain native contract 4/0. Viewer Brain PATCH is **403,
row unchanged**, including nonpilot workspaces. Owner/editor browser writes are
also intentionally denied by #169; read/provisioning/service positives pass.
Enrolled pilot Brain remains frozen even for service writes; no weakening to make
an enrolled writer succeed. #169's source-level handler checks are not a complete
actual-handler concurrent-revocation proof.

The older candidate **without #169** still fails viewer nonpilot Brain PATCH
(204, changed). CI retains that historical dependency control but requires the
exact owner-source composition above to pass. Green narrow CI is not Phase 1 PASS.
#159's newer `8d3a7d71` changes owner tests, not this pinned SQL; owner reports manual
production/TEST hotfix application. Reviewed metadata only; no independent hosted
read or application. #169 is not inferred deployed from its draft PR.

## Coordinated client architecture and exact remaining blockers

[CLIENT_CONTRACT.md](CLIENT_CONTRACT.md) records A1–A7 response to Brain Claude:
[#166 agreement](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/166#issuecomment-6367855590).
One `client_accounts` registry, explicit grant for **every role**, separate versioned
client Brain, native CAS, no agency/default fallback. Audited owner/admin self-grant
is allowed; Brain edit permission does not grant pilot operation/approval.

A7 requires locking/rechecking current membership, active client, grant and live
session in the final native transaction after model work. Frozen task/approval
consumers also need immutable grant generations (or identity + revision), terminal
revocation and observable membership reductions; regrant cannot revive old tasks.
Exact representation and lock order await owner confirmation/delivery. No shared
client DDL or one-client uniqueness removal is implemented on silence.

Phase 1 remaining mandatory gates:

1. **Brain-owned canonical client parent/grants/Brain API**, revocation/session
   ordering and native role/handler tests; then owned pilot composite-FK successor
   and client-scoped descendant inventory with same-workspace two-client positives.
2. **Backend-owned pre-effect guards** on all legacy service routes and executable
   task immutable-input/lifecycle contract. This slice freezes execution rather
   than inventing mutable states or duplicating ledger/qualification logic.
3. **Integrated full boundary proof**: grants/regrants, concurrent membership/session
   changes, every relevant child read/write/alternative route, legitimate nonpilot
   and invitation flows. Missing client schema is not substituted with two separate
   workspaces. Current table/service context access is not generally client-safe.

Durable packets/revisions/approvals, model reserve/settle/output recovery and the
complete browser journey remain later-phase dependencies, not implemented here.
All runtime limits/budgets remain unchanged; no model/provider attempts occur in
this slice. No Phase 2 or hosted activation approval is inferred.

## SQL/security review and rollback

Migration remains in `supabase/migrations-held/` only. Test it after #151/#166 and
exact #159/#169 dependencies on a fresh local database, review function grants,
trigger ordering, full-row timestamp representation and no-op/cancel behavior.
Registration requires a trusted direct connection with unset SQL role and verified
request-local claims; never expose those functions as a service-role RPC or grant
PUBLIC execution. Context functions use existing authorization, not this writer.
The new registration switch is separate and defaults off. Server integration,
credentials, public endpoint and any hosted migration require separate review.

`native-task-rollback.sql` locks/checks enrollment and binding tables and refuses
populated identity. Empty-only rollback drops only this slice's functions/triggers,
then leaves previous access restrictions intact. Native test rolls back/reapplies
successfully on empty state. No CASCADE, scope rewrites, permission revival or data
loss rollback is allowed. Before any future populated rollback: disable writers
and executor admission and design an owner-reviewed forward recovery operation.

### CI harness correction (same Phase 1 PR)

Initial implementation head `b182e4816a556bc83f21c7a55af1b6df7a8c5e7d` passed the
[full CI gate](https://github.com/kathmanducreatives-code/aiworforce-platfrom/actions/runs/39976500624),
including all three database and eight mutation shards. Its separate
[native workflow](https://github.com/kathmanducreatives-code/aiworforce-platfrom/actions/runs/39976500587)
failed at the last owner-integration launch: PostgREST could not bind a randomly
guessed port (`Address in use`). No security assertion was weakened or skipped.

The test harness now requests a kernel-selected free port, then allows **at most
three process launches and only after a bind-address collision, before any test**.
Other startup failures/timeouts fail immediately. It never retries an assertion,
Auth operation, model call or provider operation. A test-only invoker RPC returns
a per-disposable-database nonce, so a foreign HTTP 200 is insufficient readiness.
No deployed migration/function is added. `test-bind-collision.sh` occupies the
first port with a real unrelated HTTP200 listener during all five owner native
lanes. The required workflow uses that regression path. PostgREST12 and16 bind
error wording is handled explicitly; no broad crash retry. Final-head collision
proof **PASS locally across all five native lanes**; final-head CI outcome is
recorded in the publication receipt.
