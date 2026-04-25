# Wire Real Agent Photos & AI Logos Across the Product

## 1. Asset extraction & placement
- Copy `user-uploads://agents.zip` and `user-uploads://logos.zip` into `/tmp/`, unzip them, and move the normalized images into the project:
  - `src/assets/agents/` → `aria.png`, `scout.png`, `penn.png`, `hawk.png`, `scribe.png`
  - `src/assets/ai-logos/` → `openai.png`, `claude.png`, `gemini.png`, `firecrawl.png`, `elevenlabs.png`
- Verify each file decodes correctly (image dimensions printed during script).

## 2. Centralized data registries (new files)
- `src/data/agentProfiles.ts` — single source of truth per agent: `id`, `name`, `role`, `department`, `image` (imported asset), `model` key. Re-export `deptColor` map (emerald → Talent, blue → Growth, amber → Intel, violet → Content).
- `src/data/aiModelLogos.ts` — model registry: `gpt-4o`, `claude-sonnet`, `claude-haiku`, `gemini-pro` with `label`, `logo` (imported asset), `pillClassName`.
- `src/data/aiToolLogos.ts` — tool registry for the builder: `web-scraping` (Firecrawl), `voice` (ElevenLabs).

## 3. Update `src/data/dockAgents.ts`
- Switch `DockModel` union to `'gpt-4o' | 'claude-sonnet' | 'claude-haiku' | 'gemini-pro'`.
- Reassign per spec: Scout → `gpt-4o`, Aria → `claude-sonnet`, Penn → `claude-haiku`, Hawk → `gemini-pro`, Scribe → `claude-sonnet`.
- Add `image` field referencing imported asset (or read from `agentProfiles.ts`).
- Keep `deptColor` and existing rings/borders intact (no logic changes).

## 4. New reusable components
- `src/components/agents/AgentAvatar.tsx` — circular `<img>` with department-colored ring; sizes `sm` (32px), `md` (48px), `lg` (96px), `xl` (160px); status dot overlay; graceful fallback to initial if image missing.
- `src/components/agents/ModelBadge.tsx` — pill: 16–20px logo + label, themed via `pillClassName`.
- `src/components/agents/PoweredByStrip.tsx` — horizontal logo strip used on landing.

## 5. Replace initial-letter avatars
- `src/components/dock/OperativeDock.tsx` → use `AgentAvatar size="md"` with department ring.
- `src/components/dock/AgentHoverCard.tsx` → swap `{agent.name[0]}` block for `AgentAvatar size="md"`; replace `modelBadge` text pill with `<ModelBadge>`.
- `src/components/dock/AgentDrawer.tsx` → larger `AgentAvatar size="lg"` in header, `<ModelBadge>` in "Powered by" row.
- `src/components/dashboard/HandoffFeedItem.tsx` → 32px `AgentAvatar size="sm"` next to log entries (resolve agent by name/id; fallback initial when agent not in registry).
- `src/pages/AwaitingYou.tsx` → same 32px treatment in inbox rows.

## 6. Landing page upgrades
- `src/components/landing/MeetTheTeamSection.tsx` → render the 5 agent portraits as large circular avatars (xl), name + role caption, department ring color. Preserve existing War Room scroll-pinned animation by only swapping the avatar visual, not the layout/keyframes.
- `src/components/landing/AgentBuilderSection.tsx` → 
  - Model selector cards now show real logos via `ModelBadge` (OpenAI / Claude / Gemini).
  - Tools grid renders Firecrawl logo on the "Web Scraping / Deep Search" tool card and ElevenLabs logo on the "Voice / Audio" tool card.
- `src/components/landing/ToolLogos.tsx` → migrate any external CDN URLs to local imports for the 5 logos we now own.
- Add a `<PoweredByStrip>` underneath the hero or "Meet the team" section.

## 7. Department ring color map (per spec)
- Talent (Aria, Scout) → emerald `ring-emerald-500/70`
- Growth (Penn) → blue `ring-blue-500/70` (matches existing token; spec says "electric blue")
- Intelligence (Hawk) → amber `ring-amber-500/70`
- Content (Scribe) → violet `ring-violet-500/70`
(These already exist in `dockAgents.ts` `deptColor` — reused as-is.)

## 8. Verification
- Run `bunx tsc --noEmit` to confirm types compile after the `DockModel` union change.
- Visual smoke: dock avatars render with rings, hover card shows photo + model logo, landing "Meet the team" shows portraits, agent builder shows real model & tool logos.
- Confirm no remaining `{agent.name[0]}` initial-letter placeholders in dock/drawer/feed.

## Files created
- `src/assets/agents/{aria,scout,penn,hawk,scribe}.png`
- `src/assets/ai-logos/{openai,claude,gemini,firecrawl,elevenlabs}.png`
- `src/data/agentProfiles.ts`
- `src/data/aiModelLogos.ts`
- `src/data/aiToolLogos.ts`
- `src/components/agents/AgentAvatar.tsx`
- `src/components/agents/ModelBadge.tsx`
- `src/components/agents/PoweredByStrip.tsx`

## Files modified
- `src/data/dockAgents.ts`
- `src/components/dock/OperativeDock.tsx`
- `src/components/dock/AgentHoverCard.tsx`
- `src/components/dock/AgentDrawer.tsx`
- `src/components/dashboard/HandoffFeedItem.tsx`
- `src/pages/AwaitingYou.tsx`
- `src/components/landing/MeetTheTeamSection.tsx`
- `src/components/landing/AgentBuilderSection.tsx`
- `src/components/landing/ToolLogos.tsx`

## Out of scope (intentionally untouched)
- No backend / Supabase / RLS changes.
- No route changes.
- No GSAP keyframe rewrites in `ExpertJourney.tsx` or scroll-pinned War Room timing — only avatar visuals swap.
