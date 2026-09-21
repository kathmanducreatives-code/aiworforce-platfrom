# Lead V2 — Current Process Diagram (as it actually runs today)

**Read-only map. No redesign, no fixes.** Describes the code deployed at `3f6b6d9b` (P0 live, 2026-09-15) and what two real runs did:

- **Live run `fd27bfac`** (queue `05a7fc3f`, 2026-09-15): the exact prompt *"Find 1 seed-stage B2B SaaS startup in the US hiring its first growth marketer."* — 2 slices, then cancelled. Ledger read with GETs only.
- **Audited run `1e52d43c`** (task `d9c2974f`, 2026-09-14): *"Find 3 seed-stage B2B SaaS startups in the US hiring their first growth marketer"* — 5 slices, all 33 Apify runs captured in `tests/fixtures/lead-v2/run-1e52d43c/`.

Line numbers are `file:line` at `3f6b6d9b`. No provider was called to produce this document.

### Legend (used by every diagram)

```mermaid
flowchart LR
  G(["GPT decision"]):::gpt
  C["Deterministic code"]:::code
  T[/"Provider-input transformation"/]:::xform
  P{{"Provider call (paid)"}}:::prov
  D[("Database / checkpoint")]:::db
  F["⚠ Current flaw"]:::flaw
  classDef gpt fill:#ede9fe,stroke:#7c3aed,color:#3b0764
  classDef code fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e
  classDef xform fill:#fef3c7,stroke:#d97706,color:#78350f
  classDef prov fill:#dcfce7,stroke:#16a34a,color:#14532d
  classDef db fill:#f1f5f9,stroke:#475569,color:#0f172a
  classDef flaw fill:#fee2e2,stroke:#dc2626,color:#7f1d1d,stroke-width:2px
```

---

## Summary

```
CURRENT PRIMARY DISCOVERY MODE:
  Company-first. For a startup hiring mission the only discovery source is the YC
  directory (memo23/y-combinator-scraper, "companies" mode, isHiring + embedded
  openJobs). Hiring is proven from the YC row's own openJobs; no job source is
  searched. Everything after discovery is per-company: name → LinkedIn identity →
  LinkedIn details → (job search, if needed) → web evidence → GPT evaluation.

WHY LINKEDIN COMPANY SEARCH RUNS:
  Every downstream stage (enrichment, job search, founders) is keyed on a LinkedIn
  company URL, and memo23 returns none (normalizer: linkedin_company_url = null,
  "absent_from_actor_schema"). So each shortlisted company is searched by NAME
  (domain deliberately never sent), with scraperMode "full" hardcoded so the rows
  carry a website, and accepted only if a row's website equals the YC website.
  The YC row already held name + website + YC slug + location for 24/24 searches;
  the search exists to buy a LinkedIn URL, not to learn who the company is.

HOW MANY PLANNER LAYERS CAN INFLUENCE THE RUN:
  12 live for V2 — 7 GPT (chat brain, mission compiler, execution planner,
  execution-plan amendment, discovery planner, mission triage, evidence
  planning/evaluation) + 5 deterministic (Company Brain merge, capability graph,
  strategy validation/compileActorInput, engine clamps + family guard, quota
  controller). 3 more stacks are loaded in run-agent but did not act in the V2
  runs audited (multi-round sourcing, lead strategist, deterministic V1 ladders).

WHERE IDENTITY IS LOST/REBUILT:
  Lost at normalization: memo23 → NormalizedHiringCompany keeps website and derives
  canonical_domain, but the YC slug/url and location are not used as identity keys,
  and there is no LinkedIn field. Rebuilt at company_identity_resolution by a
  name-only LinkedIn search + domain match. Lost again for 8/24 companies that
  already had a domain (0 rows, common-word names, domain variants) — they end
  identity_pending and never reach enrichment/hiring. Not reused across missions:
  fd27bfac re-searched the same 10 companies 1e52d43c resolved a day earlier.

WHERE INPUTS ARE REWRITTEN:
  (1) mission compiler + Company Brain merge (stage, size bound, industries);
  (2) GPT execution planner, then the GPT amendment REPLACES the discovery input
      each pass (fd27bfac slice 1 queries ["B2B SaaS","SaaS software"] min "1+";
      slice 2 no queries, role "marketing", min "5+");
  (3) compileActorInput overwrites maxItems with the execution quota;
  (4) memo23 size clamp, enrichEmails/scrapeOpenJobs forced;
  (5) buildIdentitySearchInput replaces the planner's identity input
      (maxItems 5 → 15, "full", locations added);
  (6) Apify fills unset defaults (batch "All Batches", industries "All industries").

WHERE DUPLICATE SPEND CAN HAPPEN:
  Each slice reopens discovery for replenishment and buys a NEW (rewritten)
  question; each new cohort buys one Company Search per shortlisted company;
  common-word names buy 15 "full" rows that match nothing; identity is reused only
  inside one lineage, so a new mission re-buys the same searches; Firecrawl is
  re-scraped per mission (cache is per intent/TTL).

BIGGEST CURRENT WORKFLOW FLAW:
  Retrieval is company-first and identity-by-name. The run buys a cohort that has
  not been shown to have the signal, then pays per company to rebuild an identity
  the source already half-held, then asks GPT late whether the company fits —
  with several planners able to change the question between slices.
```

---

## 1. Step-by-step: the exact current production path

