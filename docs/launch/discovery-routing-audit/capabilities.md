# Complete registered capability map

Snapshot: integration `5d867037`. This is executable/readiness metadata from actual code, not live approval. Every provider has `live_authorized: false` in this audit. Full cards, reasons, prerequisites, next steps, cost units and evidence contracts: [JSON](capability-map.json).

| Capability | Executability | Engine driven | Provider readiness for this capability |
|---|---|---|---|
| startup_company_discovery | executable | True | apify_yc_companies_memo23: READY; apify_yc_companies_solidcode: CARDED_BUT_NOT_LIVE; apify_linkedin_company_search: CARDED_BUT_NOT_LIVE |
| general_company_discovery | executable | True | apify_yc_companies_memo23: CARDED_BUT_NOT_LIVE; apify_yc_companies_solidcode: CARDED_BUT_NOT_LIVE; apify_linkedin_company_search: READY |
| known_company_resolution | executable | True | none (internal stage) |
| job_discovery | executable | True | apify_linkedin_job_search: READY; apify_jobs: NOT_PRESENT; apify_linkedin_jobs_crawlworks: NOT_PRESENT; apify_indeed_jobs_automation_lab: NOT_PRESENT; apify_glassdoor_jobs: NOT_PRESENT |
| funding_signal_discovery | executable | True | apify_funding_rounds_datahyena: CARDED_BUT_NOT_LIVE |
| expansion_signal_discovery | needs_extraction_work | False | apify_google_news: NEEDS_EXTRACTION_WORK |
| product_launch_discovery | needs_extraction_work | False | apify_google_news: NEEDS_EXTRACTION_WORK |
| company_identity_resolution | executable | True | apify_linkedin_company_search: READY |
| company_enrichment | executable | True | apify_linkedin_company_details: READY |
| hiring_verification | executable | True | apify_linkedin_job_search: READY |
| expansion_signal_verification | executable | True | apify_google_news: CARDED_BUT_NOT_LIVE; apify_linkedin_company_posts: CARDED_BUT_NOT_LIVE |
| company_post_verification | needs_engine_work | False | apify_linkedin_company_posts: NEEDS_EXTRACTION_WORK |
| product_launch_verification | executable | True | apify_google_news: CARDED_BUT_NOT_LIVE; apify_linkedin_company_posts: CARDED_BUT_NOT_LIVE |
| technology_verification | needs_engine_work | False | apify_builtwith_technology: NEEDS_EXTRACTION_WORK |
| company_brain_qualification | executable | True | none (internal stage) |
| founder_discovery | executable | True | apify_linkedin_company_employees: CARDED_BUT_NOT_LIVE; apify_people_search: NEEDS_PROVIDER_WORK |
| employer_verification | executable | True | none (internal stage) |
| contact_enrichment | executable | True | apify_people_search: CARDED_BUT_NOT_LIVE |
| job_deduplication | executable | True | none (internal stage) |
| persistence | executable | True | none (internal stage) |

LinkedIn topic/comment search exists in provider cards and comment normalization, but is not an executable company/person discovery and qualification chain. The graph registry does not contain `linkedin_comment_discovery`. The proposed two-Actor A7 catalog authorizes no live execution; it covers jobs and company details only. Existing READY funding verifier Actors are outside that proposed A7 pair. Catalog prices are historical metadata and were not verified or purchased.
