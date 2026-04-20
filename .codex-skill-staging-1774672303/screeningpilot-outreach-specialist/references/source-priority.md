# Source Priority and Budget Caps

## Default Mode
- Geography: `United States`
- Market: startups and startup-like growth companies
- Intent mode: `high intent`
- Final target: `50 leads`
- Raw target: `150-220 candidates`
- Apify hard cap: `$5/run`
- Firecrawl hard cap: `500 credits/run`

## Source Order
1. LinkedIn post commenters on hiring-pain posts
2. LinkedIn job posts
3. YC / Work at a Startup / Wellfound job boards
4. Firecrawl funding/news enrichment
5. Apify contact enrichment on the final shortlist

## Final Mix
- `40%` LinkedIn commenters
- `35%` LinkedIn jobs
- `15%` YC / Work at a Startup / Wellfound boards
- `10%` enrichment-driven upgrades

Translate the mix into a `50 lead` run as:
- `20` commenter leads
- `18` LinkedIn job leads
- `8` job-board leads
- `4` enrichment upgrades

If a source underfills, backfill from the next source in priority order.

## Apify Cost Envelope
Use these caps unless the user explicitly asks for a wider run:

| Source | Cap | Estimated Cost |
| --- | --- | --- |
| LinkedIn post search | `8 queries x 2 passes x maxPosts 8` | `<= $0.30` |
| LinkedIn comments | `top 20 posts x maxItems 40` | `<= $1.60` |
| LinkedIn jobs | `8 job titles x maxItems 12` | `<= $0.10` |
| Contact discovery | `top 10 companies x maxItems 5` | `<= $0.80` |
| Email search | `top 1 contact x 10 companies` | `<= $0.20` |

Keep the planned total at or below `~$3.00` so variance and actor start fees still stay under the `$5` cap.

## Firecrawl Cost Envelope
Aim for `< 150 credits/run` and never exceed `500`.

Recommended cap split:
- Job-board pages: `<= 10 credits`
- Funding/news search: `<= 60 credits`
- URL scrapes from search results: `<= 40 credits`
- Crawl fallback: `<= 50 credits`

## Budget Backoff Rules
If Apify cost rises:
1. Cut contact-enrichment companies from `10` to `6`
2. Cut comment posts from `20` to `15`
3. Cut job titles from `8` to `6`

If Firecrawl usage rises:
1. Reduce enrichment companies from `15` to `10`
2. Scrape `2` URLs per company instead of `3`
3. Disable crawl fallback for low-priority companies
