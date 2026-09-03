-- THE COLUMN THAT STOPS THE LOOP.
--
-- ── WHAT THE FIRST LIVE RUN DID ─────────────────────────────────────────────
--
-- Lineage 40295080 made 120 Firecrawl requests for 24 distinct URLs. Metaview,
-- Pump.co and Kody were fetched in nine consecutive slices — the same three
-- pages each, every time.
--
-- The cause was a phase boundary, not a coding error. P2 writes this cache and
-- P3 was to read it. But P2 deliberately does not change qualification
-- outcomes, so a researched company stays `insufficient_evidence`, the debt
-- gate raises the identical debt on the next slice, and with nothing consulting
-- the cache the run buys the same pages again. P2 without a read loops by
-- construction.
--
-- ── WHY A COLUMN AND NOT A CHECKPOINT FLAG ──────────────────────────────────
--
-- A checkpoint flag would stop the repeat WITHIN one lineage and do nothing for
-- the next mission, which would re-buy every page from scratch. The duplication
-- this table exists to prevent is cross-mission, so the record of "we have
-- already researched this" belongs in the same durable place as the pages.
--
-- ── PAGES ARE STILL PAGES ───────────────────────────────────────────────────
--
-- `requirement_id` records WHICH question prompted the fetch. It does not make
-- the row an answer to that question: the row is still the page's own text, and
-- the lookup that serves cross-mission reuse is still
-- (workspace, domain, page_intent) — untouched by this column. So a later
-- mission asking "software sold to recruiting teams" still reuses the page that
-- was fetched for "is it B2B SaaS", and still draws its own conclusion.
--
-- Nullable, because every row written before this migration was fetched without
-- one and a backfilled guess would be a fabricated provenance.

alter table public.company_web_evidence
  add column if not exists requirement_id text;

-- The lookup the debt gate uses: "have we already researched this company for
-- this requirement, recently enough to trust?"
create index if not exists company_web_evidence_requirement_lookup
  on public.company_web_evidence (workspace_id, company_key, requirement_id, fetched_at desc);
