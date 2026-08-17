# Run audit — plan `c4fc6d4e`, task `e0e62ecd`, 2026-08-17 11:11:20Z

Request: *"Find 10 qualified AI startups in the United States that are currently hiring software engineers."*

Result: **0 qualified leads.** 110 candidates discovered, 30 investigated, 0 qualified,
80 frontier remaining, stopped by a continuation refused with HTTP 500.

Everything below is traced to a file and line, or to a persisted field of the run.
Nothing here is inferred from behaviour alone.

---

## The single most important finding

**The GPT-first intelligence architecture already exists in code. It was entirely
switched off.**

`tasks.result.lead_runtime.intelligence_mode` was `"deterministic"`.
[`leadIntelligencePolicy.ts:112-121`](../supabase/functions/_shared/leadIntelligencePolicy.ts)
returns that value only when `present.length === 0` — when **not one** of the five
required intelligence stages is enabled:

```
mission_compiler        GPT_LEAD_MISSION_COMPILER          unset
grounded_brain          GROUNDED_COMPANY_BRAIN             unset
full_pool_evaluation    FULL_POOL_GROUNDED_EVALUATION      unset
pool_ranking            GPT_POOL_RANKING                   unset
multi_round             MULTI_ROUND_SOURCING               unset
```

Five more exist and are also unset: `GPT_LEAD_STRATEGY`, `MISSION_TRIAGE`,
`MISSION_EVALUATION`, `SEMANTIC_COMPANY_CLASSIFICATION`, `SIGNALS_V2`.

Verified against the live project: **none of the ten is set.** The comment in the
policy file calls the deterministic path *"the INTENDED behaviour here, not a
degraded one"* — so the run did exactly what it was configured to do.

This reframes the refactor. The work is not mostly *building* GPT stages. It is
making the GPT path unconditional and **deleting the deterministic interpretation
branches and the flags that select them**, so one canonical path remains.

---

## A. Why did YC run first?

Not a YC preference. A capability chain whose first link resolves to the YC actor.

The mission's `required_capabilities[0]` is `startup_company_discovery`, recorded on
the run as `entry_capability`. `resolveDiscoveryStrategy`
([`leadCapabilityEngine.ts:1094`](../supabase/functions/_shared/leadCapabilityEngine.ts))
then picks the actors for that capability:

```ts
if (!deps.planDiscovery) return deterministicDiscoveryStrategy(opts.mission, limits);
try {
  const proposed = await deps.planDiscovery({ ... });
  return validateDiscoveryStrategy(actors, opts.mission, limits);
} catch (e) {
  return deterministicDiscoveryStrategy(opts.mission, limits);
}
```

`deterministicDiscoveryStrategy` maps `startup_company_discovery` to
`apify_yc_companies_memo23`. So "startup" ⇒ YC, structurally.

**Honest gap:** `state.discovery_strategy` — which records
`source: model_validated | model_repaired | deterministic_fallback` — is computed and
logged but **never persisted to the task result**. `run-agent` writes no
`discovery_strategy` field. So the data cannot say whether GPT was asked and refused,
or proposed something the validator rejected. The actor input matches the
deterministic literals byte for byte with no override, which indicates the
deterministic branch, but that is inference. **This must be persisted.**

## B. Where did `B2B`, `United States`, `hiring`, `10–500` come from?

All four are **hardcoded literals**, at
[`leadCapabilityEngine.ts:1903-1913`](../supabase/functions/_shared/leadCapabilityEngine.ts):

```ts
const compiled = compileMemo23YcInput({
  queries: [],
  topCompany: false,
  nonprofit: false,
  batch: ["All Batches"],
  regions:    opts.ycRegions    ?? ["United States of America"],
  industries: opts.ycIndustries ?? ["B2B"],          // ← "B2B"
  isHiring: true,                                     // ← hiring
  minEmployeeSize: opts.ycMinSize ?? MEMO23_DEFAULT_MIN_SIZE,  // "10+"
  maxEmployeeSize: opts.ycMaxSize ?? MEMO23_DEFAULT_MAX_SIZE,  // "500"
  maxItems: maxCandidates,                            // 100
  ...sel.input,      // the strategy's choices — EMPTY on the deterministic path
  mode: "companies", scrapeOpenJobs: true,
  scrapeFounderDetails: false, enrichEmails: false,
});
```

`MEMO23_DEFAULT_MIN_SIZE = "10+"` and `MEMO23_DEFAULT_MAX_SIZE = "500"` at
[`leadCapabilityEngine.ts:182-183`](../supabase/functions/_shared/leadCapabilityEngine.ts)
— an exact match to the observed input, which confirms this is the code that ran
(and not `companyFirstRouteExecutor.ts:205`, whose default is `"1+"`).

`...sel.input` is where a GPT-chosen input would land. It contributed nothing.

