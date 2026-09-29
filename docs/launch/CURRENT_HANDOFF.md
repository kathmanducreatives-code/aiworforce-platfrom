# CURRENT HANDOFF — Agentory launch hardening

Keep this short. No secrets. Last updated: 2026-09-29 23:20 UTC (local session).

This file lives on branch `launch/handoff`, NOT on `launch/hardening`: Railway
auto-deploys the worker on every push to `launch/hardening`, so a doc-only
commit there would redeploy production.

## CURRENT BRANCH
- Release branch: `launch/hardening` @ `ccd454c9` (merge of PR #1, the deploy workflow).
- Frozen application release: `a08ac0e4edea6f3aa54314db4efe0073e371b82f`.
  `a08ac0e4..ccd454c9` changes only `.github/workflows/deploy-held-back-functions.yml`.
- Handoff branch: `launch/handoff` (based on `ccd454c9`, only this file added).

## CURRENT HEAD
- `origin/launch/hardening` = `ccd454c9`. PR #1 was MERGED 2026-09-29 16:49 UTC (CI green).
- The merged workflow checks out `a08ac0e4edea6f3aa54314db4efe0073e371b82f` (verified).

## PRODUCTION SHAs (verified 2026-09-29 23:15 UTC)
| Surface | Actual |
|---|---|
| Railway worker (deploy 24fe425c) | `ccd454c9` (the same app code as a08ac0e4), polling |
| enqueue-lead-mission, resume-stalled-leads, continue-workflow, ops-health | `a08ac0e4` |
| run-agent, orchestrate, pilot-chat | OLD (pre-release, no build header) |

## MIGRATIONS APPLIED
lock_down_definer_rpcs, revoke_anon_writes_on_workspace_tables, beta_access_requests (2026-09-29).

## SECURITY STATUS
verify-rls 7/7 (2026-09-29). Anon is denied the definer RPCs, and 0/48 workspace tables are anon-writable.

## DEPLOYMENT STATUS
The workflow "Deploy held-back functions (production)" has NEVER run. It is BLOCKED; see BLOCKERS.

GitHub environment `production`: created 2026-09-29 23:1x UTC via the API.
- Required reviewer: kathmanducreatives-code. prevent_self_review is off; admin bypass is off.
- The only allowed branch is `launch/hardening`.
- It has NO SECRETS YET.

The user's earlier secrets and protections were put on the Railway-created environment
`resplendent-embrace / production`. The workflow does NOT use that environment.

## FRONTEND STATUS
agentory.space is served by Lovable (a publish from about 2026-08-02) behind Cloudflare. It isn't built from any current branch. Not re-investigated yet.

## MONITORING STATUS
The scheduled Ops health runs are green (latest 36622401629).
DB: 157 tasks, and the last task and the last provider call were on 2026-09-27. No calls in the last 24h. The queue has nothing open (19 complete / 11 failed / 9 cancelled), and 0 beta requests.

## LAST COMPLETED STEP
Reverified the state, created and protected the GitHub `production` environment, and checked Firecrawl pricing (it is missing).

## NEXT EXACT STEP
Once both blockers are cleared, dispatch:
`gh workflow run deploy-held-back-functions.yml --repo kathmanducreatives-code/aiworforce-platfrom --ref launch/hardening -f confirm_sha=a08ac0e4`
The user then approves the gate, and the session watches the run. It must not rerun on failure.

## BLOCKERS
1. The `production` environment has no secrets. The user must add `SUPABASE_ACCESS_TOKEN` and `ROLLBACK_ARCHIVE_KEY` (Settings → Environments → production).
2. `FIRECRAWL_USD_PER_CREDIT` is unset on Supabase and on Railway. The workflow precondition fails without it.
   - The Firecrawl API shows planCredits=1000 per month, remainingCredits=7068, and a period starting 09-19.
   - No invoice was found, so the rate is not proven.
   - The user must read the amount paid and the credits received from the Firecrawl invoice.

## ACTIONS REQUIRING MY APPROVAL
- Setting the Firecrawl rate (the value comes from the user's invoice).
- The production gate approval on the deploy run.
- Canary 1 (not prepared yet; do not run it).
