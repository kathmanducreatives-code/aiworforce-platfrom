# Production baseline (read-only), 2026-11-12 ~15:55–16:20 UTC

Nothing in production was changed to produce this. The sources were:
- the Supabase Management API (functions, migrations, extensions);
- catalog-only SQL plus aggregate counts;
- unauthenticated `OPTIONS` requests to edge functions (the `x-agentory-build` header);
- the public `agentory.space` page and its JavaScript assets.

## 1. Frontend: `https://agentory.space`

| Fact | Evidence |
|---|---|
| Host | Cloudflare (`server: cloudflare`), deployment id `f249a448-e1ae-44d8-8b05-07a9d7870f20`; Lovable project (`.lovable/` in the repo, `lovable-tagger` in the build) |
| Entry asset | `/assets/index-DJ4Ua8jz.js` → `App-BcQg4Eam.js` and 2 more chunks (3.4 MB) |
| **Backend it talks to** | **`https://wqnigjhcwjxtmordrwno.supabase.co`**, hard-coded as the production URL in the bundle. The bundle's canonical map is `{production: "wqnigjhcwjxtmordrwno", test: "zbwsbnqqpkvdhqwavjke"}`. |
| **Commit** | **UNKNOWN** (Lovable records no SHA). The canonical-ref map and URL in the bundle match the repo only between `08dc2d73` (2026-07-21) and `5f662d66` (2026-08-16), so the live site is **about 3–4 months old**. |
| `wqnigjhcwjxtmordrwno`, `zbwsbnqqpkvdhqwavjke` | Both alive (`/auth/v1/health` → 401). **Neither is in the Supabase organization this release targets**: `list_projects` shows only `ohsdatpvfdjdemstoiuj`, `tlvnfrxzjhsjgdofwehb` and the paused `luvostyizefajbltukkc`. Probably Lovable-managed. Their users and data were not inspected. |
| `origin/main` | `15831aeb` (2026-05-22), older than the live bundle. Lovable is not simply publishing `main`. |

**Consequence:** the live website is **not connected to `ohsdatpvfdjdemstoiuj`**. Every backend change below is invisible on `agentory.space` until the frontend is republished against `ohsdatpvfdjdemstoiuj`.

## 2. Production backend `ohsdatpvfdjdemstoiuj` (agentory, ap-south-1, Postgres 17.6)

### Edge functions: live builds from `x-agentory-build`

| Function | Build | Built | Version (API) |
|---|---|---|---|
| `pilot-chat` | `86ac1b922f8519f75760642bb09cceef096168eb` | 2026-10-13 01:47 | v206 |
| `run-agent` | `e4da19e8828898f05414da953a13acb74c74e6a4` | 2026-10-13 08:59 | v274 |
| `orchestrate`, `enqueue-lead-mission`, `continue-workflow`, `resume-stalled-leads` | `b51ad3dddf2604f9d218d7c495e17e22d20932db` | 2026-10-11 06:46 | v116 / v9 / v53 / v50 |
| `ops-health`, `approve-and-continue`, `send-scheduled-emails` | `a08ac0e4edea6f3aa54314db4efe0073e371b82f` | 2026-09-29 | v2 / v37 / v37 |
| `daily-brief` (v47, 2026-09-11), `generate-company-brain-draft` (v44, 10-11), `setup-company-brain` (v49, 10-04), `run-monitoring-scan` (v110), `run-monitoring-tick` (v30), `run-radar-scan` (v50), `run-lead-action` (v42), `unlock-founders` (v65), `generate-content-image` (v10), `email-tracking`, `google-calendar-*`, `job-feed`, `tool-availability`, `integration-readiness`, `mcp` | **unstamped** (commit unknown) | Aug–Oct | see the API list |

**Not deployed:** `lead-pipeline`, `provider-connections`, `company-brain-memory`, `lisa-monitor`, `agent-collaboration`, `workforce-dashboard`, `firecrawl-scrape`, `provider-discovery`.

### Database

- **Migrations recorded:** 28 (latest `20261012132826 lead_mission_v2_productive_continuation_no_backoff`).
- **Repo migrations not recorded there:** 21, from `supabase/migrations`. Some of their objects exist anyway (for example `content_item` and `company_web_evidence`), so the **history is not authoritative**. Compatibility for this release was checked object by object (§4).
- **Extensions:** `pgcrypto` and `uuid-ossp` in `extensions`; `pg_cron`; `pg_net`.

### Data and activity (aggregates only)

| Item | Value |
|---|---|
| Auth users | **1**; last sign-in 2026-10-21; **0 sessions active in the last 7 days** |
| Workspaces / memberships | 3 / 1 (role `owner`); 2 workspaces have no member |
| Company Brain | 2 rows, both onboarded, last updated 2026-10-22 |
| Tasks / mission queue / messages | 178 / 61 / 607; **all last active 2026-10-13**; 0 open tasks |
| Model and provider ledger (`lead_execution_calls`) | 4,517 rows, last 2026-10-13; **$0 in the last 30 days** |
| Credits | 3 balances; 2,046 transactions, last 2026-10-13 |
| Outreach / scheduled email / calendar / connected secrets | 0 / 0 / 0 / 0 |
| Monitoring | 6 subjects; last monitoring run 2026-08-25 |
| **Cron (active)** | `monitoring-tick` every 15 min → `run-monitoring-tick`; `resume-stalled-leads` every 3 min → `resume-stalled-leads`; `sweep-stuck-runs` every 5 min (SQL); `release-stale-credit-reservations` every 10 min (SQL). All succeeding as of 15:55; no spend produced. |
| Secrets | **Names not readable from this session.** `deploy-production-release.sh --check` lists them, names only. |

### Security (confirmed)

**`lead_model_calls`:**
- no `security_invoker`, and owned by `postgres`;
- `anon` and `authenticated` hold **ALL** privileges on it.

On a production-shaped clone, anon read **and deleted** every workspace's spend rows through it.

**Browser writes:** **10 non-SELECT browser policies** on `signal_events`, `signal_event_evidence`, `monitoring_subjects` and `approvals` (`FOR ALL`). On the clone, a signed-in member inserted signals and updated approvals.

**Company Brain:** `company_brain_member_insert` and `_update` let **any member, viewers included, write the Brain from the browser**. The server-only writer migrations `20261023` and `20261024` are not applied.

## 3. TEST `tlvnfrxzjhsjgdofwehb` (unchanged by this release)

| Function | Build |
|---|---|
| `lead-pipeline` | `770383ea` |
| `provider-connections` | `b56c6570` |
| `pilot-chat` | v1 bundled, **unstamped** (pre-stamp builder) |
| `daily-brief` | v7, unstamped |

## 4. Compatibility of the release with production (checked)

- **Tables:** every table read by the 5 release functions exists in production, given the three Company Brain migrations.
- **Columns:** **all 151 literal `select` column references** exist in production (catalog query; zero missing).
- **RPCs:** `credits_reserve` and `credits_finalize` exist with the expected signatures. `company_brain_authorized_write` and `company_brain_write_authorization` come from `20261024`. The `client_brain_*` RPCs are reached only with `VITE_CLIENT_BRAINS` (off).
- **Browser reads:** the frontend does not read `lead_model_calls` or `lead_execution_calls` (grep), so the security fix breaks nothing.
