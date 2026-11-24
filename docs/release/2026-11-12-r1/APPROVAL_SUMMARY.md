# R1: release summary for the owner's final approval

**Nothing in production has been changed.** Everything below is prepared, rehearsed and tested locally.

## 1. Target

- **Backend:** Supabase `ohsdatpvfdjdemstoiuj` ("agentory", ap-south-1).
- **Frontend:** `agentory.space` (Lovable, served by Cloudflare).
- **Critical finding:** the live site today runs a build from about July–August 2026 and talks to a **different** Supabase project, `wqnigjhcwjxtmordrwno`, which is not in your organization. The backend release is invisible on the site until it is republished against `ohsdatpvfdjdemstoiuj` (step 5).

## 2. Commits

| | Commit |
|---|---|
| Source (RC) | The head of `claude/agentory-audit-roadmap-64uq8n` quoted in the approval message (it contains all of `launch/hardening@770383ea`). `deploy-production-release.sh` refuses any other commit. |
| Production backend now | `pilot-chat` `86ac1b92`; `run-agent` `e4da19e8`; `orchestrate` and the queue functions `b51ad3dd`; Brain and brief functions unstamped (Sep–Oct) |
| Production frontend now | UNKNOWN commit, July–August-era code (see the baseline) |

## 3. Production changes, in rollout order

1. **Security:** migrations D1 (browser writes on signals and approvals removed) and D2 (spend view locked).
2. **Company Brain database:** D3 (no browser Brain writes), D4 (role- and session-checked writer with stale-edit detection), D5 (versioned memory tables).
3. **Flags:**
   - `AGENTORY_DELEGATION_ENABLED=false`;
   - `AGENTORY_ORION_EVIDENCE_CONTEXT=true`;
   - spend ceiling **preserved** if present, otherwise `enforce` / **$3.00 per workspace / 7 days**.
4. **Functions** (bundled, stamped, backed up first): `pilot-chat`, `daily-brief`, `generate-company-brain-draft`, `setup-company-brain`, and `company-brain-memory` (new).
5. **Frontend:** you republish in Lovable from the RC (or from `launch/hardening` after the PR merge), with **no Lovable-managed Supabase attached**. I then verify the live bundle.
6. **Git:** open the PR from the ORION branch into `launch/hardening` (merge after your review). This auto-deploys TEST `lead-pipeline` and `provider-connections` (TEST only).

**Untouched:** `run-agent`, `orchestrate`, the lead and queue functions, monitoring, cron jobs, the ATLAS migrations, and all existing rows.

## 4. Database effects

- **Additive:** 5 memory tables, 9 functions and 1 trigger.
- **Restrictive:** policies and grants removed from browser roles.
- **No row is altered or deleted.** The existing Brain rows stayed byte-identical on the clone.
- **Each migration is a single transaction.**

## 5. Downtime and compatibility risk

- **Downtime:** none expected (seconds per function swap).
- **Risks:**
  - (a) Production's migration history is unreliable; mitigated by object-level checks (all 151 columns present).
  - (b) Old-site users live in a different project, so you sign in with your `ohsdat…` account (1 user, last sign-in 2026-10-21).
  - (c) Brain AI drafting needs `ANTHROPIC_API_KEY` in production; the `--check` run shows whether it exists. Manual editing doesn't need it.
  - (d) Agent work (ATLAS/LYRA starts) is **off** until the agent backend is released.

## 6. AI spend and external actions

- **ORION:** OpenAI only (GPT-5.6 Luna; GPT-5.6 Terra repair only). About $0.005–0.01 per message; worst case about $0.05.
- **Ceiling:** checked before each turn, per workspace. 3 workspaces × ($3 + $0.05 overshoot) is about **$9.15 per 7 days at most**.
- **Undercounting:** the ceiling only sees recorded spend. **Set a hard monthly budget in your OpenAI dashboard (e.g. $20)** as the backstop.
- **External actions:** no outreach, scraping, enrichment or paid missions can start. Delegation is off, and outreach and scheduled email are untouched and empty.
- **Cron jobs:** they continue unchanged; idle, with $0 in 30 days.

## 7. Verification so far (local)

| Suite | Result |
|---|---|
| Edge functions (all, including the build-stamp change) | **10,014 / 10,014** |
| Frontend (Deno) | 789 / 789; Node 13 / 13 |
| vitest `src/**` (previously in no runner) | **371 / 371**, after fixing 13 stale expectations and 1 real counter bug |
| Deno-style `src/**` (35 files, in no runner) | 332 pass / **6 fail**, identical on `launch/hardening` (pre-existing: Workbench insights, credits dispatch, Brain-onboarding copy). Not in R1's path. |
| Deploy safety | 314 pass / **3 fail**, pre-existing `testWorkerZeroApify` (identical on the base; ATLAS worker infra) |
| DB contract lane (baseline + all migrations + full held chain, real Postgres 17 + PostgREST) | **455 / 455** |
| Production-shaped clone: security D1 + D2 | vulnerability reproduced before; closed after; rollback and re-apply clean; Postgres 16 and 17 |
| Production-shaped clone: Brain D3–D5 | existing row unchanged; owner `ok`, stale `stale`, viewer `forbidden_role`, outsider `not_member`; memory isolated |
| `tsc` | 23 errors, all pre-existing in `src/lib/scrapers/**`; none in release files |
| Production `vite build` | ok; references only `ohsdat…` |
| Bundles (5 functions) | build, parse, stamped (every R1 function now answers `x-agentory-build`); 68 KB – 1.36 MB |
| Release script | `--check` run against the live production build headers (read-only): OK. `--deploy` rehearsed with stubs: backups → flags → deploys (pilot-chat last) → verify; each refusal path exercised |
| **Live verification** | **not yet: nothing is deployed** |

## 8. Rollback

See `ROLLBACK.md`.
- Every function is backed up before replacement.
- Every migration has a tested or documented reverse.
- The frontend reverts through Lovable's version history.

## 9. Irreversible or destructive

**None.** Two caveats:
- Rolling back D5 later would drop memory rows created after release; export them first.
- Rolling back D1–D3 reopens the security holes.

**To approve, reply with:** `APPROVE R1 <RC SHA>`
