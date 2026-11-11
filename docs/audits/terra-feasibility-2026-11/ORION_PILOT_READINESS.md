# ORION evidence pilot: TEST readiness report (2026-11-11)

**Read-only toward TEST and production.** The only remote calls were catalog, schema, row-count and cron reads, plus a function listing on TEST `tlvnfrxzjhsjgdofwehb`. Production was never contacted. No deploy, migration, data write, secret change or paid call was made.

## 1. Preflight

| # | Requirement | Result | Evidence |
|---|---|---|---|
| 1 | Branch, history, working tree | **PASS** | `claude/agentory-audit-roadmap-64uq8n`; `07e254a2` present; tree clean before this pass; no remote or `launch/hardening` commits missing |
| 2 | Pilot runbook | **PASS** | `ORION_EVIDENCE_PILOT.md` read and updated (4 questions aligned with your list; deploy step hardened) |
| 3 | Migration, installer, rollback, seed and cleanup | **PASS** | §2 and §4 below. All exercised on disposable local databases. |
| 4 | TEST project identity | **PASS** | `scripts/supabase-target.mjs`: TEST `tlvnfrxzjhsjgdofwehb`, production `ohsdatpvfdjdemstoiuj` |
| 5 | `pilot-chat` on TEST | **FAIL (not deployed)** | TEST functions: `provider-connections` v26, `lead-pipeline` v41, `daily-brief` v5 only |
| 6 | `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` on TEST | **BLOCKED** | Secret names can't be listed from this session (no tool; nothing extracted). You run `npm run supabase:test -- secrets list` (names only). |
| 7 | TEST feature flags | **BLOCKED** | Same as #6: edge secrets aren't listable here. The code defaults are all off. |
| 8 | Production not selected | **PASS, with a caveat** | The wrapper always passes `--project-ref tlvnfrxzjhsjgdofwehb` for TEST and refuses production unless `SUPABASE_TARGET=production`. **Caveat:** `supabase/config.toml` names production, so a raw `supabase functions deploy` (no wrapper) would hit production. Always use `npm run supabase:test --`. |
| 9 | Company Brain writes restricted on TEST | **PASS** | Trigger `discovery_test_no_company_brain` enabled (`A`, always); 0 Brain rows |

## 2. Security review: `20261113120000_workforce_v2_security.sql`

| Check | Result | How |
|---|---|---|
| Users cannot insert or modify signals directly | **PASS** (local) | DB lane: browser insert, update and delete on `signal_events`, `signal_event_evidence` and `monitoring_subjects` all return 42501 |
| Approvals cannot be forged through browser DB access | **PASS** (local) | A viewer's PATCH and INSERT on `approvals` return 42501; the status is unchanged |
| Workspace isolation intact | **PASS** (local) | Member SELECT policies kept (`has_workspace_access`); ORION evidence lane: other workspaces never appear; non-members refused |
| Server-side writers still work | **PASS** (local) | LISA signal engine (22 tests, SECURITY DEFINER writer) and agent collaboration (25 tests) pass with the migration applied; the service role can approve |
| Existing records preserved | **PASS** | The migration has **0** DML statements: only 11 `drop policy`, 1 `create policy`, 2 `revoke`, 2 `grant` |
| Rollback safe and tested | **PASS** (local) | Idempotent rollback; round-trip test; installer end-to-end: install → re-install no-op → rollback ×2 → reinstall |
| Installer cannot target production | **PASS** | Refuses the production / abandoned refs in the ref **and** in the URL, a missing `--confirm`, and a URL that doesn't name the ref (all exercised) |
| On TEST today (read-only) | still **vulnerable** | 10 browser write policies live; preflight OK (tables and `has_workspace_access` present) |
| Browser code writes these tables? | **No** | 0 frontend insert / update / upsert / delete calls |

**Status: pending your approval.** Not applied anywhere remote.

## 3. `pilot-chat` deployment readiness

| Aspect | Finding |
|---|---|
| Auth | Bearer JWT → `getUser`; 401 without a valid user |
| Membership and roles | Workspace membership checked before any read. Evidence retrieval re-checks through the Brain loader; a refusal reads nothing. |
| Company Brain | Read through the shared loader. With no Brain (TEST), Q&A and reads work; `source` / `research` / `compose` requests return the onboarding gate (by design). No Brain write path exists in `pilot-chat`. |
| Evidence retrieval | `AGENTORY_ORION_EVIDENCE_CONTEXT` + `AGENTORY_ORION_EVIDENCE_WORKSPACES`; business questions only; reads only; records `retrieval_ms` |
| Models | Request understanding: `gpt-5.6-luna` (needs `OPENAI_API_KEY`). Replies: `claude-haiku-4-5` (needs `ANTHROPIC_API_KEY`). Hybrid / Terra: **0 tasks routed** with only the pilot flags set (verified). |
| Cost limits | Workspace spend ceiling ($25/day, enforce) from `lead_model_calls`; per-call output caps (understanding 1,500, reply 420 tokens) |
| Fallback | No OpenAI key: an honest "couldn't read that request" reply. No Anthropic key: an honest "couldn't put an answer together". Never a silent model swap. |
| Paid-work exposure | None in this pilot. Sourcing / research are Brain-gated on TEST, `orchestrate` is not deployed on TEST, and missions need a confirmation card. Pilot seed triggers: none. TEST cron jobs only sweep stuck tasks and stale credits. |
| Logging | Console logs plus `messages.metadata`: `model_route`, `orion_evidence {cited_ids, retrieval_ms}`, presented referents, `model_used` |
| Required env | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` (platform-provided), `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, plus the two pilot flags. Everything else optional and off. |
| Deploy size | Module graph about 6.3 MB of source, smaller than `run-agent` (about 8.1 MB), which deploys. Expected to fit; **not proven until the deploy runs**. An oversized deploy fails without changing anything. |
| Onboarding bypass | `VITE_TEST_DASHBOARD_WITHOUT_BRAIN=true` with `VITE_SUPABASE_URL` = TEST lets the local UI reach chat without a Brain. It is ref-locked to TEST, client-side only, and creates no Brain. Alternatively the pilot runner calls the endpoint directly, with no UI needed. |

