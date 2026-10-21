# P4 native accounting / model policy — separate authorization required

**Design only. No migration, live store/resolver/endpoint or native test receipt.**
The offline fixture implements a serialized in-memory contract so the adapter
can be tested. It cannot authorize real concurrent transactions or survive a
process restart. Production must not use it or recreate its counters per run.

## Minimal persistence / integration proposal

1. Extend the existing *planned* versioned `pilot_workspace_policy` document
   from #122, not agent display settings or another model settings table. It
   currently has no implemented durable store in this stack. Add model policy
   version, exact allowed request/response model IDs, task/schema purpose,
   validated credential binding, operator/account validation status, data-sharing
   approval, enabled state, token and attempt/USD caps. Default disabled. Scope
   and client identity are immutable; policy version updates cannot rewrite old
   task snapshots. Trusted operators only; authenticated users cannot self-enable.
2. Future authorized selection endpoint authenticates real users using existing
   requestAuth, then P1 current membership/enrollment/Brain identity. Validate the
   explicit model/credential/purpose against the current server policy **before**
   copying the selection into an existing/new approved draft task snapshot.
   Reuse P1 HMAC binding over the entire immutable payload; no separate model
   signature or client-supplied actor/permission claims. No task is created here.
3. Native reservation must be part of the existing financial admission/ledger
   authority, keyed to the real task, workspace/client, original actor, binding
   hash and policy version/hash. Reuse existing model ledger/cost structures;
   add only missing scoped snapshot/reservation fields or one explicitly reviewed
   reservation relation where the current schema cannot express pending holds.
   Do not use `recordModelCall`'s best-effort insert/finalize as proof of commit.
4. Atomically lock/revalidate original membership, enrollment, task snapshot and
   existing budget/counter; include workspace-period settled spend AND outstanding
   reservations, the authorized task/run attempt count and combined/provider
   ceilings. Sum existing spend, not a fresh P4-only allowance. Consume at most
   one admitted probe per signed task; never reset four runtime attempts on
   retry, worker restart, client switch or a changed namespace. No A7 wiring.
5. Persist started receipt before dispatch. Use one native uniqueness rule per
   approved task/probe identity, with exact request/hash conflict handling.
   No transaction success without a real scoped task linkage. After response,
   atomically write exactly one detailed receipt and the existing model ledger
   projection, reconcile the held amount, and mark the attempt terminal. Include
   requested/actual model/provider, HTTP/request/response IDs, transport-dispatched
   flag, completion/failure, token counts, estimated cost/source and latency.
   No key, secret ref, raw prompt or client content in accounting metadata.
6. Missing/partial/invalid usage, timeout, body-read failure, accounting failure
   or a process crash leaves conservative reservation pending. A recovery job
   may reconcile a verified receipt but may NOT replay the provider request.
   Cancellation does not refund a possibly billed call. Known provider usage
   beyond reservation is recorded as an overrun and freezes further admission;
   it must not be hidden by refunding the excess or called free.
7. Make row/client/task/credential/actor ownership immutable with native composite
   constraints and server-owned write boundaries. Reject shared-member A→B
   reassignment, cross-workspace parents, direct API policy/receipt forgery and
   changing the original task model during execution/resume. Native membership
   and legacy-executor security gates in P1/P2/P3 remain mandatory.
8. A real credential adapter must resolve only the P1-enrolled opaque reference
   for the exact workspace/client/provider/purpose; verify secret ownership and
   actual provider account permission. Do not fall back to a deployment-wide key,
   temporarily mutate process env, or expose secret references to UI. Existing
   key presence is not account acceptance or data-sharing consent.

No SQL installation is proposed as part of this PR. A separately approved schema
PR must turn these contracts into reviewable DDL/RLS/grants, an atomic transaction
and tests against a disposable native database, before adding live dependencies.

## Required native tests (not run)

Proposed file: `tests/db-contract/pilotModelPolicy.contract.test.ts`, with
concurrency cases in a sibling suite. Use synthetic A/B, overlapping Apollo IDs,
A-only/B-only/shared admin/nonmember; real local Postgres + Auth/PostgREST and two
connections. No production/hosted bootstrap or customer-data copy.

| Case | Required native result |
| --- | --- |
| Policy / membership writes | Authenticated caller cannot self-enroll, elevate role, enable a provider, change consent/caps, replace credential reference or forge a signed task/actor. |
| Direct SQL/API isolation | A-only user cannot read/write B model policies, snapshots, attempts/usage/receipts/keys through tables, RPCs, views or exposed APIs. Shared user can explicitly select B but cannot reassign an existing A task/receipt. |
| Credential owner / task FK | Task A + policy/credential/client/task parent B fails natively, including service-role inserts outside the approved adapter. Missing or mismatched policy versions reject. |
| Two simultaneous dispatches | Both processes race same task: one durable admission/transport maximum, one terminal receipt; second fails before dispatch. No new counter on worker restart. |
| Workspace/run concurrency | Two tasks race the last budget/attempt allowance; pending reservations count. Four runtime attempts cannot become five, $0.05 model/$0.20 provider/$0.25 combined cannot be supplemented by a new P4 namespace. |
| Crash boundaries | Crash after reserve, after request dispatch, during response/body read, before/after ledger projection or settlement: reservation/receipt is durable, output withheld as needed; resume never silently replays. |
| Ledger failure | INSERT/finalize/commit failure cannot be swallowed as successful settlement. Exactly-one receipt + valid task-linked ledger projection or transactional rollback/pending hold. |
| Usage semantics | Success, refusal, length/filter/tool/missing termination, malformed/empty JSON, HTTP429/5xx, timeout, unpriced/partial/invalid usage all retained once; rejected internal guard invocations are not billed attempts. |
| Revocation / policy race | Change membership, role, Brain/client identity, policy, credential, original actor or task selection between reads/admission/dispatch/release. Demonstrate approved lock/linearization semantics and fail closed when change is observed. |
| Cancellation | Before admission: no attempt; after reservation: hold without provider if undispatched; after dispatch: preserve usage/pending cost; no automatic retry/refund. |
| Alias / transport identity | Captured actual model/endpoint/key matches approved policy and exact allowed response identity; substitution/unknown snapshot refuses output. No Anthropic/Gemini/alternate OpenAI fallback. |
| Recovery | Reconcile verified existing receipt idempotently; cannot create another transport attempt, duplicate ledger charge or reset scope. A pending unknown attempt blocks the next task if shared budget exposure is exhausted. |
| Legacy executor | No run-agent/generic/Discovery/approval/resume/queue/scheduler route may treat pilot display settings or an unsigned payload as execution authorization. |
| Deployment permission | Unapproved policy/adapter/model is unavailable regardless of UI state or env key; enabled live mode requires separate explicit rollout authorization and receipts. |

Native tests must inspect actual policies/grants/FKs and schema drift, not just
assert application query filters. Best-effort telemetry, green mocks and the
selected existing CI database-contract shards do not satisfy this acceptance.