| # | Step | Module / file | Responsibility | Input | Output | Called by | Owner |
|---|---|---|---|---|---|---|---|
| 1 | User text | `src/lib/pilotChat.ts:59` | invoke `pilot-chat` | `{message, workspace_id, conversation_id?}` | response + message row | Pilot overlay | — |
| 2 | Understand | `pilot-chat/index.ts:1938` `understandRequest` | route the request (`lead_mission`) | message | route + confidence | pilot-chat | **GPT** (chat brain, luna) — not ledgered |
| 3 | Mission compile | `pilot-chat:732/915` `buildMissionCompilerBinding` → `:354` `compileLeadMission` | propose, then validate/repair `LeadMissionV1` | prompt + Brain context + GPT proposal | mission: `required_signals [hiring, "hiring growth marketer"]`, role family `marketing_growth`, `company_profile.stages ["startup"]`, US, count 1 | `buildMissionForPrompt` (`:329`) | **GPT proposes, code decides** |
| 4 | Company Brain merge | `pilot-chat:360` `mergeCompanyBrainIntoMission` | fill open fields from workspace ICP | mission + `company_brain` | merged mission (industries, size bound 150 `brain_advisory`, founder-led) | same | code |
| 5 | Capability graph | `pilot-chat:~362`, `orchestrate:827`, `run-agent:~2177` `buildCapabilityGraph` | entry + schedule + allowed providers (P0 gate enforced for V2) | merged mission | `startup_company_discovery → company_identity_resolution → company_enrichment → hiring_verification → company_brain_qualification → persistence` | pilot-chat, orchestrate, run-agent | code |
| 6 | Preflight / preview | `pilot-chat:369` `buildPaidExecutionPreflight`, `:3102` `buildMissionPreview` | feasibility + first paid call dry run, card text | mission + graph | `workflow_confirmation` card ("~7 credits", "stage:seed (unsupported)") | pilot-chat | code |
| 7 | Start | `orchestrate:827` graph, `:~1706` `v2Route` | 1-step `task_plans` row, V1/V2 decision | approved mission | enqueue body | card "Start Workflow" | code |
| 8 | Enqueue | `enqueue-lead-mission/index.ts:52` | allowlist check, insert queue row | kickoff body | `lead_mission_queue` row (`queued`) | orchestrate | code |
| 9 | Worker slice | `worker/main.ts:103` claim, `:73` bind, `:59/68` `handleRunAgent` in-process, `:135` heartbeat 60s, `:190` release | own one 300 s slice | queue row | task run; release `resumable` / terminal | Railway loop | code |
| 10 | run-agent setup | `run-agent:~2177` graph, `:2742` run recovery, preflight, `:2990` `runCapabilityPlan` | restore lineage, gate spend, start engine | task + mission | engine run | worker | code |
| 11 | Execution planner | `run-agent:3082` `makeGptExecutionPlanner` → `gptExecutionPlanner.ts` | actor + full input JSON per step | graph + mission + catalog | execution plan (first slice only; restored after) | engine | **GPT** `execution_plan` |
| 12 | Discovery strategy | `leadCapabilityEngine.ts:4160` `plannedHere` | take the discovery input FROM the execution plan step | plan step input | strategy | engine | code (GPT-derived) |
| 12b | Discovery planner | `run-agent:3051` `makeGptDiscoveryPlanner` | only when the plan lacks discovery or on replan (`:4995`) | pool summary | new actor/input | engine | **GPT** `discovery_actor_selection` |
| 13 | Actor input compile | `leadDiscoveryStrategy.ts:562` validate, `:319` `compileActorInput` (`:378–386` maxItems), `clampMemo23MaxSize`, `memo23QueryFamily` (`engine:1093`), `hiringActorInputs.ts:326` `compileMemo23YcInput` | legal, bounded memo23 input | strategy + quota | memo23 INPUT | engine | code |
| 14 | YC discovery | `buildInvoker → toolRegistry.runTool("source_with_apify")` | run `memo23/y-combinator-scraper` | INPUT (fd27 slice 1 below) | 10 YC rows with `website`, `slug`, `url`, `allLocations`, `openJobs` | engine | **provider** |
| 15 | Normalize | `hiringActorNormalizers.ts:99` `normalizeMemo23Company`, `:142` `normalizeMemo23OpenJobs` | engine company shape | YC row | `company_name`, `website`, `canonical_domain`, **`linkedin_company_url: null`**, jobs | engine | code |
| 16 | Prequalification | `leadCommercialPrequalification.ts` (`classifyTitle`) | free title/commercial screen | companies + role vocabulary | exclusions `technical_only`, `insufficient_commercial` | engine | code |
| 17 | Triage / shortlist | `engine:3164` `ensureMissionIntelligence` | who gets paid identity | pool | `shortlisted` slice | identity stage | **GPT** `mission_triage` |
| 18 | Identity | `engine:5604` branch, `:1256` `buildIdentitySearchInput`, `companyIdentityResolution.ts:82` | buy a LinkedIn URL per company | shortlisted w/o LinkedIn URL | `identity` verified / ambiguous / unresolved | engine | code |
| 19 | Company Search | `harvestapi/linkedin-company-search` | name → candidate companies | `{searchQuery:name, scraperMode:"full", maxItems:15, locations:["United States"]}` | 0–15 full rows | identity stage | **provider** |
| 20 | Company Details | `engine:5954`, `harvestapi/linkedin-company` | authoritative size/industry/website | ≤5 LinkedIn URLs per call | enriched company | engine | **provider** |
| 21 | Web evidence | web-evidence runner, `webEvidenceStore` | fetch company pages the evaluator asked for | URLs from evidence plan | page text (cached) | evaluation | **GPT** `evidence_planning` picks, Firecrawl fetches |
| 22 | Hiring verification | `engine:6152`, skip via `chainSkips` (`:3871`) | prove hiring | identity-resolved companies | skipped when plan proves hiring from YC `openJobs` (fd27: `skipped_no_input`) else LinkedIn Job Search | engine | code (GPT plan decides skip) |
| 23 | Qualification | `engine:6612` + mission/pool evaluation | verdicts | enriched + evidence | pass / fail / insufficient_evidence | engine | **GPT** `mission_evaluation`, `pool_evaluation`, `grounded_evidence_evaluation` |
| 24 | Amendment | `engine:5252` | rewrite the whole plan after a discovery pass | results summary | new plan (incl. discovery input) | engine | **GPT** `execution_plan_amendment` |
| 25 | Persistence | `engine:8109`, `qualifiedLeadPersistence.ts`, run-agent `buildCheckpoint` (`:4781`) | write results + checkpoint | verdicts, state | `lead_candidates`, `tasks.result`, lineage state | engine / run-agent | code |
| 26 | Workbench | `LeadResultsView.tsx`, `src/lib/workbench/*` | show the run | `tasks.result` + `lead_candidates` | "No qualified leads yet · 10 discovered · 5 identity unresolved · counts disagree" (fd27) | browser | code |

---

## Diagram 1 — Full current Lead V2 end-to-end flow

