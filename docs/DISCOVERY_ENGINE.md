# Agentory discovery engine — provider-neutral, GPT-planned

**User query → GPT interpreter → provider planner → discovery (any provider first) →
deduplication → evidence verification → shared eligibility engine → ranking → ATLAS review queue.**

Code: `supabase/functions/_shared/discoveryEngine/` — `spec.ts` (schema + interpreter gate),
`sources.ts` (capability registry + adapter interface), `sources/{leadocean,apify,apollo}.ts`,
`planner.ts`, `engine.ts`, `cache.ts`, `projection.ts`, `service.ts`; edge function
`supabase/functions/discovery-engine/` (off: `DISCOVERY_ENGINE_ENABLED`). The LeadOcean-led ICP
walk (`leadPipeline/`, `lead-pipeline`) remains as one strategy.

## 1. Structured query schema (`DiscoverySpec`, `spec.ts`)

| field | meaning |
|---|---|
| `target` | `people` or `companies` |
| `quantity` | leads wanted (clamped 1–100, the compiler's bounds) |
| `roles` | decision-maker titles |
| `company` | `industries`, `descriptors`, `employees {min,max}` |
| `geography` | `hq` (employer headquarters) and `person` (where the person is) — separate |
| `signals[]` | `kind` hiring · posts · funding · expansion · leadership_change; `roles`/`topics`; `withinDays` (null when unstated — never invented); `required` |
| `hard[]` + `grounding{}` | hard constraints, each with the **exact words of the request** it rests on |
| `preferences[]` | ranking only |
| `contact` | `phone` / `email`: `none` (default) or `wanted` — discovery never requests either |
| `verification` | HQ / size checks (forced on for hard HQ / size), optional founder relationship |
| `budget` | user caps (LeadOcean records, Apify USD) — the workspace caps still apply |
| `providers` | `requested` / `excluded` — honoured, gaps explained |

The gate (`validateSpec`) demotes any hard constraint whose quote is not in the request, turns
an ungrounded "required" signal into a preference, drops unknown providers and signal kinds, and
reports every change in `repairs`. GPT proposes; the gate decides what is binding. The shared
engine's criteria come from the real mission compiler, fed only the grounded hard constraints.

## 2. Provider planner (`planner.ts`)

Pure and deterministic over the spec and the workspace's provider state (enabled, permitted,
caps). Reads only the capability registry (`sources.ts`): what each provider can discover,
verify or enrich, its native filters, freshness, evidence type and cost (LeadOcean per record;
Apify from the actor catalogue's BRONZE prices). Output: ordered steps with dependencies,
`why` for each, `notSelected` with reasons, `verifies`, `uncertain`, `limitations`, worst-case
spend, `reducedForBudget`, and a plan hash over the whole validated spec and the steps.

### Decision rules — LeadOcean vs Apify vs both

| the request needs | seed (first step) | then |
|---|---|---|
| a **required hiring** signal | Apify job search (only provider that finds employers by open roles, dated) | people request → LeadOcean `people_at_companies` (per record), else Apify company-employees |
| a **required posts** signal | Apify post search (company-authored posts only) | as above |
| a structured **people** search | LeadOcean (role + industry + size + HQ filters, per record), else Apify people search (fallback: no industry filter, $0.10 minimum) | — |
| a structured **company** search | LeadOcean (Apify has no firmographic company search) | — |
| funding | LeadOcean funding narrowing (claim, ~21% coverage) — prioritises verification only | corroboration only by a dated Apify post |
| hard HQ / size | — | Apify company record (the only source that can prove them under evidence authority) |
| founder relationship (optional) | — | Apify company-employees, eligible companies only; ranks, never gates |
| preferred signals | — | Apify posts / jobs, eligible companies only; missing never blocks |
| phones | never planned | separate, separately approved step |

A provider is usable only if registered `available`, enabled, permitted for the workspace, not
excluded, and (when the user named providers) named. A named provider lacking a needed capability
is honoured and the gap reported (`partial_capability`). Optional steps are dropped first, then
everything is scaled down, until the plan fits the caps; it never exceeds them.

## 3. Execution (`engine.ts`)

Approval (workspace + plan hash + caps) required — a plan is not a purchase order. Discovery
steps in dependency order with per-provider remaining budget and timeouts; seeds deduplicated
before any paid follow-up; `mergeRecords` across providers (per-fact provenance, conflicts kept);
screening on provider claims (spending only); cached company records (workspace-scoped, fresh)
before paid ones, highest priority first, overflow `needs_verification`; `verifyLeads` →
`evaluateEligibility`; a required signal must be evidenced, dated and in window (withholds,
never grants); explicit conflicts (provider vs provider, provider claim vs verified record);
optional founder check and signals for eligible only; ranking; review queue. Every paid call is
reserved in the ledger first; a repeated execution replays; nothing is retried.

Each candidate carries `facts[]` (fact, value, provider, source id, retrieved / event time,
confidence, status `provider_claim | verified | corroborated | contradicted`), `conflicts[]`,
`discoveredBy`, `verification`, `requestMatch`, and a classification
`eligible | needs_verification | rejected (verified | screened | duplicate)`.

## 4. Apollo integration interface

`DiscoverySource { id; run(SourceRunInput): Promise<SourceRunResult> }` returns
`ProviderCompany` / `ProviderPerson` rows — the same shape LeadOcean and Apify return, so merging,
verification and qualification need no change. Apollo is in `SOURCE_REGISTRY` as
`registered_disabled` with `planned` offers (people / company search, from its public docs);
`sources/apollo.ts` refuses every call without network use. To enable: implement `run` over the
existing `adapters/apollo.ts`, validate access (People API Search returned 403 on the current
plan), flip the offers to `available`, add its flag. No planner or engine change is needed.

## 5. Examples (generated by `scripts/discovery-engine-examples.ts`, fixture GPT output)

### "Find 10 founders of US SaaS companies with 10-100 employees."

- **Spec:** target people, 10; hard [geography_hq, employee_range, roles]; roles [Founder, Co-Founder, CEO]; signals none
- **Strategy:** apify+leadocean — status ready; worst case 30 LeadOcean records, $0.12005 Apify
  - Discovery is a structured people search via LeadOcean.
  - Cached company records younger than 30 days are reused before any purchase; duplicates are removed before verification.
  - s1 LeadOcean · people_by_firmographics: a structured search by role, industry, size and location: LeadOcean filters on all of them, priced per record
  - s2 Apify · company_record: headquarters and declared size can only be proven by the company record under evidence-authority rules; provider search rows are claims
  - Not using Apollo: registered for the planned integration; not enabled until its access, permissions and capabilities are validated
- **Verified:** headquarters (single HQ-flagged location); declared company size band; company identity (LinkedIn URL / domain)

### "Find US companies hiring Account Executives in the past 30 days."

- **Spec:** target companies, 10; hard [geography_hq, signal:hiring]; roles []; signals hiring (required, 30d)
- **Strategy:** apify — status ready; worst case 0 LeadOcean records, $0.15105 Apify
  - Discovery starts from job postings (Apify): the required signal defines the population.
  - Cached company records younger than 30 days are reused before any purchase; duplicates are removed before verification.
  - s1 Apify · companies_by_hiring: the request requires recent hiring (Account Executive); only Apify can find employers by their open roles, dated
  - s2 Apify · company_record: headquarters can only be proven by the company record under evidence-authority rules; provider search rows are claims
  - Not using LeadOcean: not needed: the selected providers cover every step more directly or more cheaply
  - Not using Apollo: registered for the planned integration; not enabled until its access, permissions and capabilities are validated
- **Verified:** headquarters (single HQ-flagged location); company identity (LinkedIn URL / domain)

### "Find US SaaS founders at companies hiring salespeople."

- **Spec:** target people, 10; hard [geography_hq, roles, signal:hiring]; roles [Founder, Co-Founder, CEO]; signals hiring (required)
- **Strategy:** apify+leadocean — status ready; worst case 90 LeadOcean records, $0.15105 Apify
  - Discovery starts from job postings (Apify): the required signal defines the population.
  - Cached company records younger than 30 days are reused before any purchase; duplicates are removed before verification.
  - s1 Apify · companies_by_hiring: the request requires recent hiring (Sales Representative, Account Executive, SDR); only Apify can find employers by their open roles, dated
  - s2 LeadOcean · people_at_companies: decision-makers at the discovered companies, by company LinkedIn URL and title (per-record cost)
  - s3 Apify · company_record: headquarters can only be proven by the company record under evidence-authority rules; provider search rows are claims
  - Not using Apollo: registered for the planned integration; not enabled until its access, permissions and capabilities are validated
- **Verified:** headquarters (single HQ-flagged location); company identity (LinkedIn URL / domain)

### "Find US marketing agencies posting about AI automation."

- **Spec:** target companies, 10; hard [geography_hq, signal:posts]; roles []; signals posts (required, 90d)
- **Strategy:** apify — status ready; worst case 0 LeadOcean records, $0.1801 Apify
  - Discovery starts from company posts (Apify): the required signal defines the population.
  - Cached company records younger than 30 days are reused before any purchase; duplicates are removed before verification.
  - s1 Apify · companies_by_posts: the request requires companies posting about AI automation; only Apify can search posts
  - s2 Apify · company_record: headquarters can only be proven by the company record under evidence-authority rules; provider search rows are claims
  - Not using LeadOcean: not needed: the selected providers cover every step more directly or more cheaply
  - Not using Apollo: registered for the planned integration; not enabled until its access, permissions and capabilities are validated
- **Verified:** headquarters (single HQ-flagged location); company identity (LinkedIn URL / domain)

### "Find founders at recently funded US companies with 10-200 employees."

- **Spec:** target people, 10; hard [geography_hq, employee_range, roles]; roles [Founder, Co-Founder]; signals funding (preferred, 365d)
- **Strategy:** apify+leadocean — status ready; worst case 30 LeadOcean records, $0.12005 Apify
  - Discovery is a structured people search via LeadOcean.
  - Funding narrows the LeadOcean search as a provider claim (held for ~21% of companies); it prioritises verification and is never proof.
  - Cached company records younger than 30 days are reused before any purchase; duplicates are removed before verification.
  - s1 LeadOcean · people_by_firmographics: a structured search by role, industry, size and location: LeadOcean filters on all of them, priced per record
  - s2 Apify · company_record: headquarters and declared size can only be proven by the company record under evidence-authority rules; provider search rows are claims
  - Not using Apollo: registered for the planned integration; not enabled until its access, permissions and capabilities are validated
- **Verified:** headquarters (single HQ-flagged location); declared company size band; company identity (LinkedIn URL / domain)

### "Using only Apify, find 10 founders of US SaaS companies with 10-100 employees." (explicit provider)

- **Strategy:** apify — ready; worst case $0.24005 Apify
  - s1 Apify · people_by_firmographics: Apify is the usable provider for a structured people search (fallback: fewer filters)
  - s2 Apify · company_record: headquarters and declared size proven by the company record
  - Not using LeadOcean: not among the providers the request named
  - Limitations: $0.10 minimum per run; no industry filter (SaaS is checked downstream); no per-company cap

## 6. Tests (offline; `tests/edge-functions/_shared/discoveryEngine/`)

LeadOcean-only · Apify-only · combined · hiring → Apify · structured founders → LeadOcean ·
signal + founder → both · unsupported capabilities · provider disagreement (record vs claim; provider
vs provider) · missing evidence · cross-provider dedupe (one paid item) · partial budget exhaustion
(never over the cap) · cached evidence reuse · no automatic phones · workspace isolation (approval
and cache) · disabled / unpermitted providers · timeouts and partial failures · Apollo registered
but disabled · repeated execution replays (no duplicate charge) · interpreter grounding · service
permissions, plan-hash binding, tampered specs, workspace caps.

## 7. Remaining blockers

1. The GPT interpreter is validated offline only (fixture outputs); prompt quality on live requests is unmeasured.
2. Apify post search and people search shapes come from the actor catalogue, not yet observed in this engine; job search and company records were observed (catalogue probe, Test E).
3. LeadOcean `companyLinkedin` scoping for `people_at_companies` is a documented filter, not yet observed live.
4. Signals are not shared-engine criteria: a request with no hard company constraint returns candidates for review (the plan says so).
5. Held migrations not applied: `20261027120000_provider_connections`, `20261031120000_lead_pipeline_checkpoints`, `20261101120000_discovery_evidence_cache`.
6. Three entry points coexist: `provider-discovery` (UI consumers `ProviderDiscoveryPanel.tsx`, `src/lib/providerDiscovery.ts`), `lead-pipeline` (ICP walk) and `discovery-engine`. Redirect the UI to `discovery-engine` after TEST validation; retire nothing before.
7. Apollo: access and capabilities unvalidated (planned in 1–2 days).

## 8. Recommended controlled TEST validation (not run; needs approval)

Three requests against the TEST workspace, each executed once and then **re-executed** to prove ledger replay:

| request | providers | cap |
|---|---|---|
| "Find US companies hiring Account Executives in the past 30 days." (10) | Apify job search ≤10 jobs + company records ≤10 | ≤$0.06 |
| "Find 5 founders of US SaaS companies with 10-100 employees." | LeadOcean ≤15 records + Apify records ≤$0.07 | 15 records, $0.07 |
| "Find US SaaS founders at companies hiring salespeople." (5) | Apify job search ≤5 + LeadOcean ≤15 records + Apify records ≤$0.06 | 15 records, $0.07 |
| **total** | | **≤30 LeadOcean records, ≤$0.20 Apify** |

Observe: live interpreter specs and repairs, plan choices, Apify post / job / record shapes,
LeadOcean `companyLinkedin` scoping, cross-provider merge and conflicts, cache reuse on the second
request, zero spend on re-execution, and reconciled provider counters. Needs: the evidence-cache
and connection migrations applied to TEST only (or the in-memory stores for a script run),
`DISCOVERY_ENGINE_*` flags on for the TEST workspace only, and `AGENTORY_PROVIDER_LIVE_TESTS=enabled`.
