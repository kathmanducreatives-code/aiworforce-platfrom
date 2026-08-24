-- PHASE 3G — GIVE THE ROWS ALREADY IN THE CANONICAL STORE WHAT THE FEED NEEDS.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
--
-- `mapRadarSignalToV2` carried five fields into `normalized_value` and left the
-- rest in the legacy row, reachable through `legacy_signal_id`. That was right
-- while `signals` was still the feed's source. Phase 3G switches the feed to
-- read `signal_events`, and a row carrying only a title would drop the
-- deterministic ICP scoring, the freshness reasoning, the priority and the
-- missing-evidence diagnostics — the parts of Radar most worth keeping.
--
-- The mapper now carries them. This gives the same fields to the rows written
-- before it did, so the switch is lossless for what is already stored rather
-- than only for what arrives next.
--
-- ── WHAT IT COPIES, AND WHAT IT WILL NOT ────────────────────────────────────
--
-- Scores, bands, reasons and company-level facts. No person, no email, no
-- phone: the writer's sanitization policy rejects those, and a backfill that
-- bypassed the writer must be at least as strict as the writer is. Every key
-- below is named explicitly for that reason — `raw` is NOT merged wholesale.
--
-- IDEMPOTENT. `||` right-merges, and every value comes from the legacy row, so
-- running it twice writes the same object. Existing keys are preserved: the
-- backfill fills gaps, it never overwrites what the mapper already decided.

update public.signal_events e
set normalized_value =
  jsonb_strip_nulls(
    jsonb_build_object(
      'description',       s.description,
      'fit_score',         nullif(s.raw #> '{fit_score}', 'null'::jsonb),
      'signal_score',      nullif(s.raw #> '{signal_score}', 'null'::jsonb),
      'proof_score',       nullif(s.raw #> '{proof_score}', 'null'::jsonb),
      'freshness_score',   nullif(s.raw #> '{freshness_score}', 'null'::jsonb),
      'trigger_score',     nullif(s.raw #> '{trigger_score}', 'null'::jsonb),
      'priority',          coalesce(s.raw ->> 'priority_badge', s.raw ->> 'priority'),
      'matched_icp',       nullif(s.raw #> '{matched_icp}', 'null'::jsonb),
      'why_it_matters',    s.raw ->> 'why_it_matters',
      'why_now',           s.raw ->> 'why_now',
      'next_action',       s.raw ->> 'next_action',
      'missing_evidence',  nullif(s.raw #> '{missing_evidence}', 'null'::jsonb),
      'risk_flags',        nullif(s.raw #> '{risk_flags}', 'null'::jsonb),
      'company_name',      s.raw #>> '{source_details,company}',
      'company_domain',    s.raw #>> '{source_details,company_domain}',
      'company_location',  s.raw #>> '{source_details,location}'
    )
  )
  -- THE MAPPER'S OWN VALUES WIN. This fills what was never carried; it does not
  -- revise what the canonical row already says.
  || coalesce(e.normalized_value, '{}'::jsonb)
from public.signals s
where e.legacy_signal_id = s.id
  and s.raw is not null;
