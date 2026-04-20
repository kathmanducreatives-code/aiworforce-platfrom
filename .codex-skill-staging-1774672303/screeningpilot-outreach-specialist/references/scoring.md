# Lead Scoring, Exclusions, and Shortlist Rules

## Hard Exclusions
Drop immediately if the profile or company is primarily:
- recruiter
- staffing firm
- recruiting agency
- headhunter
- career coach
- advisor or consultant without hiring ownership
- obvious job seeker
- enterprise or big-tech noise with no startup fit

## Normalization
Normalize these fields before scoring:
- `company_name`
- `company_url`
- `source_channel`
- `source_subtype`
- `evidence_url`
- `evidence_excerpt`
- `signal_summary`
- `recency_days`
- `contact_name`
- `contact_title`
- `contact_linkedin_url`

## Commenter Scoring
- decision-maker title (`founder|co-founder|ceo|cto|vp|head|director|engineering manager|talent|people`): `+4`
- fee / agency / commission pain: `+4`
- hiring speed, candidate quality, or screening pain: `+3`
- frustration language: `+2`
- startup signal: `+2`
- recruiter / staffing language: `skip`

## LinkedIn Job Scoring
- founding or high-leverage technical role: `+3`
- posted within `7` days: `+3`
- `under10Applicants=true` when present: `+2`
- company size `<= 200` or clear startup fit: `+2`
- multiple open technical roles: `+2`
- recent funding signal: `+2`
- recruiter / staffing company: `skip`

## Job-Board Scoring
- YC / Work at a Startup source: `+3`
- posted within `14` days: `+3`
- founding or senior technical / product-design role: `+2`
- multiple open roles at the company: `+2`
- recent batch, early-stage, or founder-led signal: `+2`

## Enrichment Upgrade Scoring
Use enrichment as a multiplier, not a top-of-funnel replacement.

- funding in last `90` days: `+3`
- active careers page or hiring language on site: `+2`
- recent expansion / press / growth language: `+1`

Only create a standalone enrichment lead if both funding and hiring signals are present.

## Tiering
- `hot`: `>= 8`
- `warm`: `6-7`
- `skip`: `< 6` or disqualified

Only run contact enrichment for `hot` leads after company-level dedupe.

## Dedupe
1. Dedupe contacts by canonical LinkedIn URL.
2. Dedupe companies by normalized company URL or normalized company name.
3. Keep one primary lead per company.
4. Preserve secondary evidence in `alternate_signals`.

Ranking precedence:
1. `score`
2. recency
3. directness of pain signal
4. clarity of company fit

## Shortlist Rules
- Final output target: `50`
- Raw candidate target: `150-220`
- Source mix target:
  - `20` commenter leads
  - `18` LinkedIn job leads
  - `8` board leads
  - `4` enrichment upgrades

If the preferred mix underfills, backfill from the next highest-ranked source.

## Output Expectations
Return lead-centric rows only:
- normalized lead fields
- source and evidence URL
- signal summary
- score and tier
- preferred contact
- fallback contacts
- funding signal
- enrichment summary

Do not draft a DM or email unless the user separately asks for outreach copy.
