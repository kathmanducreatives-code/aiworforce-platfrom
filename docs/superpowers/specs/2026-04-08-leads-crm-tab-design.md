# Leads CRM Tab + Firecrawl Scraping — Design Spec

**Date:** 2026-04-08

---

## Goal

Add a **Leads CRM tab** to the power dialer dashboard that shows all leads from Google Sheets with full profile details and call attempt history. Integrate Firecrawl-based lead scraping so Claude can scrape leads on demand (triggered from chat) and new leads appear in the tab automatically.

---

## Architecture

### Data Flow

```
User (chat) → "scrape YC W25 CEOs"
           → Claude + Firecrawl API (scrape & enrich)
           → Google Sheets (batch append new rows)
           → n8n webhook GET /webhook/dialer-leads (reads sheet, returns JSON)
           → Dashboard Leads tab (polls every 30s, renders CRM view)
```

### Components

1. **n8n webhook: `GET /webhook/dialer-leads`** — new workflow node in Power Dialer v2 or standalone webhook. Reads all rows from Google Sheet, returns JSON array. Reuses existing Google Sheets credentials already in n8n.

2. **Leads CRM tab** — new tab in `dialer-dashboard.html` with Master/Detail layout:
   - Left pane: scrollable lead list with search + status filter chips
   - Right pane: full profile (all sheet columns + clickable LinkedIn/website links)
   - Lead count badge on tab button
   - Polls `LEADS_URL` every 30s; updates list without losing selected lead

3. **Claude scraping flow** — when user says "scrape X", Claude:
   - Calls Firecrawl `/v1/scrape` or `/v1/crawl` with the target URL
   - Normalizes response into sheet columns: Name, Phone, status (empty), last_called (empty), attempt_count (0), notes, Company, Job Title, Location, LinkedIn Url, Company Website
   - Appends rows to Google Sheet via `POST https://sheets.googleapis.com/v4/spreadsheets/{id}/values/{range}:append`
   - Confirms to user how many leads were added

---

## Leads Tab — UI Spec

### Tab bar change
Add `👥 Leads` button between Call Log and Balance History. Show lead count as badge `(133)`.

### Master/Detail layout
- Left pane (240px fixed): search input + status filter chips (All / Pending / Calling / Voicemail / Answered / No Answer) + scrollable lead rows
- Each lead row: Name (bold), Company (muted), status badge, attempts count
- Selected row: highlighted with left border accent
- Right pane (flex): full profile grid

### Detail pane fields (from sheet columns)
- Name, Job Title, Company — header section
- Status badge (color-coded), Attempts, Last Called — prominent
- Phone (monospace), Location, LinkedIn (clickable link), Company Website (clickable link)
- Industry, Team Size, Revenue Range (if present)
- Notes (editable textarea that saves back to sheet — future scope, read-only for now)
- "Add to Dialer Queue" not needed — leads are already in sheet, dialer picks them up

### Status badge colors
- `pending` / empty → gray
- `calling` → blue
- `voicemail` → yellow
- `no_answer` → orange
- `busy` → red
- `answered` / `completed` → green
- `do_not_call` → red dim

---

## n8n Webhook Spec

**Path:** `dialer-leads`
**Method:** GET
**Response:** `{ leads: [...rows], total: N, updatedAt: ISO }`

Each row object: all columns from sheet as-is (row_number, Name, Phone, status, last_called, attempt_count, notes, plus extra columns like Job Title, Company, Location, etc.)

Implementation: single Code node that reads from `Get row(s) in sheet` output and formats the response. Can share the existing Google Sheets node from Power Dialer v2 or use a new Read node.

---

## Google Sheets Append — Columns

When Claude appends scraped leads, columns must match the sheet header exactly:
`Name | Phone | status | last_called | attempt_count | notes | Linked Url | Job Title | Location | Company | Company Website | Company Facebook | Company Email | Company Phone | Industry | Team Size | Revenue Range`

Scraped leads set: status="", last_called="", attempt_count=0

---

## Out of Scope (this iteration)

- Editing notes from dashboard (read-only for now)
- Deduplication logic (same phone = skip) — Claude handles this manually
- Pagination (load all rows, ~200 max)
- Real-time push (polling every 30s is sufficient)
