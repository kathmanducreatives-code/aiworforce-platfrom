# Evidence-first architecture: current vs target

Target: `AGENTORY_EVIDENCE_FIRST_RESEARCH_VERIFICATION_PLAN.md` (the "MD").
Current: commit `383633cd`, audited 2026-09-19.
Live evidence: baseline canary queue `9b1b70a2`, task `967a739d`, conversation `3a1f55cf`.

**Status legend:**

| Status | Meaning |
|---|---|
| ALREADY | Already implemented |
| BUGGY | Implemented but buggy |
| PARTIAL | Partially implemented |
| MISSING | Missing |
| ACTOR-VERIFY | The actor needs live verification |
| NOW | Safe to implement now |
| P6 … P9 | Deferred to that phase |

## Verified root causes (from the code, not the prior diagnosis)

**1. Workbench tabs.** The prior diagnosis was right, but incomplete.

`fetchTasksForPlan` selects `TASK_LIST_COLUMNS` and rebuilds `result` from nine named keys. `workbench_mission_view` is not one of them. Every reader in `src/lib/workbench` therefore got `null` and fell back to the legacy Brain rows (`workbench_evaluation_rows`, `resumable: true`). Those rows put Feathery (qualified) and Outsmart (a verified FAIL) under "Not reached".

The reader is correct: fed the full stored result, it returns 4 in review, 15 ruled out and 0 not reached. The frontend tests missed the bug because they fed the full result object.

**2. Terminal status.** Three independent causes, not one.

- **a.** `settleV2Terminal` overrode only a legacy `continuation_required`. The legacy controller's `round_limit_reached`, which comes from its own round count, survived even though the canonical stop reason was `quota_met`.
- **b.** `projectStatus` was given the legacy contact-ready quota: `cf.quota.eligible_leads = 0` against 1 requested. On V2 the deliverable is the qualified company (`companyIsTheDeliverable`), so `task_status` became `partial` with the goal met. `company_first.quota` carries the same 0/1, and the browser's `taskQuotaUnmet` reads it.
- **c.** `finalizeCompanyFirstPlan` refuses every transition out of a non-`executing` plan. A plan checkpointed as `partial` on slice 1 can therefore never become `complete`. That is latent for every multi-slice V2 mission, even once (a) and (b) are fixed.

**Correction to the baseline report.** "Dashboard: Paused at a checkpoint" was a mid-run reading, not a persistent defect. The dashboard maps `tasks.status = ready` to "checkpoint", and during a live slice the row is `ready`. After completion the dashboard shows "No live work". What remains minor: the terminal row write sets no `finished_at` or `completed_at`, so the dashboard never shows a "completed" event.

**3. Business-model proof is too weak.** Confirmed.

`businessModelDecision` accepts a code when a claim is validated, confidence is at least the minimum, no rejection or conflict exists, and `excerptInconsistency` finds no contradiction. `excerptInconsistency` deliberately treats a quote that names no facet as saying nothing, so it "leaves the reading standing". Nothing requires the quote to state the facets the code asserts.

- Feathery: "an agentic data intake platform for financial firms" was accepted as `b2b_saas`. The quote shows business customers and a platform. It does not show SaaS delivery.
- Outsmart: "Rebuilding higher education for the AI era" was accepted as `consumer`, which produced a verified FAIL. The quote names no audience.

P5 can therefore turn a model inference into a hard PASS or FAIL.

**4. First-in-function.** Dormant defect. Zero employees in the function becomes `supported` (source `team_composition`). The MD says zero results must not prove it. It is unreachable live only because the company-employees actor is refused.

## Gap matrix

### Mission semantics and canonical claims

**User vs Brain**
- Current: the Brain merge keeps the user's list; the refinement becomes `company_brain_preference`.
- Baseline: card correct. B2B SaaS and SaaS hard (user); founder-led target (Brain); size a hard Brain policy.
- Target: §5.
- Gap: none.
- Status: ALREADY.

