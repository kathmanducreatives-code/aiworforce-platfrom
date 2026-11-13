# Agentory database reconciliation (2026-11-12)

**Evidence:** read-only SQL. On TEST that included fictional rows; on production, catalog data and counts only. Migration lists came from the Management API. No production row content was read or copied.

## 1. Schema and migrations

| | TEST `tlvnfrxzjhsjgdofwehb` | Production `ohsdatpvfdjdemstoiuj` |
|---|---|---|
| Migrations recorded | 5: `lead_mission_v2_exhausted_lease_terminal`, `provider_connections`, `lead_pipeline_checkpoints`, `workforce_v2_security`, `lead_model_calls_view_lockdown`. TEST was cloned from a schema snapshot, so the baseline is not in its list. | 28: `baseline_schema` … `lead_mission_v2_productive_continuation_no_backoff` (2026-10-12) |
| Public tables and views | 140. Same core set as production, **plus** `discovery_smoke_*` (3 tables), `lead_pipeline_checkpoints`, `provider_usage_ledger`, `workspace_provider_connections`. | 134 |
| Public functions / policies / triggers | 52 / 178 / 49 | 36 / 184 / 43 |
| Company Brain | `company_brain` exists; **0 rows; write guard trigger `discovery_test_no_company_brain` enabled.** | `company_brain` exists, 2 rows, no guard |
| Brain memory, collaboration handoffs (ORION branch) | **absent** (held migrations) | **absent** |
| Leads | `lead_candidates`, `accounts`, `lead_evidence`, `lead_results` (view), `lead_mission_*`, `lead_execution_calls` | same |
| Signals | `signal_events`, `signal_event_evidence`, `signal_feed` (view), `monitoring_subjects`, `signal_cluster_relevance` | same |
| Conversations | `conversations` (per user; no workspace column), `messages`, `request_understanding_log` | same |
| Approvals / collaboration | `approvals`, `handoffs`, `collaboration_*` (recruiting module) | same |
| Model-spend ledger | `lead_execution_calls` plus the `lead_model_calls` view. **Hardened** (security invoker, browser grants removed). | same tables; **view open to anon** (see the environment doc §3) |
| Membership | `workspace_members` (`role` is text: owner / editor / viewer / member); RLS through `has_workspace_access` | same |

**Before any migration is promoted, close the migration-history gap:** TEST's list does not mirror production's. Generate a schema diff from both catalogs before the next migration (roadmap P0-4).

## 2. The four fictional leads (TEST, workspace `a71a0000-…11a1` "ORION Pilot (fictional)")

Each comes from the reviewed seed (`scripts/test-project/orion-pilot-seed.sql`).

| Company | `lead_candidates.status` | Fit | Priority | Stored reason | Signal | Lead Library decision | Lifecycle (derived) | ORION evidence |
|---|---|---|---|---|---|---|---|---|
| Kestrel Fabrication | qualified | 86 | high | US manufacturer, 140 employees, second plant announced | `geographic_expansion`, provider_verified, active, 2026-11-06 | **Contact** | `research_needed` (no discovery source on the lead) | yes: lead plus verified signal |
| Harbor Valve Works | qualified | 71 | medium | US manufacturer, 85 employees, hiring machinists | `growth_hiring`, unverified (single source), 2026-11-03 | **Contact** | `research_needed` | yes: lead plus single-source signal |
| Summit Robotics | rejected | 35 | low | 400 employees — above the 20–200 band | none | **Skip** | discovered | yes: rejected lead with reason |
| Cloudnova Software | rejected | 18 | low | Software company — outside the manufacturing ICP | none | **Skip** | discovered | yes: rejected lead with reason |

**Signal-only companies** (no lead row): Ridgeway Castings (contradicted) and Pinecrest Tooling (stale, 2026-07-05). The isolation canary, Zephyr Industries, lives in workspace `…11a2`.

**Read paths:**
- **Lead Library:** `canonicalLeadView.ts` reads `lead_candidates` joined to `accounts`. `accountStatus = mapAccountStatus(accounts.stage ?? lead_candidates.status)`, so the two qualified leads map to `qualified`.
- **ORION:** `_shared/evidence/retrieve.ts` reads `lead_candidates` and `signal_events` for the workspace.

