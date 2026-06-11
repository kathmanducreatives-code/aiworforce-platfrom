# Phase 1 — Workflow Classifier Reliability

## Goal

Replace the two competing routers (`intentRouter` + `toolInputPlanner` decision logic) with one deterministic workflow-intelligence layer:

```text
user message
  → classifyWorkflow()        (regex-first, Gemini fallback)
  → normalizeIntent()         (coerce/clean Gemini output)
  → validateAgainstCapabilities()  (actor/tool/env/approval gates)
  → askClarification() OR createPlanTemplate()
  → existing tool execution path (unchanged)
```

Old files stay in place as thin wrappers so working flows (Apify Jobs, HarvestAPI people, Firecrawl URL, Scribe, Penn approval, Daily Brief) cannot regress.

## Architecture & Files

### New
- `supabase/functions/_shared/workflowClassifier.ts` — single source of truth. Exports `classifyWorkflow(message, ctx)` returning the structured `WorkflowDecision` object specified in the brief (all 14 categories + agents/execution_mode/selected_actor_key/etc.). Regex layer for high-confidence cases (greetings, capability Qs, URL, daily brief, explicit unsafe phrases, explicit people/jobs phrasing with city/role). Gemini fallback through `generateJson` constrained to the 14-category JSON schema, then `normalizeIntent()` cleans/clamps.
- `supabase/functions/_shared/capabilityValidator.ts` — exports `validateAgainstCapabilities(decision)` returning `{ ok, decision, clarification?, reason? }`. Checks: actor key exists in `ACTOR_REGISTRY`, `isActorRuntimeEnabled`, `max_results ≤ max_safe_results`, people-search opt-in/env gate, Firecrawl key for url_analysis, search_web availability for market_research, outreach forces `requires_approval=true`, unsafe categories block tool selection.
- `supabase/functions/_shared/workflowClassifier.test.ts` — Deno tests for all 14 categories with the messy prompts listed in the brief.
- `supabase/functions/_shared/capabilityValidator.test.ts` — Deno tests for: disabled people actor → clarification, market_research without search_web → honest-reply mode, url_analysis without FIRECRAWL_API_KEY → unavailable, outreach always sets `requires_approval`, unsafe blocks tool execution.

### Edited
- `supabase/functions/pilot-chat/index.ts` — replace the `classifyIntent` + `planToolInput` branching (lines ~482–565) with a single `classifyWorkflow` → `validateAgainstCapabilities` → branch on `workflow_category`. Behaviour per category matches the brief (simple_chat/capabilities → reply; daily_brief → existing daily-brief flow; content_creation → delegate to Scribe-only plan; url_analysis → Firecrawl plan; people/company sourcing → existing `delegateToOrchestrate` with a `ToolInput` built from the decision; outreach → require approval; market_research → honest reply unless search_web enabled; signal_sourcing vague → clarification; unsafe → safe canned reply; agent_management/approval_review → direct reply, read-only). Preserve existing pending-clarification resolver at lines ~290 (people-vs-companies stored actions) — it keeps working because the new classifier emits the same `clarification_type` metadata shape.
- `supabase/functions/_shared/intentRouter.ts` — keep file; reimplement `classifyIntent` as a thin adapter that calls `classifyWorkflow` and maps the 14 categories down to the old 10-value `Intent` union, so any other caller keeps working. Mark deprecated in a header comment.
- `supabase/functions/_shared/toolInputPlanner.ts` — keep file and its Gemini planner for building Apify/Firecrawl `ToolInput` payloads, but stop using it as a router. The new `workflowClassifier` becomes the decision-maker and only calls `planToolInput` to **fill in** structured tool args (role_keywords, location, max_results) when the regex layer already chose the actor. Existing People/Companies/Agency pending-clarification fields preserved.
- `supabase/functions/_shared/agentorySystemPrompt.ts` — add the 14-category vocabulary + content/market-research/unsafe rules into the `pilot_router` prompt block so Gemini's free-form replies stay consistent with the classifier. No prompt rewrites elsewhere.

### Not touched
schema, migrations, UI, secrets, `actorRegistry.ts`, `toolRegistry.ts`, `harvestApiPeople.ts`, all `src/**`.

## Category → plan template mapping

