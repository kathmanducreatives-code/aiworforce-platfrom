
# Fix: route qualified Lead requests into company-first sourcing

Scope is narrow. Two proven defects only:

1. **Routing precedence** — the generic `workflowClassifier` decision (`fast` / `account_first` / `company_hiring_sourcing`) survives into `orchestrate` / `run-agent` even when `routeQualifiedLead()` says the request is a qualified-Lead mission, because the authoritative router is not always invoked against the **original** user instruction and its result is not preserved end-to-end.
2. **Quota presentation** — when the workflow contract is `count_entity: contact_ready_lead` / `quota_policy: contact_only`, the Workbench header still falls back to account rows for the numerator ("Found 2 of 5") instead of using the backend CONTACT-ready count.

No new router. No new classifier. No Company Brain, people-search or sourcing rewrite. All intelligence flags remain OFF.

Branch: `fix/qualified-lead-routing-precedence` off latest `remix/main` (after PR #112). Never touch `supabase/functions/mcp/index.ts`.

---

## Fix 1 — Routing precedence (backend)

Reuse the existing authority: `supabase/functions/_shared/qualifiedLeadRouting.ts` (`routeQualifiedLead`, `extractRequestedLeadCount`, `QualifiedLeadContract`). Preserve its verdict through every hop.

- **pilot-chat** (`supabase/functions/pilot-chat/index.ts`)
  - Run `routeQualifiedLead(originalPrompt)` **before** `classifyWorkflow` gets to finalize an `execution_mode`. When it returns `qualified_lead_sourcing`:
    - Force `decision.workflow_category`, `decision.execution_mode = "company_first"`, `decision.source_type` / `selected_actor_key` to the qualified-Lead contract values.
    - Attach the full `qualified_lead_contract` (already built for the workflow card) to the tool_input threaded into `orchestrate`, alongside `workflow_kind`, `execution_mode`, `count_entity`, `quota_policy`, `requested_lead_count`, and `route_reason_codes` for provenance.
    - Do not override the classifier for non-qualified requests — the generic path stays intact.
  - When a confirmed workflow card is re-issued (`"Run workflow: …"`), keep using the **original prompt** stored in `actionMetadata.lead_intent.original_instruction` / `qualified_lead_contract.original_instruction` as the input to `routeQualifiedLead`, not the command string.

- **orchestrate** (`supabase/functions/orchestrate/index.ts`)
  - Already calls `routeQualifiedLead(user_instruction)` at line ~1199. Harden it:
    - Prefer `tool_input.qualified_lead_contract.original_instruction` over `user_instruction` when present, so a re-issued Start card cannot mask the route.
    - When the router says `qualified_lead_sourcing`, ignore the planner's `executionMode` / `source_strategy` / `selected_actor_key` entirely for the run-agent kickoff; thread the full `qualified_lead_contract` through, plus `lead_routing = null` (do NOT thread a stale `source_strategy: "account_first"` into run-agent, that is the field run-agent later pins on).
    - Emit a `route_provenance` block (`{source: "qualifiedLeadRouting", reason_codes, chose_over: "workflowClassifier"}`) on the task record for observability.

- **run-agent** (`supabase/functions/run-agent/index.ts`)
  - When the request body carries `workflow_kind: "qualified_lead_sourcing"` or `execution_mode: "company_first"`, treat the qualified-Lead contract as authoritative:
    - Skip the `threadedRouting.source_strategy` / `separatedIntent.source_strategy` override that currently pins `account_first` (~line 1167).
    - Enter the existing company-first branch (`isCompanyFirstRequest` path, ~line 686) unconditionally for a contract-tagged request; do not require `compileLeadEntityIntent(input)` to independently detect the person target.
    - Preserve the contract across a continuation: write it into `tasks.result.company_first_state.contract` and re-load it on resume.
  - Do **not** gate any of this on `CLAUDE_FIRST_LEAD_PLANNING`, `INTELLIGENCE_DYNAMIC_SOURCE_PLANNING`, or `CLAUDE_SOURCE_FEEDBACK`. The deterministic company-first workflow (Company Brain gate → Founder/CEO search → employer verification → CONTACT quota → sequential source execution) is already reachable with all flags OFF; keep it that way.

## Fix 2 — Quota presentation (frontend)

The authority is already there: `src/lib/qualifiedLead/workbenchCounts.ts` uses `QuotaProgress` and only falls back to row-shaped counts when `progress` is missing. The regression is in **how `QuotaProgress` is constructed** for a contact-ready mission (account rows are being counted into `eligible`).

- Locate the `QuotaProgress` builder / hook (`src/lib/qualifiedLead/quotaProgress.ts` + call sites in Workbench). Fix it so that when the run's contract says `count_entity === "contact_ready_lead"` / `quota_policy === "contact_only"`:
  - `eligible` / `verifiedDecisionMakers` come strictly from backend CONTACT-ready fields (`cf.result.contact_ready_count`, `runContext.contact_ready`, etc. — reuse the field already carried by `buildQualifiedLeadRunContext`).
  - Never fall back to `accounts`, `companies`, `candidates`, `jobs`, `signals`, or visible row count. When the backend field is missing, `eligible` is `0` and `remaining = requested`.
- Header labels already exist in `buildWorkbenchCounts`; adjust the Workbench header to render **two separate groups**:
  - Account group: `ACCOUNTS FOUND`, `QUALIFIED COMPANIES` (unchanged).
  - Lead group: `CONTACT-READY: 0 of 5`, `REMAINING: 5`, with a subline "2 qualified account opportunities found" so the account signal is not lost.
- Account-search missions (`count_entity: "account_opportunity"`) keep account counts as the numerator — unchanged.

Do not add UI keyword guessing; use the contract already threaded via `run_context` / task `result`.

## Tests (offline, no live provider or model)

Add / extend under `supabase/functions/_shared/` and `src/lib/qualifiedLead/`:

- `qualifiedLeadRouting.test.ts` — canonical query (founders/CEOs, SaaS, Sales-Ops hiring, 5 leads) returns `qualified_lead_sourcing` / `company_first` / `contact_ready_lead` / `contact_only`, requested count 5, hiring roles (`Sales Operations`, `Revenue Operations`, `GTM Operations`) stay separate from decision-maker roles (`Founder`, `Co-Founder`, `CEO`).
- New `qualifiedLeadRoutingPrecedence.test.ts` — a mocked `workflowClassifier` verdict of `fast/account_first/company_hiring_sourcing` cannot override `routeQualifiedLead`; a "Run workflow: …" re-issue routes off the original instruction from `qualified_lead_contract`.
- New `qualifiedLeadFlagIndependence.test.ts` — with `CLAUDE_FIRST_LEAD_PLANNING`, `INTELLIGENCE_DYNAMIC_SOURCE_PLANNING`, `CLAUDE_SOURCE_FEEDBACK` all OFF, the canonical query still reaches the company-first branch and the CONTACT-only quota controller.
- Extend `executeRunAgentCompanyFirstSourcing.test.ts` — a 584-employee company with no early-stage evidence is rejected by the Company Brain gate before people search when the ICP requires 5–200 employees. No name-based patching.
- New `runAgentQualifiedLeadFixture.test.ts` — offline fixture reproducing task `3445fe83-4fed-4e5e-876e-93799a051811`'s intake; asserts the fixed path does NOT produce `execution_mode: fast` / `source_strategy: account_first` / `workflow_type: company_hiring_sourcing`, and DOES produce the canonical qualified-Lead contract. Assert continuation preserves the route.
- New `workbenchCounts.contactReady.test.tsx` — given `{ accounts: 2, contact_ready: 0, requested: 5, count_entity: "contact_ready_lead" }`, header shows `0 of 5 CONTACT-ready`, not `2 of 5`; account/lead groups stay separate; account-search mission still uses account numerator.
- Negative cases stay generic: "Show companies hiring Sales Operations", "Find recent Sales Operations jobs", "Research five SaaS companies" — remain `account_opportunity_sourcing` / `fast`.

## Validation (no deploys, no live calls)

1. Record `remix/main` baseline: capture failing tests on the base SHA.
2. Run focused suites on the branch:
   - `deno test supabase/functions/_shared/qualifiedLead*.test.ts`
   - `deno test supabase/functions/_shared/executeRunAgentCompanyFirstSourcing.test.ts`
   - `deno test supabase/functions/_shared/workflowClassifier.test.ts`
   - `bunx vitest run src/lib/qualifiedLead`
3. Full backend `_shared` suite + relevant frontend tests. Only pre-existing baseline failures are acceptable.
4. `deno check` modified modules and affected Edge Functions (`pilot-chat`, `orchestrate`, `run-agent`).
5. `./node_modules/.bin/tsc --noEmit` and `npm run build`.
6. Grep the full diff for secrets. Verify `supabase/functions/mcp/index.ts` is neither staged nor committed.

## Commits and PR

Commits:
- `fix(leads): prioritize qualified lead routing`
- `fix(leads): preserve contact-ready route across execution`
- `fix(ui): separate account and contact quota progress`
- `test(leads): cover qualified routing precedence`

Push to `remix`; open PR against `main` titled `fix(leads): route qualified lead requests into company-first sourcing`. Do not merge, deploy, migrate, or invoke live providers.

## Explicit non-goals

- No new router / classifier / route taxonomy.
- No Company Brain policy change (only a test proving the existing gate rejects a 584-employee company under a 5–200 ICP).
- No new people-search implementation.
- No Claude-flag enablement.
- No changes to `supabase/functions/mcp/index.ts`.

## Final report will include

Base SHA, branch, defect repro, precedence defect, routers reused, new order, generic classifier behaviour, contract, flag independence, run-agent integration, company-first / Brain / decision-maker reachability, CONTACT quota behaviour, UI fix, Malwarebytes fixture result, tests added, baseline vs branch results, deno/tsc/build results, files changed, commits, remote SHA, PR number/URL, and all required confirmations (no duplicate router, no rewrites, no deploy/migration/live call, all flags OFF, no secrets, MCP file untouched).
