# Firecrawl Lead Scraping — How Claude Does It

## Trigger
User says in chat: "scrape [URL or description]"

## Steps Claude Takes

1. **Scrape with Firecrawl**
```bash
FC_KEY="fc-d5fea417d1b04035b44c11e6c72fd7a9"
curl -s -X POST "https://api.firecrawl.dev/v1/scrape" \
  -H "Authorization: Bearer $FC_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "<target_url>", "formats": ["markdown"]}'
```

2. **Extract leads** — Parse the markdown response, identify people with:
   - Name (required)
   - Phone (required — search LinkedIn/website if not on page)
   - Company, Job Title, Location, LinkedIn URL

3. **Normalize to sheet columns**:
   `Name | Phone  | status | last_called | attempt_count | notes | Linked Url | Job Title | Location | Company | Company Website | Company Facebook | Company Email | Company Phone | Industry | Team Size | Revenue Range`
   Set status="", last_called="", attempt_count="0"

4. **Append via n8n webhook**:
```bash
curl -s -X POST "https://n8n.prasidha.me/webhook/dialer-append-leads" \
  -H "Content-Type: application/json" \
  -d '{"leads": [...]}'
```

Expected response: `{"ok": true, "appended": N}`

5. **Confirm**: "Added N leads to the dialer. They'll appear in the Leads tab within 30 seconds."

## Notes
- Deduplicate by phone: skip leads whose phone already exists in the sheet
- Max 50 leads per scrape to avoid rate limits
- Always include country code (+1 for US numbers)
- Phone column name in sheet has a trailing space: `"Phone "` (not `"Phone"`)

## Sheet Columns Reference
```
Name | Phone  | status | last_called | attempt_count | notes | Linked Url | Job Title | Location | Company | Company Website | Company Facebook | Company Email | Company Phone | Industry | Team Size | Revenue Range
```

## Append Webhook
- **URL**: `POST https://n8n.prasidha.me/webhook/dialer-append-leads`
- **Body**: `{ "leads": [{ "Name": "...", "Phone ": "+1...", "status": "", ... }] }`
- **Response**: `{ "ok": true, "appended": N }`
- The dashboard Leads tab auto-refreshes every 30s — new leads appear automatically
