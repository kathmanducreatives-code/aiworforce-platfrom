# The discovery evidence contract (Apify today, Apollo and LeadOcean next)

One qualification authority decides every company, whatever provider found it:

```ts
evaluateEligibility(criteria, graph, criterion_verdicts, holds)   // _shared/candidateEligibility.ts
```

- `criteria` are `deriveMissionCriteria(mission, readiness)`.
- `graph` is `buildCompanyEvidenceGraph(key, items)`.
- `criterion_verdicts` are the strict parser's evaluator answers.
- `holds` are the engine's holds.

A provider does not decide eligibility. It contributes **evidence items** and, when a paid route can close a gap, a **claim route**. Everything below is enforced by code and tests, not by convention.

## 1. Evidence items (`EvidenceItem`, `_shared/candidateObservation.ts`)

| Field | Rule |
|---|---|
| `dimension` | One of the evidence dimensions (`geography`, `company_size_band`, `hiring`, `job`, `funding`, `industry`, …). A requirement no dimension answers is `unprovable_today` and is disclosed at approval. |
| `value` | What the provider said, unmodified. |
| `status` | `proven` / `plausible` / `disproven` / `unknown`. It is set by the **authority layer**, never by the adapter (see 2). |
| `source` | `{ provider, actor, provider_call_id, url, excerpt }`. `actor` must be the provider route's own key (e.g. `apollo_organization_enrich`). Generic labels are not allowed: the registry's `"linkedin"` label once made a job row look like a fetched company record (canary session 2). |
| `observed_at`, `valid_until` | When it was read, and how long it stays fresh. Stale evidence decides nothing. |
| `authority` | `authorityForEvidence({ claim, source, field, quality })` from `_shared/evidenceAuthority.ts`. |

## 2. Authority: what a source may PROVE

`AUTHORITY_RULES` names each source × field × claim that may prove a fact. Anything else is `plausible`, and a plausible item ranks a candidate but never passes or fails a hard requirement.

- **Headquarters** is proved only by a company record that flags exactly one headquarters (`li_record_flagged_headquarters`). Such a fact is not lowered by an evaluator's evidence-free `unknown`. A `fail` with receipts still lowers it.
- **A job posting's location is never headquarters.** A job row proves an open role (`job_evidence`) and nothing about where the company is based.
- **Funding** is proved by the canonical funding route (`canonical_funding_pair`). A company profile cannot speak for funding (`SOURCE_CANNOT_SPEAK`). Atomus alone settles **recency**: a dated round inside the window passes, and its round count lets an empty window fail. **Stage** needs the cited pair (Atomus + Pvalyou).
- **A new provider proves nothing until a reviewed rule names it.** For example, Apollo's organization `country` may become an HQ rule only after it has been checked the way the LinkedIn flag was.

## 3. What every outcome means

| Situation | Item | Eligibility |
|---|---|---|
| The provider answered with the fact | `proven`, under a rule | `pass` or `fail` |
| The provider answered without the field | none | `pending`. Missing evidence is never a failure. |
| The provider errored, timed out, or the gate refused | none; the outcome is recorded as `provider_error`, `admission_refused`, … | `pending`; the route stays open |
| A proven fact contradicts the requirement | `proven` | `ineligible` |
| A requirement no source can answer | none | `pending`, with a blocked check, disclosed at approval |

`pending`, `ineligible`, a failed call, and `qualified` (a label) stay distinct all the way to the Workbench (`workbench_mission_view.bucket`).

## 4. Routes (`CLAIM_REGISTRY`, `_shared/evidenceGapRouter.ts`)

A provider that can close a gap registers a `ClaimRoute`:

- `actor` and `capability`;
- `evidence_actors`, the provider's own actor keys and nothing broader;
- `canonical_executor`, plus readiness from `routeReadiness.ts`.

The router marks a route `tried` only when that actor answered for this company, or when an answered enrichment says so (`attemptedRoutesOf`).

A candidate receives a paid verification only when every unknown hard claim still has an executable route (`canStillQualify`). It also waits while a cheap stage (company details) is still open.

## 5. Paid calls

Every purchase is made through a `ProviderCallSpec`, which provides:

- the readiness and contract checks, plus the estimate measured against its ceiling;
- a ledger reservation under an idempotency key;
- the smoke admission gate in TEST, which applies per-actor starts, units, `maxTotalChargeUsd`, and a durable attempt count.

A refused purchase is never retried, repaired or escalated.

## 6. Trace

Each slice persists `capability_execution_state.verification_decisions`: every candidate × verifier, with the reason it was or was not taken. Reasons are `targeted`, `cheap_stage_first`, `cannot_still_qualify`, `no_gap_for_this_verifier`, `not_pending`, `paid_verification_blocked` and `over_target_cap`. Each record includes the open gaps the router saw. `evaluation_paths` and `mission_evaluation_observability.calls_failed` record whether the evaluator really answered.

## 7. Status of PR #195 (`discoveryProviders/`)

PR #195 carries its own verifier (`verify.ts`) and requirement mapping, and does not call `evaluateEligibility`.

- **What it inherits.** It reads the compiled `criteria`, so it gains this repair's compiler changes: no restated requirements, and `unprovable_today` instead of a silent `ok`.
- **What it does not inherit.** Authority rules, routing state, model-failure handling and the decision trace do not reach it.
- **Before it runs on missions with hard requirements:**
  1. Emit its records as `EvidenceItem`s with provider-specific `actor`s.
  2. Add reviewed `AUTHORITY_RULES` for any field it should prove.
  3. Decide eligibility with `evaluateEligibility`.

This document asks for no change to that PR. It states the contract the shared engine already enforces.
