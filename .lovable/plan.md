# Agentory Supabase Audit (Read-Only)

No writes, no deploys, no provider calls. Secret values withheld throughout.

## 1. Database project identity
- **Project ref:** `wqnigjhcwjxtmordrwno`
- **Hostname:** `https://wqnigjhcwjxtmordrwno.supabase.co`
- **Region (from pooler host):** `aws-1-ap-northeast-1` (Tokyo)
- **Instance size:** Tiny
- **Managed by:** Lovable Cloud (managed Supabase; no external BYO project)
- **Source of config:** `supabase/config.toml` (`project_id="wqnigjhcwjxtmordrwno"`), `.env` `VITE_SUPABASE_PROJECT_ID/URL`, and `src/integrations/supabase/client.ts` (same ref hardcoded as fallback).
- **Preview vs published:** Same project. Both `id-preview--…lovable.app` and `resume-ace-ai-29.lovable.app`/`agentory.space` use this ref.
- **Environment class:** **PRODUCTION.** Custom domain `agentory.space` is bound to it, and it is the only project referenced. There is no separate staging/dev backend.

## 2. Access paths available to me here
| Method | Available | Mode | Notes |
|---|---|---|---|
| Lovable Supabase tools (project-scoped) | Yes | RW | migration/deploy/secrets/logs/read_query |
| psql via sandbox `PG*` env | Yes | Select/Insert only (per instructions) | Cannot read `supabase_migrations.schema_migrations` (permission denied) |
| Edge Function deploy | Yes | Write | Scoped to this project |
| Supabase Dashboard | Not to me — user only |  |  |
| Supabase CLI locally | Not from sandbox |  | repo `config.toml` pins prod ref |
| Direct Postgres string | Withheld (contains password placeholder) |  |  |

## 3. Claude Code via Supabase MCP — recommended posture
- Project-scoped, read-only, OAuth (browser) — no pasted PAT.
- Conceptual URL (no token): `https://mcp.supabase.com/mcp?project_ref=wqnigjhcwjxtmordrwno&read_only=true`
- Requires the Supabase account owner (you) to authorize in-browser once.
- Read-only MCP can inspect: schemas, tables, RLS policies, migrations history, Edge Function metadata, logs, aggregate queries.
- Write actions (deploy, migrate, secrets, mutating SQL) require a second explicit authorization; grant only against an isolated TEST project.

## 4. Repo ↔ project link
- Repo `supabase/config.toml` pins `wqnigjhcwjxtmordrwno` (prod). No TEST link file in repo.
- Any local `supabase db push` / `functions deploy` without explicit `--project-ref` would hit **production**. Always pass `--project-ref zbwsbnqqpkvdhqwavjke` for TEST.

## 5. Schema inventory (76 public tables)
Grouped:

- **Auth/workspace:** `workspaces`, `workspace_members`, `profiles`, `clients` (multi-tenant), `google_calendar_tokens`.
- **Company Brain:** `company_brain` (jsonb profile per workspace), `company_brain_research_runs`.
- **Find Leads / agent loop:** `task_plans`, `tasks`, `tool_calls`, `agents`, `agent_runs`, `agent_capabilities`, `approvals`, `handoffs`, `activity_feed`, `lead_candidates`, `lead_enrichments`, `linkedin_leads`, `contacts`, `accounts`, `signals`, `signal_reviews`, `saved_outputs`.
- **Workbench actions / providers:** `scraping_sessions`, `firecrawl_scrape_logs`, `deep_search_results`, `deep_search_analysis`, `icp_lookalike_sessions`.
- **Signals adjacent:** `signals`, `signal_reviews`, `talent_signals`, `growth_signal_companies`, `competitor_*` (4), `job_market_intelligence`, `job_postings`, `job_distribution_*` (2).
- **Outreach:** `outreach_leads`, `outreach_drafts`, `outreach_sequences`, `outreach_activities`, `outreach_settings`, `email_tracking`, `scheduled_emails`.
- **Screening/interviews:** `screening_*` (7), `interview_*` (5), `interviews`, `candidate_*` (2), `resume_analyses`, `adaptive_screening_sessions`.
- **Collaboration/chat:** `conversations`, `messages`, `collaboration_*` (7), `candidate_notes`.
- **Content/marketing:** `marketing_tasks`, `pricing_history`, `client_active_positions`, `client_placements`, `workspace_sources`.

