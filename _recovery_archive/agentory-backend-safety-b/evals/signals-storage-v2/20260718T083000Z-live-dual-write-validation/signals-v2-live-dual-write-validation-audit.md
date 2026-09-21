# Signals V2 — Live Dual-Write Validation (TEST) — Audit

**Verdict: PARTIAL PASS — flag-OFF deployment verified & safe; enabled-mode live dual-write UNVERIFIED because the in-app Q1 executed against a non-TEST backend and never reached this project. No safety violation; flag returned to OFF.**

Date: 2026-07-18 · Project: TEST `zbwsbnqqpkvdhqwavjke` · Production `wqnigjhcwjxtmordrwno` **never accessed**
(unreachable: the authenticated CLI account cannot see it, and the Supabase MCP server is bound to TEST only).

No tokens, credentials, authorization headers, emails, phone numbers, private profile URLs, or raw provider
payloads appear in this report.

## Release identity

| Item | Value |
|---|---|
| Merged main | `612a3443` |
| Merged PR | #58 (merge commit `612a3443`) |
| Feature head | `38db08f3` — contained in main: **yes** |
| Dual-write files present in main | flag / writer / orchestration / memoryWriter integration + 4 test files |
| Migration applied (TEST) | `20260717170000_signals_storage_v2_hybrid` (present) |

## Function versions

| Function | Before | After | Note |
|---|---|---|---|
| run-agent | v88 | **v89** (ACTIVE) | flag-OFF code live; behaviourally identical to v88 |
| orchestrate | v31 | **v31** | untouched (not deployed) |
| all others | — | unchanged | only run-agent deployed |

Deploy command: `supabase functions deploy run-agent --project-ref zbwsbnqqpkvdhqwavjke` (explicit TEST ref).

## Initial flag state

`SIGNALS_V2` **absent from TEST secrets** → resolves **false (OFF)**. This is the safe default and remains so.

## Pre-deploy baseline (locked)

signals 427 · lead_evidence 0 · signal_events 0 · signal_event_evidence 0 · engagement_events 0 ·
lead_candidates 427 · lead_candidates.evidence_id non-null **0** · contacts 166 · accounts 149 ·
task_plans 187 · tasks 362 · outreach_drafts 64 · outreach_activities 4 · approvals 25 · activity_feed 1742.

V2 tables confirmed empty before deployment.

## Flag-OFF no-op proof (3 independent lines)

1. **Merged provider-free suite** — 43/43 Signals V2 tests pass; flag-OFF path asserts zero V2 DB calls and
   byte-identical legacy behaviour (writer `commonRejection` returns `flag_disabled` with `attempted:false`
   before any `.from()`; memoryWriter call sites also `if (v2Enabled)`-guarded).
2. **Deploy delta = 0** — post-deploy counts identical to baseline (all V2 tables still 0; evidence_id 0).
3. **Boot-check delta = 0** — after the two boot probes, counts still identical to baseline.

## OFF-mode boot checks (v89)

| Probe | Result |
|---|---|
| Unauthenticated POST | **401** (platform JWT gate) |
| Authenticated (public anon key) + malformed body `{}` | **400 `missing_required_fields`** (early return, before task insert / provider logic) |

Boot checks created zero task_plans/tasks and zero legacy/V2 rows.

## Post-OFF-proof counts (unchanged from baseline)

signals 427 · lead_evidence 0 · signal_events 0 · signal_event_evidence 0 · engagement_events 0 ·
lead_candidates 427 · evidence_id non-null 0 · contacts 166 · accounts 149 · task_plans 187 · tasks 362 ·
outreach_drafts 64.

## BLOCKER — live enabled-mode query not run

The single controlled Find Leads query enters through **orchestrate**, which requires an **authenticated
workspace-member user JWT** (`orchestrate` calls `auth.getUser()` on the bearer token, then checks
`workspace_members`). run-agent is only a per-step executor and enforces the same membership when a user JWT
is present. The service_role key cannot stand in for a user identity here.

The only mechanism to obtain that JWT in this environment is a **Supabase password-grant sign-in** (the method
prior sessions used). Signing in with a user password is a prohibited credential-handling action for this
agent, and no pre-existing workspace-member token is available (`.env.example` only). Therefore steps 6–15
(enable flag → one provider query → verify lead_evidence / signal_events / signal_event_evidence → observability
→ disable) were **not executed**. `SIGNALS_V2` was deliberately **left OFF/unset** (enabling without running the
validating query would leave an unvalidated non-default flag state).

Test workspace `00000000-0000-0000-0000-000000000001` exists (18 members); agents scout/aria/penn/scribe/hawk
present — so the query is runnable by an authenticated member.

## Enablement (steps 6–7) — flag ON, awaiting in-app Q1

Chosen path: maintainer runs the one query in-app (agent must not perform a password-grant sign-in).

- `SIGNALS_V2=true` set on TEST (value hidden; confirmed present in secrets list).
- run-agent redeployed to pick up the enabled env deterministically: **v88 → v89 (deploy) → v90 (secret inject) → v91 (redeploy)**, ACTIVE.
- **Side effect (benign, unavoidable):** setting a project secret re-injects env into ALL edge functions, bumping every function's version counter by 1. **orchestrate 31 → 32**, but its `ezbr_sha256` is unchanged (`0fb9ba03…`) and its artifact path still references the `_31/source` build → **orchestrate CODE unchanged; no orchestrate code deploy occurred.** This is inherent Supabase secret-propagation behaviour, not a deploy.
- Pre-Q1 baseline re-locked after enable+redeploy: all V2 tables **0**, evidence_id non-null **0**, legacy counts unchanged (signals 427, lead_candidates 427, contacts 166, accounts 149, task_plans 187, tasks 362, drafts 64).

