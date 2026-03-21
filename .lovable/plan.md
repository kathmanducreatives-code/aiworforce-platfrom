

# ScreeningPilot Platform Analysis & Recommendations

## Current Feature Inventory

Your platform has **18 distinct modules** across 4 pillars:

| Pillar | Features | Status |
|--------|----------|--------|
| **RECRUIT** | Dashboard, Job Screening (AI wizard + applicant review), Candidates, Expert Marketplace (mock data), Interview Scheduler | Core functional |
| **SOURCE** | Lead Scraper (LinkedIn), Deep Search (AI enrichment), ICP Intelligence (lookalike), Growth Signals | Core functional |
| **ENGAGE** | Email Sequences, Post Interceptor, Lead CRM, Outreach Engine, Job Distribution | Functional but fragmented |
| **INTELLIGENCE** | Talent Intel, Competitor Intel, Analytics, Job Tracker | Newly added, Firecrawl-powered |

---

## Critical Issues to Fix First

### 1. Sidebar Navigation is Bloated and Inconsistent
The sidebar has **6 groups with 16+ items** — the labels don't match the memory docs ("Recruit/Source/Engage" vs the documented "HIRE/FIND/ENGAGE/INSIGHTS"). Several items overlap:
- "Outreach Engine" and "Lead CRM" and "Post Interceptor" all manage leads
- "Job Tracker" and "Competitor Intel" both track competitors
- "Candidates" page just renders `ModernDashboard` — redundant with Dashboard

**Recommendation:** Consolidate to the documented 4-group structure (HIRE / FIND / ENGAGE / INSIGHTS). Remove "Outreach Engine" as a separate page — merge into Lead CRM. Remove standalone "Candidates" page — it's just a wrapper.

### 2. Expert Marketplace Uses Only Mock Data
`ExpertMarketplace.tsx` imports from `mockData.ts` — no Supabase integration. This is the only major feature running entirely on hardcoded data.

**Recommendation:** Either connect to Supabase tables (expert_profiles, interview_sessions) or clearly label it as "Coming Soon" with a waitlist CTA rather than showing fake experts.

### 3. No Unified Candidate Pipeline View
Candidates exist in 4 disconnected pools: `resume_analyses`, `screening_applications`, `linkedin_leads`, and `candidate_profiles`. There's no single view showing a candidate's journey across all touchpoints.

**Recommendation:** Build a **Unified Candidate Timeline** — a single profile page that aggregates a candidate from all sources showing: where they were found, their screening results, email sequence status, interview history, and notes. This is the #1 feature that separates toy tools from real recruiting platforms.

---

## High-Impact Feature Recommendations

### 4. AI Copilot Chat (Sidebar or Command Palette)
You have an AI-native brand but no in-app AI assistant. Add a persistent chat panel where recruiters can ask:
- "Show me all senior engineers who applied this week"
- "Draft a rejection email for candidate X"
- "What's the pipeline health for our React role?"

This would query Supabase and present answers inline — leveraging the existing data across all modules.

### 5. Candidate Comparison View
When reviewing applicants for a screening job, recruiters can only view one candidate at a time. Add a **side-by-side comparison** (2-3 candidates) showing scores, key skills, Q&A highlights, and red flags in columns. This is standard in enterprise hiring tools.

### 6. Automated Workflow Triggers
Currently, actions are manual (scrape → review → add to sequence → send). Add configurable automations:
- "When a candidate scores 85%+ on screening, auto-send interview invite"
- "When a layoff signal is detected, auto-add affected candidates to outreach sequence"
- "When a competitor changes pricing, notify me on Slack"

This turns the platform from a collection of tools into an **autonomous recruiting engine**.

### 7. Team Collaboration & Role-Based Access
The Collaboration Hub exists in memory docs but there's no visible multi-user support. For enterprise credibility:
- Add team member invites with roles (Admin, Recruiter, Viewer)
- Add candidate assignment ("Assigned to: Sarah")
- Add activity feed showing team actions

### 8. Reporting & ROI Dashboard
The Analytics page shows basic metrics. Add a dedicated **ROI Report** that calculates:
- Cost per hire (vs agency benchmark of 20%)
- Time to fill (vs industry average)
- Source effectiveness (which channel produces best hires)
- Exportable PDF reports for stakeholders

### 9. Chrome Extension for Passive Sourcing
Add a simple Chrome extension that lets recruiters:
- Click on any LinkedIn profile → instant ICP match score
- One-click add to outreach sequence
- See if candidate already exists in the system

This is table-stakes for modern sourcing tools (Gem, Hireflow all have this).

### 10. Candidate Communication Hub
Merge email sequences, interview scheduling, and candidate status into a **single inbox-style view** per candidate. Right now a recruiter must jump between 3-4 pages to manage communication with one person.

---

## UI/UX Improvements

### 11. Onboarding Flow
New users land on an empty dashboard with zero guidance. Add a **first-run wizard**:
- Step 1: Create your first screening job
- Step 2: Share the link or scrape leads
- Step 3: Review your first candidates

### 12. Global Search (Command Palette Enhancement)
The command palette exists but is navigation-only. Enhance it to search across:
- Candidates by name/email
- Jobs by title
- Leads by company
- Signals by keyword

### 13. Mobile Responsiveness Audit
Several pages (Lead Scraper at 798 lines, Deep Search at 878 lines) are desktop-heavy with complex layouts. A responsive audit pass would ensure the 3-column dashboard and data tables work on tablet viewports.

---

## Priority Ranking

| Priority | Feature | Impact | Effort |
|----------|---------|--------|--------|
| 1 | Fix sidebar navigation consistency | High | Low |
| 2 | Unified Candidate Timeline | Very High | Medium |
| 3 | First-run onboarding wizard | High | Low |
| 4 | AI Copilot Chat | Very High | Medium |
| 5 | Candidate Comparison View | High | Low |
| 6 | Expert Marketplace → real data or "Coming Soon" | Medium | Low |
| 7 | Automated Workflow Triggers | Very High | High |
| 8 | Team Collaboration & RBAC | High | High |
| 9 | ROI Reporting Dashboard | Medium | Medium |
| 10 | Chrome Extension | High | High |

The **Unified Candidate Timeline** and **AI Copilot** would be the two features that most differentiate this from competitors like Lever, Greenhouse, or Ashby. The sidebar cleanup and onboarding are quick wins that immediately improve perceived quality.

