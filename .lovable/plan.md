## Company Brain Onboarding v3 — Deployment Plan

Sequential steps against Supabase project `wqnigjhcwjxtmordrwno`.

### 1. Apply migration `20260710120000_company_brain_research_runs.sql`
Creates `public.company_brain_research_runs` (workspace-scoped audit trail for research provider calls) with indexes, RLS, and a member-SELECT policy using existing `public.is_workspace_member`.

**Amendment required before running:** the file is missing the mandatory `GRANT` block for public-schema tables. Add, in the same migration, immediately after `CREATE TABLE`:
```sql
GRANT SELECT ON public.company_brain_research_runs TO authenticated;
GRANT ALL    ON public.company_brain_research_runs TO service_role;
```
No `anon` grant (member-only reads). Writes stay service-role-only (edge functions), as the file's comment already specifies. No other migrations applied.

### 2. Deploy edge function `generate-company-brain-draft`
Single deploy via `supabase--deploy_edge_functions(["generate-company-brain-draft"])`. Do NOT deploy `run-agent`, `run-radar-scan`, or anything else.

### 3. Verify secrets exist (read-only)
Call `secrets--fetch_secrets` and confirm presence (values never shown) of:
`APIFY_API_TOKEN`, `FIRECRAWL_API_KEY`, `ANTHROPIC_API_KEY` or `LOVABLE_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
From last audit these are all present; re-confirm.

### 4. Actor env vars
Check for `APIFY_ACTOR_LINKEDIN_PROFILE_SCRAPER` and `APIFY_ACTOR_LINKEDIN_COMPANY_SCRAPER` in the secrets listing.
- If missing: stop and ask you for the actor slugs (e.g. `apify/linkedin-profile-scraper`) before setting them via `secrets--set_secret`. I will not invent slugs.
- If present: report as set.

### 5. Publish frontend
Run `security--get_scan_results` first; if clean, call `preview_ui--publish` so the new 5-step Company Brain onboarding UI goes live at the existing Lovable URL.

### Guardrails (explicit no-ops)
No provider calls (Apify / Firecrawl / Scout Radar), no `run-agent` / `run-radar-scan` deploys, no outreach sends, no RLS changes beyond the new table's policy, no Account A branch work, no Commit 4B, no other migrations.

### Final report will include
1. deployed SHA (`4c32167939fc00a97ae692f67009f0a2f0997eb9`)
2. migration applied (yes / with GRANT amendment)
3. `generate-company-brain-draft` deployed (yes)
4. frontend published (yes + URL)
5. project ref used (`wqnigjhcwjxtmordrwno`)
6. required secrets present (list)
7. actor env vars status (set / needs values from you)
8. confirmation no provider run happened
