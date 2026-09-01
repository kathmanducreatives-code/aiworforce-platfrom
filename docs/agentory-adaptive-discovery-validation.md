# Validation: Adaptive Multi-Source Discovery Upgrade Plan

**Read-only validation. No implementation, no deployment, no provider calls, no credits, no data mutation.**

Validated against: repository at `feat/lead-mission-v1`, persisted result of production run
`7e71d8bc-69f6-444e-a43e-3acb684a7d44`, and the live Apify Store schema for
`harvestapi/linkedin-company-search`.

**VERDICT: VALID WITH CHANGES.**

The diagnosis is correct and the target architecture is sound. Roughly **half of what
the plan proposes to build already exists** in the repository, unwired. Three
assumptions are wrong or misplaced, and one proposed behaviour conflicts with an
existing terminal condition in a way that would silently defeat the upgrade.

---

## 1. Current architecture summary

A GPT planner selects discovery actors from `discoveryCatalogBriefing()`; code validates
and repairs the selection; one `primary` actor runs; the loop stops when raw rows reach
`maxCandidates`. Everything after that — triage, shortlist, investigation, hiring
verification, Company Brain — operates on whatever that single batch produced.

Mission-level continuation is already **quota-driven**: `decideAutoContinuation`
(`leadAutoContinuation.ts:228`) stops on `quota_met`, cancellation, or an exhausted pool,
bounded at `DEFAULT_MAX_CONTINUATIONS = 10` (cap 25). The row-driven stop exists **only
inside the discovery batch loop**.

## 2. Proposed architecture summary

Replace the row-count stop with a usable-yield stop; measure admitted candidates after
each batch; replenish by paginating a productive source, then breadth, then an alternate
route; treat hiring/funding/YC as first-class discovery routes; carry source state across
slices.

## 3. Assumption-by-assumption validation

| # | Assumption | Verdict | Evidence |
|---|---|---|---|
| 1 | Discovery stops on raw `companies.length` | **CONFIRMED** | `leadCapabilityEngine.ts:3648` `if (companies.length >= maxCandidates) break;` and `:3653` passes `companies.length` to `shouldRunSelection` |
| 2 | Admitted yield is available or computable pre-selection | **CONFIRMED — already computed, far too late** | `prequalifyDiscoveredCompanies` (`leadGenericPrequalification.ts:317`) is free, deterministic, no GPT, no provider. Called at `leadCapabilityEngine.ts:7910` — ~4,260 lines **after** the loop breaks |
| 3 | Same-actor pagination can be added safely | **CONFIRMED** | Different `startPage` ⇒ different `input_hash` ⇒ different `logical_call_key`. New spend, correctly attributed, no idempotency conflict |
| 4 | `startPage`/`takePages`/`maxItems` supported | **CONFIRMED, with a repo contradiction** | Live Apify schema has all three (`takePages` max 20 → 1000 rows). `ACTOR_INPUT_CONTRACTS.apify_linkedin_company_search` (`actorInputContracts.ts:151`) declares them. Card `input_limits` declares `takePages: 20, maxItems: 1000`. Card `supported_filters` **omits** them — and the dropper reads `supported_filters`, so run `7e71d8bc` recorded `dropped_filters: startPage` with reason *"has no such input"*, which is false |
| 5 | breadth/fallback machinery already exists | **CONFIRMED** | `DiscoveryActorRole = "primary" \| "breadth" \| "fallback"` (`leadDiscoveryStrategy.ts:69`); `shouldRunSelection:964` implements the contract correctly |
| 6 | Legacy adaptive execution is disabled | **CONFIRMED** | Run logs: `[adaptive-enforcement] will_run_another_source: true, decision: null`; `[broad-job-fallback] blocked: "execution_owned_by:capability_engine_v1"` |
| 7 | `hiring_signal` is not a discovery purpose | **CONFIRMED** | `DISCOVERY_PURPOSES` (`leadDiscoveryStrategy.ts:193`) = `company_discovery`, `funding_discovery`, `social_discovery`, `news_signal`. `harvestapi/linkedin-job-search` is carded `capabilities: ["hiring_signal"]` only, so it is never briefed to the planner |
| 8 | Job Search could support employer-first discovery | **CONFIRMED — identity join already correct** | `NormalizedHiringJob` (`hiringActorNormalizers.ts:47`) already carries `company_name`, `company_linkedin_url`, `company_source_id`. `companyKey()` (`leadCapabilityEngine.ts:1422`) keys on `linkedin_company_url ?? canonical_domain ?? external_source_id` — the join needs no new identity concept |
| 9 | YC cohort containment should stay | **CONFIRMED** | `COHORT_MEMBERSHIP.y_combinator` (`leadDiscoveryStrategy.ts:508`) admits on `stages` matching startup/seed/series-a/early/venture, or the query naming YC. It is protecting correctness, not suppressing recall |
| 10 | Structured locations are collapsed before triage | **CONFIRMED, but the plan blames the wrong module** | The collapse is at the **normalizer**: `hiringActorNormalizers.ts:114` sets `geography: s(r.allLocations) ?? …` — one string. `NormalizedHiringCompany` has **no** locations array at all. `toTriageInput:1408` merely passes the already-flat scalar through, and separately flattens `industries` to `[provider_industry]` |
| 11 | Multi-slice continuation can support this | **CONFIRMED — and largely already built** | `decideAutoContinuation` is already quota-driven and bounded. What is missing is **discovery-source state**, not the slice loop (see §5.2) |

