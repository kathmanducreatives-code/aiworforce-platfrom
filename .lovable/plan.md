# Agent Identity Audit & Migration Plan

Audit only — no code, schema, backend, prompt, or provider changes proposed here. Migration plan is a phased proposal for a future turn.

---

## 1. Current agent lineup (6 identities)

| ID / slug | Name | Current role (canonical) | Registry source |
|---|---|---|---|
| `pilot`  | Pilot  | Manager / Orchestrator                         | `agentProfiles.ts` (PILOT_PROFILE), `workforce/agents.ts` |
| `scout`  | Scout  | Sourcing / Signal Discovery                    | `agentProfiles.ts`, `dockAgents.ts`, `workforce/agents.ts` |
| `aria`   | Aria   | Ranking / Lead Scoring / Screening (ICP-gated) | same three |
| `penn`   | Penn   | Outreach Writer (approval-gated, never sends)  | same three |
| `hawk`   | Hawk   | Research (Firecrawl, competitor, website)      | same three |
| `scribe` | Scribe | Content / summaries / reports                  | same three |

Plus one **floating UI persona** with no slug, no registry entry, no routing, no DB record:

- **Atlas — "AI Account Analyst"** — hardcoded only in Lead Library premium components (`AtlasPanel`, `AtlasEmptyState`, `PremiumSkeleton`, `LeadTable`, `MetricStrip`, `BulkActionBar`, `LeadLibrary.tsx`) with its own `src/assets/atlas-portrait.png`. Presentation layer only — the ranking it takes credit for is actually produced by Aria; the sourcing behind it is Scout.

**Nova, Mira, Orion** appear nowhere in the codebase except as *negative fixtures* in `src/lib/companyBrainCompleteness.test.ts` (a guardrail asserting they must NOT be mentioned in onboarding copy).

---

## 2. Reference map — file × coupling type

Legend: **V** visual-only · **C** user-facing copy · **B** behavior-coupled (routing/inference) · **D** database-coupled (`agent_slug` text values) · **X** backend-coupled (edge functions, system prompt, orchestration)

### Pilot
- `src/data/agentProfiles.ts:33-50` — PILOT_PROFILE, lookup maps · **C/B**
- `src/components/workforce/agents.ts:26-33,64` · **C/B**
- `src/lib/agentResolver.ts:5,19` — universal fallback · **B**
- `src/hooks/useWorkforceState.ts:48-56,138-146` · **B**
- `src/pages/Agents.tsx:5-13,39` — hardcoded PILOT_CARD outside dock list · **C**
- `src/components/help/AskPilotAboutPage.tsx` · **C**
- `src/components/chat/workspace/agents/AgentPresenceBar.tsx:6,20` · **C/V**
- `src/assets/agents/pilot.png` · **V**
- `supabase/functions/_shared/agentorySystemPrompt.ts:1,67-72,110-113,143-186,213-214` (PILOT_CAPABILITY_ADDENDUM, `pilot_router` task type) · **X**
- `supabase/functions/pilot-chat/index.ts` (whole function) · **X**
- `supabase/functions/orchestrate/index.ts:730-731` · **X**
- Migrations: `agent_slug` text columns default to `'pilot'` — `20260526010000_...sql:24,64`, `20260519104244_...sql:4`, `20260504024500_...sql:6,37`, `20260529064050_...sql:37-38` (from/to_agent_slug) · **D**

### Scout
- `src/data/agentProfiles.ts:24`, `src/data/dockAgents.ts:40-52`, `src/components/workforce/agents.ts:34-41` · **C**
- `src/lib/agentResolver.ts:14,31,34` (keyword inference) · **B**
- `src/assets/agents/scout.png` · **V**
- `supabase/functions/orchestrate/index.ts:42,69,148,298-300,591-661,765-777` (plan generation for hiring-intent, content-engagement) · **X**
- `supabase/functions/_shared/agentorySystemPrompt.ts:73,147-172` · **X**
- `supabase/functions/run-agent/index.ts:84,122,249,359-396,438,507,538,542-940,1206+`; shared modules `scoutSourcingPlan.ts`, `scoutStrategy.ts`, `leadHandoffGuard.ts` (Scout→Aria) · **X**
- `agent_slug='scout'` text values in above migrations · **D**

