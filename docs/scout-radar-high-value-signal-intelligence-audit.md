# Scout Radar — high-value signal intelligence audit

Branch: `scout-radar-high-value-signal-intelligence` · base `remix/main` @ `37b3f3dd`
(post PR #27 "signals-icp-live-workflow", which already added scan-plan-driven
execution, staging, `radarSourceExecution`, the draft gate and isolation tests).
Approval-first, no deploy, no providers run.

This audit traces the real radar pipeline, explains the recorded **63 hiring / 5
people / 0 funding / 0 competitors / 0 posts / 0 comments / 1 verified**
distribution, audits actual provider capability, and documents the pure,
provider-independent **intelligence contracts** added on this branch. The
provider-dependent adapters (LinkedIn posts/comments/people) are **stopped and
reported** below rather than faked.

---

## 1. Pipeline trace (37b3f3dd)

```
Company Brain (company_brain.profile JSONB)
 → compileCompanyBrainContext            _shared/companyBrainCompiler.ts (v2-normalized)
 → buildRadarScanPlan                    _shared/radarScanPlanner.ts (staged queries, negatives, caps)
 → run-radar-scan/index.ts               getUser → workspace_members (403) → load brain
    → runFirecrawlSource (staged)        _shared/radarSourceExecution.ts (Firecrawl search)
    → Apify jobs (flagged)               _shared/radarSources/apifyJobsHiringSource.ts
 → scoreCandidates → scoreAgainstCompanyBrain   _shared/radarCandidatePipeline.ts / icpSignalScorer.ts
 → signals.insert (workspace-scoped)     _shared/signalQuality.ts (dedupe)
 → useSignalFeed → SignalFeed → SignalCard  (frontend)
```

## 2. Root causes of the 63 / 5 / 0 / 0 / 0 / 1 distribution

- **63 hiring, mostly junk, 1 verified:** the scorer downgrades but does not
  *reject* off-ICP roles precisely enough. "Director of Commercial Analytics",
  "Product Manager Intern", generic "Account Executive" all survive as hiring
  rows because there was no **role-family** distinction (priority-buyer vs
  adjacent-IC vs unrelated) and company-exclusion (agency/nonprofit/oversized)
  was not applied at the hiring layer. **Fixed** by `hiringRoleFamily.ts`.
- **5 people as standalone signals:** person rows were persisted as market
  signals with no attached account event. **Fixed contractually** by
  `radarDecision.classifyPerson` (person-only ⇒ excluded from verified counts).
- **0 funding / 0 competitors / 0 posts / 0 comments:** the **only** structured
  provider adapter is the LinkedIn **jobs** actor. Funding/competitor/workflow
  run through Firecrawl *search* (web hits — no post metrics, no comments), and
  posts/comments have **no configured actor at all**. So these tabs are
  structurally empty, and "Ready" only ever meant "a key exists" (§3).

## 3. Source-capability audit — STOP AND REPORT

| Source | Configured provider | Can retrieve today? |
| --- | --- | --- |
| Hiring (jobs) | Apify `curious_coder~linkedin-jobs-scraper` (flag `RADAR_ENABLE_APIFY_JOBS`) + Firecrawl fallback | **Yes** |
| Funding | Firecrawl search only | Weak — web hits, no verified round/amount |
| Competitor activity | Firecrawl search of brain seeds | Weak — no structured "what changed" |
| Workflow trends | Firecrawl search | Partial — needs multi-source gating |
| LinkedIn company/individual posts | **none** | **No** |
| Post reaction/comment/repost counts | **none** | **No** |
| LinkedIn comments + commenter identity | **none** | **No** |
| Decision-makers (people) | flag `APIFY_ENABLE_PEOPLE_SEARCH`, **no adapter** | **No** |

**Firecrawl cannot reliably supply LinkedIn post engagement metrics or comments.**
Implementation is therefore stopped for those adapters; the provider-independent
contracts + fixtures are implemented so wiring an actor later is a drop-in.

### Missing actors — required interfaces (for approval)

1. **LinkedIn posts** — env `RADAR_APIFY_LINKEDIN_POSTS_ACTOR` (+ `APIFY_API_TOKEN`).
   Input `{ queries?: string[]; companyUrls?: string[]; maxItems: number }`.
   Output per item `{ postUrl, authorName, authorHeadline, authorCompany, text, reactions, comments, reposts, publishedAt }`.
   Cost cap: `maxItems ≤ 25/scan`; est. ~$0.01–0.05/item (actor-dependent).
2. **LinkedIn comments** — env `RADAR_APIFY_LINKEDIN_COMMENTS_ACTOR`.
   Input `{ postUrls: string[]; maxComments: number }`.
   Output `{ commenterName, commenterHeadline, commenterProfileUrl, commenterCompany, commentText, commentUrl, parentPostUrl }`.
   Cost cap: `maxComments ≤ 30/post`.
