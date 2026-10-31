# LeadOcean final capability benchmark — free evaluation and proposed paid run

Date 2026-10-31. Phase 2 used only free calls (`list_filters`, `count_leads`,
`count_companies`); no record was retrieved. Account: Free plan, lifetime 1,000
records, **25 used / 975 remaining**. Phone test P1 (≤5 records) is proposed
separately and has **not** run.

Counts: `total` = LeadOcean's default (people whose best email is verified /
catch-all), `all` = same filters without the email condition, `cos` = distinct
employers. All scenarios use headquarters country (`hqCountry: US`).
`unsupportedFilters` was empty for every query below.

| # | scenario | exact filters | people total / all | cos | people per company |
|---|---|---|---|---|---|
| 1 | SaaS founders, 11–50 | employeeRange 11-50, industry [Software Development, Technology; Information and Internet], companyKeywords [saas, b2b], seniority [founder] | 4,052 / 8,583 | 2,187 | 1.9 |
| 2 | SaaS founders, 51–200 | as 1, employeeRange 51-200 | 4,917 / 8,399 | 951 | **5.2** |
| 3 | marketing-agency owners, 11–50 | employeeRange 11-50, industry [Marketing Services, Advertising Services, Marketing and Advertising], seniority [owner, founder] | 18,893 / 60,164 | 8,148 | 2.3 |
| 4 | lead-gen agency founders, 51–200 | employeeRange 51-200, companyKeywords [lead generation, appointment setting, outbound sales], seniority [owner, founder] | 3,427 / 5,035 | 198 | **17.3** |
| 5 | SaaS CEOs with a phone | 11–200, SaaS industries, title [CEO, Chief Executive Officer], hasPhone | 31,268 (39,910 any contact) | 15,428 | 2.0 |
| 6 | agency founders with a phone | 5–200, agency industries, seniority [owner, founder], hasPhone | 81,352 | 28,115 | 2.9 |
| 7 | funded since 2025 | 11–200, minLastFundingYear 2025, seniority [owner, founder, c_suite] | 2,586 / 7,388 | 606 | 4.3 |
| 8 | SaaS founders, Seed / Series A | 11–200, SaaS industries, fundingType [Seed, Series A], seniority [founder] | 7,303 / 10,835 | 2,250 | 3.2 |
| 9 | sales / CRM technology users | 11–200, technologies [HubSpot, Salesforce], seniority [owner, founder, c_suite] | 169,753 / 575,882 | 36,605 | 4.6 |
| 10 | SaaS founded 2024–2026 | 2–200, SaaS industries, minFounded 2024, maxFounded 2026, seniority [founder] | 3,368 / 9,053 | 2,522 | 1.3 |
| 11 | agencies by revenue | **people search has no revenue filter**; companies: 5–200, agency industries, revenue $1M–$25M | — | 10,759 companies | — |
| 12 | known domain | domain [langchain.com], seniority [owner, founder, c_suite, vp, head] | 17 (any contact) | 1 | — |

Coverage (companies, US, 11–200, SaaS industries = 39,416):

| field / filter | companies holding it | share |
|---|---|---|
| founded year | 31,461 | 80% |
| funding year (any) | 8,316 | 21% |
| funded since 2025 (all industries, 11–200) | 823 | — |
| HubSpot or Salesforce detected | 9,868 | 25% |
| technology category "CRM" | 56 | **0.1%** |
| agencies 5–200 with revenue $1–25M | 10,759 of 60,606 | 18% |

What the counts already show (to be confirmed or refuted by the sample):

- **Seniority "founder/owner" over-matches as companies grow**: 1.3–1.9 matches per
  company at the small end, 5.2 at 51–200 SaaS and 17.3 at 51–200 lead-gen
  agencies. Real companies of that size rarely have five or seventeen founders.
- "CEO" as a title keyword matches ~2 people per company (likely "Office of the
  CEO", "Assistant to the CEO", former roles).
- Technology **category** CRM is effectively empty; technology **names** cover 25%.
- Funding and revenue filters apply only to the ~20% of companies holding a value
  ("one with no figure on file is never returned"): useful to narrow, unusable to exclude.
- About 78% of reachable SaaS CEOs carry the phone flag (31,268 / 39,910).

Most promising for Agentory: 1 (SaaS founders 11–50), 10 (recently founded), 3 and 6
(agency owners), 5/6 with `hasPhone` for phone-first work. Least: 4 and 2 (founder
over-match), 9 by category, 11 for people.

## Proposed paid benchmark (not run)

`scripts/leadocean-final-benchmark.ts` — plan hash **`ca41806cbeb0ce11`**, 8 requests, ≤15 records.

| id | kind | scenario | limit | why this sample |
|---|---|---|---|---|
| P-S2 | people | SaaS founders 51–200 | 2 | is the 5.2/company over-match real? |
| P-S4 | people | lead-gen founders 51–200 | 2 | is the 17.3/company over-match real? |
| P-S6 | people | agency owners with phone | 2 | ICP B core; phone flag |
| P-S10 | people | SaaS founded 2024–26 | 2 | founded-year accuracy vs Apify |
| P-S12 | people | langchain.com founders / C-suite | 1 | identity accuracy on a known company |
| C-S8 | companies | SaaS Seed / Series A | 2 | funding fields on the row |
| C-S7 | companies | funded since 2025 | 2 | funding recency on the row |
| C-S9 | companies | SaaS using HubSpot / Salesforce | 2 | technology claim vs the company's homepage |

Approval strings (choose one):

- `leadocean=15,apify_usd=0,plan=ca41806cbeb0ce11` — LeadOcean only; HQ and size are
  checked only where LeadOcean's own row states them (not independent).
- `leadocean=15,apify_usd=0.07,plan=ca41806cbeb0ce11` — plus `--independent`: one Apify
  `harvestapi/linkedin-company` run for ≤15 companies (worst case $0.06005) for HQ, size
  band and founded year, and free homepage fetches for the C-S9 technology claim.

Guards: exact approval match; free account preflight (≥15 left); durable append-only
ledger (`/root/agentory-tests/leadocean-final/ledger.jsonl`, 0600) — each request is
reserved under `planHash:scenario` before sending and a key already present in any
state is never re-sent; one raw request per scenario, no retries (429/5xx/timeout
recorded as failed); 400 ms spacing for the 5 req/s limit; people searches exclude the 7
Test E person ids the preserved report holds; redacted rows and evaluation written 0600
outside the repo; no DB writes; no outreach. Phone yield is measured by P1, not here;
independently verified direct-phone yield is 0 by construction (no verifier exists).
