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
