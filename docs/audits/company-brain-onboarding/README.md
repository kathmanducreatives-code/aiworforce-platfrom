# Company Brain & Onboarding — architecture audit

**Baseline:** `launch/hardening` @ `8b0e2b6b` (PR #141, Q1–Q4 qualification foundation), audited 2026-10-22 on branch `audit/company-brain-onboarding`.
**Scope:** read-only. No product code, schema, data, deployment or provider call was changed or made.
**Unmerged work referenced, not modified:** `design/ui-polish` (frontend redesign, 5 commits), Codex `codex/p1…p6` (Outbound Outpost pilot), Claude Q1–Q4 qualification (merged in #141).

## How the evidence was gathered

| Kind | What | Notes |
|---|---|---|
| Source trace | Every reader and writer of `company_brain`, every prompt-assembly site, every brain helper's importers | File and line references throughout |
| Production metadata | `pg_policies`, `information_schema.triggers / columns / role_table_grants`, `pg_get_functiondef` on project `ohsdatpvfdjdemstoiuj` | **Schema only.** No table rows were read. |
| Offline tests | 32 existing Company Brain / onboarding test files: **368 passed, 0 failed** (`deno test`, no network) | Unit tests; they do **not** prove end-to-end behaviour |
| Offline probe | [`probe-divergence.ts`](probe-divergence.ts) drives the real production modules through onboarding-save → page-edit → prompt-assembly | Output in [Appendix A](#appendix-a--divergence-probe-output) |
| Rendered UI | Onboarding step 1 rendered from real components against fixtures (headless Chrome) | Later steps and phone width **unverified**: headless capture stalled the step transition |

**Labels used below:** **Confirmed** = traced in code and/or proven by probe or test. **Flag-gated** = real code behind an env flag whose production value could not be read (secrets). **Unverified** = not proven either way. **Proposed** = design, not built.

---

## 1. Executive summary

**Is Company Brain real and used?** Yes. It is one JSON document per workspace (`company_brain.profile`). It is read on every orchestrated agent run, every radar scan, every chat turn, by the outreach opener and by the Content writer. This is production behaviour, not mock data.

**Is it one shared intelligence, consistently applied?** No. There is one stored document but **three different readers that disagree about what it says**:

1. **The prompt block every `run-agent` call gets** (`renderCompanyBrainBlock`) builds its ICP and disqualifier lines from **legacy** keys (`profile.icp.*`, `who_we_sell_to`).
2. **The lead compiler** (`compileCompanyBrainContext`) merges the V2 fields **and** the legacy keys together.
3. **The UI** reads V2, falling back to legacy when V2 is empty.

Onboarding writes both shapes. The Company Brain page writes only V2. So **after a single edit on the Company Brain page, agents are told one ICP, lead search uses a union of the old and new ICP, and the page shows a third**. This is proven on the real modules in Appendix A.

**Is it learning from outcomes today?** No. Signal reviews, lead rejections, draft approvals and replies are persisted for display and gating. **None of them flows back into the brain or into future discovery.** There is no memory, outcome or brain-version table in production.

**Is onboarding connected end to end?** Mostly.
- **What works:** the six-step guided setup saves through a validated, origin-aware backend path and gates activation on five required slots. Website analysis is real Firecrawl when the key is present (flag-gated, unverified in production).
- **Progress:** in-progress state lives in `sessionStorage`, so it's lost across tabs and devices; the server copy only updates on "Save draft".
- **Gate:** until activation every product route redirects to onboarding.
- **Missing steps:** integrations, AI-employee configuration and a first mission are not part of the flow.

### Five most important fixes

1. **One write path.** Route every brain write (Company Brain page, Signals radar drawer, product tour, integration-readiness) through the existing origin-aware backend save. That save keeps the legacy mirror in sync, including clears, and guards against stale writes. Today only onboarding uses it. *(P0-1, P0-3)*
2. **One read projection.** Build the agent prompt block from the normalized V2 brain (the same canonical builder the compiler and the Codex P5 snapshot use), not from legacy `icp.*`. Must-haves, business models, funding stages, V2 disqualifiers and qualification rules currently never reach the generic agent prompt. *(P0-2)*
3. **Stop silent overwrites.** `integration-readiness` rewrites the whole profile **on every visit** to Content or Signals. Together with two other unguarded read-modify-write writers, this can silently revert a user's edit. *(P0-3)*
4. **Fix the target-size fallback in the backend.** The normalizer and compiler fall back to the seller's own `company.team_size` as the target company size. Radar then excludes companies over twice that number. *(P0-4; the frontend half is fixed on `design/ui-polish`.)*
5. **Make onboarding recoverable and one gate consistent.** Save progress to the server, not `sessionStorage`. Use one rule for "is the brain usable": today the prompt block withholds it until activation, while radar and the lead compiler use it immediately. *(P1-1, P1-2)*

### Build first

**Slice 1: "one write path, one read projection"** (§10). It is backend-small, reuses existing modules (`companyBrainOriginSave`, `applyBrainSave`, `normalizeCompanyBrain`, `missionContext.stripSecrets`), touches no qualification, pilot or worker files, and has a crisp acceptance test: the divergence probe returns the same answer in all three columns.

---

## 2. Current-state architecture

```
                         ┌──────────────────────── WRITES (5 paths) ───────────────────────────┐
 Onboarding (6 steps) ──▶ generate-company-brain-draft  save_draft / activate
                          · origin-aware (companyBrainOriginSave)  · applyBrainSave (V2 merge)
                          · legacy icp projection  · expected_updated_at stale check   ✅ canonical
 Company Brain page  ───▶ supabase.from('company_brain').update({profile})  shallow merge  ❌ no projection, no origin, no role check
 Signals ▸ Edit Radar ──▶ supabase.upsert({profile: cachedProfile + signal_preferences})    ❌ whole-profile from cache
 Product tour        ───▶ setup-company-brain save_structured  read-modify-write          ❌ no guard
 Content/Signals view ──▶ integration-readiness  read-modify-write (integration_status)    ❌ write-on-read, no guard
                         └───────────────────────────────────────┬──────────────────────────┘
                                                                  ▼
              ┌──────────────── public.company_brain (1 row / workspace, PK workspace_id) ────────────────┐
              │ profile jsonb  ← V2 (target_customer, buyer_personas, positioning, brand_voice,            │
              │                       qualification_rules, evidence, …) + legacy (icp, gtm, goals, …)       │
              │ legacy flat cols: company_name, what_we_do, who_we_sell_to, voice_and_tone, do_not_say      │
              │ onboarding_completed, onboarding_completed_at, updated_at (trigger), updated_by (unused)    │
              │ RLS: member select / insert / update via has_workspace_access (role-blind); no delete       │
              └───────────────┬───────────────────────────────┬───────────────────────────┬────────────────┘
       also: workspaces.company_brain text (legacy, unread)    │                           │
                              ▼                               ▼                           ▼
   renderCompanyBrainBlock (legacy icp.*)       compileCompanyBrainContext        buildSellerContext /
   gated on onboarding_completed                (V2 ∪ legacy; no gate)            renderContentBrain (gated)
        │                                             │                                 │
        ▼                                             ▼                                 ▼
   run-agent system prompt (all agents)   Lead path in run-agent, radar,      Outreach opener (Mira),
   pilot-chat context                      pilot-chat, Q1–Q4 evaluation        Content writer (Scribe→Orion)
                                           (missionEvaluation)
   orchestrate planner ◀── JSON.stringify(raw profile)  (unbounded, unfiltered, ungated)

   Results: accounts / contacts / lead_candidates / signals / saved_outputs (memoryWriter),
            outreach_drafts (with company_brain_updated_at), approvals, signal_reviews, content_item(+version)
            ──▶ none of these is read back into the brain or into future discovery planning
```

---

## 3. Phase 1 — what Company Brain holds, and how well each part works

### 3.1 Storage

| Item | Where | Evidence | Status |
|---|---|---|---|
| Brain document | `company_brain.profile` jsonb, PK `workspace_id` | baseline `migrations-held/20260816120000_baseline_schema.sql:1624`; production columns confirmed | **Fully functional** |
| Legacy flat columns | `company_name, what_we_do, who_we_sell_to, voice_and_tone, do_not_say, examples` | same; readers fall back to them **inside `profile`**, not the columns | **Legacy, unread as columns** |
| `workspaces.company_brain` text | `workspaces` | production columns; no code reader found | **Legacy, unread** |
| Activation | `onboarding_completed(_at)` columns | `generate-company-brain-draft/index.ts:462-466` | **Fully functional** |
| Version | `updated_at`, set by trigger `company_brain_set_updated_at` (BEFORE UPDATE → `now()`) | production trigger list | **Functional (single timestamp)** |
| History / versions | none | no table; `updated_by` exists but no writer sets it | **Not implemented** |
| Research log | `company_brain_research_runs` (member select only) | `generate-company-brain-draft/index.ts:185` | **Backend-only** (no UI reads it) |
| Brain-level evidence | `profile.evidence.{source_pages, linkedin_sources, confidence_notes}` | `normalizeCompanyBrain.ts` | **Partially functional** (brain-level, not per-field) |
| Per-field provenance | none persisted | no `provenance/field_origins` in save path | **Not implemented** |
| Documents / file uploads | none | no storage bucket or upload path for brain | **Not implemented** |

### 3.2 Fields: who can edit them, and who reads them

| Field group (V2) | Onboarding | Company Brain page (`launch/hardening`) | Agent prompt block | Lead compiler / Q1–Q4 | Radar | Opener / Content |
|---|---|---|---|---|---|---|
| Company identity | ✅ | drawer | ✅ name, description, stage, team, location | ✅ seller identity | — | ✅ |
| `target_customer.industries` | ✅ | drawer | ⚠️ **legacy `icp.industries` only** | ✅ (V2 ∪ legacy) | ✅ | — |
| business models, funding stage, geography, size | ✅ | drawer | ⚠️ only legacy `icp.geography/company_size` | ✅ | partial | — |
| `must_have` / `nice_to_have` | ✅ | drawer | ❌ only as a setup check | ✅ | ✅ must_have | — |
| V2 disqualifiers (industries / types / keywords / titles) | ✅ | drawer | ⚠️ only legacy `icp.disqualifiers` | ✅ | — | — |
| `qualification_rules` (required / review / reject) | ✅ | drawer | ❌ | ✅ via `buildMissionEvaluationInput` | — | — |
| buyer personas, pain points | ✅ | drawer | ✅ pain points; personas via legacy `buyer_roles` | ✅ | ✅ | ✅ |
| triggers, jobs to watch | ✅ | drawer | ✅ triggers; ❌ jobs | ✅ | ✅ | — |
| positioning (promise, differentiators, proof) | ✅ | drawer | ✅ | ✅ | — | ✅ |
| offer, pricing, use cases, avoid positioning | draft only | ❌ no control | ✅ offer, pricing, avoid | partial | pricing | ✅ |
| brand voice (tone, tags, style rules, avoid) | ✅ | drawer | ✅ tone, tags, avoid; ❌ style rules | — | — | ✅ |
| competitors, tools, positive examples, founder | draft only | ❌ no control | ✅ competitors, founder | ✅ | ✅ | ✅ |
| `signal_preferences` (industries / geos / competitors / keywords) | — | — (Signals drawer) | — | ✅ | ✅ | — |
| `gtm`, `goals` (legacy) | — (old onboarding) | ❌ | ✅ **still rendered** | — | — | — |
| `approval_rules`, `workflow_preferences` | — | ❌ | ✅ rendered | — | — | — |
| `integration_status` | written by integration-readiness | — | ✅ rendered | — | — | — |

- **Backend capabilities with no frontend control:** `approval_rules`, `workflow_preferences`, `gtm`, `goals`, `offer`, `pricing`, `use_cases`, `avoid_positioning`, `competitors`, `tools`, `founder`, `positive_examples`. `design/ui-polish` adds controls for the last eight.
- **Shown but not consumed by the generic agent prompt:** must-haves, business models, funding stages, V2 disqualifiers, qualification rules, jobs to watch, brand-voice style rules.

### 3.3 Missing, partial and contradictory context

| Situation | What happens | Evidence | Status |
|---|---|---|---|
| Brain not activated | Prompt block says "no active company brain… do not invent" | `companyBrainContext.ts:206` | Functional, but **inconsistent**: radar and the lead compiler still use the draft (`run-radar-scan` has no gate; `run-agent:2307` compiles regardless) |
| ICP incomplete | Prompt adds "Setup needed… draft low-confidence only" | `companyBrainContext.ts:121-123` | Functional |
| Field edited on the page | Prompt keeps the **old** legacy value; compiler **unions** old and new | Appendix A | **Broken** |
| Field cleared on the page | Old value persists in prompt and compiler, and **reappears** in the UI via fallback | Appendix A; `mergeLegacyIcpProjection` only writes non-empty | **Broken** |
| Seller team size, no target size | Used as the target size; radar treats it as a hard max | `_shared/normalizeCompanyBrain.ts:159`, `companyBrainCompiler.ts:223`, `radarIntel/hiringRoleFamily.ts:84` | **Broken** (frontend fixed on `design/ui-polish` 2f5396dc) |
| Contradictory seller identity | Save is rejected with `identity_conflict` (onboarding path only) | `generate-company-brain-draft/index.ts` save decision | Functional on one path |
| Outdated positioning in an old draft | Draft stores `company_brain_updated_at`; nothing compares it with the current brain | `leadActionExecutor.ts:540`, only displayed in `canonicalLeadView.ts:483` | **Partial** |

---

## 4. Phase 2 — agent-by-agent integration matrix

Agent names follow `src/config/agentRegistry.ts`: `scout→Lyra`, `aria/hawk→Atlas`, `penn→Mira`, `scribe→Orion`.
**Naming conflict:** the registry maps the **content writer** (`scribe`) to Orion, while the product brief describes Orion as **pipeline / mission coordination**, which in code is **Pilot** (`orchestrate`). This needs a product decision; until then "Orion" means two different things.

| Agent | Brain source at execution | When loaded | Fields that actually influence behaviour | Feedback / reuse | Status |
|---|---|---|---|---|---|
| **Lyra** (radar / signals) | `compileCompanyBrainContext` + `profile.signal_preferences` | per scan (`run-radar-scan`), no onboarding gate | industries, buyer personas, must-haves, positive examples, competitors, pain points, triggers, pricing; plus a separate `signal_preferences` list | `signal_reviews` written by UI, **never read** by radar; queries are deduped within a scan, not across scans | **Partially functional** |
| **Atlas** (leads / qualification) | run-agent lead path: `compileCompanyBrainContext` (`run-agent:2307`), `mergeCompanyBrainIntoMission`, Q1–Q4 `buildMissionEvaluationInput` with brain authority + `qualification_rules` (`leadCapabilityEngine:9392`) | per orchestrated run | ICP (V2 ∪ legacy), exclusions (resolved once), employee range, stages, locations, required-evidence / reject / review rules | evaluations persisted per run; rejections not reused next run | **Functional, with stale-union defect.** GPT mission compiler and Claude-first planner are **flag-gated** (`GPT_LEAD_MISSION_COMPILER*`, `CLAUDE_FIRST_LEAD_PLANNING` + allowlist) |
| **Mira** (outreach) | Opener: `buildSellerContext` + `brainContextFromProfile` (`openerBackend.ts`); generic drafting: `renderCompanyBrainBlock` | per draft | positioning, differentiators, proof, offer, pain points, brand voice, negative examples, prohibited claims | records brain version; **no stale check**; approvals gate sending but don't teach | **Functional (opener) / partial (generic)** |
| **Orion as content** (`scribe`) | `renderContentBrain` (gated) + last 10 `content_item` titles | per content run | positioning, proof, voice incl. style rules, competitors as "not us", founder, recent angles | recent content prevents repeats (**real reuse**) | **Functional** |
| **Pilot** (planning / coordination) | `orchestrate:831` loads the raw profile; prompt gets `JSON.stringify(companyBrain)` (`:1381`) **and** `compactCompanyBrain` (first ~1,200 chars by key order) | per plan | everything, unbounded and unfiltered, ungated | none | **Partially functional; unsafe projection** |
| **Pilot chat** | `pilot-chat`: compiler + `buildCompanyBrainContext`, `hasUsableBrain` gate | per turn | ICP, competitors, offer, positioning, triggers… | reads stored results via `readSurface` | **Functional** |

**Do agents share information?** Through the database, yes. `memoryWriter` persists accounts, contacts, lead candidates, signals and saved outputs that later chat turns and plans can read. They do **not** share a single, consistent view of the brain: §1 and Appendix A.

### 4.1 Dependency map

| Brain provides | Consumer | Loaded | Influences | Results saved to |
|---|---|---|---|---|
| ICP, exclusions, size, geography, rules | run-agent lead path → Q1–Q4 evaluator | each run | sourcing queries, eligibility, qualification verdicts | `lead_candidates`, task results, ledger |
| Identity + ICP summary (legacy) | run-agent system prompt (all agents) | each run, gated | tone, targeting language, "don't invent" guard | per agent output |
| Raw profile | orchestrate planner | each plan | which agents and steps run | `task_plans`, `tasks` |
| ICP + `signal_preferences` + competitors | radar | each scan | which signals are searched and kept | `signals` / `signal_events` |
| Seller context, voice, proof | outreach opener | each draft | message content and claims | `outreach_drafts` (+ brain version) |
| Positioning, voice, recent content | content writer | each draft | angle, format, claims | `content_item(+version)` |
| Activation flag | OnboardingGate, Auth redirect | each navigation | access to the product | — |

### 4.2 Where the brain should influence decisions but doesn't

- **Generic agent prompt:** ignores must-haves, business models, funding stage, V2 disqualifiers, qualification rules, jobs to watch and style rules.
- **Radar:** never learns from "ignored" signals.
- **Lead discovery:** doesn't exclude companies the user already rejected.
- **Drafts:** an old draft isn't flagged when positioning changes.
- **Planner:** doesn't use the bounded, secret-filtered `missionContext` built for exactly this ("A planner gets a projection, never a database row", `missionContext.ts`). It's used only behind the Claude-first planning flag.

---

## 5. Phase 3 — onboarding journey map

| # | Step | User sees | Frontend sends | Backend saves | Reaches AI? | Friction / risk |
|---|---|---|---|---|---|---|
| 1 | Sign up / sign in | `Auth.tsx` | Supabase Auth | workspace + empty brain row: trigger `on_auth_user_created` → `handle_new_user` → `provision_workspace_for_user` (baseline `:12036`, `:~819`) | — | Redirect reads `company_brain.onboarding_completed` with **no workspace filter** (`Auth.tsx:destinationForUser`, `.limit(1)`): multi-workspace users can be misrouted |
| 2 | Workspace | invisible | — | first membership resolved in `WorkspaceContext` | — | no choice of workspace (Codex P2 addresses this for pilot clients) |
| 3 | Goal (step 1/6) | name + one of four goals | in memory → `sessionStorage` | nothing until Save / Activate | `founder.first_help_goal` → prompt "wants:" | — |
| 4 | Company (2/6) | name, website, LinkedIn, description; **Analyze** | `research_company` | `company_brain_research_runs`; result held client-side | via draft | Real Firecrawl map+scrape **when `FIRECRAWL_API_KEY` is set (unverified in production)**; honest errors otherwise; local fixture mode refuses hosted projects |
| 5 | Founder research (optional) | LinkedIn + consent | `research_founder` (Apify) | research run | founder line in prompt | consent captured |
| 6 | Draft | AI draft of the brain | `draft` | research run; draft returned | — | — |
| 7 | Audience (3/6) | industries, models, size, geography, buyers, must-haves, disqualifiers | in memory | — | after activation | many fields at once |
| 8 | Signals (4/6) | triggers, jobs, rules | in memory | — | after activation | — |
| 9 | Review (5/6) | preview + completeness | — | — | — | — |
| 10 | Activate (6/6) | requires 5 slots | `activate` with `change_origin: onboarding_seller_confirmation` | `applyBrainSave`, legacy projection, `onboarding_completed=true`, `activity_feed` | ✅ | blocked reasons returned with editable suggestions (good) |
| — | Save draft (header) | "Saved in this tab" + **Save draft** | `save_draft` | profile (not activation) | no (gate) | autosave is **tab-only `sessionStorage`**; server copy only on click |
| 11 | Integrations | not in flow (allowed pre-onboarding at `/settings/integrations`) | — | — | — | "Setup needed: Apify/Firecrawl" first appears later on the dashboard |
| 12 | AI-employee configuration | not in flow | — | — | — | — |
| 13 | First mission / first result | dashboard checklist + product tour after activation | — | tour state via legacy `setup-company-brain` | — | value only after all five required slots |

- **Refresh mid-flow:** restored from `sessionStorage` in the same tab, clamped to steps 0–5.
- **New tab, device or closed browser:** progress lost unless "Save draft" was used.
- **Phone layout:** the shell is responsive (`max-w-[948px]`, `sm:` paddings); later steps were **not visually verified**.
- **Terminology:** "Company Brain", "Activate", "Signals" and "Disqualifiers" appear before the user has seen any agent work.

---

## 6. Phase 4 — data, memory and security

### 6.1 Data architecture

- **Ownership:** one brain per workspace (PK `workspace_id`). There is no client sub-tenant in the main product; the client sub-tenant is Codex P1/P2, unmerged and default-off.
- **RLS (production):** member SELECT, INSERT and UPDATE via `has_workspace_access(auth.uid(), workspace_id)`; no DELETE policy. `anon` holds a SELECT grant but no policy, so it gets no access. Confirmed.
- **Authorization granularity:** `has_workspace_access` checks membership only. **`workspace_members.role` (default `owner`) is ignored, so any member can rewrite the brain.** *(P1-5)*
- **API authorization:** every brain-reading edge function verifies the JWT, then membership (`run-agent:1140-1168`, `setup-company-brain:98-117`, `generate-company-brain-draft:153-168`, `run-radar-scan:217-240`, `integration-readiness:95-109`, `daily-brief:61-75`), or a verified service credential (`isServiceRoleBearer`). **No cross-workspace read path was found.**
- **Caching:** frontend has one React Query cache (`companyBrainKey`) shared by 26 consumers; writers invalidate it. Backend has no cache; the brain is read per request.
- **Versioning and concurrency:** a single `updated_at` (trigger). The canonical backend save supports `expected_updated_at`. The page, Signals drawer, product tour and integration-readiness writers do whole-profile read-modify-write with **no version check**. *(P0-3)*
- **Context size:** the prompt block is compact. The planner injects the **entire raw profile**: unbounded, including integration status and research artefacts. `missionContext` caps at 20,000 characters and strips secrets, but it's flag-gated. *(P1-3)*

### 6.2 Shared context

Seven assembly sites:
1. `renderCompanyBrainBlock`
2. `buildCompanyBrainContext`
3. `compileCompanyBrainContext` (+ `getCompiledCompanyBrainForWorkspace`)
4. `buildSellerContext`
5. `renderContentBrain`
6. `compactCompanyBrain`
7. raw `JSON.stringify` in `orchestrate`

They read different keys (legacy vs V2), apply different gates (activation vs none), and use different bounds. **Risk:** constraints missing from some agents (must-haves, rules), stale constraints in others (legacy ICP), and unnecessary or unsafe context in the planner.

### 6.3 Memory and learning

| Event | Persisted | Reused later? |
|---|---|---|
| Relevant company found | `accounts` / `lead_candidates` upsert (`memoryWriter`) | dedupe by name / LinkedIn only |
| Lead rejected | evaluation in run results | **No.** Not excluded from future runs. |
| Research corrected | only as a manual brain edit | via the brain (with the P0-1 defect) |
| Message generated | `outreach_drafts` + brain version | no stale check |
| Approval / rejection | `approvals.status` | gates the step; **not learned** |
| Signal reviewed / ignored | `signal_reviews` | **never read by radar** |
| Reply / business outcome | **no table** | — |
| Mission run again | fresh plan; content avoids recent angles | content only |

**Distinction between knowledge types:**
- **Company-provided vs AI-inferred:** decided at write time by `companyBrainOriginSave` (manual edits are authoritative; automated refresh may only fill empty fields), but **not stored per field**.
- **Third-party observations:** live in evidence and signal tables, separate from the brain.
- **Approved knowledge, historical outcomes, unverified assumptions:** not modelled.

### 6.4 Security and isolation

- **No cross-workspace leakage found** in the brain read and write paths (RLS plus per-function membership checks).
- **Risks:**
  - **Role-blind write authority.** *(P1-5)*
  - **Raw profile in planner prompts.** No secret filtering on that path. *(P1-3)*
  - **Write-on-read.** `integration-readiness` lets any member's page view rewrite the whole brain.
- **Codex pilot:** P1–P6 are stacked, unmerged and default-off (`OUTPOST_PILOT_*`, `VITE_OUTPOST_PILOT_CONTEXT_ENABLED`). P2 deliberately keeps the legacy `useCompanyBrain` out of the pilot surface, and P5 freezes the canonical brain with the existing helpers (`buildCanonicalCompanyBrain`, `buildSellerContext`, `resolveCanonicalSellerIdentity`). **Normal Company Brain access does not bypass pilot controls:** the pilot reads through its own scoped store. Nothing here was modified or integrated.

---

## 7. Missing functionality and disconnected UI

| Item | Kind | Evidence |
|---|---|---|
| Page edits don't reach the agent prompt; clears resurrect old values | Broken | Appendix A |
| Must-haves / rules / funding / models / V2 disqualifiers absent from prompt | Broken (silent) | §3.2 |
| `signal_preferences` duplicates industries, geographies and competitors | Duplication | `EditRadarDrawer.tsx:74`; radar reads both |
| `workspaces.company_brain`, flat columns | Dead legacy | no readers |
| `gtm`, `goals`, `approval_rules`, `workflow_preferences` | Backend-only (rendered in prompts, no UI) | `companyBrainContext.ts` |
| `company_brain_research_runs` | Backend-only | no UI reader |
| `updated_by` | Schema-only | no writer |
| Draft brain-version stamp | Display-only | no stale check |
| Signal reviews | UI-only effect | radar never reads them |
| Onboarding autosave | Tab-only | `sessionStorage` |
| Integrations / agent configuration / first mission in onboarding | Not implemented | `GuidedSetup` steps |
| Brain history / undo | Not implemented | — |
| Documents and source files | Not implemented | — |

---

## 8. Proposed Company Brain information architecture *(Proposed)*

The page should answer five questions: **what Agentory knows · how it knows it · which agents use it · what needs attention · what it has learned.**

`design/ui-polish` already implements the first three tabs. This extends them without adding a wall of cards.

```
┌ Company Brain ─────────────────────────────────────── [Edit] [History] ┐
│ ■ Northwind Analytics   northwind.example ↗          (6/6)  Active      │
│   "Board-ready revenue numbers in a day"              Strong evidence    │
├ Overview │ Customers │ Moments │ Qualification │ Voice │ Sources │ Usage ┤
│                                                                          │
│ OVERVIEW                                                                 │
│ ┌ Your ideal customer (editable sentence) ───────┐ ┌ Needs attention ──┐ │
│ │ We sell to [B2B SaaS] companies in [Fintech]…  │ │ • 2 fields inferred│ │
│ └────────────────────────────────────────────────┘ │ • Last edit 3d ago │ │
│ ┌ What your agents use ─────────────────────────┐  │ • Draft out of date│ │
│ │ Lyra  ICP · triggers · competitors     12 runs │  └───────────────────┘ │
│ │ Atlas ICP · rules · exclusions          8 runs │                       │
│ │ Mira  positioning · proof · voice       5 drafts│ ← real counts only    │
│ └────────────────────────────────────────────────┘                       │
│                                                                          │
│ SOURCES (secondary)   website pages · LinkedIn · uploads* · per field:   │
│                       "Confirmed by you" / "From northwind.example/pricing"│
│ USAGE  (secondary)    last 20 runs that read the brain + which version    │
│ HISTORY (drawer)      who changed what, when; restore a version*          │
│ LEARNED (P3)*         suggestions from rejections/approvals, each needing │
│                       approval before it changes the brain                │
└──────────────────────────────────────────────────────────────────────────┘
 * needs new backend work (see roadmap)
```

**Overview** holds the editable ICP sentence, the next fixes and "what agents use". **Secondary views** hold Sources, Usage and History. **Progressive disclosure** covers per-field provenance (shown on hover or in the editor) and learned suggestions (a queue, never auto-applied).

---

## 9. Proposed onboarding flow *(Proposed)*

**Target:** four screens and about 3 minutes to a first useful result. Everything else is completed later from the Company Brain page.

| # | Screen | Asks | Built from today | Needs new work |
|---|---|---|---|---|
| 1 | **Your company** | website URL (+ name) | `research_company` (Firecrawl), `draft` | — |
| 2 | **Here's what we found** | review the drafted identity, offer and positioning; fix in place; per field "from your site" vs "you confirmed" | draft + evidence (brain-level) | per-field provenance (P3) |
| 3 | **Who you sell to** | the ICP sentence (industries, size, geography, buyers) + one exclusion | Company Brain inline editors (ui-polish) | — |
| 4 | **Meet your team → first mission** | pick one of three missions pre-filled from the ICP; shows which brain fields each agent will use | orchestrate + existing missions; checklist | guided mission template; "fields used" preview |

**Collect now:** website, identity, ICP sentence, one exclusion.
**Defer to the Company Brain page:**
- triggers and jobs to watch
- qualification rules
- brand voice
- competitors
- founder
- examples

**Smart defaults vs approval:** drafted values stay **inferred** until the user confirms them. Agents may use them, but only as soft preferences.

**Progress and save-and-resume:**
- Server-side draft autosave on every step, using the existing `save_draft` path.
- Resume on any device; keep `sessionStorage` only as a fallback.

**Gate:** replace the hard all-routes redirect with "usable at screen 3". Activation becomes a badge, not a wall; the required slots stay for **outreach** (Mira), where wrong context is costly.

**States:**
- **Loading:** the analysis shows the pages read.
- **Error:** "We couldn't read the site — continue manually", which exists today.
- **Empty:** dashed slots, as on the new Company Brain page.

**Transition:** after the first mission, land on the dashboard with Workbench open on its results. The Company Brain overview then shows "Used by Atlas in 1 run".

---

## 10. Roadmap

Owners: **FE** = frontend (`design/ui-polish` lane) · **BE** = backend platform · **Q** = Claude qualification owner (Q1–Q4) · **CX** = Codex pilot owner.

### P0 — correctness and safety

**P0-1 · One write path for all brain edits**
- **Problem:** the Company Brain page writes V2 only, so agents see stale legacy ICP; clears resurrect old values.
- **Evidence:** Appendix A; `CompanyBrainDashboard.tsx:42`; `companyBrainV2Save.ts:101-104`; `normalizeCompanyBrain.ts:326`.
- **Impact:** agents target what the user removed.
- **Root cause:** the page bypasses `applyBrainSave` and the projection; the projection only writes non-empty values.
- **Fix:**
  - Add an `update` action to `generate-company-brain-draft` (origin `manual_edit`, `expected_updated_at`, preserves activation).
  - Make the projection mirror clears for edited paths.
  - Route the page and the Signals drawer through it.
- **Complexity:** M · **Depends on:** — · **Regression risk:** M (save semantics).
- **Accepts when:** the probe shows identical industries in all three columns after an edit and after a clear; a stale write returns 409.
- **Owner:** BE + FE.

**P0-2 · One read projection for agent prompts**
- **Problem:** `renderCompanyBrainBlock` reads legacy `icp.*`; V2 targeting fields never reach the prompt.
- **Evidence:** `companyBrainContext.ts:42-123`; probe "fields absent".
- **Impact:** agents ignore must-haves, rules and exclusions.
- **Fix:** build the block from `normalizeCompanyBrain(profile)` (or the canonical builder P5 uses), rendering all targeting fields; keep the honesty lines.
- **Complexity:** S–M · **Depends on:** — · **Regression risk:** M (prompt changes; content and opener are separate builders).
- **Accepts when:** a golden test shows every edited V2 field appears in the block; the existing 368 tests still pass.
- **Owner:** BE (coordinate with Q, since the evaluator inputs are unchanged).

**P0-3 · No silent overwrites**
- **Problem:** whole-profile read-modify-write in `integration-readiness` (on page view), `setup-company-brain`, and `EditRadarDrawer` (from cache).
- **Evidence:** `integration-readiness/index.ts:100-118`, `setup-company-brain/index.ts:120-134`, `EditRadarDrawer.tsx:70-76`; called by `useIntegrationReadiness` on Content and Signals.
- **Impact:** user edits can vanish without error.
- **Fix:** write a single key with a `jsonb_set`-style RPC, or stop writing on read; route the others through P0-1 with `expected_updated_at`.
- **Complexity:** S–M · **Depends on:** P0-1 · **Regression risk:** L.
- **Accepts when:** concurrent edit plus page view keeps both changes (integration test with mocked PostgREST).
- **Owner:** BE.

**P0-4 · Target size never falls back to seller headcount (backend)**
- **Evidence:** `_shared/normalizeCompanyBrain.ts:159`, `companyBrainCompiler.ts:223`, `hiringRoleFamily.ts:84`. Frontend fixed on ui-polish `2f5396dc`.
- **Impact:** radar drops companies over 2× the seller's own size.
- **Fix:** mirror the frontend rule (no `team_size` fallback; ignore persisted artifacts); prefer the explicit range over the label.
- **Complexity:** S · **Regression risk:** M (compiler is shared).
- **Accepts when:** tests cover the seller-24 / target-50–200 cases.
- **Owner:** **Q** (owns the compiler) with BE.

### P1 — core functionality

| ID | Problem | Fix | Cx | Owner |
|---|---|---|---|---|
| P1-1 | Onboarding progress tab-only (`sessionStorage`) | autosave a server draft each step via `save_draft`; restore from server first | S | FE+BE |
| P1-2 | Inconsistent "usable brain" gate: prompt gated, radar and lead compiler not; hard all-routes redirect | one `brainUsability(profile)` rule used by all; relax the route gate to "ICP present" | M | BE+FE |
| P1-3 | Planner injects raw profile (`orchestrate:1381`) | use `buildMissionContext` / `stripSecrets` projection (it exists) | S | BE |
| P1-4 | `Auth.tsx` destination ignores workspace | read via the resolved workspace / `useCompanyBrain` | S | FE |
| P1-5 | Role-blind brain writes | policy / RPC requiring `role in ('owner','admin','editor')`; read stays member | S (needs migration approval) | BE |
| P1-6 | Brain history | append-only `company_brain_versions` (profile, updated_by, origin) written by the P0-1 path; set `updated_by` | M (migration) | BE |
| P1-7 | Stale drafts | compare draft `company_brain_updated_at` with current; badge "written before positioning changed" | S | FE |
| P1-8 | `signal_preferences` duplicates ICP | treat as radar-only overrides with defaults from the brain; show the source in the drawer | S | FE+BE |

### P2 — experience

| ID | Item | Owner |
|---|---|---|
| P2-1 | Four-screen onboarding (§9) using existing research, draft and editors | FE |
| P2-2 | "What your agents use" + Usage view (real run counts that read the brain) | FE+BE |
| P2-3 | Integrations and first mission inside onboarding, with honest "needs Apify" states | FE |
| P2-4 | Resolve Orion naming (content vs coordination) across registry and copy | Product |
| P2-5 | Consistent empty, loading and error states across onboarding and brain (ui-polish patterns) | FE |

### P3 — future intelligence

| ID | Item | Notes |
|---|---|---|
| P3-1 | Per-field provenance (`company_provided / third_party / agent_inferred / approved`) stored alongside the profile | builds on `companyBrainOriginSave` |
| P3-2 | Learning queue: rejections, ignored signals and approvals become **suggested** brain changes, applied only via `approved_refresh_suggestions` | origin already exists |
| P3-3 | Radar reads `signal_reviews`; discovery excludes previously rejected companies | radar / lead owners |
| P3-4 | Outcome capture (replies, meetings) | needs a source integration |
| P3-5 | Reusable research evidence across missions | coordinate with CX P5 evidence packets |

### Overlaps and ownership

- **Claude Q1–Q4 (`missionEvaluation`, `leadMissionCompiler`, `companyBrainSemanticFit`):** not touched by Slice 1. P0-4 touches the shared compiler, so Q should own it.
- **Codex P1–P6:** Slice 1's read projection should be the **same canonical builder P5 snapshots** (`buildCanonicalCompanyBrain`), so frozen pilot packets and live agents agree. No pilot files are touched.
- **E01 / worker recovery:** untouched. The worker never reads the brain directly.
- **`design/ui-polish`:** its inline editors and version guard should switch to the P0-1 endpoint once it exists. Until then its writes have the same projection gap as `launch/hardening`.

---

## 11. Recommended first slice

**"One write path, one read projection."** Backend-first, with no schema migration:

1. **`update` action** in `generate-company-brain-draft`:
   - membership plus role check in code
   - `expected_updated_at` → 409 on a stale write
   - origin `manual_edit` through `companyBrainOriginSave`
   - `applyBrainSave` without changing activation
   - projection that mirrors clears for edited paths
   - returns `{profile, updated_at}`
2. **Route writers through it:** the Company Brain page (both drawer and inline editors) and the Signals radar drawer.
3. **Stop write-on-read:** `integration-readiness` writes only `integration_status`, guarded, or not at all.
4. **`renderCompanyBrainBlock`** builds from the normalized V2 brain.
5. **Golden test** from [`probe-divergence.ts`](probe-divergence.ts): edit and clear produce the same industries in UI, compiler and prompt; every V2 targeting field appears in the prompt.

**Measurable value:**
- An ICP edit takes effect in the next agent run, for every agent.
- A cleared exclusion stops excluding.
- No silent edit loss.

**Not in the slice:** onboarding redesign, history table, learning, qualification logic, pilot.

**Awaiting approval before any implementation.**

---

## Appendix A — divergence probe output

`deno run --allow-read --allow-env --no-check docs/audits/company-brain-onboarding/probe-divergence.ts "$(pwd)"`, real modules, no network:

```
after onboarding
  lead compiler industries : ["Fintech"]
  agent prompt ICP: CFO; Fintech; United Kingdom
  frontend normalizer reads: ["Fintech"]

after page edit → Logistics
  lead compiler industries : ["Logistics","Fintech"]
  agent prompt ICP: CFO; Fintech; United Kingdom
  frontend normalizer reads: ["Logistics"]

after page clears industries
  lead compiler industries : ["Fintech"]
  agent prompt ICP: CFO; Fintech; United Kingdom
  frontend normalizer reads: ["Fintech"]

fields absent from the agent prompt block even after onboarding:
  United Kingdom   in prompt? true
  Hiring RevOps    in prompt? false
  B2B SaaS         in prompt? false
```

## Appendix B — production metadata (schema only)

- **`company_brain` policies:** `company_brain_member_select` / `_insert` / `_update` → `has_workspace_access(auth.uid(), workspace_id)`; no delete policy.
- **`company_brain_research_runs`:** member select only.
- **Trigger:** `company_brain_set_updated_at` BEFORE UPDATE → `set_updated_at()` (`NEW.updated_at = now()`).
- **`has_workspace_access`:** `EXISTS (SELECT 1 FROM workspace_members WHERE user_id = _user_id AND workspace_id = _workspace_id)`, role not checked.
- **Grants:** `anon` SELECT/REFERENCES/TRIGGER (no policy, so no rows); `authenticated` CRUD (RLS-limited).
- **Memory-like tables present:** `approvals, signal_reviews, lead_evidence, company_web_evidence, signal_event_evidence, content_item_version, lead_plan_versions, company_headcount_snapshots, pricing_history`. **No** memory, outcome, feedback or brain-version table. `lead_evidence`, `company_web_evidence` and `signal_event_evidence` have **no code references** in this repository.

## Appendix C — corrections to earlier statements in this session

- I previously said no database trigger touches `company_brain`. **That was wrong:** `company_brain_set_updated_at` exists in production. The `design/ui-polish` version guard is unaffected, because it uses the `updated_at` returned by the update rather than its own stamp.
