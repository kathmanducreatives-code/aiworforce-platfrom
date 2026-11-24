# LeadOcean + Apify discovery: audit, comparison and recommendation

**Status (2026-11-04):**
- **Offline:** recorded provider responses run through the real compiler, planner, executor and qualification engine.
- **Live:** paid discovery has **not** run. It needs a separate, owner-approved provider-test budget (§6).

**Reproduce:**
```
deno run -A scripts/dev/provider-comparison.ts
```
This writes `comparison.json`. The tests are in `tests/edge-functions/_shared/leadPipeline/concurrentDiscovery.test.ts`.

---

## 1. Integration audit

### LeadOcean

| Question | Finding | Where |
|---|---|---|
| Why is it disabled? | Three switches, all deliberate:<br>1. `PROVIDER_LEADOCEAN_ENABLED` and `LEADOCEAN_COMMERCIAL_TERMS_CONFIRMED` are both required (`flags.ts`), and TEST's required flags do not include them (smoke check `7a`).<br>2. The account is on the **Free plan: 1,000 lifetime records, 955 left**; past the ceiling, requests are refused.<br>3. Live provider tests are off by default (`AGENTORY_PROVIDER_LIVE_TESTS`) since the evaluation closed. | `discoveryProviders/flags.ts`, `docs/LEADOCEAN_FINAL_VERDICT.md` §7 |
| Are its capabilities represented correctly? | Yes. The planner registers `leadocean.people_search` (role: `discover_people`, **proves nothing**, claims funding only) and `leadocean.people_by_domain`. HQ and size are claims: HQ was wrong for ~29% of companies, and headcount runs low. | `leadPipeline/strategy.ts` `DISCOVERY_CAPABILITIES` |
| Company discovery, people discovery, or both? | **The API does both** (`/v1/search` people, `/v1/search/companies` companies, plus company enrich). **Agentory uses people search only.** Companies arrive as the employers inside person rows. Company search and company enrich are in the adapter but are **not wired into any strategy** (recorded as UNSUPPORTED in the discovery benchmark). | `adapters/leadocean.ts`; benchmark B1 |
| Hiring evidence? | **None.** LeadOcean has no job or posting data, so it can never prove a hiring requirement. | `docs/PROVIDER_CAPABILITIES.md` §2 |
| Normalisation | One field table (`FIELDS`) with the basis recorded per path (observed / documented / catalogue / inferred). A field not found stays **unknown**, and industry codes are never treated as industry labels. | `adapters/leadocean.ts` |
| Errors and rate limits | 5 req/s and 300/min; at most 2 count queries in flight. Only 429 and 503 are retried (they bill nothing), honouring `Retry-After` within bounds. A paid request that timed out is **never** retried. | `discoveryProviders/http.ts` |
| Cost | Records reserved in the durable ledger before the call. `meta.credits` is read back; the per-mission and per-provider ceilings come from the approved plan. | `discoveryProviders/budget.ts`, `orchestrator.ts` |

### Apify

| Question | Finding | Where |
|---|---|---|
| Does it work? | Yes, on TEST: `lead-pipeline` (Apify job search + company record) deployed, and smoke passed at `66a3e1ba`. | `agentory/test-smoke` |
| Configured actors (allowlist) | `harvestapi/linkedin-job-search`: $0.001/item + $0.001/start<br>`harvestapi/linkedin-company`: company record, $0.004/item + $0.00005/start<br>`harvestapi/linkedin-company-posts`, `linkedin-profile-posts`: $0.002/item<br>Company-employees and people-search actors are **not** on the allowlist. | `apifyInvoker.ts` `PIPELINE_ACTORS`, `signals.ts` |
| Billed account | **Cannot be verified from this session** (no token here). The plan is **Starter, $19/month** per the provider verdict. Confirming the account behind `TEST_APIFY_API_TOKEN` is an owner check (§6). | `LEADOCEAN_FINAL_VERDICT.md` §7 |
| What it proves | Identity, HQ (single HQ-flagged location), declared size band, and **hiring** (a dated posting, post-filtered on title and window; agency postings dropped). | `evidenceAuthority.ts` rules |
| Errors and cost | Every run reserves its worst case in the durable ledger before starting; an uncertain charge is never re-bought; per-run `maxTotalChargeUsd`; items capped at 100. | `multiProvider.ts` `ledgeredInvoker` |