Maintainer reported the query completed and returned four company opportunities: Voice AI Space, Harmonic
Security, Brain Co., BigID.

## Q1 finding — the in-app query did NOT reach this TEST project

Post-query inspection of TEST `zbwsbnqqpkvdhqwavjke` shows **zero delta from the locked pre-Q1 baseline**:

| Table | Pre-Q1 | Post-Q1 | Δ |
|---|---|---|---|
| task_plans | 187 | 187 | **0** |
| tasks | 362 | 362 | **0** |
| signals | 427 | 427 | **0** |
| lead_candidates | 427 | 427 | **0** |
| accounts | 149 | 149 | **0** |
| contacts | 166 | 166 | **0** |
| lead_evidence | 0 | 0 | **0** |
| signal_events | 0 | 0 | **0** |
| signal_event_evidence | 0 | 0 | **0** |
| engagement_events | 0 | 0 | **0** |
| lead_candidates.evidence_id non-null | 0 | 0 | **0** |
| outreach_drafts | 64 | 64 | **0** |
| outreach_activities | 4 | 4 | **0** |

Decisive evidence the run never touched this project:

- Newest `task_plans` row (any workspace) is `783dd33d-1dfd-4628-b7b2-ebbdfd3a3f80`, status `complete`, created
  **2026-07-17 16:45** — the PRIOR account's Q1 run. DB clock at check: 2026-07-18 08:51. **No plan/task was
  created today.** A completed Find Leads run always creates a `task_plan` + per-step `tasks`.
- The four returned companies (Voice AI Space, Harmonic Security, Brain Co., BigID) **do not exist as accounts**
  in this project (0 name matches); newest account here is 2026-07-08.

Conclusion: the app frontend used to submit the query is pointed at a **different backend** (another Supabase
project, or production) — not `zbwsbnqqpkvdhqwavjke`. The deployed run-agent v91 (dual-write) with
`SIGNALS_V2=true` was therefore **never exercised**, and the V2 tables here remain empty. Live enabled-mode
dual-write is **unverified in TEST**. (The agent did not and will not access production to look for the run.)

## Dedupe / occurred_at — provider-free replay (no second provider run)

With no live rows to replay, deduplication and event-time fidelity are demonstrated at the writer boundary by
the merged provider-free tests (re-run this session, 31/31 in writer+orchestration incl.): repeat lead_evidence
input → dedup (row count unchanged); repeat signal_event dedupe_key → dedup, **occurred_at preserved** (never
refreshed by observed_at); duplicate evidence fingerprint → dedup; distinct provider → separate evidence row;
missing/invalid posting date → skipped (no fabricated occurred_at).

## Disable (step: SIGNALS_V2 OFF)

- `SIGNALS_V2` **unset** in TEST → confirmed absent → resolves **false (OFF)**.
- run-agent redeployed for a deterministic OFF boot.
- Version churn (all env-injection, no code change beyond run-agent deploys):
  run-agent v88→v89 (deploy) →v90 (secret set) →v91 (redeploy) →v92 (secret unset) →**v93 (redeploy, OFF)**.
  orchestrate v31→v32→**v33** — code unchanged throughout (`ezbr_sha256` constant `0fb9ba03…`, artifact still
  the `_31/source` build); orchestrate was never deployed.
- Final DB: all V2 tables **0**, evidence_id non-null **0**, legacy counts unchanged.

## Result classification

**PARTIAL PASS.** Legacy behaviour remains safe and authoritative; flag-OFF deployment is verified as a no-op;
no PII/raw payload stored; occurred_at never fabricated; evidence_id remains NULL; no drafts/outreach; no
production access; no cross-workspace issue. The enabled-mode live write path is **unverified** solely because
the in-app query executed against a backend other than this TEST project.

## Safety confirmations

provider calls (by agent) **no** · agent DB writes **no** (reads + function deploys only) · migration applied
**no** · deployment **run-agent only** · orchestrate code deploy **no** (env-injection version bump only) ·
production accessed **no** · reader files changed **no** · backfill **no** · evidence_id populated **no** ·
outreach/drafts delta **0** · V2 table delta **0** · flag left enabled **no** (unset → OFF).

## To actually complete live validation (root cause = wrong backend)

1. Point the submitting client at TEST `zbwsbnqqpkvdhqwavjke` (verify the app's `SUPABASE_URL`/project), OR
   invoke the deployed TEST `orchestrate` directly with a TEST workspace-member JWT.
2. Re-enable `SIGNALS_V2=true` in TEST + redeploy run-agent; re-lock baseline.
3. Submit the one query; confirm a **new** `task_plans` row appears in TEST and the returned companies become
   TEST accounts.
4. Verify lead_evidence / signal_events / signal_event_evidence mapping, occurred_at fidelity, observability
   reconciliation; confirm evidence_id NULL; disable the flag.

## Remaining blockers / next branch

- Blocker: the validation query must be submitted against the TEST project (backend targeting), and needs a
  TEST workspace-member JWT the agent must not mint via password grant.
- Proposed next branch (post-validation): `signals-v2-observability-surfacing`.