| Category | Agents | execution_mode | actor / tool | Approval |
|---|---|---|---|---|
| simple_chat | — | none | — | — |
| capabilities | — | none | — | — |
| daily_brief | pilot | none | existing daily-brief | — |
| content_creation | scribe | content | claude (if configured) else gemini | — |
| market_research | hawk, scribe | research | search_web if enabled, else honest reply | — |
| url_analysis | hawk, scribe | research | firecrawl_scrape_url / scrape_url | — |
| signal_sourcing (vague) | — | none | — clarification first | — |
| people_sourcing | scout, aria (+penn if outreach) | fast / outreach | apify_people_search | yes if outreach |
| company_hiring_sourcing | scout, aria (+hawk, penn if outreach) | fast / outreach | apify_jobs | yes if outreach |
| outreach | penn | outreach | — | **always yes** |
| agent_management | pilot | none | — | — |
| approval_review | pilot | none | read-only listing | — |
| unsafe_or_unsupported | — | none | — | — |
| unclear | — | none | — | — |

## normalizeIntent

Pure function that takes raw Gemini JSON and:
- clamps `confidence` to [0,1], defaults 0.5
- forces `workflow_category` into the 14-value enum (unknown → `unclear`)
- lowercases `execution_mode`, restricts to enum
- caps `max_results` at the chosen actor's `max_safe_results` (or 25 default)
- coerces booleans (`needs_enrichment`, `needs_outreach`, `requires_approval`)
- empties `selected_actor_key`/`source_type`/`query` if not strings
- if category is `outreach` → forces `requires_approval=true`
- if category is `unsafe_or_unsupported` → wipes `selected_tool`, `selected_actor_key`, agents

## validateAgainstCapabilities

Run after normalize. Returns either `{ ok: true, decision }` or `{ ok: false, decision, clarification, reason }`.

Checks in order:
1. If `selected_actor_key` set, must exist in `ACTOR_REGISTRY` and `isActorRuntimeEnabled` → otherwise rewrite to clarification with the actor's `missing_message` (or honest "not configured").
2. `people_sourcing` + actor disabled or no opt-in → switch to honest fallback "I can find companies hiring those roles instead."
3. `url_analysis` requires `FIRECRAWL_API_KEY` (env check via `actorRegistry` helpers) — else honest unavailable.
4. `market_research` requires `search_web` enabled — else degrade to direct honest reply mode (decision.execution_mode → "none", agents → []).
5. `outreach` → always set `requires_approval=true`, refuse autosend.
6. `max_results` > actor cap → clamp + add note.
7. `unsafe_or_unsupported` → strip any tool/actor/agents.

## Compatibility strategy

- `intentRouter.classifyIntent` keeps its old signature/return; internally calls `classifyWorkflow` and maps:
  - simple_chat/capabilities/agent_management/approval_review → `simple_chat`
  - daily_brief → `daily_brief`
  - content_creation → `content`
  - market_research → `simple_chat` (no Apify) — degraded honest reply branch
  - url_analysis → `analyze_url`
  - people_sourcing / company_hiring_sourcing / signal_sourcing → `source_signals`
  - outreach → `draft_outreach` or `send_requires_approval` based on verbs
  - unsafe_or_unsupported / unclear → `unclear`
- `toolInputPlanner.planToolInput` keeps existing behaviour; pilot-chat calls it only after classifier picks a sourcing category so the existing pending-clarification persistence (people/companies/agency stored actions) keeps working end-to-end.
- One final normalized decision per request: pilot-chat will only branch on `workflow_category`. The old `intentResult.intent` value is still computed for legacy log fields but does not gate execution.

## Tests

`workflowClassifier.test.ts` covers each of the 14 categories with the exact prompts from the brief, asserting `workflow_category`, `selected_actor_key`/`tool_name` where applicable, `needs_clarification`, and `requires_approval`.

`capabilityValidator.test.ts` covers: disabled people actor fallback, missing Firecrawl key, search_web off → honest reply, outreach approval enforcement, unsafe stripping, max_results clamp.

Run via `supabase--test_edge_functions` (Deno). No live calls in unit tests.

After unit tests pass, run the 10 live prompts from the brief against the **preview** project only (`wqnigjhcwjxtmordrwno` is shared — we'll use existing preview workspace, no production conversations). Report card per prompt: category, response, clarification?, plan?, actor, tool_calls, approval, pass/partial/fail.

## Out of scope / will not change

- DB schema, migrations, UI components, secrets, new Apify actors.
- Persistent Signal Memory, LinkedIn Engagement Engine, Competitor Tracker, Signal Feed UI, ICP Autopilot, Founder Content Loop (later phases).
- No deletion of `intentRouter.ts` / `toolInputPlanner.ts` in this pass.
- No deployment until unit + live tests pass and you approve.

## Deliverable on completion

Final report containing: files changed, 14 categories implemented, category→plan table, normalize/validate descriptions, compatibility notes, unit test results, live test results table, remaining gaps, deploy recommendation (await your go-ahead).
