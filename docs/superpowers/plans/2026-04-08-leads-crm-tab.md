# Leads CRM Tab + Firecrawl Scraping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Leads CRM tab (Master/Detail) to the power dialer dashboard that shows all Google Sheet leads with full profiles, plus a Claude-driven Firecrawl scraping flow that appends new leads to the sheet.

**Architecture:** New n8n GET webhook reads the Google Sheet and returns all leads as JSON. The dashboard polls this endpoint every 30s and renders a Master/Detail CRM tab. Claude uses the Firecrawl API (key already in `.env`) to scrape URLs on demand, normalises to sheet columns, and appends rows via the Google Sheets API.

**Tech Stack:** Vanilla JS / HTML (dashboard), n8n (webhook + Google Sheets), Firecrawl API (scraping), Google Sheets API v4 (append), existing n8n Google Sheets credentials.

---

## Task 1: Add `GET /webhook/dialer-leads` n8n webhook

**Files:**
- Modify: n8n workflow `cQUB6IEPm7mLBNoK` via PUT API (no local file)

**Context:** The Power Dialer v2 workflow already has a Google Sheets read node ("Get row(s) in sheet"). We'll add a parallel webhook branch: `Dial Leads Webhook` → `Get Leads Sheet` → `Respond Leads`. This is a separate trigger from the existing `Dial Next Lead Webhook`.

- [ ] **Step 1: Fetch current workflow JSON**

```bash
N8N_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2NDFjODJhNC02Yjg0LTQxZjUtYTg1Yy1mNmZmMDVhNjI2YzEiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwiaWF0IjoxNzY4NDg2MTIyfQ.GsWqLlIX5ckyjsrnqHrIUmn3CFT05m9NZtCvP_5frVI"
curl -s "https://n8n.prasidha.me/api/v1/workflows/cQUB6IEPm7mLBNoK" \
  -H "X-N8N-API-KEY: $N8N_KEY" > /tmp/wf_leads.json
echo "Fetched. Node count: $(python3 -c "import json; d=json.load(open('/tmp/wf_leads.json')); print(len(d['nodes']))")"
```

Expected: `Fetched. Node count: <N>`

- [ ] **Step 2: Add three new nodes and update workflow via PUT**

Run this Python script:

```python
import json, copy

N8N_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2NDFjODJhNC02Yjg0LTQxZjUtYTg1Yy1mNmZmMDVhNjI2YzEiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwiaWF0IjoxNzY4NDg2MTIyfQ.GsWqLlIX5ckyjsrnqHrIUmn3CFT05m9NZtCvP_5frVI"

with open('/tmp/wf_leads.json') as f:
    wf = json.load(f)

# Find existing "Get row(s) in sheet" node to clone its credentials + sheetId
sheet_node = next(n for n in wf['nodes'] if n['name'] == 'Get row(s) in sheet')

# 1. Webhook trigger node — GET /webhook/dialer-leads
webhook_node = {
    "name": "Dial Leads Webhook",
    "type": "n8n-nodes-base.webhook",
    "typeVersion": 2,
    "position": [200, 700],
    "parameters": {
        "httpMethod": "GET",
        "path": "dialer-leads",
        "responseMode": "responseNode",
        "options": {}
    }
}

# 2. Google Sheets read node — clone from existing, new name + position
sheet_read_node = copy.deepcopy(sheet_node)
sheet_read_node["name"] = "Get All Leads Sheet"
sheet_read_node["position"] = [420, 700]

# 3. Respond node — formats and returns all leads as JSON
respond_node = {
    "name": "Respond Leads",
    "type": "n8n-nodes-base.respondToWebhook",
    "typeVersion": 1.1,
    "position": [640, 700],
    "parameters": {
        "respondWith": "json",
        "responseBody": "={{ JSON.stringify({ leads: $input.all().map(i => i.json), total: $input.all().length, updatedAt: new Date().toISOString() }) }}",
        "options": {
            "responseHeaders": {
                "entries": [{"name": "Access-Control-Allow-Origin", "value": "*"}]
            }
        }
    }
}

wf['nodes'].extend([webhook_node, sheet_read_node, respond_node])

# Add connections
conn = wf.setdefault('connections', {})
conn['Dial Leads Webhook'] = {"main": [[{"node": "Get All Leads Sheet", "type": "main", "index": 0}]]}
conn['Get All Leads Sheet'] = {"main": [[{"node": "Respond Leads", "type": "main", "index": 0}]]}

# Build PUT payload (strip forbidden fields)
STRIP = {'description','isArchived','staticData','activeVersionId','versionCounter',
         'shared','activeVersion','id','createdAt','updatedAt','tags','active'}
ALLOWED_SETTINGS = {'executionOrder','callerPolicy','errorWorkflow','timezone'}
payload = {k: v for k, v in wf.items() if k not in STRIP}
if 'settings' in payload:
    payload['settings'] = {k: v for k, v in payload['settings'].items() if k in ALLOWED_SETTINGS}

with open('/tmp/wf_with_leads_endpoint.json', 'w') as f:
    json.dump(payload, f)
print("Saved. New node count:", len(payload['nodes']))
```

