# Daily Brief That Works

Make "Brief me on today" deterministic: detect the intent in `pilot-chat`, build a structured brief from real workspace data via a new `daily-brief` edge function, summarize with the AI provider (formatting only, no fabrication), and return it as a normal assistant message. No frontend redesign, no removal of existing modules.

## Files changed

1. **NEW** `supabase/functions/daily-brief/index.ts` — builder + responder
2. **EDIT** `supabase/functions/pilot-chat/index.ts` — daily-brief intent detection, runs before AI decision call
3. **EDIT** `supabase/config.toml` — register `daily-brief` with `verify_jwt = false` only if needed (we'll validate JWT in code, mirroring `pilot-chat`)

No DB migrations. No frontend changes. `ChatWorkspace` already renders markdown assistant messages.

## Routing (pilot-chat)

Before calling `generateJson`, run a regex/intent match on the trimmed message:

```
/^\s*(brief me( on today)?|daily brief|today'?s brief|what should i know today|what happened today|give me today'?s (command )?brief|plan my day|what needs my attention)\b/i
```

If matched:
- Persist the user message (already done above the AI call — keep that order).
- Call `daily-brief` server-to-server, forwarding the user JWT and `{ workspace_id, conversation_id }`.
- `daily-brief` returns `{ message }` (the saved assistant row).
- Return `{ type: "reply", conversation_id, message, intent: "daily_brief" }`.
- Skip orchestrate and the normal `generateJson` path entirely.

Fallback: if `daily-brief` returns non-2xx, fall through to the existing AI decision path (so chat never breaks).

Routing priority becomes: **daily_brief → AI decision (reply/delegate) → orchestrate**.

## daily-brief function

Auth, membership, and conversation handling mirror `pilot-chat`:
- Verify Bearer JWT via `auth.getUser`.
- Check `workspace_members`.
- Validate `conversation_id` belongs to user, or create one.

### Data collection (parallel queries, admin client, scoped to `workspace_id`)

| Section | Source | Query |
|---|---|---|
| Active Plans | `task_plans` | `status in ('active','running','pending')` order by `created_at desc` limit 10; for each, count `tasks` and fetch next pending task title |
| Tasks Needing Attention | `tasks` | `workspace_id = ? and status in ('pending','waiting','failed','requires_approval','blocked')` limit 20 — include `agent_slug`, `status`, `title`, last error if column exists |
| Pending Approvals | `approvals` | `workspace_id = ? and status = 'pending'` limit 20 |
| Recent Agent Activity | `activity_feed` | `workspace_id = ? and created_at >= now() - interval '24 hours'` order desc limit 10 |
| Outreach Status | `tasks` + `approvals` | filter `agent_slug = 'penn'` |
| Company Brain | `company_brain` | `profile, onboarding_completed` |

All queries wrapped in `try/catch`; missing tables/columns degrade to "section empty" — never crash the brief.

### Connector detection

Use existing `isToolConfigured` from `_shared/toolRegistry.ts`:
- `research_web` → PERPLEXITY
- `scrape_url` → FIRECRAWL
- `send_email` → RESEND
- Lovable AI gateway: `!!Deno.env.get("LOVABLE_API_KEY")`

Build a `connectors` object: `{ research_web: ready, scrape_url: ready, send_email: ready, lovable_ai: ready }`.

### Optional Hawk live intelligence

For v1: **do not auto-spawn a Hawk run**. Just include the connector-status line. Auto-spawning would slow the brief and add side effects. The "Recommended Next Actions" can suggest "Run Hawk to gather today's market signals" when `research_web.ready === true`. (Flag this in the report so the user can ask us to auto-run later.)

### Assembly

Build a deterministic markdown skeleton in code using the data above. Then call `generateJson` (or a plain `generateText`-equivalent through `aiProvider`) with:
- system: "You format a founder daily brief. Use ONLY the JSON facts provided. Do not invent plans, tasks, approvals, activity, or market data. Keep tone tight and actionable. Output markdown matching the section headings exactly."
- user: `{ facts: <collected structured data>, connectors, company_brain_summary }` as JSON

If the provider fails, return the deterministic markdown skeleton directly (no AI polish) — brief still works.

### Recommended Next Actions logic (deterministic, max 5)

Pushed in this priority order:
1. If `company_brain.onboarding_completed !== true` → "Complete Company Brain setup at /onboarding/company-brain"
2. If `!connectors.research_web` → "Connect Perplexity for live market intelligence"
3. If `!connectors.scrape_url` → "Connect Firecrawl to enable site extraction"
4. If any pending approval → "Review N pending approval(s)"
5. If any failed task → "Fix N failed task(s)"
6. If no active plans → "Start a new plan — try 'Find 20 React engineers in Berlin'"
7. If active plan has next pending task → "Resume <plan title>"

### Hallucination guards

- The AI prompt only sees the JSON facts; no web access.
- Intelligence Status section text is hard-coded based on `connectors.research_web`:
  - configured: "Live research available via Perplexity. Ask 'Have Hawk gather today's market signals' to run it."
  - not configured: "Live market and competitor intelligence requires Perplexity or Firecrawl. I can still summarize internal workspace activity."
- No "today's market changed" phrasing allowed in prompt instructions.

### Save & return

Insert assistant row into `messages` with `agent_slug = 'pilot'`, `model_used`, content = final markdown. Return `{ message, conversation_id, intent: "daily_brief", connectors_missing }`.

## Verification (manual in Preview)

1. "Brief me on today" → structured brief, no clarification.
2. "What should I know today?" → same.
3. Empty workspace → all sections say empty; recommended actions include onboarding + connectors.
4. Workspace with `task_plans` → Active Plans populated.
5. Pending approval row → appears under Pending Approvals.
6. PERPLEXITY missing → Intelligence Status says connector required; no fake facts.
7. PERPLEXITY set → Intelligence Status invites Hawk run.

## Final report (to be written after build)

- Files changed list
- Confirm `daily-brief` function added and deployed
- How each section is queried (table + filter)
- How connector status uses `isToolConfigured`
- Hallucination prevention (facts-only prompt, hard-coded intelligence text, deterministic fallback markdown)
- Test results from the 7 scenarios above
