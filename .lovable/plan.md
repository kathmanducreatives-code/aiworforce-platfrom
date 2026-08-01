## Reality check first

Two constraints must be settled before I start writing code, because they change what "done" looks like:

1. **I cannot open a PR or run git commands.** Git state is managed by the platform. I can produce all the code on this branch plus a patch artifact (as was done for PR #112/#113), but the PR number/URL has to come from your side after the branch syncs to GitHub. If you need a real PR number back, tell me and I'll produce the patch file and you push it.
2. **Scope.** This spec is 12 interlocking workstreams touching the strategist, the router, the query-pack compiler, the provider-input compilers, the bottleneck classifier, the feedback loop, the company-evidence path, the people-search progression, the execution limiter and the observability schema — plus 22 named proofs. That is not one focused PR; it is one focused *series*. I propose landing it as 5 sequenced changesets on this branch, each independently test-green, so nothing is half-wired at any point.

## What already exists (verified)

- `_shared/leadStrategy/` — provider-independent strategist (interface, config, factory, Lovable AI + OpenAI adapters, contract tests).
- `_shared/leadStrategyOwner.ts` — Luna → Terra → deterministic authority, already reachable from `run-agent/index.ts:932` but **only as the broadening planner** (`createLeadStrategyPlanner`), not as the initial planner.
- `_shared/intelligence/leads/` — an older Claude-derived adaptive stack (`leadStrategyAdapter.ts`, `leadQueryPacks.ts`, `leadSourceStrategy.ts`, `leadAdaptiveRoute.ts`) that still owns taxonomy/pack/source-plan validation.
- `_shared/sourcingBottleneck.ts` — current classifier, missing the 8 requested kinds.
- `_shared/companyFirstQuotaController.ts`, `compoundSourcingPipeline.ts`, `sequentialSourceBridge.ts` — the existing state machine and source runtime that must be reused, not duplicated.

The central design decision: the new `leadStrategy*` modules and the older `intelligence/leads` adaptive stack are **two planners today**. Collapsing them (adaptive stack becomes a pure validator/compiler consuming the GPT strategy; Claude adapter deleted from this path) is the core of the work and the main risk.

## Changeset 1 — Strategy authority

- Make `leadStrategyOwner` the initial planner for `qualified_lead_sourcing` + `company_first`; legacy initial planning stays untouched for every other workflow.
- Route later-round broadening and source-plan approval to the same owner. Remove Claude as an independent feedback authority (`leadAdaptiveRoute` / `sourceFeedbackRuntime` become consumers of the GPT strategist, not owners); `isPlannerTask` on Gemini is untouched for unrelated workflows.
- Persist provenance: model, authority source, validation result, fallback reason, role-family IDs, pack IDs, source order, plan hash.
- Proofs 1–5.

## Changeset 2 — Query packs and source order

- Pack IDs survive `leadStrategyOwner → validated strategy → ordered source steps → semanticIntent → provider compiler`; every source execution carries an exact pack ID.
- Reject/repair strategies where all sources receive one universal OR query without validated reason.
- Query-dependent, startup-aware ordering (YC → LinkedIn → Indeed → Glassdoor for the SaaS fixture); ATS stays discovery-excluded.
- Proofs 6–8.

## Changeset 3 — Provider inputs and idempotency

- Verified recency values for Indeed `datePosted`, LinkedIn `timePostedRange`, bounded Glassdoor `daysOld`.
- Drop the forced `onSite=true / remote=false / hybrid=false` unless the user asked for on-site only; no invented provider fields.
- Idempotency key derived from the finally-selected capability/actor, fixing LinkedIn calls keyed on the Indeed actor.
- Proofs 9–11.

## Changeset 4 — Honest diagnosis and adaptive response

- Extend the bottleneck taxonomy with the 8 requested kinds; the Indeed warehouse/retail pattern classifies as `poor_source_precision` / `excessive_title_noise`, and `company_brain_rejection` only fires on genuinely evaluated companies.
- Feed the bounded source observation back into the same strategist with the full 9-action vocabulary (tighten pack, run unused pack, activate direct-adjacent, advance source, enrich, people search, stop).
- Proofs 12–13.

## Changeset 5 — Evidence, progression, limits, observability

- Map provider-backed company fields (employee count, industry, description, website, LinkedIn URL, type, stage evidence) through normalizer → identity → evidence → Company Brain; `company_evidence_pending` triggers the existing enrichment path and re-evaluation. No fabrication, no unknown→negative.
- Qualified companies persist, halt surplus job collection, auto-run Founder/Co-Founder/CEO search with deterministic employer verification, contact enrichment, CONTACT-only quota.
- Replace the blind 3-round rule with a plan-aware bounded action limit (unused packs, unused sources, quota, budget, source-quality history).
- Observability rows sufficient to replay the run, including Apify run/dataset IDs; no credentials, no hidden reasoning.
- Proofs 14–22.

## Verification each changeset

`deno check`, TypeScript check, production build, the named Deno suites (strategist, routing, query-pack, compiler, idempotency, bottleneck, feedback, evidence, controller, people-search, quota), full backend suite, affected frontend tests. Mocked models and providers only — no Apify/Claude/Gemini/OpenAI/Firecrawl calls, no deploys, no migrations, no prod/TEST data writes. `supabase/functions/mcp/index.ts` untouched.

## Technical notes

- Everything lands in existing modules; no second planner, controller, source runtime, qualification pipeline or persistence path is created. The Claude-derived `leadStrategyAdapter.ts` is retired rather than paralleled.
- Company Brain, employer verification and CONTACT-only quota remain fully deterministic — the strategist gains no qualification authority.

Confirm the PR-mechanics question and whether you want all 5 changesets in this session (long) or Changeset 1 first for review.