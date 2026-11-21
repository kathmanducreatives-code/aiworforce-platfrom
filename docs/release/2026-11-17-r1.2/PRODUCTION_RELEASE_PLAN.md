# R1.2 production release plan (prepared, nothing executed)

**Status:** ready for an owner decision. Nothing in production has been changed. PR #270 is not merged.

| | |
|---|---|
| **App SHA (what is deployed)** | `2a0438bb089df9af32bf79cef91c8bbc8d11d5c4` — the exact commit that passed live TEST |
| **Tool SHA (what runs the deploy)** | HEAD of `claude/agentory-audit-roadmap-64uq8n` after this document (contains the app SHA; changes no function code) |
| **Production today** | `ohsdatpvfdjdemstoiuj`, pilot-chat `a1633f45` (R1.1, v210, since 2026-11-15 09:46 UTC) |
| **Scope** | one function, `pilot-chat`. No migration, no secret, no cron, no other function. |

## 1. Live acceptance record (TEST `tlvnfrxzjhsjgdofwehb`, 2026-11-17)

Results reported by the owner, cross-checked read-only against TEST's own database:

| Check | Owner's result | Independent check on TEST |
|---|---|---|
| Build under test | `2a0438bb` | `x-agentory-build: 2a0438bb…@2026-11-17T15:08:56Z` |
| R1.1 | 20/20 | 34 understanding rows 15:09:19–15:17:39 UTC (20 + 14) |
| R1.2 | 14/14 | the same 34 rows: every one carries the new policy fields; none asked a clarification; `may_spend = false` on all |
| Tests 3, 4, 12, 13 | pass | #3 source + unbound set → explain-only answer; #4 blocking claims/companies → answer with notes; #12 content reference → answer with notes (the reading that failed in runs 2 and 3); #13 source + set bound to 4 companies → explain-only answer |
| Outsider | 403 | — (reported by the run script) |
| Protected tables | unchanged | 0 new rows in `provider_usage_ledger`, `lead_mission_queue`, `tasks`, `outreach_drafts`, `approvals`, `content_item`; 0 conversations left after cleanup |
| Paid provider execution | none | `provider_usage_ledger`: 0 rows in the run window (all workspaces) |
| Model spend | $0.0590 / $0.30 | `lead_model_calls`: $0.0590 over 58 calls, `gpt-5.6-luna` only |

**Transcripts:** `r11-transcript.json` and `r12-transcript.json` are on the owner's machine and could not be read from the cloud session. To keep them with the release, attach both files to PR #270. The record above is in `tests/fixtures/orion-r12-acceptance.json` (`live_test_2026_11_17_final`).

## 2. PR #270 review against `launch/hardening` (`0e43db92`)

- Merges cleanly (trial merge, 0 conflicts). `launch/hardening` gained only PR #269 since the branch point. The 4 frontend files from #269 are byte-identical in PR #270.
- 55 files in total, all of the following kinds:
  - **Function code:** `pilot-chat/index.ts` and `_shared/` modules: `orionIntelligence`, `orionReferencePolicy`, `orionEvidenceContext`, `orionWorkspaceFacts`, `orionDraft`, `converseSurface`, `composeSurface`, `readSurface`, `evidence/retrieve`. Only pilot-chat is deployed. Other functions keep their current bundles until they are deployed separately.
  - **Frontend:** the R1.1 "Draft only" chip, already merged via #269.
  - **Release tooling:**
    - `deploy-r11-pilot-chat.sh`, `deploy-production-release.sh`, `supabase-target.mjs` (production-target guard);
    - the TEST run scripts, dry-run stubs, and the containment SQL files.
  - **Tests, fixtures and docs.**
- **No migrations.** R1.1 → R1.2 changes in `supabase/functions` touch 6 files. All production columns they read exist (checked read-only):
  - `conversations.workspace_id`;
  - `signal_events.observed_at`, `occurred_at`, `source_url`, `normalized_value`, `subject_key`;
  - `messages.metadata`;
  - `request_understanding_log.metadata`.
- Compared with R1.1 the changes are the R1.2 work:
  - evidence relevance and the signal table;
  - workspace-bound conversations;
  - the consequence-gated reference policy;
  - stable referents;
  - policy logging.

  No guard code changed: membership check, delegation refusal, Start confirmation, spend budget.

## 3. Deploy scope, rollback, secrets, guards

| Item | Verified |
|---|---|
| **Only pilot-chat deploys** | The script has exactly one deploy command, for pilot-chat (or the rollback redeploy). It makes no secret or database writes and deletes nothing. This is enforced by `tests/infra/releaseR11Scope.test.ts`. |
| **Functions outside the release** | Live builds checked read-only on 2026-11-17, all where the script expects: daily-brief, generate-company-brain-draft, setup-company-brain and company-brain-memory at `3bef8fd0`; run-agent at `e4da19e8`; orchestrate, enqueue-lead-mission, continue-workflow and resume-stalled-leads at `b51ad3dd`. The script refuses to run if any of them has moved. |
| **Build integrity** | The bundle is built from a worktree of the app SHA. A local build gave 1,417,243 bytes (limit 4,000,000), stamped `2a0438bb`, with the markers `orion-intelligence-v1`, `orion-draft-v1`, `orion-workspace-facts-v1` and `orion-reference-policy-v1` (the last one is now required by the script). |
| **Rollback** | Before deploying, the script downloads the live pilot-chat into `release-backups/r11-<UTC>` with a SHA-256 manifest and validates it (size, entry point, untouched repo). `--rollback` refuses a backup whose manifest doesn't match, redeploys it, and verifies the build and the no-token 401. The stub dry runs pass (deploy, rollback, refusal on a failed backup, refusal on a missing secret). |
| **Secrets** | The script lists names only. It requires `OPENAI_API_KEY`, `AGENTORY_DELEGATION_ENABLED`, `AGENTORY_ORION_EVIDENCE_CONTEXT` and the three `MODEL_SPEND_*` secrets, refuses Terra/routing overrides, and changes no secret. **Values cannot be read**; that delegation is `false` is confirmed in step 4 below. |
| **Authorization** | Unchanged: JWT required (no-token POST → 401, checked by the script), workspace membership required (403), conversations bound to their workspace (404). |
| **Delegation** | Unchanged: with `AGENTORY_DELEGATION_ENABLED=false`, all 18 agent and paid paths refuse (`DELEGATION_DISABLED_REPLY`). |
| **Spend** | Unchanged: model calls run under `MODEL_SPEND_*` enforcement, paid routes still need the user's Start, and the R1.2 policy fails closed for spend, outbound and mutation. |

