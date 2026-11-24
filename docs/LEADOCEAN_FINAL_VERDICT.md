# LeadOcean — final provider verdict (2026-10-31)

**Verdict: CONDITIONAL GO.** Use LeadOcean as a cheap, large **candidate source**
and **phone lookup** inside the Apify-gated pipeline. Do not let any LeadOcean field
qualify a lead: headquarters, size, funding, technology and revenue are claims that
the Apify company record and the shared engine must decide. Evaluation is closed;
live provider tests are now off by default (`AGENTORY_PROVIDER_LIVE_TESTS`).

Evidence: Tests L (13 records), V (2), E (10 + Apify $0.069), phone test P1 (5),
the 12-scenario free evaluation (0 records), and the final benchmark (15 records +
Apify $0.05205). Plan: `LEADOCEAN_FINAL_BENCHMARK_PLAN.md`. Raw redacted rows,
ledger and evaluation are kept 0600 outside the repository.

## 1. The 12 scenarios

Free counts (US HQ; default = people with a deliverable email; see the plan for exact filters):

| # | scenario | audience | sampled | what the sample showed |
|---|---|---|---|---|
| 1 | SaaS founders 11–50 | 4,052 people / 2,187 cos | Test E (similar) | 7 of 10 eligible after Apify; 2 non-US HQ, 1 over size |
| 2 | SaaS founders 51–200 | 4,917 / 951 (5.2 per co) | 2 | both companies **non-US HQ** (NZ, FR); people abroad |
| 3 | agency owners 11–50 | 18,893 / 8,148 | via 6 | — |
| 4 | lead-gen agency founders 51–200 | 3,427 / 198 (17.3 per co) | 2 | both rows the **same IT-services company**, not a lead-gen agency; Apify size band contradicts; one "iOS Developer Co-founder" |
| 5 | SaaS CEOs with phone | 31,268 / 15,428 | P1 (founders) | 78% of reachable CEOs carry the phone flag |
| 6 | agency founders with phone | 81,352 / 28,115 | 2 | 1 Dutch agency (non-US HQ), 1 US 8-person agency (ICP fit) |
| 7 | funded since 2025 | 2,586 / 606 cos | 2 companies | both **public companies** whose 2025 "round" is Post-IPO equity / debt; one headcount 85 vs a far larger Apify band |
| 8 | SaaS founders Seed / Series A | 7,303 / 2,250 | 2 companies | filter correct but **stale** (Seed 2016, Series A 2021); founded year matches Apify |
| 9 | CRM technology users | 169,753 / 36,605 (names); category "CRM" 56 cos | 2 companies | rows list 3 CRMs at once (Salesforce + HubSpot + Pipedrive / Dynamics); homepage confirmed HubSpot on 1 of 1 reachable; 1 company (TIBCO) headcount 35 vs a far larger Apify band |
| 10 | SaaS founded 2024–26 | 3,368 / 2,522 | 2 | 2 and 4 employees (outside ICP size); founded year not in people rows and not on the Apify record — unverified |
| 11 | agencies by revenue | people: **unsupported**; 10,759 cos ($1–25M of 60,606) | — | revenue held for ~18%; company-only filter |
| 12 | known domain (langchain.com) | 17 people | 1 | identity correct; the "founder / C-suite" match was an **Investor** |

## 2. Filters that work reliably

- `domain` (identity of the employer), `industry` labels (as stated), `employeeRange` /
  `min/maxEmployees` against LeadOcean's own headcount, `hasPhone` (P1: 5 of 5 flagged
  people returned a number), `excludeIds`, `excludeTitle`, `fundingType` (matches the
  stated last round). The founded year on company rows matched the Apify record 4 of 4
  (the `minFounded` filter itself was not confirmed — see scenario 10).
- Free `count_leads` / `count_companies` (0 records, confirmed by `/v1/usage`).

## 3. Filters that mislead or are incomplete

| filter | problem | evidence |
|---|---|---|
| `hqCountry` (people search) | employer HQ claim; wrong for ~29% of companies | Apify: 5 non-US of 17 companies (Test E 2/10, benchmark 3/7) |
| — person location | not implied by `hqCountry` | 8 of 9 benchmark people outside the US |
| headcount / size | understated for larger companies | LangChain 145 vs 469; MicroStrategy 85, TIBCO 35, an IT firm — all contradicted by Apify bands |
| `seniority` founder / owner / c_suite | over-matches (Investor, developer co-founders, deputies) | 5.2 and 17.3 matches per company at 51–200 |
| `companyKeywords` | loose ("lead generation" → IT services) | scenario 4 |
| `minLastFundingYear` | includes public-company securities, and holds data for ~21% of companies | scenario 7; coverage count |
| `technologies` | multi-CRM lists suggest inferred / aggregated detection; category "CRM" nearly empty | scenario 9 |
| revenue | company search only; ~18% coverage | scenario 11 |
| phone numbers | unverified; `dnc` unpopulated; 3 of 5 founder numbers non-US (+9x) | P1 |

