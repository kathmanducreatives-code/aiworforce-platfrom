# CURRENT HANDOFF — Agentory launch hardening

Keep this short. No secrets. Last updated: 2026-09-30 11:40 UTC (cloud session).

This file lives on branch `launch/handoff`, NOT on `launch/hardening`: Railway
auto-deploys the worker on every push to `launch/hardening`, so a doc-only
commit there would redeploy production.

## CURRENT BRANCH
- Release branch: `launch/hardening` @ `c8e77333` (merge of PR #2).
- Frozen application release: `a08ac0e4edea6f3aa54314db4efe0073e371b82f`.
  `a08ac0e4..c8e77333` changes only `.github/workflows/deploy-held-back-functions.yml`
  (PR #1 added it; PR #2 made the backup cleanup `sudo rm -rf`, because the
  Docker-downloaded files are root-owned).

## PRODUCTION SHAs (verified 2026-09-30 11:20–11:25 UTC)
| Surface | Expected | Actual | Status |
|---|---|---|---|
| Railway worker | a08ac0e4 code | `c8e77333` (same app code; only the workflow file differs) | OK, healthy |
| enqueue-lead-mission | a08ac0e4 | `a08ac0e4` @ 2026-09-29T13:09:15Z | OK |
| resume-stalled-leads | a08ac0e4 | `a08ac0e4` @ 2026-09-29T13:09:15Z | OK |
| continue-workflow | a08ac0e4 | `a08ac0e4` @ 2026-09-29T13:09:15Z | OK |
| ops-health | a08ac0e4 | `a08ac0e4` @ 2026-09-29T13:09:15Z | OK |
| run-agent | a08ac0e4 | `a08ac0e4` @ 2026-09-30T11:20:15Z (v264) | OK, verify_jwt on |
| orchestrate | a08ac0e4 | `a08ac0e4` @ 2026-09-30T11:20:15Z (v113) | OK, verify_jwt on |
| pilot-chat | a08ac0e4 | `a08ac0e4` @ 2026-09-30T11:20:15Z (v197) | OK, verify_jwt on |

Also stamped `a08ac0e4`: approve-and-continue and send-scheduled-emails.
`firecrawl-scrape` is not deployed (no header). Other functions are pre-stamping and outside this release.

## DEPLOYMENT
- The workflow "Deploy held-back functions (production)" is gated by the GitHub
  `production` environment (required reviewer; launch/hardening only).
- Run #1 (36679195108) failed at the backup cleanup (root-owned files) BEFORE
  any deploy. Production was unchanged.
- Run #2 (36707764429) succeeded: backup → deploy → verify for all three →
  SHA report → ops-health (warn level) OK.
- Rollback artifact: `pre-deploy-functions-36707764429`
  (AES-256/PBKDF2 with the ROLLBACK_ARCHIVE_KEY env secret; expires 2026-10-30).
  It holds run-agent v263, orchestrate v112 and pilot-chat v196 as they were before the deploy.
- A GitHub API quirk: the single-run view lagged the gate approval by hours;
  the run list was accurate.

## MIGRATIONS / SECURITY (verified 2026-09-30 11:25 UTC)
- lock_down_definer_rpcs, revoke_anon_writes_on_workspace_tables and beta_access_requests are applied.
- 0/7 privileged RPCs are browser-callable, 0/49 workspace tables are anon-writable, and 0/127 tables have RLS off.
- beta_access_requests: RLS on, no anon access, 0 requests.

## LEDGER
- The 29 legacy `started` provider_call rows (2026-08-24..09-03) were closed on
  2026-09-29 as `timed_out` / `legacy_orphan_reconciled`. Costs were left unknown and nothing was deleted.
- 0 open provider calls now.

## FIRECRAWL
- `FIRECRAWL_USD_PER_CREDIT` exists on Supabase (checked by name in run #2; the value was never printed).
- On Railway it was set by the user; this session cannot see Railway variables.
- No Firecrawl call has run since 2026-09-27, so the priced basis (`account_rate`)
  is not yet observed on a ledger row. The first Firecrawl call after this will show it.

## MONITORING
- ops-health is OK (warn level) at 11:25 UTC: queue empty, 0 stale tasks, 0 unsettled calls, $0 spend in 24h.
- Scheduled runs fire irregularly (GitHub cron). Run it by hand around changes.
- DB: no tasks, ledger rows or credit transactions created on 2026-09-30, so no canary or provider call ran.
  Credits: e8af257d = 614, reserved 0.

## FRONTEND (read-only audit, 2026-09-30)
- agentory.space and www both resolve to `185.158.133.1`, which is Lovable's custom-domain
  edge IP. Lovable serves it.
- Cloudflare is at most DNS for this record: a proxied record would resolve to Cloudflare IPs.
- The last Lovable commit is `495fc8c5` "Lovable update", 2026-08-02, on
  `feat/lead-mission-v1` / `p6-claim-driven`. It is NOT in `a08ac0e4`'s history;
  411 frontend files differ.
- The release frontend builds `/version.json` (COMMIT_REF on Netlify, else git);
  the Lovable build predates that.
- This cloud session cannot reach agentory.space (egress policy), so the live bundle
  was not read directly.
- Nothing has been published.

## NEXT EXACT STEP
1. Frontend: decide the publishing path (see the chat recommendation). Nothing is published yet.
2. Canary 1: prepared, NOT run. It waits for the user's explicit approval.

## ACTIONS REQUIRING APPROVAL
- Any frontend publish or DNS change.
- Canary 1 and every later rung.
