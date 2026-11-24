# Agentory recovery plan and roadmap (2026-11-12)

**Labels:**
- **[D] confirmed defect:** reproduced or seen in live data.
- **[H] hypothesis**
- **[E] enhancement**

Complexity is S / M / L. Every remote change needs its own approval, listed in §7.

## Done in this pass (local, committed to `claude/agentory-audit-roadmap-64uq8n`; nothing deployed)

| Id | Change | Files | Tests |
|---|---|---|---|
| F-1 [D] | Compound "companies and signals, with evidence" reads go to ORION's evidence answer (evidence workspaces only) | `_shared/departmentRouting.ts`, `pilot-chat/index.ts` | handler tests, routing unit test |
| F-2 [D] | Chat understanding calls are recorded in the spend ledger | `pilot-chat/index.ts` | handler test plus mutation check |
| F-3 [D] | Frontend canonical TEST ref was the production ref; the setup screen pointed TEST at the production URL | `src/lib/env/projectEnvironment.ts`, `environmentGate.ts` | env tests |
| F-4 [D] | Lead Library "Qualified" counter excluded qualified leads awaiting research | `src/lib/leadLibrary/leadDecisionState.ts` | vitest |
| F-5 [D] | Company Brain page misleading on TEST: now read-only with an explanation; no doomed saves; "no version" is no longer a conflict | `src/lib/env/companyBrainAvailability.ts`, `companyBrainSave.ts`, `CompanyBrainDashboard.tsx` | frontend tests |
| F-6 [E] | ATLAS "Blocked" badge shows its reason | `useDepartmentAgentStatus.ts`, `AtlasStrip.tsx`, `LeadLibrary.tsx` | tsc |

Rollback for all of these: `git revert` the commit. None touched a database or a deployment.

## P0: environment correctness and security

| Item | Current state | Root cause | Change | Acceptance | Test | Size / risk | Rollback | Approval |
|---|---|---|---|---|---|---|---|---|
| **P0-1** [D] Close the production spend-view and browser-write holes | Production: anon can SELECT and **DELETE** through `lead_model_calls`; 10 browser write policies on signals and approvals | Owner-rights view granted to anon; legacy policies | Apply the two held migrations (already verified on TEST with a rolled-back role test) using the guarded installer pointed at production; first rerun `workforce-v2-security-preflight.sql` read-only on production | 0 non-SELECT policies; view `security_invoker=true`; 0 anon/authenticated grants; service role still reads; row counts unchanged | Same rolled-back role script as TEST | S / Low–Medium: checked 2026-11-12, `launch/hardening` `src/` has **no** browser insert, update, upsert or delete on `signal_events`, `signal_event_evidence`, `monitoring_subjects` or `approvals`. Server functions use the service role and are unaffected. The deployed production frontend's commit is unknown, so re-check that build. | `install-workforce-v2-security.sh --rollback` | **A1** |
| **P0-2** [D] Production functions are 193 commits behind and from mixed sources | 25 functions; 2 from CI, the rest from three local folders | Hand deploys from working copies | Release `launch/hardening` to production **only** through `deploy-production-discovery.yml` / `deploy-held-back-functions.yml`, function by function, with rollback downloads (the workflows already do this) | Each production function maps to one recorded commit | Workflow smoke checks plus a manual playbook run on TEST first | L / High | Workflow rollback artifacts | **A7** |
| **P0-3** [E] No deployed build identifies its commit | Commit unknown for most functions | No stamp | Have every deploy script and workflow publish `BUILD_SHA` (secret-free env or bundle banner) and return it from `withBuildStamp` | `curl …/pilot-chat` (OPTIONS) shows the SHA | Infra test | S / Low | Revert | none (code); deploy via A3/A4 |
| **P0-4** [H] TEST and production migration histories diverge | TEST lists 5, production 28; TEST was cloned from a snapshot | Different bootstrap | Generate a catalog diff (tables, columns, functions, policies) from both projects read-only; record a baseline marker on TEST | A written diff with no unexplained deltas | — | M / Low | — | read-only |
| **P0-5** [D] Frontend environment refs | Fixed locally (F-3) | — | Merge with the ORION PR (A6) | Badge reads TEST on TEST | env tests | S | revert | A6 |

## P1: working ORION

| Item | State | Change | Acceptance | Test | Size / risk | Approval |
|---|---|---|---|---|---|---|
| **P1-1** Redeploy `pilot-chat` to TEST with F-1 and F-2 | v1 lacks them | `orion-pilot-deploy.sh` (bundled, no secret changes) | Playbook T4, T5 and T13 pass | playbook | S / Low (TEST only); rollback is redeploying the previous commit | **A3** |
| **P1-2** [D] The read surface answers only one of several parts (non-evidence workspaces) | F-1 covers evidence workspaces only | Teach `planRead` / the read renderer to serve each read part (companies + signals) or to say what it skipped | No multi-part read silently drops a part | handler tests | M / Medium | A6 |
| **P1-3** [E] TEST CI deploys `pilot-chat` | Manual only | Add the bundled `pilot-chat` to `deploy-test-functions.yml` (from `launch/hardening` after merge) | Merge → TEST `pilot-chat` at that SHA | workflow | S / Low | **A4** |
| **P1-4** Run the manual playbook (T1–T15) | — | The owner runs it; I verify database side effects read-only | Pass bar met | — | — | — |
| **P1-5** [H] Prioritization and follow-up quality on real turns | Unit and handler tests only | Fix whatever T5–T8 expose | Scorecard ≥ the pass bar | — | M | — |

