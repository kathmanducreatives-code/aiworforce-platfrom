-- PHASE 8 — THE DEDUPE KEY WAS NAMESPACED BY WHOEVER ASKED.
--
-- Every company-level signal carried a key like
-- `monitor|company|eulerhq-com|recent_funding`. So "Acme is hiring" found by a
-- monitor and the same fact found by a Lead mission produced two keys, and
-- therefore two events, about one fact.
--
-- That prefix is ROUTING LOGIC INSIDE AN IDENTITY. Origin says who found
-- something; it has no business deciding whether two findings are the same
-- finding. The canonical key is the question — subject type, subject, signal
-- type — so both surfaces asking it get the same key and the second write
-- deduplicates.
--
-- ── WHY MARKET AND COMPETITOR CONTENT ROWS ARE LEFT ALONE ───────────────────
--
-- A company-level signal is ONE FACT. A market conversation is an ITEM: two
-- articles about the same competitor are two things that were said, and
-- collapsing them would delete one. Those keys carry a source URL and a
-- different granularity, Radar is their only writer, and rewriting them would
-- merge distinct evidence rather than deduplicate a repeated fact.
--
-- Idempotent: the update only touches rows that still carry the prefix.

update public.signal_events
set dedupe_key = subject_type || '|' || subject_key || '|' || signal_type
where dedupe_key like 'monitor|%'
  and subject_type is not null
  and subject_key is not null;
