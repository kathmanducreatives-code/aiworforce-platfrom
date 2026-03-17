# Lead Scraping Setup (Apify + Firecrawl)

This project sends lead scrape requests from the frontend to n8n webhooks.

## 1. Configure n8n credentials (server-side)

In n8n, create secure credentials:
- `APIFY_API_TOKEN`
- `FIRECRAWL_API_KEY`

Use those credentials in your workflow nodes. Do not expose these keys in frontend env variables.

## 2. Configure frontend webhook endpoints

Copy `.env.example` to `.env.local` and set:

```bash
VITE_N8N_LEAD_SCRAPER_WEBHOOK_URL=https://your-n8n/webhook/lead-scrape
VITE_N8N_ADVANCED_SEARCH_WEBHOOK_URL=https://your-n8n/webhook/advanced-firecrawl-search
```

## 3. Request flow

- `mode: standard` -> `VITE_N8N_LEAD_SCRAPER_WEBHOOK_URL` (Apify workflow)
- `mode: advanced` -> `VITE_N8N_ADVANCED_SEARCH_WEBHOOK_URL` (Firecrawl workflow)

Payload fields sent by the app:
- `currentCompanies`
- `currentJobTitles`
- `locations`
- `industries`
- `maxItems`
- `searchQuery`
- `mode`
- `session_id`
- `timestamp`
- `source`

## 4. Recommended n8n response shape

Return JSON like:

```json
{
  "message": "Lead scraping started",
  "leadsCount": 42,
  "results_metadata": {
    "actual_count": 42,
    "requested_count": 50
  },
  "suggestions": []
}
```
