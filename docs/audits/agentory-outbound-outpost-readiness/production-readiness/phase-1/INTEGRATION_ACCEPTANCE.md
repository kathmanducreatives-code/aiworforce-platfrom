# Phase 1 integration acceptance contract

2026-10-24. **Phase1 FAIL; Phase2 unstarted; A7 NO-GO; P1–P8 disabled.**
This prepares tests and owner delivery requirements. AVAILABLE means executable
coverage exists, not that the complete acceptance condition passes. BLOCKED tests
are not replaced by unit fixtures or another workspace. No shared implementation,
schema, migrations, model routing, qualification or ledger is changed.

## Fixed candidate and evidence rules

Record exact pilot, Brain, Backend, workspace-selection and migration SHAs, SQL
checksums, assembled source-tree identity, commands, test counts and raw receipts.
Use the real owner callbacks/stores and native PostgreSQL/PostgREST/GoTrue. Mock
external provider/model results only. Reject patch conflicts; never overwrite an
owner file or silently use a moving branch. Every negative has a distinct positive
control that reaches the intended writer/execution stage. HTTP200 alone is not
success;403 alone does not prove zero effects. Keep failed and blocked outcomes
visible even when an audit-integrity or CI job succeeds.

No owner fix has arrived at this continuation's refresh: Brain #169 remains
`60be0471`, Backend #150 `be625f46`. #171/#172 remain unchanged. The next Brain
verification must use #172's same23 assertions against the delivered exact head,
require23/0 and preserve all17 controls. Do not manually rerun the unchanged six
failures as a substitute for incoming-fix verification.

## Required native invariant matrix

| ID / owner | Deterministic setup and attack | Actual entry / required evidence | Coverage state |
| --- | --- | --- | --- |
| WS-01 / Codex | A-only, B-only, shared owner/admin, editor, viewer, revoked user and anonymous against two workspaces | `api-security.test.ts`, public tables/private RPCs and actual pilot handlers; allowed row/write controls, foreign zero rows or denial; native SQL unchanged | AVAILABLE current workspace coverage; client scope separate |
| CL-01 / Brain→Codex | Two clients in ONE agency workspace; repeat external Apollo/company/contact IDs; request B internal IDs using A scope | Canonical client API/RLS plus real P1 adapters; correct A data, no B context or partial payload. Preserve global internal PKs; do not alter them to fabricate duplicate fixtures | BLOCKED canonical schema/API |
| OWN-01 / Backend + Codex | Unreadable account B referenced from contact A; INSERT and PATCH, role and service variants; no-account/deletion/nonpilot controls | `resource-parent-audit.ts` currently proves raw201/mismatched SQL and P1 prepare404/zero bindings; correction requires raw denial and no mismatched row. Extend PATCH/service/descendants on actual owner patch | AVAILABLE INSERT/P1 reproduction; FAIL; remaining variants pending |
| GRANT-01 / Brain→Codex | Every role including agency owner/admin lacks B grant; audited self-grant; revoke and regrant; permission reduction then restoration | Real grant writer/read policies; derive actor from verified session; old task/approval generation never revives after regrant. Compare stored grant identity/revision, not Brain content version | BLOCKED final A7/API |
| BRAIN-01 / Brain→Codex | Distinct A/B ICP, voice, exclusions and version; missing/null/wrong client and agency fallback attempts; stale CAS | Canonical Brain API; authorized client read/edit succeeds; B never appears in A; no client task falls back to agency/first/latest Brain; native CAS and persisted context evidence | BLOCKED client Brain API |
| AUTH-REMOVE / Brain→Codex | Commit membership removal after initial check, before protected write | #172 actual setup/save_basics and generate/update callbacks; require401/403, unchanged profile and positive writer controls | AVAILABLE; known FAIL |
| AUTH-DEMOTE / Brain→Codex | Same ordering, downgrade owner→viewer before writer proceeds | Same23 assertions; current role governs final write; no stale role/JWT authority | AVAILABLE; known FAIL |
| AUTH-LOGOUT / Brain→Codex | Real GoTrue logout commits after initial check; verify original auth.sessions row absent | Same23 assertions; stale unexpired JWT cannot authorize the final write | AVAILABLE; known FAIL |
| TASK-01 / Codex | Forged scope/signature, wrong actor/client/resource, new login, same-session refresh, invalid/expired session; failed preparation | #171 real `handlePilotTaskRegistration`, original signer and native transaction; no signature/binding on refusal, exact authorized prepare/replay; no new authorization engine | AVAILABLE #171 native/real Auth |
| LIFE-01 / Codex + Backend | Mutate owner/input, add/strip markers, legacy status claim/fenced output, terminal cancel/reopen | #171 native triggers + actual claimContinuationViaRpc/fencedTaskUpdate; original inputs immutable, cancellation terminal; legitimate nonpilot control | AVAILABLE containment; executable lifecycle owner contract pending |
| EXEC-01 / Backend→Codex | Missing/forged scope, wrong/revoked/new session; remove request marker while stored task remains pilot | Actual handleRunAgent, handleOrchestrate, createLeadMissionRunner.run and worker callbacks; deny before protected context/model/purchase/queue/dispatch/output; service credential not user/client authority | BLOCKED owner guards/entry contract |
| EFFECT-01 / Backend→Codex | Unauthorized entry; swallowed provider error/fallback; detached work after response, cancellation and retry | Actual transport/purchase/dispatch spies AND native ledger/queue/output diffs. Zero protected effects at unauthorized entry. Reachable authorized nonpilot model/provider mock is mandatory; no paid calls | Fence tool AVAILABLE; actual route acceptance BLOCKED |
| RETRY-01 / Codex + Backend | Lost prepare/cancel response, abort/rollback, concurrent task requests; resume after client switch/logout/regrant | #171 original-session/replay native suites; original task/client/input/grant generation retained; no namespace, authorization repair or budget reset. Add actual worker/resume routes on delivery | AVAILABLE task coverage; grant/worker extension BLOCKED |
| LOCK-01 / Brain/Backend→Codex | Two native connections and explicit barriers, both permission-revoke/write orderings | Revocation committed before authorization/write must deny. If writer holds permission lock first, verify safe linearization and later denial. Use bounded locks/events, not arbitrary sleeps or timeout-as-PASS | Existing task locks AVAILABLE; shared writer/grant locks BLOCKED |

