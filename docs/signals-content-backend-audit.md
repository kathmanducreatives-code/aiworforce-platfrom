# Signals & Content — backend audit

**Date:** 2026-08-22
**Commit:** `bd177050`
**Scope:** audit only. Nothing in this document was implemented.
**Method:** source tracing plus live queries against the TEST project
(`ohsdatpvfdjdemstoiuj`). Row counts are real, not inferred.

---

## Executive summary

Three findings dominate everything below.

1. **Signals has a real, substantial, personalised backend — that has never
   successfully persisted a row.** `run-radar-scan` is 367 lines over ~20 shared
   modules, reads the Company Brain and ICP, scores candidates against them and
   writes to `public.signals`. That table holds **0 rows**, as do every other
   signal table. The system is code-complete and behaviour-unverified.

2. **Content has no backend at all.** It reads the *same hook as Signals* and
   passes the top-scored signal through a five-case `switch` of hardcoded
   marketing copy. No Company Brain, no ICP, no offer, no lead data, no
   competitor data, no persistence, no model call.

3. **Signals spends provider money outside the credit system.**
   `run-radar-scan` does not go through `runTool`, so it never reaches
   `authorizeProviderCall`. With credit enforcement now live for leads, this is
   an unmetered spend path.

---

## 1. Current Signals backend architecture

```
Signals.tsx
  └── useSignalFeed(workspaceId)
        ├── fetchSignals(workspaceId, limit) ──────────► public.signals
        └── supabase.functions.invoke('run-radar-scan')
              │
              ├── compileCompanyBrainContext()          ← Company Brain
              ├── readPrefs(profile)                    ← ICP + signal_preferences
              ├── buildRadarScanPlan()                  ← per-category plan + mix
              │
              ├── apifyJobsHiringSource                 ← Apify (hiring)
              ├── radarProviderAdapters                 ← Apify (posts / comments / people)
              ├── runFirecrawlSource                    ← Firecrawl SEARCH
              │
              ├── scoreCandidates()
              │     └── scoreAgainstCompanyBrain()      ← deterministic ICP scoring
              │     └── signalDedupeKey()               ← dedupe
              │
              ├── enrichAndGateRows()
              ├── buildSourceDiagnostics()
              └── insert ─────────────────────────────► public.signals
```

**Categories:** `hiring · linkedin_intent · competitor · workflow_trend · people`

**Trigger:** manual only. The user clicks; there is no scheduler.

### Signal types supported

| Type | Source | Status |
|---|---|---|
| `hiring` / `hiring_signal` | Apify jobs | wired |
| `linkedin_post` / `linkedin_intent` | Apify posts | wired |
| `linkedin_comment` | Apify comments | wired |
| `people` / `decision_maker` | Apify people | wired |
| `competitor` | filter over above | type filter only |
| `workflow_trend` | Firecrawl search | wired |
| `funding` | — | **no source** |
| `expansion`, `product_launch`, `technology` | — | **no source** |

The UI filters (`src/pages/Signals.tsx:46-57`) already reference `funding`,
`comments`, `workflows`, `people`. `funding` has no collector behind it.

---

## 2. Current Content backend architecture

```
Content.tsx
  └── useSignalFeed(workspaceId)         ◄── THE SAME HOOK AS SIGNALS
        └── deriveContentBrief(signals)
              ├── sort by score, take [0]
              ├── angleForType(signal_type, company)   ← 5 hardcoded strings
              └── directionForType(signal_type)        ← hardcoded
```

There is **no Content edge function, no Content table, and no Content model
call.** `src/lib/contentOps.ts:25-39`:

