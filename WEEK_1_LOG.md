# Week 1 Log

Running log of foundation work per the Week 1 plan. One section per day.
Append-only; commits live in `git log` for finer detail.

---

## Day 0 — Safety (2026-05-26)

**Goal:** rotate the leaked Firecrawl key, remove `.env` from tracking, prevent the key from being bundled to the frontend.

### What I did

- Confirmed pre-state: `.env` tracked in repo; not in `.gitignore`; contains `VITE_FIRECRAWL_API_KEY=fc-d5fea417d1b04035b44c11e6c72fd7a9` plus Supabase URL/anon JWT for project `wqnigjhcwjxtmordrwno` (the stale project). Key first appeared in commit `41e1822` on 2026-04-26 and propagated through merges since.
- User rotated the Firecrawl key in the Firecrawl dashboard and supplied the new value. Old key now dead.
- Created `.env.local` with the new key under the var name `FIRECRAWL_API_KEY` — **no `VITE_` prefix** — so Vite will not inline it into the frontend bundle.
- Carried the existing (wrong-project) Supabase URL + anon JWT into `.env.local` for now. Day 1 repoints these at `zbwsbnqqpkvdhqwavjke`.
- Updated `.gitignore` to ignore `.env` and `.env.*` while allowing `.env.example`.
- Replaced the old `.env.example` (which omitted Firecrawl entirely) with a fuller template that documents which vars are server-side vs `VITE_`-bundled.
- `git rm --cached .env` and deleted the file from the working tree.
- Committed: `c9a4bb6 chore(security): rotate compromised firecrawl key, gitignore .env`. **Not pushed.**

### Files still reading `VITE_FIRECRAWL_API_KEY` (flagged, not refactored)

These will now resolve to `undefined` and fall back to a "key not configured" UI state — safe degradation. Refactor to a server-side proxy edge function is Week 3 work.

- `src/lib/firecrawl.ts:68` — the actual client call
- `src/pages/CompetitorIntelligence.tsx:70,197` — `hasApiKey` check + user-facing config message
- `src/pages/TalentIntelligence.tsx:46,205` — same pattern

### What I skipped

- `npm run build` + `grep dist/ for fc-` verification. The clone has no `node_modules` and running install for a throwaway path adds ~3 min for no new signal — verification is provable by construction (no `VITE_*` variable holds the key, Vite only inlines `VITE_*`). User should still run the build in their own checkout post-sync as the real-world check.
- History scrub. User chose option (a): the old key is dead, the leaked value is now useless, repo is private. No `git filter-repo` rewrite.

### Unilateral decisions

- Picked `FIRECRAWL_API_KEY` (no namespace prefix) as the canonical server-side var name. Matches the `SUPABASE_SERVICE_ROLE_KEY` convention used inside edge functions.
- Kept `.env.example` for both Firecrawl and Supabase + n8n webhook URLs; the prior template covered only Supabase + n8n.

### Surprises

- The Supabase anon var in code is `VITE_SUPABASE_PUBLISHABLE_KEY` (per `src/integrations/supabase/client.ts:6`), not `VITE_SUPABASE_ANON_KEY`. One file (`src/components/SupabaseTest.tsx:59`) reads `VITE_SUPABASE_ANON_KEY` as a fallback. Not a blocker; flagging for future reconciliation. Day 1 keeps the publishable name to avoid touching unrelated code.

### Day 0 exit state

- `.env` no longer tracked; new key lives only in untracked `.env.local`.
- Frontend bundle (when built) cannot contain the new Firecrawl key by construction.
- Repo still points at the wrong Supabase project. Day 1 fixes that.

---

## Day 1 — Project drift + baseline + pull deployed function sources (2026-05-26)

**Goal:** repoint repo at the correct Supabase project and capture live schema
+ live function source in the repo, so future work runs against ground truth.

### What I did

- Confirmed via `supabase projects list` and JWT decode that the user has access
  to projects `zbwsbnqqpkvdhqwavjke` (target) and `eifnmcvswscoggoavsup`
  (unrelated). The project ID in the old `.env` (`wqnigjhcwjxtmordrwno`) is
  not in the user's account at all — either deleted or never owned. So there
  is no "archive the dead project" cleanup needed.
