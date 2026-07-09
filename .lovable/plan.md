
# Read-only audit — Company Brain, ICP, onboarding, and Scout Radar quality

No code, migrations, RLS, secrets, or providers were touched. All findings come from reading source files under `supabase/functions/_shared/**`, `src/pages/OnboardingCompanyBrain.tsx`, `src/lib/companyBrainSchema.ts`, `src/lib/signalPreferences.ts`, and read-only queries against `public.company_brain` / `public.signals` for the current workspace `e510c1a6-2bb8-4aa4-95f7-0beb786ed995` (goji).

---

## 1. Company Brain data model

- Table: `public.company_brain` (workspace-scoped, `workspace_id uuid unique`, `profile jsonb`, `onboarding_completed bool`, `onboarding_completed_at`). Provisioned per workspace by `provision_workspace_for_user` (`handle_new_user_workspace` trigger).
- Ownership: per-workspace, not per-user. Membership via `workspace_members(workspace_id, user_id, role)`; access enforced by RLS security-definer `has_workspace_access` and `get_room_member_profiles`.
- Canonical shape (`src/lib/companyBrainSchema.ts` + Deno mirror in `supabase/functions/_shared/companyBrainSchema.ts`): `founder`, `company`, `icp`, `goals`, `gtm`, `positioning`, `brand_voice`, `competitors`, `approval_rules`, `workflow_preferences`, `integration_status`, `onboarding_meta`.
- `signal_preferences` is NOT a table — it lives inside `profile.signal_preferences` (see `src/lib/signalPreferences.ts`). Defaults are derived from `profile.icp.*` when unset.
- Current workspace profile (goji) has almost no ICP:

```json
"icp": { "industries": [], "buyer_roles": [], "pain_points": ["Data analysts, BI professionals…"], "company_size": "", "geography": "", "disqualifiers": [] },
"company": { "name": "goji", "category": "", "industry": "", "stage": "", "team_size": "", "description": "AI-powered platform for data analysis…" },
"competitors": { "known": [], "adjacent": [], "unknown": true },
"gtm": { "motion": "", "primary_channel": "", "biggest_bottleneck": "" }
```

Corruption finding: `profile.positioning` and `profile.brand_voice` were stored as raw strings that got spread into objects with numeric keys ("0":"A","1":" ",…), instead of the structured shape from `companyBrainSchema.ts`. The Compiler ignores them, so no scorer crash — but positioning/differentiators/proof_points are effectively empty. Completeness: **weak** on every axis except `company.description`.

## 2. Onboarding flow