```bash
python3 /tmp/add_leads_webhook.py  # save the script above to this path first
```

- [ ] **Step 3: PUT the updated workflow**

```bash
N8N_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2NDFjODJhNC02Yjg0LTQxZjUtYTg1Yy1mNmZmMDVhNjI2YzEiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwiaWF0IjoxNzY4NDg2MTIyfQ.GsWqLlIX5ckyjsrnqHrIUmn3CFT05m9NZtCvP_5frVI"
curl -s -X PUT "https://n8n.prasidha.me/api/v1/workflows/cQUB6IEPm7mLBNoK" \
  -H "X-N8N-API-KEY: $N8N_KEY" \
  -H "Content-Type: application/json" \
  -d @/tmp/wf_with_leads_endpoint.json | python3 -c "
import sys,json; d=json.load(sys.stdin)
print('Updated at:', d.get('updatedAt', d.get('message','ERROR')))
nodes = [n['name'] for n in d.get('nodes',[])]
print('Has Dial Leads Webhook:', 'Dial Leads Webhook' in nodes)
print('Has Get All Leads Sheet:', 'Get All Leads Sheet' in nodes)
print('Has Respond Leads:', 'Respond Leads' in nodes)
"
```

Expected:
```
Updated at: 2026-04-08T...
Has Dial Leads Webhook: True
Has Get All Leads Sheet: True
Has Respond Leads: True
```

- [ ] **Step 4: Verify the endpoint works**

```bash
curl -s "https://n8n.prasidha.me/webhook/dialer-leads" | python3 -c "
import sys,json; d=json.load(sys.stdin)
print('total:', d.get('total'))
print('updatedAt:', d.get('updatedAt'))
if d.get('leads'):
    print('first lead keys:', list(d['leads'][0].keys())[:8])
"
```

Expected:
```
total: 133
updatedAt: 2026-04-08T...
first lead keys: ['row_number', 'Name', 'Phone ', 'status', ...]
```

- [ ] **Step 5: Commit note**

No local files changed — n8n workflow updated remotely. Add a comment to dashboard file:

```bash
# Note: LEADS_URL = 'https://n8n.prasidha.me/webhook/dialer-leads' (GET)
# Returns: { leads: [...], total: N, updatedAt: ISO }
```

---

## Task 2: Add Leads tab HTML + CSS to dashboard

**Files:**
- Modify: `/Users/prasidha/screeningpilot/screeningpilot/dialer-dashboard.html`

- [ ] **Step 1: Add the Leads tab button to the tab bar**

Find this in `dialer-dashboard.html` (around line 318):
```html
          <button class="tab-btn active" onclick="switchTab('calls')">📞 Call Log <span id="calls-badge" style="font-size:11px;opacity:.7"></span></button>
          <button class="tab-btn" onclick="switchTab('balance')">💰 Balance History</button>
          <button class="tab-btn" onclick="switchTab('phone')" id="phone-tab-btn">🎙 Phone</button>
```

Replace with:
```html
          <button class="tab-btn active" onclick="switchTab('calls')">📞 Call Log <span id="calls-badge" style="font-size:11px;opacity:.7"></span></button>
          <button class="tab-btn" onclick="switchTab('leads')" id="leads-tab-btn">👥 Leads</button>
          <button class="tab-btn" onclick="switchTab('balance')">💰 Balance History</button>
          <button class="tab-btn" onclick="switchTab('phone')" id="phone-tab-btn">🎙 Phone</button>
```

- [ ] **Step 2: Add the Leads tab pane HTML**