### Aria
- `src/data/agentProfiles.ts:23`, `src/data/dockAgents.ts:27-39`, `src/components/workforce/agents.ts:42-47` · **C** (role drift: "Ranking" vs "AI Screener" vs "Lead Scoring Agent")
- `src/components/chat/workspace/workbench/AriaRankingView.tsx` · **C**
- `src/lib/agentResolver.ts:15,31,35` · **B**
- `src/hooks/useWorkforceState.ts:66-83` — **the only agent with a Company-Brain-completeness gate in UI**; `blockedReason` copy referenced verbatim · **B/C**
- `src/assets/agents/aria.png` · **V**
- `supabase/functions/_shared/ariaScoring.ts` (whole scoring engine) · **X**
- `supabase/functions/_shared/agentorySystemPrompt.ts:74,110-172` · **X**
- `supabase/functions/orchestrate/index.ts:70,153,243,308-310,430-432,664-665,774-777` · **X**
- `supabase/functions/run-agent/index.ts:33,380-392,1192,1206-1224` (`mapAriaToDecision`, `aria_weights`, per-lead `aria` JSON object in `LeadQualityEntry`) · **X/D-JSON**
- `agent_slug='aria'` text values · **D**

### Penn
- `src/data/agentProfiles.ts:25`, `src/data/dockAgents.ts:53-64`, `src/components/workforce/agents.ts:48-55` · **C**
- `src/lib/agentResolver.ts:17,31,37` · **B**
- `src/hooks/useWorkforceState.ts:85-91,132-147` — routes nextAction to `/awaiting-you` · **B**
- `src/assets/agents/penn.png` · **V**
- `supabase/functions/_shared/agentorySystemPrompt.ts:75,112,156-172` — "never sends without explicit approval" hardcoded · **X**
- `supabase/functions/orchestrate/index.ts:71,158,209,218,319-320,379-394,693-759`; shared `draftGate.ts`, `draftOutreachPlan.ts` · **X**
- `agent_slug='penn'` values · **D**
- Adjacent (not agent-keyed but Penn-produced): `sequence_status`, `activity_status` enums in outreach tables

### Hawk
- `src/data/agentProfiles.ts:26`, `src/data/dockAgents.ts:65-76`, `src/components/workforce/agents.ts:56-63` · **C**
- `src/lib/agentResolver.ts:16,31,36` · **B**
- `src/hooks/useWorkforceState.ts:94-102,150` · **B**
- `src/assets/agents/hawk.png` · **V**
- `supabase/functions/_shared/competitorDiscovery.ts`; `agentorySystemPrompt.ts:76,112,147-190`; `orchestrate/index.ts:72,170,185-190,333-363,416-460,744-802`; `run-agent/index.ts:359,438,538` · **X**
- `agent_slug='hawk'` values · **D**

### Scribe
- `src/data/agentProfiles.ts:27`, `src/data/dockAgents.ts:77-87` (only agent with `status:'idle'`), `src/components/workforce/agents.ts:64-71` · **C**
- `src/lib/agentResolver.ts:18,31,38` · **B**
- `src/hooks/useWorkforceState.ts:103-111,133,149` · **B**
- `src/assets/agents/scribe.png` · **V**
- `agentorySystemPrompt.ts:77,85,112-198` (Claude-preferred for writing); `orchestrate/index.ts:73,175,198,232,252,266,279,365-408,442-458,591-727` · **X**
- `agent_slug='scribe'` values · **D**

### Atlas (floating persona, no slug)
- `src/pages/LeadLibrary.tsx:104,108,148,187-204` · **C**
- `src/components/leads/library/premium/AtlasPanel.tsx` (whole), `AtlasEmptyState.tsx` (whole), `PremiumSkeleton.tsx:9` · **C/V**
- `src/components/leads/library/BulkActionBar.tsx:91`, `LeadTable.tsx:40`, `MetricStrip.tsx:16` · **C**
- `src/assets/atlas-portrait.png` · **V**
- Zero backend, zero routing, zero DB. Not in `AgentId` union.
- Test tension: `src/lib/companyBrainCompleteness.test.ts:11-24` asserts Atlas must NOT be mentioned in onboarding copy (guards `AGENT_ROSTER` in `agentorySystemPrompt.ts`, currently `[Pilot, Scout, Aria, Hawk, Scribe]` — Penn already missing from that specific list).

