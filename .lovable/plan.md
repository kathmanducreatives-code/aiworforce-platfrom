# Phase 1.6 — Canonical Agent Visuals & Public Attribution

Presentation-only. No backend/orchestration/prompt/DB/deploy changes.

## Approved assets (from uploads)
- Atlas → dark-haired male, no glasses, purple-blue glow
- Orion → male with glasses, teal glow
- Mira → brunette woman, magenta glow
- Pilot → keep current
- Nova → neutral placeholder (no approved asset)
- "Lisa" (blonde) → stored but unused

## 1. Asset pipeline
Upload the 3 approved images via `lovable-assets` CLI into a canonical structure:

```
src/assets/agents/public/
  atlas-avatar.png.asset.json
  atlas-portrait.png.asset.json
  orion-avatar.png.asset.json
  orion-portrait.png.asset.json
  mira-avatar.png.asset.json
  mira-portrait.png.asset.json
  pilot-avatar.png.asset.json    (re-point to existing pilot asset)
  pilot-portrait.png.asset.json
  nova-placeholder.png.asset.json (neutral glyph — generated)
  unknown-agent.png.asset.json   (neutral silhouette — generated)
```

Avatar = face/shoulders crop, no name banner. Portrait = larger character composition.

For Atlas/Orion/Mira the same source is used for both avatar and portrait (single upload, referenced twice) — cropping handled via CSS `object-position` in `AgentAvatar` / portrait components.

Generate two neutral placeholders (Nova + unknown fallback) with `imagegen--generate_image`: geometric Agentory glyph on dark background, no human likeness.

## 2. Registry update (`src/config/agentRegistry.ts`)
Extend `PublicAgentProfile` with:
```ts
avatar: string;         // small circular UI
portrait: string;       // large surfaces
cardImage?: string;
objectPosition?: string; // e.g. 'center 20%'
fallbackInitial: string;
isPlaceholder?: boolean; // Nova = true
```
Point each public id at its `agents/public/*` asset. Legacy files (`scout.png` etc.) stay on disk for historical rows but are no longer imported by public components.

Add `UNKNOWN_AGENT` profile with neutral asset — must not fall back to Pilot.

## 3. Resolver + component updates
- `src/lib/agentResolver.ts`: unknown/null/malformed slugs → `UNKNOWN_AGENT` (not Pilot).
- `src/components/agents/AgentAvatar.tsx` and `src/components/chat/workspace/agents/AgentAvatar.tsx`: read `avatar` + `objectPosition` from resolver; onError → neutral initial container (never Pilot).
- Sweep every component in the spec's audit list (AgentBadge, AgentIdentity, WorkforceDock, OperativeDock, ChatBubble, PlanDetailView, ExecutionTaskRow, AtlasPanel, AtlasEmptyState, DepartmentCard, MeetYourAITeamSection, onboarding, etc.) and replace any direct `scout.png`/`aria.png`/`hawk.png`/`penn.png`/`scribe.png` imports with registry lookups.

## 4. Public copy sweep
Ripgrep user-visible strings for `Scout|Aria|Hawk|Penn|Scribe` across `src/**` (excluding `__tests__`, backend prompts referenced from frontend only as opaque IDs). Classify each and rewrite public occurrences:
- Scout→Nova, Aria/Hawk→Atlas, Penn→Mira, Scribe→Orion or neutral "Agentory content workspace".
- `departmentConfig.ts` titles/subtitles updated.
- Content generation surfaces attributed to Scribe internally → publicly labeled "Agentory content workspace" / "Draft prepared for review" (do NOT re-attribute generic content to Orion).
- Retained legacy strings (backend slugs, execution keys, test fixtures) documented in the final report with file/line/reason.

## 5. Scribe/Orion separation
Orion's public copy scoped to operational surfaces (approvals, pipeline briefings, next-action recs). Any content-draft UI currently badged Scribe becomes neutral "Agentory content workspace" until a canonical owner is chosen.

## 6. Tests (`src/config/agentRegistry.test.ts` + new)
Add cases:
- Nova avatar path does not contain `scout`
- Atlas avatar path does not contain `aria` or `hawk`
- Mira avatar path does not contain `penn`; asserts brunette canonical id
- Orion avatar path does not contain `scribe`
- Unknown/null/empty/malformed slug → `UNKNOWN_AGENT`, not Pilot
- All legacy slugs still resolve to correct public profile
- Public components' asset paths route through registry (snapshot of resolved paths)

## 7. Validation
Run in order and report exit codes:
1. `bunx tsgo --noEmit`
2. Scoped lint on all files touched across Phase 0/1/1.5/1.6
3. `bunx vitest run src/config src/lib/agentResolver` + component tests
4. Full `bunx vitest run`
5. `bun run build`
6. Playwright visual QA against localhost: Dashboard, Agents, Lead Library, Awaiting You, Workflows, Chat, Plan detail, Workbench, Department, Landing AI team, Onboarding — screenshots into `/tmp/browser/phase16/`.

## 8. Deliverables
Final report covering all 22 required items (assets supplied/missing, canonical paths, removed/retained legacy references, fallback impl, Scribe/Orion correction, per-route QA screenshots, all validation results, files created/modified, branch, git status, no-backend/no-DB/no-deploy confirmations, verdict).

## Constraints reaffirmed
No edits to `supabase/functions/**`, prompts, orchestration, schemas, records, `run-agent`, or publish. Legacy image files remain on disk. Backend `agent_slug` values untouched.

## Technical notes
- Assets uploaded via `lovable-assets create --file /mnt/user-uploads/<name> --filename <canonical>.png > src/assets/agents/public/<canonical>.png.asset.json`, then imported as JSON modules and used via `asset.url`.
- Nova + unknown placeholders generated with `imagegen--generate_image` (transparent bg, neutral Agentory glyph) then externalized via `lovable-assets`.
- Verdict expected: **visually complete for Atlas/Orion/Mira/Pilot; Nova flagged `isPlaceholder`; safe for draft PR; blocked-from-"complete" until Nova approved asset supplied.**