**Deploy** (after approval):
1. Check the chat key names are present; this shows names only:
   ```bash
   npm run supabase:test -- secrets list
   ```
2. Set the pilot flags:
   ```bash
   npm run supabase:test -- secrets set AGENTORY_ORION_EVIDENCE_CONTEXT=true AGENTORY_ORION_EVIDENCE_WORKSPACES=a71a0000-0000-4000-8000-0000000011a1
   ```
3. Deploy:
   ```bash
   npm run supabase:test -- functions deploy pilot-chat
   ```

**Rollback:**
1. Unset the flags:
   ```bash
   npm run supabase:test -- secrets unset AGENTORY_ORION_EVIDENCE_CONTEXT AGENTORY_ORION_EVIDENCE_WORKSPACES
   ```
2. Remove the function, since it was not deployed on TEST before:
   ```bash
   npm run supabase:test -- functions delete pilot-chat
   ```

## 4. Fictional pilot data: validated locally

`scripts/test-project/validate-orion-pilot-seed.sh` builds a disposable loopback database from the repository schema, adds a pre-existing "customer" workspace, and checks every requirement. **All PASS:**
- 2 fixed-id workspaces;
- 2 qualified and 2 rejected leads, each with a recorded reason;
- recent, stale (130 days) and contradicted signals, each with `occurred_at`, `observed_at` and `source_url`;
- the isolation canary only in its own workspace;
- no Company Brain written;
- **no tasks or missions created**;
- a re-run is **refused with no duplicates**;
- cleanup removes **only** the fictional rows, and the pre-existing workspace is **byte-identical**.

The seed also satisfies TEST's real check constraints (signal vocabulary, subject-key format, `occurred_at_basis`), which were read from the TEST catalog. No row on TEST is touched by the seed except its own new ones.

## 5. Flags

The first pilot uses only `AGENTORY_ORION_EVIDENCE_CONTEXT=true` and `AGENTORY_ORION_EVIDENCE_WORKSPACES=a71a0000-0000-4000-8000-0000000011a1`. Verified:
- the evidence context is **null for any other workspace**, even for a real member (unit and real-DB tests);
- with only these flags, **0** tasks route to another model;
- Terra and hybrid routing stay off;
- no paid workflow is enabled.

## 6. Acceptance run (prepared; not run, needs approval)

`scripts/orion-pilot/run-pilot.ts`:
- calls the **real** TEST `pilot-chat` for the 15 questions, with follow-ups threaded (Q01→Q09, Q03→Q10);
- repeats Q01, Q07 and Q11 as editor and viewer;
- runs both isolation probes (outsider in their own workspace; outsider into the pilot workspace, expecting 403);
- records answers, metadata and client-measured latency;
- refuses any non-TEST URL and needs `ORION_PILOT_APPROVED="I approve the ORION TEST pilot run on tlvnfrxzjhsjgdofwehb"`;
- estimated model spend is $0.10–0.25 per run, worst case about $0.30, and is visible afterwards in `lead_model_calls`.

Then score it:
```bash
deno run --allow-read scripts/orion-pilot/score.ts transcript-evidence-on.json transcript-baseline.json
```
The baseline is a second run with the evidence flag unset, to measure the speed overhead.

## 7. Terra (Phase 8)

| | |
|---|---|
| Account availability | **BLOCKED.** No OpenAI key in this session; check command in `ORION_EVIDENCE_PILOT.md` §1 |
| Pricing and compatibility | Verified 2026-11-11 (README / HYBRID_IMPLEMENTATION) |
| Stage 1 | `--preflight --stage 1`: manifest matches code, hard maximum **$1.4314** ≤ $2 cap, keys absent, so `ready: false` here. **Not run.** |

## 8. Approval requests (exact)

| # | Environment | Action | Expected impact | Rollback |
|---|---|---|---|---|
| A1 | your shell, OpenAI TEST project | `--check-model gpt-6.1-terra` (free GET) | none; prints visible / not visible | — |
| A2 | TEST DB `tlvnfrxzjhsjgdofwehb` | `install-workforce-v2-security.sh --confirm tlvnfrxzjhsjgdofwehb` | browsers can no longer write signals or approvals (10 policies dropped, 1 read policy added); no data change | same script with `--rollback` |
| A3 | TEST DB | `orion-pilot-seed.sql` (2 new fictional workspaces + rows; needs 4 TEST user ids) | new rows only; no existing workspace touched; no missions | `orion-pilot-cleanup.sql` |
| A4 | TEST edge secrets | set `AGENTORY_ORION_EVIDENCE_CONTEXT`, `AGENTORY_ORION_EVIDENCE_WORKSPACES`; confirm `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` exist | the evidence context is live for the pilot workspace only | `secrets unset …` |
| A5 | TEST edge functions | `npm run supabase:test -- functions deploy pilot-chat` | new function on TEST (not there today) | `functions delete pilot-chat` |
| A6 | TEST endpoint | run `run-pilot.ts` twice (evidence on, then baseline) | about $0.2–0.6 model spend on TEST in total | — (read-only answers; cleanup removes conversations) |
| A7 | your shell, OpenAI + Anthropic | Stage 1 benchmark | ≤ $1.43 (cap $2) | — |
| A8 | — | name a blind grader | — | — |

The order is A1 → A2 → A3 → A4 → A5 → A6. A7 can run in parallel.