```ts
function angleForType(type: string, company: string | null): string {
  switch (type) {
    case "funding":  return "Congratulate + insight — what newly funded teams get wrong…";
    case "hiring":   return "POV — hiring a first seller vs building a repeatable pipeline system";
    case "competitor": return `Contrarian take on ${company ?? "the competitor"}'s positioning`;
    case "workflow_trend": return "Practical breakdown of the workflow founders are adopting";
    default: return "Founder POV grounded in this signal";
  }
}
```

Drafting is delegated to chat via `sendAgentCommand` / `buildTurnIntoCommand`.
Nothing about the *idea* is persisted; only a resulting draft would be, through
the existing chat/draft path.

---

## 3. What is genuinely functional

- Radar planning and per-category budget mix
- Provider adapters with capability gating and honest `setup_needed` states
- ICP scoring against Company Brain (`icpSignalScorer.ts:101`)
- Deduplication (`signalDedupeKey`)
- Evidence gating — a candidate needs identity, evidence and a source URL
- Per-source diagnostics (raw / normalized / duplicate / rejected / accepted,
  rejection reasons, provider error, elapsed ms, estimated cost)
- Brain-confidence honesty layer: an incomplete Brain short-circuits Firecrawl
  rather than burning budget on generic queries
  (`radarSourceExecution.ts:62-70`)
- Workspace scoping and persistence

## 4. What is frontend-only or placeholder

- **The entire Content brief / opportunity / angle layer**
- `competitors` tab — a `signal_type` filter, not competitor identity
- Funding, expansion, launch and technology filters — no collector behind them
- Engagement and trend analysis — no aggregation exists anywhere

---

## 5. Database tables and live state

| Table | Cols | Rows | Notes |
|---|---:|---:|---|
| `signals` | 16 | **0** | radar v1 target; also written by leads |
| `signal_events` | 26 | **0** | v2, the lead architecture |
| `signal_event_evidence` | 17 | **0** | v2 evidence |
| `signal_feed` | 9 | **0** | |
| `signal_reviews` | 12 | **0** | |
| `competitor_intel_signals` | 14 | **0** | |
| `competitor_profiles` | 22 | **0** | |
| `competitor_companies` | 8 | **0** | |
| `linkedin_posts` | 8 | **0** | |
| `outreach_drafts` | 14 | **0** | |
| `saved_outputs` | 10 | **0** | |
| `company_brain` | 14 | **1** | the only populated intelligence table |

**No `content_*` table exists.**

---

## 6. Current providers / actors

| Provider | Used for | Key set |
|---|---|---|
| Apify | hiring jobs, LinkedIn posts, comments, people | ✅ `APIFY_API_TOKEN` |
| Firecrawl | **search** (workflow trends), not crawl | ✅ `FIRECRAWL_API_KEY` |

Firecrawl's radar role is `FirecrawlSearchFn` — web *search* for signal
discovery. This is distinct from its Lead-workflow role, which is now Deep
Company Research (crawl + extract).

---

## 7. Current GPT / model involvement

**Zero, in both pages.**

No `gptStructured`, no OpenAI reference anywhere in `run-radar-scan/` or
`_shared/radarIntel/`. All signal relevance is deterministic string matching.
Content's "AI angle" is a `switch` statement.

The Lead engine, by contrast, now routes every stage through `gptModelRouter`
(Luna → validate → Terra) with full cost telemetry. **None of that reaches
Signals or Content.**

---

## 8. Company Brain / ICP involvement

**Signals — yes, deeply.** `readPrefs()` (`run-radar-scan/index.ts:41-55`)
falls back through the Brain for every preference:

```
signal_preferences.competitors    ?? profile.competitors.known
signal_preferences.hiring_roles   ?? profile.icp.buyer_roles
signal_preferences.geographies    ?? profile.icp.geography
signal_preferences.industries     ?? profile.icp.industries
signal_preferences.pain_points    ?? profile.icp.pain_points
signal_preferences.disqualifiers  ?? profile.icp.disqualifiers
```

**Content — none.** No import of `useCompanyBrain`, no ICP reference, no offer.

---

## 9. Personalisation status

| | Signals | Content |
|---|---|---|
| ICP industries / categories | ✅ matched | ❌ |
| Disqualifiers (industry, keyword, domain) | ✅ enforced | ❌ |
| Buyer roles | ✅ title-matched | ❌ |
| Geography | ✅ optional strict mode | ❌ |
| Pain points | ✅ in prefs | ❌ |
| Offer | ❌ | ❌ |
| Semantic understanding | ❌ string matching only | ❌ |

Signals is *genuinely* personalised — but lexically. It can tell that a company
is in an ICP industry; it cannot tell that a founder post is *about* the pain
the user solves unless the words happen to match.

---

## 10. Signal relevance / ranking

`scoreAgainstCompanyBrain` produces an `IcpSignalScore` with a
`verification_status`; rejected candidates are dropped before dedupe. Inputs:
ICP hits, disqualifier hits, persona/title match, evidence presence, company
identity, source URL validity, recency.

Ranking is a deterministic sort. There is no learning, no feedback loop from
`signal_reviews` (0 rows), and no cross-signal correlation — the product example
of *"ICP-fit + funding + sales hiring + founder discussing pipeline"* **cannot be
expressed today**, because each signal is scored in isolation and there is no
per-company aggregation step.

---

## 11. Competitor intelligence status

- `radarIntel/competitorIntelligence.ts` — **0 importers**
- `radarIntel/marketIntelligence.ts` — **0 importers**
- `competitor_*` tables — 0 rows
- The `competitors` tab filters `signal_type === 'competitor'`

No competitor content is collected anywhere. This is a genuine gap, not a
wiring problem.

---

## 12. Lead → Signal → Content connections

**One real bridge exists.** `_shared/memoryWriter.ts:444` writes lead-run hiring
signals into `public.signals` with `workspace_id` — the same table the radar
feed reads. Lead runs therefore *do* feed the Signals page structurally.

**Two signal architectures.**

```
LEADS  ──► signal_events (v2)  ◄── the hardened architecture
                 ▲
                 │ signalsV2DualWrite   ← gated by SIGNALS_V2
                 │                        NOT SET on the project → OFF