## 4. Current vs proposed

| Area | Current | Proposed | Compatible? | Required change | Risk | Tests needed |
|---|---|---|---|---|---|---|
| Discovery completion | `companies.length >= maxCandidates` | `admitted >= poolTarget` | **Yes** | Substitute the counter at `:3648`/`:3653` | Low | Loop continues on a low-yield batch; stops on a high-yield one |
| Admitted counting | computed at `:7910` | computed inside the loop | **Yes — function already exists** | Hoist `prequalifyDiscoveredCompanies` call | **Low** — free, deterministic, no GPT/provider | Same input ⇒ same verdict at both call sites |
| Merge + dedupe across batches | — | required | **Yes — already exists** | Reuse `mergePrequalification` (`leadGenericPrequalification.ts:395`), which dedupes on `company_key` and accumulates `eligible_companies` | Low | Page 1 ∪ page 2 with overlap yields no duplicates |
| Pagination | dropped on a false premise | first replenishment | **Yes** | Fix `supported_filters`; pass `startPage` | Low | `dropped_filters` no longer names `startPage` |
| breadth/fallback | unreachable | reachable | **Yes — no new code** | Follows automatically from the counter fix | Low | `shouldRunSelection` reached with a low admitted count |
| Job-first discovery | impossible | optional route | **Yes** | Add a discovery purpose + card `linkedin-job-search`; add job→company projection | **Medium** — new pool-entry path | Employer dedupe; spend identity; no company without `company_linkedin_url` |
| Structured geography | flattened at normalizer | preserved | **Yes** | Three-point change: normalizer + `NormalizedHiringCompany` + `toTriageInput` | **Medium** — touches the canonical shape | Multi-office company keeps every location through triage |
| Slice continuation | already quota-driven, bounded 10 | unchanged | **Already implemented** | None | — | — |
| Source state across slices | **absent** | required | **Yes** | Three-point change on `Checkpoint` (write + interface + read) | **Medium** — see §5.2 | Resume does not restart at page 1 |
| `pool_exhausted` terminal | ends the lineage | should trigger replenishment | **CONFLICT** | See §5.1 | **High** | Exhausted pool with quota unmet replenishes rather than stopping |

## 5. Problems in this proposal

### 5.1 The `pool_exhausted` conflict — the highest-risk omission

`decideAutoContinuation` treats an exhausted pool as a **terminal answer**:

> *"AN EXHAUSTED POOL IS A REAL ANSWER. Everything discovered has been investigated or
> decided; a further slice has nothing to look at."*

Under the current design that is correct — nothing can widen the pool. Under the proposed
design it becomes **exactly the condition that should trigger replenishment**, and it
fires *before* replenishment gets a chance. Fix the discovery loop alone and the mission
still stops early, one layer up, for a reason that is no longer true.

The plan never mentions this. It must be addressed in the same change, or the upgrade is
inert.

### 5.2 §12 overstates the new state; §11 is already built

Most of the "state that must survive every slice" already survives. `CompanyWorkingSetSnapshot`
(`leadResumeState.ts:249`) already persists `prequalified` + `prequal_key`, `triage`,
`enriched`, `identity`, `investigation_state`, hiring assessment. Multi-slice execution
already works — run `7e71d8bc` produced a continuation.

**Genuinely new run-level state** — and the `Checkpoint` interface (`:623`) has none of it:
`discovery_pages_used`, `sources_attempted`, `source_yield_history`.

