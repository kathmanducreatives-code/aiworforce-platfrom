# Find Leads — account-first + contact-ready re-architecture

Fixes the two live-QA failures: (1) a RevOps/Sales-Ops hiring search returned AE/SDR/Founding-AE and off-ICP companies; (2) "founders with a reason to talk now" returned profile-only records with no company/signal, all shown as contact-ready with identical scores.

**Base:** remix/main `37b3f3d`. Branch `lead-intent-account-first-contact-ready-fix`. Trace + deterministic tests only — **no providers**.

## Where each observed failure enters (traced)

| Observed failure | Root cause | Enters at |
|---|---|---|
| AE / Founding AE / SDR returned for a RevOps request | role matching too loose; adjacent sales roles treated as exact | `leadSearchIntent`/`leadMatchTier` role terms; no strict family taxonomy |
| lead-gen agency / nonprofit / oversized accepted | disqualifier + size + ICP not enforced as override; flat scoring | `leadQualityGate` + `ariaScoring` (score could overcome misfit) |
| profile-only "leads", no company/website/signal | **persona conflated with source strategy** — "find founders" → person-profile search | intent → source recommendation (`leadSearchIntent` has no `source_strategy`) |
| person-profile URL described as a job posting | no evidence-type integrity | normalization / signal classification |
| founder title treated as a hiring signal | identity used as intent | signal classification |
| identical scores for different records | flat/template scoring | `ariaScoring` / persisted score |
| all shown contact-ready despite needs_verification | weak proxy `contact_status !== 'needs_contact'` | `LeadResultsView.tsx:67` |
| stale vs current results not separated | Workbench not scoped by run_id | Workbench views |

## What this PR delivers (pure, tested backend architecture)

New `_shared` modules (all pure, import-free, deterministic — no providers):

1. **`leadIntentModel.ts`** — separates persona / company-profile / requested_signal / requested_role_family / geography(hard) / hard_exclusions / evidence_requirements / **source_strategy** / decision_maker_strategy / result_limit / relaxation_policy. Routes signal/persona requests **account_first** (companies → verify signal → resolve the decision maker); **profile_first** only for a direct named-company lookup ("profiles of the founders at Acme"). Respects active-brain exceptions (a recruiting ICP is not excluded by generic anti-agency defaults). Self-detects a named geography as a hard filter.
2. **`roleFamilyMatcher.ts`** — strict role taxonomy. `revenue_operations` owns Sales/Revenue/GTM/Commercial Operations, RevOps, Revenue Systems, (Sales|Revenue) Strategy & Operations. AE, Founding AE, SDR, BDR, Sales Rep, Head of Sales, VP Sales, Growth, Recruiter are **not** exact; they can only appear as `adjacent` (watch tier). `isExactRoleMatch` / `roleExactness` / `classifyRoleFamily`.
3. **`evidenceType.ts`** — normalizes evidence into `job_post | company_page | person_profile | funding_announcement | company_news | intent_post | comment | product_launch | hiring_page | other`, and enforces invariants: a `person_profile` can never be labelled a job post, a founder title can never be a signal, a `person_profile` alone is never a company-level signal, a `job_post` must identify employer + role.
4. **`leadDecision.ts`** — ONE canonical decision `contact | watch | needs_review | skip` with the required precedence (disqualifier→skip; no identity→needs_review; no signal→needs_review; off-ICP→needs_review; weak timing→watch; no person→watch; low confidence→needs_review; else contact). The **contact-ready contract** (`contactReady`) returns `{ready, missing[]}` and is true only when the decision is `contact` AND every artefact is present (verified company + website, brain fit, no disqualifier, company-level signal, evidence URL, meaningful why_this_company + why_now, verified decision maker + profile URL, min confidence) — a profile-only record can never be ready. `detectContradiction`/`reconcile` block impossible legacy combos (a reject can never resolve to contact; a disqualifier forces skip).
5. **`leadScoreBreakdown.ts`** — component scoring (icp/industry/business-model/size/geography/**role exactness (biggest lever)**/signal/evidence quality/recency/decision-maker), `final_score` + `score_breakdown` + `score_explanation` + `confidence`. Hard rules: a disqualifier caps the score ≤5 (never overcome by a high score); profile-only caps ≤25; missing evidence cuts score AND confidence; exact role outranks adjacent.

## Canonical decision contract

`Workbench / CSV / filters / badges / counters / bulk actions / outreach eligibility` MUST derive from `decideCanonical` + `contactReady`. Legacy fields (`match_tier`, `gate_decision`, `fit_tier`, `analyst_verdict`, `contact_status`) may remain internally but are reconciled — a reject in any of them can never present as contact/contact-ready.

## Migration

**None required.** Run-trace fields (run_id, workspace_id, original_user_query, parsed_intent_summary, target_personas, requested_role_family, requested_signal, source_strategy, provider_query_keywords/location, intent_tier, search_stage, relaxation_step_used, relaxed_filters, source_used, brain fingerprint, created_at) all fit the existing lead-row `raw` JSONB (already used for run_id/original_user_query/parsed_intent_summary). No new columns.

## Remaining integration (honest — NOT done in this PR; scoped, low-risk)

These modules are the tested source of truth; wiring them into the live path is the follow-up:
- **run-agent / orchestrate:** call `separateIntent` for routing, gate on `roleFamilyMatcher` exactness, stamp `canonical_final_decision` + `score_breakdown` + trace onto each lead's `raw`. (edge functions — need redeploy)
- **Workbench (`LeadResultsView.tsx`, `LeadTable.tsx`):** derive counters/badges from `canonical_final_decision`; replace the `contact_status !== 'needs_contact'` counter with the contact-ready contract; scope rows by `workspace_id + run_id` with a "Previous runs" history; disable outreach when not contact-ready. (frontend — needs the app to verify; not done blind)
- **CSV (`leadTable/csv.ts`):** already exports run_id/parsed_intent_summary/gate_reasons/missing_evidence/why_now; add `search_stage`/`relaxed_filters`/`canonical_final_decision` columns and default to the selected run.

## Controlled live-QA plan (needs approval + a workspace token)
Run the two failing prompts through `orchestrate` capped at 5 results and assert: (a) prompt 1 accepts only exact RevOps-family job posts, no AE/SDR, no agency/nonprofit/oversized; (b) prompt 2 returns account-first results, zero profile-only rows marked contact-ready, and materially different scores. Not run here (no token/JWT; providers prohibited).
