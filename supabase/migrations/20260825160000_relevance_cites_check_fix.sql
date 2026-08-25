-- PHASE 7 — A CHECK THAT PASSED ON NULL WAS NOT A CHECK.
--
-- `signal_cluster_relevance_model_verdict_cites` was written as:
--
--   source <> 'model' or relevance = 'none' or array_length(evidence_event_ids, 1) >= 1
--
-- `array_length` of an EMPTY array is NULL, not 0. `NULL >= 1` is NULL, and a
-- CHECK constraint rejects only FALSE — so a believed verdict citing nothing
-- was accepted by the database. Verified by inserting one: it went in.
--
-- The validator already refuses such a verdict, and the whole point of
-- restating the rule here was to hold when a caller bypasses the validator.
-- A constraint that cannot fail is not a second line of defence; it is the
-- appearance of one, which is worse than none.

alter table public.signal_cluster_relevance
  drop constraint if exists signal_cluster_relevance_model_verdict_cites;

alter table public.signal_cluster_relevance
  add constraint signal_cluster_relevance_model_verdict_cites
  check (
    source <> 'model'
    or relevance = 'none'
    -- COALESCED, so an empty array is 0 and the comparison is FALSE rather
    -- than NULL. This is the whole fix.
    or coalesce(array_length(evidence_event_ids, 1), 0) >= 1
  );
