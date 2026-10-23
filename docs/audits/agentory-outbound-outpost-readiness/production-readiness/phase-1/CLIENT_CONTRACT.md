# AUTH-01 / EXEC-01 client boundary contract — proposed for owner agreement

**Target selected by user: one agency workspace, multiple isolated client accounts,
with separate Company Brain per client. Contract implementation blocked pending
Company Brain/backend coordination. P1–P8 disabled. Customer readiness FAIL.**

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

No public restrictive policy or replacement membership/Brain schema is applied
here. Explicit owner contract is required before that shared implementation.

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
