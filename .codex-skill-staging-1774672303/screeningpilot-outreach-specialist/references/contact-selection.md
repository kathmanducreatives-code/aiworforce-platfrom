# Contact Selection and Email Enrichment

## When to Run
Run contact enrichment only after:
1. company-level dedupe is complete
2. the lead is `hot`
3. the company survives final ranking

Default cap:
- `10 companies` per run

## Contact Priority
Use company size and stage to choose the first persona:

- `1-50 employees` or clear `YC / seed / series A`:
  - first choice: founder / co-founder / CEO / CTO
  - fallback: head of engineering / engineering manager

- `51-200 employees`:
  - first choice: head of talent / VP people / recruiting lead
  - fallback: founder / CTO / head of engineering

- no hiring leader visible:
  - choose the highest-signal operator who clearly owns hiring urgency

## Apify Contact Discovery
Use `harvestapi/linkedin-company-employees`.

Discovery defaults:
- mode: short / cheapest profile mode first
- `maxItems=5`
- strict title filter:
  - `Founder`
  - `Co-Founder`
  - `CEO`
  - `CTO`
  - `Head of Talent`
  - `VP People`
  - `Recruiting Lead`
  - `Head of Engineering`
  - `Engineering Manager`

Keep only the top `1-2` contacts per company.

## Email Search
Enable email search only for the top `1` contact per company.

Default cap:
- `10 profiles` total per run

If the budget is tight, reduce to:
- `6 companies`
- `1 contact` each

## Firecrawl Fallback
If Apify returns no usable email:
1. Scrape `about`, `team`, and `contact` pages from the company site.
2. Extract only public emails or role inboxes.
3. Do not invent guessed emails.

Prefer:
- founder email
- hiring team email
- generic company contact only if no person-specific route exists

## Dedupe
Dedupe contacts in this order:
1. canonical LinkedIn URL
2. normalized email
3. name + company

Return:
- `preferred_contact`
- `fallback_contacts`
- `contact_strategy`
- `email_source`
