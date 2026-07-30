# Qualified-lead sourcing: audit + alignment

## Part 1 — Current architecture (verified by reading the code)

Traced on the current checkout: `supabase/functions/run-agent/index.ts` (3,659 lines), `_shared/executeRunAgentCompanyFirstSourcing.ts`, `_shared/companyFirstQuotaController.ts`, `_shared/compoundSourcingPipeline.ts`, `_shared/runAgentCompoundPersistenceAdapter.ts`, and the frontend Workbench (`src/components/chat/workspace/workbench/*`).

| # | Step | Who actually does it (confirmed in code) |
|---|---|---|
| 1 | Initial planning | Claude, via `applyClaudeFirstLeadPlanning` in `run-agent/index.ts` (flag + workspace-gated); deterministic fallback otherwise |
| 2 | Company research | `_shared/structuredCompanyEnrichment.ts` / `companyEnrichmentOrchestrator.ts` (model-assisted through `aiProvider.ts` — not confirmed as Gemini-specific here) |
| 3 | Title/description interpretation | Deterministic first: `jobFamily.ts`, `jobFamilyRegistry.ts`, `roleFamilyMatcher.ts`; model only assists in enrichment |
| 4 | Deterministic title validation | `jobFamily.ts` + `sourceGates.ts` |
| 5 | Company Brain validation | `companyBrainEffectivePolicy.ts` → `companyIcpFilter.ts`, enforced inside `compoundSourcingPipeline.ts` before any people call |
| 6 | Company resolution | `companyIdentity.ts` (`hasStrongId`, dedupe keys) |
| 7 | People search | `scopedPeopleSearch.ts` + `harvestApiPeople.ts` via `invokePeople` |
| 8 | Employer verification | `employerVerification.ts` (deterministic) |
| 9 | Contact enrichment | `contactDiscovery.ts` / `evidenceEnrichmentAdapters.ts` |
| 10 | CONTACT-ready authority | `runAgentCompoundBridge.compoundContactCeiling` + `clampToCeiling`, applied in `runAgentCompoundPersistenceAdapter.ts` |
| 11 | Complete vs Partial | `companyFirstQuotaController.ts` quota + `projectStatus` in run-agent; frontend `deriveWorkflowUiState` |
| 12 | Raw-source viewer persistence | `tool_calls.output_json` (read by `useWorkbenchData` → `normalizeApifyItems`) |
| 13 | Canonical Workbench persistence | `lead_candidates` + `accounts` (read by `useLeadResults(plan_id)` in `LeadResultsView`) |

## Part 2 — The exact disconnect (root cause, confirmed)

`compoundSourcingPipeline.ts` emits **one candidate per verified person only** (`candidates.push(...)` is inside the `for (const person of people)` loop, line ~451). Companies that pass job-relevance, identity resolution and Company Brain but where the people search returns nothing (or the person is unscopable) are pushed into a separate array, `pendingDecisionMakers` (line ~386).

`rg` across `supabase/functions` shows **`pendingDecisionMakers` is never read by any non-test file**. It is returned and dropped.

Because `persistPlan` in run-agent is only called from `buildCompoundPersistencePlan(candidate, …)`, a qualified company with no verified person produces **zero `accounts` rows and zero `lead_candidates` rows**. `LeadResultsView` reads `lead_candidates` — hence Opportunities is empty while the raw job posts are still visible from `tool_calls.output_json`.

That is the whole Path A / Path B split: **Path A persists tool output; Path B only persists person-level candidates.** No account-stage projection exists between them.

## Part 3 — Changes to make (no duplicate architecture)

Everything below reuses existing modules. No new planner, ingestion pipeline, actor registry, quota controller or Workbench view.

**Backend**
1. `compoundSourcingPipeline.ts` — no logic change to gates; ensure `pendingDecisionMakers` carries the account identity, the bound job evidence, the Brain gate result and a stage label.
2. New small pure module `_shared/companyRowProjection.ts` — maps a *qualified company* (candidate **or** pending) to an account-stage persistence plan with statuses from Layer 9 (`hiring_signal_validated` … `contact_ready` / `rejected`). Pure, unit-tested, no DB.
3. `runAgentCompoundPersistenceAdapter.ts` — unchanged CONTACT ceiling. Add an account-only plan variant so a company row can be written with `quota_eligible: false`.
4. `run-agent/index.ts` — after the compound round, persist company rows for `pendingDecisionMakers` through the **existing** `persistPlan` writer path (accounts upsert + `lead_candidates` row flagged as account-stage, non-quota-eligible). Quota authority untouched: only CONTACT rows count.
5. Round observation (`onRoundComplete`) already carries funnel counts; add `companies_qualified` / `pending_decision_makers` so Insights and the next-action rules can read them.

**Frontend (presentation only)**
6. `LeadResultsView` / `workbenchCounts.ts` — render account-stage rows with their stage, and label counts honestly (provider rows / unique hiring signals / accounts found / qualified companies / decision-makers verified / N of 5 CONTACT-ready).
7. Progressive states before terminal empty state; `NoResultsCard` only when the task is genuinely terminal.
8. Next-action gating: disable "Find decision-makers" when zero eligible company rows exist; surface the prerequisite-appropriate action instead.
9. `deriveWorkflowUiState` mission-quota guard stays as-is (0-of-5 never shows Complete).

**Fixtures + tests**
10. Offline fixture `_shared/qualifiedLeadE2E.fixture.ts`: LinkedIn 38 rows + Indeed 25 rows, duplicates, irrelevant Operations titles, non-SaaS and oversized companies → asserts the 5-of-5 Complete path and the honest 3-of-5 Partial path.
11. Tests covering the 24 required assertions, added to the existing suites (normalizer, controller, title family, Brain, resolution, people, employer, contact, quota, persistence, Workbench, execution card).

**Verification**
12. Baseline first (`deno check`, backend shared suite, `tsgo`, vitest, production build), then re-run; only pre-existing baseline failures accepted.

## Part 4 — Deployment (after tests pass)

Commit + push, report SHA, deploy **only** `run-agent`, publish frontend from the same commit. No migrations (the fix uses existing `accounts` / `lead_candidates` columns and `raw` JSON). No secret or data changes. No paid query run. `supabase/functions/mcp/index.ts` untouched and not deployed.

## Notes / honest limits

- I did **not** find code confirming Gemini specifically performs any step; enrichment goes through `aiProvider.ts`. I will name the concrete configured model in the final report rather than assert Gemini.
- `DEFAULT_COMPOUND_LIMITS` caps `rawJobs: 25` and `verifiedCompanies: 10` per round. If the production run under-delivers because of these caps rather than the projection gap, I will report it rather than silently raise them.