---

## 3. Proposed responsibility mapping → new lineup

| New agent | New role | Inherits from | Notes |
|---|---|---|---|
| **Pilot** | Coordinator (unchanged) | Pilot | Keep slug `pilot`, keep PILOT_CAPABILITY_ADDENDUM, keep `pilot-chat` function. Only its "which specialists exist" routing text changes. |
| **Nova — AI Signal Scout** | Finds companies with buying signals | Scout | 1:1 rename. All Scout behavior/backend/DB stays; identity layer swaps. |
| **Atlas — AI Account Analyst** | Researches accounts, qualifies, ranks | **Aria + Hawk merged** | Aria's scoring engine + Hawk's research/Firecrawl responsibilities collapse under Atlas. Lead Library's existing Atlas UI becomes canonical. |
| **Mira — AI Message Strategist** | Turns research into outreach | Penn | 1:1 rename. Approval gate, `draftGate.ts` semantics preserved. |
| **Orion — AI Pipeline Operator** | Shows what to review/approve/contact/watch/skip next | **New surface** — closest current analog is `useWorkforceState` nextAction routing + `/awaiting-you` page + parts of Scribe's report/brief output | No 1:1 predecessor. Absorbs the "what's next" curation currently spread across Pilot's plan cards and Scribe's briefs. Scribe's content-writing function likely retires or folds into Mira/Orion (needs product decision). |

Explicit deltas:
- Scribe has no direct successor. Its content/summary/report role either dissolves into Orion's "next-actions digest" or is deprecated.
- Aria and Hawk merge into Atlas — this is the highest-risk change (two backend engines, two prompt sections, two sets of routing keywords → one identity).
- Two current UI names (Aria "Screener" candidate framing in `dockAgents.ts`, Aria "Ranking" in `agentProfiles.ts`, Hawk "Competitor Watcher") disappear.

---

## 4. Risk register

| # | Risk | Layer | Severity |
|---|---|---|---|
| R1 | `agent_slug` is free-text with no enum — historical rows (`'scout'`, `'aria'`, `'penn'`, `'hawk'`, `'scribe'`) will remain and be resolved by name via `AGENT_BY_ID`. Any UI that reads slug directly (activity feed, chat attribution, presence bar) will show blank/fallback-to-Pilot if we drop old entries from the registry. | D | **High** |
| R2 | Aria+Hawk → Atlas merge: two separate system-prompt personas, two backend modules (`ariaScoring.ts`, `competitorDiscovery.ts`), and two keyword sets in `inferAgentFromAction` all collapse into one identity. Naïve merge risks the prompt telling Atlas to both "score against ICP" and "run Firecrawl audits" in the same turn — may need separate task types even under one persona. | X | **High** |
| R3 | Scribe retirement without a replacement leaves orphaned plan-step generation branches in `orchestrate/index.ts` (`:73,175,198,232,252,266,279,365-408,442-458,591-727`) and any activity/chat rows with `agent_slug='scribe'`. | X/D | Medium |
| R4 | Aria's Company-Brain completeness gate (`useWorkforceState.ts:83`) and its user-facing `blockedReason` copy need to move to Atlas — easy to forget, leaving Atlas ungated. | B/C | Medium |
| R5 | Penn's "never sends without approval" contract is currently prompt-enforced under the name Penn (`agentorySystemPrompt.ts:75,112,156-172`) and code-enforced via `draftGate.ts`. Rename to Mira must preserve both. | X | Medium |
| R6 | `companyBrainCompleteness.test.ts` explicitly forbids the names Nova/Atlas/Mira/Orion in onboarding copy. This test will flip from guardrail to blocker on day one — must be updated in lockstep with the rename, and its `AGENT_ROSTER` expectation `[Pilot, Scout, Aria, Hawk, Scribe]` must become `[Pilot, Nova, Atlas, Mira, Orion]`. | Tests | Medium |
| R7 | Three parallel registries drift today (`agentProfiles.ts`, `dockAgents.ts`, `workforce/agents.ts` all define role text differently). Renaming in only one produces mixed UI. Consolidation should be part of migration, not deferred. | C | Medium |
| R8 | `agent_id uuid` column at `20260526000000_baseline_from_prod.sql:66` — separate from `agent_slug text` and not clearly used. Needs a targeted read before migration to confirm it's dead schema, not a parallel relational identity system. | D | Low but unresolved |
| R9 | New agent PNG portraits for Nova / Mira / Orion don't exist yet. Atlas already has `atlas-portrait.png` but it's outside `src/assets/agents/` and shaped differently from the other six. | V | Low |
| R10 | `useWorkforceState.ts` currently returns 6 agent cards with per-agent nextAction routing — Orion has no clear source signal set today, so its card will initially be empty/loading unless we define its inputs. | B | Low |