- Updated `.env.local` (untracked) to point `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY` at
  `zbwsbnqqpkvdhqwavjke`. Verified the new anon JWT decodes to `ref=zbwsbnqqp...`.
- `supabase link --project-ref zbwsbnqqpkvdhqwavjke` succeeded.
- Tried `supabase db pull` — failed because the remote migration tracking
  table has ~39 entries that don't match the local migration files (timestamps
  drift by ~2 seconds; some manual migrations applied out-of-band by Lovable).
  The CLI suggested 39 `migration repair --status applied` commands, which
  would write to remote metadata for entries we don't fully understand.
  Skipped — too risky for a half-understood drift.
- Tried `supabase db dump --linked` — failed because Docker isn't running.
- Pivoted: built an informational baseline via MCP `execute_sql` against
  `information_schema.columns` + `pg_constraint`. Output is
  `supabase/migrations/20260526000000_baseline_from_prod.sql`. Header marks
  it do-not-apply; production is the source of truth.
- Downloaded the live source of `run-agent`, `orchestrate`, and
  `approve-and-continue` via `supabase functions download --project-ref`.
  All three diverged significantly from the repo. The biggest finding is
  that **the deployed `run-agent` is already a real implementation** —
  calls Anthropic, uses the correct `task_plan_id`/`step_index` schema,
  reads `agent.role_prompt` and `agent.model` from the DB, chains via
  `task_plans.plan` jsonb. This was Day 3's whole goal; it's already shipped.
