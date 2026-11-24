# LeadOcean after Test L: root causes, fixes, and the proposed validation test

Test L ran on 2026-10-31 and used 13 records. The ledger, LeadOcean's own counter and the wire log
all agree. Its parsed output was poor because of **our parser**, not LeadOcean's data. Everything
below was done offline, with free metadata reads only. No record has been bought since Test L.

## Root causes (confirmed)

| # | Symptom in Test L | Root cause | Evidence |
|---|---|---|---|
| 1 | Every job title empty | Read `contact_current_experiences[0].title`; the key is **`job_title`** | LeadOcean's published enrich and curl examples |
| 2 | Headline could pass for a title | `profile_headline` was a last-resort title fallback | Design defect |
| 3 | Person LinkedIn empty | Read `profile_linkedin_url`; the key is **`profile_url`** | Published examples |
| 4 | Freshness: no stamps | Read `meta.updated_at`; LeadOcean publishes **`meta.fetched_at`** | Published examples |
| 5 | Industry `54` / `51` | The industry list fell back to `company_data.naics_sector` | Code; `naics_sector` documented in spec |
| 6 | Employer industry and size empty on people rows | They were read from `company_data`, which people rows don't carry. The employer lives in `contact_current_experiences[0]` | Spec `Person` schema; catalogue |
| 7 | HQ and size missing on all 10 discovery rows | **Not a parser bug.** A thin people-search row has no employer HQ or headcount (export catalogue: `search: false`). Those requirements rest only on LeadOcean's filter | `GET /v1/exports/columns` |
| 8 | Discovery page looked arbitrary | `order=stable` (id order, unscored) was sent. `ranked` (best matches) is LeadOcean's default for relevance | Spec and MCP tool docs |
| 9 | Baseten and Oscilar scored "wrong" | Scorer bug: no comparable identifier was treated as a mismatch. Also, the cohort lacked their domains, which Agentory's own evidence held | Code; TEST task 25906701 |
| 10 | Nothing could be re-parsed | Raw rows weren't kept | Code |

## Fixes (commits `0f3ff749`, `9160b6b6`, `7ebf2788` and the cohort update)

- **`FIELDS` rewritten.** Every path is labelled `documented`, `catalogue` or `inferred` in
  `FIELD_BASIS`, with no guessed alias lists. A field none of the paths finds stays absent.
- **Two separate parsers.** Company records (`company_data`) and the employer of a person
  (`contact_current_experiences[0]`) are parsed separately.
- **NAICS kept apart.** NAICS sector and primary code are their own fields, claims and evidence
  fact, and are never an industry.
- **Headline is its own field** and is never read as a title. `profile_url` is the LinkedIn URL,
  and `meta.fetched_at` is the freshness stamp.
- **Ordering.** `ranked` for a single-page step; `stable` only when a step walks several pages,
  where it keeps the cursor consistent.
- **Replayable raw pages.** Every paid page keeps a redacted raw copy for replay: no contact values,
  no picture blocks, no key hash. It's re-parsed by the same normalizer, without buying anything
  again. Reports holding it stay in the session, never in the repository.
- **Scorer: four identity outcomes.**
  - match: a shared identifier agrees;
  - mismatch: a shared identifier disagrees;
  - conflicting: one agrees and another contradicts;
  - unconfirmed: no comparable identifier. Name agreement is reported beside it.
- **Cohort.** A02 and A03 gained domains from Agentory's own canary evidence.

## Regression tests

All 138 tests pass, and the shared engine and compiler pass 28/28.

**New tests (11):**
- `job_title`
- headline never a title
- `profile_url` and `fetched_at`
- the employer block
- NAICS never industry
- unknown HQ key stays absent
- role check on real titles
- redacted replay round-trip
- filters sent in relevance order
- `unsupportedFilters` honoured
- the four identity outcomes

**Fixtures.** Sanitized fixtures are in `tests/edge-functions/_shared/discoveryProviders/fixtures/leadocean/`.
Each carries a provenance header and synthetic values.

## Filters: sent and enforced

- **Sent.** The discovery page sends:
  - `title` `["VP of Sales"]`
  - `hqCountry` `["US"]`
  - `minEmployees` 51 and `maxEmployees` 200
  - `limit` 10
  - `order` `ranked`

  Test F1 pins this.
