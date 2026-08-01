# Final recommendation — Apify hiring Actor stack

**Date:** 2026-08-01 · **Total Apify spend: $0.4289 of the $5.00 ceiling** ·
23 live runs · No production code, deployment, migration or data touched.

---

## The headline

The proposed architecture is sound, but **not in the order the brief assumes**.
Two of the three ICP filters that route depends on proved unreliable in live
output, and the single company that survived the whole Route B funnel was a
**job-board aggregator that should never have passed the ICP filter**.

The fix is not a different Actor. It is **moving enrichment before
qualification** — see "Recommended architecture" below.

## 1. Answers to the eight benchmark questions

| # | Question | Answer |
|---|---|---|
| 1 | Primary YC Actor | **memo23/y-combinator-scraper** |
| 2 | Fallback YC Actor | **solidcode/ycombinator-scraper**, restricted to single-value `teamSize` |
| 3 | Can company-search build an ICP-filtered list? | **Partly — not trustworthy alone.** It builds a *list*; it does not build an *ICP-filtered* list |
| 4 | Can job-search verify hiring only within those companies? | **Yes — scoping is reliable.** Title precision is not |
| 5 | Founder Actor | **harvestapi/linkedin-company-employees** |
| 6 | Company enrichment Actor | **harvestapi/linkedin-company** — and it is *mandatory*, not optional |
| 7 | Schemas/costs/limits/risks | Captured live in `actor_inventory.json`, `schemas/`, `field_mapping_matrix.md` |
| 8 | Reject any Actor? | **None outright.** One conditional restriction, one hard prerequisite — below |

## 2. YC route (Route A) — memo23 wins, but the route fails this mission

memo23, 50 companies, US + B2B + hiring, $0.008:

| Metric | Result |
|---|---|
| Companies returned / unique | 50 / 50 — **0% duplicates** |
| US region · industry B2B · isHiring | 50 / 50 / 50 |
| With open jobs (102 jobs total) | 47 |
| With website / description | 50 / 50 |
| **With LinkedIn URL** | **0 — field absent from the schema** |
| teamSize within 1–150 | 47 (range observed 0–210 despite a `1+` floor) |
| **Jobs matching packs A/B/C (exact)** | **0** |
| **Jobs matching the ops discipline (loose)** | **0** |
| Cost per company | $0.00016 |
| Cost per *relevant hiring* company | **undefined — zero found** |