**`B2B` did not come from your request, and did not come from your Company Brain
either — it is a literal default in the engine.** The Company Brain's influence is
one layer earlier and separate: the mission's
`company_profile.verticals` were `["b2b saas (founder-led or small teams)",
"recruiting / talent acquisition / staffing agencies"]` with
`field_provenance.company_profile.verticals = "company_brain"`.

The file's own header already indicts this, at lines 1780-1794:

> *"Was `step.providers`: a frozen pair … with the input written as a literal right
> here — `industries: ["B2B"]`, `batch: ["All Batches"]`. Every mission this workflow
> ever ran asked that same question, so 'AI startups hiring software engineers' and
> 'manufacturers adopting automation' both fetched the same YC page … A gate cannot
> qualify a company the pool never contained."*

## C. Why `queries: []`?

A literal on line 1904, never populated. The only path that could fill it is
`...sel.input`, which was empty.

**Consequence: the word "AI" never reached any provider.** `positive_keywords` was
`[]` in the mission too. The search that ran was *"YC companies, industry B2B, US,
hiring, 10–500 employees"* — a query with no relationship to what was asked.

## D. Why did LinkedIn Company Search run — repeatedly?

It is the `company_identity_resolution` stage, capability #2 of the six. It is **not
a discovery search**. It resolves each already-discovered company to a LinkedIn URL,
one call per company, `maxItems: 5` per call.

That is why there were many calls: one per candidate in the slice, not one search
returning many companies.

## E. Why `searchQuery: "idler"`?

**"Idler" is a company name** — one of the 100 YC companies from step 1, passed into
the identity resolver as the thing to look up.

[`hiringActorInputs.ts:335`](../supabase/functions/_shared/hiringActorInputs.ts) is
explicit:

```
// ── searchQuery MUST BE A COMPANY NAME ─────────────────────────────
```

and validates it as one, rejecting anything else with
`invalid_company_name_search_query`.

So, against the specific questions asked:

| question | answer |
|---|---|
| Generated by GPT? | **No.** |
| Extracted from a YC company? | **Yes** — the company's name field. |
| Deterministic fallback? | **Yes**, in the sense that the whole path was deterministic. |
| A company-name lookup? | **Yes. This is exactly what it is.** |

`"idler"` is not a malfunction. It is the identity stage working as designed on a
pool that should never have contained that company.

## F. Why `instawork`, `afterquery`, `furtherai`?

