# CURRENT HANDOFF — Agentory launch hardening

Keep this short. No secrets. Last updated: 2026-10-01 08:45 UTC (LOCAL session — local is the active workspace; cloud paused).

Lives on branch `launch/handoff`, never on `launch/hardening`: Railway auto-deploys the worker on every
push to `launch/hardening`. (PR #3 carries an older cloud copy of this file — merging it would redeploy the worker.)

## FRONTEND STATUS (2026-10-01 08:45 UTC)
- CURRENT PRODUCTION FRONTEND: 75e589d7 (Netlify deploy 6abd40f86cf8213b37602285; /version.json read via the signed-in pane).
- LATEST LAUNCH/HARDENING: e5dd77e3 (PR #8 merge, 2026-10-01 08:43 UTC; tree identical to the tested 86bf6644).
  - PR #8 makes each locked Workbench cell use its own resting text (Outreach "No draft yet" instead of "Not researched").
  - It builds on 69496c34 (PR #7, lead_enrichments columns). Frontend only; worker/function code is unchanged since e1014c94.
- RAILWAY (08:44 UTC): deployment 6b460df5 for e5dd77e3 is WAITING (it starts after the post-merge CI). The worker is still healthy on 69496c34 (b9dabc44), and the worker code is identical either way.
- NETLIFY STATUS: the production deploy of 69496c34 was SKIPPED, because the account has exhausted its production deployment credits.
  - e5dd77e3 is expected to be skipped the same way (not verified from here; Netlify is not readable without the user's session). Nothing was published; no bypass was attempted.
- PR #7 STATUS: merged and LOCALLY VERIFIED (local app :8083 on 69496c34):
  - The dashboard checklist went from 2/5 to 3/5; "Enrich companies" is now completed.
  - The app's own lead_enrichments request returns 200 with 173 rows (166 with summaries), selecting only real columns.
  - 106 Supabase requests across 6 pages: 0 errors, no 42703.
  - Workbench research VISUALLY VERIFIED (2026-10-01).
    - Feathery (conv 3a1f55cf), Qualified tab: the Company research cell reads "The webpage promotes a comprehensive data intake…".
    - That is the newest lead_enrichments row (09-18 14:31). The text is in no lead_candidates field, so only the fix could surface it (via bestSummary → row.enrichment_summary).
  - Fuse AI is NOT a valid example: it is pending (In review cards, no lead table), so no research cell renders.
  - Known cosmetic issue, pre-existing: UnlockCell's resting text is always "Not researched", so the locked Outreach cell is mislabelled.
- BUILD STATUS: npm run build OK. dist/version.json = 69496c34. Only ohsdat (6 refs), 0 wqnig, anon key only, 0 service_role.
- TEST STATUS:
  - leadEnrichmentsSchema 7/0; frontend deno 601/0; node 5/0.
  - tsc 23 = baseline; eslint 1281 = baseline.
- FUTURE NETLIFY DEPLOY TARGET: branch launch/hardening @ e5dd77e3 (= the latest approved head; supersedes 69496c34).
  - If more approved fixes merge first, use the newest launch/hardening head instead.
- NEXT ACTION: when Netlify credits are available, publish launch/hardening @ e5dd77e3.
  - Build: npm run build. Publish dir: dist.
  - Verify /version.json afterwards.

## LEAD ENRICHMENTS UI FIX (2026-10-01)
- PR #7 MERGED as 69496c34 at 08:15 UTC (parents 75e589d7 + 3389288c; tree identical to the tested PR head).
  - Frontend only: useLeadResults/DashboardChecklist read real lead_enrichments columns; there is a new helper and test; the eslint baseline is now 1281.
- Railway worker deploy b9dabc44 is on 69496c34, polling. No worker or function code changed.
- Functions are unchanged (e1014c94 / a08ac0e4). The DB schema is unchanged (last migration 20260929130722).
- Netlify: deploy preview https://deploy-preview-7--teal-chimera-be7c79.netlify.app (built from 3389288c, the same code).
  - The production-branch build of 69496c34 must NOT be published until the user has tested the preview.
  - The published production deploy should still be 75e589d7 (not re-verified: the pane's Netlify navigation was denied).

## LAUNCH GATE SNAPSHOT (2026-09-30 17:00 UTC) — BETA VERDICT: NOT BETA READY

CURRENT PROD FRONTEND SHA
- agentory.space: the OLD Lovable build (deployment f249a448, no /version.json), talking to the old backend wqnig.
- Netlify teal-chimera-be7c79: VERIFIED 2026-10-01 via the signed-in pane. /version.json sha 75e589d7, context production, deploy 6abd40f86cf8213b37602285.
  - The bundle names only ohsdatpvfdjdemstoiuj (URL and anon key) and has 0 wqnig references.
  - It contains the new isSameOriginRelativePath; the old inline guard is gone.
  - Still behind team protection.

CURRENT BACKEND SHAs
- run-agent and pilot-chat: e1014c94.
- orchestrate, enqueue-lead-mission, resume-stalled-leads, continue-workflow, ops-health: a08ac0e4.
- Railway worker: 42bf1b63 (the same worker code as e1014c94).

AUTH URL STATUS
- Changed 2026-09-30 ~16:50 via the Management API.
  - site_url: http://localhost:3000 → https://agentory.space.
  - uri_allow_list: (empty) → exact paths /onboarding/company-brain and /reset-password on agentory.space and on teal-chimera-be7c79.netlify.app. No wildcards, no localhost, no www.
- Still open:
  - No custom SMTP (the built-in mailer allows 2 emails/hour).
  - Sign-up requires email confirmation.
  - The live sign-up/reset email test has not been done.
- OPEN REDIRECT found: /auth?next=/%5Cevil.com → https://evil.com after sign-in. Fix PR #6 MERGED as 75e589d7 (2026-09-30 16:58 UTC). It is live only once that Netlify deploy is PUBLISHED; agentory.space still serves Lovable.

DNS STATUS
- Hostinger DNS.
- The apex A record is 185.158.133.1 (Lovable edge). TLS is valid for the apex only (expires 2026-11-01).
- www: CNAME to the apex; HTTPS handshake fails and HTTP returns 409 (broken).
- No MX/TXT records.
- Netlify has no custom domain yet. The cutover is NOT done.

CANARY 1 RESULT
- PASS, 2026-09-30 15:29–15:33 UTC. Salvo Software, release e1014c94, run through the LOCAL release frontend (:8083).
- IDs: plan 94360450, task 2ec15881, queue 96b7662a.
- $0.0278 settled from receipts; SATISFIED; 1 lead written.
- Not repeated on 2026-09-30 17:00: the Phase 2 domain check failed, and a second paid canary was not allowed.

OPS HEALTH
- OK, no alerts (run 36747750754).
- Queue empty, 0 open or unsettled calls, credits 610.

NEXT ACTION (blockers, in order)
1. DONE: the Netlify production deploy is at 75e589d7 (open-redirect fix live on teal-chimera; agentory.space is still Lovable).
2. Configure custom SMTP in Supabase Auth, then do the live sign-up and reset email test.
3. In Netlify:
   - Add the agentory.space and www custom domains.
   - Publish the release deploy.
   - Turn off team protection.
   - Verify /version.json on the netlify.app URL.
4. DNS cutover at Hostinger (plan: docs/launch/frontend-publishing-plan.md), then verify the domains.
5. Production-domain smoke: sign-in → Pilot card, $0. Then decide whether Canary 1 must be repeated through agentory.space.
6. Decide what happens to old wqnig accounts.

## CURRENT BRANCH / HEAD
- `launch/hardening` @ `42bf1b63` (PR #5; the app backend code is still e1014c94) (local checkout /Users/prasidha/agentory-launch-hardening = origin, clean).
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

## HOTFIX RELEASE e1014c94 — DEPLOYED 2026-09-30 15:24 UTC
- PR #4 merged as c6038c67 at 15:07. Railway worker deploy b0d1348e = c6038c67 (same app code as e1014c94), SUCCESS, polling.
- Gated run 36734756701: approved by kathmanducreatives-code, all steps succeeded.
  - Rollback artifact: pre-deploy-functions-36734756701 (holds run-agent v264 and pilot-chat v197; expires 2026-10-30).

| Surface | Expected | Actual | Status |
|---|---|---|---|
| Railway worker | e1014c94 code | c6038c67 (b0d1348e) | OK, polling, 0 errors |
| run-agent | e1014c94 | e1014c94 @15:24:01Z (v265) | OK, JWT enforced (401 without auth) |
| pilot-chat | e1014c94 | e1014c94 @15:24:01Z (v198) | OK, JWT enforced |
| orchestrate | a08ac0e4 (unchanged code) | a08ac0e4 (v113) | OK, JWT enforced |
| enqueue-lead-mission, resume-stalled-leads, continue-workflow, ops-health | a08ac0e4 | a08ac0e4 | OK |

- Verified 15:25 UTC:
  - Queue: 0 open (20 complete / 11 failed / 9 cancelled). 0 running tasks, 0 open calls.
  - No provider calls or credit tx since the canary. Credits 613/0.
  - Security: RLS off on 0 tables. Anon cannot run dev_table_counts or insert into beta_access_requests. 0 beta rows.
  - Ops health (warn level): OK, no alerts.

## CANARY 1 — PASSED (Salvo Software, 2026-09-30 15:29–15:33 UTC, release e1014c94)
- Sentence: "Qualify https://www.linkedin.com/company/salvosoftware. It must have raised funding within the last 3 years."
  - The trailing period compiled, so the punctuation fix is proven live.
- IDs: conv 7fe9b7c7, plan 94360450 (key start:f62523cc…), queue 96b7662a, task 2ec15881. One slice.
- Route: details $0.0041 → Atomus $0.0036 → Pvalyou $0.0201 = $0.0278, all settled from provider receipts. No reuse.
  - Model ≈ $0.0027. 3 credits (613 → 610). No stop fired. Writes only in e8af257d.
- Result: SATISFIED, 1/1 qualified, 1 lead written.
  - Funding PASS: Debt Financing 2024-06-06, cited, pc_0ce01c9c from this run.
  - Size PASS (LinkedIn 11–50). Enrichment attached.
- Chat: one truthful final message ("1 of 1 qualified company … Nothing was sent."); checkpoint resolved "completed"; plan pill Complete.
- Workbench: "1 qualified lead", Salvo Software.
- Duplicate Start: 1 plan per key and 1 queue row. After a reload the card shows "Started" and there is no Start button.
- Ops health after the canary: OK, no alerts (run 36737835889).
- Still open (cosmetic / not blocking): the card title reads "Find 1 companies in …" for a qualify mission; fit shows "Not scored" with bucket low_priority; the stage-label phrase glitch with an em dash.
- The LinkedIn redirect fix is proven by tests only; Wordware can prove it live if wanted.

## FRONTEND PUBLISHING (plan: docs/launch/frontend-publishing-plan.md)
- Step 2 DONE: PR #5 merged as 42bf1b63 (2026-09-30 16:01 UTC); the Railway worker redeployed on 42bf1b63 (b65efc85) with the same worker code.
  - It matches the default Supabase key to the production URL, and refuses a mixed pair at startup and in production builds.
  - Tests: frontend deno 590/0, node 5/0. The build is OK, and the ratchets are at baseline.
- Build side effect: `vite build` regenerates supabase/functions/mcp/index.ts (the Lovable MCP plugin). Never commit that; set VITE_SUPABASE_PROJECT_ID on Netlify.
- Waiting on the user: the old-accounts decision (wqnig users), then Netlify / Auth / DNS clicks.

## NEXT EXACT STEP
1. The user decides the next rung (C2, product path, default screen budget ≤ $0.14) or the agentory.space publishing plan.
   - agentory.space is still on the old Lovable backend wqnig, which is a beta blocker.
2. Revert the temporary `agentory-release-canary` entry in agentory-main-local/.claude/launch.json and stop the :8083 dev server when canaries are done.

## ACTIONS REQUIRING APPROVAL
Canary 1; any frontend publish/DNS/Netlify branch change; closing PR #3.