```mermaid
flowchart TD
  subgraph PILOT["Pilot (edge: pilot-chat)"]
    U["User text"]:::code --> CB(["Chat brain: understandRequest<br/>route = lead_mission"]):::gpt
    CB --> MC(["Mission compiler: GPT proposal"]):::gpt
    MC --> MV["compileLeadMission<br/>validate + repair"]:::code
    MV --> BM["mergeCompanyBrainIntoMission<br/>ICP fills open fields"]:::code
    BM --> G1["buildCapabilityGraph (P0 gate)"]:::code
    G1 --> PF["Preflight dry run + preview card"]:::code
    PF --> MSG[("messages: workflow_confirmation")]:::db
  end
  MSG -->|"Start Workflow"| OR
  subgraph ORCH["orchestrate + enqueue"]
    OR["orchestrate: 1-step task_plans<br/>graph again, V2 route"]:::code --> TP[("task_plans")]:::db
    OR --> EQ["enqueue-lead-mission"]:::code --> Q[("lead_mission_queue: queued")]:::db
  end
  Q --> WK
  subgraph WORKER["Railway worker (300 s slice)"]
    WK["claim → bind → heartbeat 60 s"]:::code --> RA["run-agent handleRunAgent in-process"]:::code
    RA --> G2["graph again + preflight + run recovery"]:::code
    G2 --> EP(["GPT execution planner<br/>(slice 1 only)"]):::gpt
    EP --> ENG["runCapabilityPlan"]:::code
  end
  ENG --> DS["discovery strategy = plan step input"]:::code
  DS --> CI[/"validate → compileActorInput → clamps<br/>→ compileMemo23YcInput"/]:::xform
  CI --> YC{{"memo23 YC scraper"}}:::prov
  YC --> NZ["normalizeMemo23Company<br/>linkedin_company_url = null"]:::code
  NZ --> PQ["prequalification (free)"]:::code --> TR(["mission triage → shortlist"]):::gpt
  TR --> IDI[/"buildIdentitySearchInput<br/>name, full, 15, US"/]:::xform --> CS{{"LinkedIn Company Search<br/>1 call per company"}}:::prov
  CS --> RES["resolveIdentityAgainstLookups<br/>domain must match"]:::code
  RES -->|"verified"| CD{{"LinkedIn Company Details<br/>≤5 URLs/call"}}:::prov
  RES -->|"ambiguous / unresolved"| PEND["identity_pending (stops here)"]:::code
  CD --> EVP(["evidence planning"]):::gpt --> FC{{"Firecrawl pages"}}:::prov
  CD --> HV{"hiring_verification<br/>chainSkips?"}:::code
  HV -->|"plan proves hiring from YC openJobs"| SK["skipped_no_input"]:::code
  HV -->|"else"| JS{{"LinkedIn Job Search"}}:::prov
  FC --> EV(["mission / pool / grounded evaluation"]):::gpt
  SK --> EV
  JS --> EV
  EV --> AM(["execution-plan amendment<br/>rewrites plan incl. discovery input"]):::gpt
  EV --> PER["persistence + checkpoint"]:::code
  PER --> LC[("lead_candidates")]:::db
  PER --> TK[("tasks.result")]:::db
  PER --> LL[("lead_lineages.current_state")]:::db
  TK --> WB["Workbench"]:::code
  LC --> WB
  AM -.->|"next pass / next slice"| DS
  CS -.-> LEDG[("lead_execution_calls")]:::db
  YC -.-> LEDG
  CD -.-> LEDG
  FC -.-> LEDG
  classDef gpt fill:#ede9fe,stroke:#7c3aed,color:#3b0764
  classDef code fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e
  classDef xform fill:#fef3c7,stroke:#d97706,color:#78350f
  classDef prov fill:#dcfce7,stroke:#16a34a,color:#14532d
  classDef db fill:#f1f5f9,stroke:#475569,color:#0f172a
```

---

## Diagram 2 — Canonical hiring mission flow (live run `fd27bfac`)

Real values from the ledger. Times UTC, 2026-09-15.

```mermaid
flowchart TD
  P["'Find 1 seed-stage B2B SaaS startup in the US<br/>hiring its first growth marketer.'"]:::code
  P --> M["LeadMission: hiring 'hiring growth marketer'<br/>role family marketing_growth · stages [startup] · US · count 1<br/>gap: stage:seed (unsupported)"]:::code
  M --> GR["graph entry startup_company_discovery<br/>(stage = startup) — P0 gate: nothing blocked"]:::code
  GR --> EP(["execution plan (luna)"]):::gpt
  EP --> IN1[/"memo23 slice 1 INPUT<br/>queries ['B2B SaaS','SaaS software'] · regions [United States of America]<br/>industries [B2B] · batch [All Batches] · min '1+' · max '250'<br/>isHiring true · maxItems 10"/]:::xform
  IN1 --> YC1{{"10:50:25 memo23 → 10 YC companies"}}:::prov
  YC1 --> TRI(["triage → 10 shortlisted"]):::gpt
  TRI --> CSS{{"10:51:09–10:51:28 Company Search ×10<br/>Lab0 1 · Gojiberry AI 0 · SafetyKit 1 · PropelAuth 1 · Fuse AI 4<br/>Every 15 · Nango 0 · FurtherAI 1 · Streak 15 · Zentail 1"}}:::prov
  CSS --> IDR["identity: 5 resolved, 5 pending"]:::code
  IDR --> DET{{"10:51:44 Company Details (5 URLs)"}}:::prov
  DET --> FCS{{"10:52:47–10:53:04 Firecrawl ×3 homepages<br/>safetykit.com · fuseai.com · furtherai.com"}}:::prov
  DET --> HVS["hiring_verification: skipped_no_input<br/>3 hiring_verified from YC openJobs"]:::code
  FCS --> EVS(["evaluation: 3 technical_only, 3 insufficient_commercial<br/>0 qualified → PARTIALLY_SATISFIED"]):::gpt
  HVS --> EVS
  EVS --> AMD(["amendment rewrites discovery input"]):::gpt
  EVS --> CK[("checkpoint → queue resumable (attempt 1)")]:::db
  CK --> S2["slice 2 claimed 10:55:56"]:::code
  S2 --> IN2[/"memo23 slice 2 INPUT<br/>NO queries · role 'marketing' · min '5+' · max '250'<br/>industries [B2B] · batch [All Batches] · maxItems 10"/]:::xform
  AMD -.-> IN2
  IN2 --> YC2{{"10:56:01 memo23 → 10 new rows"}}:::prov
  YC2 --> CS2{{"10:56:46–10:56:55 Company Search ×5<br/>Deepgram 2 · SnapMagic 1 · Mux 6 · Tara AI 1 · OneSignal 1"}}:::prov
  CS2 --> DET2{{"10:57:09 Company Details (5 URLs)"}}:::prov
  DET2 --> CAN[("cancel_lead_mission (operator) · worker: lease lost")]:::db
  classDef gpt fill:#ede9fe,stroke:#7c3aed,color:#3b0764
  classDef code fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e
  classDef xform fill:#fef3c7,stroke:#d97706,color:#78350f
  classDef prov fill:#dcfce7,stroke:#16a34a,color:#14532d
  classDef db fill:#f1f5f9,stroke:#475569,color:#0f172a
```

