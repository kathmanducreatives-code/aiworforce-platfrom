# Phase 1 owned access corrections

2026-10-23. Branch `codex/nosh-phase1-access-fixes`, stacked on #155
`103f708a9f865df667b65ad64b662c6ddf435c2a`. **Overall Phase 1 FAIL / partially
remediated. Phase 2 not started; P1–P8 disabled; A7 NO-GO.** This receipt supplements,
not rewrites, #155's historical failing evidence. The publication PR contains the
exact reviewed head and CI links.

## Corrections and boundaries

| Surface | Actual correction | Native outcome |
| --- | --- | --- |
| Bound `public.tasks` SELECT | Restrictive authenticated predicate ANDed with existing permissions; privileged boolean existence lookup sees foreign bindings, preventing invisible-binding fallback | Original owner/admin/session succeeds; editor/viewer/revoked/foreign denied |
| Task PATCH/DELETE/INSERT | Browser writes cannot mutate registered task images, remove pilot markers, forge pilot records or turn ordinary records into pilot state | Native DB state unchanged; nonpilot owner/service updates still succeed |
| Enrolled pilot Brain | Authenticated reads require original native task/session authority. Trigger freezes raw INSERT/UPDATE/DELETE by every app role, including `service_role`; checks both old and new workspace | Viewer sees no enrolled Brain; owner/viewer/service raw writes and relocation denied; nonpilot owner/service updates succeed |
| P1/P2/P3 exposed APIs | Existing store always wrapped, including injected stores. Narrow RPC checks original native binding/session/role/client/version before and after privileged reads. P1 HMAC and resource ownership checks still required | Actual GoTrue handler: original/refresh/bound-service 200; foreign/new-session/demoted/service-demoted/service-revoked 403; logged-out user 401 |
| Failure handling | False attestation 403; missing/unavailable/invalid RPC 503; cross-workspace store access refused; no cached authorization or retry loop | Nine offline adapter tests; no provider/model calls |
| Rollback | Empty-only additive rollback, preserving original policies; refuses populated identity | Empty rollback/reapply and populated refusal tested on native DB |

SQL is **held**, never applied to a hosted target. It depends on #151's held native
identity foundation. No shared client schema, Brain writer, qualification,
executor or financial ledger implementation changed. This is containment, not a
new authorization engine, Brain writer or task lifecycle implementation.

**Deliberate fail-closed limitations:** all raw enrolled Brain writes (even owners)
are frozen until the canonical client-aware writer exists. A new task without a
trusted native registration cannot prepare; no registration endpoint was added.
Current `ready`/whole-row fence is retained. Only current original task actor and
session can access pilot state; workspace admin status alone cannot inherit a
colleague's task. Refresh of that session works; new-login delegation does not.
The one-client-per-workspace constraint remains until the agreed shared client
parent/Brain/permissions migration exists. Do not enable this stack as a customer
workflow or remove uniqueness to simulate multi-client support.

## Reproduction and test receipts

All databases and credentials generated locally; PostgreSQL 17.6, local PostgREST
16.4, actual GoTrue v2.197.0 pinned image. CI pins PostgREST 12.2.3 and Deno 2.8.2. The official GHCR GoTrue mirror
uses the identical OCI index and amd64/arm64 digests; ECR download returned
`toomanyrequests: Data limit exceeded` in the first CI run. No Auth test was skipped.
No hosted URL/customer data/paid provider is used. The baseline is the owned stack;
"integrated" adds only the exact unchanged #159 membership SQL, not all open PRs.

```sh
# Obtain reviewed owner source once (setup, not test execution):
git fetch origin fix/workspace-membership-lockdown
git show 572dca5c8d9c7f121731456801a035cfb6186b1e:supabase/migrations/20261022120000_close_workspace_self_join.sql > /tmp/outpost-membership-159.sql
# Runner refuses any different content (SHA-256 below).
OUTPOST_NATIVE_MEMBERSHIP_SQL=/tmp/outpost-membership-159.sql tests/outpost-native/run.sh
OUTPOST_NATIVE_AUTH=1 tests/outpost-native/run.sh
OUTPOST_NATIVE_MEMBERSHIP_SQL=/tmp/outpost-membership-159.sql OUTPOST_NATIVE_CONTEXT_AUDIT=1 tests/outpost-native/run.sh
OUTPOST_NATIVE_MEMBERSHIP_SQL=/tmp/outpost-membership-159.sql OUTPOST_NATIVE_SURFACE_AUDIT=1 tests/outpost-native/run.sh
# Expected nonzero: shared nonpilot viewer Brain mutation remains.
OUTPOST_NATIVE_OMIT_TASK_READ_GUARD=1 tests/outpost-native/run.sh
OUTPOST_NATIVE_OMIT_OWNER_GUARD=1 tests/outpost-native/run.sh
# Expected nonzero: named security tests must catch each removed guard.
```