## 4. Recommended Agentory ICP queries (now the code defaults)

ICP A (`leadPipeline/icp.ts`): `hqCountry US` + `country US` (person) + 11–200 +
industry [Software Development, Technology; Information and Internet, IT Services and
IT Consulting] + ICP titles + seniority [owner, founder, c_suite, vp, head] +
`excludeTitle` [Investor, Advisor, Board Member, Intern, Developer, Assistant] +
`hasPhone` for phone-first walks → **51,008 people / 26,344 companies** (free count).
ICP B: same pattern with agency industries and owner/founder/partner. Keep
funding / technology / founded filters out of the default; use them only as narrowing
experiments, never as gates.

## 5. Discovery versus enrichment

- **Discovery:** yes — people search narrowed as above, 1 record per row, with
  `excludeIds` from the walk checkpoint. Every row then needs the Apify company record.
- **Enrichment:** phone lookups via `POST /v1/people/phone` (1 record, found or not),
  only for eligible, unblocked, US-located decision-makers, after the free auth probe.
  Email enrichment was not evaluated.
- **Not:** qualification, HQ, size, funding recency, technology or revenue truth.

## 6. Compared with the Apify pipeline

| | LeadOcean | Apify (existing engine) |
|---|---|---|
| finding people at companies | strong: filters by role, size, industry, phone flag; huge audience | weak (no general people search in use) |
| proving HQ / size | no | yes — the authority (`apify_linkedin_company_details`) |
| signals | funding claim only | posts, jobs (dated) |
| phones | yes (unverified) | no |
| cost | Free plan: records (970 → 955 lifetime); paid price not evaluated | ~$0.004 / company record, ~$0.012 / company for signals |

The combination is the design: LeadOcean proposes, Apify proves, the shared engine decides.

## 7. Records consumed and remaining

| test | LeadOcean records | Apify USD |
|---|---|---|
| L | 13 | — |
| V | 2 | — |
| E | 10 | 0.069 |
| P1 (phones) | 5 | 0 |
| final benchmark | 15 | 0.05205 |
| **total** | **45** | **≈0.121** |

LeadOcean: **45 used, 955 remaining** of a lifetime 1,000 (Free plan, refused past the
ceiling). Apify: Starter plan, $19 / month.

## 8. Cost per qualified prospect and phone candidate (small samples, wide error)

- Eligible prospect (Test E, ICP A): 10 records → 7 eligible = **1.43 records + ~$0.010 Apify** each.
- Person-associated number: 5 lookups → 5 numbers (100% of flagged people), but only
  2 US (+1). Per **US** number: 2.5 lookups + 2.5 × (1.43 records + $0.010) ≈ **6.1
  records + $0.025**. The `country: US` filter should raise the US share; unmeasured.
- Independently verified direct number: **not obtainable** (no verifier in the stack).
- Final benchmark: 15 records → 7 rows passing every check (2.1 records each); only
  1 of 9 people rows was an ICP-fit decision-maker, because the benchmark deliberately
  probed weak filters.

## 9. Known limitations and open uncertainties

- Samples are small (19 companies, 14 people + 5 lookups); rates are indicative only.
- Paid-plan price per record not evaluated (Free plan only).
- Phone numbers are unverified; `dnc` is unpopulated; no carrier / HLR verification.
- Founded year (scenario 10) could not be confirmed: neither the people row nor the
  Apify record carried it for those companies.
- Email enrichment and deliverability were not tested.
- The REST network secret covers `/v1/*` only; v2 endpoints need it widened.
- Test E did not load Agentory's live history (TEST project checked: no holds).

## 10. Verdict

**CONDITIONAL GO** for LeadOcean as the people-discovery and phone-lookup source,
conditional on: (1) every lead's HQ and size coming from the Apify company record
(already enforced), (2) the recommended ICP query (person country, title exclusions),
(3) phone numbers treated as unverified and international numbers flagged, (4) no
funding / technology / revenue filter used as a gate. **NO-GO** as a qualification
source. No further exploratory LeadOcean tests are planned.
