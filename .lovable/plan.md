# Claude-first Canary — Disable + Read-Only Forensic Audit

Scope: production project `wqnigjhcwjxtmordrwno`, workspace `e510c1a6-2bb8-4aa4-95f7-0beb786ed995`. No provider calls, no deploys, no code changes, no workflow re-runs. The only state change is setting one secret to `false`.

## Step 1 — Disable the flag (only mutation)

- `secrets--set_secret` → `CLAUDE_FIRST_LEAD_PLANNING = "false"` on prod.
- `secrets--fetch_secrets` → confirm value.
- Leave `CLAUDE_FIRST_LEAD_PLANNING_WORKSPACES` in place for forensic comparison.

## Step 2 — Environment + deployment provenance

- `supabase--project_info` → confirm project ref `wqnigjhcwjxtmordrwno`.
- Read current deployed `run-agent`, `orchestrate`, `pilot-chat` metadata (version, deployed_at) via supabase tools; compare `deployed_at` to the failed task's `created_at` to prove whether PR #101 code was live at run time.
- Cross-check tree markers of PR #101 (`_shared/qualifiedLeadRouting.ts`, continuation RPC usage, company-first funnel diagnostics) against what the deployed bundle reports.

## Step 3 — Locate the failed task (read-only SQL)

Query `public.tasks` + `public.task_plans` in workspace `e510c1a6…`, most recent match on:
- instruction equals the exact prompt,
- `result` diagnostics show 20 reviewed / 0 accepted,
- rejection reasons include `wrong_role` or strict-location.

Return: task_id, plan_id, conversation_id, created_at / finished_at, `status`, `result.terminal_status`, `continuation_claim_*`, `checkpoint_version`, round number, quota requested / eligible / remaining.

## Step 4 — Planner provenance

From the task's `result` / `plan_summary` diagnostics report (no prompts, no keys):
planner source, provider, model, planner_status, deterministic_fallback flag + reason, strategy_hash, selected capabilities, accepted / rejected / approval-required titles.

Do not assume Claude caused the failure — same symptom was seen with the flag off.

## Step 5 — Company-first funnel counts

From diagnostics, report the funnel stage-by-stage: raw jobs → relevant jobs → unique hiring companies → qualified companies → companies passed to people search → people returned → founder/CEO candidates → current-employer matches → CONTACT-ready → WATCH → REJECT/SKIP.

Confirm the runtime executed: discover hiring companies → qualify → decision-maker search within them → verify current employment → contact-ready gate. Flag any people-first / generic search.

## Step 6 — People-search input inspection

From the compiled provider inputs recorded in `tool_calls` / task diagnostics (secret-free): capability, adapter, company URLs / names supplied, current-company filters, titles supplied, geography, per-call result limit, number of company-scoped searches, idempotency keys, actual provider call count + cost.

Expected titles: Founder, Co-Founder, CEO. Forbidden: Sales Ops, Rev Ops, GTM Ops, SDR, BDR, AE.

Trace the title set through: mission → strategy → compiler → adapter → provider request. Identify the first layer where decision-maker titles are lost (compare against `_shared/decisionMaker/searchPlanner.ts` `TITLE_FILTERS` and `sourcingConstraints.ts` `hard.requestedTitles`).

## Step 7 — Company scoping audit

For each people-search `tool_calls` row, determine scope key: linkedin company URL, linkedin id, verified domain, or name+location — via `scopedPeopleSearch.ts::buildPeopleScope`. Count: qualified companies searched, qualified companies with no people query, results whose resolved `companyDedupeKey` did not match the scope (via `resultBelongsToScope`), employer-match outcomes, ambiguous identities.

## Step 8 — Location-rule audit

Locate the geography validator in the people-qualification path and classify what evidence it accepts: (A) hiring-job geo, (B) company HQ/operating geo, (C) personal profile geo. Report the exact file/function and the hierarchy it uses.

Classify each location-based rejection: no job geo / no company geo / no personal profile geo / conflicting / parser failure / other. Do not loosen the rule.

## Step 9 — 20-candidate breakdown

For each of the 20 reviewed people (from task diagnostics only — no PII beyond safe qualification facts): normalized title, founder/CEO match, intended company, returned current company, employer-match result, location-evidence type available, final block reasons, qualification state.

Aggregate: wrong title, wrong employer, ambiguous employer, missing personal location, missing company/job location, duplicate, missing contact method, other.

## Step 10 — REJECT persistence contract

Determine where REJECT rows live: task `result` only, a transient candidate table, or `lead_candidates` in Lead Library. Confirm whether they are user-visible and whether they count toward CONTACT quota. Do NOT label as a bug until intended contract is stated — just describe observed behavior + code path.

## Step 11 — Continuation behavior

Report: round number, max rounds, remaining quota, remaining budget, remaining approved strategies, terminal status, continuation eligibility, `continuation_claim_id/expires_at`, task row status. Determine which of {should-have-continued / correctly returned continuation_required / exhausted / budget-capped / old-fast-workflow-controlled} applies. Do not resume.

## Step 12 — Compare with TEST task `281b6c2b-b80b-4072-97a2-f43bddb9f1df`

If accessible (may require TEST project connection — if not accessible, say so and skip). Compare: planner enabled, job queries, companies found, decision-maker input, employer verification, geography rejection, terminal status. State whether both failures share the same deterministic people-stage defect.

## Step 13 — Root-cause classification (A–J) + final report

Deliver the 25-item final report specified, including primary + secondary root causes, the smallest correct code change (proposed only — not applied), and the regression tests it requires. End with an explicit confirmation that no workflow, provider call, or deployment happened during this audit and that `CLAUDE_FIRST_LEAD_PLANNING=false` on prod.

## Technical notes

- Reads: `supabase--read_query` on `tasks`, `task_plans`, `tool_calls`, `signals`, `lead_candidates`, `agent_runs`, `handoffs`; `supabase--edge_function_logs` on `run-agent`/`orchestrate`/`pilot-chat` scoped to the task window; `ai_gateway_logs--list_ai_gateway_requests` filtered by the task's `run_id` for planner cost + model.
- Mutation: exactly one `secrets--set_secret` call. Nothing else writes.
- Secret hygiene: never surface Actor IDs, API keys, raw prompts, or PII beyond safe qualification facts. Redact provider inputs to filter shape + counts.
- If any step's data is unavailable in production, report "unavailable" — do not infer.