Find this line (after the closing `</div>` of the balance history tab pane, before the Phone tab pane, around line 344):
```html
        <!-- Phone / WebRTC tab -->
        <div class="tab-pane" id="tab-phone">
```

Insert before it:
```html
        <!-- Leads CRM tab -->
        <div class="tab-pane" id="tab-leads">
          <div class="leads-crm">
            <!-- Left: list -->
            <div class="leads-list-col">
              <div class="leads-search-row">
                <input class="leads-search" id="leads-search" type="text" placeholder="🔍 Search leads..." oninput="filterLeads()"/>
              </div>
              <div class="leads-filter-chips" id="leads-filter-chips">
                <button class="leads-chip active" data-status="all" onclick="setLeadFilter('all')">All</button>
                <button class="leads-chip" data-status="" onclick="setLeadFilter('')">Pending</button>
                <button class="leads-chip" data-status="calling" onclick="setLeadFilter('calling')">Calling</button>
                <button class="leads-chip" data-status="voicemail" onclick="setLeadFilter('voicemail')">Voicemail</button>
                <button class="leads-chip" data-status="answered" onclick="setLeadFilter('answered')">Answered</button>
                <button class="leads-chip" data-status="no_answer" onclick="setLeadFilter('no_answer')">No Answer</button>
              </div>
              <div class="leads-list" id="leads-list">
                <div class="leads-empty" id="leads-empty">Loading leads...</div>
              </div>
            </div>
            <!-- Right: detail -->
            <div class="leads-detail-col" id="leads-detail-col">
              <div class="leads-detail-empty" id="leads-detail-empty">
                <span style="font-size:32px">👆</span>
                <div style="margin-top:8px;color:var(--text-muted);font-size:13px">Select a lead to view details</div>
              </div>
              <div class="leads-detail-body" id="leads-detail-body" style="display:none"></div>
            </div>
          </div>
        </div>
```

- [ ] **Step 3: Add Leads CRM CSS**

Find the closing `</style>` tag (around line 231) and insert before it:
```css
  /* ── Leads CRM tab ── */
  .leads-crm { display:flex; height:500px; gap:0; overflow:hidden; }

  .leads-list-col { width:240px; min-width:200px; border-right:1px solid var(--border); display:flex; flex-direction:column; }
  .leads-search-row { padding:10px 10px 6px; }
  .leads-search { width:100%; background:var(--surface2); border:1px solid var(--border); border-radius:8px; padding:7px 10px; color:var(--text); font-size:12px; outline:none; }
  .leads-search:focus { border-color:var(--blue); }

  .leads-filter-chips { display:flex; flex-wrap:wrap; gap:4px; padding:0 10px 8px; }
  .leads-chip { background:var(--surface2); border:1px solid var(--border); border-radius:20px; padding:2px 9px; font-size:10px; color:var(--text-muted); cursor:pointer; transition:all .15s; }
  .leads-chip.active { background:var(--blue-dim); border-color:var(--blue); color:var(--blue); }
  .leads-chip:hover:not(.active) { border-color:var(--text-muted); color:var(--text); }

  .leads-list { flex:1; overflow-y:auto; }
  .leads-empty { padding:20px; text-align:center; color:var(--text-muted); font-size:12px; }

  .lead-row { padding:10px 12px; border-bottom:1px solid var(--border); cursor:pointer; transition:background .1s; border-left:2px solid transparent; }
  .lead-row:hover { background:var(--surface2); }
  .lead-row.selected { background:var(--surface2); border-left-color:var(--blue); }
  .lead-row-name { font-size:12px; font-weight:600; }
  .lead-row-company { font-size:11px; color:var(--text-muted); margin-top:1px; }
  .lead-row-meta { display:flex; align-items:center; justify-content:space-between; margin-top:4px; }
  .lead-row-attempts { font-size:10px; color:var(--text-muted); }

  .leads-detail-col { flex:1; overflow-y:auto; padding:16px; }
  .leads-detail-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; }
  .leads-detail-body { }

  .lead-detail-header { margin-bottom:14px; padding-bottom:12px; border-bottom:1px solid var(--border); }
  .lead-detail-name { font-size:18px; font-weight:800; }
  .lead-detail-title { font-size:12px; color:var(--text-muted); margin-top:2px; }
  .lead-detail-status-row { display:flex; align-items:center; gap:10px; margin-top:8px; }

  .lead-detail-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px 16px; margin-bottom:14px; }
  .lead-detail-field { font-size:12px; }
  .lead-detail-field .ldf-label { color:var(--text-muted); font-size:10px; text-transform:uppercase; letter-spacing:.04em; margin-bottom:2px; }
  .lead-detail-field .ldf-val { font-weight:500; word-break:break-word; }
  .lead-detail-field a { color:var(--blue); text-decoration:none; }
  .lead-detail-field a:hover { text-decoration:underline; }

  .lead-detail-notes { background:var(--surface2); border:1px solid var(--border); border-radius:8px; padding:10px 12px; font-size:12px; color:var(--text-muted); }
  .lead-detail-notes .ldf-label { color:var(--text-muted); font-size:10px; text-transform:uppercase; letter-spacing:.04em; margin-bottom:6px; }
  .lead-detail-notes .notes-text { color:var(--text); font-size:12px; line-height:1.5; }

  /* Status badge (reused across list and detail) */
  .status-badge { display:inline-block; padding:2px 8px; border-radius:20px; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; }
  .status-badge.calling    { background:var(--blue-dim);   color:var(--blue); }
  .status-badge.voicemail  { background:var(--yellow-dim); color:var(--yellow); }
  .status-badge.no_answer  { background:var(--orange-dim); color:var(--orange); }
  .status-badge.busy       { background:var(--red-dim);    color:var(--red); }
  .status-badge.answered   { background:var(--green-dim);  color:var(--green); }
  .status-badge.completed  { background:var(--green-dim);  color:var(--green); }
  .status-badge.do_not_call{ background:var(--red-dim);    color:var(--red); }
  .status-badge.pending    { background:var(--surface2);   color:var(--text-muted); border:1px solid var(--border); }
```