## 6. Migration & drift check
- Cannot read `supabase_migrations.schema_migrations` from sandbox role (permission denied) — needs MCP or Dashboard to confirm applied list.
- Git tip migration: `20260717170000_signals_storage_v2_hybrid.sql` (Signals V2 hybrid).
- **Drift signal:** DB does **NOT** contain the Signals V2 tables (`lead_evidence`, `signal_events`, `signal_event_evidence`, `engagement_events` — all absent) and `lead_candidates.evidence_id` column is **absent**.
  → The Signals V2 migration is **present in Git but not applied to production**.
- Find-Leads qualification tables (`task_plans`, `tasks`, `tool_calls`, `lead_candidates`, `contacts`, `accounts`, `approvals`, `activity_feed`, `signals`, `signal_reviews`) all present.
- Dedicated Workbench action-run / decision-maker persistence table: **absent** (decision-maker output currently lands in `lead_candidates`/`contacts` only — matches the earlier "0/4 succeeded" audit).

## 7. Edge Functions (28 present in repo)
Key: `run-agent`, `orchestrate`, `run-radar-scan`, `generate-company-brain-draft`, `chat-respond`, `pilot-chat`, `daily-brief`, `parse-resume`, `screen-candidate`, `adaptive-screening-chat`, `analyze-behavioral-signals`, `generate-screening-*` (2), `approve-and-continue`, `integration-readiness`, `tool-availability`, `job-feed`, `send-scheduled-emails`, `send-interview-invite`, `screening-notifications`, `google-calendar-*` (2), `saveResumeAnalysis`, `getResumeAnalysis`, `email-tracking`, `setup-company-brain`, `mcp`.
Per-function version/deployed-hash vs Git: not retrievable from sandbox tools — needs Dashboard or MCP `deployments` view.

## 8. Secret / flag presence (names only)
Present: `APIFY_API_TOKEN`, `APIFY_ACTOR_LINKEDIN_PROFILE_SCRAPER(+_FALLBACK)`, `APIFY_ACTOR_LINKEDIN_COMPANY_SCRAPER(+_FALLBACK)`, `APIFY_ACTOR_PEOPLE_SEARCH`, `APIFY_ENABLE_PEOPLE_SEARCH`, `RADAR_ENABLE_APIFY_JOBS`, `FIRECRAWL_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_AI_API_KEY`, `LOVABLE_API_KEY`, `RESEND_API_KEY`, and Supabase-injected keys.
- `APIFY_ENABLE_PEOPLE_SEARCH` present — effective on/off not verified in this audit (values not read).
- No `SIGNALS_V2` flag or workspace allowlist secret found → matches unapplied V2 migration.

## 9. RLS & isolation (from prior audits + schema)
- RLS enabled on every listed public table (policy counts non-zero in supabase-tables context).
- Workspace isolation via `has_workspace_access(uid, workspace_id)` security-definer helper; room membership via `is_room_member`; client scoping via `get_user_client_id`.
- `prevent_profile_role_change` trigger blocks non-service-role changes to `role` and `client_id` (privilege-escalation fix already applied).
- Known open warn: `email_tracking` INSERT policy permits forged events (previously flagged, not fixed).
- Live cross-workspace penetration test not run.

## 10. Auth & test user
- No dedicated synthetic test user/workspace has been created here. Real customer data lives in prod.
- To run authenticated flows, Claude would need to sign in via Supabase Auth API for a synthetic user and hold a short-lived JWT — never paste it into chat.

## 11. Data classification
- PII present in: `contacts`, `lead_candidates`, `linkedin_leads`, `outreach_leads`, `candidate_profiles`, `screening_applications`, `interviews`, `email_tracking`, `resume_analyses`.
- Raw provider payloads likely in JSONB on: `lead_enrichments`, `deep_search_results`, `firecrawl_scrape_logs`, `scraping_sessions`, `signals`.
- Test and production data are **mixed** in prod project (no separate env).
- No retention/deletion policy documented.

## 12. Backup / rollback
- Managed Supabase daily backups apply (Tiny tier — limited PITR).
- No documented migration-rollback or feature-flag-rollback runbook in repo.
- Edge Function rollback = redeploy prior source from Git.
- No environment-specific deployment protection — repo `config.toml` points at prod.

