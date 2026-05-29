
## Step 1 — Audit report (no mutations performed)

**Active backend ref:** `wqnigjhcwjxtmordrwno` (confirmed via `supabase--project_info` context — `.env`/client are auto-generated and untouched).

### Tables

| Expected | Present | Notes |
|---|---|---|
| workspaces | ✅ | 1 row (`prasidha's Workspace`, owner `63365602…c43b`) |
| workspace_members | ✅ | 1 row (matches the workspace owner) |
| company_brain | ✅ | 1 row |
| agents | ✅ | **0 rows — empty** |
| agent_capabilities | ❌ **MISSING** | Referenced by `orchestrate/index.ts:60`, `src/lib/orchestration.ts:332`, and `VerificationPanel`. `orchestration.ts` casts `as any`, so TS compiles, but the query returns a permission/relation error at runtime. |
| conversations | ✅ | 3 rows |
| messages | ✅ | 6 rows; columns: id, conversation_id, role, content, agent_slug, model_used, tokens_used, is_error, created_at |
| task_plans | ✅ | 0 rows |
| tasks | ✅ | columns: id, plan_id, agent_slug, parent_task_id, depends_on, status, payload, result, error_message, user_id, timestamps |
| activity_feed | ✅ | 0 rows |
| approvals | ✅ | 0 rows |
| handoffs | ❌ **MISSING** | `run-agent/index.ts:245` inserts into `handoffs` — that call fails silently / 500s |

### RLS policies (workforce-critical tables)

- `workspaces` — owner insert; member select; owner update ✅
- `workspace_members` — self insert/select/delete ✅
- `messages` — users select/insert own (via conversation join) ✅
- `tasks` — user_id-scoped CRUD + service_role full access ✅
- `agents`, `task_plans`, `activity_feed`, `approvals`, `company_brain` — workspace-member scoped via `has_workspace_access()` (per memory + prior migrations) ✅
- `handoffs` / `agent_capabilities` — N/A (tables don't exist)

### Edge functions deployed

| Function | Present |
|---|---|
| pilot-chat | ✅ |
| run-agent | ✅ (but calls missing `handoffs` table) |
| orchestrate | ✅ (but queries missing `agent_capabilities` table) |
| approve-and-continue | ✅ |

### Secrets

Present per `fetch_secrets`: `LOVABLE_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_AI_API_KEY`, `RESEND_API_KEY`, plus Supabase platform secrets. **Missing:** `PERPLEXITY_API_KEY`, `FIRECRAWL_API_KEY` (only needed if research/sourcing connectors are exercised — pilot-chat itself does not require them).

### Seed / system data

| Item | Status |
|---|---|
| ≥1 workspace | ✅ |
| Signed-in preview user has workspace_members row | ✅ (`63365602…c43b`) |
| 5 core agents (Scout, Aria, Penn, Hawk, Scribe) | ❌ `agents` table empty |
| agent_capabilities rows | ❌ table missing |

### Root cause summary

The schema migrations created `workspaces`/`workspace_members`/`conversations`/`messages`/`tasks`/etc. and the workspace auto-provision trigger works (you have a workspace). The crash-/silent-failure surface that remains is:

1. **No agents seeded** → orchestrator can't pick an executor; agent listing in UI is empty.
2. **`agent_capabilities` table never created** → orchestrate edge function 500s; VerificationPanel red.
3. **`handoffs` table never created** → run-agent silently fails the handoff insert.

Everything else needed for the chat send path (workspace resolve → conversation create → message insert → `pilot-chat` invoke) is in place.

---

## Step 2 — Repair plan (narrow, scoped to `wqnigjhcwjxtmordrwno`)

### Migration 1 — create the two missing tables (with GRANTs + RLS)

```text
CREATE TABLE public.agent_capabilities (
  id uuid pk default gen_random_uuid(),
  agent_id uuid not null,
  capability text not null,
  config jsonb default '{}',
  created_at timestamptz default now(),
  unique(agent_id, capability)
)
GRANT SELECT,INSERT,UPDATE,DELETE ... TO authenticated
GRANT ALL ... TO service_role
ENABLE RLS
POLICY: authenticated can SELECT all; service_role manages

CREATE TABLE public.handoffs (
  id uuid pk default gen_random_uuid(),
  workspace_id uuid not null,
  plan_id uuid,
  from_agent_slug text,
  to_agent_slug text,
  payload jsonb default '{}',
  created_at timestamptz default now()
)
GRANT ... TO authenticated, service_role
ENABLE RLS
POLICY: has_workspace_access(auth.uid(), workspace_id) for SELECT/INSERT
```

### Seed 2 — five core agents + their capabilities (idempotent)

Insert via `supabase--insert` (one workspace_id = NULL so they're global defaults visible to all members; `is_default = true`):

```text
agents:
  Scout   slug=scout    dept=Sourcing       role="Lead sourcing"
  Aria    slug=aria     dept=Outreach       role="Personalized outreach"
  Penn    slug=penn     dept=Screening      role="Candidate screening"
  Hawk    slug=hawk     dept=Intelligence   role="Market & competitor intel"
  Scribe  slug=scribe   dept=Operations     role="Notes, summaries, comms"
all with model='gemini-2.5-flash' (per memory standard), is_active=true, is_default=true

agent_capabilities (one row per capability):
  scout: search_linkedin, enrich_profile
  aria:  draft_email, send_sequence
  penn:  generate_questions, score_response
  hawk:  scrape_company, summarize_market
  scribe: summarize_conversation, write_note
```

### Code touch (only if Step 1/2 above does not also resolve runtime guards) — none required. `run-agent` and `orchestrate` will start succeeding as soon as the tables exist; the chat send path already works.

### Out of scope (explicit non-changes)

- No edit to `src/integrations/supabase/{client,types}.ts` or `.env`.
- No new Supabase project, no swap to `zbwsbnqqpkvdhqwavjke`.
- No UI redesign, no revert to `chat-respond`, no RLS disable, no data reset.
- `PERPLEXITY_API_KEY` / `FIRECRAWL_API_KEY` not added unless you ask — orchestration core doesn't require them.

---

## Step 3 — Apply (only after you approve)

On approval I will, in order:
1. Run one `supabase--migration` for `agent_capabilities` + `handoffs` (tables, GRANTs, RLS, policies).
2. Run one `supabase--insert` seeding the 5 agents and their capabilities.
3. Redeploy `pilot-chat`, `run-agent`, `orchestrate`, `approve-and-continue` to pick up the now-resolvable relations.

## Step 4 — Verify

After apply I'll confirm: dashboard renders, `select count(*) from agents = 5`, VerificationPanel shows all green, a test message round-trips through `pilot-chat`, `run-agent` insert into `handoffs` succeeds in logs, `orchestrate` returns 200, no postgres_changes/realtime errors in console.

**Remaining blockers after this plan:** none expected for the chat + orchestration loop. If you later enable the Research or Sourcing connectors end-to-end, you'll need to add `PERPLEXITY_API_KEY` and/or `FIRECRAWL_API_KEY` then.
