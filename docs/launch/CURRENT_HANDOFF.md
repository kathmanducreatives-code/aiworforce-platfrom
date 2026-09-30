# CURRENT HANDOFF — Agentory launch hardening

Keep this short. No secrets. Last updated: 2026-09-30 13:55 UTC (LOCAL session — local is the active workspace; cloud paused).

Lives on branch `launch/handoff`, never on `launch/hardening`: Railway auto-deploys the worker on every
push to `launch/hardening`. (PR #3 carries an older cloud copy of this file — merging it would redeploy the worker.)

## CURRENT BRANCH / HEAD
- `launch/hardening` @ `c8e77333` (local checkout /Users/prasidha/agentory-launch-hardening = origin, clean).
- Frozen application release `a08ac0e4edea6f3aa54314db4efe0073e371b82f`; `a08ac0e4..c8e77333` = workflow file only.

## PRODUCTION SHAs (verified 2026-09-30 13:39 UTC)
| Surface | Expected | Actual | Status |
|---|---|---|---|
| Railway worker (deploy d9184736) | a08ac0e4 code | `c8e77333` (app code identical) | OK, polling, 0 claims |
| enqueue-lead-mission / resume-stalled-leads / continue-workflow / ops-health | a08ac0e4 | a08ac0e4 @ 09-29 13:09Z | OK |
| run-agent / orchestrate / pilot-chat | a08ac0e4 | a08ac0e4 @ 09-30 11:20Z | OK |

Deploy run 36707764429 succeeded; rollback artifact `pre-deploy-functions-36707764429` (encrypted, expires 2026-10-30).

## SECURITY
RLS on 127/127 public tables. Anon write privileges exist on 77 legacy tables, but every anon-reachable write
policy requires `auth.uid()` → no effective anon write. provision_workspace_for_user guards `auth.uid()`;
dev_table_counts/cancel_lead_mission not executable by anon/authenticated. beta_access_requests: RLS, 0 rows.
Credits: LEAD_CREDIT_ENFORCEMENT=enforce; e8af257d = 614, reserved 0. Allowlist LEAD_V2_WORKER_WORKSPACES = e8af257d only.

## FIRECRAWL
FIRECRAWL_USD_PER_CREDIT present on Supabase and Railway (Railway value parses as a positive number). FIRECRAWL_PRICE_TIER unset (optional).

## MONITORING
Ops health green (dispatch 36708445429). DB quiet since 2026-09-27 14:13 UTC: no new tasks/plans/queue rows/
provider calls/model calls/credit tx/messages. 0 open provider calls; queue 19 complete / 11 failed / 9 cancelled.

## FRONTEND (read-only, 2026-09-30)
- agentory.space: Lovable (185.158.133.1, Cloudflare edge = Lovable's CDN; DNS at Hostinger dns-parking).
  Its bundle talks to Supabase **wqnigjhcwjxtmordrwno** — the OLD Lovable-Cloud backend, NOT production
  `ohsdatpvfdjdemstoiuj`, not in the user's Supabase account. No /version.json. LAUNCH BLOCKER for public beta.
- Netlify teal-chimera-be7c79 (team-protected; builds feat/lead-mission-v2-worker ≈ b2c6fc1f incl. dashboard/Jev WIP)
  lacks a08's beta-request UI, Workbench terminal and continuation-truth fixes.
- Repo bug: `src/integrations/supabase/client.ts` default publishable key is wqnig's while the default URL is ohsdat —
  any build without VITE_SUPABASE_PUBLISHABLE_KEY cannot authenticate. Fix before any publish.
- Canary 1 does NOT need a publish: run the release frontend locally (launch/hardening checkout + gitignored .env.local → ohsdat).

## CANARY 1 (prepared, NOT run — needs explicit approval)
Workspace e8af257d. Pilot sentence: "Qualify https://www.linkedin.com/company/wordware. It must have raised Seed funding within the last 2 years."
Route: company details → Atomus → Pvalyou, ≈ $0.0278 provider. Stop > $0.04. Watcher: 601151e0…/scratchpad/salvo, WATCH_PROFILE=salvo (5/5 test suites pass).
Seed 2024-11-21 is inside 730 d until 2026-11-21.

## NEXT EXACT STEP
User approves Canary 1 → start local release frontend → arm watcher → run → audit. Separately: decide agentory.space publishing path.

## ACTIONS REQUIRING APPROVAL
Canary 1; any frontend publish/DNS/Netlify branch change; closing PR #3.