- Frontend: `src/pages/OnboardingCompanyBrain.tsx` (1320 LOC), route reachable from dashboard. Hook: `src/hooks/useCompanyBrain.ts`. Write path is the client updating `public.company_brain.profile` directly (via `supabase-js`); edge function `setup-company-brain` also exists but not deployed.
- Fields captured today (from schema): founder identity, company (name/website/category/industry/stage/team_size/location), icp (industries, company_size, geography, buyer_roles, pain_points, disqualifiers), goals (5 free-text lines), gtm (motion/channel/bottleneck), positioning (promise/differentiators/use_cases/proof/offer/pricing/avoid), brand_voice, competitors (known/adjacent), approval_rules.
- Missing questions the ICP diagnosis requires:
  - Explicit **business model** (B2B SaaS / AI SaaS / marketplace / services) as a first-class enum, not left to `company.category` free text.
  - **Excluded industries** as first-class list (currently only `icp.disqualifiers` free text).
  - **Funding stage** of *target customers* (currently `company.stage` is the founder's own stage).
  - **Must-have vs nice-to-have** ICP criteria.
  - **Positive / negative example companies** (good-fit and bad-fit).
  - **Target job titles that indicate a buying trigger** vs generic titles.
  - **GTM roles vs generic ops roles** distinction.
  - **Lead qualification rules** (require_evidence, reject_if, manual_review_if).
- Onboarding can be skipped — `onboarding_completed` is a boolean flag set client-side; no gate blocks Radar/Leads if the brain is empty.

## 3. ICP schema quality

| Question | Answer |
|---|---|
| Structured or loose text? | Half-structured. `icp.industries`, `buyer_roles`, `disqualifiers` are string[]; goals/positioning are freeform. |
| Disqualifiers first-class? | Only as `icp.disqualifiers: string[]` (single flat list). No industry/keyword/domain/title split at the schema layer — the compiler has to synthesize that. |
| Must-have vs nice-to-have? | **No.** Not modeled. |
| Excluded industries clear? | Only via generic `disqualifiers`. |
| Buyer personas vs target companies? | Weak — buyer_roles is a flat list; no persona objects. |
| Triggers vs job titles? | **No separation.** Triggers are derived by the compiler from `hiring_roles` + defaults. |
| GTM roles vs generic ops? | **No.** Compiler has HARD_NEGATIVE_TITLES + a "Operations Manager" heuristic, but the schema does not distinguish. |
| Funding proof required/optional? | Not represented in schema. |
| B2B SaaS distinguishable from analytics/lab services? | Not by the schema — compiler infers from a regex on `company.description`. |
| AI SaaS vs "uses analytics"? | Same problem — SAAS_CONTEXT_RE only matches presence of "AI/SaaS/software" words. |
| Sales Ops vs commercial analytics? | Not distinguished. |

**Score: 4 / 10.** Fine for a display card, insufficient as a targeting brain.

## 4. Company Brain usage map

| Feature | Files/functions | Brain fields used | Missing fields consumed | Risk |
|---|---|---|---|---|
| Scout Radar / run-radar-scan | `supabase/functions/run-radar-scan/index.ts` → `compileCompanyBrainContext` → `buildRadarScanPlan` → `buildApifyJobsInput` → `fetchApifyJobs` → `apifyRowsToScoredItems` → `scoreCandidates`/`scoreAgainstCompanyBrain` | `icp.industries`, `icp.buyer_roles`, `icp.pain_points`, `icp.disqualifiers`, `icp.geography`, `icp.company_size`, `company.category`, `company.description`, `competitors.known`/`adjacent`, `positioning.avoid_positioning`, `profile.signal_preferences.*` | must-have/nice-to-have, positive/negative examples, target business model, funding proof rules | HIGH — see §6. |
| Signals UI | `src/pages/Signals.tsx`, `src/hooks/useSignalFeed.ts`, `src/hooks/useSignalReviews.ts` | reads `signals.raw.*` (score/verification/priority) | when raw lacks the Commit-4A fields (old rows) the UI has to fall back | MED — see §9. |
| Leads / Workbench | `src/hooks/useLeadResults.ts`, `src/services/leadScraperApi.ts`, `src/services/n8nApi.ts`, `supabase/functions/_shared/leadProviderQueryBuilder.ts`, `leadIntake.ts`, `leadQuality.ts`, `leadQualityGate.ts` | Does **not** currently import `compileCompanyBrainContext`. Uses `companyBrainIcp.ts::deriveCompanyIcp` in some paths; Apollo/Apify queries are prompt-built. | Same disqualifier logic isn't guaranteed here. | MED — inconsistent ICP application vs Radar. |
| Content / Scribe (Nova) | agents/scribe path (`src/data/agentProfiles.ts`, `supabase/functions/orchestrate`, `chat-respond`) | Reads `content_strategy` only if the caller passes the compiled brain; most content prompts are generic. | pains, triggers, buyer personas, banned_claims | MED — content stays generic. |
| Agents (Nova/Atlas/Mira/Orion) | `supabase/functions/run-agent`, `_shared/adaptiveWorkflow.ts`, `agentorySystemPrompt.ts`, `memoryReader.ts` | Each agent pulls whatever the caller injects; there is no single "always attach compiled brain" middleware. | Duplicate ICP derivation between `deriveCompanyIcp` and `compileCompanyBrainContext`. | MED — behaviour differs by agent. |
| Outreach drafts | `supabase/functions/_shared/draftOutreachPlan.ts`, `personalization.ts` | Uses pain_points, positioning, competitors when present. Does not consult disqualifiers before drafting. | must-have evidence, negative examples | LOW-MED. |

## 5. Data flow

`OnboardingCompanyBrain.tsx` (form) → `supabase.from('company_brain').update({ profile })` → `public.company_brain.profile` jsonb → `compileCompanyBrainContext({ profile, signal_preferences })` (in edge) → `CompanyBrainContext` (`icp`, `buyer_personas`, `disqualifiers`, `query_strategy`) → `buildRadarScanPlan` → source-specific query builder (`buildApifyJobsInput` uses `query_strategy.hiring_role_terms` + `icp.locations[0]`) → provider (`fetchApifyJobs` → LinkedIn jobs search URLs, `count`, `scrapeCompany:true`) → `normalizeApifyJobToCandidate` → `SignalCandidate` → `scoreAgainstCompanyBrain` (hard gates + weighted breakdown) → `buildRadarSignalRow` → `signals` insert with rich `raw`.

Loss points:
- Onboarding form spreads raw strings into `positioning` / `brand_voice` (current DB proves this) → compiler ignores them.
- `hiring_role_terms` are built from `icp.buyer_roles` OR defaults; when empty, defaults `["Founding Account Executive", "RevOps", "SDR"]` win and drive Apify searches (this is why Radar returned "Growth Lead", "Founder Associate" etc from the sample DB — the account has empty `buyer_roles`).
- `buildApifyJobsInput` sends the LinkedIn search **as a URL only** — no exclusion of industries, no B2B-SaaS filter, no company-size filter. Apify returns any employer that matches the role keyword. Disqualifiers only run *after* the fetch, at scoring time.
- `signals.raw` in the current DB has an old shape (`{ raw: { preview: … }, url, title, source: 'apify' }`) with no `signal_score`/`verification_status`/`matched_icp` fields. Newest row is from 2026-06-27 — before Commit 4A deploy. So the DB has not yet received Commit-4A-shaped signals.
- UI reads `raw.signal_score`, `raw.fit_score`, `raw.priority_badge` — none present on legacy rows → they render as "Fit Score 60" from whatever heuristic the UI falls back to.

Key-name mismatch: onboarding uses `positioning`/`brand_voice` (structured), but form serialization writes them as strings; compiler expects objects. `signal_preferences.hiring_roles` shadows `icp.buyer_roles`. `icp.geography` is a single string; compiler expects `locations[]`. `icp.disqualifiers` is one flat list, but `disqualifiers.{industries,keywords,domains,titles}` expected by scorer.

## 6. Current workspace diagnosis (goji)

1. Too broad? **Yes** — ICP is empty; compiler falls back to defaults + SAAS_POSITIVE_CATEGORIES because `description` mentions "AI-powered platform".
2. Explicitly B2B SaaS / AI SaaS / software? **No** in structured fields; only inferred from description regex.
3. Excludes lab/pharma/mfg/chemicals/packaging/staffing? **No** in the brain. Only `DEFAULT_DISQUALIFIERS` from `companyBrainIcp.ts` apply, and that list is: manufacturing, construction, retail, restaurant, hospitality, university, school, hospital, bank, government, logistics, local/plant/field/warehouse services. It does **not** include: pharma, chemicals, packaging, lab testing, analytical services, staffing/recruiting, professional services, oil & gas.
4. "analytics" too broad? **Yes** — `company.description` says "data analysis"; the compiler doesn't have a negative-industry regex around analytical services.
5. "Sales Operations" too broad? **Yes** — SAAS_BUYER_TITLES includes "Sales Ops"/"Sales Operations". Any job posting containing those tokens gets buyer-relevance credit.
6. "commercial analytics" as trigger by mistake? Not directly, but a role like "Director of Commercial Analytics" contains "Analytics" (a workflow topic default) → drives content_potential/tool-hit credit and buyer-relevance because compiler treats it as data/analytics context.
7. Enough negative examples? **No** — zero.
8. Company size? **Empty.**
9. Funding stage? **Empty.**
10. Buyer roles clear? **Empty; defaults win.**
11. "Not a fit" clear? **Empty.**

Pace Analytical case study (based on current logic, not the actual stored row which is pre-4A):
- **Field that made it look relevant:** title contains "Director of Commercial Analytics" → matches SAAS_BUYER_TITLES ("Analytics"/"Operations Manager" negative doesn't fire because there is revenue context in the description via "Commercial"). Also `company_name`/`job_url` present → +proof, +actionability, +freshness. `icp.industries` empty ⇒ industry check contributes 0 but doesn't reject.
- **Missing field that failed to reject it:** `disqualifiers.industries` doesn't contain "analytical services / lab testing / environmental testing / pharma / chemicals". `disqualifiers.company_types` doesn't contain "lab" or "testing lab". `company_size` bounds not set, so Pace (2,000+ employees) is not filtered by size.
- **Score components that gave points:** proof (~12/20 with URL + description), buyer_relevance (10/10 for "Sales/Commercial/Director"), actionability (5/5 for URL + company profile), freshness (10/10 for last-week posting), category (~6/10 from generic hits). ICP = 0 (no industry match), triggers = 0 → total lands ~50-60.
- **What should have happened:** hard-reject on disqualifier industry ("laboratory", "analytical services", "environmental testing", "pharmaceutical"); or, if disqualifier missing, cap at "low_confidence" because zero ICP match AND size out of band AND business model not B2B SaaS.

## 7. Query generation audit

`buildApifyJobsInput` (only Apify jobs today):

```ts
urls = keywords.map(k => `https://www.linkedin.com/jobs/search/?keywords=${k}&location=${loc}&f_TPR=r604800`)
count = clamp(10..50, cap)
```

`keywords` = `brain.query_strategy.hiring_role_terms` (from `icp.buyer_roles` + `signal_preferences.hiring_roles` + `SAAS_HIRING_TRIGGERS` when SaaS context detected). Defaults to `["Founding Account Executive","RevOps","SDR"]`.

Firecrawl fallback (`hiringQueries`): `"<role>" hiring <geo> site:linkedin.com/jobs OR site:wellfound.com`.

Issues:
- LinkedIn Jobs search URL supports only `keywords` + `location` + `f_TPR` today — no `f_C` (company), no `f_I` (industry), no `f_E` (experience). Disqualifiers cannot be injected into the query.
- No must-have B2B SaaS token added to `keywords`. A search for "Sales Operations" returns every industry.
- "Analytics" is not injected into hiring queries today, but any Firecrawl or workflow_topic default that mentions "analytics" will surface analytical-services companies.
- Negative terms exist in `brain.query_strategy.negative_terms` but are never used in provider queries — only inside `scoreAgainstCompanyBrain`. Provider fetch is uniformly broad, filtered post-hoc.
- Content signal discovery (Firecrawl `intentQueries`, `workflowQueries`) uses hardcoded fallbacks `["AI SDR", "lead generation", …]` when brain has no topics — those defaults will populate results regardless of the workspace.

Recommended query pattern (design only, not implemented):
- must-have: business_model + product_category (`("B2B SaaS" OR "AI SaaS" OR "software" OR "SaaS")` appended to every LinkedIn Jobs search).
- optional: buyer_role token from `icp.buyer_roles`.
- negative: `-manufacturing -pharma -chemicals -packaging -"analytical services" -laboratory -staffing -"recruiting agency"` when provider supports it.
- role keywords: only from brain, never defaults, if `icp.buyer_roles` is non-empty.
- industry filter: LinkedIn `f_I` codes derived from a small taxonomy mapping when available.
- company-size filter: `f_C` size bucket.
- funding filter: only for funding source, via Firecrawl "raised Seed/Series A".

## 8. Scoring & thresholds

- File: `supabase/functions/_shared/icpSignalScorer.ts` (`scoreAgainstCompanyBrain`).
- Component weights: `proof 20 · icp 25 · trigger 15 · freshness 10 · buyer 10 · category 10 · content 5 · actionability 5` (total 100).
- Hard gates (auto-`rejected`): disqualifier hit; funding without source URL; linkedin_post/comment without URL; no company identity + no source URL; generic negative title with **zero** ICP hits.
- Caps: `!hasSourceUrl → ≤30`, `!hasDomainOrProfile → ≤45`, `no industry/size/buyer at all → ≤45 + risk flag`, `hiring without job_title+job_url → ≤40`, `!hasEvidence → ≤30`.
- `verified` requires: `hasSourceUrl && hasEvidence && score >= 55 && (industry OR buyer known)`. Everything else → `needs_verification` or `low_confidence`. When `brain.meta.confidence === "weak"` verified is downgraded to `needs_verification` + risk flag.
- Priority: `verified && >=82 urgent`, `verified && >=65 high`, `>=45 medium`, else low. UI shows Pace at score 60 with **priority=medium** because `industryKnown` is false but `buyerKnown=true`, so it clears the 55 gate.
- Disqualifiers behave as **hard reject** (not just score reduction). But only if the brain actually lists the offending industry — the goji brain lists none, and `DEFAULT_DISQUALIFIERS` misses analytical services / pharma / staffing.

Why Fit 60 was enough to show Pace: no disqualifier hit + hasSourceUrl + hasEvidence + buyer_known → verification=`verified`, priority=`medium`. The UI shows verified/medium items in "Top signals".

Recommendations (design only): raise verified threshold to 65; require `industryKnown` (not either/or) for verified; hard-reject when business_model is set and target doesn't match; cap at `needs_verification` when brain confidence isn't `strong`; add explicit penalty for size out of band; add "bad-fit reason" surfaced from which disqualifier bucket almost hit.

## 9. UI / filter audit

- `src/pages/Signals.tsx` mounts `useSignalFeed`; `useSignalReviews` powers verified/needs_verification/ignored/reviewed filters. 76 saved rows exist for goji but "Top signal" shows 1 because legacy rows lack `raw.signal_score` / `raw.verification_status` (Commit 4A hadn't run when they were saved), so the UI grouping defaults them to "needs_verification" and hides them behind the toggle.
- "Hide ignored" filters `raw.status === 'ignored'`; "Show unverified" toggles `raw.signal_quality === 'needs_verification'` items. Low-confidence signals are hidden by default. Verified signals with score >=55 show as top card even when ICP score = 0.
- Recommended (design only): tabs `Verified fit` / `Needs review` / `Rejected`; per-signal "why rejected" chip; ICP-fit sub-badge separate from Signal-fit; "bad-fit reason" pulled from `disqualifiers_hit` or "no ICP match"; block anything below ICP-fit 10 from showing in top.

## 10. Root-cause verdict

All of the following apply, with evidence:
- **Company Brain too broad / empty** — goji `icp.*` is empty; compiler and default constants carry the load.
- **Onboarding missing disqualifier questions** — no separate industry/keyword/domain buckets; no positive/negative examples; no must-have vs nice-to-have.
- **ICP stored as partly loose text** — `positioning` and `brand_voice` were written as raw strings and stored as char-indexed objects (see §1).
- **Query generation too broad** — LinkedIn Jobs URL has only role keyword + location; no must-have SaaS/industry filter; disqualifiers not injected pre-fetch.
- **Scoring threshold too low** — verified at 55 with buyer-only match; medium priority even without industry match.
- **Disqualifiers not strong enough** — `DEFAULT_DISQUALIFIERS` misses pharma, chemicals, packaging, analytical/lab services, staffing/recruiting.
- **UI surfaces weak signals too prominently** — legacy rows without scoring fields land in the same feed; verified/medium shows in top.
- **Old defaults leak** — SAAS_POSITIVE_CATEGORIES/SAAS_HIRING_TRIGGERS get injected any time description regex matches, even when the founder never confirmed the ICP.
- **Missing good-fit/bad-fit examples** — schema has no field for them.
- **Missing funding/size requirements** — schema has size string only; funding stage of target customers isn't a field.
- Recruiting/screening legacy defaults themselves are **not** leaking into Radar; Radar uses only `compileCompanyBrainContext`. But Leads/Content code paths still call the older `deriveCompanyIcp` (duplicate logic).

## 11. Recommended Company Brain v2 (design only — not implemented)

```json
{
  "target_customer": {
    "industries": ["B2B SaaS", "AI SaaS"],
    "business_models": ["b2b_saas", "ai_saas"],
    "company_size": { "min": 5, "max": 200, "label": "5-200 employees" },
    "funding_stage": ["pre-seed", "seed", "series_a"],
    "geography": ["United States", "Canada", "United Kingdom"],
    "must_have": ["ships software product", "recurring revenue", "has GTM team"],
    "nice_to_have": ["recently funded", "hiring GTM roles"],
    "disqualifiers": {
      "industries": ["pharma", "chemicals", "packaging", "analytical services", "lab testing", "manufacturing", "staffing", "recruiting agency", "professional services"],
      "company_types": ["agency", "consultancy", "reseller"],
      "domains": [],
      "keywords": ["environmental testing", "laboratory services", "commercial analytics"],
      "titles": ["Plant Manager", "Facilities Manager", "Field Operations Manager", "Warehouse Manager"]
    }
  },
  "buyer_personas": [
    { "title": "Founder / CEO", "seniority": "founder", "department": "executive", "role_keywords": ["founder", "ceo", "co-founder"] },
    { "title": "Head of GTM / Revenue", "seniority": "leadership", "department": "revenue", "role_keywords": ["head of growth", "head of revenue", "vp sales"] },
    { "title": "RevOps / Sales Ops", "seniority": "ic/manager", "department": "revenue", "role_keywords": ["revops", "revenue operations", "sales operations"] },
    { "title": "SDR / AE / Growth", "seniority": "ic", "department": "sales", "role_keywords": ["sdr", "bdr", "account executive", "growth lead"] }
  ],
  "triggers": [
    { "type": "hiring", "roles": ["Founding AE", "SDR", "RevOps", "Growth Lead"], "min_evidence": "job_posting_url" },
    { "type": "funding", "rounds": ["Seed", "Series A"], "min_evidence": "article_url_and_amount" },
    { "type": "tool_adoption", "tools": ["Clay", "Apollo", "HubSpot"] }
  ],
  "jobs_to_watch": ["Founding AE", "Founding SDR", "RevOps Lead", "Head of Growth"],
  "competitors": [{ "name": "Clay", "type": "direct" }, { "name": "Apollo", "type": "adjacent" }],
  "tools": ["HubSpot", "Salesforce", "Clay", "Apollo"],
  "pain_points": ["outbound doesn't convert", "no RevOps hire yet", "manual list building"],
  "negative_examples": [
    { "name": "Pace Analytical Services", "reason": "lab testing / analytical services" },
    { "name": "Any Fortune 500 pharma", "reason": "too large + wrong industry" }
  ],
  "positive_examples": [
    { "name": "Nudge AI", "reason": "AI SaaS + hiring Founding Growth Lead" }
  ],
  "content_angles": ["founder-led outbound", "AI SDR done right", "RevOps for pre-Series A"],
  "qualification_rules": {
    "required_evidence": ["source_url", "company_identity", "industry_match_or_business_model"],
    "reject_if": ["disqualifier_industry_hit", "recruiter_proxy", "company_size_out_of_band_by_10x"],
    "manual_review_if": ["brain_confidence != strong", "score < 65", "no industry evidence"]
  }
}
```

Companion changes needed later (not part of this audit):
- Onboarding form must write structured objects, not raw strings, for positioning/brand_voice.
- Radar query builders must inject must-have + disqualifier tokens **pre-fetch** for providers that support it, and fall back to post-scoring for those that don't.
- Add `DEFAULT_DISQUALIFIERS` entries for pharma, chemicals, packaging, analytical services, lab testing, staffing, recruiting.
- Migrate legacy `signals` rows or hide legacy shape from the UI so old rows don't inflate "top signals".
- Unify Radar and Leads on `compileCompanyBrainContext`; deprecate `deriveCompanyIcp`.

---

### Backend audit verdict

- Company Brain data model: **workspace-scoped jsonb** with a documented schema, but current workspace has near-empty ICP and corrupted positioning/brand_voice strings.
- Onboarding sufficient to define strong ICP: **No.** Missing business model, target-customer funding stage, must-have vs nice-to-have, positive/negative examples, structured disqualifier buckets.
- ICP schema quality: **4 / 10.**
- Company Brain applied consistently across product: **No.** Radar uses `compileCompanyBrainContext`; Leads/Content use the older `deriveCompanyIcp`; agents & outreach only get whatever the caller passes.
- Pace-Analytical-style leak cause: brain has no `analytical services / lab / pharma` disqualifier + no industry must-have + verified threshold ≥55 clears on buyer-only match.
- Safe to keep running Radar as-is: **Yes for exploration, No for high-signal top feed.** Behaviour is honest (scores + warnings + verification statuses), but the top-signal card promotes buyer-only matches when ICP is empty.

No changes were made. Ready to plan Company Brain v2 + query/scoring hardening when you approve.