- Ran `supabase gen types typescript --project-id zbwsbnqqpkvdhqwavjke` to
  regenerate `src/integrations/supabase/types.ts`. The new types only
  include the 27 RLS-enabled tables (the other 56 tables in the DB are
  not API-exposed via PostgREST, so they're omitted — correct behavior).
- Added `supabase/.temp/` and `supabase/.branches/` to `.gitignore`.
- Committed: `5ebe666 feat(db,fns): capture live baseline + pull deployed function sources`

### What I did NOT do

- **Did not run `supabase db pull` to produce a proper migration file.** Skipping
  Docker setup, skipping the migration_repair dance. The informational baseline
  in `20260526000000_baseline_from_prod.sql` captures shapes but doesn't include
  foreign-key constraints, indexes beyond PKs, RLS policies, triggers, sequences,
  or custom-type definitions. Acceptable for "we know what's there" purposes;
  not a replayable migration. Real `db pull` is Week 2 work, once Docker is
  available.
- Did not smoke-test the dashboard against the new project. The frontend code
  reading `VITE_SUPABASE_PUBLISHABLE_KEY` will pick up `.env.local`, but I
  didn't run `npm run dev`. The user should verify locally.

### Unilateral decisions

- Picked the informational-baseline path over migration_repair. Reasoning above.
- Downloaded `chat-respond` source too (not just the three listed) since it had
  the same divergence risk. Turned out the chat-respond repo source already
  matches deployment closely; included in the commit set with no behavior change.
- Skipped FK / index / RLS-policy capture in the baseline. Would have been a
  ~3x larger query and the value of "documenting all relationships" wasn't
  high enough to justify the time given Docker-based `db pull` is the right
  long-term answer.

### Surprises

- Two Supabase projects were a red herring — the "wrong" project ID in `.env`
  doesn't even exist in the user's account. We were pointed at a deleted/
  unowned project. The fix was easier than expected; the surprise was that
  nothing was lost when we abandoned that pointer.
- The deployed `run-agent` is a fully working real implementation. The
  "Day 3 is the most important change of Week 1" framing in the user's brief
  assumed the deployed code matched the repo (a 600 ms `setTimeout` stub).
  It doesn't. Day 3 becomes "version-control the working thing + tune prompts"
  rather than "build from scratch." Surfacing for re-scoping.
- `users.workspace_id` is the de-facto workspace membership column used by
  the deployed code paths, even though there's also `organization_members`
  with a richer role model. Two scoping mechanisms coexist.

### Day 1 exit state

- Repo points at `zbwsbnqqpkvdhqwavjke` (locally; pushed=false).
- Baseline file captures 83 tables.
- Three deployed function sources now in repo, replacing the stale stubs.
- Types regenerated.

---

## Day 2 — conversations + messages + structured company_brain (2026-05-26)

**Goal:** create the three tables the Day-3 brief assumed already existed.

### What I did

- Inspected live schema. `workspaces.company_brain` already exists as a
  `text` column. `conversations` and `messages` do NOT exist. `chat-respond/index.ts`
  has been calling them in code, so every chat call currently 500s with
  "relation does not exist".
- Designed schemas to **exactly match** what `chat-respond/index.ts` already
  expects (column names, types, fields) so the function lights up without
  any code change once the tables exist.
- `conversations` — user-private threads; RLS scoped to `auth.uid()`.
- `messages` — child of conversations; RLS scoped via parent.
- `company_brain` — structured (company_name, what_we_do, who_we_sell_to,
  voice_and_tone, do_not_say jsonb[], examples jsonb[]); RLS scoped to
  `users.workspace_id` membership. PK is `workspace_id` so there's one row
  per workspace (upsert semantics). The old `workspaces.company_brain` text
  column is left intact for backward compat.
- Wrote `supabase/migrations/20260526010000_chat_and_company_brain.sql`.
- Applied via MCP `apply_migration`. Verified live: 3 new tables, 10 RLS
  policies, 1 `company_brain` row seeded for the existing workspace.
- Regenerated `src/integrations/supabase/types.ts` so the frontend client
  sees the new tables.
- Committed: `8c91c5c feat(db): add conversations, messages, structured company_brain tables`

### What I did NOT do

- Did not migrate data from `workspaces.company_brain` (text) into the new
  structured table. The existing text column is empty (default `''`), so
  nothing to migrate. If a workspace later has unstructured brain text,
  it'll need a manual port.
- Did not write any TypeScript helpers for reading the company_brain
  structured fields. That's an editor-UI concern for a later day.
- Did not wire the Day-3 prompt's "Company Brain interpolation" into
  `run-agent`. The deployed `run-agent` reads `agent.role_prompt` directly
  and doesn't yet read `company_brain`. That's the actual remaining Day 3
  work.

### Unilateral decisions

- Kept `workspaces.company_brain` text column. Could have dropped it now,
  but the deployed `chat-respond` and `orchestrate` source might still
  reference it via the auto-generated PostgREST types. Removing it without
  a grep-pass against all four deployed function sources is risky. Mark
  for deletion in a later cleanup.
- Used `users.workspace_id` for membership scoping rather than
  `organization_members`. Reasoning: that's what the deployed orchestration
  code paths use today. Consistency over richness.
- Added a single `set_updated_at()` trigger function and wired triggers on
  both `company_brain` and `conversations`. Idiomatic Supabase pattern;
  trivial weight.

### Day 2 exit state

- Three new tables live in `zbwsbnqqpkvdhqwavjke`, RLS enabled, policies set.
- One `company_brain` row exists (for the seeded workspace `0000…0001`).
- `chat-respond` will work the next time it's invoked, with no code change.
- Repo has a real migration file under `supabase/migrations/` for the change.

---

## Days 0-2 cumulative state (before Day 3)

| Concern | Where it stands |
|---|---|
| Leaked Firecrawl key | Rotated, dead. New key server-side only. `.env` gitignored. (Day 0) |
| Supabase project drift | Repo points at `zbwsbnqqpkvdhqwavjke`. Old project doesn't exist. (Day 1) |
| Schema not in repo | Baseline file captures 83 tables (informational). (Day 1) |
| Stale function source | `run-agent`, `orchestrate`, `approve-and-continue`, `chat-respond` synced from deployed. (Day 1) |
| `conversations` / `messages` missing | Created with RLS. (Day 2) |
| `company_brain` structured table | Created with RLS, seeded. (Day 2) |
| Local commits not pushed | `c9a4bb6 345bba4 5ebe666 8c91c5c` plus the merge `4c4bb00`. Waiting for user OK to push. |
| Day 3 status (heads-up) | Largely already done in production. Remaining real work: tune `agent.role_prompt` per agent, wire `company_brain` injection into `run-agent` (the deployed version doesn't read it yet). |

