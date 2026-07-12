# Find Leads — Phase A live wiring (run-agent + orchestrate)

Wires the merged Phase A `_shared` modules (PR #28) into the live edge path. The
modules were pure + unit-tested but unused by the runtime; this change makes the
runtime consume them and stamp their canonical outputs onto each lead.

## What changed

New pure module `supabase/functions/_shared/leadCanonicalStamp.ts`
(+ `leadCanonicalStamp.test.ts`, 7/7): `buildCanonicalStamp(facts)` composes all
five Phase A modules into one deterministic stamp — **zero provider calls**:

- `separateIntent` / `roleFamilyMatcher` → `role_exactness` + `run_trace`
- `leadDecision.reconcile` → `canonical_final_decision` (contact | watch | needs_review | skip)
- `leadDecision.contactReady` → `contact_ready` + `contact_ready_missing` (strict contract)
- `leadScoreBreakdown.scoreLead` → explainable `score_breakdown` + `final_score` + `confidence`
- `evidenceType` → evidence classification + integrity violations in the trace

`run-agent/index.ts`
- Computes `separateIntent` once per run (routing + relaxation), honoring an
  authoritative `lead_routing` threaded from orchestrate when present.
- Derives the requested `RoleFamily` (threaded `lead_intent.role_family` first,
  else detected) and per-lead role exactness via `roleFamilyMatcher`.
- Builds a canonical stamp per accepted lead from facts the pipeline already
  computes (Aria fit, proof gate, analyst brief, hiring signal).
- Persists it **additively** into `lead_candidates.raw` under NEW keys —
  `canonical_final_decision`, `contact_ready`, `contact_ready_missing`,
  `role_exactness`, `canonical`, `run_trace`, `search_stage`, `relaxed_filters`,
  `canonical_score_breakdown` (deliberately distinct from Aria's existing
  `score_breakdown`). Nothing existing is overwritten. **No migration** (`raw`
  is an existing jsonb column).

`orchestrate/index.ts`
- Computes `separateIntent` for sourcing/extraction intents, records it on the
  plan (`activity_feed.plan_created.metadata.lead_routing`) and threads it to
  run-agent as `lead_routing`.

## Safety

- Additive only: no existing `raw` field, `fit_score`, tier or gate behavior is
  changed; the current Workbench keeps working unchanged.
- Pure/deterministic composition; no Apify/Firecrawl/Anthropic calls added.
- Contact-ready can never be true without verified company identity + a real
  company signal + a verified decision maker with a profile URL + evidence URL
  (enforced by `contactReady`; covered by tests).
- Every stamp call is wrapped in try/catch and degrades to "not stamped" on error
  — it can never fail a run.

## Validation

- `deno check` run-agent + orchestrate: only the 4 / 8 pre-existing errors on
  `remix/main` remain (zero new).
- `deno test _shared/`: 880 pass, 1 pre-existing failure (URL-shortener test,
  unrelated).
- New module: 7/7 pass.

## Deploy (human, after review)

Not deployed here. After merge, **redeploy `run-agent` and `orchestrate`**.
Frontend Workbench consumption of `canonical_final_decision` / `contact_ready` /
`search_stage` / `relaxed_filters` is the follow-up (remaining item #2).
