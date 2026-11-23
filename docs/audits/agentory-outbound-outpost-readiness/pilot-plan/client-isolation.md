# Draft-only pilot: client-isolation boundary

**Design proposal, not implemented.** Prepared 2026-10-20 against integration `5d86703712205a04d059a39cf0d38a0621fc3ddb`. No deployment, database alteration or provider operation is authorized by this document.

## Decision

Use **one client per existing Agentory workspace**, with an explicitly selected workspace on every pilot operation. Do not put multiple clients in one Company Brain, add a second tenant engine or interpret a conversation as a client boundary. An agency user can belong to several client workspaces; membership in both never permits an operation to combine their records.

The pilot is a tightly scoped mode inside existing Leads/Workbench, using stored existing records. It is not another discovery mission, sending system or CRM. Its only output destination is a reviewed local CSV download/manual handoff. No Apollo/iGTM/Jungler API adapter is selected. Their identities, permissions and the official system of record remain conditional.

The security boundary is the **server-authorized workspace**, not a UI label, local-storage value, model instruction, arbitrary client ID or service-role bypass. One client per workspace is a provisioning/operating contract, not a claim that software can detect an authorized user deliberately pasting another client's data. Changes of client identity require a new workspace; legitimate changes to a client's Brain are versioned edits.

## Required invariants

| Boundary | Rule | Refusal / safe result |
|---|---|---|
| Selection | User explicitly selects an authorized client workspace. No first-membership fallback for pilot writes. Single-workspace accounts may preselect their only membership, but server still authorizes it | No selected/authorized scope → zero import, model, research or export operations |
| Authentication | Validate the user JWT, current membership and action permission on every request | Missing/revoked membership → 401/403 before privileged data or providers |
| Record ownership | Request workspace must match every batch, imported row, task, context snapshot, brief, review and export destination | Mixed or foreign ID set rejected atomically; never process the valid subset silently |
| Database | RLS plus same-workspace parent/child constraints; service-role code repeats scope checks | A record ID guessed from another workspace gives no data/effects |
| Brain | Read only that workspace's active Brain, authorize edit scope, freeze the reviewed seller context and its version/hash per generation | Missing active Brain or conflicting seller identity blocks generation; never use agency/other-workspace default |
| Memory | Pilot prompt is assembled from explicit imported row, approved sources and task snapshot. No workspace-wide “recent drafts,” global history or generic conversation-memory fallback | Missing task-specific context stays missing; no opportunistic fill from another conversation/client |
| Models | Server-approved workspace task policy and credential binding; task snapshot records selected provider/model/policy version | Disabled/unsupported selection or missing binding → refusal, not substitution |
| Credentials | Resolve opaque credential references on server only, with workspace, provider, purpose and optional vendor-account binding | No lookup from browser-supplied env name, secret, URL or arbitrary credential reference; no implicit platform-key fallback |
| Outputs | Only a destination record belonging to the same workspace with kind `manual_csv`; no URL, webhook, CRM patch, send or calendar invocation | Destination mismatch/unsupported kind rejected before loading/exporting contents |
| Versions | Review/export binds to immutable brief version, source digest and context/model-policy snapshot | Edit/regenerate invalidates approval of the new content; old approval never transfers |
| Retry | Scope, input hash, generation attempt and model policy form stored operation identity | A repeated accepted attempt reuses its stored result; uncertain paid attempt is held for reconciliation, not automatically repeated |
| UI | Workspace-scoped query keys; cancel/ignore old in-flight results and clear selections on client switch | A response started under A cannot render as B or export into B |
| Logs | Record scope, operation IDs, versions and sanitized reason codes | No raw source files, prompt bodies, secrets or unrelated client data in logs |

## Server authorization sequence

For proposed `pilot-import`, `pilot-call-brief` and `pilot-review-export` endpoints:

1. Authenticate via existing `requestAuth.ts`; pilot browser endpoints accept real users, not a bare service bearer.
2. Resolve request workspace and enabled draft-only workspace policy. Verify current membership and capability. Initial pilot write/research/review/export access is owner/admin only, reusing existing role names; other roles get no new write permission by default. Avoid a separate permission framework.
3. Load requested records using **both** ID and workspace predicates. Compare returned IDs to the entire requested set; reject omissions/mixed sets without revealing foreign details. Validate parent ownership too.
4. Load destination, model policy and credential binding under the same scope as applicable. A browser supplies IDs, never trusted object contents.
5. Construct an opaque `AuthorizedPilotContext` only after those checks. Pure business modules consume it; provider boundaries recheck the stored task scope and budget before any call.
6. Persist the operation and input/version digest before a potential external attempt. Return explicit blocked/pending/complete states. A successful model call is not a completed persisted brief or exported file.
7. Immediately before a model call, review or export commit, recheck authorization and version fences. Persist scope in all writes and constraints; a frontend switch cannot rewrite an existing task's workspace.

