# Phase 2: Persistent Signal Memory

Turn workflow outputs into durable, structured GTM memory so follow-up messages ("only keep early-stage SaaS", "draft outreach to the top 5", "enrich the top 3") work without re-pasting results.

Scope is **additive**. Phase 1 classifier, existing orchestration, Workbench rendering, secrets, and Apify actor surface are unchanged.

## 1. Database — additive migration

One migration adds 7 tables in `public`, each with workspace-scoped RLS via the existing `has_workspace_access(_user_id, _workspace_id)` security-definer function. All tables follow the required pattern: CREATE → GRANT (authenticated + service_role, no anon) → ENABLE RLS → POLICY. All get `updated_at` triggers via existing `update_updated_at_column()` where they have an `updated_at` column.

Tables (columns per the brief, verbatim):

- `signals` — buying/sourcing signals (signal_type: hiring_signal, people_profile, website_signal, linkedin_engagement, competitor_engagement, funding_signal, job_change, founder_pain_post, content_output, outreach_draft)
- `accounts` — companies; dedupe key `(workspace_id, lower(domain))` unique-when-domain-present via partial unique index, plus `(workspace_id, lower(name))` partial unique when domain is null
- `contacts` — people; dedupe key `(workspace_id, lower(linkedin_url))` partial unique
- `lead_candidates` — ranked leads tying account+contact+signal; partial unique on `(workspace_id, plan_id, coalesce(account_id,'00..'), coalesce(contact_id,'00..'), coalesce(signal_id,'00..'))`
- `lead_enrichments` — Hawk/Firecrawl enrichment per lead/account/contact
- `outreach_drafts` — Penn drafts, links to `approvals.id` when present
- `saved_outputs` — generic memory (report, content_draft, market_brief, daily_brief, workflow_summary)

Indexes: `workspace_id`, `conversation_id`, `plan_id` on all relevant tables; `(workspace_id, created_at desc)` for reader queries.

RLS policy template per table:
```sql
CREATE POLICY "members read"  ON public.<t> FOR SELECT TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "members write" ON public.<t> FOR INSERT TO authenticated WITH CHECK (public.has_workspace_access(auth.uid(), workspace_id));
CREATE POLICY "members update" ON public.<t> FOR UPDATE TO authenticated USING (public.has_workspace_access(auth.uid(), workspace_id));
```
Edge functions write via service_role and bypass RLS.

## 2. Memory writer — `supabase/functions/_shared/memoryWriter.ts`

Pure helper invoked after a tool or agent succeeds. Single entry:

```ts
writeMemoryFromToolCall({ admin, workspace_id, conversation_id, plan_id, task_id, tool_call_id, tool_name, selected_actor_key, output })
writeMemoryFromAgentResult({ admin, workspace_id, conversation_id, plan_id, task_id, agent_slug, output_text, structured? })
```

Mapping rules:

- **Apify Jobs** (`selected_actor_key` starts with `apify_jobs` or normalized_source_type=`jobs`): use `normalizeApifyItems` shape → upsert `accounts` (by domain, fall back to name), insert `signals{ signal_type: hiring_signal, source_url, raw }`, insert `lead_candidates{ lead_type: company, account_id, signal_id, reason: title @ company }`.
- **Apify People** (`isPeopleOutput` true): upsert `contacts` (by linkedin_url), insert `signals{ signal_type: people_profile }`, insert `lead_candidates{ lead_type: person, contact_id, signal_id }`. **Never write email/phone unless present on item.**
- **Firecrawl scrape**: insert `lead_enrichments{ source_url, summary, raw }` when linked to a lead/account; otherwise insert `saved_outputs{ type: workflow_summary, body: markdown, raw }`.
- **Aria rankings** (run-agent, agent_slug=aria, structured rankings via `normalizeAriaRankings`): update matching `lead_candidates` with `fit_score`, `priority` (tier→hot/warm/maybe/ignore), `reason`, `next_action`.
- **Penn drafts** (agent_slug=penn, via `normalizePennDrafts`): insert `outreach_drafts{ channel, subject, body, lead_candidate_id, approval_id }`, link to approval row if just created.
- **Scribe** (agent_slug=scribe): insert `saved_outputs{ type: content_draft, title, body: text }`.

Dedupe: all upserts use the unique indexes above with `onConflict` + ignore/merge. Lead-candidate insertion checks the partial unique before insert. All writes wrapped in try/catch and **never fail the parent tool call** — memory write errors are logged via `console.warn("[memoryWriter]", ...)` only.