Slice-1 totals: 1 discovery + 10 identity + 1 enrichment + 3 Firecrawl; 20 model calls. Whole run: 19 Apify runs, **$0.2711 billed** (ledger $0.0711).

---

## Diagram 3 — Startup-hiring actor chain (the variant this mission uses)

```mermaid
flowchart TD
  A1{{"DISCOVERY<br/>memo23/y-combinator-scraper<br/>companies mode · isHiring · scrapeOpenJobs true"}}:::prov
  A1 -->|"name, website, slug, url, allLocations,<br/>teamSize, batch, openJobs — no LinkedIn URL"| N1["normalize: canonical_domain from website<br/>openJobs → yc_open_jobs"]:::code
  N1 --> H0["free hiring evidence:<br/>openJobs title vs role vocabulary (classifyTitle)"]:::code
  N1 --> A2{{"IDENTITY<br/>harvestapi/linkedin-company-search<br/>searchQuery = company name"}}:::prov
  A2 --> R1["domain match → LinkedIn URL"]:::code
  R1 --> A3{{"ENRICHMENT<br/>harvestapi/linkedin-company<br/>employee count, industry, website"}}:::prov
  A3 --> V0{"VERIFICATION<br/>hiring_verification: chainSkips?"}:::code
  V0 -->|"yes: embedded openJobs accepted (live run)"| V1["skipped_no_input"]:::code
  V0 -->|"no evidence in the YC row"| A4{{"VERIFICATION<br/>harvestapi/linkedin-job-search<br/>company[] ≤10 URLs × jobTitles"}}:::prov
  A3 --> A5{{"EVIDENCE<br/>Firecrawl scrape (/, /about, /news)<br/>only if evaluation asks"}}:::prov
  H0 --> Q1(["qualification (GPT evaluation)"]):::gpt
  V1 --> Q1
  A4 --> Q1
  A5 --> Q1
  classDef gpt fill:#ede9fe,stroke:#7c3aed,color:#3b0764
  classDef code fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e
  classDef prov fill:#dcfce7,stroke:#16a34a,color:#14532d
```

Hiring proof here comes **before** identity (it is in the YC row), yet the pipeline still buys identity + enrichment for every shortlisted company before GPT decides fit.

---

## Diagram 4 — General-hiring actor chain (no startup wording)

Graph entry is `general_company_discovery` (`leadCapabilityGraph.ts` entry branches). No embedded jobs exist, so hiring must be bought per company.

```mermaid
flowchart TD
  B1{{"DISCOVERY<br/>harvestapi/linkedin-company-search<br/>concept query (e.g. 'B2B SaaS') + filters"}}:::prov
  B1 -->|"rows already carry linkedinUrl + website"| N2["normalizeLinkedInCompanyCandidate<br/>linkedin_company_url present"]:::code
  N2 --> R2["identity: source_supplied_canonical_linkedin_url<br/>(no extra search)"]:::code
  R2 --> B3{{"ENRICHMENT<br/>harvestapi/linkedin-company"}}:::prov
  B3 --> B4{{"VERIFICATION<br/>harvestapi/linkedin-job-search<br/>company[] ≤10 × hiringSearchTitles"}}:::prov
  B4 --> PF2["role post-filter (classifyTitle)<br/>+ employer check → verified / review / watch / not"]:::code
  PF2 --> B5{{"EVIDENCE<br/>Firecrawl if evaluation asks"}}:::prov
  B5 --> Q2(["qualification (GPT evaluation)"]):::gpt
  PF2 --> Q2
  classDef gpt fill:#ede9fe,stroke:#7c3aed,color:#3b0764
  classDef code fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e
  classDef prov fill:#dcfce7,stroke:#16a34a,color:#14532d
```

| | Startup hiring (memo23) | General hiring (LinkedIn search) |
|---|---|---|
| Discovery population | YC companies with `isHiring` | any LinkedIn company matching a concept |
| Hiring evidence at discovery | **yes** — `openJobs` in the row | **no** |
| LinkedIn URL at discovery | **no** → name search per company | **yes** → identity free |
| Paid hiring verification | usually skipped (`chainSkips`) | always (Job Search, fuzzy titles → post-filter) |
| Job-first discovery | not available (`job_discovery` not engine-driven; job-board actors have no V2 card) | same |

---

## Diagram 5 — Identity resolution / LinkedIn Company Search

```mermaid
flowchart TD
  S0["shortlisted company (from memo23)<br/>has: name, website → canonical_domain,<br/>YC slug + url, allLocations, openJobs<br/>lacks: LinkedIn URL"]:::code
  S0 --> Q0{"company.linkedin_company_url?"}:::code
  Q0 -->|"present (resume / other source)"| OK0["verified: source_supplied_canonical_linkedin_url"]:::code
  Q0 -->|"null — always, for memo23"| RS{"resume reuse?<br/>completed_operations / shouldSkipProviderCall<br/>(same lineage only)"}:::code
  RS -->|"already bought in this lineage"| OK1["restored identity, no call"]:::code
  RS -->|"no"| BI[/"buildIdentitySearchInput (engine:1256)<br/>searchQuery = normalizeCompanySearchName(name)<br/>scraperMode 'full' (hardcoded, :1080)<br/>maxItems 15 (hardcoded, :1055)<br/>locations = mission hard geography (:1219)<br/>domain: NEVER sent (expectedDomainFor)"/]:::xform
  BI --> CSX{{"harvestapi/linkedin-company-search<br/>e.g. {searchQuery:'Mux', scraperMode:'full',<br/>maxItems:15, locations:['United States'], startPage:1}"}}:::prov
  CSX --> LK["0–15 full rows: name, linkedinUrl, website, location"]:::code
  LK --> AL["acceptLinkedInMatch filter (prequal rules)"]:::code
  AL --> RIA["resolveIdentityAgainstLookups (companyIdentityResolution.ts:82)<br/>1 existing URL · 2 exactly one domain match<br/>3 one name match confirmed by domain · else ambiguous/unresolved"]:::code
  RIA -->|"verified_match"| EN["→ enrichment (Company Details)"]:::code
  RIA -->|"ambiguous / unresolved"| IP["identity_pending — terminal holding state,<br/>never retried, never enriched"]:::code
  classDef code fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e
  classDef xform fill:#fef3c7,stroke:#d97706,color:#78350f
  classDef prov fill:#dcfce7,stroke:#16a34a,color:#14532d
```