## 4. Production deployment plan — each ⛔ step needs the owner's explicit approval

**Step 0 — read-only preparation (no production change).** On your Mac, in a clean clone with your production CLI login:
```bash
git clone https://github.com/kathmanducreatives-code/aiworforce-platfrom.git ~/agentory-r12-release
cd ~/agentory-r12-release
git checkout --detach <TOOL_SHA>
npm ci
scripts/release/deploy-r11-pilot-chat.sh --check --confirm ohsdatpvfdjdemstoiuj --sha 2a0438bb089df9af32bf79cef91c8bbc8d11d5c4 --tool-sha <TOOL_SHA>
```
Expect `CHECK OK (read-only; nothing changed)` with pilot-chat at `a1633f45`, all required secret names present, and every other function unchanged. Stop on any `refusing:` line.

**⛔ Step 1 — deploy pilot-chat R1.2 (approval 1).**
```bash
scripts/release/deploy-r11-pilot-chat.sh --deploy --confirm ohsdatpvfdjdemstoiuj --sha 2a0438bb089df9af32bf79cef91c8bbc8d11d5c4 --tool-sha <TOOL_SHA>
```
Expect `RELEASE … DEPLOYED … Backup: release-backups/r11-<UTC>`. **Keep that backup path.** If it prints `VERIFY FAILED`, go to step 5.

**Step 2 — read-only verification (no production change).**
```bash
curl -sS -X OPTIONS -D - -o /dev/null https://ohsdatpvfdjdemstoiuj.supabase.co/functions/v1/pilot-chat -H "Origin: https://agentory.space" -H "Access-Control-Request-Method: POST" | grep -i x-agentory-build
```
Expect `2a0438bb089df9af32bf79cef91c8bbc8d11d5c4@…`. The no-token 401 and the unchanged other functions are checked by the script itself.

**⛔ Step 3 — production smoke test in the app (approval 2; writes chat messages and costs a few cents).** Use your own production workspace, in a **new** conversation:
1. "Summarize our current pipeline risks. Internal analysis only, do not execute anything." → an ORION answer, no Start card.
2. "Find 20 US SaaS companies hiring SDRs." → a **Start card** (explicit confirmation gate: nothing runs yet). Press **Start**. → "Starting agent work … isn't switched on in this release yet … Nothing was started and nothing was charged." This proves `AGENTORY_DELEGATION_ENABLED=false` in production; no task, mission or provider call is created.
3. "Give me a founder-only summary of risks and decisions. Not a campaign, not marketing copy." → an ORION answer, no clarification.

**Step 4 — read-only check after the smoke test.** I can run these with your go-ahead, or you can run them in the SQL editor of `ohsdatpvfdjdemstoiuj`. Replace `<conv>` with the smoke conversation's id.
```sql
select metadata->>'route', metadata->>'consequence', metadata->>'policy_decision', metadata->>'may_spend'
  from public.request_understanding_log where conversation_id = '<conv>' order by created_at;
select count(*) from public.tasks where created_at > now() - interval '30 minutes';
select count(*) from public.lead_mission_queue where created_at > now() - interval '30 minutes';
select metadata->>'type', count(*) from public.messages where conversation_id = '<conv>' and role = 'assistant' group by 1;
```
Expect:
- for prompts 1 and 3, `consequence = answer` and `may_spend = false`;
- for prompt 2, `consequence = spend`, `proceed:spend`, a `workflow_confirmation` message, then one `delegation_disabled` message after Start;
- 0 new tasks and 0 new missions from the smoke test.

**⛔ Step 5 — rollback, only if needed (approval on demand).**
```bash
scripts/release/deploy-r11-pilot-chat.sh --rollback --confirm ohsdatpvfdjdemstoiuj --backup release-backups/r11-<UTC>
```
Expect `ROLLED BACK pilot-chat … to a1633f45…`. Secrets are not touched.

**⛔ Step 6 — merge PR #270 into `launch/hardening` (approval 3).** Do this after steps 2–4 pass, so the branch matches what production runs. Merging deploys nothing by itself.

## 5. Monitoring containment (separate track, ⛔ approval C)

`scripts/release/r12-containment-option-a.sql` contains:
1. a read-only pre-check;
2. a one-transaction change that aborts unless it disables exactly the one subject;
3. read-only verification;
4. rollback;
5. rollback verification.

It is independent of the R1.2 deploy; either can go first. The current state (read-only, 2026-11-17):
- 1 of 6 subjects is enabled (`78372f06-…`), in a workspace with 0 members;
- `monitoring-tick` is active every 15 minutes;
- the subject last ran 2026-11-17 15:15 UTC;
- in August this path made successful paid Apify calls; today only the invalid Apify credential stops it.
