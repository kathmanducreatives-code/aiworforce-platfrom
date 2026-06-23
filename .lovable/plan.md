## Slack-style AI team chat — polish pass

Most of the team-chat plumbing already exists:
- `AGENT_PROFILES` + `PILOT_PROFILE` with the six local PNGs (`src/data/agentProfiles.ts`).
- `AgentAvatar` with broken-image fallback and pulse state.
- `AgentTypingIndicator` with per-agent verbs ("Scout is sourcing…", "Aria is ranking…", etc.).
- `agentResolver` with metadata-first + keyword inference fallback.
- `ChatView` already renders avatar + name + role chip per message; `ActivityTimeline` already uses agent avatars; `HandoffRow` exists; `PostLeadActionsCard` already renders as compact pills with the safety chip.

So this is a **visual/interaction polish pass**, not a rebuild. Backend/orchestration logic and DB are untouched. No production migrations. No auto-send behavior changes.

### What changes

1. **Per-agent accent in the chat bubble** (`src/components/chat/workspace/ChatView.tsx`)
   - Apply a subtle left-border + tinted background derived from `profile.accentHex` so Scout messages read blue, Aria violet, Hawk amber, Penn green, Scribe rose, Pilot emerald.
   - Keep the existing structured/plain split; only the chrome changes (no layout shift).

2. **Dedupe agent header** (`ChatView.tsx`, `src/components/chat/ChatBubble.tsx`)
   - Audit the name/role render path so the header is **"Pilot · Manager"** once, never **"Pilot \n Pilot · Manager"**. Guard against double-labelling when both `agentName` prop and metadata resolve to the same profile.

3. **AgentPresenceBar (new)** — `src/components/chat/workspace/agents/AgentPresenceBar.tsx`
   - Tiny horizontal strip of the six avatars (Pilot, Scout, Aria, Hawk, Penn, Scribe) shown in the chat workspace top bar.
   - State per avatar: `idle | thinking | running | done | blocked`, computed from the latest plan/task/activity for the active conversation (read-only via existing `usePlanDetail` / activity hooks; no new tables).
   - Active agent gets a soft accent pulse; others stay muted. Tooltip = "Name · Role · status".

4. **Inline handoff dividers in chat** (`ChatView.tsx`)
   - When two consecutive agent messages have different `agent_id`, insert a slim `HandoffRow`-style divider: `[Scout] → [Aria]  ·  handed off`. Reuse the existing `HandoffRow` component (relocate import).
   - One per transition, never stacked.

5. **Process rail on execution plan messages** (`src/components/chat/workspace/plan/ExecutionPlanCard.tsx`)
   - Add a thin left rail showing the ordered agent column for that plan (e.g. Pilot ↓ Scout ↓ Aria ↓ Pilot) with the currently-running step highlighted.
   - Pure presentational; derived from the existing `tasks` array's `agent_id` order.

6. **Agent reaction chips on completed steps** (`ExecutionTaskRow.tsx`)
   - When a task is complete, render a tiny outcome chip next to the agent badge using the agent's accent:
     - Scout → "{n} qualified" / "0 accepted"
     - Aria → "Ranked" / "Skipped"
     - Hawk → "Researched" / "Needs domains"
     - Penn → "Draft ready" / "Blocked — no contact"
     - Scribe → "Written"
   - Falls back silently when counts aren't available.

7. **"Nothing sent" safety chip** consolidated
   - Keep the existing chip in `PostLeadActionsCard`; reuse the same tiny chip component for Penn-authored draft messages in `ChatView` so the badge looks identical everywhere instead of repeated long copy.

8. **ChatBubble parity** (`src/components/chat/ChatBubble.tsx`)
   - Bring the older `ChatBubble` (used by `PlanningThread` / `DirectAgentView`) to the same Slack-style look: accent-tinted bubble, single header, AgentAvatar with fallback.

### What is explicitly NOT touched

- No DB migration. No edits to `supabase/` SQL or `supabase/functions/chat-respond/index.ts` workflow logic.
- No changes to `ChatComposerPro`, `LeadSourceCard`, `LeadIntakeCard`, `ClarificationCard`, Workbench data hooks, or the actor/source planner.
- No new outreach/email/DM behavior. Penn stays draft-only and approval-gated.
- Landing page untouched.

### File map

```text
edit   src/data/agentProfiles.ts                      # add bubbleClass tokens
edit   src/components/chat/workspace/ChatView.tsx     # per-agent accent + handoff divider + dedup
edit   src/components/chat/ChatBubble.tsx             # accent + dedup parity
edit   src/components/chat/workspace/plan/ExecutionPlanCard.tsx
edit   src/components/chat/workspace/plan/ExecutionTaskRow.tsx  # reaction chips
edit   src/components/chat/workspace/ChatWorkspace.tsx          # mount AgentPresenceBar
new    src/components/chat/workspace/agents/AgentPresenceBar.tsx
new    src/components/chat/workspace/agents/AgentProcessRail.tsx
new    src/components/chat/workspace/bubbles/SafetyChip.tsx
```

### QA after build

- Send any prompt → assistant message renders once with `Name · Role`, no duplicate.
- Lead sourcing prompt → presence bar pulses Scout, then Aria, then settles on Pilot; chat shows handoff divider between Scout and Aria; execution plan card shows the process rail.
- Penn draft message shows the "Draft only · Nothing sent" chip once (not paragraph copy).
- Broken `<img>` simulated → AgentAvatar falls back to initials, no broken-image icon.
- Activity timeline still shows per-agent avatars/colors (unchanged).
- Compact result pills under Pilot's summary unchanged; no giant action card returns.
- Workbench auto-open, lead source selector, intake form, clarifications, and same-chat continuity all still work.