### What identity existed before each Company Search (`1e52d43c`, all 24 calls)

Source actor for every row: **memo23**. Every row had name, YC website, YC slug/url and YC `allLocations`; **none had a LinkedIn URL** (the actor has no such field).

| searchQuery | YC domain before | rows | exact-name rows | row with YC domain | Result |
|---|---|---|---|---|---|
| FurtherAI | furtherai.com | 1 | 1 | 1 | ✅ |
| Tara AI | tara.ai | 1 | 1 | 1 | ✅ |
| Uplane | uplane.com | 2 | 2 | 1 | ✅ |
| Zentail | zentail.com | 1 | 1 | 1 | ✅ |
| Gemnote | gemnote.com | 1 | 1 | 1 | ✅ |
| SafetyKit | safetykit.com | 1 | 1 | 1 | ✅ |
| Pasito | pasito.ai | 3 | 1 | 1 | ✅ |
| 10x Science | 10xscience.com | 15 | 0 | 1 | ✅ (by domain, rank >1) |
| Mason | bymason.com | 15 | 3 | 1 | ✅ (by domain) |
| Semble | sembleai.com | 4 | 3 | 1 | ✅ |
| SnapMagic | snapmagic.com | 1 | 1 | 1 | ✅ |
| Hyperspell | hyperspell.com | 1 | 1 | 1 | ✅ |
| Fuse AI | fuseai.com | 4 | 2 | 1 | ✅ |
| ShipBob | shipbob.com | 1 | 1 | 1 | ✅ |
| Every | every.io | 15 | 2 | 1 | ✅ (rank 6) |
| PropelAuth | propelauth.com | 1 | 1 | 1 | ✅ |
| Nango | nango.dev | **0** | 0 | 0 | ❌ no candidates |
| Gojiberry AI | gojiberry.ai | **0** | 0 | 0 | ❌ no candidates |
| Streak | streak.com | 15 | 0 | 0 | ❌ common word |
| Moss | moss.dev | 15 | 4 | 0 | ❌ common word |
| Lab0 | lab0.ai | 1 | 1 | 0 | ❌ domain mismatch (lab0.com) |
| Manicule | manicule.com | 1 | 0 | 0 | ❌ domain mismatch (manicule.dev) |
| Tasklet | tasklet.ai | 2 | 1 | 0 | ❌ name without domain |
| Nixo | withnixo.com | 2 | 1 | 0 | ❌ name without domain |

**16 / 24 resolved — exactly the 16 whose results contained the YC domain.** The other 8 already had a domain and were lost anyway.

### Answers

| Question | Answer (current code) |
|---|---|
| Was Company Search necessary? | **Only to obtain a LinkedIn URL.** The company's existence, name, website, location and hiring evidence were already in the YC row. It is necessary *because* enrichment (`harvestapi/linkedin-company`), Job Search (`company[]` of LinkedIn URLs) and founders are keyed on the LinkedIn URL. |
| Used because identity was incomplete? | Yes, in the narrow sense: the one missing field is `linkedin_company_url` (`normalizeMemo23Company` sets it `null`, `"absent_from_actor_schema"`). Name + domain were complete. |
| Used because the resolver requires domain/LinkedIn proof? | **Yes.** A bare name never resolves (`resolveIdentityAgainstLookups` rule 3 needs domain confirmation). That is also why `scraperMode` is hardcoded to `full` (short rows have no website) — every search costs full-row price. |
| Did the upstream actor already contain a usable identity field that was ignored? | **Partly.** The YC `website` is used only to *verify* results, never as the *retrieval key* (`expectedDomainFor`: "Never sent to the Actor"). The YC `slug`/`url` and `allLocations` are not used at all. There was no upstream LinkedIn field to use. |
| Why does it run repeatedly? | One search per shortlisted company, **per new cohort**. Each slice reopens discovery (`engine:3983`) with an amended question → new companies → new searches. Reuse is lineage-scoped only, so `fd27bfac` re-bought the **same 10 searches, same inputs** that `1e52d43c` bought the day before (Lab0, Gojiberry AI, SafetyKit, PropelAuth, Fuse AI, Every, Nango, FurtherAI, Streak, Zentail). |

---

## Diagram 6 — Planner ownership

```mermaid
flowchart LR
  subgraph LIVEGPT["Live for V2 — GPT"]
    CBR(["chat brain (pilot-chat)"]):::gpt
    MCP(["mission compiler proposal"]):::gpt
    EXP(["execution planner — slice 1"]):::gpt
    AMP(["execution-plan amendment — every pass"]):::gpt
    DSP(["discovery planner — replan only"]):::gpt
    TRP(["mission triage — shortlist"]):::gpt
    EVL(["evidence planning + mission/pool/grounded evaluation"]):::gpt
  end
  subgraph LIVECODE["Live for V2 — deterministic"]
    BMC["Company Brain merge"]:::code
    GRC["capability graph (+P0 gate)"]:::code
    VAL["validateDiscoveryStrategy + compileActorInput"]:::code
    CLP["engine clamps + family guard + identity input builder"]:::code
    QTA["quota controller: maxCandidates, admitted target,<br/>replan threshold, replenishment reopen, time capacity"]:::code
  end
  subgraph LOADED["Loaded in run-agent, not acting in audited V2 runs"]
    MRS["multi-round sourcing (if multiRoundBinding.enabled)"]:::code
    STR(["lead strategist (GPT_LEAD_STRATEGY)"]):::gpt
    LAD["deterministic ladders / V1 hiring routes"]:::code
    ILP["intelligence/leads planner-owner labels"]:::code
  end
  QRY["QUERY"]:::xform
  ACT["ACTOR"]:::xform
  INP["PROVIDER INPUT"]:::xform
  FBK["FALLBACK"]:::xform
  CNT["CONTINUATION"]:::xform
  MCP --> QRY
  BMC --> QRY
  EXP --> ACT
  EXP --> INP
  AMP --> QRY
  AMP --> ACT
  AMP --> INP
  DSP --> ACT
  DSP --> INP
  DSP --> FBK
  GRC --> ACT
  VAL --> INP
  CLP --> INP
  QTA --> INP
  QTA --> FBK
  QTA --> CNT
  TRP --> CNT
  EVL --> FBK
  EVL --> CNT
  CBR --> QRY
  MRS -.-> QRY
  STR -.-> QRY
  LAD -.-> FBK
  ILP -.-> ACT
  classDef gpt fill:#ede9fe,stroke:#7c3aed,color:#3b0764
  classDef code fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e
  classDef xform fill:#fef3c7,stroke:#d97706,color:#78350f
```

