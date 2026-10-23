# AUTH-01 / EXEC-01 client boundary contract — A1–A7 agreed with A7 amendment, DDL pending

**Target selected by user: one agency workspace, multiple isolated client accounts,
with separate Company Brain per client. Canonical parent/grant/Brain shape agreed with Brain Claude; grant-generation
representation and lock-order confirmation/delivery still pending. P1–P8 disabled. Customer readiness FAIL.**

This resolves the product direction in DEC-01; the remaining issue is the shared
schema/API contract, not a request for the user to repeat the tenancy decision.
The old one-client/workspace tests remain honest historical negative controls.
They do not prove the new required positive workflow. No shared DDL, Brain,
executor, ledger or qualification implementation is changed by this proposal.

## Proposed domain and authorization contract

1. Agency workspace remains the existing `workspaces` parent. Client accounts
   have immutable client IDs and same-workspace composite parent keys. Reuse one
   agreed client-domain store; do not create parallel client registries in Brain,
   pilot and Discovery. The existing private pilot enrollment remains disabled
   until its owner-agreed migration supports this relation.
2. Reuse existing workspace identities/roles; add the agreed representation of
   explicit client access as a scope of those permissions, not new role names or
   a second ACL engine. A workspace role alone must not authorize a different
   client's Brain or records. Owner/admin can manage the agency only under the
   agreed management policy; task contents still require client access and original
   task actor/session unless an explicit audited delegation contract is approved.
3. Company Brain Claude owns the single canonical client-aware read/write/version
   API and storage change. Agency-level Brain/onboarding may remain distinct, but
   a client task must supply `(workspace_id, client_id, expected_version)` and get
   exactly that client Brain. No fallback to workspace Brain, first membership,
   latest saved profile or another client. Missing/ambiguous client context refuses.
   Approval/version changes use CAS and invalidate uncommitted preparation.
4. Memory, saved outputs, conversations/messages, research, evidence, imported rows
   and task outputs carry native same-client ownership. Existing ID-only foreign
   keys and workspace predicates are insufficient. Every child joins through a
   constrained same-workspace/client parent; externally shared Apollo IDs never
   determine scope. Legacy rows with no attributable client are agency/unassigned
   and inaccessible to client tasks until explicitly classified by an audited
   owner-approved procedure; no automatic client backfill.
5. Task identity is the existing task plus immutable workspace/client, original
   actor/session, signed input/resource/policy hashes and frozen packet identity.
   Separate allowed lifecycle/bookkeeping versions from immutable inputs. Do not
   silently remove #151's whole-row fence without an agreed replacement that
   prevents A→B→A restoration and stale approval revival.
6. Credentials/model policy/manual destinations are versioned under the same
   native client parent. Client A cannot resolve B's key or download B's artifact.
   Keep P1 HMAC/P4 model policy authoritative and request-scoped; no global key,
   provider or destination fallback, no namespace/counter reset on client switch.
7. Current user session, workspace role and explicit client access must be checked
   at read and transaction time. Agree deterministic locks/authorization epoch for
   revocation versus native commits. Refresh of the same GoTrue session may retain
   its original task; a new session cannot inherit it implicitly. Revoked/expired
   sessions or removed client grants deny export even after local UI approval.
8. All legacy direct/service/worker routes either consume the exact signed scoped
   contract before any data/model/purchase/write effect or refuse pilot/client
   execution. Shared service credentials are not client authorization. This is an
   existing-engine adapter/guard, not a new execution engine or financial ledger.

## Exact change areas and proposed ownership

