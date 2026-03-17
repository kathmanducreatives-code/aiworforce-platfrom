# Screening Pilot Pipeline (TypeScript)

Modular lead generation + outreach pipeline with independent stages:

1. Firecrawl job-board scraping
2. Apify LinkedIn post/comment scraping + scoring
3. Firecrawl company enrichment
4. One-time VC portfolio scrape
5. Claude personalized message generation
6. Supabase upsert
7. n8n outreach trigger (hot leads)

## Setup

1. Copy `.env.example` to `.env` in this folder.
2. Export variables into your shell before running:

```bash
cd screening-pilot-pipeline
set -a; source .env; set +a
npm run run
```

## Required Env

- `APIFY_API_TOKEN`
- `APIFY_LINKEDIN_POST_SEARCH_ACTOR_ID`
- `FIRECRAWL_API_KEY`
- `ANTHROPIC_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `N8N_WEBHOOK_URL`
- `N8N_API_KEY` (or `envN8N_API_KEY`)

## Notes

- `DRY_RUN=true` prevents live n8n delivery and logs would-be sends.
- `RUN_VC_PORTFOLIO=true` enables one-time portfolio scrape stage.
- No API keys are hardcoded; all credentials are env-driven.
