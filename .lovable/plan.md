

## Multi-Platform Job Distribution Engine + Growth Intelligence + Cost Calculator

Since you want to start with the **Job Distribution Engine** and use mock/sample data for now, this plan builds all three features in phases, with distribution as the core focus and growth signals + calculator as supporting modules.

---

### Phase 1: Database Schema (New Tables)

**Table 1: `job_distribution_status`** — tracks where each screening job has been distributed

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| job_id | uuid | FK to screening_jobs |
| platform | text | linkedin, indeed, wellfound, xml_feed |
| status | text | pending, posted, failed, removed |
| external_job_id | text | nullable, ID from the platform |
| posted_at | timestamptz | nullable |
| last_synced_at | timestamptz | nullable |
| feed_url | text | nullable, for XML/JSON feed |
| error_message | text | nullable |
| created_at | timestamptz | default now() |
| user_id | uuid | for RLS |

**Table 2: `growth_signal_companies`** — unified hiring + funding intelligence

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| company_name | text | normalized |
| industry | text | nullable |
| funding_round | text | e.g. Series A, Seed |
| funding_amount | numeric | nullable |
| funding_date | date | nullable |
| investors | jsonb | array of investor names |
| open_roles_count | integer | default 0 |
| engineering_roles_count | integer | default 0 |
| sample_job_titles | jsonb | array of strings |
| growth_score | integer | computed 0-100 |
| is_hot_lead | boolean | default false |
| source_url | text | nullable |
| last_updated | timestamptz | default now() |
| created_at | timestamptz | default now() |
| user_id | uuid | for RLS |

RLS: Both tables scoped to authenticated users by `user_id`.

---

### Phase 2: Job Distribution Engine (Core Feature)

**A. Enhance Existing Job Creation**

Extend the `CreateJobForm.tsx` to add after job creation:
- A new "Distribute Job" step/dialog that appears after a screening job is created
- Platform checkboxes: LinkedIn, Indeed, Wellfound, Custom XML Feed
- "Distribute" button that creates `job_distribution_status` records

**B. New Page: `/job-distribution`**

A dashboard showing all distributed jobs with:
- Table view: Job Title | Platforms (icon badges) | Status per platform | Last Synced | Actions
- Status indicators: green dot = posted, yellow = pending, red = failed
- "Distribute" button to push to new platforms
- "Generate Feed URL" button for XML/JSON feed

**C. XML/JSON Feed Generator**

Create a Supabase Edge Function `job-feed` that:
- Accepts a user token or feed key
- Returns all active screening_jobs in XML (ATS-compatible) or JSON Schema format
- Provides a public feed URL the user can submit to job boards
- Format follows standard job posting XML (like Indeed XML feed spec)

**D. Distribution Status Tracking**

Since we don't have real API integrations yet:
- LinkedIn: generate a pre-filled URL (deep link to LinkedIn job posting form) — same pattern as existing `job_postings` feature
- Indeed: generate XML feed URL for Indeed to crawl
- Wellfound: generate pre-filled application URL
- Track status manually or via the feed endpoint being hit

---

### Phase 3: Growth Signals Dashboard

**A. New Page: `/growth-signals`**

Premium glassmorphism dashboard with:
- Header with gradient + stats bar (total companies, hot leads, avg score)
- Filter bar: Industry, Funding Stage, Score Range, Hiring Volume
- Data table with columns: Company, Funding Round, Amount, Roles Hiring, Growth Score, Last Funding Date, Industry, Actions
- "Add to Outreach" button per row (creates an email sequence or adds to lead scraper)
- Hot Lead badge (fire icon) for score > 70

**B. Scoring Engine (Client-Side)**

Score calculation:
- Funding in last 3 months: +40
- Hiring 5+ roles: +30
- Engineering/Product roles: +20
- SaaS industry: +10
- Score > 70 = HOT LEAD

**C. Seed with Sample Data**

Since no APIs are connected yet, seed the `growth_signal_companies` table with ~20 realistic sample companies showing various funding stages, hiring volumes, and scores. This lets the UI be fully functional immediately.

---

### Phase 4: Agency Cost Calculator

**Widget component** added to the Growth Signals page (or as a standalone section):
- Inputs: Role Type (dropdown), Annual Salary (number), Agency Fee % (slider, default 20%)
- Outputs: Agency Cost, ScreeningPilot Cost (flat fee model), Savings %
- Visual comparison bar chart using Recharts (already installed)
- Animated numbers on change

---

### Sidebar Navigation Updates

Add two new nav items:
- "Growth Signals" with TrendingUp icon → `/growth-signals`
- "Job Distribution" with Share2 icon → `/job-distribution`

---

### Files to Create

| File | Purpose |
|---|---|
| `src/pages/GrowthSignals.tsx` | Growth intelligence dashboard with filters, table, calculator |
| `src/pages/JobDistribution.tsx` | Distribution status dashboard |
| `src/components/distribution/DistributeJobDialog.tsx` | Platform selection dialog |
| `src/components/distribution/DistributionStatusBadge.tsx` | Status indicator component |
| `src/components/distribution/FeedUrlCard.tsx` | Shows generated feed URL |
| `src/components/growth/GrowthSignalTable.tsx` | Main data table |
| `src/components/growth/GrowthScoreBadge.tsx` | Score visualization |
| `src/components/growth/AgencyCostCalculator.tsx` | Calculator widget |
| `src/components/growth/GrowthFilters.tsx` | Filter bar component |
| `supabase/functions/job-feed/index.ts` | XML/JSON job feed endpoint |
| DB migration | Create both new tables + seed sample data |

### Files to Modify

| File | Change |
|---|---|
| `src/App.tsx` | Add routes for `/growth-signals` and `/job-distribution` |
| `src/components/Sidebar.tsx` | Add nav items |
| `src/components/screening/CreateJobForm.tsx` | Add "Distribute" option after job creation |

---

### Design Approach

All new pages follow the established premium pattern:
- Glassmorphism cards: `bg-card/60 backdrop-blur-sm border-border/50 rounded-xl`
- Hover effects: `hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/5`
- Staggered fade-in animations
- Consistent color tokens: emerald for positive, amber for warning, red for negative
- Skeleton loading states