### Both providers

| Question | Finding |
|---|---|
| How do they receive the mission? | From the **same canonical criteria** (`criteriaOf`, S2/S3). LeadOcean gets only what it can filter exactly (`leadoceanDiscoveryRequirements`: never the hiring signal, never an industry label outside its closed enum). Apify gets the role titles and geography. |
| Provenance | Every claim keeps `{provider, recordId, retrievedAt}`. Evidence is admitted to a company **only if its own identity names that company** (`evidenceIdentity`); refusals are recorded (`evidenceRefused`). |
| Deduplication | Deterministic, keyed on normalised domain and LinkedIn slug (`normalize.ts mergeRecords`). One identifier matching while another differs is an **identity conflict**: the records are kept apart, never force-merged. People are deduplicated by person ID and LinkedIn. |
| Conflicts | Disagreeing fields are kept as `conflicts` with both providers' values. They now reach the lead (`provenance.conflicts`) and the run summary. |

**Integration fixed in this change:**
- **A new strategy, `apify_leadocean_concurrent`.** Both providers run at the same time with independent failure handling. Apify's company record verifies the union of companies, and LeadOcean's employers get verified too. A single deduplicated merge feeds the shared engine. It is **user-selected only**: never chosen by score or model advice, so no existing plan changes.
- **The per-provider run summary.** It is now part of the `strategy_run` response (`providerRunSummary.ts`).
- **Provider conflicts are now carried on each lead.**

Two bugs were caught by the new tests and fixed before commit, both caused by LeadOcean naming employers *inside* person rows:
- LeadOcean-only companies went unverified;
- an Apify failure wrongly blocked a run that LeadOcean had results for.

## 2–3. One mission, three modes (offline, recorded responses)

**Mission:** "Find US B2B companies actively hiring Account Executives, excluding SDRs." The same ceiling applies to every mode ($0.25 Apify, 20 LeadOcean records), large enough that no result set is cut. The v1 and v3 contracts give **identical** outcomes.

| Metric | Apify | LeadOcean | Combined (concurrent) |
|---|---|---|---|
| Raw records | 10 job rows + 3 company records | 5 people rows | 10 job rows + 5 people + 5 company records |
| Unique companies | 4 | 4 | **6** |
| Qualified companies | **2** | **0** | **2** |
| Pending verification | 1 (no company record) | 4 (hiring unprovable; HQ unverified) | 3 (2 LeadOcean-only: **only hiring** open; 1 no record) |
| Rejected companies | 1 (HQ Toronto) | 0 | 1 |
| Verified evidence coverage | 100% | 0% | 100% |
| Unique additional companies | 2 (Harbor, Maple) | 2 (Cobalt Desk, Pinecrest) | — |
| Duplicate rate (raw → unique) | 0.60 (several postings per company) | 0.20 (two people at one employer) | 0.60 |
| API failures | 0 | 0 | 0 |
| Cost | $0.02305 (est. upper bound) | 5 LeadOcean records | $0.03105 + 5 LeadOcean records |
| Cost per qualified company | $0.0115 | — (none can qualify) | $0.0155 + 2.5 LeadOcean records |
| False qualifications | 0 | 0 | 0 |

**Overlap.**

| | Companies |
|---|---|
| Found by both | Northwind, Quartz (one company each, both sources kept) |
| Apify only | Harbor, Maple |
| LeadOcean only | Cobalt Desk, Pinecrest |
| Total unique | 6 |
| Additional **qualified** from LeadOcean | **0**. It cannot prove hiring; its companies are verified on identity, HQ and size and stay pending on hiring only |
| Additional **qualified** from Apify | 2 |

