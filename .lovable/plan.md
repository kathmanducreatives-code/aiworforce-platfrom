
# Agent Builder v2 — Cinematic Character Creator

Rebuild the Agent Builder as a full-screen, two-column experience that feels like crafting a living AI employee. Backend, edge functions, and the existing `createAgent` contract are untouched — the new UI is purely a visual and UX rewrite that maps onto the same Supabase insert.

## What stays the same (do not touch)

- `supabase/functions/*` and any edge function code
- `src/lib/orchestration.ts` `createAgent(...)` signature and DB schema
- `useAgentBuilder` open/close pub-sub API (`openAgentBuilder`, `closeAgentBuilder`)
- Realtime agent subscription on the `agents` table
- Existing pages, routes, and dock behavior outside the builder itself

## What changes

### 1. Replace the slide-over with a full-screen takeover

- New file: `src/components/agents/AgentBuilderModal.tsx` — replaces the current `SlideOverPanel`-based `AgentBuilderPanel.tsx`.
- Mounted from `src/components/MainLayout.tsx` (swap the import; same `<AgentBuilderModal />` placement).
- A fixed `inset-0 z-[80]` overlay with backdrop blur and pitch-black wash.
- Centered cinematic frame (`max-w-[1280px]`, glassmorphic, rounded-2xl) split 40 / 60 with `framer-motion` mount animation (fade + slight scale).
- Escape and outside-click after step 2 trigger an in-modal exit confirm: "Abandon this agent? Your progress will be lost." with Keep building / Discard.

### 2. Left column — Live Character Card (40%)

New file: `src/components/agents/builder/v2/CharacterCard.tsx`. Pure presentational, driven by current form state.

- Large circular avatar (size ~160px) with chosen identity color and the first letter of the name in white. Pulses softly when empty.
- Name in display font below; fades + scales in once Step 1 is valid.
- Department pill (color-mapped using `deptDot`/`deptText` from `agentProfiles.ts`) slides in after Step 2.
- "Brain" excerpt card (first ~140 chars of role prompt) reveals after Step 3.
- Model badge with provider logo from `aiModelLogos.ts` reveals after Step 4.
- Capability chips row reveals after Step 5 (each chip = capability name).
- Tool badges row reveals after Step 6.
- Skill icon grid reveals after Step 7.
- Bottom: "Agent Readiness" circular SVG progress ring filling green as steps complete (`completedSteps / 7 * 100`).
- All reveals use a small `Reveal` wrapper (framer-motion `initial={{opacity:0, y:8, scale:0.96}} animate={...}`).

### 3. Right column — Step Engine (60%)

New file: `src/components/agents/builder/v2/StepShell.tsx` handles:

- Top progress bar with 7 dots + labels (Identity, Department, Role, Model, Capabilities, Tools, Skills). Completed = green filled, current = pulsing emerald, future = dim. Clicking a completed dot jumps to that step.
- Animated step container using framer-motion `AnimatePresence` with horizontal slide between steps.
- Fixed Back / Next footer. Keyboard: Enter / ArrowRight = Next (when valid), ArrowLeft = Back, Escape = exit confirm.

Each step is its own file under `src/components/agents/builder/v2/`:

| Step | File | Notes |
|---|---|---|
| 1 Identity | `Step1Identity.tsx` | Large autofocused name input + 8-color swatch row (emerald, violet, blue, amber, coral, teal, pink, slate). Hover previews on character card via local hover state lifted into form. |
| 2 Department | `Step2Department.tsx` | 5 large cards (Talent / Growth / Intelligence / Content / Operations). Each shows existing agents from `AGENT_PROFILES` filtered by department as small avatar stack; Operations shows "Be the first." Selected card: emerald border + glow. |
| 3 Role | `Step3Role.tsx` | Large textarea, 3 starter template chips (Sourcing / Outreach / Research) that fill the textarea, char counter with 50-char minimum, tip card. |
| 4 Model | `Step4Model.tsx` | 2x2 grid of large model cards (Claude Haiku, Claude Sonnet, GPT-4o, Gemini Pro). Each: provider logo, name, speed dots, cost $-signs, "Best for" line, conditional "Recommended for [department]" emerald badge. Selected card: glowing border in provider brand color. Maps to existing `AgentModelKey` strings stored in DB. |
| 5 Capabilities | `Step5Capabilities.tsx` | 3-column table (capability, input, output) with up to 8 rows + delete button. Below: "Examples for [department]" section with 3 click-to-add chips per department (full lists per the spec). |
| 6 Tools | `Step6Tools.tsx` | 6 tool cards in 2 columns (Firecrawl, Web Search, Email Sender, Slack, ElevenLabs Voice, Webhook). Each: icon, name, one-liner, toggle. "Requires API key" amber badge where relevant (Firecrawl, Email, Slack, ElevenLabs). Webhook reveals a URL input when toggled on. Skip-for-now link. Stored as string array (`tools`) and a `tool_config` JSON kept locally for the next step. |
| 7 Skills | `Step7Skills.tsx` | Masonry-ish grid of skill cards (Firecrawl Scraping, Web Search, Email Writing, Candidate Scoring, Content Writing, Research & Analysis, Competitor Monitoring, Lead Enrichment). Equip button toggles to "Equipped" (emerald). Each card has an inline accordion "Configure" panel with 2-3 fields specific to the skill. Equipped count surfaces as a badge on the step dot. |

