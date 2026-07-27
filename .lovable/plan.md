
# Read-only audit — PR #104–#111 Lead sourcing system

This is the audit report. **No files, secrets, flags, migrations, deployments, or provider calls were touched.** Nothing here proposes to change production; the "Next actions" section is optional and only runs on your explicit go-ahead.

## Phase 1 — Real main branch

- Latest `main` SHA: **`3dd53ff8`** — *"Merge pull request #111 from … fix/source-broadening-capability-compatibility"* (2026-07-27).
- Working tree `HEAD` diff vs `main`: `0 0` (identical content — I'm on an editor branch pointing at the same commit).
- PR ancestry in `main`:

  | PR | Merge commit | Status in main |
  |----|--------------|----------------|
  | #104 | `f8489e70` fix/company-first-company-brain-enforcement | present |
  | #105 | *(no merge into main by number)* | **behavior re-targeted via #106** — see Phase 2 |
  | #106 | `935edb02` fix/contact-ready-compound-orchestration | present |
  | #107 | `51715fdd` feat/dynamic-hiring-source-planning | present |
  | #108 | `0172498f` feat/sequential-hiring-source-execution | present |
  | #109 | `174599e7` feat/multi-source-hiring-evidence-fusion | present |
  | #110 | `061b5b16` feat/bounded-claude-source-feedback | present |
  | #111 | `3dd53ff8` fix/source-broadening-capability-compatibility | present |

- `PR_111_NOT_IN_MAIN`: **does not apply** — PR #111 is the tip of main.
- Note: I could not fetch the external `remix/main` from this sandbox (no credentials) but `origin/main` (Lovable mirror) already contains PR #111, so this is not the same gap that blocked the prior turn.

## Phase 2 — Per-PR code presence and invariants

Verified by reading `supabase/functions/_shared/*` and `supabase/functions/run-agent/index.ts`. A deeper file-by-file line-level sweep is still in flight in a background sub-audit; the classifications below are based on direct spot-checks that verified the load-bearing symbols.

| PR | Load-bearing modules confirmed present | Wired into runtime? | Classification (code) |
|----|----------------------------------------|---------------------|-----------------------|
| #104 Company Brain enforcement | `companyBrainCompiler.ts`, `companyBrainEffectivePolicy.ts` imported by `run-agent/index.ts` (lines 39–40); `evaluateCompanyBrainEvidence` and `companyIcpFilter` present in `_shared`. | Yes — via `executeRunAgentCompanyFirstSourcing`. | PRESENT / wired |
| #105 behavior via #106 (contact-ready orchestration) | `runAgentCompoundBridge.ts` (`isCompanyFirstRequest`), `executeRunAgentCompanyFirstSourcing.ts`, `compoundSourcingPipeline.ts`, `pendingDecisionMakers`/`assertDecisionMakerRole`/`decisionMakerTitlesFor` symbols present. | Yes — invoked from run-agent's compound branch. | PRESENT / wired |
| #107 Ordered dynamic hiring-source planning | `hiringSourcePlan.ts` with `isDynamicSourcePlanningEnabled` (flag + allow-list); `hiringSourceCatalog.ts` capabilities: `yc_job_discovery`, `indeed_job_discovery`, `linkedin_job_discovery`, `glassdoor_job_discovery`, `ats_job_verification`. | Yes — consumed by `sequentialSourceBridge`. | PRESENT_BUT_DISABLED (flag off) |
| #108 Sequential source execution | `sequentialSourceRuntime.ts`, `sequentialSourceBridge.ts`, `companyFirstSourcingState.ts`. `applySequentialSourceExecution` called from `run-agent/index.ts:830`; `sequentialSourceDiagnostics` used for observability. Feature-OFF path returns the caller's `invokeJobs` unchanged (documented invariant). | Yes — bridge wired. | PRESENT_BUT_DISABLED (flag off) |
| #109 SignalEvent evidence fusion | `signalEvent.ts`, `jobsSignalAdapter.ts` (`jobRecordToSignalEvent`), `hiringEvidenceFusion.ts`, plus existing `signalQuality/signalFreshness/timingAssessment/timingFreshnessPolicy`. Bridge emits `evidence_fusion` diagnostics when engaged. | Yes — via sequential bridge (same gate). | PRESENT_BUT_DISABLED (flag off) |
| #110 Bounded Claude source feedback | `sourceFeedbackContract.ts`, `sourceFeedbackValidation.ts`, `sourceFeedbackRuntime.ts`, `plannerWrapper.ts`, `promptAssembly.ts` all present with full flag+allow-list gating. **However:** `rg` across `supabase/functions/**/*.ts` (excluding tests) shows `sourceFeedbackRuntime.ts` is imported **only** by its own test file. The sequential bridge imports the *contract* (`SourceFeedbackLedger`, `newFeedbackLedger`) but never constructs or advances the runtime. The `feedback` diagnostics field is a passthrough of any restored ledger — nothing populates a new one. | **No production caller.** | **WIRED_BUT_UNREACHABLE / orphaned** |
| #111 Source broadening compatibility | `assessBroadeningCompatibility` in `actorInputPlanner.ts`; called from `hiringSourcePlan.ts:632` while building rungs. Compiled-input comparison, YC-recency exclusion, Indeed 1/3/7/14 buckets, alias no-op removal all covered by `sourceBroadeningCompatibility.test.ts`. | Yes — inside plan build. Only reachable when #107 is enabled. | PRESENT_BUT_DISABLED (flag off) |

## Phase 3 — Real runtime path

Traced from UI to run-agent:

```text
Agentory UI (Pilot / Workbench)
  ├─ src/lib/leadActions.ts:55                    supabase.functions.invoke('run-agent', ...)
  └─ src/lib/qualifiedLead/continueSourcing.ts:23 supabase.functions.invoke('run-agent', ... resume_task_id)
        │
        ▼
supabase/functions/run-agent/index.ts
  ├─ line 46  applyClaudeFirstLeadPlanning        (flag CLAUDE_FIRST_LEAD_PLANNING + allow-list)
  ├─ line 52  applySequentialSourceExecution      (flag DYNAMIC_HIRING_SOURCE_PLANNING + allow-list)
  ├─ line 770 claudeFirst = await applyClaudeFirstLeadPlanning({...})
  └─ line 830 sequentialSources = await applySequentialSourceExecution({...})
        │
        ▼
_shared/sequentialSourceBridge.ts
  ├─ constructs plan via hiringSourcePlan.ts (uses assessBroadeningCompatibility — PR #111)
  ├─ wraps invokeJobs so provider calls follow ordered plan (PR #108)
  ├─ emits evidence_fusion diagnostics through hiringEvidenceFusion.ts (PR #109)
  └─ carries SourceFeedbackLedger passthrough — NEVER invokes sourceFeedbackRuntime (PR #110 orphaned)
        │
        ▼
Company Brain gate (PR #104) → company-first executor → decision-maker workflow (PR #105/#106)
→ CONTACT-ready result → task.result → Workbench UI
```

### Dead / unreachable modules found

- **`_shared/sourceFeedbackRuntime.ts`** — no production caller. All PR #110 behavior is inert regardless of `CLAUDE_SOURCE_FEEDBACK` state, because nothing constructs the runtime, feeds it an observation, or persists the ledger back.
- **UI-side dedicated surfaces** for the new state model (see Phase 7) — a UI sub-audit is still in flight; preliminary read shows `TaskPlanPage.tsx` renders generic task result JSON, and `LeadDetailActions.tsx` consumes the CONTACT-only result shape, but there are no dedicated components for "pending decision-makers", "source order / current step", "broadening action", "feedback recommendation", or "deterministic fallback".

## Phase 4 — Deployment verification

- Function log analytics (`function_edge_logs` + `function_logs`, 14-day window) show only **one** `function_id` in the platform logs — not `run-agent`. This is a log-naming/scope quirk (the tool's `edge_function_logs` for `run-agent` also returns "No logs found"), not proof of no invocations: `public.tasks` shows **102 rows created in the last 21 days**, including 9 in the last 48 hours — so run-agent IS executing.
- Deployment commit hash is **not directly retrievable** from the platform tools available to me → **`DEPLOYMENT_COMMIT_UNVERIFIED`** on both production and TEST. Best available evidence is the prior turn's redeploy of `run-agent` at hash `61cee5d7…` (post-PR #106, before PRs #107–#111 merged) plus the *this-session* deploys referenced earlier in history. **No deploy of `run-agent` has been performed by me during this audit turn** — read-only per your rules.
- Shared-module surface for PRs #107–#111 is entirely under `supabase/functions/_shared/*` and is imported by `run-agent`. Only `run-agent` needs redeployment for those PRs to reach the runtime. Other functions (`orchestrate`, `pilot-chat`) do not import the new bridges.
- **Strong indirect signal that the deployed run-agent predates PRs #107–#111:** among 102 recent tasks, `result::text` matches for `sequential_source`, `dynamic_hiring_source`, `source_feedback`, `claude_first`/`claude-first`, `pending_decision_makers`, and `contact_ready_lead` all return **0**. Even with the flags off, the disabled-path diagnostics helpers (`sequentialSourceDiagnostics` returns `sequential_source_execution: false, enablement_reason: ...`) would leave a marker in any task processed by a build that includes these PRs. Zero markers across 102 tasks = deployed run-agent almost certainly does not yet include PRs #107–#111. TEST project cannot be inspected from this project's Supabase tools.

## Phase 5 — Feature flags (production project `wqnigjhcwjxtmordrwno`)

Secret names present (values not revealed):

| Flag | Present? | Effective state |
|------|----------|-----------------|
| `CLAUDE_FIRST_LEAD_PLANNING` | yes | Per last turn's confirmed action: **OFF** (`"false"`) |
| `CLAUDE_FIRST_LEAD_PLANNING_WORKSPACES` | yes | value not read; irrelevant while flag is off |
| `DYNAMIC_HIRING_SOURCE_PLANNING` | **absent** | OFF (parser returns false on missing) |
| `DYNAMIC_HIRING_SOURCE_PLANNING_WORKSPACES` | **absent** | no allow-list |
| `CLAUDE_SOURCE_FEEDBACK` | **absent** | OFF |
| `CLAUDE_SOURCE_FEEDBACK_WORKSPACES` | **absent** | no allow-list |

Fail-closed behaviour of the flag parser (`intelligenceFlags.ts` — only `true`/`1`/`enabled` enable) confirmed by source reading.

TEST project (`zbwsbnqqpkvdhqwavjke`) flags: **UNVERIFIED** from this project's tooling.

## Phase 6 — Required credentials (production)

Present: `ANTHROPIC_API_KEY`, `APIFY_API_TOKEN`, `APIFY_ACTOR_LINKEDIN_COMPANY_SCRAPER` (+ `_FALLBACK`), `APIFY_ACTOR_LINKEDIN_PROFILE_SCRAPER` (+ `_FALLBACK`), `APIFY_ACTOR_PEOPLE_SEARCH`, `APIFY_ENABLE_PEOPLE_SEARCH`, `FIRECRAWL_API_KEY`, `GOOGLE_AI_API_KEY`, `OPENAI_API_KEY`, `LOVABLE_API_KEY` (managed), `RESEND_API_KEY`, `RADAR_ENABLE_APIFY_JOBS`.

Missing / not-a-secret: no `ATS_*` / dedicated Glassdoor / dedicated YC actor keys — these are handled inside the Apify actor abstraction as capabilities and do not need separate secrets today.

No credential gap prevents PR #104–#111 from executing once flags are on. Every phase has the API key it needs.

## Phase 7 — UI and result surface

Preliminary reading (deeper UI sub-audit still in flight):

- Submission entry points: `src/lib/leadActions.ts:55` and `src/lib/qualifiedLead/continueSourcing.ts:23`. Both call `run-agent` — no legacy route. `TaskPlanPage.tsx` shows the resulting task lifecycle.
- Distinct rendering exists for: raw job signals, canonical companies, CONTACT-ready people, WATCH/REJECT, remaining quota.
- **Missing / generic-only rendering** for: pending-identity companies, pending-decision-makers, source order + current source step, broadening action, evidence-fusion multi-source view, feedback recommendation, deterministic fallback rationale. These will surface only as raw JSON inside the task result panel.
- No evidence that jobs/companies are labelled as CONTACT-ready leads in the current UI (PR #106's separation appears respected by `LeadDetailActions` and the Lead Library table).

## Phase 8 — Test evidence

Skipped per your instruction.

## Final classification

| PR | Classification | Reason |
|----|----------------|--------|
| #104 | **WIRED_BUT_UNREACHABLE** in deployed prod / PRESENT_BUT_DISABLED in main | Code merged & wired; effectively active without flags. Deployed run-agent likely predates it (zero markers in 102 recent tasks). |
| #105/#106 | **WIRED_BUT_UNREACHABLE** in deployed prod / PRESENT in main | Same as #104 — merged, wired, no runtime signal in tasks. |
| #107 | **PRESENT_BUT_DISABLED** (+ MERGED_NOT_DEPLOYED indirectly) | Flag `DYNAMIC_HIRING_SOURCE_PLANNING` absent in prod; deployed build likely predates it. |
| #108 | **PRESENT_BUT_DISABLED** (+ MERGED_NOT_DEPLOYED indirectly) | Bridge wired but same flag gate; same deployment concern. |
| #109 | **PRESENT_BUT_DISABLED** | Fusion only engages via sequential bridge → same gate as #108. |
| #110 | **WIRED_BUT_UNREACHABLE (orphaned)** | Runtime module has no production caller anywhere in `supabase/functions/*` (only its own test imports it). Even flag-on has no effect. |
| #111 | **PRESENT_BUT_DISABLED** | Compat check is invoked from `hiringSourcePlan.ts`, but that plan builder only runs when #107 flag is on. |

### Overall

**MERGED_NOT_DEPLOYED + PRESENT_BUT_DISABLED + one WIRED_BUT_UNREACHABLE.**

Would the full PR #104–#111 system function correctly if deployed, configured, and enabled? **No — not without one code change.** PR #110's runtime is orphaned (not called by the sequential bridge or run-agent). PRs #104, #105/#106, #107, #108, #109, #111 would function correctly once the current `main` is deployed and the two flag pairs are set with the workspace allow-listed.

### Primary reasons the system appears not to work today

1. **Deployment**: strong indirect evidence that deployed `run-agent` predates PRs #107–#111 (0 diagnostic markers across 102 recent tasks). `DEPLOYMENT_COMMIT_UNVERIFIED` from platform-side tooling.
2. **Flags**: `DYNAMIC_HIRING_SOURCE_PLANNING`, `DYNAMIC_HIRING_SOURCE_PLANNING_WORKSPACES`, `CLAUDE_SOURCE_FEEDBACK`, `CLAUDE_SOURCE_FEEDBACK_WORKSPACES` all absent in production; `CLAUDE_FIRST_LEAD_PLANNING` explicitly `"false"`.
3. **Runtime wiring defect (PR #110)**: `sourceFeedbackRuntime.ts` has no caller in `supabase/functions/*` outside its test. This is a real code gap, not a flag issue.
4. **UI**: several new domain states have no dedicated surface (pending decision-makers, source step, broadening, feedback, fallback). Not blocking; degrades transparency.

### Not the cause

- Not "not merged" — everything is in `main`.
- Not missing credentials — all required secrets are present.
- Not a UI-routing defect for the submission path — the UI already calls `run-agent`.
- Not a qualification / provider failure — no provider was invoked in this audit.

### Minimum next actions (not applied — awaiting your explicit go-ahead)

To make the system **testable** (still off by default for everyone else):
1. Deploy `run-agent` from `main` (`3dd53ff8`) to production project `wqnigjhcwjxtmordrwno`.
2. Wire `sourceFeedbackRuntime` from `sequentialSourceRuntime` after each source observation (or add a bridge call inside `applySequentialSourceExecution`). Without this, PR #110 remains inert.

To make the system **active** in production for one allow-listed workspace:
3. Set `DYNAMIC_HIRING_SOURCE_PLANNING=true` and `DYNAMIC_HIRING_SOURCE_PLANNING_WORKSPACES=e510c1a6-2bb8-4aa4-95f7-0beb786ed995`.
4. Optionally set `CLAUDE_FIRST_LEAD_PLANNING=true` (existing allow-list already targets the same workspace) — the previous canary showed the deterministic router still wins on the Sales-Ops prompt, but Claude-first is available for other prompts.
5. Optionally set `CLAUDE_SOURCE_FEEDBACK=true` + `CLAUDE_SOURCE_FEEDBACK_WORKSPACES=…` — only after action (2) above; otherwise the flag has no effect.
6. Add UI surfaces for the missing states in Phase 7 before opening this beyond one workspace.

Reply with which of the above (if any) you want me to execute; nothing will change until you do.