### Why "Qualified = 0" while two leads say CONTACT

**A UI metric bug, not a domain rule.**
- **Decision:** `deriveLeadDecisionState` gives CONTACT because the account *is* qualified (`isQualified` reads `accountStatus === "qualified"`).
- **Lifecycle:** checks `research_needed` *before* `qualified`. Neither seeded lead has a discovery source (`signal_id` and `evidence_id` are null), so both sit in `research_needed`.
- **The Qualified counter** (`countByKey`) counted only lifecycle stages and left out `research_needed`. That contradicts its own help text, "Passed the qualification threshold".

**Fixed locally:** the decision state now carries `accountQualified`, and the counter includes it.
- No stored verdict or stage changed, and the lifecycle is unchanged.
- SKIP and watch rows are never counted, and "Buyer ready" is not inflated.
- Regression test: `src/lib/leadLibrary/__tests__/leadDecisionState.test.ts`.
- **Result: Qualified = 2.**

### "ATLAS Blocked" and zero credits

**Both are intended behaviour, but the badge was unclear.**
- **Blocked:** `useAgentVisualStates` sets `setupBlocked: { atlas: 'Needs your Company Brain' }` when the Brain isn't onboarded. ATLAS sourcing needs an ICP, and this TEST project cannot hold a Brain.
- **Credits:** the pilot workspaces were deliberately never granted any. Credits enable paid actions.
- **Fixed locally:** the Lead Library now shows the reason beside the badge ("Needs your Company Brain").

## 3. Signals and the ORION answer that omitted them

**The trace of the live turn, 2026-11-12 14:54 UTC:**
1. **UI:** `src/lib/pilotChat.ts` → `pilot-chat` (TEST v1). Authentication and membership passed.
2. **Understanding** (Luna, OpenAI): two parts, `["read","read"]` (companies and signals). Logged in `request_understanding_log` (`chat_brain_shadow`, confidence 0.99). **Correct.**
3. **Routing** (`routeRequest`): `read`, reason `answerable_from_held_evidence`. **Correct objective.**
4. **Read surface** (`planRead`): takes the **first** read part only, so `target: "companies"`. **The signals part was dropped here.**
5. **Deterministic renderer:** "4 leads saved" plus names. No model, so `model_used = null`.
6. **Evidence context:** never reached, because evidence attaches only to the conversational and evidence answer. So there was no Evidence panel.
7. **Persistence and UI:** the message was saved with `chat_brain.route = read` and rendered as stored.

**The responsible layer is step 4**, together with the routing rule that sent a compound "summarize with evidence" request to a single-target list surface.

**Fixed locally (D-1):** in evidence workspaces, a request made only of unscoped reads that has several parts or asks for prose becomes one ORION evidence answer, covering leads and signals with [E#] citations. A single list read ("show my leads") keeps the deterministic surface.

**Spend (D-2):** the same turn wrote 0 ledger rows; see the backend matrix. Fixed locally.

## 4. Company Brain on TEST

- **Guard:** `company_brain.discovery_test_no_company_brain` is **enabled (A)**, and there are 0 Brain rows. Not touched.
- **Why the editor appeared editable:** the page decides editing from the user's *role* only (`useWorkspaceRole`). Nothing told it the environment refuses writes.
- **Why the message misled:** with no Brain row there is no version (`updated_at`). `saveCompanyBrainPatch` turned "no version" into `{conflict: true, "still loading"}`, and the page titled any conflict "Company Brain was changed elsewhere". Neither was true.
- **Fixed locally:**
  - New `src/lib/env/companyBrainAvailability.ts` (ref-locked to the TEST project).
  - The Brain page is read-only there, with a banner explaining why and what still works.
  - Guided setup, restart and the memory panel's writes are hidden.
  - `saveCompanyBrainPatch` refuses before any network call.
  - "No version" is no longer reported as a conflict anywhere.
- **Brain-enabled testing:** a separate project; see roadmap P2.
