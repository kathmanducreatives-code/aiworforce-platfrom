# Agentory — Full Software Audit & Current State

_Generated 2026-07-24. Scope: the Agentory codebase at `/Users/prasidha/screeningpilot/agentory-backend-safety-b`, canonical repo `kathmanducreatives-code/remix-of-remix-of-screeningpilot` (remote `remix`), branch `main`._

> **Reading guide.** This document distinguishes **proven** facts (verified against code, the database, or an executed run this session) from **planned/design** items (not yet built). Anything under "Proposed" or "Design" is not implemented.

---

## 0. TL;DR — what is going on right now

- **Product:** Agentory is an **approval-first AI workforce OS** for founders — it finds *who is worth contacting, why now, and what to say*, and the founder decides (Contact / Watch / Skip / Approve / Send). It is **not** an auto-sending AI SDR.
- **Immediate focus:** a **lead-quality benchmark** program to prove Agentory returns real, evidence-backed leads before building Signals/Content.
- **What just happened (this session, proven):**
  1. Built + merged a guarded, replayable benchmark harness (**PR #90**).
  2. Bootstrapped isolated TEST auth (QA user + workspace + brain), then executed **one real paid Apify sourcing run** through Agentory's live TEST backend. **Apify spend $0.00** (rental-billed actors), production untouched.
  3. **Baseline verdict = FAIL:** the fixed query returned **3 founder profiles of advisory/search firms** — 0 SaaS companies, 0 Sales-Ops hiring signals, 0 worth contacting. Agentory precision **0/3**; deterministic benchmark and Claude reviewer agreed.
  4. Refined via **replay only** (no new spend) and merged the evidence-backed quality fix (**PR #92**, now on `main`).
  5. Audited the **deeper root cause** (read-only): the founder query is mis-routed to a pure people-profile search that drops the "SaaS startups hiring Sales Operations" constraint.
- **Right now:** on branch `lead-quality-person-sourcing-intent-fix-v1` (no commits yet) with a completed read-only audit + design for the deep fix. **Awaiting go-ahead to implement**, which will need **one more authorized ~$3 TEST run** to validate.

---

## 1. Product overview

**Positioning:** _"Agentory helps founders build pipeline before adding payroll."_ It packages modern AI workflows into business playbooks run by specialized AI employees and reviewed by the founder.

**Core promise — answer three questions per opportunity:**
1. Who is worth contacting?
2. Why now?
3. What should we say?

**The AI workforce can** identify opportunities, detect buying signals, research companies, verify fit, find decision-makers, rank accounts, explain why-now, suggest an angle, generate review-ready outreach, recommend content, prepare reports. **The founder decides:** Contact / Watch / Skip / Approve / Edit / Send / Dismiss / Investigate.

**Agentory is NOT** an auto-SDR, lead scraper, chatbot, recruiting tool, or "replace your GTM team" automation. Value = better opportunities, stronger timing, better evidence, less wasted research, fewer poor leads, review-ready output — **not** more raw activity.

**Target customer:** founder-led B2B companies / small teams that need pipeline but aren't ready for a large GTM hire. Primary ICP has been B2B SaaS founders; the team is also testing less-crowded verticals (industrial automation / integrators). The product stays vertical-flexible via **Company Brain** + configurable qualification.

---

## 2. Architecture & tech stack

| Layer | Tech |
|---|---|
| Frontend | React + TypeScript + Vite, TanStack React Query, Tailwind-style utilities. Visual edits/publishing via **Lovable**. |
| Backend | **Supabase** — Postgres, Auth, **Edge Functions (Deno)**, RLS + workspace tenancy. Orchestration in `run-agent`. |
| Providers | **Apify** (jobs + people sourcing), **Firecrawl** (company/site enrichment), AI models (research/qualification/ranking/messaging). |
| Tooling | Claude Code, Supabase CLI, GitHub CLI, Supabase MCP, local Deno/TS test tooling. |

**Test toolchain reality:** there is **no Vitest** in the repo. Deno modules (`supabase/functions/**`, and the benchmark under `scripts/lead-quality-benchmark/`) are validated with **`deno test`** + `deno check`. App is validated with `npx tsc --noEmit` + `npm run build` (Vite). This document never calls the harness "Vitest."

---

## 3. Repository, environments, branches

- **Canonical repo:** `kathmanducreatives-code/remix-of-remix-of-screeningpilot` · remote `remix` · branch `main`.
- **Local worktree:** `/Users/prasidha/screeningpilot/agentory-backend-safety-b`.
- **Current `main` SHA:** `5719e3ac535e82c97812caae3f01365d55627557` (includes PR #90 and PR #92).
- **Production Supabase:** `wqnigjhcwjxtmordrwno` (agentory.space) — **forbidden** in all benchmark work.
- **TEST Supabase:** `zbwsbnqqpkvdhqwavjke` — all benchmark activity is here.
- **Unrelated project to never confuse:** `luvostyizefajbltukkc` (the locally-authenticated Supabase CLI is logged into *this*, not TEST — a repeated gotcha).
- **Supabase MCP** targets TEST (verified via `get_project_url`); it is a **data-plane** channel (SQL read/write, edge-function list/get/logs) — **no** Auth-Admin, secret management, or function-invoke.

**Branches of note (right now):**

| Branch | State | Notes |
|---|---|---|
| `main` @ `5719e3ac` | canonical | benchmark harness + quality fix merged |
| `lead-quality-person-sourcing-intent-fix-v1` | **current, 0 commits** | deep-fix branch; read-only audit done, no implementation |
| `premium-pipeline-overview-visual-polish` (**PR #91**, open) | **NOT ours** | Lovable Content/pipeline UI redesign — do not touch/merge |

**Recurring local modification to preserve:** `supabase/functions/mcp/index.ts` is modified in the working tree and must **never** be staged, discarded, or included in any PR. It has been preserved throughout.

---

## 4. Lead-sourcing pipeline (runtime chain — proven from code)

Entry: user query → **`orchestrate`** edge function (plans a multi-agent workflow, kicks off step 0) → **`run-agent`** edge function, tool **`source_with_apify`**.

Intended flow:
```
query → interpretation → Apify job/company sourcing → normalization → company verification
→ hiring-signal validation → company enrichment → founder/CEO discovery
→ current-employer verification → dedupe → qualification → ranking → why-now → angle → founder decision
```

**Actors (from `ACTOR_REGISTRY`):**
- Jobs/hiring: `curious_coder/linkedin-jobs-scraper` (key `apify_jobs`).
- People/founder: `harvestapi/linkedin-profile-search` (key `apify_people_search`).
- Company/site enrichment: Firecrawl + `apify/website-content-crawler`.

**Auth model (`run-agent`):** `verify_jwt: true`. Requires a genuine **user JWT**; membership resolved via `workspace_members(workspace_id, user_id)` using the service-role client (bypasses RLS). A service-role bearer is treated as a system call and is **not** used to impersonate users.

**Determinism principle:** hard facts (domains, title matching, location, dedupe, employer match, hard eligibility gates, evidence validity) should be deterministic code; **an AI score must never override a failed hard gate.**

---

## 5. The lead-quality benchmark (proven — merged PR #90)

A **TEST-only, budget-bounded, run-once, replayable** harness under `scripts/lead-quality-benchmark/` (Deno TS, `deno test`). It compares **three independent views** of the *same* candidate dataset:
1. **Agentory backend** ranking/decision (preserved verbatim);
2. **Deterministic benchmark** audit (hard gates + 0–100 score + verdict);
3. **Structured Claude reviewer** verdict.

**Fixed query (never paraphrased):** `Founders of SaaS startups hiring Sales Operations in the United States`.

### 5.1 Key modules
| File | Role |
|---|---|
| `env-guard.ts` | Refuses anything but TEST ref `zbwsbnqqpkvdhqwavjke`; blocks prod/unknown/missing-cred/unbounded before any request. |
| `budget.ts` | Upper-bound cost from bounded limits; **soft-stop $4.50 / hard-cap $5.00**; auto-shrinks limits to fit. |
| `run-lock.ts` | A live paid run happens **at most once** per run-id. |
| `redact.ts` | Secret-safe logging (never prints tokens/keys/JWT/cookies). |
| `normalize.ts` | Reuses real modules (`parseDomain`, `normalizeCountry`, `normalizeTerm`) + job-family classifier + dedupe keys. |
| `hard-gates.ts` | Six three-valued gates: company-type, hiring-signal, US, founder-role, current-employer, evidence. A **FAIL can never be CONTACT.** |
| `score.ts` / `verdict.ts` / `rank.ts` | 0–100 score tied to gates; CONTACT/WATCH/REJECT/NEEDS_REVIEW; deterministic ranking. |
| `why-now-audit.ts` / `outreach-angle-audit.ts` | Grounding checks (no drafts generated). |
| `harvest-live-run.ts` | Reads the real TEST run's persisted rows → benchmark schema → evaluation (offline). |
| `live-runner.ts` / `run.ts` | CLI (`dry-run` / `live` / `replay`); outreach allow-list throws on any send/campaign action. |

### 5.2 Bounded limits & budget (default)
25 raw results · 10 verified accounts · 8 founder lookups · 2 founders/account · 10 ranked. **Estimated max $2.93** (< $4.50 soft, < $5.00 hard).

### 5.3 Acceptance targets
100% current-employer match / valid hiring evidence / evidence URL among Contact leads; ≥90% US relevance; 0 duplicate accounts/people in top 10; 0 unsupported why-now; 0 off-company; 0 hard-gate failures ranked Contact; ≥4 of top 5 genuinely worth review.

**Tests:** 55 benchmark cases + reused `_shared` suites — all passing at `main`.

---

## 6. The live baseline run (proven — this session)

**Run id:** `lead-quality-sales-ops-us-20260724T113225Z` (artifacts under `artifacts/lead-quality-benchmark/…`, gitignored).

**Setup (authorized TEST bootstrap):** created QA user (Auth Admin), isolated QA workspace `11111111-2222-4333-8444-555555555555` with owner membership and an aligned Company Brain, obtained a **genuine user JWT** via public sign-in, invoked `orchestrate` → `run-agent` `source_with_apify`. TEST-only, prod-ref guarded on every request.

**Write boundary:** clean isolated workspace before/after; sourcing wrote only lead/account/task rows. **Production calls/writes = 0. Outreach generated/sent = 0. Migrations = 0.**

**Result — baseline verdict FAIL:**

| # | Surfaced "lead" | Reality | Benchmark verdict |
|---|---|---|---|
| 1 | Optivas **Advisors** — Kim Boothman (Founder & Principal) | management advisory firm, not SaaS | REJECT (`not_saas`) |
| 2 | Netsoft **Search** — Eric Thoreson (Principal Search Consultant) | executive-search/recruiting firm | REJECT (`not_saas`) |
| 3 | FairfieldWorks — Greg Buechler (Co-Founder) | no SaaS evidence, no hiring signal | NEEDS_REVIEW |

- **0 SaaS companies, 0 valid Sales-Ops hiring signals, 0 worth contacting.**
- Agentory precision **0/3**; deterministic benchmark and Claude reviewer agreed.
- **Model calls:** only Agentory's own planning/qualification. **Apify spend: $0.00** (harvestapi/curious_coder billed by monthly rental, not per-run).

---

## 7. The quality fix (proven — merged PR #92)

Refined **using replay only** against the cached baseline (no new Apify). Commits now on `main`:
- `fix(sourcing): reject non-product services firms by name and title` — strengthened the **real** module `leadMatchTier.detectRecruiterProxy` to catch search/advisory/consulting firms by company **name + title** (not just description).
- `fix(lead-quality): reject services-firm founders in the company gate` + benchmark hard-gate update.
- `test(lead-quality): add live-baseline harvest tool and services-firm regressions`.
- `review: guard services-firm rejection with software-product evidence` — **pre-merge review fix** for an over-rejection risk: split services terms into **STRONG** recruiter/search signals (reject regardless of an incidental "software" mention) vs **WEAK** advisory/consulting signals (reject **only** when there is no software-product evidence, protecting e.g. a real robo-advisory SaaS or a hosted-search product). Added over-rejection guard tests.

**Effect:** the two real services firms still REJECT; a legitimate SaaS with an advisory/search *product* is no longer rejected on a single token. **55 benchmark + 98 reused `_shared` tests pass; tsc + build clean.**

**PR #92 explicitly did NOT fix the primary sourcing-path defect** — that is the subject of Section 8.

---

## 8. Deeper root-cause audit (proven, read-only — current focus)

**Why the baseline was junk isn't just weak scoring — the wrong candidates were sourced.**

### 8.1 Where the query intent is lost
`supabase/functions/_shared/leadEntityIntent.ts` → `compileLeadEntityIntent`. Its precedence is **"any person noun → person"**. `PERSON_NOUN_RE` matches **"founders"**, so:

> `Founders of SaaS startups hiring Sales Operations in the United States` → **`target_entity: person`**

The query collapses to a **founder-profile search** plus a `roleKeywords` regex (`founder / sales / operations`). The compound company constraint — **"SaaS startups hiring Sales Operations"** — is never sourced as a company opportunity. `run-agent` (~L517) then force-routes to the **people actor** `apify_people_search` (per "plan da79cba3": signals never flip a person request to the jobs actor).

### 8.2 Where people bypass company gates
In `run-agent`'s `source_with_apify` person branch, the only persistence guard (~L1150) is an **artifact-type** check (actor output must match the entity). It does **not** require a verified target company. Person candidates persist with **no SaaS validation, no Sales-Ops hiring signal attached, `account_id = null`**. `leadMatchTier` / `leadQualityGate` only see the founder's self-reported company string, so a founder of "Optivas Advisors" passes; hard gates never run against a verified company + hiring opportunity.

**Net:** the people path runs as an **independent profile search** keyed on the word "founders," decoupled from any verified SaaS company that is actually hiring Sales Operations.

---

## 9. Proposed deep fix (DESIGN ONLY — not implemented)

**Corrected company-first flow for compound "founders of [company-type] hiring [role]" intents:**
```
fixed query
→ source relevant Sales/Revenue-Operations JOBS (apify_jobs)
→ validate US location
→ validate company is SaaS/software
→ dedupe companies
→ search founders FOR those verified companies only (apify_people_search, scoped)
→ verify founder is current
→ verify current employer matches the target company
→ attach the hiring evidence to the candidate
→ apply hard gates → qualify → rank
```

**Required invariants:** a person candidate cannot reach **Contact** without a linked **verified company opportunity** (company + Sales-Ops hiring evidence); SaaS validity required; US relevance required; founder current + employer match required; hiring evidence attached; failed hard gate not overridable by an AI score; agencies/recruiters/search firms cannot rank Contact; **generic AE/AM/SDR ≠ Sales Operations**; one account once, one person once; why-now must cite the actual hiring evidence. **No hardcoded company names.**

**Files likely to change:**
- `leadEntityIntent.ts` — add a compound "founders-of-companies" intent (or `company_gate_required` flag) instead of pure `person`.
- `run-agent/index.ts` — order jobs → verify → scoped-people; enforce the verified-company invariant before persistence.
- `leadQualityGate.ts` / `leadMatchTier.ts` — apply the company+role gate to person candidates; port a Sales-Ops-vs-generic role classifier (the benchmark's `classifyJobFamily` is the reference).
- People adapter / `runAgentCompanyEnrichment.ts` — scope people search to verified company names.

**Validation:** requires **one more authorized ~$2.93 TEST run** (soft $4.50 / hard $5.00, exactly one, no auto-retry) — the fix changes upstream candidate generation, so the original cached dataset (founder-profile output) cannot validate a company-first re-source.

---

## 10. Data model & known limitations

- **Two historical lead views:** Workbench (plan-scoped `lead_candidates`, state in `raw.agentory_workbench` JSONB, opener may live there) vs Lead Library (accounts/contacts/legacy `outreach_drafts`).
- **PR #84** added a canonical account-level Lead Library read model (one row per account across duplicate plan-scoped candidates; representative `selectedLeadCandidateId` + paired `selectedPlanId`; canonical research/recipient/outreach/CSV; orphan-draft rejection).
- **PR #85** — safe contact-to-account association (verified match may associate; null may attach; existing non-null must not be cleared; another account's contact not silently reassigned; ambiguous → needs_review).
- **PR #86** — real Lead Library actions (Research company, Find decision-makers) with single-flight controller + canonical-v1 invalidation.
- **PR #89** — promoted reconciled Lovable UI (≈38vw drawer, WorkforceDock) into main; a canonical **decision layer** unifies Contact/Watch/Skip/Needs-review + counters + sorting.
- **Longer-term limitations:** duplicate plan-scoped `lead_candidate` rows; no durable one-lead-per-workspace-account record; Workbench JSONB vs legacy drafts; historically null `contact.account_id`; thin source/evidence provenance; lists/tags historically frontend-only; incomplete unified activity timeline; integration states without fully connected channels. **These are deferred** behind lead-quality → Signals → Content.

---

## 11. Safety model (enforced this session)

- **TEST-only**, prod-ref (`wqnigjhcwjxtmordrwno`) guarded before every request; unknown project `luvostyizefajbltukkc` never used.
- **One paid Apify run**, hard cap $5.00, no auto-retry; refinements are replay-only.
- **No** production reads/writes, migrations, RLS changes, deploys, outreach generation/sending, campaigns, or contact-detail (phone/email) enrichment.
- **Secrets** are never printed/echoed/committed; credentials reported only as present/missing/valid/invalid. No `.env` committed. `supabase/functions/mcp/index.ts` preserved and excluded.
- **Approval-first outreach:** never auto-generate repeated drafts, replace a recipient, approve, send, or start a campaign; on refresh/retry failure, preserve the previous success. Historical recipient inconsistencies (e.g. Amy Zhu vs Kenneth Pouliot for Harmonic) must not be silently "repaired."

---

## 12. Current state summary & immediate next steps

| Item | State |
|---|---|
| `main` SHA | `5719e3ac` (PR #90 + PR #92 merged) |
| Benchmark harness | merged, 55 tests green |
| Live baseline | **run once**, verdict **FAIL** (0/3), $0.00 spend |
| Quality fix | merged (PR #92) — services-firm rejection, over-rejection-guarded |
| Deep root cause | audited (read-only); **not fixed** |
| Current branch | `lead-quality-person-sourcing-intent-fix-v1` (0 commits) |
| Open non-ours PR | #91 premium-pipeline UI (do not touch) |
| Production | untouched (0 calls/writes/migrations/outreach) |

**Recommended next step:** implement the deep fix starting with **`compileLeadEntityIntent`** — make a query carrying *both* a person noun and a company/hiring qualifier resolve to a **company-first compound intent** (`company_gate_required`), with unit tests, **before** touching `run-agent` ordering. Then wire company-first sourcing + the verified-company invariant, revalidate with **one** authorized paid TEST run, and open a quality-fix PR (do not merge/deploy).

**Roadmap position (revised):** (1) lead-quality benchmark ✅ · (2) refine via replay ✅ (partial; deep fix pending) · (3) merge/deploy quality fixes (merge ✅, deploy pending) · (4) one production sourcing smoke test · (5) Signals page · (6) Content page · (7) connect journey · (8) polish/QA · (9) launch-ready.

---

## 13. Session timeline (what was done, in order)

1. Built the guarded replayable benchmark harness + 48 tests → **PR #90**, merged.
2. Attempted the live run across several turns; documented hard blockers (no TEST control-plane creds; `run-agent` `verify_jwt`); requested exactly the missing secrets.
3. On receipt of a TEST secrets file + edge secret: validated service-role for TEST, bootstrapped QA user/workspace/brain, obtained a genuine JWT, and executed **one paid run** → baseline **FAIL (0/3)**.
4. Harvested the dataset, ran the 3-way comparison, refined via replay, opened **PR #92**.
5. Pre-merge review of PR #92 → found and fixed an over-rejection risk → merged (`5719e3ac`).
6. Created the deep-fix branch and completed a **read-only** root-cause audit (this document's Section 8–9). **No implementation, no second run** — awaiting go-ahead.

---

_This file is untracked working documentation. It is not part of any PR unless you explicitly add it._
