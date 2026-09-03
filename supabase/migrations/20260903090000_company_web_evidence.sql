-- WEB EVIDENCE: THE PAGES WE FETCHED, KEPT AS FACTS RATHER THAN ANSWERS.
--
-- ── WHY THIS TABLE EXISTS ───────────────────────────────────────────────────
--
-- Production run a5c1616e returned 1 of 5. Seven companies passed UK presence,
-- employee count and verified sales hiring, carried zero failed requirements,
-- and were refused because nothing in the evidence registry could be cited for
-- "B2B SaaS". Metaview scored 86 at confidence 0.94 with a London office and an
-- open SDR role. The evaluator was right to refuse: it had nothing to point at.
--
-- This table holds the thing it had nothing to point at — the text of the
-- company's own pages, with the URL it came from and the time it was read.
--
-- ── PAGES, NOT ANSWERS ──────────────────────────────────────────────────────
--
-- What is stored is the PAGE, never the conclusion drawn from it. A claim is
-- mission-relative: it answers the question that was asked. A page is a fact
-- about the company. So a later mission asking "software sold to recruiting
-- teams" reuses the fetch that answered "is it B2B SaaS" and reaches its own
-- verdict from the same words. Caching the verdict instead would save one model
-- call and destroy that property.
--
-- This is also why `source_text` is here rather than a summary: a summary is an
-- interpretation, and an interpretation cannot be re-interpreted.
--
-- ── THE UNIQUE INDEX IS ON CONTENT, NOT URL ─────────────────────────────────
--
-- A page re-fetched unchanged is the same observation and collides. The same
-- URL with NEW content is a different observation and gets its own row, so the
-- history of what a company said about itself stays readable and a stale row is
-- never silently overwritten by a fresh one.
--
-- ── WORKSPACE SCOPED, DELIBERATELY ──────────────────────────────────────────
--
-- These are public pages, so a global cache would be cheaper and would still
-- leak nothing confidential about the COMPANIES. It would leak something about
-- the WORKSPACES: which companies a competitor of theirs has been researching,
-- and when. That is a trust decision, so it is made explicitly. Widening this
-- later is a change to one lookup; narrowing it after the fact is not.

create table if not exists public.company_web_evidence (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null,
  -- The canonical LinkedIn company URL — the identity the whole lead engine
  -- uses. Stored alongside `domain` because identity and site are different
  -- claims and a company can change one without changing the other.
  company_key      text not null,
  domain           text not null,
  page_intent      text not null,
  source_url       text not null,
  content_hash     text not null,
  -- The page's own words, truncated at the same 6000 chars the tool layer
  -- already applies. A HARD FACT: quoted, never rewritten.
  source_text      text not null,
  fetched_at       timestamptz not null default now(),
  provider         text not null default 'firecrawl',
  provider_run_id  text,
  -- ok | empty | blocked | not_found | timeout. An empty or blocked page is a
  -- recorded observation, not a failure to hide: "this company has no pricing
  -- page" is itself evidence, and a missing row would look like we never asked.
  status           text not null,
  created_at       timestamptz not null default now()
);

create unique index if not exists company_web_evidence_identity
  on public.company_web_evidence (workspace_id, domain, page_intent, content_hash);

-- The read path P3 will use: freshest page of a given kind for a given site.
create index if not exists company_web_evidence_lookup
  on public.company_web_evidence (workspace_id, domain, page_intent, fetched_at desc);

alter table public.company_web_evidence enable row level security;

-- SELECT ONLY, matching every other workspace-scoped table in this schema.
-- Writes stay service-role: a client that could insert here could fabricate a
-- citation, and a fabricated citation is worse than an unreadable table.
drop policy if exists company_web_evidence_select_members
  on public.company_web_evidence;

create policy company_web_evidence_select_members
  on public.company_web_evidence
  for select
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = company_web_evidence.workspace_id
        and wm.user_id = auth.uid()
    )
  );