**Qualification accuracy** (`concurrentDiscovery.test.ts`, 11 tests):
- **Correct qualifications:** exactly the ground truth qualifies in every mode (precision 1.0, recall 1.0 for Apify and combined).
- **Requirements held:** US HQ, AE and the SDR exclusion hold everywhere. An SDR-only employer never qualifies; a contradicted HQ (Maple) is rejected.
- **Unknown evidence:** unknown mandatory evidence stays **pending**.
- **Conflicts:** a provider conflict (industry) is kept with both values and counted.
- **Independent failure:** if LeadOcean fails, Apify's results stand (run *partial*). If Apify fails, LeadOcean's companies are still verified and judged (run not blocked), and nothing qualifies without job evidence.
- **B2B:** "US B2B companies" ranks by B2B under the reviewed rule that a describing word is a disclosed preference. "**Only** B2B" is hard in every mode, and nothing qualifies without proof of it.

## 4. What the comparison shows

- **On a hiring mission, LeadOcean adds candidates, never qualified companies.** The 2 extra companies it found are verified real US companies, but each needs hiring proof that only Apify job evidence provides.
- **Concurrency costs about 35% more Apify spend** (the extra company records) plus LeadOcean records, for 2 additional *pending* companies and **0 additional qualified** ones in this mission.
- **LeadOcean's real strength is people**: decision-makers by role, size and industry, plus phone flags. Apify has no general people search on the allowlist.

## 5. Recommendation: option 5, intelligent routing by mission

| Mission shape | Strategy | Why |
|---|---|---|
| Defined by a **dated signal** (hiring, posts) | `apify_only` | Only Apify discovers by and proves the signal; LeadOcean adds cost and pending rows |
| Needs **decision-makers** at signal companies | `apify_plus_leadocean` (Apify discovers and proves; LeadOcean finds people by exact domain) | LeadOcean's strength, applied only to companies already found |
| **Firmographic** ICP with no signal (industry, size, geography) | `leadocean_plus_apify` (LeadOcean proposes; Apify's record proves HQ and size) | LeadOcean's broad structured search; nothing qualifies on its claims |
| Maximum **recall** where pending candidates are acceptable | `apify_leadocean_concurrent`, by explicit request only | More unique candidates, every requirement held; costs more per qualified company |

This is the existing deterministic planner's behaviour, plus the new opt-in concurrent mode. Not every provider is forced onto every mission: LeadOcean-only stays **refused** for hiring missions unless review-only candidates are explicitly allowed.

**Next step (not built yet).** An Apify job search **by company** for LeadOcean-only companies would let LeadOcean's candidates qualify on hiring. That is a new paid step and needs owner approval.

## 6. Live TEST evaluation: prepared, not run

**Before any paid call (owner):**
1. **Approve a separate provider-test budget.** This is independent of the $2 GPT study. Proposed: **Apify ≤ $0.25, LeadOcean ≤ 25 records**.
2. **Confirm the Apify account** behind `TEST_APIFY_API_TOKEN` is the intended billed account (Starter), and its balance.
3. **Enable LeadOcean on TEST:**
   - set `PROVIDER_LEADOCEAN_ENABLED=true` and `LEADOCEAN_COMMERCIAL_TERMS_CONFIRMED=true`;
   - connect the workspace's LeadOcean key (free `/v1/usage` check: records remaining);
   - re-enable `AGENTORY_PROVIDER_LIVE_TESTS` only for the run.

**The run.**
- **What:** the same mission through `strategy_plan` → owner approval (signed token) → `strategy_run`, once per mode (`apify_only`, `leadocean_only` with review-only, `apify_leadocean_concurrent`).
- **Limits:** each run's plan ceiling is ≤ ⅓ of the budget. No phone lookups, no enrichment, no outreach.
- **Where results go:** writes only to TEST.
- **Metrics:** `providerSummary` in each response gives this table's numbers.

**Hard limits already enforced in code:**
- the plan ceiling, signed into the approval token;
- durable ledger reservations;
- `maxTotalChargeUsd` per Apify run;
- LeadOcean per-mission and per-provider record caps;
- no retries of paid requests.