| Layer | Live for V2? | Can change | Evidence |
|---|---|---|---|
| Chat brain (GPT) | yes | route only | pilot-chat `:1938` |
| Mission compiler (GPT + code) | yes | signals, roles, stage, geography, hard constraints | pilot-chat `:354` |
| Company Brain merge | yes | industries, size bound, stage defaults | pilot-chat `:360` |
| Capability graph | yes | entry, allowed providers, schedule | `buildCapabilityGraph` |
| Execution planner (GPT) | yes, slice 1 | actor + full input | `run-agent:3082`; restored from checkpoint later |
| Amendment (GPT) | **yes, every pass** | whole plan incl. discovery input | `engine:5252`; fd27 slice 2 input changed |
| Discovery planner (GPT) | only replan / plan without discovery | actor + input | `engine:4160`, `:4995`; ran 2× in `1e52d43c` |
| Strategy validation / compile | yes | drops, defaults, `maxItems` | `leadDiscoveryStrategy.ts:319/562` |
| Engine clamps / identity builder | yes | size enum, forced fields, identity input | `clampMemo23MaxSize`, `:1256` |
| Quota controller | yes | cohort size, reopen, replan, stop | run-agent quota, `engine:4380/4995/3983` |
| Triage (GPT) | yes | who gets paid identity | `engine:3164` |
| Evaluation (GPT) | yes | verdicts; triggers Firecrawl and amendment input | model roles in ledger |
| Multi-round sourcing | loaded | re-runs engine with round plans | `run-agent:~3965`, flag-gated |
| Lead strategist (GPT) | loaded | title broadening between rounds | `leadStrategy/*`, flag-gated |
| Deterministic ladders | V1 routes | fallbacks | `executeRunAgentCompanyFirstSourcing` `run-agent:5486` |
| Planner-owner labels | yes (label only) | ledger `planner_owner` | every fd27 provider row says `deterministic_registry_v1 / selected_directly` although GPT planned the chain |

---

## Diagram 7 — Provider-input mutation path

```mermaid
flowchart TD
  UQ["user: seed-stage · B2B SaaS · US · hiring · first growth marketer · 1"]:::code
  UQ --> MC1(["compiler: signal hiring 'hiring growth marketer',<br/>role family marketing_growth, stage 'startup' (seed → gap)"]):::gpt
  MC1 --> BR1["Brain merge: size bound 150 (brain_advisory), industries"]:::code
  BR1 --> EP1(["execution planner: memo23 input JSON<br/>+ identity step {searchQuery:'{{candidate.name}}', maxItems 5, full}"]):::gpt
  EP1 --> AM1(["amendment: REPLACES discovery input each pass<br/>queries added / removed, min size 1+ ↔ 5+, role added"]):::gpt
  AM1 --> VD[/"validateDiscoveryStrategy: drop unknown filters, default role"/]:::xform
  VD --> CA[/"compileActorInput: enum/limit drop, arrays truncated,<br/>maxItems := maxCandidates from EXECUTION quota (10)"/]:::xform
  CA --> CL[/"clampMemo23MaxSize: 150 → '250' enum<br/>family guard: identical question skipped"/]:::xform
  CL --> C23[/"compileMemo23YcInput: enrichEmails false,<br/>scrapeOpenJobs true, scrapeFounderDetails false"/]:::xform
  C23 --> AD[/"Apify defaults: batch 'All Batches', industries 'All industries',<br/>location '', proxy, concurrency"/]:::xform
  AD --> YCX{{"memo23 run"}}:::prov
  YCX --> NN["normalize: name, website→domain, LinkedIn null"]:::code
  NN --> ID1[/"buildIdentitySearchInput REPLACES planner step:<br/>searchQuery = cleaned name · maxItems 5→15 ·<br/>scraperMode full · locations ['United States'] added"/]:::xform
  ID1 --> CSY{{"Company Search run"}}:::prov
  CSY --> URL["LinkedIn URL (if domain matched)"]:::code
  URL --> DT[/"Company Details: companies[] batched ≤5"/]:::xform
  DT --> CDY{{"Company Details run"}}:::prov
  URL --> JT[/"Job Search: company[] ≤10 × hiringSearchTitles(role_vocabulary)"/]:::xform
  JT --> JSY{{"Job Search run (when not skipped)"}}:::prov
  classDef gpt fill:#ede9fe,stroke:#7c3aed,color:#3b0764
  classDef code fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e
  classDef xform fill:#fef3c7,stroke:#d97706,color:#78350f
  classDef prov fill:#dcfce7,stroke:#16a34a,color:#14532d
```

| Field | Introduced | Rewritten / clamped / replaced |
|---|---|---|
| `queries` | execution planner | amendment each pass (fd27: `["B2B SaaS","SaaS software"]` → none; 1e52d43c: 5 versions incl. `[]`) |
| `industries` | Brain merge / planner | amendment may drop → Apify default `"All industries"` |
| `regions` / location | compiler (US hard) | memo23 `regions ["United States of America"]`; identity `locations ["United States"]` added by code |
| employee bounds | Brain merge (150) | `clampMemo23MaxSize` → `"250"`; min `1+`/`5+` flips per amendment |
| `maxItems` | planner | `compileActorInput` → execution quota (10); identity → 15 hardcoded |
| `role` | compiler role family | amendment adds/removes `"marketing"` (fd27 slice 2) |
| hiring signal | compiler | memo23 `isHiring` true + `openJobs`; Job Search `jobTitles` from role vocabulary |
| `scraperMode` | planner (identity) | hardcoded `"full"` |
| company name | memo23 `name` | `normalizeCompanySearchName` → `searchQuery` |
| LinkedIn URL | absent at discovery | produced only by Company Search + domain match |
| domain | memo23 `website` | derived `canonical_domain`; used for match only, never sent |
| `batch` | planner / amendment | Apify default `"All Batches"` when unset |

