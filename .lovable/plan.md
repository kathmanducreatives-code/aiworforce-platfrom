Continue on the current branch (HEAD `ad98778a`, clean tree). No restart, no new branch, no deploys, no live model/provider calls, no TEST/production data writes. `supabase/functions/mcp/index.ts` stays untouched and unstaged.

## Step 0 — Measured baseline (before any code change)

Check out latest `main` into a detached worktree, run the same shared Deno suite there, and record the exact pass/fail list. Only failures reproduced there may later be called pre-existing. The five current failures (`leadActionExecutor`, `sourceCapabilities`, `apifyJobsHiringSource`, plus two related env-dependent specs) get an explicit main-vs-branch table.

## Changeset 3 — Startup-aware source order + provider inputs

- Extend the strategist source-scoring input (role family, startup intent, business model, employee range, geography, source startup relevance, precision/recall priors, unused packs, prior source quality) and let the ordered-source runtime consume the returned `source_plan` ordering instead of the static default order. ATS stays excluded from discovery.
- Deterministic fallback ordering becomes signal-driven, not a fixed constant, so the startup fixture can yield YC → LinkedIn → Indeed → Glassdoor while a non-startup fixture does not.
- Provider compilation fixes in the actor input planner/compilers:
  - Indeed: emit a verified supported non-empty `datePosted` when recency is requested; never an empty string.
  - LinkedIn: verified non-empty `timePostedRange`; stop forcing `onSite=true` / `remote=false` / `hybrid=false`; unrestricted workplace when the user gave no restriction.
  - Glassdoor: `daysOld` bounded by the existing semantic recency policy.
  - No invented fields for SaaS / stage / employee count — those constraints are recorded as post-fetch qualification requirements on the prepared call.
- Tests: startup-first vs non-startup fixtures, pack separation preserved, non-empty recency fields, LinkedIn not on-site-only, compiled-payload snapshots validated against the verified Actor schemas.
- Commit, then continue.

## Changeset 4 — One GPT owner for feedback + plan-aware execution

- Route later-round broadening, source-plan approval and tool-input planning for `qualified_lead_sourcing` + `company_first` through the existing strategy owner (primary GPT → one escalation model → deterministic fallback). Gemini and Claude feedback paths are bypassed for this workflow only; all other workflows keep current routing.
- Bounded observation action set: `run_unused_query_pack`, `tighten_query_pack`, `advance_source`, `activate_direct_adjacent_pack`, `activate_evidence_gated_pack`, `begin_company_enrichment`, `begin_people_search`, `run_contact_enrichment`, `stop_success`, `stop_partial`.
- `tighten_query_pack` implemented over the existing source state: narrower unused pack, approved negatives, drop generic titles, keep role family, optionally switch source. No invented titles or provider fields.
- Bottleneck→action mapping: high off-family rate → tighten/switch; relevant titles + wrong companies → ICP-relevant source switch preserving title intent; missing evidence → `begin_company_enrichment`; qualified companies → `begin_people_search`; verified people without contacts → `run_contact_enrichment`.
- Replace the blind three-round stop for this workflow with a plan-aware action budget (unused exact packs, unused relevant sources, remaining CONTACT quota, remaining provider/model budget, source-quality history, remaining valid actions) plus a hard safety ceiling.
- Tests: zero Gemini calls, zero Claude feedback calls, same owner for initial + feedback, noise triggers tightening rather than replaying the same query on another Actor, quota reached stops everything, execution bounded.
- Commit, then continue.

## Changeset 5 — Company evidence + automatic progression

