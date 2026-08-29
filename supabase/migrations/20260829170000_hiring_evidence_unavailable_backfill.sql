-- SEPARATE "WE DID NOT FIND OUT" FROM "THERE IS NOTHING THERE".
--
-- ── WHAT THE OLD STATE MEANT, AND WHAT IT COST ─────────────────────────────
--
-- `hiring: "not_verified"` meant two different things, and `nextStageFor` treats
-- it as final. On 2026-08-29, lineage 06d3544a, every company ended in it:
--
--   Blue Signal Search    83 paid rows, charged, dataset never read
--   CareerXperts          same batch
--   Talentoma             same batch
--   Pursuit / Coda        90 paid rows, call timed out, never read
--   Storm4                verified by another generation, then overwritten
--   intelletec-ltd        covered by a settled call that returned nothing for it
--
-- Only the last is a finding. The rest are "nobody looked", and recording that as
-- a verdict turned a scheduling failure into a permanent business answer: a
-- company nothing would ever revisit, holding evidence already paid for.
--
-- ── THE DISCRIMINATOR ──────────────────────────────────────────────────────
--
-- NOT "did the assessment see rows for this company". A company can be
-- legitimately negative with zero rows of its own — the batch it was in settled
-- and named somebody else. The question is whether a SETTLED PROVIDER CALL
-- COVERED IT, which `completed_operations` records durably and which therefore
-- survives a restore. Exactly the predicate `hiringEvidenceWasInspected` applies
-- in the engine, so the backfill and the runtime cannot disagree.
--
-- A record is reclassified only when BOTH hold:
--   * its assessment cites no source (`evidence_source` absent or "none"), AND
--   * no `hiring_verification` operation is recorded against it.
--
-- ── WHAT THIS DOES NOT TOUCH ───────────────────────────────────────────────
--
-- Nothing verified, nothing under review, nothing already answered by a settled
-- call. 140 of the 194 `not_verified` records keep that state, because for them
-- it is true.
--
-- Reclassifying returns a company to the frontier; it does not resume anything.
-- 45 of the 54 belong to lineages that are already terminal and will never run
-- again — for those this is simply an honest record. The 9 that matter are in
-- active lineages, and they are precisely the companies whose evidence was
-- bought and never read.
--
-- IDEMPOTENT: re-running matches nothing, because the states it looks for are
-- gone.

-- ── 1. THE CHECKPOINTS ON EACH TASK ────────────────────────────────────────
with rebuilt as (
  select t.id,
    jsonb_agg(
      case
        when e.c->>'hiring' = 'not_verified'
         and coalesce(e.c->'snapshot'->'hiring_assessment'->>'evidence_source','none') = 'none'
         and not exists (
               select 1 from jsonb_array_elements_text(
                 coalesce(e.c->'completed_operations','[]'::jsonb)) op
                where op like '%hiring_verification%')
        then jsonb_set(e.c, '{hiring}', '"evidence_unavailable"')
        else e.c
      end
      -- ORDER IS PRESERVED. `jsonb_agg` over an unordered set would reshuffle
      -- the working set on every affected task, and investigation rank is
      -- positional in places.
      order by e.ord
    ) as companies
  from public.tasks t,
  lateral (select value as c, ordinality as ord
           from jsonb_array_elements(t.result->'lead_resume_checkpoint'->'companies')
                with ordinality as z(value, ordinality)) e
  where t.result ? 'lead_resume_checkpoint'
  group by t.id
)
update public.tasks t
   set result = jsonb_set(t.result, '{lead_resume_checkpoint,companies}', r.companies)
  from rebuilt r
 where r.id = t.id
   -- Only write where something actually changed, so a re-run is a no-op rather
   -- than a table rewrite.
   and t.result->'lead_resume_checkpoint'->'companies' is distinct from r.companies;

-- ── 2. AND THE LINEAGE'S OWN COPY ──────────────────────────────────────────
--
-- `lead_lineages.current_state` carries the same checkpoint, seeded by the
-- Phase 1 backfill. Leaving it behind would give a lineage two answers about the
-- same company the moment Phase 5 starts reading from it.
with rebuilt as (
  select l.lineage_id,
    jsonb_agg(
      case
        when e.c->>'hiring' = 'not_verified'
         and coalesce(e.c->'snapshot'->'hiring_assessment'->>'evidence_source','none') = 'none'
         and not exists (
               select 1 from jsonb_array_elements_text(
                 coalesce(e.c->'completed_operations','[]'::jsonb)) op
                where op like '%hiring_verification%')
        then jsonb_set(e.c, '{hiring}', '"evidence_unavailable"')
        else e.c
      end
      order by e.ord
    ) as companies
  from public.lead_lineages l,
  lateral (select value as c, ordinality as ord
           from jsonb_array_elements(l.current_state->'lead_resume_checkpoint'->'companies')
                with ordinality as z(value, ordinality)) e
  where l.current_state ? 'lead_resume_checkpoint'
  group by l.lineage_id
)
update public.lead_lineages l
   set current_state = jsonb_set(
         l.current_state, '{lead_resume_checkpoint,companies}', r.companies),
       updated_at = now()
  from rebuilt r
 where r.lineage_id = l.lineage_id
   and l.current_state->'lead_resume_checkpoint'->'companies' is distinct from r.companies;