**Canonical claim model: business model**
- Current: two hard criteria, "b2b saas" and "saas" (from the compiler's verticals).
- Baseline: both evaluated; they pass and fail together.
- Target: a single `business_model = B2B_SAAS` claim.
- Gap: duplicate gate.
- Severity and phase: low, NOW (display) or P6.
- Change: collapse into one claim when one value subsumes the other (a semantic change, so report first).

**Canonical claim model: stage and startup**
- Current: "startup" is hard with status `unprovable_today` and is not evaluated. "Seed" is a target and `unprovable_today`.
- Baseline: Feathery surfaced with neither checked. Neither appears in its hard checks or caveats.
- Target: `funding_stage = SEED`, hard.
- Gap: a hard criterion is shown but silently not enforced.
- Severity and phase: HIGH (truthfulness), P6.
- Change: see "Canonical representation of seed-stage startup" below.

**Canonical claim model: first-in-function**
- Current: an opportunity-signal target.
- Target: first-in-function is hard, but only when a route can prove it.
- Status: P6 / Phase E.

**Claim registry: value schema, support and contradiction semantics, freshness, routes**
- Current: split across `missionCriteria` (dimensions), `candidateEligibility` (semantics per dimension), `EVIDENCE_VALIDITY_DAYS` (freshness) and `actorIntelligence` (routes). There is no single per-claim record.
- Status: PARTIAL.
- Change: add a `claimRegistry` that binds claim → evidence dimension → routes, reads readiness from Actor Intelligence, and reads freshness from `EVIDENCE_VALIDITY_DAYS`. Phase B; NOW.

### Execution spine (P2)

**Actor Intelligence readiness**
- Current: `actorIntelligence.ts` uses the MD's states plus `NEEDS_CONTRACT_WORK`. `routeActorReady` gates routes.
- Baseline: the disabled actor was refused once.
- Target: §8.
- Gap: the funding card's cost is stale ($0.045 on the card; the live price is $0.07 per record).
- Status: ALREADY. Card update in P6.

**ProviderCallSpec with provenance**
- Current: per-field `proposed_value` / `final_value` / `changed_by` / `reason`; frozen input; idempotency keys.
- Baseline: 0 duplicate purchases; plan v1→v5 through recorded amendments.
- Status: ALREADY.

**Amendment hygiene**
- Current: v2 and v3 each added an identical page-2 route.
- Baseline: neither was bought (idempotency held).
- Gap: redundant amendments.
- Severity and phase: low, P6.
- Change: deduplicate route content on amendment.

### Research fabric (P4)

**CandidateObservation, entity resolution, union, graph**
- Baseline: 20 companies, `found_by` kept across routes.
- Status: ALREADY.

**Evidence-gap detector**
- Current: research waves compute per-company `gaps` (missing required dimensions), but only to steer discovery routes. Run-agent's evidence-debt path picks web pages from the legacy Brain `mission_evaluation`.
- Baseline: pages were bought for Outsmart and RemoteHunter, not Feathery; Brain-driven, not claim-driven.
- Target: §7, claim-level gaps.
- Gap: gaps are not canonical, and nothing maps them to routes.
- Severity and phase: HIGH, NOW (Phase C).
- Change: canonical gap detector over the P5 decision, plus a router to the READY routes in Actor Intelligence.

**Claim-specific verification routes**
- Current: Firecrawl through the evidence-debt path (Brain-driven, one pass).
- Status: PARTIAL.
- Change: route business-model gaps to Firecrawl `product` / `pricing` / `customers` from the canonical gap. The P6 funding route plugs into the same router.

### Eligibility (P5)

**Claim semantics**
- Current: accepted means PASS, verified contradiction means FAIL, and review or missing means PENDING.
- Baseline: Zoobook (review) stayed pending; RemoteHunter (missing geography) stayed pending.
- Status: ALREADY.

**Business-model decomposition**
- Current: facet vocabulary (audience, delivery, ai) plus a contradiction check only.
- Baseline: Feathery PASS and Outsmart FAIL both came from quotes that do not state the deciding facet.
- Target: §10, §11. `software_product`, `business_customer`, `saas_delivery`, `service_primary` must each be stated.
- Gap: support is never required.
- Severity: CRITICAL (evidence truth).
- Status: BUGGY. NOW.
- Change: `businessModelFacetProof`: the claim's quotes must state every facet the code asserts, otherwise `review`. Record the facet evidence on the assessment. Extend the vocabulary, conservatively and deterministically, for business-customer and SaaS-delivery phrases.

**Headcount safety**
- Baseline: no 0 or null headcount; the 11 size screen-outs were 156 to 95,436 employees.
- Status: ALREADY.

**Vocabulary protections (AI≠Retail, software≠SaaS, service≠SaaS, mixed≠B2B)**
- Baseline: DualEntry and Tristar (AI SaaS) stayed pending.
- Status: ALREADY.

**First-in-function semantics**
- Current: a job posting's "first/founding" wording counts as support (correct). Zero team members counts as support (wrong).
- Baseline: unreachable (the actor is refused).
- Target: §9.2.
- Status: BUGGY (dormant). NOW.
- Change: zero members means `unverified`, never `supported`.

**Opportunity labels**
- Current: the P5 reasoner produces the labels; it cannot override a hard FAIL.
- Baseline: Feathery "worth considering".
- Status: ALREADY.

### Continuation (§22)

**Canonical qualified count**
- Baseline: `quota_met` came from the canonical count; no continuation.
- Status: ALREADY (fixed in 383633cd).

**Other continuation inputs**
- Current: `frontierRemaining` is the engine's processing frontier (fine). The in-slice `evidenceDebt` is the legacy Brain `unknown_fields`. There is no "pending + READY route → VERIFY" rule, so "0 qualified, frontier empty" leads to `replenishment_required`, which buys more discovery.
- Baseline: not exercised (quota met).
- Target: §22.
- Gap: pending claims never route to verification.
- Severity: HIGH.
- Status: PARTIAL. NOW (Phase C).
- Change: a V2 gap summary drives the gate. Verify before discovering. Record `unresolved_hard_checks` and `capability_unavailable` when no route exists.

**Terminal status**
- Current: see root causes 2a–2c.
- Baseline:

  | Queue | Task row | Lineage | Plan | Result |
  |---|---|---|---|---|
  | complete | complete | terminal | partial | round_limit_reached / partial |

- Status: BUGGY. NOW.
- Change: the V2 terminal comes from the canonical stop reason. The V2 quota is the canonical qualified count when the company is the deliverable. A plan may move from `partial` to `complete` or `failed`.

### Persistence and Workbench

**Checkpoint restore**
- Current: the three-slice invariant test.
- Baseline: single slice; checkpoint written (20 companies).
- Status: ALREADY. Not exercised live.

**Workbench backend view**
- Baseline: 20 / 14 / 4 / 1 / 1, correct.
- Status: ALREADY.

**Workbench frontend**
- Current: readers are canonical, but the fetch drops the view.
- Baseline:

  | | Qualified | In review | Ruled out | Not reached |
  |---|---|---|---|---|
  | UI | 1 | 0 | 16 | 4 |
  | Canonical | 1 | 4 | 15 | 0 |

- Status: BUGGY. NOW.
- Change: project `workbench_mission_view` through a pure, tested `projectTaskListRow`. Test against the real canary result, through the production column list.

**Supporting URL on grounded claims**
- Current: `url` is carried, but null for grounded claims (engine-level item).
- Status: PARTIAL, P6.
- Change: carry the cited page URL from the registry item behind the quoted `evidence_id`.

**Cross-mission reuse**
- Current: none. A P8 design exists.
- Status: P8.

### Signals and phases

| Area | Current | Status |
|---|---|---|
| Funding discovery (§12, §13) | `apify_funding_rounds_datahyena` is CARDED_BUT_NOT_LIVE | ACTOR-VERIFY, P6 |
| Known-company funding verification | Not in the repo | ACTOR-VERIFY, P6 |
| First-in-function via employees | NEEDS_PROVIDER_WORK (opt-in) | ACTOR-VERIFY, P6/E |
| News, launch, expansion (§15) | Google News NEEDS_EXTRACTION_WORK | P7 |
| LinkedIn posts (§16) | NEEDS_EXTRACTION_WORK | P7 |
| Headcount snapshots (§19) | `company_headcount_snapshots` exists (growth use) | PARTIAL, P8 |
| Hiring velocity (§20) | No job snapshots | P8 |
| Leadership (§14) | Not in the repo | P9 |
| Technology (§17) | builtwith NEEDS_EXTRACTION_WORK | P9 |
| M&A (§18) | Not in the repo | P9 |

## Canonical representation of "seed-stage startup"

Report only; no semantic change in this pass.

**Today.** "startup" becomes a HARD criterion marked `unprovable_today`, and eligibility drops it (it evaluates only criteria whose status is `ok`). "seed" becomes a TARGET, also unprovable. The card discloses both. A hard requirement that is shown but never enforced is the least truthful of the options.

**Safest target:**
- **Folding.** "seed-stage startup" becomes one claim, `funding_stage = seed`. The noun "startup" is subsumed: a company with a verified latest round of Seed is a startup in the only sense any source can prove. No separate "startup" criterion is kept.
- **Hardness.** Hard (user_explicit), as the MD requires. It flips to hard at the same moment the P6 known-company funding route becomes READY, never before. Flipping earlier would leave every candidate PENDING with no route to resolve it. That would be truthful, but it is a product change that belongs with the route that can answer it.
- **Until then:** every surfaced lead must carry an explicit "funding stage: unverified — no funding source available" line. It already cannot be labelled EXACT MATCH. The standalone "startup" (no stage word) must be shown as a target or hypothesis, never as a hard criterion that is silently ignored.

## Actor matrix

Checked live on the Apify store on 2026-09-19. Output schemas come from our live-proven normalizers where marked; otherwise they are unverified.

**harvestapi/linkedin-job-search**
- Claims: open role, role title/function, location, posted date, description, employer LinkedIn identity.
- Mode: discovery and verification.
- Readiness: READY (live: baseline, 2 calls, 20 rows).
- Input: `jobTitles`, `locations`, `postedLimit`, `sortBy`, `startPage`, `maxItems`, `industryIds`, `company`.
- Output: normalized by `normalizeLinkedInJob` (live-proven).
- Cost: $0.001 per job plus $0.001 per start (baseline: $0.011 per 10 rows).
- Freshness: `postedLimit` (month).
- Pagination: `startPage`.

**harvestapi/linkedin-company**
- Claims: identity, domain, HQ, headcount, industry, description.
- Mode: verification.
- Readiness: READY (baseline: 6 companies, $0.0241).
- Input: `companies` (LinkedIn URLs).
- Output: `normalizeLinkedInCompanyEnriched` (live-proven).
- Cost: $0.004 per company.
- Limitation: `employeeCount: 0` means unknown (handled).

**harvestapi/linkedin-company-employees**
- Claims: first-in-function (team composition).
- Mode: verification.
- Readiness: NEEDS_PROVIDER_WORK. Opt-in at our tool layer; refused once in the baseline.
- Output: store schema not published.
- Cost: $0.02 per start plus $0.003 (basic) to $0.012 (full + email) per profile.
- Limitation: needs an opt-in decision and a coverage study. Zero results is not proof.

**Firecrawl `/scrape`**
- Claims: business-model facets, first-party pages.
- Mode: verification.
- Readiness: READY (6 pages in the baseline).
- Input: one URL, `max_pages: 1`.
- Output: markdown.
- Cost: 1 credit per page ($0.0064 budget rate).
- Limitation: the page must exist; missing pages cost 0.

**datahyena/company-funding-rounds**
- Claims: funding event, round type, date, amount, investors.
- Mode: discovery (feed).
- Readiness: CARDED_BUT_NOT_LIVE → **ACTOR-VERIFY**.
- Input:
  - `since`, `round[]` (enum: pre-seed, seed, series-a…), `countries[]`, `verticals[]` (includes `saas`), `employeeBuckets[]`
  - `minAmountUsd` / `maxAmountUsd`, `enrichedOnly`, `maxItems`, `cursor`
- Output: **not published**; paid probe required.
- Cost: **$0.07 per record** (free tier; the repo card says $0.045).
- Freshness: `since`.
- Identity: domain only when the company is resolved (`enrichedOnly`).
- Limitation: charged per record, so `maxItems` must be clamped.

**enrich-crm/enrich-crm-funding**
- Claims: latest round, funding history, total raised, investors.
- Mode: known-company verification.
- Readiness: NOT_PRESENT in the repo → **ACTOR-VERIFY**.
- Input: `domain` / `companyName` / `companyLinkedinUrl` / `companyLinkedinId`, or `items[]` for batches.
- Output: **not published**; probe required.
- Cost: $0.03 per found record (charged only when data is found).
- Limitation: 9 monthly users; coverage unknown.

**datahyena/executive-job-changes**
- Claims: leadership change.
- Mode: discovery.
- Readiness: NOT_PRESENT. Phase: P9.
- Cost: $0.07 per record.
- Limitation: 1 monthly user.

**datahyena/company-acquisitions-ma**
- Claims: M&A.
- Mode: discovery.
- Readiness: NOT_PRESENT. Phase: P9.
- Cost: $0.07 per record.
- Limitation: 2 monthly users.

**datapilot/website-technology-stack-scraper**
- Claims: technology (known domain only).
- Mode: verification.
- Readiness: NOT_PRESENT. Phase: P9.
- Cost: $0.002 per site.
- Limitation: no reverse lookup; 3 monthly users.

**Google News and LinkedIn posts actors (carded)**
- Claims: launch, expansion, social activity.
- Mode: discovery.
- Readiness: NEEDS_EXTRACTION_WORK → **ACTOR-VERIFY** in P7.