- Map source-backed company fields when present (employee count/range, industry, description, website, LinkedIn URL, company type, founding info, stage evidence, provider provenance) into the canonical company record. No fabrication.
- Keep explicit-negative / missing / conflicting evidence distinct. Strong hiring signal + strong identity but missing required evidence → `company_evidence_pending`, which invokes the existing approved enrichment path, attaches evidence to the same canonical company, re-runs Company Brain, and yields qualified / rejected / needs-review. Unknown is never a proven negative unless the workspace Company Brain declares missing evidence a hard blocker. Company Brain stays deterministic and final.
- Prove — not rebuild — the existing progression: qualified company → account row → founder/CEO search → deterministic employer verification → contact enrichment → same canonical opportunity updated → only CONTACT-ready counts. No new controller, people-search path, enrichment pipeline, persistence writer or quota system.
- Fixtures: ThisWay-Global-style enrichment reaching Company Brain; strong identity + missing evidence → pending; oversized company → deterministic rejection; employer mismatch → blocked; verified founder without contact evidence → pending; sufficient contact evidence → CONTACT-ready.
- Commit, then continue.

## Changeset 6 — Provider independence, canonical policy, observability

- Complete `QualifiedLeadStrategistProvider` with `createInitialStrategy` and `chooseNextAction` returning canonical responses; keep the Lovable AI and direct OpenAI adapters as the only provider-specific code. Everything else (policy, prompt builder, Company Brain injection, capability cards, schemas, parsing, validation, fallback, controllers, provider compilation, people search, quota, persistence) stays provider-independent.
- Selection stays purely configuration: `LEAD_STRATEGIST_PROVIDER`, `LEAD_STRATEGIST_PRIMARY_MODEL`, `LEAD_STRATEGIST_ESCALATION_MODEL`. OpenAI adapter is server-side only, reads `OPENAI_API_KEY` from server secrets, never reaches the browser.
- One canonical versioned strategist-policy file and one prompt builder; every initial and feedback call receives the full documented input set (query, Company Brain, saved ICP, quota, role intent, decision-maker roles, geography/recency, capability cards, provider limitations, remaining budget, completed packs/sources, current observation, allowed actions, output schema). No hardcoded workspace brain.
- Observability persisted per call: task id, provider, model, purpose, policy/prompt-schema/Company-Brain/Actor-catalog versions, prompt hash, structured request/response where permitted, validation result, repairs, authoritative source, fallback reason, pack ids, source step, compiled provider input + hash, dedupe counts, bottleneck, selected action, action authority, token/cost metadata, plus Apify run/dataset ids when returned. Never keys, credentials, auth headers or hidden reasoning.
- Tests: both mocked adapters produce identical canonical output under the same policy/schema; controllers import nothing Lovable-specific; switching is config-only; identical mocked responses give identical task behavior; every model call carries provenance.
- Commit.

## Final integration + verification

- One fully mocked end-to-end fixture through the real runtime for the startup/Sales-Ops query expecting five CONTACT-ready leads and `stop_success`, plus an honest Partial fixture yielding three.
- Run all focused suites listed in the request, the full shared backend suite, affected frontend suite, Deno check, TypeScript check and production build; diff against the Step-0 main baseline.
- Restore/verify `supabase/functions/mcp/index.ts` unstaged, scan the diff for secrets, open or update one focused PR against `main`. No merge, no deploy.

## Reporting

Final message returns all 19 requested items, including commit SHAs, baseline-vs-branch table, old/new call graphs, source-order proof, exact compiled payload examples, and the confirmations about deployment, live calls, data and `mcp/index.ts`.

## Technical notes

Primary touch points: `_shared/leadStrategy/*` (provider, config, factory, adapters), `leadStrategyOwner.ts`, `leadStrategyContract.ts`, `leadStrategyValidator.ts`, `leadStrategyBridge.ts`, `leadRoleTaxonomy.ts`, `sequentialSourceRuntime.ts`, `discoveryBatchAllocation.ts`, `actorInputPlanner.ts` / `actorInputSchemas.ts` / `actorSchemaFixtures.ts`, `sourcingBottleneck.ts`, `companyFirstQuotaController.ts`, `companyEnrichmentOrchestrator.ts`, `companyBrainGate.ts`, `companyRowProjection.ts`, `compoundSourcingPipeline.ts`, and `run-agent/index.ts`.