Of 102 open jobs: 50 engineering, 6 sales, 6 generic operations ("Head of
Operations", "Founding Ops"), 0 Sales/Revenue/GTM Ops.

**This is not an Actor defect.** YC startups at 1–150 employees do not hire
RevOps specialists; they hire engineers and front-line sellers. Route A is
excellent for *company discovery* and structurally unable to serve *this
mission's role packs*.

### solidcode — a silent-empty defect, isolated

The full mission returned **0 rows**. Five probes ($0.0005 total) isolated it:

| Probe | Filters | Rows |
|---|---|---|
| A | regions + isHiring | 10 |
| B | industries | 10 |
| C | industries + regions + isHiring | 10 |
| D | C + `teamSize:["11-50"]` | 10 |
| E | C + `status:["Active"]` | 10 |
| **F** | **C + `teamSize:["1","2-10","11-50","51-200"]`** | **0** |

`teamSize` is documented "Multi-select" but **ANDs** its values — a company
cannot hold four sizes at once, so any multi-value selection returns zero. It
fails as `"No companies matched your filters"`, which reads like a true negative.
That is the most dangerous failure mode a sourcing pipeline can have.

Fallback only, and **only ever one `teamSize` value per call**.

## 3. Route B — the funnel that collapsed to one bad company

**Step 1 — company-search (8 companies, full mode).** Two defects:

*`searchQuery` is a company-NAME keyword match, not a concept search.* Querying
`"B2B software platform"` returned exactly **1** company — one literally named
*"CBX® Cannabis B2B E-Commerce Marketplace Platform | Seed-To-Sale Software"*.
Concept queries must not be used here.

*`companySize` filters on the wrong field.* Requesting 11–200 returned:

| Company | `employeeCount` | `employeeCountRange` | In 11–200? |
|---|---|---|---|
| Swooped | 23 | 11–50 | yes |
| Trademo | 147 | 51–200 | yes |
| Triomics | 82 | 51–200 | yes |
| BigRio | 119 | 11–50 | yes (range wrong) |
| IgniteTech | 396 | 51–200 | **no** |
| TechCrunch | 587 | 51–200 | **no** |
| SketchUp | 786 | 51–200 | **no** |
| Cisco Networking Academy | 4642 | 51–200 | **no** |

**4/8 precision.** The filter matches `employeeCountRange`, which contradicts the
actual `employeeCount` by up to 23x. In `short` mode `employeeCount` is null —
so **the size filter is unverifiable in the cheap mode**.

Industry is no better: `industryIds:["4"]` (Software Development) returned
**TechCrunch** and **Entrepreneur Media**.

**Step 2 — job-search restricted to those 8 companies.** Scoping worked
perfectly: **zero cross-company leakage** across all three packs. Batch limit
verified at **`company` maxItems = 10**.

| Pack | Rows | Companies in results | Exact pack-title matches |
|---|---|---|---|
| A Sales Ops | 0 | — | 0 |
| B Revenue Ops | 8 | Swooped only | 0 |
| C GTM Ops | 8 | Swooped only | 1 ("Program Manager II: GTM Operations") |

**The aggregator problem.** Swooped was the only "hiring" company — and it is a
job board. Two of its postings describe completely different businesses (an
IT-services firm; an early-education company in "a $175B market"). Its job
descriptions are anonymised third-party listings. `linkedin-company` then
confirmed Swooped's real industry: **`104` Staffing and Recruiting — not `4`
Software Development**.

So company-search returned a staffing firm under a software-industry filter, and
that firm was the sole survivor of the entire funnel. Trusting this chain would
have produced founder outreach to a job board about roles it is not hiring for.

Duplicate rate within a pack: **25%** (8 rows, 6 unique titles).

Title precision is loose in both directions — the unrestricted control run for
"Sales Operations Manager" returned *Enterprise Account Manager (Aviation)* at
SpaceX and *Operation Manager Trainee*.

**vs. the historical country-wide-jobs-first approach:** company-restriction
still reduces paid rows by roughly 10–50x per role pack (24 capped rows against
thousands of country-wide postings). That gain is real. It just does not survive
a company list built on unverified industry and size.

## 4. Founder discovery — identical recall, different economics

Same 3 companies, same titles, Short mode:

| | company-employees | profile-search |
|---|---|---|
| Rows | 10 | 10 |
| **Overlap** | **10 / 10 identical people** | |
| Founder/CEO titles | 8/10 (7 true — one is "Seed Investor & Board of Directors") | same |
| Per-company cap | **`maxItemsPerCompany` ✅** | **none** |
| Company input limit | 1000 | 50 |
| Minimum run cost | $0.02 + $0.003/profile | **$0.10 flat** (`search-page`) |
| Cost, this run | ~$0.05 | ~$0.10+ |

Recall is *identical*, so the decision is economics and control:
**company-employees is primary** — it is ~2x cheaper at this scale and is the
only one that can bound results per company (the brief's "max five founders per
company" rule is unenforceable on profile-search).

Both return `currentPositions[]` with `companyName`, `companyLinkedinUrl`,
`current: true` and tenure — exactly the employer-verification evidence needed.
Both return opaque `ACwAAA…` member-id URLs, never vanity slugs: **dedupe on
`id`, not on URL**.

## 5. Company enrichment — promote to mandatory

`linkedin-company` supplied, on live output: name ✅, canonical LinkedIn URL ✅,
website ✅, **exact `employeeCount`** ✅, `employeeCountRange` ✅, **industry id +
full hierarchy** ✅, description ✅, HQ/locations ✅, `companyType` ✅.
`foundedOn` was **null on 2 of 3** — do not depend on it.

At **$0.004/company** it is the cheapest fix for the two defects that broke Route
B. It is what caught Swooped.

## 6. Weighted scorecard

Weights: ICP precision 25 · hiring precision 20 · evidence 15 · schema/output 15
· cost 10 · identity 10 · latency 5.

| Actor | ICP | Hiring | Evid | Schema | Cost | Ident | Lat | **Weighted** |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| harvestapi/linkedin-company | 7 | 0 | 9 | 9 | 9 | 10 | 8 | **7.3** |
| harvestapi/linkedin-company-employees | 6 | 0 | 8 | 8 | 8 | 7 | 9 | **6.3** |
| memo23/y-combinator-scraper | 9 | 2 | 6 | 6 | 10 | 3 | 8 | **6.1** |
| harvestapi/linkedin-job-search | 5 | 6 | 7 | 8 | 8 | 6 | 8 | **6.4** |
| harvestapi/linkedin-profile-search | 6 | 0 | 8 | 8 | 4 | 7 | 8 | **5.9** |
| harvestapi/linkedin-company-search | 3 | 0 | 5 | 7 | 7 | 8 | 9 | **5.2** |
| solidcode/ycombinator-scraper | 4 | 2 | 7 | 3 | 8 | 6 | 9 | **4.7** |

(Hiring-precision 0 = the Actor does not produce a hiring signal; it is
weight-neutral for enrichment/founder roles rather than a penalty.)

## 7. Recommended stack

| Role | Actor | Confidence |
|---|---|---|
| Primary YC discovery | **memo23/y-combinator-scraper** | medium — build changed on test day |
| Fallback YC discovery | **solidcode/ycombinator-scraper** (single `teamSize` only) | low |
| Primary general discovery | **harvestapi/linkedin-company-search** — candidate generator ONLY | medium |
| Hiring verification | **harvestapi/linkedin-job-search** (≤10 companies/batch) | high for scoping |
| Primary founder | **harvestapi/linkedin-company-employees** | high |
| Founder fallback | **harvestapi/linkedin-profile-search** | high |
| Company enrichment | **harvestapi/linkedin-company** — **mandatory gate** | high |

### Rejected / restricted

Nothing is rejected outright. Three binding conditions:

1. **company-search must not be an ICP gate.** Demoted to candidate generator.
   Every candidate passes through `linkedin-company` before qualification.
2. **solidcode multi-value `teamSize` is forbidden.** Fan out one call per size
   band, or use memo23.
3. **An aggregator/staffing screen is a prerequisite**, not a nicety. Without it
   Route B's only surviving lead was a job board.

## 8. Architecture recommended for Prompt 2

The brief's order qualifies companies on discovery-time evidence. That evidence
proved wrong. **Enrich first, then qualify:**

```
Company Brain / ICP
  → discover        memo23 (YC) | company-search (general, candidates only)
  → ENRICH          linkedin-company on every candidate      [$0.004 each]
  → QUALIFY         Brain gate on ENRICHED industry id + exact employeeCount
                    + aggregator/staffing screen (industry 104, ATS-less reposts,
                      multiple unrelated employers in descriptions)
  → verify hiring   job-search, ≤10 qualified companies/batch, packs run separately
                    + deterministic title post-filter (fuzzy input, exact output)
  → find founders   company-employees, maxItemsPerCompany=5, Short mode
  → verify employer currentPositions[].companyLinkedinUrl == company URL, current=true
  → contact         (out of scope — no email/phone enrichment run here)
```

Moving one $0.004 call earlier is what separates a funnel that yields a job
board from one that yields real companies.

## 9. Known schema/documentation conflicts

1. **`employeeCountRange` contradicts `employeeCount`** (up to 23x) and is what
   `companySize` filters on — company-search and linkedin-company alike.
2. **solidcode `teamSize`** documented multi-select, behaves as AND → silent zero.
3. **`profileScraperMode` enum values differ between sibling Actors** —
   company-employees needs `"Short ($4 per 1k)"` (price inside the value);
   profile-search needs `"Short"`. Copying one into the other fails.
4. **`maxItems` semantics differ per Actor** — job-search: per title *per
   location* (a cost multiplier); memo23: per URL / per filter run; others: global.
5. **`postedLimit` is an enum** `1h|24h|week|month`, never numeric days.
6. **Per-run `usageTotalUsd` under-reports.** The ledger totalled $0.0334 while
   the account showed **$0.4289** — ~13x. Bill from account-level usage, never
   from the run object.
7. `industry` (string) is short-mode; `industries` (array of objects) is
   full-mode. Same Actor, different shape by mode.

## 10. Remaining uncertainties

- **Two builds changed on the test date** (memo23 0.0.21, company-employees
  0.0.144, profile-search 0.0.249). Re-verify before registering.
- Route A's zero ops-roles result is one mission on one day; it is strong evidence
  about YC-at-this-size, not proof for all missions.
- Only 3 companies went through founder/enrichment. Enough to compare Actors,
  not to publish precision rates.
- `takePages`/`startPage` pagination beyond page 1 was never exercised.
- The aggregator screen is *specified* here, not built or validated.
- Whether `full` mode's industry data equals `linkedin-company`'s was not
  isolated (full-mode `industry` was null; `industries` populated).