| Area | Existing files / native objects | Owner action required |
| --- | --- | --- |
| Canonical client Brain | `companyBrainUpdate.ts`, `companyBrainContext.ts`, `normalizeCompanyBrain.ts`, `setup-company-brain/index.ts`, `src/hooks/useCompanyBrain.ts`, onboarding/Auth routes; `public.company_brain` | Brain owner chooses exact child relation/version API and compatible agency onboarding behavior |
| Roles/membership | `public.workspace_members`, `has_workspace_access`, role-aware Brain policies | Brain owner closes arbitrary self-enrollment without breaking legitimate workspace creation/invitation; agree client scope of existing roles |
| Native pilot identity | `outpost_private.clients/task_bindings`, held #151 migration, `pilotPolicy.ts`, `pilotScope.ts`, `pilotScopeStore.ts` | Codex adapter/constraint successor only after agreed shared parent/permissions contract |
| Browser selection/cache | `workspaceSelection.ts`, `OutpostWorkspace.tsx`, client selector | Codex changes workspace-only uniqueness/choice key to explicit workspace+client after server contract; late responses/cache still fenced |
| Task execution/lifecycle | `run-agent/index.ts`, `orchestrate/index.ts`, `worker/main.ts`, `worker/leadMissionRunner.ts`, #145/#150 and successors | Backend owner agrees immutable input/lifecycle state and all route guards; Codex supplies adversarial cases |
| Data descendants | `saved_outputs`, `outreach_drafts`, `tool_calls`, `messages`, `conversations`, `accounts`, `contacts`, `lead_candidates`, `lead_evidence`, `lead_lineages`, `task_plans`, `signals`, `approvals`, `agents` | Joint native parent/RLS/backfill inventory before scoped adapters; no bulk schema rewrite or default-client assignment |
| Shared accounting | `executionLedger.ts`, shared admission/recovery; new #153/#154 and integration branches | Backend owner, later Phase 4; no competing pilot ledger or model replay key |

Names above are repository-relative; shared backend modules are under
`supabase/functions/_shared/` unless a full handler/worker path is shown.

## Immediate public task/permission correction proposed for review

The native surface receipt verifies SELECT and PATCH on bound tasks, membership
self-insert into a foreign workspace, and Brain PATCH by a viewer. Address all
relevant permissions; task SELECT alone is not a finished security boundary.

- Add an owner-agreed narrow **restrictive** pilot task predicate ANDed with the
  existing permissive policies. Its lookup must see existence of unauthorized
  bindings without relying on the caller's private SELECT policy; otherwise
  “foreign binding invisible” could be misclassified as “nonpilot.” Avoid recursive
  public.tasks policies; privileged helper must return only a boolean, use fixed
  search_path/qualified relations and explicit EXECUTE grants/revocation.
- Bound-task SELECT requires current original actor/session/client authorization
  and immutable input/lifecycle fence. Browser INSERT/UPDATE/DELETE cannot create,
  reassign or mutate authoritative bound pilot state. Nonpilot paths retain their
  intended behavior; owner-reviewed native writer handles allowed lifecycle changes.
- Close `members_self_insert`'s arbitrary foreign-workspace/role authorization
  while preserving verified initial workspace creation and accepted invitation.
  Do not simply remove enrollment and call all workflows safely denied.
- Make Brain writers role/client aware across public table policies, Edge handlers,
  normalization and login/context reads. A UI restriction is not this fix.
- Audit views/RPCs/service paths independently. BYPASSRLS remains privileged;
  restrictive authenticated policies do not constrain a service-role executor.

Owned successor `codex/nosh-phase1-access-fixes` now implements additive **held**
pilot task restrictions and enrolled Brain read/write containment plus the P1
native API adapter; see [ACCESS_FIXES.md](ACCESS_FIXES.md). These run only against
disposable databases. The exact owner #159 membership SQL is an optional pinned
local dependency, not duplicated here. Canonical multi-client Brain/parent/role
schema is still pending explicit owner agreement; no shared client DDL changed.

## Mandatory red-to-green acceptance

Two clients in the **same** agency workspace have different Brain/voice/exclusions,
keys and destinations; external company/contact IDs may overlap. A-only, B-only,
shared permitted operator, viewer/editor/admin/owner, revoked user and anon are
all tested through tables, views, RPCs and real Edge authentication. Correct
client operations succeed; wrong/missing/ambiguous client fails before context.

Required regressions: legitimate workspace creation/invitation; nonpilot owner and
service jobs; actual GoTrue sign-in/refresh/logout/expiry; late browser replies,
shared tabs and A→B→A selection; native grant removal concurrent with commit;
wrong parent/source/credential; task reassignment/restoration; mutable task state
without scope changes; stale approval/export and zero added model calls/spending.

## Migration and rollback requirements

