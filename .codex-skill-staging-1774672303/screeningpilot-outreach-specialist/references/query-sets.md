# Query Sets and Runtime Defaults

## LinkedIn Post Search
Use `harvestapi/linkedin-post-search`.

Run two passes with the same `searchQueries`:
- Pass A: `postedLimit="week"`, `sortBy="date"`, `maxPosts=8`
- Pass B: `postedLimit="month"`, `sortBy="relevance"`, `maxPosts=8`

Always keep:
- `scrapeComments=false`
- `scrapeReactions=false`

Use these queries:
- `recruiting agency fees`
- `staffing agency fees`
- `agency commissions are expensive`
- `hiring engineers is hard`
- `can't find software engineers`
- `bad candidate quality`
- `recruiting takes too long`
- `we're growing our engineering team`

After dedupe by canonical post URL, keep the top `20` posts for comment scraping.

## LinkedIn Comments
Use `harvestapi/linkedin-post-comments`.

Input defaults:
- `postedLimit="month"`
- `maxItems=40`
- `scrapeReplies=false`
- `profileScraperMode="main"`

Only run on the `20` shortlisted posts from the post-search stage.

## LinkedIn Jobs
Use `harvestapi/linkedin-job-search`.

Input defaults:
- `jobTitles=["Founding Engineer","Software Engineer","Backend Engineer","Full Stack Engineer","AI Engineer","ML Engineer","Product Engineer","Product Designer"]`
- `locations=["United States"]`
- `sortBy="date"`
- `employmentType="Full-time"`
- `postedLimit="Past Week"`
- `maxItems=12`

Do not use `under10Applicants` or `easyApply` as hard filters. Treat them as scoring bonuses only when present in the output.

## Job Boards
Use Firecrawl on:
- `https://www.ycombinator.com/jobs`
- `https://www.workatastartup.com/jobs`
- `https://wellfound.com/jobs`

Scrape defaults:
- `formats=["markdown"]`
- `onlyMainContent=true`
- `blockAds=true`
- `proxy="basic"`
- `timeout=45000`
- `location={country:"US",languages:["en-US"]}`
- `maxAge=21600000`

Prefer deterministic parsing for YC and Work at a Startup. Use structured extraction only for Wellfound or parser failures.

## Firecrawl Enrichment Search
Search only the top `15` deduped companies.

Run at most these queries per company:
- Funding query: `"{company_name}" (raised seed OR raised "series a" OR raised "series b")`
- Company-site funding query: `site:{domain} (press OR news OR blog) (funding OR raised OR announced)`
- Hiring query: `site:{domain} (careers OR jobs OR hiring)`

Search defaults:
- `limit=3`
- `location="United States"`
- funding window: last `90` days
- hiring window: last `30` days
- do not enable `scrapeOptions` inside search unless the user explicitly wants inline result scraping

Then scrape only the top `2` URLs per company.

## Crawl Fallback
Only run when search misses or the company site has weak public structure.

Fallback cap:
- max `5` companies per run

Use `/map` first, then `/crawl` with:
- `includePaths=["/careers","/jobs","/about","/team","/press","/blog","/news","/contact"]`
- `maxDepth=2`
- `maxDiscoveryDepth=1`
- `limit=10`
- `crawlEntireDomain=false`
- `allowSubdomains=false`
- `scrapeOptions.onlyMainContent=true`
- `scrapeOptions.formats=["markdown"]`

Do not enable `changeTracking` in the first discovery run. Add it only for recurring monitoring.
