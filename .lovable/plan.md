# Audit: old account-signal workflow instead of qualified-lead / Claude-first

This is a **read-only audit** with **one minimal frontend change** at the end (a dev-only routing guard + a "Copy diagnostics" action). No backend logic changes, no re-runs of paid sourcing, no production writes.

## Critical pre-finding (already visible from `.env`)

`VITE_SUPABASE_URL` currently resolves to `https://wqnigjhcwjxtmordrwno.supabase.co` — the **production** project. The audit brief forbids the frontend from being connected to production and requires TEST (`zbwsbnqqpkvdhqwavjke`). This alone can explain everything: Phase 2 / Claude-first flags and the QA workspace `11111111-1111-1111-1111-555555555555` live in TEST, so a production-connected UI cannot see them and will fall through to the deterministic legacy account path.

I will not touch `.env` or `src/integrations/supabase/client.ts` blindly during the audit — the environment-gate code already refuses to silently fall back in dev, so the fix belongs in a gitignored `.env.local` the user controls. I'll surface the mismatch clearly.

## Audit steps (read-only)

1. **Environment (Audit 1)** — Confirm resolved Supabase URL/ref from `.env`, `resolveSupabaseUrl`, and `import.meta.env`. Verify no other client instance is used. Report the ref suffix, not keys.
2. **Active workspace (Audit 2)** — Read `WorkspaceContext`, `useAuth`, `getCurrentWorkspaceId`, and any workspace switcher. Determine the active `workspace_id` and its display name; compare against the allow-listed QA workspace.
3. **Network path (Audit 3)** — Trace composer → `pilotChat` → `pilot-chat` edge fn → returned plan → `WorkflowConfirmationCard` → `orchestrate` → `run-agent`. Confirm whether the payload preserves the original instruction, `requested_count=5`, decision-maker roles, and qualified-lead intent, or whether it collapses to `GTM / Sales` account sourcing.
4. **Legacy routing in frontend (Audit 4)** — Grep for `Find GTM / Sales hiring-signal accounts`, `account opportunity`, `Scout will source signals`, `fast mode`, `Find decision-makers`, legacy template IDs, and any keyword heuristics that could re-derive the plan client-side. The frontend must render the backend contract verbatim; confirm or refute local re-derivation.
5. **Stale build (Audit 5)** — Report current branch/commit SHA and check whether PR #98/#99/#100 files exist in the tree (e.g. `src/lib/qualifiedLead/contract.ts`, `productPathE2E.test.ts`).
6. **Contract rendering (Audit 6)** — Inspect `ExecutionPlanCard` and `WorkflowConfirmationCard` to verify which fields come from backend vs. locally derived (title, steps, agents, execution_mode, count_entity, quota_policy, hiring titles, DM roles).
7. **Workbench mapping (Audit 8)** — Inspect `LeadResultsView` to confirm results are keyed strictly by the returned `task_id` and that CONTACT-ready counters read the new contract fields, not legacy account-opportunity fields.

Each audit step produces a short evidence block with `file:line` references.

## Minimal frontend correction (only if the root cause is frontend-side)

Two small, dev-scoped additions — no UI redesign, no copy changes, no route changes, no logic changes to plan derivation:

1. **Dev-only routing-mismatch guard** in `WorkflowConfirmationCard` (before Start Workflow is enabled):
   - When the user's structured intent implies qualified-lead sourcing (person-target verbs like founder/CEO OR an explicit "N qualified leads" quota, as already detected by `src/lib/qualifiedLead/*`) but the returned preview contract is account-shaped (`workflow_kind !== 'qualified_lead_sourcing'` or `count_entity !== 'contact_ready_lead'`), block Start Workflow and show:
     > "Routing mismatch detected. This request requires qualified-lead sourcing, but an account-only workflow was returned."
   - Gated on `import.meta.env.DEV` so it never ships to production users.
   - Detection uses the canonical structured intent (reuses existing `routeQualifiedLead`-derived helpers in `src/lib/qualifiedLead/`), not exact-query string matching.

2. **"Copy diagnostics" action** in the existing execution-plan overflow menu (dev-only visibility, or always available but non-intrusive):
   - Copies a JSON blob with: `frontend_sha` (from `import.meta.env.VITE_GIT_SHA` if present, else `"unknown"`), `supabase_project_ref_suffix` (last 6 chars of ref), `workspace_id`, `conversation_id`, `plan_id`, `task_id`, `workflow_kind`, `execution_mode`, `count_entity`, `quota_policy`, `requested_count`.
   - Never includes JWTs, keys, headers, prompts, or secret env values.

3. **Optional 1-line extension of `PreviewDiagnostics`** (already dev-only, bottom-right chip) to also show the Supabase project ref suffix and env mode. No new component.

If the root cause is the environment mismatch (production URL in `.env`), the fix is not code — it's telling the user to point `.env.local` at TEST, and the existing gate in `src/main.tsx` + `resolveSupabaseUrl` will do the rest. I will not silently rewrite `.env`.

## Explicit non-goals

- No changes to `pilot-chat`, `orchestrate`, `run-agent`, or any backend function.
- No changes to plan/contract derivation logic.
- No UI redesign or copy rewrites on the plan card / Workbench.
- No broadening of the Claude-first workspace allow-list.
- No paid workflow runs; validation uses existing fixtures / intercepted requests only.
- No writes to production project `wqnigjhcwjxtmordrwno`.

## Files that may change (upper bound)

- `src/components/chat/workspace/bubbles/WorkflowConfirmationCard.tsx` — add dev-only mismatch guard.
- `src/components/chat/workspace/plan/ExecutionPlanCard.tsx` — add "Copy diagnostics" menu item.
- `src/lib/qualifiedLead/diagnostics.ts` — small helper to assemble the safe diagnostics payload (module already exists).
- `src/components/dev/PreviewDiagnostics.tsx` — optionally show project-ref suffix.

Nothing else.

## Deliverable

The 23-point final report requested in the brief, with `file:line` evidence for each finding, followed by the minimal frontend correction (if applicable) and confirmation that production was untouched and no paid workflow was launched.
