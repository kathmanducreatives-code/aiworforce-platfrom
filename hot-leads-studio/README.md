# Hot Leads Studio

Standalone localhost tool for hot-lead scraping and CSV review.

## Run

```bash
cd hot-leads-studio
npm run dev
```

Open `http://localhost:3099`.

## What it does

- runs the blended hot-leads pipeline with Apify + Firecrawl
- runs a focused LinkedIn post/comment hot-lead scrape through Apify
- runs LinkedIn jobs and Firecrawl board sweeps
- shows the outputs in a spreadsheet-style UI
- lets you download the current CSV or JSON export

## Credentials

The server reads `APIFY_API_TOKEN` and `FIRECRAWL_API_KEY` from:

- shell environment
- `/Users/prasidha/screeningpilot/screeningpilot/.env.local`
- `/Users/prasidha/screeningpilot/screeningpilot/.env`
- `/Users/prasidha/screeningpilot/screeningpilot/screening-pilot-pipeline/.env`
