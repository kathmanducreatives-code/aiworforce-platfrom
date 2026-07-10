# Company Brain Fix 2 — Confirm & Deploy

## Read-only audit results

1. **Latest main SHA:** `306edf8ab0e7a5a275cc902908320fb4822e5c78` — "Company Brain Fix 2: enforce ICP in Radar and shared brain context". Workspace is on latest main.
2. **Fix 2 files present:**
   - `supabase/functions/run-radar-scan/index.ts` ✅
   - `src/lib/signalFeedModel.ts` ✅
3. **run-radar-scan enforcement logic present:** references `setup_required`, `brain_confidence`, ICP fields (hiring_roles/industries/geographies/pain_points/disqualifiers), gates scan when `input.setup_required || input.urls.length === 0` (line 240), returns `brain_confidence` and `setup_required` in output.
4. **signalFeedModel Top-Signal safety present:** legacy row branch (line 210+) forces `quality: "legacy"` / `"Legacy / Needs verification"` when no scorer verdict and no score, preventing inflation into Top Signals.

## Deployment steps

1. **Verify secrets exist** (read-only via `secrets--fetch_secrets`):
   - `RADAR_ENABLE_APIFY_JOBS` = true
   - `APIFY_API_TOKEN`
   - `FIRECRAWL_API_KEY`
   (These already appeared in project context; re-confirm without exposing values.)

2. **Deploy edge function** `run-radar-scan` only, via `supabase--deploy_edge_functions(["run-radar-scan"])`. Project ref: `wqnigjhcwjxtmordrwno` (connected Cloud project).

3. **Publish frontend** via `preview_ui--publish` so `src/lib/signalFeedModel.ts` legacy-row safety ships to the live site. Pre-publish: run `security--get_scan_results`; if stale/critical, surface before publishing.

## Explicitly NOT doing

- No Company Brain v2 migration (pending file left untouched).
- No onboarding wizard changes.
- No RLS changes.
- No secret creation/rotation.
- No provider runs (Apify/Firecrawl/Scout Radar scan).
- No `run-agent` deploy or other edge functions.
- No new feature work.

## Report after deployment

Deployed SHA · frontend published (y/n) · run-radar-scan deployed (y/n) · project ref · `RADAR_ENABLE_APIFY_JOBS=true` confirmed · no migration applied · no provider scan run · onboarding wizard unchanged.