RADAR  ──► signals (v1)
```

| Connection | Status |
|---|---|
| lead evidence → signals | ✅ via `memoryWriter` (v1 table) |
| signals → lead prioritisation | ❌ `run-agent:5189` only counts them |
| lead conversations → content | ❌ Content never reads lead data |
| competitor activity → content | ❌ nothing collects it |
| content → positioning | ❌ nothing persisted to learn from |

---

## 13. Reusable capabilities from the Lead engine

| Asset | Reusable for |
|---|---|
| `signal_events` + `signal_event_evidence` | one shared signal store |
| `signalQuality` / `signalFreshness` | recency + trust on radar signals |
| `gptModelRouter` (Luna→Terra) | semantic relevance, content generation |
| `modelEscalation` | validator-driven repair for generated content |
| `creditPricing` + `authorizeProviderCall` | **metering radar spend** |
| `executionLedger` | provider + model cost provenance |
| `compileCompanyBrainContext` | already shared |
| capability/provider selection pattern | new collectors (funding, launches) |

---

## 14. Major architectural gaps

1. **No scheduled collection.** Manual trigger only — "what's happening in my
   market" requires the user to ask.
2. **Two signal architectures**, bridge flag OFF.
3. **No Content backend.**
4. **No competitor content collection.**
5. **No engagement / trend analysis.**
6. **No theme extraction across qualified leads.**
7. **No semantic layer** — string matching only.
8. **No cross-signal correlation per company** — the core product promise.
9. **Radar unverified live** — 0 rows persisted, ever.
10. **Radar spend unmetered.**

---

## 15. Dead / unreachable code

| Module | Importers |
|---|---:|
| `radarIntel/competitorIntelligence.ts` | 0 |
| `radarIntel/marketIntelligence.ts` | 0 |
| `signalsV2DualWrite.ts` | 1, flag off → unreachable in practice |

---

## 16. Cost / credit implications

`run-radar-scan` calls Apify and Firecrawl **directly**, not via `runTool`. It
therefore bypasses `authorizeProviderCall` entirely.

Consequences with enforcement now live:

- Lead provider calls reserve and settle credits.
- **Radar provider calls do not.** A workspace at zero credits is blocked from
  leads and unrestricted on Signals.
- `estimated_cost_usd` appears in radar diagnostics but reaches no ledger.

This is the highest-value fix in this document relative to its size.

---

## 17. Recommended architecture — Signals (not implemented)

```
SCHEDULED + ON-DEMAND
        │
        ├── collectors (metered via runTool → credits)
        │     hiring · posts · comments · people · funding* · launches* · web-change*
        │
        ├── deterministic floor:  ICP scorer + disqualifiers + evidence gate
        │
        ├── PER-COMPANY CORRELATION          ← the missing piece
        │     group signals by company, over a window
        │
        ├── GPT re-rank on top N only        ← Luna, via gptModelRouter
        │     "does this matter to THIS user's offer?"
        │
        └── signal_events (v2)               ← one store, shared with leads