---

## Diagram 8 — Continuation / resume (current behaviour)

```mermaid
flowchart TD
  T0["slice running (300 s ceiling, missionCeilingMs)"]:::code
  T0 --> CKP["engine checkpoint: plan, companies, identities,<br/>triage, completed_operations, query families"]:::code
  CKP --> DB1[("tasks.result.lead_resume_checkpoint<br/>+ lead_lineages.current_state")]:::db
  DB1 --> REL["worker release_lead_mission → resumable<br/>attempts+1 · not_before +2 min"]:::code
  REL --> DB2[("lead_mission_queue: resumable")]:::db
  DB2 --> CLM["worker claims again (attempt ≤ 5)"]:::code
  CLM --> RST["handleRunAgent resume: restore plan (NO execution planner),<br/>restoreWorkingSet, run recovery (completed / pending runs)"]:::code
  RST --> REU["reused: identities (same lineage), triage verdicts,<br/>completed provider operations"]:::code
  RST --> RO["discovery_reopened_for_replenishment (engine:3983)<br/>quota unmet → discovery runs again"]:::code
  RO --> AMR(["amendment already rewrote the question"]):::gpt
  AMR --> FG{"family guard: same question?"}:::code
  FG -->|"identical"| SKQ["skipped_repeat_query"]:::code
  FG -->|"different (the usual case)"| NEWD{{"NEW paid memo23 call"}}:::prov
  NEWD --> NEWI{{"Company Search for every NEW shortlisted company"}}:::prov
  NEWI --> NEWE{{"Company Details for newly resolved"}}:::prov
  NEWE --> NEWF{{"Firecrawl for newly evaluated"}}:::prov
  NEWF --> REV(["triage + evaluation + amendment called again"]):::gpt
  REV --> T0
  CLM -->|"attempt 5 / budget exhausted"| TERM["retry_budget_exhausted → failed<br/>(worker reconciles queue/task/lineage/plan)"]:::code
  classDef gpt fill:#ede9fe,stroke:#7c3aed,color:#3b0764
  classDef code fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e
  classDef prov fill:#dcfce7,stroke:#16a34a,color:#14532d
  classDef db fill:#f1f5f9,stroke:#475569,color:#0f172a
```

| On resume | Reruns? |
|---|---|
| Execution planner | **no** — plan restored from checkpoint |
| Amendment | **yes** — after every discovery pass |
| Discovery planner | only on thin-pool replan |
| Triage | only for new companies (`triage_reused_from_checkpoint`) |
| memo23 discovery | **yes, new question** each slice while quota unmet (fd27 slice 2; 1e52d43c 4 of 5 slices) |
| Company Search | only for new companies in this lineage; **never shared across lineages** |
| Company Details | new identities only (batch keyed per company) |
| Firecrawl | new evaluation targets (page cache per intent/TTL) |
| Evaluation | yes |

---

## Diagram 9 — Persistence / data flow

```mermaid
flowchart LR
  PC["pilot-chat"]:::code --> MS[("messages / conversations<br/>card + mission copy")]:::db
  PC --> CBR2[("company_brain · SOURCE OF TRUTH: ICP")]:::db
  OR2["orchestrate"]:::code --> TPL[("task_plans · Pilot's 1-step plan<br/>(projection, not the execution plan)")]:::db
  OR2 --> EQ2["enqueue"]:::code --> LMQ[("lead_mission_queue · SOURCE OF TRUTH:<br/>V2 ownership, attempts, lease")]:::db
  WK2["worker"]:::code --> LMQ
  WK2 --> LLN[("lead_lineages · SOURCE OF TRUTH:<br/>lineage lease + accumulated checkpoint")]:::db
  RA2["run-agent / engine"]:::code --> TSK[("tasks.result · MIXED: mission state blob (truth)<br/>+ company_first / workbench_* (projections)")]:::db
  RA2 --> LEC[("lead_execution_calls · SOURCE OF TRUTH: ledger<br/>lead_model_calls = view")]:::db
  RA2 --> LCN[("lead_candidates · PROJECTION (6 writers)")]:::db
  RA2 --> CWE[("company_web_evidence · CACHE (TTL per intent)")]:::db
  RA2 --> CHS[("company_headcount_snapshots · time series,<br/>written from enrichment, not read for retrieval")]:::db
  RA2 --> CRD[("credit_transactions · SOURCE OF TRUTH: credits")]:::db
  SIG["run-monitoring-scan (Signals)"]:::code --> SEV[("signal_events · Signals truth;<br/>not written or read by the lead path")]:::db
  CBR2 --> RA2
  TSK --> WBX["Workbench"]:::code
  LCN --> WBX
  TPL --> WBX
  classDef code fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e
  classDef db fill:#f1f5f9,stroke:#475569,color:#0f172a
```

| Table | Enters at | Writer(s) | Truth or projection |
|---|---|---|---|
| `tasks` | orchestrate/worker create; run-agent/engine update | run-agent, worker, sweepers, continue-workflow, 10+ modules | **both** — state blob + Workbench projections |
| `task_plans` | Start | orchestrate, worker reconcile | projection of Pilot's plan |
| `lead_lineages` | first slice | `lineageLease.ts`, worker | truth (lease + `current_state`) |
| `lead_mission_queue` | enqueue | enqueue, worker RPCs | truth (ownership/scheduling) |
| `lead_execution_calls` | every provider/model/stage call | ledger writer (model rows flushed at slice end) | truth for what was called; **not** for what was billed |
| `lead_candidates` | persistence | 6 writers | projection |
| `company_web_evidence` | Firecrawl | `webEvidenceStore` | cache |
| `company_headcount_snapshots` | enrichment | run-agent | truth for history; unused by retrieval |
| `company_brain` | Pilot/orchestrate read | Brain setup | truth (input) |
| `signal_events` | — (Signals only) | monitoring | not part of this flow |

---

## Diagram 10 — Cost / ledger flow