3. **Decision-makers** — env `RADAR_APIFY_LINKEDIN_PEOPLE_ACTOR`.
   Input `{ companyUrlOrName: string; roles: string[]; max: number }`.
   Output `{ name, headline, profileUrl, company }`. Attach to an account signal only.

Until these env vars + actors are provisioned, those sources report
`not_configured` (never "Ready"), and the UI explains the zero honestly.

### Readiness states (`radarDiagnostics.ts`)
`not_configured` · `configured_untested` · `healthy` · `degraded` ·
`returned_zero` · `auth_failed` · `provider_error` · `query_no_match` ·
`matches_rejected`. "Ready" is never "a key exists".

## 4. Company Brain fields consumed (`radarIntelligenceProfile.ts`)

target company (industries, categories, business_models, size, geography,
must-have, excluded types/industries/keywords/domains); buyers (titles, exact
role terms = brain titles + generic GTM-leadership family, adjacent IC roles,
negatives, seniority); buying signals (hiring/funding/launch-expansion/workflow-
pain); topics (content + workflow + linkedin); competitors (**workspace seeds
only** + adjacent tools + watchlist). **No production competitor names live in
global code** — Alta/Gojiberry only arrive via a workspace brain (proven by test).

## 5. Intelligence contracts added (pure, tested, provider-free)

- **Hiring** `hiringRoleFamily.ts` — exact/adjacent/unrelated + company exclusion +
  honest "{Company} is hiring a {Role}." view.
- **Posts** `linkedInIntelligence.ts` — group (competitor/category-leader/ICP-pain/
  high-engagement/off-topic) + transparent engagement class (**never "viral"
  without metrics**).
- **Comments** — intent detection ("Great post!" ⇒ not intent; implementation
  question from ICP-fit buyer ⇒ signal) + **parent-post evidence required**.
- **Competitors** `competitorIntelligence.ts` — direct/adjacent/replacement,
  requiring real buyer/category/workflow overlap (generic "AI"/"sales" alone ⇒
  not a competitor).
- **Workflow trends / Funding** `marketIntelligence.ts` — trend needs topic +
  credible source (emerging/established/speculative); funding passes through only
  provided fields (**never fabricates** amount/round/date), funding-alone ⇒ watch.
- **People** `radarDecision.classifyPerson` — person-only is not a signal.
- **Canonical decision** `radarDecision.ts` — contact/watch/needs_review/skip +
  draft-outreach gate (blocked for needs_review / person-only / evidence-less) +
  tag hygiene (removes "Active hiring: Active hiring").
- **Diagnostics** `radarDiagnostics.ts` — per-source object + readiness + a human
  explanation for every zero.

## 6. Verification & decision

One vocabulary: **contact / watch / needs_review / skip**. CONTACT requires a
verified company, brain fit, evidence URL, recency, why-now and (for outreach) a
decision maker. Draft outreach is unavailable on unverified/needs_review/person-
only/evidence-less rows — replaced by Verify source / Resolve company / Find
decision maker / Watch company.

## 7. Workspace & run isolation

`run-radar-scan` keeps the membership gate (`workspace_members` → 403 before any
brain/signal read); every intelligence profile is workspace-scoped (proven);
competitor seeds are workspace-sourced only (proven). Per-run scoping
(`scan_run_id`) on `signals`/diagnostics is **recommended but requires a schema
column** — see §9 (not applied; no migration on this branch).

## 8. Frontend

Pure category model (`src/lib/radarCategoryModel.ts`): category-aware counts,
honest per-category empty-state reasons (zero-source vs hidden-by-filters), filter
reconciliation on category switch, and saved-vs-drafts separation. Full
source-specific card components (Hiring/Post/Comment/Competitor/Funding/Workflow)
are specified here and partially delivered; see remaining gaps.

## 9. Remaining gaps / decisions needing approval

- **Provider actors** for posts/comments/people (env vars + interfaces in §3).
- **`scan_run_id` persistence** would need a migration (`ALTER TABLE signals ADD
  COLUMN scan_run_id uuid; ALTER TABLE ... diagnostics`) — **STOPPED, not applied**.
  Proposed only; run-scoping is otherwise done in-memory per scan.
- Full React source-specific cards + tab/filter wiring into `SignalFeed.tsx`.

## 10. Controlled live-QA plan (later, on approval — do NOT run now)

Max **1 scan**, **≤3 queries/source**, **≤5 accepted/category**, provider-item
caps (jobs ≤25, posts ≤25, comments ≤30/post, people ≤10). Estimate cost before
running. Verify: hiring returns an exact ICP role with a real job URL; posts
return relevant AI-GTM/pipeline-pain posts (engagement only when present);
comments return ICP-fit buyers with implementation/pain intent + parent evidence;
competitors return direct+adjacent from the brain; funding shows no invented
details. Nothing is sent, posted or published.