Before implementation: owner agreement on schema/API, catalog/data/duplicate and
legacy-owner preflight, exact held SQL, role/grant/security-definer review, lock
order and deletion/retention policy. Before hosted work: separate target-specific
approval. No removing workspace uniqueness in isolation. Never apply P3's old
`pilot_private` proposal and P8's scaffold alongside an incompatible new schema.

Local rollback tests must preserve populated identity/history and model liabilities;
disable access/writer/admission before application rollback. Empty-only rollback
may remove just the new objects. Never restore a stale permission/approval state,
CASCADE client data or refund uncertain work as a recovery shortcut.

## Historical v1 proposal boundary (superseded by A1–A7 below)

The user-selected product and interface requirements above are the fixed direction,
not another tenancy choice. `client_binding_id` denotes the client organization,
never a prospective lead/company from Apollo. Every task/data descendant must use
both workspace and that client; client access is a restriction of the existing
role system. There is no agency-Brain fallback, default client or implicit delegation.
The canonical parent/table and client-grant representation remain owner decisions;
this document does not fabricate an owner agreement from silence. Do not ship
multi-client schema or weaken current uniqueness before those decisions and their
positive native tests. #159 closes browser membership writes; it provides no new
invitation/client-grant writer. Existing provisioning remains the supported positive
control; invitations require the owner's role-checked path and native tests.

The immediate successor supplies narrower native containment and actual original-
session handler proof while those shared deliverables are pending. It does not
start Phase 2 or treat containment as the complete multi-client implementation.

## Current A1–A7 contract — 2026-10-23

Brain owner's request: [#166 A1–A7](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/166#issuecomment-6367251628).
Our reply: [#166 agreement and A7 amendment](https://github.com/kathmanducreatives-code/aiworforce-platfrom/pull/166#issuecomment-6367855590).
The product direction and agreed schema names are settled. Do not ask the user
again or treat unanswered earlier comments above as the current status.

| Item | Agreed contract / remaining exact owner action |
| --- | --- |
| A1 | Canonical `public.client_accounts`; immutable id/workspace, composite unique `(workspace_id,id)`, parent workspace RESTRICT, active/archive, no default/prospect/legacy-theming registry reuse |
| A2 | `outpost_private.clients.client_binding_id = client_accounts.id`, same-workspace composite FK; retain current uniqueness/full-row fence until separately tested successor |
| A3 | `client_access_grants`: current workspace role AND explicit active grant for every role including owner/admin; no extra scope enum in v1; operation role checks remain, Brain editor is not pilot operator |
| A4 | Owner/admin audited native grant/revoke writer; no browser DML; authenticated `granted_by`, active same-workspace client/member and live session. Self-grant permitted and audited; no task delegation/approval implied |
| A5 | Separate `client_company_brain`, same-workspace composite key, native version CAS, all writes including activation/approval bump version; no browser writes |
| A6 | One `brainScope` API, server-declared agency/client intent; a client task with null client fails, no fallback; frozen tasks pin workspace/client/Brain version |
| A7 | Final native transaction locks/rechecks membership, active client, grant and live Auth session/expiry after external/model work; consistent revoke/archive lock order. No global epoch needed if these conditions hold. Frozen consumers require immutable grant generation (or identity + monotonic revision), terminal revoke and observable permission reductions. **Owner must confirm exact representation/lock order before pilot FK successor.** |

Canonical roles are owner/admin/editor/viewer with unknown values treated as
viewer. Owner's #169 normalizes case; existing pilot/native predicates remain
strict lowercase owner/admin. Do not silently broaden them; canonical stored role
normalization and regression compatibility must be reconciled explicitly.

Brain Claude owns the canonical parent/grants/Brain DDL/API. Codex owns the pilot
binding/descendant adapters after delivery; Backend owns executable lifecycle and
all legacy service pre-effect guards. No shared schema changed here. No owner
acknowledgement of A7's final generation/lock details or delivered client DDL is
invented; same-workspace positive native tests remain BLOCKED.

Shared delivered agency fixes: #159 closes direct workspace/membership writes;
#169 closes raw Brain browser writes and adds pre-model role checks; #170 supplies
deterministic authorized workspace selection. Exact source composition and native
positive/negative results: [TASK_SECURITY.md](TASK_SECURITY.md). These do not yet
provide client grants, client-scoped descendants or the complete Brain write
transaction/revocation guarantee required above.