## 3. Memory reader — `supabase/functions/_shared/memoryReader.ts`

```ts
loadConversationMemory({ admin, workspace_id, conversation_id, limit=50 })
  → { lead_candidates, accounts, contacts, outreach_drafts, saved_outputs, last_plan_id }
```

Loads, ordered by `created_at desc`:
- last 50 `lead_candidates` for the conversation (join account/contact)
- last 20 `accounts`, `contacts` from `last_plan_id`
- last 10 `outreach_drafts`
- last 5 `saved_outputs`

Returns a compact JSON struct under ~6 KB suitable for prompt context.

## 4. Integration points (minimal)

- **`_shared/toolRegistry.ts`** — at the end of the success branch around line 1035 (after `output_json` is written), call `writeMemoryFromToolCall(...)` for `tool_name` in `source_with_apify | scrape_url`. No other behavior change.
- **`run-agent/index.ts`** — after `tasks.update({ status: finalStatus, result })`, call `writeMemoryFromAgentResult(...)` for `agent_slug` in `aria | penn | scribe`. Approval creation block untouched; if needs_approval, pass the new `approval.id` into the Penn draft write.
- **`pilot-chat/index.ts`** — once per request (only when `conversation_id` exists), call `loadConversationMemory(...)` and inject a `<conversation_memory>` block into the classifier/planner prompt context. Workflow classifier itself unchanged; it just sees richer context. A short follow-up heuristic added near the existing classifier call: if classified `unclear` or `signal_sourcing` AND memory has ≥1 lead_candidate AND user message matches `/top \d+|these|the (?:previous|results|leads|companies|people)|only keep|enrich|draft outreach/i`, route to a deterministic follow-up plan (filter/rank/draft) over remembered records instead of re-sourcing.

## 5. Workbench (light touch)

In `ScoutResultsView.tsx` and existing action buttons only:
- "Save Lead" → POST insert into `lead_candidates` (workspace+conversation+plan from context).
- "Draft Outreach" → pass `lead_candidate_id`/`contact_id`/`account_id` to the existing orchestrator call.
- "Enrich" → same.

No layout, no new components. If wiring expands beyond ~30 lines per file, stop and report.

## 6. Tests (safe project `wqnigjhcwjxtmordrwno` only)

Run the 7 scripted prompts from the brief end-to-end via `curl_edge_functions`, then verify rows with `read_query`:

| # | Prompt | Verify |
|---|---|---|
| 1 | 20 cos hiring growth marketers US | accounts/signals/lead_candidates rows; tool_calls.output_json intact |
| 2 | "Only keep early-stage SaaS companies" | no new Apify call; memory-driven filter reply; if stage missing, offers enrichment |
| 3 | "Draft outreach to the top 5" | outreach_drafts ×5, approvals ×5, no send |
| 4 | 10 React devs London | contacts/signals/lead_candidates; no email/phone unless real |
| 5 | Analyze stripe.com/jobs | lead_enrichments OR saved_outputs row with source_url; no Apify |
| 6 | "Write a LinkedIn post…" | saved_outputs(type=content_draft); no Apify |
| 7 | Fresh convo: "Draft outreach to top 5" | honest "need leads first"; no invented rows |

Also Deno unit tests for `memoryWriter` (dedupe paths) and `memoryReader` (shape + size cap).

## 7. Out of scope / non-goals

No production deploy. No changes to: Phase 1 classifier categories, secrets, Apify actor list, LinkedIn Engagement Engine, Competitor Tracker, Signal Feed UI, schema of existing tables.

## 8. Deliverables / final report

Files changed · migration SQL · RLS policies · writer behavior · reader behavior · dedupe strategy · follow-up behavior · 7 test results with row counts · remaining limitations · production-deploy recommendation (awaits user approval).

## Technical details

- Migration order per table: CREATE → GRANT (authenticated SELECT/INSERT/UPDATE/DELETE; service_role ALL) → ENABLE RLS → POLICY → indexes → `BEFORE UPDATE` trigger.
- All foreign keys `ON DELETE SET NULL` except `workspace_id` (`ON DELETE CASCADE` to `workspaces`).
- Dedupe via Postgres partial unique indexes + `INSERT … ON CONFLICT DO UPDATE` / `DO NOTHING`.
- Memory writer is fire-and-forget relative to the tool result: failures logged, never propagated.
- Prompt-context budget: memory block hard-capped at 6 KB; oldest rows dropped first.
- No new env vars, no new secrets, no new external dependencies.