These are the companies whose identity resolution **succeeded** — name → LinkedIn URL
— and were therefore promoted to `company_enrichment` (capability #3), which takes
resolved URLs in a batch.

They were not selected on merit, relevance, or AI-ness. They are the ones the
resolver could find a LinkedIn page for, within the slice's budget.

## G–J. Which model ran at each stage

| Stage | Model actually used | Why |
|---|---|---|
| Mission understanding | **None — deterministic code** | `mission_parser_source: "deterministic_fallback"`, confidence 0.6; `GPT_LEAD_MISSION_COMPILER` unset |
| ICP extraction | **None — Company Brain row read directly** | `field_provenance = "company_brain"` |
| Actor selection | **None — deterministic map** | `deterministicDiscoveryStrategy`; GPT provenance not persisted, see A |
| Actor input generation | **None — hardcoded literals** | `leadCapabilityEngine.ts:1903-1913` |
| Discovery | deterministic (Apify) | correct — execution is not interpretation |
| Enrichment | deterministic (Apify) | correct |
| Qualification | **None — deterministic gate** | `GROUNDED_COMPANY_BRAIN`, `FULL_POOL_GROUNDED_EVALUATION`, `GPT_POOL_RANKING` all unset |

**No GPT call was made at any decision point in this run.**
**No Claude call was made either** — the sole `ai_provider_call` rows in
`activity_feed` are from Company Brain onboarding on 2026-08-16, not from this run.

Every interpretive decision was made by deterministic code.

## K. Which code caused the behaviour

| Behaviour | File / function |
|---|---|
| Mission built without a model | `leadIntelligencePolicy.ts:112-121` → mode `deterministic`; `leadMissionCompilerBinding.ts:139` `isMissionCompilerEnabled` → `flag_off` |
| Company Brain replaced the target | mission `field_provenance.company_profile.verticals = "company_brain"` |
| YC chosen first | `leadCapabilityEngine.ts:1094` `resolveDiscoveryStrategy` → `deterministicDiscoveryStrategy` |
| `B2B` / US / hiring / 10–500 / `queries: []` | `leadCapabilityEngine.ts:1903-1913` literals |
| `searchQuery: "idler"` | `company_identity_resolution` stage; `hiringActorInputs.ts:335` |
| 3 LinkedIn detail companies | `company_enrichment` over successfully-resolved URLs |
| Stop at 30/110 | `leadContinuationDispatch.ts:215` — HTTP 500, **body discarded** |

---

## Why 0 qualified — the causal chain

```
"AI startups"  →  mission compiler OFF  →  deterministic fallback
                                              │
                        "AI" dropped ─────────┤
                                              │
              Company Brain verticals ────────┘
                        (B2B SaaS, recruiting agencies)
                                              │
                                              ▼
                        discovery literals: industries=["B2B"], queries=[]
                                              │
                                              ▼
                        pool = YC ∩ B2B ∩ US ∩ hiring ∩ 10–500
                                              │
                                              ▼
                        qualification vs a B2B-SaaS/recruiting ICP
                                              │
                                              ▼
                                      0 of 30 qualified
```

Two independent sufficient causes: the pool never contained AI companies, and the
gate was measuring a target you did not ask for. A third — the HTTP 500 — stopped
it at 30 of 110 before the frontier was exhausted.

---

## CURRENT — what actually executed

```
┌───────────────────────────────────────┐
│ USER REQUEST                          │
│ "Find 10 qualified AI startups in the │
│  US currently hiring software eng."   │
└───────────────────┬───────────────────┘
                    │
                    ▼
┌───────────────────────────────────────┐
│ MISSION INTERPRETER                   │
│ mission_parser_source =               │
│        deterministic_fallback         │
│ confidence 0.6                        │
│ GPT_LEAD_MISSION_COMPILER = unset     │
│                                       │
│ ❌ "AI" DROPPED — positive_keywords=[]│
│ ❌ verticals ← company_brain          │
└───────────────────┬───────────────────┘
                    │
                    ▼
┌───────────────────────────────────────┐
│ DISCOVERY STRATEGY                    │
│ deterministicDiscoveryStrategy        │
│ startup_company_discovery → YC        │
│ ❌ provenance NOT persisted           │
└───────────────────┬───────────────────┘
                    │
                    ▼
┌───────────────────────────────────────┐
│ YC COMPANY SCRAPER (memo23)           │
│ hardcoded literals, engine:1903       │
│                                       │
│ queries    = []          ❌           │
│ industries = ["B2B"]     ❌           │
│ regions    = US                       │
│ isHiring   = true                     │
│ 10+ … 500 employees                   │
│ maxItems   = 100                      │
└───────────────────┬───────────────────┘
                    │
                    ▼
              100 YC companies
                    │
                    ▼
┌───────────────────────────────────────┐
│ LINKEDIN COMPANY SEARCH               │
│ = company_identity_resolution         │
│ ONE CALL PER COMPANY NAME             │
│                                       │
│ searchQuery = "idler"   ← a YC name   │
│ maxItems    = 5                       │
│ scraperMode = "full"                  │
└───────────────────┬───────────────────┘
                    │
                    ▼
        companies whose URL resolved
                    │
                    ▼
┌───────────────────────────────────────┐
│ LINKEDIN COMPANY DETAIL               │
│ = company_enrichment                  │
│                                       │
│ instawork · afterquery · furtherai    │
└───────────────────┬───────────────────┘
                    │
                    ▼
┌───────────────────────────────────────┐
│ QUALIFICATION (deterministic gate)    │
│ vs Company Brain ICP                  │
│ 30 investigated → 0 qualified         │
└───────────────────┬───────────────────┘
                    │
                    ▼
┌───────────────────────────────────────┐
│ CONTINUATION                          │
│ 80 frontier remaining                 │
│ ❌ refused HTTP 500 — body discarded  │
│ stopped_reason = dispatch_failed      │
└───────────────────────────────────────┘
```

## TARGET — GPT-first, one canonical path

```
USER REQUEST
      │
      ▼
GPT — MISSION UNDERSTANDING          ← the only interpreter
      │   count · industry · geography · size · hiring
      │   funding · tech · founder · role · exclusions
      │
      ▼
GPT — RECONCILE WITH COMPANY BRAIN   ← Brain informs, never replaces
      │   explicit user request wins; conflict is SURFACED
      │
      ▼
GPT — SIGNAL / SEARCH STRATEGY
      │
      ▼
GPT — ACTOR SELECTION                ← reads the actor registry
      │   filters · enums · limits · coverage · cost
      │   reliability · known defects · best_for / not_for
      │   RECORDS WHY each actor was chosen
      │
      ▼
GPT — ACTOR-SPECIFIC INPUT JSON      ← per actor, per schema
      │
      ▼
DETERMINISTIC VALIDATION             ← the veto, never the author
      │   actor exists · schema · filter supported · enum
      │   maxItems ≤ limit · cost ≤ budget
      │   REJECT → retry/fail loudly, never silently reinterpret
      │
      ▼
APIFY DISCOVERY  →  DEDUPE / NORMALIZE
      │
      ▼
ENRICHMENT
      │
      ▼
QUALIFICATION (user request + Company Brain)
      │
      ▼
COUNT CHECK ─ requested_count is the success condition
      │
      ├── qualified == requested        → COMPLETE
      │
      └── qualified <  requested
                │
                ├── frontier remains    → CONTINUE
                └── frontier exhausted  → HONEST SHORTFALL
```

The rule the target encodes: **GPT decides what should happen; deterministic code
guarantees that what GPT decided is safe and executable.** A validator rejection is
a loud failure, never a silent fall back to a second interpreter.