---

## 5. Proposed phased migration plan (proposal only — not for execution now)

### Phase 0 — Freeze & consolidate (no rename)
- Reconcile the three UI registries into one canonical source (pick `agentProfiles.ts`; make `dockAgents.ts` and `workforce/agents.ts` derive from it). No renames yet.
- Read the `agent_id uuid` baseline column to close R8.
- Add a `slug → display name` indirection so UI reads names through one resolver (already partly true via `resolveAgent`).

### Phase 1 — Introduce new identity layer (backward-compatible)
- Add Nova, Atlas, Mira, Orion to the registry **alongside** Scout/Aria/Penn/Hawk/Scribe with new slugs.
- Add alias table: `scout→nova`, `penn→mira`, `aria→atlas`, `hawk→atlas`, `scribe→orion` (Scribe deprecation policy TBD).
- `resolveAgent` normalizes old slugs to new profiles so historical `agent_slug` rows render under new names automatically. No DB writes.
- Frontend surfaces flip to new names via the registry; backend still uses old slugs internally.

### Phase 2 — Backend prompt & routing rename
- Update `agentorySystemPrompt.ts` `AGENT_ROSTER` and every persona block to the new lineup.
- Split Atlas prompt into two internal task modes (`atlas_qualification`, `atlas_research`) to avoid Aria+Hawk collision (R2).
- Rename routing keys in `orchestrate/index.ts` and `run-agent/index.ts` from scout/aria/penn/hawk/scribe to nova/atlas/mira/orion. Emit new slugs on all new rows; alias layer keeps old rows readable.
- Preserve Penn's approval contract under Mira (R5). Preserve Aria's ICP gate under Atlas (R4).
- Update `companyBrainCompleteness.test.ts` fixtures in the same commit (R6).

### Phase 3 — Scribe retirement + Orion activation
- Decide product-side whether Scribe's content generation folds into Orion, Mira, or is deprecated.
- Wire Orion's "review / approve / contact / watch / skip" queue on top of existing `useWorkforceState` nextAction feeds + `/awaiting-you`.
- Add Nova/Mira/Orion portraits; relocate `atlas-portrait.png` into `src/assets/agents/` alongside the others.

### Phase 4 — Cleanup
- After a soak period, backfill old `agent_slug` rows to new slugs (single UPDATE, reversible), then remove the alias layer.
- Optionally add a CHECK constraint / enum on `agent_slug` to prevent drift going forward.

### Explicitly out of scope of this migration
- No changes to `ariaScoring.ts` behavior, `draftGate.ts` semantics, `competitorDiscovery.ts` outputs, Firecrawl/Apify wiring, or any provider/prompt behavior beyond identity strings and roster composition.
- No DB schema changes in Phases 0-3; only additive registry entries and prompt text edits.

---

## Open items to confirm before Phase 1

1. Should **Scribe** retire, fold into **Orion**, or fold into **Mira**?
2. Is **Atlas** intended to be a single persona internally, or a UI-facing name over two backend task modes (recommended given R2)?
3. Is `agent_id uuid` at `20260526000000_baseline_from_prod.sql:66` live or dead schema?
4. Should Phase 4 add an enum/CHECK on `agent_slug`, or keep it free-text?