| Test | Result | Interpretation |
| --- | --- | --- |
| Integrated identity/API/rollback | 68 passed / 0 failed | 46 original identity tests + 22 API/rollback/provisioning controls; no ignored tests in integrated normal run |
| Actual GoTrue private predicates | 5 passed / 0 failed | Login, refresh, logout, second login, timeout/demotion |
| Actual `handlePilotContext` | PASS | Real Auth, PostgREST, P1 store and HMAC; only gateway URL routing replaced |
| Public task audit | PASS | Owner positive, viewer zero public/private rows |
| Public task SELECT guard mutant | Named editor/viewer and forged-membership task-read tests fail | Rollback-reapply omitted only in mutant to avoid reinstalling missing policy |
| Original ownership guard mutant | Both original restoration and concurrent parent mutation tests fail | Not a readiness pass |
| Integrated surface audit | **FAIL** | #159 denies self-join; enrolled pilot writes denied; **nonpilot viewer Brain PATCH returns 204 and changes row** |
| Edge suite | 9,203 passed / 0 failed | Includes nine new native-adapter failure/revocation/scope tests; external native RPC mocked here only |
| Offline Replay Lab | 270 passed / 0 failed, one documented display gap | Harness verdict is not authorization for A7 or a live smoke |
| Infrastructure/scanner | 196 passed / 0 failed | #155 qualified-relation scanner preserved, no weakened checks |
| Frontend | 722 Deno + 5 Node passed / 0 failed | No UI security claims inferred |
| Type/build/lint | Edge/worker type check, frontend type/lint ratchets and build pass | Existing debt not raised; generated MCP build output discarded |

CI makes public pilot-task and actual session-handler acceptance **required**.
Integrated broad-surface audit remains an explicit known shared-role failure,
with its log retained. It is not silently treated as customer acceptance.

## #159 and the production hotfix

Owner PR [#159](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/159)
head `572dca5c8d9c7f121731456801a035cfb6186b1e` supplies the exact membership fix.
SQL SHA-256: `5fb203974a2f79b8d94f3988aec8807c96fb2dae3de17486ecdd803a33970311`.
The runner accepts only that content as an optional local test dependency. CI
fetches that immutable object; this PR neither duplicates its migration nor edits
its branch. Without it, self-insert still returns 201 but cannot inherit protected
pilot task/Brain authority. With it, self-insert returns 403 and inserts zero rows;
provisioning/idempotency/own-workspace reads and nonpilot Brain edits succeed.

**Production status:** owner reports manual production and Discovery TEST SQL
Editor application on 2026-10-23, with six read-only catalog checks passing, and
warns it is not migration-history recorded and must not be rerun. This audit
reviewed that receipt, source checksum and green #159 CI. It did **not** independently
query production. GitHub deployment metadata's newest listed production commit
(2026-10-13, `edb93ff600c41876eda5a435f63d4f7dd01d2db1`) cannot prove later manual
SQL state. No hosted write/probe occurred. Optional `verify-membership-catalog.sql`
is metadata-only and unexecuted here. Obtain a target-specific current receipt
before release; never run the migration blindly because Git history lacks it.

## Precise shared-owner handoff / remaining Phase 1 gates

1. **Brain Claude / AUTH-01:** `public.company_brain` broad authenticated write
   policy and service-backed `setup-company-brain/index.ts`; canonical writer/read
   files in #147 and successors. Repro: integrated surface audit, route
   `nonpilot public.company_brain PATCH`, viewer HTTP 204, `changed=true`.
   Add role-aware canonical authorization at table and handler boundaries. Preserve
   owner/admin intended writes; define editor rights explicitly; viewer/revoked/
   foreign deny. Cover service upserts and pre-model authorization, not just browser
   PATCH. The enrolled trigger prevents persistence, not a legacy paid analysis
   call that might happen earlier. No such call was executed.
2. **Client contract:** user-selected agency workspace → isolated client accounts
   is fixed; see `CLIENT_CONTRACT.md`. Brain/backend owners must agree one native
   client parent, client-grant/role mapping and canonical versioned Brain API before
   shared DDL. Need positive two-clients-in-one-workspace native tests, constrained
   descendants, memory, credentials and destinations. This PR does not claim that
   contract is owner-approved or implemented because comments were unanswered.
3. **Backend / EXEC-01:** original signed native task registration, immutable inputs
   versus mutable lifecycle, service/worker/run-agent/orchestrate guards and actor
   revocation ordering. Existing service BYPASSRLS can still read public resources;
   authenticated restrictive policies do not authorize or contain every legacy
   service path. Adapt shared routes or deny pilot work before data/model/purchase
   effects. No duplicate executor/ledger written here.
4. **Integrated security:** install nothing yet. Need exact combined launch +
   #147/#159/owner fixes + pilot candidate, complete descendant/API/view/RPC and
   legitimate onboarding/invitation tests, client-grant concurrency and canonical
   Brain writes. Current before/after read attestation is not atomic with future
   durable mutations or revocation. Later persistence is still Phase 2, unapproved.

Coordinator comments: [Brain #147](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/147#issuecomment-6358691504),
[backend #150](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/150#issuecomment-6358691989),
[membership #159](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/159#issuecomment-6362017898).

## Security / rollout review

Helpers use fixed empty search paths, qualified references, explicit EXECUTE
revocations and boolean-only attestation; caller supplies no trusted role/session.
Original native predicates check live Auth session and exact stored task image;
P1 validates its existing signature/resource ownership separately. Nonpilot
permissive policies are not rewritten. Trigger uses actual PostgREST SQL role,
including service, with old/new workspace checks. Trusted direct SQL/admin and
service read privileges remain privileged and are not presented as client ACLs.

Before hosted approval: lock/scan enrollment and Brain state; review migration
order with #159 already-installed receipt; apply only held patches explicitly
approved for a named target; keep flags off. Empty-only rollback is in
`native-access-rollback.sql`; populated rollback must retain security guards and
history. No CASCADE/destructive identity rollback or reopening membership hole.

Performance: each guarded privileged store operation adds two small native RPC
checks (plus each requested task ancestor), using existing bounded resource lists.
No model attempts, provider calls, retries, spending caps, qualification behavior
or automatic sends changed. Authorization is request-scoped and intentionally
uncached. Native repeated checks are containment, not future transactional writes.