```mermaid
flowchart TD
  CALL{{"Apify run (memo23 / Company Search / Details / Job Search)"}}:::prov
  CALL --> TR2["toolRegistry.runTool('source_with_apify')<br/>waits for run, reads finalRun once (toolRegistry.ts:1329–1338)"]:::code
  TR2 --> PR["priceProviderCall (providerCostModel.ts)<br/>max(usageTotalUsd, chargedEvents×prices, start + rows×perRow)"]:::code
  PR --> LG[("lead_execution_calls.actual_cost_usd<br/>cost_source provider_reported")]:::db
  PR --> CR[("credits_finalize → credit_transactions")]:::db
  CALL --> BILL["Apify settles per-result charges AFTER the run document was read"]:::code
  BILL --> REAL["real Apify bill"]:::code
  LG -.->|"never re-read"| MISM["⚠ MISMATCH: ledger is the provisional read<br/>fd27bfac $0.0711 vs $0.2711 billed · 1e52d43c $0.2463 vs $0.5902<br/>largest on Company Search 'full-company' rows"]:::flaw
  REAL -.-> MISM
  FCX{{"Firecrawl scrape"}}:::prov --> FCL[("ledger: cost_source unknown, actual null")]:::db
  GPTX(["engine GPT calls"]):::gpt --> MCOL["ModelCallCollector → PendingModelDrain<br/>flushed at slice end (estimate only)"]:::code --> LG
  PCX(["Pilot chat brain + compiler"]):::gpt -.->|"not ledgered"| NL["invisible to the spend ceiling"]:::flaw
  LG --> SC["modelSpendCeiling (lead_model_calls view) — shared with Content, Brain"]:::code
  classDef gpt fill:#ede9fe,stroke:#7c3aed,color:#3b0764
  classDef code fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e
  classDef prov fill:#dcfce7,stroke:#16a34a,color:#14532d
  classDef db fill:#f1f5f9,stroke:#475569,color:#0f172a
  classDef flaw fill:#fee2e2,stroke:#dc2626,color:#7f1d1d,stroke-width:2px
```

---

## Diagram 11 — Current flaws overlay

```mermaid
flowchart TD
  U2["user request"]:::code --> C2(["compiler + Brain merge"]):::gpt
  C2 --> GX["capability graph"]:::code
  GX --> EX(["execution planner"]):::gpt
  EX --> DX{{"YC discovery"}}:::prov
  DX --> NX["normalize (no LinkedIn URL)"]:::code
  NX --> TX(["triage"]):::gpt
  TX --> SX{{"Company Search by name"}}:::prov
  SX --> MX["domain match"]:::code
  MX --> DTX{{"Company Details"}}:::prov
  DTX --> HX["hiring (skipped) / Job Search"]:::code
  HX --> FX{{"Firecrawl"}}:::prov
  FX --> VX(["evaluation"]):::gpt
  VX --> AX(["amendment"]):::gpt
  AX -.-> DX
  VX --> PX[("persistence / Workbench")]:::db

  F1["⚠ multiple planner ownership<br/>7 GPT roles + 5 code layers; ledger labels say deterministic"]:::flaw
  F2["⚠ silent input rewriting<br/>amendment replaces discovery input; maxItems, size, defaults"]:::flaw
  F3["⚠ fuzzy company-name identity search<br/>domain never sent; common words return 15 wrong rows"]:::flaw
  F4["⚠ unnecessary repeated Company Search<br/>1 per company per cohort; no cross-mission identity reuse"]:::flaw
  F5["⚠ provider-call duplication on resume<br/>replenishment reopens discovery with a new question"]:::flaw
  F6["⚠ capability graph / engine mismatch<br/>hiring_verification scheduled then skipped; graph ≠ what runs"]:::flaw
  F7["⚠ company-first hiring retrieval<br/>cohort first, signal checked per company"]:::flaw
  F8["⚠ late evidence collection<br/>Firecrawl only after evaluation finds stage unproven"]:::flaw
  F9["⚠ cost mismatch<br/>provisional read, Firecrawl unpriced, Pilot GPT unledgered"]:::flaw
  F10["⚠ multiple candidate / count owners<br/>requested 1, maxCandidates 10, admitted target, shortlist,<br/>6 lead_candidates writers; Workbench 'counts disagree'"]:::flaw

  F1 -.- EX
  F1 -.- AX
  F2 -.- AX
  F2 -.- DX
  F3 -.- SX
  F4 -.- SX
  F5 -.- AX
  F6 -.- GX
  F6 -.- HX
  F7 -.- DX
  F8 -.- FX
  F9 -.- SX
  F9 -.- FX
  F10 -.- PX
  F10 -.- TX
  classDef gpt fill:#ede9fe,stroke:#7c3aed,color:#3b0764
  classDef code fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e
  classDef prov fill:#dcfce7,stroke:#16a34a,color:#14532d
  classDef db fill:#f1f5f9,stroke:#475569,color:#0f172a
  classDef flaw fill:#fee2e2,stroke:#dc2626,color:#7f1d1d,stroke-width:2px
```

| Flaw | Where it lives | Evidence |
|---|---|---|
| Multiple planner ownership | run-agent `:3051/:3082`, engine `:5252`, `:3164` | 8 GPT roles in fd27 ledger; provider rows labelled `deterministic_registry_v1` |
| Silent input rewriting | engine `:5252`, `leadDiscoveryStrategy.ts:378`, clamps | fd27 slice 1 vs slice 2 memo23 inputs |
| Fuzzy name identity | engine `:1256`, `leadCommercialPrequalification.ts:451` | Every/Streak/Moss 15 rows; Nango/Gojiberry 0 |
| Repeated Company Search | engine `:5604`, lineage-scoped reuse | fd27 re-bought 1e52d43c's 10 searches |
| Duplication on resume | engine `:3983`, `:4995` | 4 new discovery questions in 1e52d43c |
| Graph / engine mismatch | graph schedules, engine `:3871` skips | fd27 `hiring_verification: skipped_no_input` |
| Company-first hiring | graph entry `startup_company_discovery` | no job-first route in V2 |
| Late evidence | Firecrawl after evaluation | fd27 3 scrapes after enrichment; 1e52d43c 12 for seed stage |
| Cost mismatch | `toolRegistry.ts:1329`, `providerCostModel.ts` | $0.0711 vs $0.2711 |
| Count owners | run-agent quota, engine `:4380`, 6 writers | Workbench "Run details · counts disagree" on fd27 |
