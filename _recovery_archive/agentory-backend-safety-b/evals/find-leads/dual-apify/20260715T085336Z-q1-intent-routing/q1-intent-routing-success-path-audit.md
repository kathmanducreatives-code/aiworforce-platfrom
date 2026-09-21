# Q1 Intent-Routing Success-Path Audit (evidence-only)

**Audit type:** forensic reconciliation of the already-completed Q1 run. No provider
calls, no reruns, no deploys, no DB mutations, no cleanup SQL, no migrations, no
production access. Read-only TEST inspection + code tracing only.

**Classification:** **PARTIAL ARCHITECTURE PASS / QUALITY-&-PERSISTENCE FAILURE.**
Routing, actor selection, real-person sourcing, country handling and outreach
safety PASS. Aria enforcement, persistence ordering, lead-quality gating, actor
provenance detail, artifact typing and person-vs-job scoring semantics FAIL.
**Not safe to begin the Agentory-vs-Claude benchmark.**

---

## 1. Immutable run identifiers

| Item | Value |
|---|---|
| remix/main (deployed) | `1663a24820ceeb37f37de7da611ed7a5191bc6c9` |
| Working-tree HEAD | `3cac54a8430f2ebcbe50539aed5491ec1b050950` (PR #39 branch tip; **content-identical** to remix/main — the only delta is the merge commit, `git diff 3cac54a8 remix/main` = empty) |
| Intent-routing source commit | `3cac54a8` present (ancestor of remix/main) ✓ |
| Working tree | clean ✓ |
| TEST project | `zbwsbnqqpkvdhqwavjke` (MCP project_url confirmed = `https://zbwsbnqqpkvdhqwavjke.supabase.co`) |
| Production | `wqnigjhcwjxtmordrwno` — **not accessed** |
| run-agent / orchestrate | v79 / v31 |
| Workspace | `00000000-0000-0000-0000-000000000001` |
| Company Brain | `030f4f36-171d-4c27-85e1-1c791f05e391`, `updated_at=2026-07-05T07:51:43Z` (10 days pre-run → unchanged by Q1) |
| Plan ID | `d94484db-5e60-49ec-a08b-66f7f888bab7` |
| Provider run (trace_id / provider_run_id) | `bd3cda5c-6f79-4be9-be03-f6a13f61762b` |
| Scout task ID | `ee1d51b3-6690-4474-a753-ad50d7e12d04` |
| Aria task ID | `f9914037-ea68-40c0-b1d1-5a908b109499` |
| source_quality run_id | `bd3cda5c-6f79-4be9-be03-f6a13f61762b` |

Plan `user_instruction`: **"Using my ICP, find me 5 hot founders I should contact right now."**
Created `2026-07-15 08:53:36.339Z`; completed `08:54:10.441Z` (~34 s). status=complete.

---

## 2. Baseline vs. final safety deltas

| Metric | Baseline (Account A) | Final (observed) | Δ |
|---|---|---|---|
| lead_candidates (workspace) | 430 | 435 | **+5** (this plan) |
| lead_candidates (plan d94484db) | 0 | 5 | +5 |
| old off-target rows (plan da79cba3) | 4 | 4 | 0 (untouched; `lead_type=company`, updated_at 07:25:40Z) |
| contacts (this plan) | — | 5 | +5 (one per lead) |
| signals (this plan) | — | 5 | +5 (`signal_type=people_profile`) |
| accounts (in run window) | — | 0 | 0 (all 5 leads `account_id=null`) |
| outreach_drafts | 64 | 64 | **0** (none reference the 5 leads) |
| approvals | 25 | 25 | **0** |
| outreach_activities | (Q1-scoped 0) | 4 | 0 from Q1 — all 4 pre-date the run (2026-02-27, source=`closely`, unrelated lead) |
| Penn tasks (this plan) | — | 0 | 0 |
| tasks (this plan) | — | 2 | Scout + Aria only |

Company Brain changed = **no**. Production accessed = **no**.

---

## 3. Compiled intent & routing (Scout `result.lead_entity_intent` / `result.routing`)

| Field | Value |
|---|---|
| original_user_instruction | "Using my ICP, find me 5 hot founders I should contact right now." |
| target_entity | **person** |
| output_type | **qualified_people** |
| person_roles | ["Founder"] |
| geographies | [] (US not captured as a hard geography — see note) |
| signals | **[]** (no hiring/funding leaked into intent) |
| requested_count | 5 |
| confidence | 0.9 |
| clarification_required | false |
| routing_source | **original_user_instruction** |
| primary_actor.actor_key | **apify_people_search** |
| primary_actor.actor_implementation | **harvestapi/linkedin-profile-search** |
| routing conflict | none |

The planner rewrote the Scout *prose* to "Search for 5 founders … prioritizing those
with recent funding or hiring signals" (activity `agent_started` / `Scout started`),
but the immutable intent held: `target_entity=person`, actor stayed people-search.
**Routing fix confirmed working — the actor did not flip to jobs.**

> Note: `geographies=[]` even though the ICP is US. US was applied only via the
> actor input (`locations:["United States"]`), not the typed intent. Not a failure
> for this audit, but a latent gap.

---

## 4. Sourcing attempts (Scout `result.sourcing_attempts` / `result.source_quality`)

Single attempt, no broadening needed (5 raw = 5 requested):

| # | label | actor_key | actor_implementation | fingerprint | raw | accepted | rejected |
|---|---|---|---|---|---|---|---|
| 1 | exact | apify_people_search | harvestapi/linkedin-profile-search | pa_1seo2d0 | 5 | 5 | 0 |

Sanitized input (structured — malformed-input bug fixed):
```json
{ "maxItems":5, "locations":["United States"], "startPage":1, "takePages":1,
  "searchQuery":"B2B SaaS OR AI SaaS", "currentJobTitles":["Founder"],
  "profileScraperMode":"Full" }
```

`source_quality`: raw_result_count 5, accepted_count 5, rejected_count 0,
duplicate_count 0, persisted_count 5, qaLimitApplied false.
**BUT** `lead_quality.tiers = { hot:0, qualified:0, weak:0, rejected:5 }`, avg_score 61.
→ the source-quality gate "accepted" 5, while the lead-quality scorer tiered **all 5
as rejected**, and all 5 still persisted.

Totals: 5 raw · 5 unique · 0 duplicates · 0 malformed · 0 location rejects · 0
source-quality rejects · **5 accepted provider profiles**.

---

## 5. Handoff-count reconciliation — what "1 provider-backed / 9 rejected" counted

Activity `provenance_handoff_guard` @ `08:54:06.757Z`:
**"1 provider-backed / 9 rejected (LLM-invented)"**.

This counts the **Scout LLM narrative `output` (10 candidates)**, NOT the persisted
provider profiles. Scout's `result.output.candidates` holds 10 LLM-written founders;
only #1 (Jeff Esposito / VeraAI) corresponds to a real provider profile. The other 9
are fabrications (Sarah Chen/Lumina Sales AI, Marcus Thorne/RevOps Flow, Elena
Rodriguez/Vantage Point AI, David Haimes/SignalPath, Julianna Wu/Cognito Sales,
Robert Glass/Pipeline Hero, Amina Okafor/Kinetica AI, Siddharth Mehta/QuotaStream,
Chloe Sterling/Aura Intelligence). The guard matched them against the provider index:
**1 matched, 9 unmatched → rejected.** Only the 1 matched candidate was passed to Aria.

The 5 persisted rows are a **different collection** — the 5 raw provider profiles from
the sourcing attempt, persisted directly.

### Numerical pipeline
```
5 raw provider profiles (HarvestAPI)
→ 5 normalized provider candidates (source-quality accepted)
→ 5 PERSISTED lead_candidates   [08:53:58.58–08:53:59.22, during Scout's tool call]
   (all tiered "rejected" by inline scorer; persistence NOT gated on any verdict)

── separately, after persistence ──
10 Scout LLM narrative candidates
→ handoff guard vs provider index: 1 provider-backed / 9 LLM-invented (rejected) [08:54:06.75]
→ 1 candidate reaches Aria agent task
→ Aria ranks 1 (Jeff Esposito, score 6); 0 explicitly rejected by Aria [08:54:07–10]
→ Aria verdict has ZERO effect on the 5 already-persisted rows
```
**Persisted (5) ≠ provider-backed handoff count (1) ≠ reached-Aria (1).** The three
numbers measure three different things, and none of them gate persistence.

---

## 6. Aria task audit (task `f9914037`, `result.output`)

Aria received and scored **only 1 candidate**:

| person | title | company | score | top_3 | red_flags |
|---|---|---|---|---|---|
| Jeff Esposito | Founder | VeraAI Technologies Inc. | **6** | yes (1 of 1) | "no recent funding data", **"no active RevOps/Sales job postings identified"** |

- Aria accepted/surfaced: **1** (low score 6). Aria explicitly rejected: **0** (the 9
  fabrications were removed by the handoff guard *before* Aria).
- Aria's red flag "**no active RevOps/Sales job postings identified**" is job-era
  language applied to a person — sourced from the planner-injected Aria brief
  ("looking for 'hot' signals like recent funding or hiring for RevOps/Sales roles",
  activity `Aria started`).
- **Aria ran at 08:54:07 — ~9 s AFTER the 5 leads persisted (08:53:58–59).** Aria
  cannot have gated persistence.

---

## 7. The five persisted leads (`lead_candidates` where plan = d94484db)

All `lead_type=person`, `status=new`, `lead_origin=provider_sourced`,
`profile.signal_type=people_profile`, real LinkedIn `/in/` URLs,
`provider_provenance.verified=true`, `provider_run_id=bd3cda5c…`,
`actor_id="apify"` (generic; **no `actor_key`** in provenance), **no `artifact_type`**
(neither a column nor a raw key), `provenance_overwrite_attempt=true`,
`evidence_violations=["profile_as_job","identity_only_signal"]`,
`evidence_summary="Verified source proof: a live job posting URL."`

| lead id | person | company | profile_url | fit_score | star_label | fit_tier | analyst |
|---|---|---|---|---|---|---|---|
| 9f71135e | Jeff Esposito | VeraAI Technologies Inc. | /in/veraai | 20 | **Reject** | rejected | weak |
| 033a9983 | Jim Smith | Proper Sky – Managed IT Services | /in/propersky-jim | 30 | Weak | rejected | weak |
| af7301ad | Nabeel Farooq | Improdata | /in/nabeelfarooq1 | 30 | Weak | rejected | weak |
| 9725d5cb | Kumar Velugula | XNODE Inc. | /in/kumar-velugula | 20 | **Reject** | rejected | weak |
| 0469f5f3 | Joe Apfelbaum | evyAI | /in/joeapfelbaum | 30 | Weak | rejected | weak |

- All 5 are **genuine HarvestAPI person profiles** (verified provenance, real /in/ URLs).
- All 5 are **`fit_tier=rejected`** (2 star_label "Reject", 3 "Weak"). **None** qualified/hot.
- Under the intended architecture (Aria-accepted only), **0 of 5 should have persisted.**
- Companies (Managed IT Services, etc.) are weak ICP matches — a candidate-quality
  issue, but the persistence of *rejected* rows is the architectural defect.

Representative `raw` (Jeff Esposito) confirms `canonical.final_score=0`,
`canonical_final_decision=needs_review`, `aria_score.star_label=Reject`,
`aria_score.overall_fit=20`, `why_accepted=["Rejected: matches a Company-Brain
disqualifier"]` — i.e. the row's own embedded verdict says *rejected*, yet it persisted.

---

## 8. Persistence-path trace (deployed run-agent v79)

All persistence happens **inside the `source_with_apify` tool call, during Scout's
turn**, before the handoff guard and before the Aria agent task.

1. **Insert** — `run-agent/index.ts:1401-1423` calls
   `writeMemoryFromToolCall` (`_shared/memoryWriter.ts`). For people this hits
   `writeApifyPeople` (`memoryWriter.ts:509-590`):
   - `memoryWriter.ts:576-588` inserts `lead_candidates` with `lead_type:"person"`,
     `raw:{ ...peopleDecision.patch, profile }`.
   - The **only** gate is `leadPersistenceDecision(...)` (`memoryWriter.ts:569`,
     `if (peopleDecision.blocked) continue`) — a **provenance-validity** check
     (`leadPersistenceGuard.ts`), **not** an Aria/tier acceptance check.
   - **No `artifact_type`** is written (no column; not in raw). The
     `person_candidate` artifact type computed at `run-agent/index.ts:993`
     (`artifactTypeForActor`) is used only for the routing-conflict guard
     (`:1000`) and is **never propagated to the insert**.
   - Provenance `actor_id` comes from `ctx.actor_id`, passed at
     `run-agent/index.ts:1415` as **`actor_id: planned_actor_key ?? "apify"`**.
     `planned_actor_key` was **null** this run → **`"apify"`** stamped as the
     *trusted* provenance block.

2. **Second pass** — `run-agent/index.ts:1432-1560` re-reads the rows and writes
   `fit_score`, `raw.aria_score`, `raw.analyst`, `raw.canonical`, `fit_tier`,
   `star_label`, `evidence_summary`, `evidence_violations`, and re-seals provenance:
   - `providerProvenanceCtx.actor_id` (`:1118-1119`) **correctly** resolves
     `provActorKey = planned_actor_key ?? derivedActorKey = "apify_people_search"`
     → `ACTOR_IMPL["apify_people_search"] = "harvestapi/linkedin-profile-search"`.
   - `sealProvenance(trusted, incoming)` (`leadPersistenceGuard.ts:sealProvenance`,
     called at `run-agent/index.ts:1542-1556`) sees `incoming.actor_id`
     (`harvestapi/linkedin-profile-search`) ≠ `trusted.actor_id` (`apify`) on the
     protected field `actor_id` → returns the **trusted** block unchanged and
     **`provenance_overwrite_attempt=true`**.

**Conclusions:**
- Insert happened **before** Aria (timestamps: leads 08:53:58–59, Aria 08:54:07).
- **Aria rejection is never checked** — persistence is "insert every accepted
  provider profile with valid provenance." Scoring is decorative and applied after.
- **`actor_id="apify"`** originates at `run-agent/index.ts:1415` (null
  `planned_actor_key` fallback that ignores `derivedActorKey`/`ACTOR_IMPL`).
- **`provenance_overwrite_attempt=true`** is a true-positive: the second pass tried
  to write the *correct* specific impl, but the immutability guard preserved the
  *wrong* generic value stamped at insert. Overwrite protection behaved per
  contract, but it is protecting the wrong initial value.
- **`artifact_type=null`** because the insert never carries it.

---

## 9. Job-era scoring language on person profiles — exact source

- **`_shared/leadAnalyst.ts:84`** — `if (c.jobUrl ?? c.source_url) evidence.push("a
  live job posting URL");` then `:87-88` →
  `evidenceSummary = "Verified source proof: a live job posting URL."`
  The analyst is job-shaped: any candidate with a `source_url` (a person's /in/ URL)
  is described as a job posting. run-agent calls it at `:1212-1227` passing
  `jobUrl: r.job_url ?? it.source_url` and `source_url: it.source_url`.
- **`_shared/evidenceType.ts:82-84`** — `checkEvidenceInvariants`: a `person_profile`
  carrying a hiring-flavored label (the row's `exact_hiring_signal`/`signalSummary`
  = the person's title, e.g. "Co-Founder/COO") → violation **`profile_as_job`**.
- **`_shared/evidenceType.ts:60-61, 88-90`** — every `person_profile` →
  **`identity_only_signal`** (a person alone is not a company-level signal). With
  `requested_signal:"required"`, this forces `canonical.final_score=0` /
  `fit_tier=rejected` for **every** bare person profile.

Net: the lead-quality / analyst / canonical / Aria-gate stack models evidence as a
**company hiring/funding signal**. A bare person profile is structurally scored as
"a job posting that fails to prove a company signal" → always rejected/weak, with
job-era wording. This is the defect behind `star_label=Reject`, `overall_fit≈20`,
`profile_as_job`, and "a live job posting URL".

---

## 10. Provenance & artifact-type status

| Concern | Finding |
|---|---|
| `provider` | `"apify"` (generic label, acceptable) |
| `actor_id` | **`"apify"` (generic)** — should be `harvestapi/linkedin-profile-search`. Root: `run-agent/index.ts:1415` null-fallback. |
| `actor_key` in provenance | **absent** (`selected_actor_key: planned_actor_key ?? null` = null). |
| `artifact_type` | **null / absent** — never persisted; exists only at the routing choke point (`:993`). Expected `person_candidate`. |
| `provenance_overwrite_attempt` | **true** on all 5 — second pass tried to write the correct impl; immutability guard kept the wrong generic value. |
| provenance trustworthiness | Identity is trustworthy (`verified=true`, real /in/ URLs, correct `provider_run_id`, `normalized_candidate_id`), but **actor-implementation detail is lost** and the overwrite flag signals an internal producer disagreement. |

---

## 11. Result classification

**PARTIAL ARCHITECTURE PASS / QUALITY-&-PERSISTENCE FAILURE.**

| Dimension | Verdict |
|---|---|
| Routing & actor selection | **PASS** |
| Real-person sourcing (structured input) | **PASS** |
| Country-aware location | **PASS** |
| Outreach safety (no drafts/approvals/sends/Penn) | **PASS** |
| Only provider-backed people reach persistence | PASS (5 provider profiles; no LLM fabrications persisted) |
| Only **Aria-accepted** people persist | **FAIL** — persistence precedes Aria and ignores it; all 5 are tier=rejected |
| Lead-quality / person-vs-job scoring | **FAIL** — job-era model rejects every person profile |
| Actor provenance detail | **FAIL** — `actor_id="apify"`, no `actor_key` |
| Artifact typing | **FAIL** — `artifact_type` never persisted |
| Provenance overwrite handling | Guard works, but protects the wrong value (flag=true) |

Success path demonstrated = **NO**. Safe to begin Agentory-vs-Claude benchmark = **NO**.

---

## 12. Blocking issues & smallest follow-up fix

**Blocking:**
1. Persistence is not gated on qualification (inserts every valid-provenance
   provider profile, all of them tier=rejected). *(architectural — largest)*
2. Person profiles scored with a company-signal/job model → always rejected + job-era
   wording (`leadAnalyst.ts:84`, `evidenceType.ts:82-90`).
3. Provenance `actor_id="apify"` + missing `actor_key` (`run-agent/index.ts:1415`).
4. `artifact_type` never persisted (insert omits it).
5. `provenance_overwrite_attempt=true` (consequence of #3).

**Smallest, safe next branch — suggested `find-leads-person-quality-persistence`:**

- **Quick, self-contained (do first):** at `run-agent/index.ts:1411-1415` pass the
  resolved specific actor into `writeMemoryFromToolCall`:
  `selected_actor_key: planned_actor_key ?? derivedActorKey` and
  `actor_id: provActorId` (the `ACTOR_IMPL`-resolved value). This fixes `actor_id`,
  restores `actor_key`, and eliminates the false `provenance_overwrite_attempt`
  (trusted == incoming). Also thread the routing artifact type
  (`artifactTypeForActor(...)`) through to the insert so `artifact_type=person_candidate`
  is stored. **No provider call, no migration** (raw jsonb).
- **Core defect:** introduce a person-evidence branch so a `person_profile` is scored
  as an identity candidate, not a company hiring signal — stop
  `leadAnalyst.ts:84` labelling `/in/` URLs "a live job posting URL", and stop
  `profile_as_job` firing for person rows; and **gate persistence on the
  qualification verdict** (persist only accepted, or persist as an explicit
  non-contactable review state) instead of "all valid-provenance items."
- Re-run Q1 only after the above lands; do not benchmark until a person request
  persists only qualified people with specific provenance and `person_candidate`
  artifact type.

---

## 13. Evidence provenance

All figures above are from read-only TEST (`zbwsbnqqpkvdhqwavjke`) queries against
`task_plans`, `tasks`, `activity_feed`, `lead_candidates`, `contacts`, `signals`,
`accounts`, `outreach_drafts`, `approvals`, `outreach_activities`, `company_brain`,
plus source tracing of `run-agent/index.ts`, `_shared/memoryWriter.ts`,
`_shared/leadPersistenceGuard.ts`, `_shared/leadAnalyst.ts`, `_shared/evidenceType.ts`,
`_shared/leadEntityIntent.ts` at `3cac54a8` (== deployed remix/main `1663a248`).
No credentials, keys, tokens or auth headers are included. No rows were modified; no
cleanup SQL executed; production not accessed.