A future worker must load workspace and policy from a persisted authorized task, not a caller-supplied body; adding such a worker is outside the initial pilot. User cancellation before an external start makes zero calls. Once an authorized call starts, cancellation cannot undo disclosure/spend; retain its receipt/liability and discard late output from the active UI. An uncertain call stays visibly held. No automatic retry is enabled in v1.

## Proposed narrow interfaces

```ts
// Internal server type; never accepted directly from the browser.
type AuthorizedPilotContext = {
  workspaceId: string;
  clientBindingId: string;
  actorUserId: string;
  permission: 'import' | 'prepare' | 'review' | 'export';
  policyVersion: number;
  mode: 'draft_only';
};

type PilotTaskSnapshot = {
  workspaceId: string;
  clientBindingId: string;
  importedRowId: string;
  inputHash: string;
  brainVersion: string;
  brainHash: string;
  sourceSnapshotHash: string;
  taskModelPolicyVersion: number;
  selectedProvider: 'openai' | 'anthropic'; // Gemini absent until adapter validated
  selectedModel: string;                 // server registry ID, not arbitrary text
  credentialBindingVersion: number;      // reference only; never a secret
  outputDestinationId: string;           // server-owned manual_csv destination
  executionMode: 'draft_only';
};
```

These are proposed contracts, not types added to production. A snapshot is immutable, server-built, stored under workspace RLS and never embedded as trusted data merely because a browser sends similar JSON. No qualification criteria are independently frozen/rederived here: consume Claude's canonical decision/snapshot only through an agreed read-only adapter when available. Until then `qualification_decision = null` and the UI says **not evaluated**.

## Minimal data ownership design

All new durable objects use `workspace_id` with references to existing workspaces. No new client membership tree.

| Proposed durable object | Purpose and scope | Write authority |
|---|---|---|
| `pilot_workspace_policy` (new) | Workspace PK; immutable client binding, mode/limits/version, approved model/credential binding metadata and manual destination descriptors in a versioned policy document | Operator-managed enablement/bindings; browser receives a sanitized capability DTO, never raw credential references or arbitrary settings writes |
| `pilot_import_batches`, `pilot_import_rows` (new) | Hash/idempotency, normalized source rows and original source identity/provenance | Authorized importer through the scoped endpoint; never qualified by import |
| Existing `tasks` | A real scoped task per call-brief attempt using existing permitted task/status conventions; immutable pilot snapshot in its input/result | Server executor via a compatible task-store adapter; no new queue or automatic dispatch |
| `pilot_brief_versions` (new) | Immutable workspace-scoped source/context/model snapshot, validated content and generation receipt, tied to a real task | Server executor; users request/cancel but cannot forge receipts |
| `pilot_artifact_events` (new) | Append-only review/export-prepared events bound to exact brief version/digest, reviewer and scoped manual destination | Validated review/export endpoint; user cannot transfer approvals to edited content |

This is **five new tables total**, plus existing task/financial records, introduced incrementally. Model policies, opaque credential bindings and manual destination descriptors stay in the one versioned server-owned workspace policy for the bounded pilot. There is no connector account/secret administration product, separate model-settings store, new dispatch queue or second financial ledger. Split those policy entities into tables only when later integration lifecycles require it, not in v1.

Create tables in the PR that introduces their lifecycle, not all at once. Add `UNIQUE(workspace_id,id)` where needed and composite foreign keys `(workspace_id,parent_id)` to prevent cross-workspace references even through service-role writes. No global uniqueness on domain, email, external source ID or file hash: the same Apollo record can legitimately appear in two clients' isolated imports. Uniqueness for import/update identities is workspace-scoped.

RLS must check workspace membership and the defined action permission. Server-owned policy/task/receipt tables disallow arbitrary authenticated inserts/updates; functions/RPCs must not gain unsafe PUBLIC execute. Any definer RPC needs explicit grants, fixed search_path and membership/ownership checks. Native SQL negative tests are mandatory before enabling the feature; static `.eq` or mocked auth tests alone are insufficient. Generated migrations would be reviewed separately; none is installed or generated by this planning change.

Use existing `tasks`, `lead_model_calls`, `lead_provider_calls`, budgeting and accounting primitives through a compatible task/linkage adapter. Create a real task before the potential provider attempt; never insert a pilot version ID where an existing task foreign key is required. Confirm actual task/status/agent constraints before schema approval and map them explicitly. Admission, credits and uncertain liabilities remain authoritative. No new background queue, fabricated task ID or weakening of constraints to make an adapter fit.

