# CURRENT HANDOFF — Agentory launch hardening

Keep this short. No secrets. Last updated: 2026-09-30 15:05 UTC (LOCAL session — local is the active workspace; cloud paused).

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

### Canary 1 attempt 1 — 2026-09-30 13:57 UTC: REFUSED at compile, $0, nothing started
- Conversation 7ead031d. Pilot reply: "couldn't turn it into a run I can safely execute", `mission_compilation_blocked`, `url:known_companies[0]`.
- No plan, task, queue row, provider call or credit movement. Balance 614.
- RELEASE DEFECT (reproduced offline on a08ac0e4): `scanProposalForViolations` (leadMissionCompiler.ts) takes the user's slug with trailing punctuation.
  - "…/company/wordware. It must…" yields the slug `wordware.`, so the normalized page URL `…/company/wordware` is refused.
  - Any sentence with a period or comma right after a LinkedIn company URL fails the same way.
- The same sentence with "—" after the URL passes the scanner offline.
- Benign, pre-existing: the resume-stalled-leads tick reports `terminated: 1` every 3 min.
  - It's task a7a9371d (complete + continuation_required). The guarded update no-ops (`not_ready_anymore`) but is counted as terminated.
  - No writes. It leaves the 30-day window at about 2026-09-30 16:38 UTC.

### Canary 1 attempt 2 — 2026-09-30 14:37–14:45 UTC: FAILED (search_exhausted / PARTIALLY_SATISFIED), $0.0041
- Sentence with "—" after the URL. conv c8a9aee0, plan 24269c8a (key start:c1feae90…), queue c62a38f1, task 9982ca62.
- Spend: 1 paid call (company details $0.0041, settled from the receipt) plus 2 replays at $0. Model ≈ $0.0021. 1 credit (614 → 613).
- No stop rule fired. Writes stayed in e8af257d only. Exactly 1 plan and 1 queue row.
- ROOT CAUSE: LinkedIn now redirects /company/wordware to "Sauna by Wordware" (/company/saunabywordware/, id 99950244, 54 staff).
  - The details record carries originalQuery=/wordware but linkedinUrl=/saunabywordware, so it never attached to the company key.
  - Enrichment stayed `empty`, the company was never evaluated, and the claim verifier never ran (Atomus READY, tried:false).
- DEFECT 2: auto-continuation `verification_required` re-dispatched 3 barren slices until search_exhausted. This is the same gate bug seen on 2026-09-24.
- DEFECT 3 (Chat truthfulness):
  - At 14:39:53, mid-run, Chat said "I couldn't run the search … Nothing was charged". False: 1 credit was charged and the run continued.
  - No chat message followed the real terminal at 14:45. The checkpoint notice was resolved "failed" while the run was still going.
  - Workbench says "1 still being checked" after terminal.
- Minor: the stage label quotes "e — it must have raised Seed", and the card title reads "Find 1 companies in b2b saas…".
- Duplicate Start: server OK (1 plan per key). After a reload the UI shows "Started" and no Start button.

## HOTFIX RELEASE (in progress, 2026-09-30 ~15:05 UTC)
- Branch `hotfix/canary1-defects`, PR #4 → launch/hardening. Release commit `e1014c94`; workflow re-pin `bc528d61`.
- It fixes all four Canary 1 defects: slug punctuation, redirected LinkedIn page matching, answered enrichment counted as tried, and the refusal notice.
- Tests: canary1Regressions 7/7; edge suite 8118/0; infra 90/0; deno check clean.
- Affected surfaces (measured with deno info): run-agent and pilot-chat (edge, via the gated workflow), and the Railway worker (auto-deploys on merge). Everything else stays a08ac0e4.

## NEXT EXACT STEP
1. PR #4 CI green → merge. Railway then redeploys the worker at the merge commit (same app code as e1014c94).
2. `gh workflow run deploy-held-back-functions.yml --repo kathmanducreatives-code/aiworforce-platfrom --ref launch/hardening -f confirm_sha=e1014c94`
   - The user approves the production gate.
   - The run deploys run-agent → verify → pilot-chat → verify → SHA report → ops-health.
   - On failure: STOP and do not rerun.
3. Verify production, then re-run Canary 1 on a company whose LinkedIn slug does not redirect.
   - Wordware can also serve as the redirect regression, but only with approval.
4. Revert the temporary `agentory-release-canary` entry in agentory-main-local/.claude/launch.json when canaries are done.

## ACTIONS REQUIRING APPROVAL
Canary 1; any frontend publish/DNS/Netlify branch change; closing PR #3.