## P2: Company Brain integration

**Design for a safe, Brain-enabled test environment** (the current TEST guard stays):

| Option | What | Pros | Cons | Approval |
|---|---|---|---|---|
| **A (recommended)** | A **second isolated project** `agentory-brain-test`, built from the same schema bootstrap as TEST but **without** the no-Brain trigger. Fictional seed with a complete fictional Company Brain (an Everest Industrial-style profile already used in the contract tests). | Full isolation; the TEST discovery guard is untouched | Earlier standing rule: "don't create a new Supabase project", so this needs your explicit approval; a small monthly cost | **A5** |
| B | In TEST, replace the guard with a **workspace-scoped exemption** for one fictional workspace id | No new project | Changes the guard you asked to keep; any bug opens Brain writes for the discovery tests | A5-B |
| C | The loopback Postgres contract lane (exists today, 449 contract tests) | Free; already exercises the Brain V1 memory, approvals and agent access | No UI | none |

**Then:**
- **P2-1:** apply the held Brain V1 migrations (`company_brain_memory`, approvals) to the Brain environment.
- **P2-2:** deploy `setup-company-brain`, `generate-company-brain-draft` and `company-brain-memory` there.
- **P2-3:** verify every agent reads the same approved context (`approvedBrainContext`). Acceptance: ORION, ATLAS and LYRA answers cite the same ICP fields.

## P3: agent workflows

- **P3-1:** deploy `orchestrate` and `run-agent` to TEST, with spend caps and a no-outreach flag. Without them every delegation fails there. **A8.**
- **P3-2:** apply the collaboration held migrations and deploy `agent-collaboration` to TEST, to exercise the ORION→ATLAS→ORION handoff with approvals. **A8.**
- **P3-3:** deploy LISA V2 (`lisa-monitor`) to TEST with fictional subjects only; no live scraping until approved. **A8.**
- **P3-4:** LYRA drafts on TEST, draft-only, with publishing disabled.

Coordinate with the ATLAS workstream. Its mission engine (`lead-pipeline`) is not changed by any of this.

## P4: product usability

- **P4-1** [D]: unify the test runners.
  - `src/**/*.test.ts` mixes Deno and vitest, and none of it runs in CI.
  - 13 vitest failures: stale agent names ("Pilot" / "Mira" versus ORION / LYRA), the cascade invariant, a draft-ready check.
  - Add `test:vitest` and wire it into CI, then fix the expectations.
- **P4-2** [D]: deterministic workspace selection and a switcher (draft PR #170).
- **P4-3** [E]: explain intentionally disabled features in place (pattern from F-5 / F-6): Integrations, Content and Workbench on TEST.
- **P4-4** [E]: consistent agent naming in the UI and copy (ORION / ATLAS / LISA / LYRA).
- **P4-5** [H]: browser pass over Dashboard, Workbench, Signals, Content, Agents, Integrations and Settings once credentials exist for an automated signed-in run.

## P5: real pilot and release readiness

- **P5-1:** production at a single recorded commit, after P0-2.
- **P5-2:** spend ledger complete for every model path (F-2 pattern; audit `daily-brief`, `run-agent`).
- **P5-3:** monitoring: `ops-health` on TEST plus an alert on refusal and error rates.
- **P5-4:** a billing and credit model reviewed against real costs.
- **P5-5:** a controlled real-company pilot in production, with one consenting customer, the Brain onboarded, and outreach behind approvals only.

## Next five engineering tasks (in order)

1. **A3:** redeploy `pilot-chat` to TEST, then run the manual playbook (T1–T15).
2. **A1:** production security migrations (P0-1). The grep for direct browser writes is done and clean on `launch/hardening`.
3. Open the ORION PR into `launch/hardening` (A6). Then P1-3: CI deploys `pilot-chat` to TEST.
4. P4-1: put the uncovered `src/**` tests into CI and fix the 13 stale expectations.
5. P2 decision (A5): a Brain-enabled test environment, then P2-1 to P2-3.

## 7. Remote changes awaiting separate approval

| Id | Target | Exact operation | Effect | Rollback |
|---|---|---|---|---|
| **A1** | **Production** | Read-only preflight, then the two held security migrations through the guarded installer | Closes the anon read/delete on the spend view and browser writes on signals and approvals | Installer `--rollback` |
| A3 | TEST | `scripts/test-project/orion-pilot-deploy.sh --confirm tlvnfrxzjhsjgdofwehb` | `pilot-chat` with F-1 and F-2; no secret changes | Redeploy the previous commit |
| A4 | TEST via CI | Add the bundled `pilot-chat` to `deploy-test-functions.yml` | TEST tracks `launch/hardening` | Revert the workflow |
| A5 | New project or the TEST guard | Option A, B or C above | Brain-enabled testing | Delete the project / restore the guard |
| A6 | GitHub | PR `claude/agentory-audit-roadmap-64uq8n` → `launch/hardening` (no merge without review) | Integrates ORION, F-1 to F-6 | Revert the merge |
| A7 | **Production** | Function releases through the dispatch workflows | Production at a recorded commit | Workflow rollback |
| A8 | TEST | Deploy `orchestrate`, `run-agent`, `agent-collaboration` and `lisa-monitor`; apply the held collaboration and Brain migrations | Agent workflows testable | Delete functions / down migrations |