### 4. Deploy screen + animation

New file: `src/components/agents/builder/v2/DeployScreen.tsx`.

- After step 7, show a centered enlarged Character Card + 4-section summary (Identity / Brain / Capabilities / Equipped Skills with config in small gray text under each chip).
- Large full-width emerald "Deploy Agent" button with subtle pulse.
- On click: call existing `createAgent(...)` from `src/lib/orchestration.ts` with the same payload shape used today (skills + tool_config are kept in local form state but only `tools: string[]` and `capabilities` are passed to the existing API to avoid backend changes).
- Play deployment animation: framer-motion `motion.div` with `layoutId` flies the avatar from the deploy screen down to the dock position (target = bounding rect of the dock; computed once on click).
- Then show success state: "{Name} has joined your workforce" + which department room, plus two buttons: "Go to {Department} room" (router push to `/department/{dept}`) and "Build another agent" (resets the wizard).

### 5. Department roster section

Edit `src/pages/DepartmentRoom.tsx`:

- Add a new `AgentRoster` block at the top, just below the existing quick action bar.
- Uses existing `useAgents()` hook (or `fetchAgents` + the existing realtime subscription on `agents`) filtered by current `department`.
- Each roster card: colored avatar circle (first letter), name, model badge, status dot (idle/running) using `deptDot` mapping.
- Click → opens an Agent profile side panel (reuse existing slide-over component used elsewhere; if none exists for agents, render a minimal `Sheet` that shows name, department, model, role prompt, capabilities; this is purely a UI surface, no new backend).
- "New" green badge for 24h post-`created_at`.
- New agent appears automatically because the agents subscription already invalidates the list.

### 6. Cleanup / housekeeping

- Keep old wizard files (`Step1Identity.tsx`…`SuccessScreen.tsx`, `AgentBuilderPanel.tsx`) until the new modal is wired in `MainLayout.tsx`, then delete them in the same change.
- No changes to `useAgentBuilder.ts` API.
- No changes to `supabase/`, `.env`, types, or edge functions.

## Technical details

- Framework: existing React + Vite + Tailwind + framer-motion + shadcn/ui — no new deps.
- Color tokens: keep using semantic `bg-background`, `text-foreground`, plus `emerald-500` for accents, per the Verdant theme memory.
- Identity color swatches map to a `SWATCHES` constant `{ key, ring, bg, dot }` so the character card can render without re-deriving Tailwind classes from raw hex.
- Skills + tool config are stored only in local builder state (UI-only). They are NOT persisted to the DB in this pass to honor "do not touch backend." A short TODO comment will note where to plug them in once a `agent_skills` table is added.
- All animations respect `prefers-reduced-motion` (framer-motion `useReducedMotion`).
- Mobile (<768px): the modal collapses to a single column; the Character Card becomes a compact sticky header above the step content. Per memory: full-screen Dialog, zero horizontal scroll.

## File map

```text
src/components/agents/
  AgentBuilderModal.tsx                (new — replaces AgentBuilderPanel)
  builder/v2/
    CharacterCard.tsx
    ReadinessRing.tsx
    StepShell.tsx
    StepDots.tsx
    Step1Identity.tsx
    Step2Department.tsx
    Step3Role.tsx
    Step4Model.tsx
    Step5Capabilities.tsx
    Step6Tools.tsx
    Step7Skills.tsx
    DeployScreen.tsx
    constants.ts          (swatches, model meta, dept recommendations,
                           capability examples, tool list, skill catalog)
src/components/department/
  AgentRoster.tsx         (new — used by DepartmentRoom)
src/components/MainLayout.tsx           (swap import to AgentBuilderModal)
src/pages/DepartmentRoom.tsx            (mount <AgentRoster department=...>)
```

Old files removed at the end of the change:
`src/components/agents/AgentBuilderPanel.tsx` and the contents of `src/components/agents/builder/` (Step1…SuccessScreen, StepProgress).

## Out of scope

- Persisting skills, skill configs, tool API keys, or webhook URLs to Supabase.
- Changing the Sidebar entry, dock entry, or `openAgentBuilder()` call sites — they continue to work unchanged.
- Any orchestration / model-routing logic.