## Company Brain, memory and UI changes

- Keep `company_brain.workspace_id` as the client Brain boundary. Extend the canonical loader to return server-observed version/hash through a narrowly reviewed compatible accessor. Avoid broad edits to Claude's qualification consumers.
- Capture active Brain content once for the pilot task, with seller identity checks; do not reload “latest Brain” mid-generation or resume. If a Brain changes before task start, ask for a new reviewed snapshot. If edited after completion, show which version grounded the old brief and require explicit regeneration to use the new one.
- Pilot memory is explicit and minimal; it does **not** call broad `loadConversationMemory`. Imported values are untrusted source claims, never system instructions. Do not include unrelated drafts, raw emails/phones, credentials or arbitrary CSV note instructions in prompts.
- Fix the shared memory reader's current workspace-wide draft fallback separately from pilot prompting. Where an existing conversation/plan cannot prove draft association, omit drafts. Do not invent a conversation_id column or match association by company name. Regress existing follow-up behavior and validate nested account/contact ownership before including joined data.
- `WorkspaceContext` gains explicit selection and membership loading. Pilot actions must not silently resolve another first membership from `orchestration.getCurrentWorkspaceId` on a token refresh. A per-tab selection hint is not authorization; clear it at sign-out and validate it on every load.
- On switch: cancel prior query subscriptions, invalidate selected account/import/brief state, detach old realtime feeds, reset ChatWorkspace/workbench selection and ignore late results using a selection generation token. Existing `useCompanyBrain` already keys cache by workspace; preserve that and test that previous data is not shown under the new workspace label while loading.
- Add an explicit client/workspace identity to preview, review and downloaded manifest. A server-approved local download cannot verify where a human later uploads the file; manual destination confirmation is an operator responsibility, not an automated isolation guarantee.

## Credentials and destinations

For v1, there are **no Apollo, iGTM, Jungler, Slack, email or calendar credentials** in the pilot flow. CSV import/export requires none. Optional research/model credentials are operator-provisioned server references bound to the client workspace, provider and allowed purpose. A platform credential may be reused only if explicitly authorized for that workspace with separate budget attribution; it is never an automatic fallback. Dedicated provider projects/credentials per client are preferred when available. Logical workspace authorization does not make a shared billing account physically separate.

The model/research adapter must fail when the exact approved binding is absent/revoked. It cannot fall back to a globally configured token simply because the application has one. Client users cannot point a reference at an environment-variable name or arbitrary URL. The registry resolves references from a trusted configuration/secret store; secret management and rotation remain outside browser code and this planning change.

There is one output destination kind: `manual_csv`. It authorizes preparing a file, not sending it to Apollo or an inbox. A manifest states **prepared for download**; neither a browser download callback nor human review can mean “Apollo updated,” “caller received” or “outreach sent.” Remote destination kinds remain unavailable until separate connector, consent, operation receipt and OO-01/OO-02/OO-03 gates pass.

## Required adversarial isolation tests

1. User A cannot inspect/import/generate/review/export a B workspace record by guessing any object ID. Zero model/provider calls on refusal.
2. User authorized for both A and B submits request scope A with B batch, brief, context, credential, model policy or destination: entire operation refused.
3. Same email/domain/Apollo ID/file hash in A and B never deduplicates, links, returns cached output or charges against the other workspace.
4. Native RLS denies cross-workspace SELECT/INSERT/UPDATE/DELETE; composite keys reject foreign children through service-role writes; no side-effect RPC is PUBLIC callable.
5. Synthetic A/B private voice markers never cross prompts, memory, output, logs, export or cached UI; missing Brain never falls back to the agency Brain.
6. Switch A→B during fetch/generation/realtime event; late A response stays A and is never displayed/exported as B. Refresh, logout/login and multi-tab selection cannot silently switch scope.
7. Reviewer has access revoked after loading a brief: review/export refused. An already authorized external call is recorded rather than silently retried under another client.
8. Credential binding revoked/rotated between prepare and start: refuse or require a new snapshot, with zero unauthorized transport; cannot use another workspace/global binding.
9. Brain/policy/source changes invalidate stale generation/review hashes. Old approved version is immutable; edits create an unreviewed version.
10. Every future background retry restores original scope and policy; no user-supplied context can override them. Uncertain paid outcomes remain held, not repurchased.

These tests define the intended boundary. The audit's I01 passes a mocked loader boundary and I02 currently fails the same-workspace memory expectation; neither is claimed as proof of this proposed implementation.