## 13. Parity vs isolated TEST `zbwsbnqqpkvdhqwavjke`
Not accessed. Conceptual parity table:

| Component | Prod (`wqnigjhc…`) | TEST (`zbwsbnqq…`) | Match |
|---|---|---|---|
| Migrations tip | Signals V2 **not** applied | Unknown | Unknown |
| Signals V2 schema | Absent | Unknown | Unknown |
| Workbench persistence | Absent | Unknown | Unknown |
| Edge Function versions | Deployed this session (run-agent, orchestrate, run-radar-scan, generate-company-brain-draft) | Unknown | Unknown |
| Apify actor vars | Set | Unknown | Unknown |
| `RADAR_ENABLE_APIFY_JOBS` | true | Unknown | Unknown |
| Company Brain data | Real customer brain | Should be synthetic | Mismatch expected |

## 14. Safest development model
**Recommendation: D — Hybrid.**
- Backend/migration work in isolated TEST (`zbwsbnqqpkvdhqwavjke`).
- Frontend integration testing in a second Lovable project bound to TEST.
- Controlled rollout (migration → function deploy → flag flip, workspace allowlist) into the live project only after TEST green.
Rationale: prod carries live customer PII, no PITR headroom on Tiny, and Signals V2 is unapplied — you need a real place to rehearse.

## 15. Claude access plan
- **Stage 1 (now):** Read-only project-scoped MCP against `wqnigjhcwjxtmordrwno` for schema/logs/migration inspection. Owner OAuth required.
- **Stage 2:** Write MCP granted **only** on `zbwsbnqqpkvdhqwavjke` (TEST) for migrations, function deploys, synthetic fixtures, controlled provider runs.
- **Stage 3:** Scoped write MCP on prod, one deploy at a time, feature flags OFF, workspace allowlist, explicit approval per action.

## 16. Final report (compact answers)
1. `wqnigjhcwjxtmordrwno` · 2. `wqnigjhcwjxtmordrwno.supabase.co` · 3. **Production** · 4. Lovable-managed · 5. Preview & published match · 6. Repo pins same ref · 7. Match · 8. Lovable tools + sandbox psql (SELECT/INSERT) · 9. MCP supported yes · 10. project-scoped read-only OAuth · 11. Owner authorization yes · 12. 76 public tables (inventory above) · 13. Latest applied: unknown (`schema_migrations` blocked) — Git tip `20260717170000_signals_storage_v2_hybrid` · 14. Drift: Signals V2 in Git, absent in DB · 15. Signals V2 schema: **NO** · 16. Workbench persistence schema: **NO** · 17. 28 edge functions listed · 18. run-agent version: unknown from sandbox · 19. orchestrate version: unknown · 20. Deployed matches Git: unknown · 21. Secret names listed above · 22. APIFY people-search: secret present, effective state unverified · 23. RLS coverage: all listed tables · 24. Workspace isolation via security-definer helpers, one known warn on `email_tracking` · 25. Test user: **no** · 26. Test workspace: **no** · 27. Test Company Brain: n/a · 28. PII + raw payloads across many tables · 29. Backups yes, no rollback runbook · 30. Parity vs TEST: unknown · 31. Model D (hybrid) · 32. Stage 1 (read-only) · 33. **Next step below** · 34. Lovable can fix: code, migrations, function deploys, secret names · 35. Requires MCP: applied-migration list, function version metadata, live schema diff · 36. Requires Dashboard owner: PITR/backup config, PAT issuance, MCP OAuth grant · 37. Production risk: **elevated** (Signals V2 drift + no test env + PII in prod) · 38. Dominant blocker: **no isolated environment with parity**.

### Decisive recommendation
**E — Staged combination, in this order:**
1. Grant Claude Code read-only Supabase MCP on `wqnigjhcwjxtmordrwno` (Stage 1).
2. Stand up parity in TEST `zbwsbnqqpkvdhqwavjke`: apply Signals V2 migration + deploy the four functions there, seed synthetic user/workspace/Company Brain.
3. Grant Claude write MCP on TEST only, rehearse the Signals V2 rollout + Workbench persistence work end-to-end.
4. Only then apply the same migration and function versions to prod under feature flag + workspace allowlist, with explicit per-step approval.

Nothing was changed. Awaiting your call on which stage to unlock first.
