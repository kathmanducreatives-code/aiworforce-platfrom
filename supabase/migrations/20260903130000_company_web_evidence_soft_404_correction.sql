-- THE 404s THAT WERE ALREADY IN THE TABLE WHEN THE FIX LANDED.
--
-- ── WHAT HAPPENED ───────────────────────────────────────────────────────────
--
-- The first live evidence run (lineage 40295080) stored three pages as
-- `status: 'ok'` that are not pages at all:
--
--   hebbia.com/locations     223 chars  "# 404 - Page not found"
--   immuta.com/pricing       245 chars  "Whoops, that page is gone."
--   neotalogic.com/product   620 chars  "Error 404 ... no longer exists"
--
-- All three sites answer HTTP 200 with a not-found body, and the runner
-- classified anything with `ok && markdown.trim()` as readable.
--
-- ── WHY THIS NEEDED CORRECTING AND NOT JUST FIXING FORWARD ──────────────────
--
-- `looksLikeMissingPage` stops NEW rows being written this way. It does nothing
-- about rows already stored, and the cache read added in the same change
-- selects on `status = 'ok'`. So the very next run would have served
-- "404 - Page not found" back as cached evidence for Hebbia, Immuta and Neota
-- Logic, and invited the extractor to quote it — for the whole 720-hour TTL.
--
-- The fix that stopped the re-buying is what made these dangerous. Before it,
-- every slice re-fetched and a stored 404 was mostly noise.
--
-- ── THE PREDICATE IS THE CODE'S OWN ─────────────────────────────────────────
--
-- Same test `looksLikeMissingPage` applies: a not-found phrase AND a length
-- bound. A long page that merely mentions a 404 — an API doc, a changelog — is
-- a real page and is left alone. Conservative in the same direction as the
-- code: a real page wrongly marked missing costs one re-fetch; a 404 left
-- marked `ok` becomes durable false evidence.
--
-- Applied to production on 2026-09-03 via the Management API before the
-- following acceptance run; recorded here so the correction is reproducible in
-- any other environment rather than living only in one session's history.
-- Idempotent: it matches only rows still marked `ok`.

update public.company_web_evidence
   set status = 'not_found'
 where status = 'ok'
   and length(source_text) <= 1200
   and (
        source_text ilike '%404%'
     or source_text ilike '%page not found%'
     or source_text ilike '%page is gone%'
     or source_text ilike '%no longer exists%'
     or source_text ilike '%cannot be found%'
   );