## Ordering and effects assertions

1. **Unauthorized at entry:** before any protected context access, model transport,
   purchase/queue/dispatch or output write; assert exact zero invocation/row deltas.
   Minimal identity/binding authorization lookups are separate from protected
   Company Brain, research and memory reads. Do not authorize using request labels.
2. **Authorization lost in flight:** block subsequent protected work and final
   customer-data writes. Preserve accounting for an already-started authorized
   mocked operation; do not refund/erase its cost or revive its task on retry.
   Ledger settlement can be necessary after revocation and is not a new purchase.
3. **Concurrent revocation:** force commit order with two connections/barriers.
   A revoke request waiting behind a legitimate locked writer is different from
   revocation already committed before the writer. Record the linearization.
4. **Retry/resume:** original scope, task, signed inputs and policy/packet IDs;
   same-session refresh allowed, new login denied absent explicit delegation.
   Client switch/regrant never silently resets operation keys or consumed attempts.
5. **Budgets:** original four-runtime-attempt cap and $0.05 model/$0.20 provider/
   $0.25 combined ceiling unchanged; P4's stricter signed-task policy retained.
   Test with mocks and native receipts only. No additional repairs/rebuys.

## Test-only effect fence

`tests/outpost-native/lib/nativeEffectFence.ts` accepts only explicitly configured
disposable loopback HTTP origins/ports. It blocks and records all other origins,
including unknown providers and unrelated local ports. Host classifications are
not used to choose a provider or confer permission. Redirects are errors. Already
aborted requests do not reach the delegate; closing the scope aborts pending HTTP
and rejects late requests. Events are immutable and contain only kind, method
and origin—never headers, bodies, query strings or paths.

Eight conformance tests prove these mechanics, including caught errors preserving
attempt evidence. The real resource-parent/P1 test now records its actual local
Auth/REST requests and asserts zero external/late/invalid attempts. It still uses
real native responses and preserves OWN-01's FAIL. A fence is a test safety tool,
not production authorization or proof that every legacy route is protected.
Install before constructing/invoking the actual client/handler, retain Deno's
loopback-only network permission, and assert native side effects independently.
Aborting HTTP does not prove a database rollback; lost-response/idempotency must
be tested through the actual persistence code. Explicit provider/model mocks must
have separate invocation counters, including swallowed attempts; they cannot be
hidden behind a local-only HTTP count. Authorized positive controls may use those
mock transports, while all unmocked nonlocal traffic stays blocked. Zero HTTP
attempts alone does not establish zero model/purchase/queue effects.

## Incoming patch execution order

1. Obtain Brain/Backend exact SHAs and reviewed migration/contract requirements.
   No fixture-only client tables and no shared DDL on silence.
2. Materialize the owner candidate without branch edits; pin checksums and reject
   conflicts. Bootstrap only a fresh disposable database.
3. Run unchanged #17223 assertions; require23/0. Run OWN-01 INSERT/PATCH/service and
   compatibility cases and schema gate; require actual parent denial/no bad rows.
4. Execute same-workspace client/grant/Brain matrix using actual delivered APIs;
   original-session/retry/lock and every legacy entry/effect case.
5. Run #171 regressions and full applicable CI; preserve raw failing/unrun cases.
   Complete native/browser release proof belongs to its approved phase; no feature
   activation, hosted migration or Phase2 progression follows from this contract.

Until every mandatory invariant has native evidence at the same candidate,
Phase1 remains FAIL. No merge, deploy, hosted write, customer operation, paid call
or external dispatch is authorized by this preparation work.
