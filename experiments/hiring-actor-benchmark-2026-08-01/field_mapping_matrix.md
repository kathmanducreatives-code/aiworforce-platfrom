# Field-mapping matrix — Actor output → Agentory canonical contracts

All rows below were observed in LIVE output on 2026-08-01. Fields not observed
are marked UNAVAILABLE rather than assumed. Nothing here is inferred from docs.

Legend — **D** direct · **A** alias · **T** transform · **U** unavailable ·
**S** needs semantic interpretation · **!** unsafe to trust without verification

## Company contract

| Canonical field | memo23 YC | solidcode YC | li-company-search (full) | li-company | Notes |
|---|---|---|---|---|---|
| external_source_id | `id` **D** | `companyId` **D** | `id` **D** | `id` **D** | YC ids and LinkedIn ids are different namespaces — prefix them |
| company_name | `name` **D** | `name` **D** | `name` **D** | `name` **D** | |
| canonical_domain | `website` **T** | `website` **T** | `website` **T** | `website` **T** | strip scheme/path |
| linkedin_company_url | **U** | `linkedin` **A !** | `linkedinUrl` **D** | `linkedinUrl` **D** | memo23 has NO LinkedIn field at all; solidcode's was null on every observed row |
| website | `website` **D** | `website` **D** | `website` **D** | `website` **D** | |
| description | `longDescription`/`oneLiner` **A** | `longDescription`/`shortDescription` **A** | `description` **D** | `description` **D** | |
| provider_industry | `industry` **S !** | `industry` **S !** | `industries[].name` **A !** | `industries[].name` + `hierarchy` **A !** | YC "B2B" is a YC vertical, not an industry; LinkedIn label proved wrong (see Swooped) |
| employee_count | `teamSize` **!** | `teamSize` **!** | `employeeCount` **D** | `employeeCount` **D** | YC teamSize is self-reported and stale (ShipBob = 1) |
| employee_range | **U** | **U** | `employeeCountRange` **!** | `employeeCountRange` **!** | contradicts `employeeCount` — see conflicts |
| geography | `allLocations`/`regions` **A** | `location`/`country` **A** | `locations[].linkedinText` **T** | `locations[]` **T** | |
| company_type | **U** | **U** | `companyType` **D** | `companyType` **D** | ownership, NOT business model |
| startup/YC evidence | `batch`,`status`,`stage`,`topCompany` **D** | `batch`,`status`,`yearFounded` **D** | **U** | **U** | YC-only signal |
| hiring_status | `isHiring` + `openJobs[]` **D** | `isHiring` + `openJobsCount` **D** | **U** | `jobSearchUrl` **U** | LinkedIn side needs a separate job call |
| founded_year | **U** | `yearFounded` **D** | **U** | `foundedOn.year` **!** | null on 2 of 3 observed |
| source_provenance | constant | constant | constant | constant | |

## Job contract

| Canonical field | memo23 `openJobs[]` | li-job-search | Notes |
|---|---|---|---|
| job_id | `jobId` **D** | `id` **D** | |
| job_url | `url` **D** | `linkedinUrl` **D** | |
| title | `title` **D** | `title` **D** | |
| company identity | parent row **D** | `company.linkedinUrl` + `company.id` **D !** | the posting company may not be the employer — see aggregators |
| location | `location` **T** | `location.linkedinText` **T** | |
| workplace mode | `location` text **S** | `workplaceType` **D** | |
| posted_date | `postedAgo` (relative) **T !** | `postedDate` (ISO) **D** | memo23 gives "5 days ago" style — needs run-time anchoring |
| description | **U** | `descriptionText` **D** | memo23 openJobs carries no description |
| role taxonomy | `roleCategory`/`roleSubcategory` **D** | `jobFunctions`,`industries` **A** | YC's own taxonomy is useful and free |
| retrieved_at | `scrapedAt` **D** | `_meta` **A** | |

## Person / founder contract

| Canonical field | li-company-employees | li-profile-search | Notes |
|---|---|---|---|
| full_name | `firstName`+`lastName` **T** | same **T** | no single name field |
| title | `currentPositions[0].title` **D** | same **D** | |
| linkedin_url | `linkedinUrl` **!** | `linkedinUrl` **!** | opaque `ACwAAA…` member-id form, NOT a vanity slug — dedupe on `id` |
| current_employer | `currentPositions[].companyName` **D** | same **D** | |
| current-employer evidence | `current`, `companyLinkedinUrl`, `tenureAtCompany` **D** | same **D** | exactly what employer verification needs |
| founder/CEO role evidence | title regex **S** | title regex **S** | `jobTitles` filter is fuzzy — 2/10 rows were Finance Intern / Director |
| email | not requested | not requested | deliberately excluded |