```

Keep the deterministic scorer as the floor and let GPT re-rank only what
survives it — cheap, bounded, and it fails safe to today's behaviour.

## 18. Recommended architecture — Content (not implemented)

```
    signal_events        lead_results          competitor content*
    (market activity)    (who qualified)       (*needs a collector)
            └──────────────┬──────────────────────┘
                           ▼
                  THEME EXTRACTION (GPT)
                  recurring topics across
                  qualified leads + market
                           ▼
              + Company Brain / ICP / OFFER
                           ▼
                CONTENT OPPORTUNITY
                  angle · audience · why-now
                  EVIDENCE: the signals behind it
                           ▼
                 persisted with provenance
```

Content should be a *consumer* of the shared signal store, not a second
presentation of the same feed.

## 19. What should be shared

```
              COMPANY BRAIN + ICP + OFFER
                          │
             ┌────────────┼────────────┐
             ▼            ▼            ▼
           LEADS       SIGNALS      CONTENT
        who to target   why now     what to say
             └────────────┴────────────┘
                          │
        ONE signal_events store
        ONE Brain compiler
        ONE model router (Luna→Terra)
        ONE credit boundary (authorizeProviderCall)
        ONE execution ledger
```

## 20. Proposed implementation phases

| Phase | Goal | Risk |
|---|---|---|
| 1 | **Verify radar live.** 0 rows is the blocker under everything else. | low |
| 2 | **Meter radar** through `runTool` → credits. | low |
| 3 | Unify on `signal_events` (enable `SIGNALS_V2`, verify, retire v1). | medium |
| 4 | Per-company correlation + scheduled collection. | medium |
| 5 | GPT re-rank on survivors only. | medium |
| 6 | Content backend: theme extraction, persistence, provenance. | high |

---

## Readiness matrix

| Capability | Current status | Wired? | Reusable backend? | Needs new backend? | Needs GPT? | Needs provider? |
|---|---|---|---|---|---|---|
| Hiring signals | code-complete, 0 rows | ✅ | ✅ | ❌ | ❌ | Apify ✅ |
| LinkedIn posts | code-complete, 0 rows | ✅ | ✅ | ❌ | ❌ | Apify ✅ |
| LinkedIn comments | code-complete, 0 rows | ✅ | ✅ | ❌ | ❌ | Apify ✅ |
| People signals | code-complete, 0 rows | ✅ | ✅ | ❌ | ❌ | Apify ✅ |
| Workflow trends | code-complete, 0 rows | ✅ | ✅ | ❌ | ❌ | Firecrawl ✅ |
| Funding | **no source** | ❌ | partial | ✅ | ❌ | **gap** |
| Expansion / launches / tech | **no source** | ❌ | partial | ✅ | ❌ | **gap** |
| Website-change detection | not built | ❌ | Firecrawl ✅ | ✅ | maybe | Firecrawl ✅ |
| ICP personalisation | working | ✅ | ✅ | ❌ | ❌ | ❌ |
| Semantic relevance | **absent** | ❌ | router ✅ | ❌ | **✅** | ❌ |
| Cross-signal correlation | **absent** | ❌ | ❌ | ✅ | maybe | ❌ |
| Scheduled monitoring | **absent** | ❌ | ❌ | ✅ | ❌ | ❌ |
| Signal → lead priority | **absent** | ❌ | ✅ | ✅ | ❌ | ❌ |
| Competitor intel | dead code | ❌ | partial | ✅ | likely | Apify/Firecrawl |
| Content ideas | **placeholder** | ❌ | ❌ | **✅** | **✅** | ❌ |
| Content provenance | **absent** | ❌ | ledger ✅ | ✅ | ❌ | ❌ |
| Credit metering (Signals) | **absent** | ❌ | **✅** | ❌ | ❌ | ❌ |

---

## Firecrawl — existing vs future

**Existing (do not confuse with the below):**
- Lead workflow: Deep Company Research — crawl + extract, credit-metered via
  `scrape_url` → `runTool` → `authorizeProviderCall`.
- Radar: **search only**, for workflow-trend discovery. Unmetered.

**Future possibilities (none built, none implied):** website change detection,
new product pages, positioning changes, new case studies, new market/location
pages, new integrations, company announcements. All would need a stored
baseline per company to diff against — no such snapshot store exists today.

---

## Cross-references

- `docs/architecture/signals-storage-schema-v2.md`
- `docs/architecture/signals-storage-audit.md`
- `docs/architecture/signals-storage-inventory.md`
- `docs/architecture/agentory-intelligence-kernel.md`