- **Reported applied.** In Test L, LeadOcean reported all 20 HQ and size checks as applied: none
  appeared in `unsupportedFilters`. A filter it does name there is treated as not applied (test F2).
- **Enforced? Unknowable from the rows.** A thin people row can't show the employer's HQ or size, so
  enforcement can't be checked from what comes back. It stays a provider claim until a company
  record or Agentory's own evidence confirms it.
- **Default mailability filter.** By default, LeadOcean people search returns only people whose best
  email is `verified` or `catch_all` (MCP tool docs). That narrows the population. It never widens
  it, but it biases a discovery benchmark toward mailable people.

## Can Test L's saved data be reprocessed?

**Partly.**

- **Recovered from the saved report:** identity (record ids, names, domains). Re-scored offline with
  the fixed scorer and cohort, the result is **3 of 3 known companies confirmed by exact domain**,
  0 wrong and 0 unconfirmed.
- **Not recoverable:** the missed fields (titles, person LinkedIn URLs, employer industries,
  `fetched_at`). The raw rows were never stored, so these would have to be bought again. That's
  why every paid page now keeps a redacted raw copy.

## The three known companies against Agentory's evidence

Agentory's evidence comes from TEST task 25906701 (the canary run, 2026-10-30). LeadOcean's values
come from its free counts (2026-10-30) and Test L.

| Company | Agrees | Disagrees |
|---|---|---|
| LangChain | Domain `langchain.com`; industry "Technology; Information and Internet" (matches the company record) | **Size**: LeadOcean says 51–200, while Agentory's company record counted **469**. LeadOcean holds no HQ, and Agentory's record lists five offices with no single HQ |
| Baseten | Domain `baseten.co`; industry Software Development; HQ in US, California (Agentory: San Francisco, CA) | **Size**: LeadOcean 51–200, while the LinkedIn-declared band is 201–500 (plausible) |
| Oscilar | Domain `oscilar.com`; HQ in US, California (Agentory: Palo Alto, CA) | **Industry**: LeadOcean says Technology; Information and Internet, while Agentory says Software Development. Size can't be compared: 223 LinkedIn members is not a staff count |

**Reading.** LeadOcean is strong on identity and plausible on HQ. It appears to **understate size**
for fast-growing companies: two of the three sit in its 51–200 band against larger Agentory
figures. That fits record staleness and should be measured further. None of this changes
qualification: provider size and HQ stay plausible, never proof.

## Remaining uncertainty

- **Company-record keys not yet seen:**
  - the headquarters key (the MCP tool docs say only "headquarters address");
  - the `company_employees` size-code key;
  - the company LinkedIn URL;
  - `meta.source_ids.company_id`;
  - the funding fields.
- **Person-row keys not yet seen:** location (city, state, country code),
  `contact_current_experiences[].company_industry` (catalogue column `current_company_industry`, key
  inferred) and the seniority or job level of the current role.
- **Whether `job_title` is present on every thin row.** The catalogue marks it `search: true`.

## Proposed validation test V: 2 records maximum (NOT approved, NOT run)

| Step | Request | Purpose | Records, worst case |
|---|---|---|---|
| V1 | `GET /v1/companies/enrich?domain=langchain.com` (one company, `slim` off) | Every `company_data` key: HQ, `company_employees`, industry, LinkedIn, funding, `company_id` | **1** (an enrich counts 1 whether found or not) |
| V2 | `POST /v1/search` with `domain: ["baseten.co"]`, `limit: 1`, `order: "ranked"`, `slim: false`, no `reveal_email` | Every thin people-row key exactly as discovery receives it: location, current-role block, `fetched_at` | **1** |
| **Total** | | | **≤ 2 records** |

**Cost.**
- **Money: $0.** It's the Free plan, with 987 of 1,000 lifetime records left; past the limit
  LeadOcean refuses rather than bills.
- **After V, 985 records would remain.**

**Guards.** The same wire guard as Test L:
- only these two requests are allowed;
- the total `limit` is capped at 2, and the enrich counts as 1;
- no repeat of a paid request is sent;
- no `reveal_email`, no enrichment of a person, no export.

V1 would need the guard extended to allow `GET /v1/companies/enrich`, with a regression test, before
anything runs.

