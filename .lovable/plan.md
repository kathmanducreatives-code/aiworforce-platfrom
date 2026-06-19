# Slack-style AI Employee Chat — Implementation Plan

Goal: every assistant/workflow message, plan card, handoff, and Activity log shows the correct agent's profile picture (Scout/Aria/Hawk/Penn/Scribe) using the PNGs already in `src/assets/agents/`. Pilot keeps a premium "P" initials avatar (no remote/base64). No backend changes.

## 1. Single source-of-truth profile config

Update `src/data/agentProfiles.ts` (do **not** create a duplicate file):

- Add a `pilot` profile entry with `image: null` (Pilot has no PNG), `department: 'operations'`, `role: 'Manager'`, model unchanged or omitted.
- Add fields per profile: `accent` (existing dept hex/tailwind), `description` (short blurb), `fallback` initial.
- Make `AgentProfile.image` `string | null`; update existing consumers that assume non-null (small grep pass — `AgentAvatar`, `dockAgents.ts`, etc.) to handle null via initial fallback.
- Continue exporting `AGENT_BY_ID` / `AGENT_BY_NAME`, plus a new helper `resolveAgent(slugOrName)` that lowercases and falls back to Pilot.

This becomes the only place avatars/roles are defined.

## 2. New shared `AgentAvatar` for the chat workspace

Add `src/components/chat/workspace/agents/AgentAvatar.tsx`:

- Props: `slug`, `size` (`xs|sm|md|lg`, default sm = 28px), `status?: 'idle'|'thinking'|'running'|'done'|'blocked'`, `ring?: boolean`.
- Renders circular `<img src={profile.image}>` when present; otherwise a tinted initials circle using the existing dept hex (Pilot uses emerald "P").
- Adds subtle dept-accent ring and an optional animated pulse glow when `status` is `thinking`/`running`.
- Uses `onError` to fall back to initials so a missing/broken file never shows a broken image icon.

Re-export from `@/components/chat/workspace/agents` for easy imports. The existing `src/components/agents/AgentAvatar.tsx` is left alone (used by /agents pages).

## 3. Slack-style chat bubbles (`ChatView.tsx`)

Replace the local `InitialCircle` with `AgentAvatar`:

- Each assistant message renders: avatar (sm), then header row with `Name` + dept-colored `· Role` chip, then bubble body.
- Group consecutive messages by same `agent_slug`: avatar + name only on the first; subsequent messages indent and skip the header (Slack-style).
- Typing indicator uses `AgentAvatar` for the agent currently expected to reply (derive from latest plan step / `agentSlug` prop, default Pilot).
- Keep bubble styles (glass for structured, plain text otherwise) — only the identity row changes.
- Agent resolution order per message: `metadata.agent_id` → `metadata.agent` → `m.agent_slug` → workflow-step heuristic (`source_*`→scout, `rank_*`/`score_*`→aria, `enrich_*`/`research_*`→hawk, `draft_*`/`outreach_*`→penn, `content_*`/`report_*`→scribe) → Pilot.

Add a tiny helper `src/lib/agentResolver.ts` for that resolution (pure function, unit-friendly).

## 4. Execution plan card + handoff row

- `src/components/chat/workspace/plan/AgentBadge.tsx`: swap the letter circle for `<AgentAvatar size="xs" />`; keep the colored name label.
- `src/components/chat/workspace/bubbles/HandoffRow.tsx`: already uses images via `profileById`; extend to render Pilot fallback when `from`/`to` resolves to pilot. Add a small "Pilot → Scout → Aria → Pilot" caption when the parent passes a chain.
- `AgentBubble.tsx` (used by structured agent bubbles) keeps its avatar but routes through `AgentAvatar` for consistency.

## 5. Workbench Activity timeline

`src/components/chat/workspace/workbench/ActivityTimeline.tsx`:

- Read `a.agent_id` / `a.metadata?.agent` from `DBActivity`; resolve via `resolveAgent`.
- Replace the green dot bullet with a 20px `AgentAvatar` aligned on the timeline rail.
- Title rewritten as "{AgentName} {verb}" (Scout searched LinkedIn Jobs, Aria ranked 5 accounts, Pilot opened Workbench) using a small map keyed by `event_type`.
- Empty state copy stays.

## 6. Compact post-result pills (already partly done)

Confirm `PostLeadActionsCard.tsx` renders compact pills only (no giant card). Add a Pilot avatar + one-line completion sentence above the pills using `AgentAvatar size="xs"`. No logic changes to `dispatchChatAction`.

## 7. Agent presence bar (optional, low-risk addition)

If room exists in the Workbench header / chat header, add `AgentPresenceBar` (new, ~60 lines) that lists Pilot, Scout, Aria, Hawk, Penn, Scribe as small avatars with a status dot derived from current plan tasks (`useWorkbenchData`). Hidden on narrow widths. Skip if header is already crowded — gated behind viewport width check.

## 8. QA / verification

- `bun run typecheck` (no `image` null regressions).
- Browser QA the five flows listed in the prompt (Lead, Decision-makers, Research, Draft, Content) and check avatars render from local PNGs; Pilot stays as initials.
- Force a broken `image` to verify `onError` initials fallback (dev-only manual check).
- Confirm no remote URLs / base64 introduced (`rg "data:image|https?://.*\\.png" src/data src/components/chat`).

## Out of scope

- No backend/edge-function changes.
- No new image assets; Pilot stays as initials.
- No changes to `dispatchChatAction` / `dispatchResultAction` logic, lead workflow, or conversation continuity.
- `src/components/agents/AgentAvatar.tsx` and `src/components/workforce/AgentAvatar.tsx` left untouched (different surfaces).

## Files touched

- edit `src/data/agentProfiles.ts` (add pilot, allow null image, helpers)
- new `src/lib/agentResolver.ts`
- new `src/components/chat/workspace/agents/AgentAvatar.tsx`
- edit `src/components/chat/workspace/ChatView.tsx`
- edit `src/components/chat/workspace/plan/AgentBadge.tsx`
- edit `src/components/chat/workspace/bubbles/AgentBubble.tsx`
- edit `src/components/chat/workspace/bubbles/HandoffRow.tsx`
- edit `src/components/chat/workspace/bubbles/PostLeadActionsCard.tsx`
- edit `src/components/chat/workspace/workbench/ActivityTimeline.tsx`
- (optional) new `src/components/chat/workspace/agents/AgentPresenceBar.tsx`
