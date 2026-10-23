# Phase 1 security receipt — PARTIAL / customer acceptance FAIL

Date: 2026-10-23. Branch `codex/nosh-phase1-security`, based on #152
`32097823562b5282972047f86beb0b826e4e663c`. No shared policy/schema, Brain,
qualification, executor or ledger implementation changes. P1–P8 disabled; A7 NO-GO.

**Independent CI scanner correction and stronger native/session proof are
implemented. Full Phase 1 is NOT complete.** Public task read/write, Brain write,
foreign membership self-enrollment and application original-session enforcement
remain open. Shared changes require the owner contracts explicitly requested by
the user and MASTER_PLAN; no incoming owner agreement was found at publication.
The original-session/private predicate is not wired into the actual pilot handler.
Do not advance to Phase 2 or call passing foundation CI customer readiness.

## Behavior changed in this draft

- RLS source scanning recognizes schema-qualified/quoted relations and preserves
  schema/case identity. Public RLS cannot satisfy a missing private policy (or
  vice versa). Public, private and held SQL all remain in scope; no allow-list,
  dropped archive check or permissive/anonymous-policy check weakening.
- Nine parser adversaries cover qualified private tables, missing public/private
  ENABLE, same-named cross-schema objects, quoted/escaped names, unqualified
  public/ONLY/IF EXISTS, disabled/FORCE-only RLS, declaration forms and a comment
  after a relation. The previously failing repository coverage assertion passes.
- Native role tests add positive original-actor admin access and denial for editor,
  member and mismatched-case role names; existing nonpilot, service and ownership
  controls remain. All run against actual PostgreSQL/PostgREST.
- Optional real GoTrue v2.197.0 lane uses its own catalog migrations and issued
  sessions/JWTs, not synthetic auth.sessions. Tests verify native original-session
  read, refresh, actual logout/stale token, live demotion and not_after expiry.
  Four behavioral cases plus cleanup pass. New sign-in correctly cannot inherit
  the original **private** binding. The actual handler audit separately fails.
- Native catalog/surface and actual handler audits preserve deterministic red
  security reproductions. Owner-positive controls prevent unavailable or deny-all
  APIs from being mislabeled fixed. Known blocked audits remain visible nonblocking
  foundation-workflow steps, as the existing public audit did; they are mandatory
  Phase 1/customer release failures, not waived security tests. They must become
  required green acceptance after coordinated fixes.

## Verified defects and exact roots

| ID | Expected | Actual native/app behavior | Root / affected path |
| --- | --- | --- | --- |
| SEC-01 | viewer cannot read bound pilot task | public.tasks GET HTTP 200 / one row; private bindings zero rows | baseline `tasks_workspace_member_access` FOR ALL calls membership-only `has_workspace_access`; private RLS does not narrow public task policies |
| SEC-01 write | viewer cannot mutate signed task | PATCH HTTP 204; native SQL confirms payload changed | same public ALL policy and grants; owner trigger only freezes workspace/user reassignment, not payload edits |
| SEC-02 | viewer cannot replace authoritative Brain | PATCH HTTP 204; native SQL confirms synthetic profile replaced | baseline `company_brain_member_update` checks only workspace membership; #147 normalizes context but does not supply this role/client contract |
| SEC-05 | uninvited user cannot join foreign workspace as owner | initial B tasks 0; membership POST HTTP 201; same JWT then reads B task | baseline `members_self_insert` checks only user_id=auth.uid(); role defaults to owner; caller supplies foreign workspace and owner role; every membership-based reader is downstream exposure |
| SEC-03/04 | new session cannot resume task bound to original session | real handlePilotContext original=200, foreign=403, new login same actor resume=200; original token after GoTrue logout=401 | `pilotContext.ts`→`PilotAccess.forTask` uses real Auth then service-backed P1 query store; checks actor/HMAC/workspace but does not consume native original-session binding. Native private RLS independently denies new session. |
| CI-01 fixed here | scanner matches each schema/table's own RLS | before: coverage test fails on phantom table `outpost_private`; after: coverage/parser and full infra pass | old regex recognized optional public prefix only, truncated private-qualified name at dot; new relation keys preserve both identifiers |
| DEC-01/AUTH-01 | two isolated client accounts under one agency workspace | not implemented; existing one-client constraint and workspace-only Brain remain | cross-cutting client parent/role/Brain/memory/API contract must precede changing native uniqueness or selection logic |

Exact baseline policies: `supabase/migrations-held/20260816120000_baseline_schema.sql`
`has_workspace_access`, `tasks_workspace_member_access`,
`company_brain_member_update`, `members_self_insert`. These defects are reproduced
in fresh local databases built from the repository; no deployed exploit or target
catalog access is claimed. A schema proposal or role-aware frontend is not a fix.

## Reproduction and evidence

```sh
# Owned fresh loopback PostgreSQL; real PostgREST; all synthetic data.
tests/outpost-native/run.sh
OUTPOST_NATIVE_AUTH=1 tests/outpost-native/run.sh

# Current expected exit 1: actual open security defects, not mocked behavior.
OUTPOST_NATIVE_PUBLIC_AUDIT=1 tests/outpost-native/run.sh
OUTPOST_NATIVE_SURFACE_AUDIT=1 tests/outpost-native/run.sh
OUTPOST_NATIVE_CONTEXT_AUDIT=1 tests/outpost-native/run.sh
```

