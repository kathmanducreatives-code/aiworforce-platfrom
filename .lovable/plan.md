
## Scout Radar redesign for /signals

Goal: keep the current Signal Feed data pipeline intact, but rebuild the page UI so it's more readable, honest about provider status, and useful even when Apify billing is blocked. No new migrations, no fake data, all actions stay confirmation-gated.

### Files touched (UI only)

- `src/components/signals/SignalFeed.tsx` — restructure layout, larger typography, smarter empty state, new sections
- `src/components/signals/RadarSummaryCards.tsx` — provider-aware statuses + bigger numbers
- `src/components/signals/SetupNeededCard.tsx` — extend to support billing_issue / unavailable / coming_soon states
- `src/components/signals/SignalCard.tsx` — bump typography, surface source provider + credits-on-action
- New: `src/components/signals/ScoutPromptBox.tsx` — top prompt input + example chips + confirmation card
- New: `src/components/signals/TrustSummary.tsx` — reusable "last scan summary" block
- New: `src/components/signals/ManualSourceInput.tsx` — URL/text paste analyzer (uses existing Firecrawl edge if configured, otherwise setup-needed)
- New: `src/components/signals/ProviderBadge.tsx` — Ready / Setup needed / Billing issue / Unavailable / Coming soon pill
- `src/hooks/useIntegrationReadiness.ts` — extend types with `billing_issue` state (frontend-only mapping from existing reason strings such as "insufficient balance" / "402"); no backend change
- Optional: `src/lib/signalFeedModel.ts` — small helpers for confirmation-card copy (credits estimate, providers needed)

No changes to: `run-radar-scan`, `integration-readiness`, DB schema, RLS, migrations, secrets.

### 1. Typography and layout pass

Global bump on the page container:
- Page title 30px bold, subtitle 15px
- Radar card label 14px, number 38px bold, meta 12px
- Filter labels 14px, tab text 14px
- Signal card title 19px, body 14–15px
- Buttons 14px semi-bold
- More vertical rhythm between sections (`space-y-6`), section dividers with clearer headings

Keep Verdant palette + glassmorphism; no color changes.

### 2. Scout prompt box (top of page)

New component below header, above radar cards:
- Title: "Ask Scout what to watch"
- Textarea placeholder as specified
- Chip row with the 7 example prompts
- Submit opens a **confirmation card** (inline, not a run):
  - Estimated credits (derived from category mix, reuse existing estimate helpers)
  - Providers needed (from `useIntegrationReadiness`)
  - Providers unavailable / billing issue highlighted
  - "Nothing will be sent" safety line
  - Buttons: Start scan (calls `runRadarScan`) / Cancel
- Nothing runs before Start.

### 3. Smarter empty state

Replace the current "No signals match this review filter" block. Logic:
- If `reviewed.length > 0` and `filtered.length === 0`:
  - Show hidden-count line ("N signals are hidden by your current filters")
  - Explain: unverified or ignored
  - Buttons: Show unverified (toggles `showUnverified`), Clear filters (resets `reviewFilter`, `hideIgnored=false`, source/priority/query), Run fresh radar scan
- Else if `reviewed.length === 0`:
  - "No verified signals yet." + subtext + Run fresh radar scan + Review unverified

### 4. Provider-aware readiness

Combine `useIntegrationReadiness` (existing) with `lastRun.capabilities` (from `run-radar-scan`) to compute a per-category status:
- `ready` — provider connected AND capability true
- `setup_needed` — capability false, no reason mentions billing
- `billing_issue` — reason string contains `billing`, `payment`, `insufficient`, `402`
- `unavailable` — provider marked unavailable/blocked
- `coming_soon` — categories with no provider wired (e.g. `people` when nothing configured)

Rules: never show "Ready" without both signals confirming. When Apify is not ready, show the specified notice banner once above the radar grid.

### 5. Radar cards

Rework `RadarSummaryCards` to show for each category:
- Category name (14px)
- Big detected count (38px)
- `X verified · Y need verification` (using `show_by_default` flag already on signals)
- Last scanned relative time
- Provider name + `ProviderBadge`
- Short explanation
- If blocked: swap CTA to "Open integrations"; if ready: keep "Scan now"

### 6. Trust summary block

New `TrustSummary` component under radar cards. Reads `lastRun` + verified/unverified counts. Renders one of:
- Post-scan success: "Scout reviewed N raw results. A accepted. R rejected. Main reject reasons: …" (reasons derived from `per_category` statuses)
- No verified data yet: legacy summary message
- Provider failure: "Scout could not run this source. No credits were used."

Component is exported for reuse in Workbench later.

### 7. Manual source input

New `ManualSourceInput` section below trust summary:
- URL input + textarea
- Source type dropdown (5 options)
- Actions: Analyze source / Save as signal / Turn into lead
- If Firecrawl ready → call existing `firecrawl-scrape` edge function (no new backend), persist result via existing `signals` insert path only when a `source_url` is present (verified). No fake output; if no proof, show inline "Needs source proof to save."
- If Firecrawl not configured → render `SetupNeededCard` with "Open integrations" link. No calls, no credits.

### 8. Filters / tabs

- Add "Workflows" tab (maps to `workflow_trend`) and "Reviewed" tab (maps to `reviewFilter=reviewed`).
- Enlarge tab buttons (h-9, text-sm).
- Filter row order: Verified only · Show unverified · Hide ignored · Has source · Priority · Search.
- Default sort: verified first → priority desc → newest → hide ignored on.
- When `showUnverified` toggles on, show helper text: "Unverified signals may be missing source proof. Review before using them."

### 9. Signal cards

Bump typography in `SignalCard.tsx`; ensure display of:
- Title, type badge, priority
- Source URL (linkified) + source provider label
- Why it matters (from `raw.why_it_matters`)
- Matched ICP (from `raw.matched_icp`)
- Next action + estimated credits
- Action buttons: Save, Ignore, Mark reviewed, Turn into lead, Find decision-maker, Enrich company, Create content idea
- Any tool-invoking action opens the existing confirmation flow (reuse `chat:send` command dispatch — already gated).

### 10. Top CTAs

- Keep Run radar scan / Edit radar / Load more.
- Run radar scan opens a provider-aware panel (reuses the ScoutPromptBox confirmation card) that lists available + blocked sources, estimated credits, and safety note. Disabled state shown when no providers ready ("No signal providers are configured yet. Connect Apify or Firecrawl. Credits used: 0.").

### 11. Tests / validation

- Add unit tests under `src/components/signals/__tests__/` for:
  - Empty state chooses "hidden by filters" vs "no verified" branches
  - `ProviderBadge` maps reasons to `billing_issue` correctly
  - `ManualSourceInput` shows setup-needed when Firecrawl absent
  - Confirmation card shows credits = 0 when no providers ready
- Run:
  - `npx tsc --noEmit`
  - `npm run build`
  - `deno test supabase/functions/_shared --allow-all` only if a shared helper is touched (not planned)

### Out of scope

- No changes to `run-radar-scan` scoring, prefs, DB, RLS, or migrations
- No auto-send/DM/comment/post/email — every action stays behind the existing confirm dispatch
- No fake signals, no seeded rows, no mock providers
- Apify billing itself: once resolved upstream, all "billing_issue" cards will flip to "Ready" automatically because status is derived from live capability/readiness output
