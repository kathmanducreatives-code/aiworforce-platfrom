# Plan: Refresh Codebase Audit

The existing `/mnt/documents/codebase-audit.md` is from 2026-05-19 and predates Pass 1/2/2.5 UI work and the Deep Space token overhaul. I'll regenerate it as a fresh factual inventory.

## Scope

Produce a single replacement `codebase-audit.md` with these sections:

1. **Routes & Pages** — every route in `src/App.tsx`, with component, auth, and status (working / partial / placeholder).
2. **Sidebar & Navigation** — current `Sidebar.tsx` items, grouping, and link targets.
3. **Persistent UI shell** — `MainLayout`, `CommandDock`, `AuthenticatedBackground`, removed legacy bars (`GlobalChatBar`, `OperativeDock`, `HeroCommandSurface`).
4. **Design System State** — Deep Space tokens in `index.css` + `tailwind.config.ts`: `--space-*`, `--ink-*`, `--emerald-*`, glass tiers, shadows, motion utilities. Note which components have adopted them vs still using legacy classes.
5. **Database** — tables grouped by domain (auth/profiles, candidates/jobs, screening, ICP, talent/competitor intel, collaboration, outreach, plans/agents), with RLS status from latest migrations.
6. **Edge Functions** — every function in `supabase/functions/` with one-line purpose, model used (per AI Model Standard memory), and verify_jwt setting.
7. **Hooks, Services, Contexts** — inventory under `src/hooks`, `src/services`, `src/contexts` with one-line purpose.
8. **External Integrations** — n8n webhooks, Firecrawl, Resend, Google Calendar, Lovable AI Gateway providers.
9. **Known Limitations / Tech Debt** — orphaned routes, obsolete `Dashboard.tsx` variants, static "ready" agent states, hardcoded suggestion chips, mocked data sources (pulled from memory references).
10. **Recent Changes (last ~3 passes)** — Pass 1 tokens, Pass 2 hero (removed), Pass 2.5 CommandDock consolidation, Deep Space visual overhaul.

## Method

- Read-only exploration: `src/App.tsx`, `src/components/Sidebar.tsx`, `src/components/MainLayout.tsx`, `src/index.css`, `tailwind.config.ts`, `supabase/functions/` directory listing, `src/pages/` listing, `src/hooks/`, `src/services/`, `src/contexts/`.
- Cross-reference project memory index for known limitations and deprecated components.
- No DB migrations or new queries — use existing `src/integrations/supabase/types.ts` for table inventory.

## Deliverable

Overwrites `/mnt/documents/codebase-audit.md` with a dated, factual inventory (no recommendations, matching the existing document's tone). Emits a `<presentation-artifact>` so you can preview the refreshed version.

No code changes. No DB changes. No dependencies.
