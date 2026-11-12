# Release R1 manifest: ORION (OpenAI-only) + Company Brain + security

- **Release candidate:** the commit on `claude/agentory-audit-roadmap-64uq8n` that adds this file. Its SHA is quoted in the approval message and is what `--sha` must equal.
- **Base:** `launch/hardening@770383ea` (the RC is 0 behind and contains it entirely).
- **Target:** production backend `ohsdatpvfdjdemstoiuj`, then the frontend at `agentory.space`.

## Scope

The release covers **only what was verified end to end against production's actual schema.** Everything else stays exactly where the baseline found it.

### Database, in this order. Each runs as one transaction.

| # | File | sha256 | Effect | Rehearsed on the production-shaped clone |
|---|---|---|---|---|
| D1 | `supabase/migrations-held/20261113120000_workforce_v2_security.sql` | `c20a25b9…2574` | Browsers can no longer insert, update or delete `signal_events`, `signal_event_evidence`, `monitoring_subjects` or `approvals`. Members keep read access to their own workspace. | yes: Postgres 16 and 17; rollback and re-apply |
| D2 | `supabase/migrations-held/20261114120000_lead_model_calls_view_lockdown.sql` | `d9ceae2d…844c` | `lead_model_calls` becomes `security_invoker`; anon and authenticated lose all grants; the service role keeps SELECT | yes |
| D3 | `supabase/migrations/20261023120000_company_brain_server_writes_only.sql` | `d490ead2…7340` | No browser writes to `company_brain` for any role; reads unchanged | yes: existing row byte-identical |
| D4 | `supabase/migrations/20261024120000_company_brain_authorized_writer.sql` | `a8fb5531…eab1` | `company_brain_write_authorization` and `company_brain_authorized_write`: role- and session-checked server writes with compare-and-swap (`stale` on a conflicting edit) | yes: ok / stale / forbidden_role / not_member |
| D5 | `supabase/migrations-held/20261110120000_company_brain_memory.sql` | `4f0f3de8…0f37` | Versioned Brain memory: items, history, proposals, requests, revisions (5 tables, all with RLS), plus the authorized RPCs and a revision trigger on `company_brain` | yes: isolation and browser-write denial; full semantics in the DB contract lane |

### Edge functions

Deployed as single-file bundles stamped with the RC SHA, by `scripts/release/deploy-production-release.sh`:

| Function | Before | After | Why |
|---|---|---|---|
| `pilot-chat` | `86ac1b92` v206 (Haiku replies) | RC | ORION OpenAI-only (GPT-5.6 Luna; GPT-5.6 Terra repair only); evidence answers; compound reads; spend recorded for understanding; delegation guard; clear 503 without an OpenAI key |
| `daily-brief` | unstamped v47 (2026-09-11) | RC | ORION V1 evidence-backed brief, which the current Dashboard renders |
| `generate-company-brain-draft` | unstamped v44 (2026-10-11) | RC | The `update` action the current editor saves through (added 2026-11-01); role checks; authorized writer |
| `setup-company-brain` | unstamped v49 | RC | Same authorized writer |
| `company-brain-memory` | not deployed | RC | Brain memory panel: preferences, decisions, exclusions, proposals |

**Untouched, with builds verified before and after by the script:**

| Function | Build |
|---|---|
| `run-agent` | `e4da19e8` |
| `orchestrate`, `enqueue-lead-mission`, `continue-workflow`, `resume-stalled-leads` | `b51ad3dd` |
| `ops-health`, `approve-and-continue`, `send-scheduled-emails` | `a08ac0e4` |

All other functions and all cron jobs are also untouched.

### Secrets and flags

Set by the script before chat changes, **names only shown**:

| Name | Value | Why |
|---|---|---|
| `AGENTORY_DELEGATION_ENABLED` | `false` | ORION does not start ATLAS/LYRA work against the October agent backend (`orchestrate`/`run-agent` are 193 commits older). It says so plainly; nothing is called or charged. |
| `AGENTORY_ORION_EVIDENCE_CONTEXT` | `true` | Evidence-backed answers for business questions. Unscoped: production has one user. |
| `MODEL_SPEND_ENFORCEMENT` / `_CEILING_USD` / `_PERIOD_DAYS` | **preserved if present**; if all absent: `enforce` / `3.00` / `7` | Server-side ceiling per workspace. A partial configuration is refused. |

**Not set:** any `AGENTORY_TERRA_*`, `AGENTORY_HYBRID_*`, `AGENTORY_ROUTE_*` or `AGENTORY_GPT_MODEL_FAMILY`. The script refuses if any exists.

### Frontend

- **Built from the RC.** `vite build` without `.env` succeeds, and the bundle references only `ohsdatpvfdjdemstoiuj`.
- **Published through Lovable by the owner.** Lovable's project settings are not reachable from this session.
- **Acceptance (checked by me after publishing):** the live assets reference `ohsdatpvfdjdemstoiuj` and contain neither `wqnigjhcwjxtmordrwno` nor `zbwsbnqqpkvdhqwavjke`.

### Git

- The PR `claude/agentory-audit-roadmap-64uq8n` → `launch/hardening` is **opened only with release approval**, and merged after your review.
- Merging triggers `deploy-test-functions.yml`, which redeploys `lead-pipeline` and `provider-connections` **to TEST** from the merge commit. That is TEST only and expected.

## Explicitly NOT in R1, and why

| Item | Reason |
|---|---|
| `orchestrate`, `run-agent`, the lead functions, the `lead-pipeline` worker and the ATLAS held migrations (provider claims, smoke admission, checkpoints, evidence cache, one-lead-per-company, V2 claim chain) | ATLAS workstream. Production promotion runs through `deploy-production-discovery.yml`, gated on TEST. Not overwritten here. |
| `lisa-monitor` plus held `20261111120000_lisa_signal_engine` | Not verified against production monitoring (6 subjects, a live cron). R2. |
| `agent-collaboration` plus held `20261112120000_agent_collaboration`, and `workforce-dashboard` | Needs the agent backend release (P3). Dashboard flag off. |
| Client Brains (3c), membership writers, task pins (held chains, draft PRs #176–#193) | Held by their owners; not reviewed for release |
| Terra 6.1 / hybrid routing | Separate decision |