- [ ] **Step 4: Update `switchTab` to include 'leads'**

Find (around line 770):
```javascript
const TAB_NAMES = ['calls', 'balance', 'phone'];
```

Replace with:
```javascript
const TAB_NAMES = ['calls', 'leads', 'balance', 'phone'];
```

- [ ] **Step 5: Verify tab renders (manual check)**

Open `http://localhost:3333/dialer-dashboard.html` (make sure preview server is running). Click the `👥 Leads` tab. Should see the two-pane CRM layout with "Loading leads..." on the left and "Select a lead" on the right. No JS errors in console.

- [ ] **Step 6: Commit**

```bash
cd /Users/prasidha/screeningpilot/screeningpilot
git add dialer-dashboard.html
git commit -m "feat: add Leads CRM tab skeleton (HTML + CSS, no data yet)"
```

---

## Task 3: Add Leads data fetching + list rendering JS

**Files:**
- Modify: `/Users/prasidha/screeningpilot/screeningpilot/dialer-dashboard.html`

- [ ] **Step 1: Add LEADS_URL constant and leads state variables**

Find (around line 407):
```javascript
const STATUS_URL = 'https://n8n.prasidha.me/webhook/dialer-status';
```

Add after it:
```javascript
const LEADS_URL  = 'https://n8n.prasidha.me/webhook/dialer-leads';
const LEADS_POLL_MS = 30000;
```

Then find (around line 414):
```javascript
let dialerState = localStorage.getItem('dialer_state') || 'idle';
```

Add after the existing `let` declarations block:
```javascript
let leadsData        = [];       // all leads from sheet
let leadsFiltered    = [];       // after search + status filter
let selectedLeadIdx  = null;     // index into leadsFiltered
let activeLeadFilter = 'all';    // current status filter value
let leadsTimer       = null;
```

- [ ] **Step 2: Add `fetchLeads()` function**

Find the `// ── HELPERS ──` section (around line 778) and add before it:

```javascript
// ────────────────────────────────────────────────────────────────────────────
//  LEADS CRM
// ────────────────────────────────────────────────────────────────────────────
async function fetchLeads() {
  try {
    const res = await fetch(LEADS_URL);
    if (!res.ok) return;
    const data = await res.json();
    leadsData = data.leads || [];
    // Update tab badge
    const btn = document.getElementById('leads-tab-btn');
    if (btn) btn.textContent = `👥 Leads (${leadsData.length})`;
    applyLeadFilter();
  } catch(e) {
    console.warn('fetchLeads error:', e);
  }
}

function startLeadsPolling() {
  fetchLeads();
  leadsTimer = setInterval(fetchLeads, LEADS_POLL_MS);
}

function col(row, ...keys) {
  for (const k of keys) {
    const found = Object.keys(row).find(rk => rk.trim().toLowerCase() === k.toLowerCase());
    if (found && row[found] !== undefined && row[found] !== null && String(row[found]).trim() !== '')
      return String(row[found]).trim();
  }
  return '';
}

function leadStatus(row) {
  return col(row, 'status').toLowerCase() || 'pending';
}

function leadStatusBadge(status) {
  const cls = status || 'pending';
  const label = status || 'Pending';
  return `<span class="status-badge ${cls}">${label}</span>`;
}

function applyLeadFilter() {
  const query = (document.getElementById('leads-search')?.value || '').toLowerCase();
  leadsFiltered = leadsData.filter(row => {
    const name    = col(row, 'name').toLowerCase();
    const company = col(row, 'company').toLowerCase();
    const phone   = col(row, 'phone').toLowerCase();
    const matchesSearch = !query || name.includes(query) || company.includes(query) || phone.includes(query);
    const status  = leadStatus(row);
    const matchesFilter = activeLeadFilter === 'all' ||
      (activeLeadFilter === '' ? (status === 'pending' || status === '') : status === activeLeadFilter);
    return matchesSearch && matchesFilter;
  });
  renderLeadsList();
}

function filterLeads() { applyLeadFilter(); }

function setLeadFilter(status) {
  activeLeadFilter = status;
  document.querySelectorAll('.leads-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.status === status);
  });
  // When 'all' chip: match chip with data-status="all"; pending chip has data-status=""
  applyLeadFilter();
}

function renderLeadsList() {
  const list  = document.getElementById('leads-list');
  const empty = document.getElementById('leads-empty');
  if (!list) return;

  if (leadsFiltered.length === 0) {
    empty.style.display = '';
    list.innerHTML = '';
    list.appendChild(empty);
    empty.textContent = leadsData.length === 0 ? 'Loading leads...' : 'No leads match filter.';
    return;
  }

  empty.style.display = 'none';
  list.innerHTML = leadsFiltered.map((row, i) => {
    const name     = col(row, 'name') || '—';
    const company  = col(row, 'company') || '';
    const status   = leadStatus(row);
    const attempts = col(row, 'attempt_count') || '0';
    const selected = selectedLeadIdx === i ? ' selected' : '';
    return `<div class="lead-row${selected}" onclick="selectLead(${i})">
      <div class="lead-row-name">${esc(name)}</div>
      ${company ? `<div class="lead-row-company">${esc(company)}</div>` : ''}
      <div class="lead-row-meta">
        ${leadStatusBadge(status)}
        <span class="lead-row-attempts">${esc(attempts)} attempt${attempts === '1' ? '' : 's'}</span>
      </div>
    </div>`;
  }).join('');
}

function selectLead(idx) {
  selectedLeadIdx = idx;
  renderLeadsList(); // re-render to update selected highlight
  renderLeadDetail(leadsFiltered[idx]);
}

function renderLeadDetail(row) {
  const empty  = document.getElementById('leads-detail-empty');
  const body   = document.getElementById('leads-detail-body');
  if (!row) { empty.style.display='flex'; body.style.display='none'; return; }
  empty.style.display = 'none';
  body.style.display  = '';

  const name     = col(row, 'name') || '—';
  const jobTitle = col(row, 'job title', 'job_title') || '';
  const company  = col(row, 'company') || '';
  const status   = leadStatus(row);
  const phone    = col(row, 'phone') || '—';
  const location = col(row, 'location') || '—';
  const attempts = col(row, 'attempt_count') || '0';
  const lastCalled = col(row, 'last_called') || '';
  const linkedin = col(row, 'linked url', 'linkedin_url', 'linkedin url') || '';
  const website  = col(row, 'company website', 'company_website') || '';
  const industry = col(row, 'industry') || '';
  const teamSize = col(row, 'team size', 'team_size') || '';
  const revenue  = col(row, 'revenue range', 'revenue_range') || '';
  const notes    = col(row, 'notes') || '';
  const email    = col(row, 'company email', 'company_email', 'direct email #1', 'direct_email_1') || '';

  const field = (label, val, link) => val && val !== '—' ? `
    <div class="lead-detail-field">
      <div class="ldf-label">${label}</div>
      <div class="ldf-val">${link ? `<a href="${esc(link)}" target="_blank">${esc(val)}</a>` : esc(val)}</div>
    </div>` : '';

  body.innerHTML = `
    <div class="lead-detail-header">
      <div class="lead-detail-name">${esc(name)}</div>
      ${jobTitle || company ? `<div class="lead-detail-title">${esc([jobTitle, company].filter(Boolean).join(' · '))}</div>` : ''}
      <div class="lead-detail-status-row">
        ${leadStatusBadge(status)}
        <span style="font-size:11px;color:var(--text-muted)">${esc(attempts)} attempt${attempts==='1'?'':'s'}${lastCalled ? ' · last ' + timeStr(lastCalled) : ''}</span>
      </div>
    </div>
    <div class="lead-detail-grid">
      ${field('Phone', phone)}
      ${field('Location', location)}
      ${field('LinkedIn', linkedin ? 'View Profile ↗' : '', linkedin)}
      ${field('Website', website ? (website.replace(/^https?:\/\//, '') || website) : '', website)}
      ${field('Industry', industry)}
      ${field('Team Size', teamSize)}
      ${field('Revenue', revenue)}
      ${field('Email', email)}
    </div>
    ${notes ? `<div class="lead-detail-notes"><div class="ldf-label">Notes</div><div class="notes-text">${esc(notes)}</div></div>` : ''}
  `;
}
```

- [ ] **Step 3: Start leads polling on page load**

Find (around line 431):
```javascript
window.addEventListener('DOMContentLoaded', () => {
  updateDialerBtn();
  const saved = localStorage.getItem('telnyx_sip_pw');
```

Add `startLeadsPolling();` inside the handler:
```javascript
window.addEventListener('DOMContentLoaded', () => {
  updateDialerBtn();
  startLeadsPolling();
  const saved = localStorage.getItem('telnyx_sip_pw');
```

- [ ] **Step 4: Test in browser**

1. Ensure preview server is running: `python3 -m http.server 3333 --bind 127.0.0.1` from the project directory
2. Open `http://localhost:3333/dialer-dashboard.html`
3. Click `👥 Leads` tab
4. Wait up to 5 seconds — leads list should populate with names + status badges
5. Click a lead row — detail pane should show full profile
6. Type in search box — list should filter in real time
7. Click a status chip — list should filter by status
8. Check console — no errors

- [ ] **Step 5: Commit**

```bash
cd /Users/prasidha/screeningpilot/screeningpilot
git add dialer-dashboard.html
git commit -m "feat: Leads CRM tab with live data polling, search, filter, and detail pane"
```

---

## Task 4: Claude Firecrawl scraping flow

**Files:**
- No new files — Claude uses existing tools (Bash + Firecrawl API)
- Document the pattern in: `docs/superpowers/firecrawl-lead-scraping.md`

This task documents how Claude scrapes leads on demand. No code changes needed to the dashboard or n8n — Claude already has the Firecrawl API key in `.env` and can call the Sheets API directly.

- [ ] **Step 1: Verify Firecrawl API key**

```bash
source /Users/prasidha/screeningpilot/screeningpilot/.env 2>/dev/null
echo "FC key: ${VITE_FIRECRAWL_API_KEY:0:10}..."
```

Expected: `FC key: fc-d5fea4...`

- [ ] **Step 2: Verify Google Sheets credentials are accessible from n8n**

Since Claude can't use n8n credentials directly, we'll use the service account approach. Check if there's a service account JSON or OAuth token available:

```bash
find /Users/prasidha -name "*.json" -path "*google*" -not -path "*/node_modules/*" 2>/dev/null | head -5
find /Users/prasidha -name "service_account*" -not -path "*/node_modules/*" 2>/dev/null | head -3
```

If no service account found, the scrape → append flow will use a **dedicated n8n webhook** for the append step instead (POST to `/webhook/dialer-append-leads`). See Step 3.

- [ ] **Step 3: Add `POST /webhook/dialer-append-leads` n8n webhook**

This webhook accepts a JSON body `{ leads: [...] }` where each lead has the sheet column names, and appends them to the sheet.

Run this Python script:

```python
import json

N8N_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2NDFjODJhNC02Yjg0LTQxZjUtYTg1Yy1mNmZmMDVhNjI2YzEiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwiaWF0IjoxNzY4NDg2MTIyfQ.GsWqLlIX5ckyjsrnqHrIUmn3CFT05m9NZtCvP_5frVI"

with open('/tmp/wf_leads.json') as f:
    wf = json.load(f)

# Re-fetch to get latest version (after Task 1 changes)
import subprocess, json as json2
result = subprocess.run([
    'curl', '-s', 'https://n8n.prasidha.me/api/v1/workflows/cQUB6IEPm7mLBNoK',
    '-H', f'X-N8N-API-KEY: {N8N_KEY}'
], capture_output=True, text=True)
wf = json2.loads(result.stdout)

# Find existing sheet node to clone credentials
sheet_node = next(n for n in wf['nodes'] if n['name'] == 'Get row(s) in sheet')
sheet_creds = sheet_node.get('credentials', {})
sheet_params = sheet_node.get('parameters', {})
doc_id = sheet_params.get('documentId', {})
sheet_name = sheet_params.get('sheetName', {})

# 1. Webhook trigger
append_webhook = {
    "name": "Append Leads Webhook",
    "type": "n8n-nodes-base.webhook",
    "typeVersion": 2,
    "position": [200, 900],
    "parameters": {
        "httpMethod": "POST",
        "path": "dialer-append-leads",
        "responseMode": "responseNode",
        "options": {}
    }
}

# 2. Code node — expands leads array into individual items
expand_node = {
    "name": "Expand Leads",
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [420, 900],
    "parameters": {
        "jsCode": """const body = $input.first().json.body || $input.first().json;
const leads = body.leads || [];
if (!leads.length) return [{ json: { ok: false, message: 'no leads provided' } }];
// Return each lead as a separate item for the Sheets append node
return leads.map(lead => ({ json: lead }));"""
    }
}

# 3. Google Sheets append node
append_sheet = {
    "name": "Append Leads Sheet",
    "type": "n8n-nodes-base.googleSheets",
    "typeVersion": 4.5,
    "position": [640, 900],
    "credentials": sheet_creds,
    "parameters": {
        "operation": "append",
        "documentId": doc_id,
        "sheetName": sheet_name,
        "dataMode": "autoMapInputData",
        "options": {}
    }
}

# 4. Respond
respond_append = {
    "name": "Respond Append",
    "type": "n8n-nodes-base.respondToWebhook",
    "typeVersion": 1.1,
    "position": [860, 900],
    "parameters": {
        "respondWith": "json",
        "responseBody": '={{ JSON.stringify({ ok: true, appended: $input.all().length }) }}',
        "options": {
            "responseHeaders": {
                "entries": [{"name": "Access-Control-Allow-Origin", "value": "*"}]
            }
        }
    }
}

wf['nodes'].extend([append_webhook, expand_node, append_sheet, respond_append])

conn = wf.setdefault('connections', {})
conn['Append Leads Webhook'] = {"main": [[{"node": "Expand Leads", "type": "main", "index": 0}]]}
conn['Expand Leads']         = {"main": [[{"node": "Append Leads Sheet", "type": "main", "index": 0}]]}
conn['Append Leads Sheet']   = {"main": [[{"node": "Respond Append", "type": "main", "index": 0}]]}

STRIP = {'description','isArchived','staticData','activeVersionId','versionCounter',
         'shared','activeVersion','id','createdAt','updatedAt','tags','active'}
ALLOWED_SETTINGS = {'executionOrder','callerPolicy','errorWorkflow','timezone'}
payload = {k: v for k, v in wf.items() if k not in STRIP}
if 'settings' in payload:
    payload['settings'] = {k: v for k, v in payload['settings'].items() if k in ALLOWED_SETTINGS}

with open('/tmp/wf_with_append.json', 'w') as f:
    json.dump(payload, f)
print("Saved. Total nodes:", len(payload['nodes']))
```

```bash
python3 /tmp/add_append_webhook.py  # save the script above first
curl -s -X PUT "https://n8n.prasidha.me/api/v1/workflows/cQUB6IEPm7mLBNoK" \
  -H "X-N8N-API-KEY: $N8N_KEY" \
  -H "Content-Type: application/json" \
  -d @/tmp/wf_with_append.json | python3 -c "
import sys,json; d=json.load(sys.stdin)
print('Updated:', d.get('updatedAt','ERROR'))
nodes = [n['name'] for n in d.get('nodes',[])]
print('Has Append Leads Webhook:', 'Append Leads Webhook' in nodes)
"
```

- [ ] **Step 4: Test the append webhook**

```bash
curl -s -X POST "https://n8n.prasidha.me/webhook/dialer-append-leads" \
  -H "Content-Type: application/json" \
  -d '{
    "leads": [{
      "Name": "Test Lead Claude",
      "Phone ": "+15555550001",
      "status": "",
      "last_called": "",
      "attempt_count": "0",
      "notes": "Scraped via Firecrawl test"
    }]
  }' | python3 -m json.tool
```

Expected: `{"ok": true, "appended": 1}`

Then check the Google Sheet — "Test Lead Claude" should appear as a new row.

- [ ] **Step 5: Document the scraping pattern**

```bash
mkdir -p /Users/prasidha/screeningpilot/screeningpilot/docs/superpowers
cat > /Users/prasidha/screeningpilot/screeningpilot/docs/superpowers/firecrawl-lead-scraping.md << 'EOF'
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
   `Name | Phone  | status | last_called | attempt_count | notes | Linked Url | Job Title | Location | Company | Company Website`
   Set status="", last_called="", attempt_count="0"

4. **Append via n8n webhook**:
```bash
curl -s -X POST "https://n8n.prasidha.me/webhook/dialer-append-leads" \
  -H "Content-Type: application/json" \
  -d '{"leads": [...]}'
```

5. **Confirm**: "Added N leads to the dialer. They'll appear in the Leads tab within 30 seconds."

## Notes
- Deduplicate by phone: skip leads whose phone already exists in the sheet
- Max 50 leads per scrape to avoid rate limits
- Always include country code (+1 for US numbers)
EOF
```

- [ ] **Step 6: Commit**

```bash
cd /Users/prasidha/screeningpilot/screeningpilot
git add docs/superpowers/
git commit -m "feat: add dialer-append-leads webhook + firecrawl scraping docs"
```

---

## Task 5: End-to-end smoke test

- [ ] **Step 1: Start the preview server if not running**

```bash
cd /Users/prasidha/screeningpilot/screeningpilot
lsof -i :3333 | grep LISTEN || python3 -m http.server 3333 --bind 127.0.0.1 &
```

- [ ] **Step 2: Verify Leads tab loads data**

Open `http://localhost:3333/dialer-dashboard.html` → click `👥 Leads` tab.
- Tab badge should show `(133)` or current count
- Left list shows lead names with status badges
- Clicking a lead shows full profile on right
- Search "Alok" filters to Alok Aggarwal
- Status chip "Calling" filters to leads with `calling` status

- [ ] **Step 3: Simulate a scrape**

```bash
curl -s -X POST "https://n8n.prasidha.me/webhook/dialer-append-leads" \
  -H "Content-Type: application/json" \
  -d '{
    "leads": [
      {"Name": "Jane Founder", "Phone ": "+15555550099", "status": "", "last_called": "", "attempt_count": "0", "notes": "YC W25", "Company": "StartupCo", "Job Title": "CEO"}
    ]
  }' | python3 -m json.tool
```

Wait 30 seconds (or click Leads tab to trigger poll) — "Jane Founder" should appear in the list.

- [ ] **Step 4: Final commit**

```bash
cd /Users/prasidha/screeningpilot/screeningpilot
git add -p
git commit -m "feat: leads CRM tab + firecrawl append pipeline complete"
```

---

## Self-Review

**Spec coverage:**
- ✅ Chat-triggered scraping → Claude uses Firecrawl API (Task 4)
- ✅ Leads appear in dashboard tab → polling GET webhook (Tasks 1 + 3)
- ✅ Master/Detail CRM layout (Task 2)
- ✅ Full profile: all sheet columns (Task 3, `renderLeadDetail`)
- ✅ Search + status filters (Task 3, `applyLeadFilter`)
- ✅ Append to Google Sheets → `dialer-append-leads` webhook (Task 4)
- ✅ Auto-refresh every 30s → `LEADS_POLL_MS = 30000` (Task 3)
- ✅ Lead count badge on tab button (Task 3, `fetchLeads`)

**Placeholder scan:** None found — all steps have complete code.

**Type consistency:** `col()` function defined once in Task 3 and used consistently. `leadsFiltered`, `leadsData`, `selectedLeadIdx` defined in Task 3 Step 1 and used in all subsequent functions. `leadStatus()`, `leadStatusBadge()`, `renderLeadsList()`, `renderLeadDetail()` all defined before use.
