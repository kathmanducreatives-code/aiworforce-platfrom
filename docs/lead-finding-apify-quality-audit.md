# Find Leads — Apify query-quality audit

**Question:** for a prompt like *"Find founders of B2B SaaS companies hiring sales operations in the United States"*, does the backend understand the request, combine it with the Company Brain, build a precise Apify input, relax filters safely, and reject bad-fit leads — or is it generic scraping?

**Method:** static trace + deterministic tests (`_shared/leadFindingQueryQuality.test.ts`, `companyBrainConsumption.test.ts` from PR #25). No providers. Branch `lead-finding-apify-query-quality-audit`.

## Honest headline
The Find Leads backend is **substantially strong and genuinely signal/ICP-based, not generic scraping.** It has a structured intent parser, a tiered provider-query builder, a schema-validated Apify input planner with a deterministic fallback, an adaptive relaxation loop, and an evidence-first tiering/scoring engine. The real weaknesses were **upstream, in intent + relaxation**: SaaS-only category detection, incomplete role expansion, a default disqualifier that could sabotage an explicitly-targeted category, and — most important — **a plainly-named geography could be silently relaxed to a wider region**. Those are fixed here.

## Backend flow (actual)

```
prompt (frontend Workbench / leadActions.ts)
  → orchestrate (JWT + workspace_members membership)         [auth boundary]
  → company_brain.profile (active brain, workspace-scoped)
  → extractLeadSearchIntent(message, brain)                  leadSearchIntent.ts
  → buildProviderQueries(intent)  [strict→relaxed→broad]     leadProviderQueryBuilder.ts
  → planActorInput(...) → deterministic JSON + AI-proposed,  actorInputPlanner.ts
      schema-validated + strict-constraint-checked           actorInputSchemas/Validator.ts, actorRegistry.ts
  → runAdaptiveSourcing (staged relaxation)                  sourcingRetry.ts, actorBroadeningPlanner.ts
  → Apify actor run (per query) [PROVIDER — not run in audit]
  → normalizeApifyJobRow / leadIntake                        apifyJobsNormalizer.ts, leadIntake.ts
  → classifyLeadTier(candidate, intent) strict/secondary/reject  leadMatchTier.ts
  → leadQualityGate + companyIcpFilter (disqualifiers, evidence)  leadQualityGate.ts, companyIcpFilter.ts
  → scoreCompany / rankCompanies (explainable)              ariaScoring.ts, icpSignalScorer.ts, leadPreRank.ts
  → raw lead rows + source_quality                          leadOpportunity.ts, sourceQuality.ts
  → Workbench display + CSV export                          workbench/leadTable/csv.ts
```

## Stage table

| Stage | File/function | Input | Output | Uses Brain? | Gap | Fix |
|---|---|---|---|---|---|---|
| Intent parse | `leadSearchIntent.extractLeadSearchIntent` | prompt + brain | structured intent | yes (backfill) | SaaS-only categories; weak role expansion; geo not hard; default disq sabotages explicit target | **FIXED (G1–G4)** |
| Query build | `leadProviderQueryBuilder.buildProviderQueries` | intent | strict/relaxed/broad queries w/ per-tier evidence | via intent | — | ok |
| Apify input | `actorInputPlanner.planActorInput` + schemas/validator | query + actor schema | validated actor input JSON | via brain_context | — | ok |
| Relaxation | `sourcingRetry.parseStrictConstraints` + `buildAttemptStrategy` | message + criteria | staged plan (exact→aliases→industry→stage→location) | — | **named geography silently relaxed** | **FIXED (G1)** |
| Normalize | `apifyJobsNormalizer.normalizeApifyJobRow` | raw Apify rows | normalized job/company | — | — | ok (shortener drop, evidence) |
| Tier/evaluate | `leadMatchTier.classifyLeadTier` | candidate + intent | strict/secondary/reject + reasons + missing_evidence | via intent | — | ok (recruiter-proxy, funding contract, disqualifiers, non-SaaS) |
| Gate | `leadQualityGate` + `companyIcpFilter` | candidates + brain icp | accepted/rejected | yes | — | ok |
| Score/rank | `ariaScoring.scoreCompany/rankCompanies` | candidate + brain | explainable score, disqualified-loses | yes | — | ok |
| Display/CSV | `workbench/leadTable/csv.ts` | rows | table + CSV | — | missing `search_stage`/`query_used`/`relaxed_filters` columns | **recommended (not done)** |

## Example generated Apify input (deterministic path)

Prompt: *"Find founders of B2B SaaS companies hiring sales operations in the United States"* · Brain: B2B SaaS founders, avoid staffing/recruiting.

`buildProviderQueries` → strict query then relaxed/broad, e.g.:
```json
[
  { "provider": "apify_jobs", "keywords": "B2B SaaS Sales Operations", "location": "United States",
    "intent_tier": "strict", "required_evidence": ["company_category_match","exact_role_match","source_url"], "max_results": 5 },
  { "provider": "apify_jobs", "keywords": "B2B SaaS RevOps", "location": "Remote United States",
    "intent_tier": "relaxed", "required_evidence": ["company_category_match","adjacent_role_match","source_url"], "max_results": 5 }
]
```
`planActorInput` (hiring_signal actor) → validated input:
```json
{ "query": "Sales Operations B2B SaaS", "location": "United States",
  "role_keywords": ["Sales Operations","RevOps","Revenue Operations","GTM Operations"], "max_results": 5 }
```
- **From prompt:** role (Sales Operations), category (B2B SaaS), geography (United States).
- **From brain:** disqualifiers (staffing/recruiting), buyer roles (Founder/CEO/Head of Growth).
- **Fallback/default:** role alias expansion, per-query location rotation, max_results cap.

## Dynamic filter strategy — before → after

- **Hard filters** (never silently removed): disqualifiers, evidence/source_url, must-have category, recruiter-proxy rejection — all enforced by `classifyLeadTier`. **NEW:** an explicitly-named geography is now hard (`sourcingRetry`: `namedGeo` locks `strict.location`; `leadSearchIntent.relaxation_allowed.location = !location_explicit`).
- **Soft filters** (relaxed if thin): exact role wording, exact size, funding timing, sub-industry — via `buildAttemptStrategy` stages 2–4 and the `relaxed`/`broad` query tiers.
- **Expansion filters** (recall): role aliasing (`broaden.roleAliases`), industry synonyms, **NEW** Sales Operations → RevOps/Revenue Operations/GTM Operations, AE → Sales Executive, engineering/technical recruiter, lifecycle marketer.
- **Staged plan:** exact → role aliases → industry synonyms → relax stage → relax location (only if allowed) → terminal ("kept all constraints strict"). Location relaxation now blocked for a named geography.

## Gaps found + fixes

- **G1 (HIGH, safety) — FIXED:** a plainly-named geography ("in the United States") left `strict.location=false`, so `buildAttemptStrategy` relaxed location to a "wider region" at attempt 4+ and `validateSourcingResults` stopped filtering geo → out-of-geo garbage. Now a named geography is a hard filter unless the user says "anywhere/global/worldwide".
- **G2 (MED) — FIXED:** default disqualifiers include "recruiting/staffing agency"; a prompt explicitly targeting recruitment agencies would be sabotaged. Now those terms are dropped from disqualifiers when the prompt explicitly targets that category (priority: explicit prompt > default safety).
- **G3 (MED) — FIXED:** category detection was SaaS-only; ecommerce/recruitment/marketing-agency/fintech/healthtech/marketplace prompts fell through to a generic keyword search. Added those categories.
- **G4 (MED) — FIXED:** role expansion incomplete; "Sales Operations" didn't reach RevOps/Revenue Operations/GTM Operations, AE didn't reach Sales Executive, no recruiter/lifecycle-marketer roles. Added.
- **G5 (LOW) — recommended, not done:** CSV export lacks `search_stage`/`query_used`/`relaxed_filters` columns (needs those values plumbed from run-agent into the raw row first). `source_quality`, `gate_decision`, `gate_reasons`, `missing_evidence`, `disqualifiers_hit`, `why_now`, `run_id`, `parsed_intent_summary` are already exported.

## Evaluation / scoring / ranking (verified, unchanged — already strong)
`classifyLeadTier` rejects: no source proof, recruiter/staffing proxy (hidden employer), hard disqualifier, non-SaaS when SaaS required, generic-only role without SaaS+outbound evidence. Funding contract: a job post alone never proves funding (downgrade + `missing_evidence: recent funding proof`). `ariaScoring.scoreCompany` produces an explainable per-check `IcpMatch`, and disqualified candidates always lose (`starTier`). Recruiter proxy never outranks a founder; a company with no signal cannot outrank a verified hiring signal.

## Recommended live QA plan (needs explicit approval + a workspace with an active brain)
Run the 5 fixture prompts through the deployed `orchestrate`→`run-agent` with a real Apify token, capped at `max_results=3`, and inspect: generated queries, accepted/rejected counts, rejection reasons, and that no out-of-US rows appear for prompt 1. Not run in this audit (no token/JWT).
