
## Pre-enablement Verification — Read-only (Production `wqnigjhcwjxtmordrwno`)

No flag change, no paid provider call, no workflow start. All 10 checks are either metadata reads or deterministic source-code tracing.

### Scope guardrails
- Do NOT call `pilot-chat`, `orchestrate`, or `run-agent` — even Gemini calls cost credits.
- Do NOT set / update / delete any secret.
- Do NOT touch `CLAUDE_FIRST_LEAD_PLANNING` or `CLAUDE_FIRST_LEAD_PLANNING_WORKSPACES`.
- All DB access is `SELECT`-only; no synthetic rows this pass.

### Step-by-step

1. **Flag OFF** — `secrets--fetch_secrets` (names only). Assert `CLAUDE_FIRST_LEAD_PLANNING` absent or, if present, read its value via a runtime probe **only from source code** (grep for default handling in `intelligenceFlags.ts`) — no edge call. If it's absent from the secret list, that alone proves OFF.

2. **Feature-OFF diagnostics** — SQL against `public.tasks` and `public.task_plans` (last 14 days):
   - Look for `result -> 'claude_first' IS NOT NULL`
   - Look for `payload ? 'claude_first_route'` or `result ? 'anthropic_planner_used'`
   - Look for `agent_slug LIKE '%claude%'`
   
   Expected: zero rows while flag is OFF.

3. **Preview contract — deterministic trace (no edge call)**
   Input: `"Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads."`
   
   Trace through the already-deployed source:
   - `_shared/qualifiedLeadRouting.ts::routeQualifiedLead` regex hits:
     - `PERSON_TARGET_RE` → `founders`
     - `QUALIFIED_LEAD_RE` → `qualified leads`
     - `LEAD_QUOTA_RE` → `5 qualified leads`
     → forces `workflow_kind = qualified_lead_sourcing`, `execution_mode = company_first`, `count_entity = contact_ready_lead`, `quota_policy = contact_only`.
   - `extractRequestedLeadCount` → `5`.
   - `normalizeCompanyVertical("SaaS")` → `saas` (via `inferVertical`).
   - `inferCompanyStage("startups")` → `startup_or_small_team`.
   - `contractJobTitles(...)` for "Sales Operations" family → read `_shared/intelligence/jobIntentTaxonomy.ts` (or the SalesOps registry) to confirm the top-3 expansion equals **Sales Operations / Revenue Operations / GTM Operations**, NOT SDR/BDR/AE.
   - Requested decision-makers → `_shared/intelligence/leads/leadMission.ts` (or equivalent) mapping `founders` → `Founder / Co-Founder / CEO`.
   
   Pass criteria (must ALL hold):
   - `workflow_kind = qualified_lead_sourcing`
   - `execution_mode = company_first`
   - `requested_count = 5`
   - `count_entity = contact_ready_lead`
   - `quota_policy = contact_only`
   - Hiring titles ⊇ {Sales Operations, Revenue Operations, GTM Operations}
   - Decision-makers ⊇ {Founder, Co-Founder, CEO}
   - No SDR / BDR / AE anywhere in expanded titles
   - No `fast` mode, no `account_opportunity_sourcing`, no "decision-makers as later optional step" branch.

4. **`ANTHROPIC_API_KEY` presence** — from `secrets--fetch_secrets` result. Presence only; value not read.

5. **PR #101 deployed** — two-part check:
   - Source: `_shared/aiProvider.ts` contains the Anthropic-preference + graceful Gemini fallback (verified last turn).
   - Deploy: the three affected functions (`run-agent`, `orchestrate`, `pilot-chat`) were redeployed this turn against production ref `wqnigjhcwjxtmordrwno`. Re-confirm via `supabase--project_info` (project ref) and note the earlier deploy tool success.

6. **Production workspace UUID (agentory.space)** — identify by activity, since "the authenticated production user" isn't named. Query the most recently active authenticated workspace:
   ```sql
   SELECT c.user_id, c.workspace_id_or_join, MAX(c.updated_at)
   FROM public.conversations c
   JOIN public.workspace_members m ON m.user_id = c.user_id
   WHERE c.updated_at > now() - interval '30 days'
   GROUP BY 1,2 ORDER BY 3 DESC LIMIT 5;
   ```
   Cross-check against `public.tasks` + `public.company_brain` recency. Present the resulting UUID **partially redacted** (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxx####`).

7. **Not TEST QA** — assert the UUID is not `11111111-1111-1111-1111-555555555555` (called out in `.lovable/plan.md`) and belongs to project ref `wqnigjhcwjxtmordrwno` — impossible for a TEST workspace to appear in prod DB, but the explicit UUID check is the guard.

8. **Membership check** — `SELECT role FROM public.workspace_members WHERE workspace_id = <candidate> AND user_id = <owner_from_workspaces.owner_user_id>` — confirms owner has an active membership row.

9. **Cost estimate** — narrative, based on qualified-lead runtime budget:
   - Pilot planning (Anthropic preferred): ~1 Claude Sonnet call, ~4k in / ~2k out → ~$0.04
   - Orchestrate compile: 1 Gemini call (Lovable gateway) → ~$0.01
   - `run-agent` round(s) up to quota 5, `company_first` mode: worst-case 3 rounds × (1 planner + 2 tool_input_planning + 1 summary) → ~8 model calls, mixed → **≈ $0.20**
   - Provider search fan-out is capped by the company-first controller; without paid Apify/Firecrawl calls in this pass, budgeted at **$0.30 total**.
   - No Apify / Firecrawl usage in THIS verification (this pass triggers zero provider work).

10. **Stop-and-report** — final message only; no writes.
   - Propose the exact flag values for enablement (deferred to next turn, awaiting explicit approval):
     - `CLAUDE_FIRST_LEAD_PLANNING = "true"`
     - `CLAUDE_FIRST_LEAD_PLANNING_WORKSPACES = "<UUID from step 6>"` (single-workspace canary)

### Final report shape (delivered after checks)
- Feature-OFF status — pass/fail
- Feature-OFF diagnostics result — row count of Claude-first markers (expected 0)
- Production preview contract — full JSON, from source trace
- Preview pass/fail against 8 assertions
- Anthropic secret presence — yes/no
- PR #101 deployment verification — file-hash + deploy confirmation
- Production workspace UUID (partially redacted)
- Workspace membership verification — role + owner check
- Estimated workflow cost — ≤ $0.30
- Exact flag values proposed — for your approval

### Out of scope (explicitly deferred)
- Enabling flags
- Any workflow execution
- Any secret modification
- Any Claude / Apify / Firecrawl call

### Ambiguity to resolve while executing
"The authenticated production user on agentory.space" isn't named. Approach: pick the workspace with the most recent authenticated conversation+task activity in production, present its owner + last-active timestamp, and if it's ambiguous (multiple recent candidates) I'll list them all in the final report and ask you to pick before enablement.