`readWorkingSetSnapshot` (`:738`) is an **explicit allowlist**: a field written but not
read back is silently dropped on every restore, a failure this repo has already been bitten
by twice (documented in that function's own comments). Any new checkpoint field needs
**all three**: `buildCheckpoint` write, interface declaration, and parser read.

Mitigating nuance the plan should record: forgetting page state costs a **wasted slice, not
wasted money** — page 1 re-run has an identical `input_hash`, so it is adopted as a
completed operation rather than re-bought.

### 5.3 §5's "useful candidate" definition is not currently computable

The plan defines admission as `UK presence AND employeeCount 20–200 AND not excluded AND
usable identity`. Three of four are available today. **"Real UK presence" is not** —
`NormalizedHiringCompany.geography` is already a single flattened string by the time any
admission check could run (`hiringActorNormalizers.ts:114`).

So there is an **ordering dependency the plan does not state**: either ship the counter fix
with admission on `employee_count` + identity only, or fix the normalizer first. Shipping
"presence-aware admission" without the normalizer change would silently admit on a
substring match against a flattened string.

**Recommendation: ship the counter fix first with size + identity admission.** That alone
reproduces the 34/50 figure the plan's own worked example uses, because all 50 rows had UK
presence and size was the only discriminator.

### 5.4 §15E is aimed at the wrong module

"Do not collapse `locations[]` into only one scalar location before triage" — the collapse
is at the normalizer, not triage. Fixing `toTriageInput` alone changes nothing, because the
array no longer exists by then.

### 5.5 Already implemented — do not rebuild

- **merge + dedupe** — `mergePrequalification` (`leadGenericPrequalification.ts:395`)
- **breadth/fallback selection** — `shouldRunSelection` (`leadDiscoveryStrategy.ts:964`)
- **admitted-candidate computation** — `prequalifyDiscoveredCompanies` (`:317`)
- **multi-slice continuation, quota-driven and bounded** — `decideAutoContinuation` (`:228`)
- **spend idempotency across pages/sources** — `logical_call_key = lineage_root:capability:input_hash`

### 5.6 Unnecessary for the first implementation

§13 provider strategy memory — correctly flagged by the plan itself as a later optimization.
Agreed; it needs yield history that does not exist yet.

## 6. Exact minimal implementation path

The capability engine does **not** need a rewrite. The minimal correct change is four edits
plus one guarded addition.

### MUST FIX FIRST

**M1 — Count admitted candidates, not rows.**
`leadCapabilityEngine.ts:3648`, `:3653`. Hoist the existing free prequalifier into the loop;
accumulate with the existing `mergePrequalification`; compare `eligible_companies` against a
pool target from `decideDiscoveryBatchSize` (`discoveryBatchSize.ts:84`).
*Admission for v1: `employee_count` bounds + usable identity. No geography.*

**M2 — One authoritative input contract.**
Make `ACTOR_INPUT_CONTRACTS` authoritative for field existence, or widen the card's
`supported_filters` to match its own `input_limits`. Today three repo sources disagree and
the narrowest silently wins.

**M3 — Teach `decideAutoContinuation` about replenishment.**
`pool_exhausted` must not be terminal while quota is unmet, a discovery route remains
untried, and the spend ceiling allows. Without M3, M1 changes nothing at mission level.

**M4 — Persist discovery-source state.**
`Checkpoint` + `buildCheckpoint` + the parser: `discovery_pages_used`, `sources_attempted`,
`source_yield_history`. All three points, or it does not survive a resume.

### PHASE 2

**P1** — Preserve structured geography: normalizer (`:114`), `NormalizedHiringCompany`,
`toTriageInput`. Then extend admission to presence.
**P2** — Job-first discovery: new discovery purpose, card `linkedin-job-search` for it,
job→company projection reusing `NormalizedHiringJob.company_linkedin_url`, employer dedupe
through `companyKey()`.
**P3** — Populate `fallback_actors` on discovery-capable cards (currently `[]` for company search).

### OPTIONAL / LEARNING LAYER

**O1** — Record admitted-yield per actor per mission shape.
**O2** — Route choice from observed yield rather than planner heuristics.
**O3** — Register `harvestapi/linkedin-profile-search` as a discovery route.

## 7. Direct answers

**What should replace `companies.length`?**
`mergePrequalification(...).eligible_companies` — the accumulated count of companies passing
free hard constraints. Not a new concept; the field already exists.

**Where should admitted counting happen?**
Inside the discovery selection loop, `leadCapabilityEngine.ts:3641–3660`, immediately after
normalization and before the next `shouldRunSelection` decision.

**Where should the pagination decision live?**
Same loop, ahead of provider switching: if the current actor's yield is healthy and pages
remain (`input_limits.takePages`), re-invoke it with an incremented `startPage`.

**Where should breadth/fallback switching live?**
It already lives in `shouldRunSelection`. It needs no new home — only a truthful
`collectedSoFar`.

**Can job-first discovery reuse existing normalizers safely?**
Yes. `NormalizedHiringJob` already carries `company_name`, `company_linkedin_url`,
`company_source_id`. What is missing is a **projection** from job rows to
`NormalizedHiringCompany`, plus a rule that a job with no `company_linkedin_url` cannot
create a pool entry.

**How should job employer identity join the canonical pool?**
Through the existing `companyKey()` — `linkedin_company_url ?? canonical_domain ??
external_source_id` — and through `mergePrequalification`'s dedupe. No new identity concept.

**What provider calls remain lineage-idempotent?**
All of them. `logical_call_key = <lineage_root>:<capability>:<input_hash>` with `input_hash =
providerInputFingerprint` over `canonicalJson({actorKey, input})`. Page 2 differs from page 1
in `startPage`, so it is a distinct, correctly-billed operation; a replayed page 1 is adopted,
not re-bought.

**What state must be added to checkpoints?**
`discovery_pages_used`, `sources_attempted`, `source_yield_history` — run-level, three-point
change. Per-company state needs nothing new.

**How does a mission continue across slices?**
Unchanged. `decideAutoContinuation`, bounded at 10 continuations (cap 25), with checkpoint
restore. The only change is M3, so an exhausted pool no longer ends a mission that could
still replenish.

**What terminal conditions stop the mission?**
`quota_met`; cancellation; spend ceiling; **all discovery routes exhausted** (replacing
today's "pool exhausted"); continuation cap; truthful provider exhaustion.

## 8. Test plan

| Test | Asserts |
|---|---|
| low-yield batch continues discovery | 50 rows / 5 admitted ⇒ loop does not break |
| high-yield batch stops discovery | 50 rows / 45 admitted ⇒ loop breaks |
| pagination precedes provider switch | healthy yield + pages remaining ⇒ same actor, `startPage: 2` |
| dedupe across pages | overlapping pages ⇒ no duplicate `company_key` |
| `startPage` survives compilation | `dropped_filters` never names `startPage` |
| prequalifier parity | identical verdict at the loop site and at `:7910` |
| checkpoint round-trip | source state written **and read back** — the allowlist trap |
| replenishment beats exhaustion | pool exhausted + quota unmet + route untried ⇒ continue |
| spend identity | page 2 is a new `logical_call_key`; replayed page 1 is adopted |
| YC containment intact | non-startup mission still refuses YC actors |
| geography unchanged in v1 | presence semantics preserved; no HQ-only filtering introduced |

## 9. Deployment scope

Edge functions only — no migrations. `Checkpoint` gains optional fields, which the existing
"absent value narrows to a safe default" convention already handles, so old checkpoints
restore unchanged. Deploy `run-agent` and shared modules together; M1 and M3 must ship in the
same deployment or the upgrade is inert.

## 10. Final verdict

**VALID WITH CHANGES.**

Required amendments to the plan:

1. **Add the `pool_exhausted` conflict as a MUST FIX.** Missing from the plan and sufficient
   on its own to make the upgrade inert.
2. **Correct §15E** — geography collapses at `hiringActorNormalizers.ts:114`, not at triage.
3. **Correct §5** — presence-based admission is not computable until the normalizer is fixed.
   Ship v1 admission on size + identity.
4. **Downgrade §11 and most of §12** — multi-slice execution and per-company state already
   exist; only run-level source state is new.
5. **Record what already exists** — `mergePrequalification`, `shouldRunSelection`,
   `prequalifyDiscoveredCompanies`, `decideAutoContinuation`. Do not rebuild them.
6. **Keep §16 intact.** Nothing in the minimal path weakens lineage, spend idempotency,
   checkpoint restore, or truthfulness semantics.

The plan's central claim — *stop because we found enough good leads, not because we fetched
enough rows* — is correct, and is a smaller change than the document assumes.

---

*Validation only. No code changed, no provider calls, no credits, no deployment.*