- [Native surface receipt](native-surfaces.json): 17 public relations, 45 effective
  policies, 275 grants, 17 candidate routines and two dependent security-invoker
  views; all seventeen public relations lack `client_binding_id`. Constraints and
  relevant scope columns included. Routine source matching identifies candidates,
  not complete dynamic-SQL/API reachability.
- [Actual handler/session receipt](context-session.json): actual GoTrue, production
  `handlePilotContext`/P1 store/HMAC, real native HTTP/SQL. Only local gateway URL
  routing is adapted; no fabricated authentication or database response.
- [Proposed client contract](CLIENT_CONTRACT.md): accepted product direction and
  exact shared ownership/API/DDL prerequisites. No shared DDL applied here.

## Validation

| Suite | Result | Scope |
| --- | --- | --- |
| scanner before | 8 passed / 1 failed | original assertion reproduced |
| scanner + parser after | 18 passed / 0 failed | nine original coverage/security checks plus nine parser adversaries |
| complete infrastructure | 196 passed / 0 failed | actual `npm run test:deploy-safety`; no missing-RLS allow-list/exclusion |
| edge regression | 9,194 passed / 0 failed | `npm run test:edge`; no qualification edits |
| native identity + role additions | 46 passed / 0 failed | actual PostgreSQL 17.6 + PostgREST 16.4 |
| actual GoTrue private predicate | 5 passed / 0 failed | four behaviors plus harness cleanup; real issued sessions |
| ownership mutant | two required target failures | deliberate removal of owner guard; baseline suite ignores none |
| type check | PASS | Deno check with nodeModulesDir=none on new scanner/native sources |
| lint/shell/whitespace | PASS | new/changed test helpers; bash syntax; diff check |
| public read/write/membership/Brain | FAIL | three native audit commands exit 1; not customer ready |
| actual handler original-session resume | FAIL | new session returns 200 despite private predicate denial |
| multi-client positive same workspace | BLOCKED | shared contract/schema not agreed/implemented; not substituted with negative enrollment test |
| real complete browser/client security | NOT TESTED / BLOCKED | native/client contracts and later integration prerequisites |

GitHub CI links/exact candidate head are in the draft PR receipt. A green ordinary
CI or foundation job does not overrule the failed readiness audits. Existing #151
and #152 remain historical red heads; this successor carries the scanner fix
without rewriting their branches.

## Coordination / why shared fixes are not claimed

User explicitly requires coordination before shared schema changes; MASTER_PLAN
requires accepted AUTH-01/EXEC-01 handoff before shared files. Requests and exact
red-to-green contracts were posted before implementation:

- [Brain contract request](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/147#issuecomment-6357401702)
  and [backend request](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/150#issuecomment-6357402131).
- [Native write/escalation findings](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/147#issuecomment-6357465613)
  and [backend findings](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/150#issuecomment-6357465931).
- [Actual handler session gap](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/147#issuecomment-6357559381)
  and [backend gap](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/150#issuecomment-6357559673).

Only our outgoing comments were present at the last review. Silence is not a
contract. Do not install a standalone public task policy and claim safety while
membership self-enrollment, Brain writes, service paths and multi-client context
remain unprotected. Do not globally remove legitimate onboarding/invitation access
without the permission owner's native positive controls.

## Security, migration and compatibility review

No active/held application migration changed. The #151 held SQL is unchanged;
only the isolated GoTrue test lane applies GoTrue's own migrations to its fresh
container, and the native foundation runner applies existing repository SQL there.
No hosted/project URL is accepted. Cleanup targets only generated owned containers,
network, process and temp log; existing Supabase stacks are untouched.

GoTrue is pinned by multi-architecture OCI digest. Loopback host ports, auto-confirm,
no-op mail and disabled phone prevent any external user workflow; no provider/model
client or paid credential is loaded. Its disposable admin migration connection
is not a production privilege proof. Docker bridge is not outbound firewalling;
full egress containment remains a later combined-integration requirement.

Existing T01, Q1–Q4, Brain, worker/admission and spending files are untouched.
No model calls/repairs/retries, schema auto-install, new ACL/Brain/ledger or feature
switch activation. Four attempts and $0.05/$0.20/$0.25 ceilings remain unchanged.

Rollback for this test/scanner slice is a code revert; no data migration to undo.
Future shared policy/client schema fixes need exact held SQL/preflight/role review,
empty rollback and populated-history containment plan under CLIENT_CONTRACT.

## Next work and stop boundary

Phase 1 remains PARTIAL/BLOCKED, overall FAIL. Complete AUTH-01/EXEC-01 owner
agreement, then the minimal public policy/membership/Brain/session adapter and
client ownership changes with native red-to-green and legitimate workflow tests.
All audits must pass and become required release gates before Phase 1 closes.
Phase 2 persistence is not started or approved. No merge/deploy/hosted writes,
real imports/paid calls/activation/outreach/A7 were performed or authorized.
