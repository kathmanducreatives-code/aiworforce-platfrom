## Root cause

The Slack-style visuals already key off `agent_slug` / metadata, but the backend writes almost every assistant message with `agent_slug: "pilot"`. So no matter how nice the bubbles look, `ChatView` resolves them to Pilot. Specifically:

- `supabase/functions/run-agent/index.ts` hard-codes `agent_slug: "pilot"` on every chat message it inserts: sourcing-failure card (L531), no-qualified-matches card (L596), no-results card (L908), and the main post-lead result card (L988) — even though the actual work was done by Scout/Aria/Hawk.
- `supabase/functions/pilot-chat/index.ts` correctly emits Pilot for plan announcements, but also writes Pilot for messages that are really Scout/Aria operational updates (L352, L389, L429, L528, L1492, L1551, L1629, L1649, L1665).
- `ExecutionTaskRow` derives the row agent from `agentById[task.agent_id]`. When the task row's `agent_id` doesn't map (or is the Pilot agent for a planning/coordination step), the badge falls back to Pilot. The planning/wrap-up steps therefore visually claim Scout/Aria's work.
- `ChatView` already supports `resolveAgentFromMetadata` and falls back to `m.agent_slug`, so the fix is to (a) make the backend write the correct slug, and (b) provide a content-based inference fallback for legacy rows.

## What to change

### 1. Single source of truth for agent identity (frontend)

- Extend `src/data/agentProfiles.ts` with explicit `responsibilities: string[]` per agent (matching the spec) so a runtime helper can route by responsibility, and re-export from `src/lib/agentResolver.ts`.
- Add `inferAgentFromContent(text)` in `src/lib/agentResolver.ts` using the regex rules from the spec (scout/aria/hawk/penn/scribe → default pilot). Use it in `resolveAgentFromMetadata` as the last step before falling back to Pilot.
- Update `ChatView.tsx` ownership chain to:
  `meta.agent_id || meta.agent_slug || m.agent_slug || inferAgentFromMetadata(meta) || inferAgentFromContent(m.content) || 'pilot'`.
- Remove the duplicate-name risk by rendering only `Name · Role` once (already the case, but assert it after backend changes).

### 2. Backend message ownership (no DB migration, no schema change)

In `supabase/functions/run-agent/index.ts`, update every `messages.insert` to attribute the correct agent. Concretely:

- Sourcing-failure card (L531): `agent_slug: "scout"`, metadata `{ agent_id: "scout", workflow_step: "source_leads", status: "failed" }`. Optionally emit a short Pilot summary message afterwards ("Try broadening or change the source").
- No-qualified-matches (L596): split into two inserts — Scout: "I reviewed N raw results and accepted 0…", Aria (only if it was in the plan): "Skipped — no accepted leads to rank", Pilot: short recommendation. Each carries the matching `agent_slug` + metadata.
- No-results in the final-step block (L908): Scout speaks the "reviewed X raw results, none matched" line; Pilot adds the recommendation.
- Post-lead success card (L988): Scout speaks the "reviewed/accepted" line; Pilot speaks the short coordinator wrap-up ("I opened the results in Workbench…"); the `ui_panel` + `post_lead_actions` payload moves onto the Pilot wrap-up message so the existing Workbench auto-open still fires. Both messages carry `metadata.agent_id`.
- Handoff activity rows (L806, L562) already record `from_agent_slug` / `to_agent_slug`; no change.

In `supabase/functions/pilot-chat/index.ts`, audit every hard-coded `agent_slug: "pilot"` insert and change those that represent Scout/Aria/Hawk/Penn/Scribe work to use the correct slug. The plan-announcement message (L194) and clarification/safety messages stay as Pilot. Add `metadata.agent_id` alongside `agent_slug` on every assistant insert so the frontend ownership chain is unambiguous.

### 3. Card-action handlers speak as the right agent

When the user clicks a post-lead pill, the chat handler dispatches a new message. Update the action→agent map in the relevant pilot-chat branch (around L290–L430 and L1490–L1665):

- `find_decision_makers` / `find_contacts` → Scout
- `rank` / `rank_by_fit` → Aria
- `enrich` / `research_company` → Hawk
- `draft_outreach` / `write_followup` → Penn (must keep `SafetyChip` and `draft_only: true`)
- `write_content` / `linkedin_post` → Scribe

Pilot may insert a one-line handoff message before chaining ("Handing this to Hawk."), then the agent's own message follows.

### 4. Execution plan rows + presence

- `ExecutionTaskRow`: when `agentSlug` is null, fall back to inferring from `task.payload.agent_slug` and finally `inferAgentFromContent(task.description ?? title)` before defaulting to Pilot, so a planning step that wasn't tagged doesn't masquerade as Pilot.
- `ExecutionPlanCard`: do not show Pilot as the row owner for sourcing/ranking steps — derive the badge from the plan-step `agent_slug` if `agentById[agent_id]` returns nothing.
- `AgentPresenceBar`: pulse only the agent whose task is currently `running` (driven by `tasks[].agent_id` resolved through the same mapping). Pilot stays present, but never pulses for Scout/Aria/Hawk work.

### 5. Legacy messages

For older rows in the conversation that were written with `agent_slug: "pilot"`, the new `inferAgentFromContent` fallback inside `ChatView` will retroactively re-attribute the bubble (Scout/Aria/Hawk/Penn/Scribe keywords). No DB write needed.

### 6. Safety / scope guarantees (unchanged)

- No DB migration, no schema change.
- No auto-send / DM / comment / email — Penn output stays `draft_only: true`, `SafetyChip` continues to render for `slug === 'penn'`.
- No landing-page edits.

## Files touched

```text
src/data/agentProfiles.ts                                     (+responsibilities)
src/lib/agentResolver.ts                                      (+inferAgentFromContent, ownership chain)
src/components/chat/workspace/ChatView.tsx                    (ownership chain, content fallback)
src/components/chat/workspace/plan/ExecutionPlanCard.tsx      (row slug fallback)
src/components/chat/workspace/plan/ExecutionTaskRow.tsx       (badge fallback, reaction chip slug)
src/components/chat/workspace/agents/AgentPresenceBar.tsx     (pulse correct agent)
supabase/functions/run-agent/index.ts                         (Scout/Aria/Hawk own their inserts; Pilot wraps)
supabase/functions/pilot-chat/index.ts                        (correct agent_slug + metadata.agent_id per insert; action→agent map)
```

## Acceptance / QA

After build + deploy of `run-agent` and `pilot-chat`:

- "Find 5 companies hiring GTM roles in B2B in USA" produces, in order: Pilot coordinator note → Scout "creating search strategy" → Scout "reviewed N, accepted X" → Aria "ranked against Company Brain" → Pilot "opened results in Workbench, recommended next step…". No bubble in this sequence reads "Pilot · Manager" except the first and last.
- ExecutionPlanCard step 1 row shows `Scout · Sourcing`, step 2 shows `Aria · Ranking`. Pilot only appears on coordination/wrap rows when present.
- "Find decision-makers" pill → Scout responds. "Rank by fit" → Aria. "Research these companies" → Hawk. "Draft outreach" → Penn (with `Draft only · Nothing sent`). "Write a LinkedIn post" → Scribe.
- Failed sourcing path emits Scout "accepted 0", Aria "Skipped", Pilot recommendation.
- Presence bar pulses Scout during sourcing, Aria during ranking — not Pilot.
- No new DB migrations created; no calls to outreach/email/DM webhooks added.