**Output.**
- The redacted raw rows are kept and checked key by key against `FIELD_BASIS`. Every `inferred`
  path is then confirmed or corrected in one edit, and the sanitized fixtures are replaced with
  shapes taken from the real rows.
- V1 also gives a fourth size data point for LangChain, against Agentory's 469.

**Stop conditions.** Any status other than 200 (including 401, 402 or 429) or an uncertain charge
stops V, and nothing is retried. Reconciliation: `records.used` must rise by exactly the
reported credits, and by no more than 2.

---

## Validation test V: results (run 2026-10-31, commit `0cb848ba`)

**What ran.**
- **Approved:** 2 records, $0.
- **Requests:** exactly V1 (`GET /v1/companies/enrich?domain=langchain.com`) and V2 (`POST /v1/search`
  at `baseten.co`, `limit` 1, ranked, `slim` off). Both returned 200 with one row each. Nothing was
  retried or refused.
- **Reconciliation:** passed. The account went from 13 used to **15** (985 remaining), matching the
  2 credits LeadOcean reported.
- **Counter lag (new finding):** the first read after the run still showed 14; the counter catches
  up seconds later. The runner and V script now re-read the free usage counter before reporting a
  mismatch, and never re-send a paid request.
- **Scrubbing:** the stored report's per-row `meta.key_hash` (a 16-hex key identifier) was removed,
  and the redactor now strips it at every depth.

**Field paths, now `observed` in `FIELD_BASIS`.**

| Field | Path | Was |
|---|---|---|
| HQ (company) | `company_data.company_primary_address.{country_code, state, city}` | unknown |
| Industry (company) | `company_data.company_industries[].name3` (array; `name2` is a slug) | `company_industry`: wrong |
| Size (company) | `company_data.company_employees.{number_of_employees, _min, _max, _code}` | inferred: right object, band added |
| Company LinkedIn | `company_data.company_social_links.linkedin.url` | `company_linkedin_url`: wrong |
| Funding | `company_data.company_funding.{last_round_type, last_round_date, last_round_year, total_raised_usd, lead_investors}` | guessed keys: wrong |
| Founded | `company_data.company_profile.date_founded` | wrong |
| Company id | `company_data.company_id` (and `meta.source_ids.company_id`) | inferred |
| Person location | `profile_data.profile_address.country_code` | wrong |
| Employer (people row) | `contact_current_experiences[0].{company_name, company_domain, company_industry, company_employees.*, company_social_links.linkedin.url, current, job_title, job_seniority.job_level}`, with `meta.source_ids.company_id` | headcount wrongly assumed absent |

**Corrections to my earlier conclusions.**
1. **`meta.fetched_at` is the serve time, not freshness.** LangChain's value was the second of the
   request. LeadOcean publishes **no data-update stamp**, so freshness can't be measured and is no
   longer read from it.
2. **People rows do carry the employer's headcount** when `slim` is off. Test L sent `slim: true`
   and may have lost it, so `slim` is now off on every search. People rows still **never** carry the
   employer's HQ.
3. **Ids are stable.** The employer's `company_id` in V2 (13404724) equals Test L's Baseten company
   record id, so people rows and company records join exactly.

**Offline replay.** Re-parsing V's redacted raw rows with the corrected mapping gives:

- **LangChain:**
  - industry "Technology; Information and Internet";
  - NAICS 54 / 541511;
  - 145 employees (band 51–200);
  - HQ not held;
  - Series A, 2024-02-15, $35M total, lead investor Sequoia Capital;
  - LinkedIn page found.
- **Baseten (the employer in V2):**
  - Software Development;
  - 137 employees (51–200);
  - LinkedIn page found;
  - no HQ in a people row.

The person's title, current flag, level ("Staff") and country (GB) parse; no name is reported.

**Against Agentory's evidence.**
- LangChain's 145 is about a third of the company record's 469.
- Baseten's 137 sits below the LinkedIn-declared band of 201–500.

That's two of two companies where LeadOcean is **materially lower** than Agentory's sources. Its
headcounts should be treated as possibly stale until compared at scale. The funding event is dated,
so it reaches the shared engine as a plausible, dated claim and never as proof.

Tests: 144/144, including the observed-shape fixtures, M6 (HQ path), M8 (dated funding), LO6
(`slim` off) and the lag-tolerant reconciliation test.
