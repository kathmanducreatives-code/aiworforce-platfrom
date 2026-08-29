-- SEED THE LINEAGES FROM THE MOST ADVANCED COHERENT GENERATION.
--
-- ── WHY NOT THE NEWEST ─────────────────────────────────────────────────────
--
-- Lineage 06d3544a has three generations. The NEWEST holds nothing:
--
--   06d3544a  11:12:06  hiring_verified 3  cited 16  ← the parent
--   237717dd  11:13:11  hiring_verified 0  cited  0
--   0ed83116  11:13:19  hiring_verified 0  cited  0  ← newest
--
-- The parent verified Storm3 (2 cited job rows), Storm4 (1) and Blue Signal
-- Search (13) at 11:14:07 — sixty-six seconds after its own continuation had
-- already forked from a checkpoint that predated the verification. Seeding by
-- recency would discard 16 rows of paid evidence and three verified companies
-- across the two lineages that hold any.
--
-- So the ranking puts CITED EVIDENCE first and recency last, where recency is a
-- deterministic tiebreak and nothing more:
--
--   coherent DESC, cited_rows DESC, hiring_verified DESC,
--   identity_objects DESC, companies DESC, completed_capabilities DESC,
--   created_at DESC
--
-- Coherence is `checkpointCoherence` from the engine, not a new rule: a
-- checkpoint is incoherent when it marks identity resolution complete while a
-- "resolved" company carries no identity object, or marks hiring verification
-- complete while a verified company carries no assessment.
--
-- ── WHAT THIS DELIBERATELY DOES NOT DO ─────────────────────────────────────
--
-- It does not MERGE generations. The children of 06d3544a hold 11 identity
-- objects to the parent's 4, and those 7 extra resolutions are dropped. That is
-- a considered trade, not an oversight: identity made ZERO provider calls in
-- these runs — every LinkedIn URL was already on the discovery row — so
-- re-resolving is free, while the 16 cited rows cost real money and cannot be
-- recovered without buying them again. A monotonic merge is Phase 5's job, where
-- the rule that evidence may be upgraded but never downgraded is enforced.
--
-- ── ACTIVE MEANS RESUMABLE, NOT MERELY UNFINISHED ──────────────────────────
--
-- A lineage is seeded `active` only when its terminal status actually says
-- `continuation_required` AND the seed is coherent AND it holds a working set.
-- Anything else is terminal. An `active` lineage with no companies would be an
-- invitation to resume nothing, which is the shape of the barren-slice loop this
-- whole repair exists to end.
--
-- Empty historical lineages get `backfill_no_resumable_state` rather than their
-- old terminal reason. Reusing `round_limit_reached` there would imply a
-- resumable checkpoint that was never written.
--
-- IDEMPOTENT. Re-running inserts nothing and relinks nothing.

with gen as (
  select
    coalesce(t.result->>'lead_resume_lineage_root', t.id::text)::uuid as lineage_root,
    t.id, t.workspace_id, t.created_at, t.result,
    t.result->>'terminal_status' as term,
    t.result->'capability_execution_state'->>'mission_hash' as mission_hash,
    t.result->'capability_execution_state'->'completed_capabilities' as caps_list,
    coalesce(jsonb_array_length(t.result->'capability_execution_state'->'completed_capabilities'),0) as caps,
    coalesce((t.result->'capability_execution_state'->'progress'->>'hiring_verified')::int,0) as hiring_verified,
    coalesce(jsonb_array_length(t.result->'lead_resume_checkpoint'->'companies'),0) as companies,
    coalesce((select sum(jsonb_array_length(coalesce(c->'snapshot'->'hiring_jobs','[]'::jsonb)))
              from jsonb_array_elements(t.result->'lead_resume_checkpoint'->'companies') c),0) as cited_rows,
    coalesce((select count(*) from jsonb_array_elements(t.result->'lead_resume_checkpoint'->'companies') c
              where jsonb_typeof(c->'snapshot'->'identity')='object'),0) as identity_objects,
    coalesce((select count(*) from jsonb_array_elements(t.result->'lead_resume_checkpoint'->'companies') c
              where c->>'identity'='resolved'
                and jsonb_typeof(c->'snapshot'->'identity')<>'object'),0) as incoherent_identity,
    coalesce((select count(*) from jsonb_array_elements(t.result->'lead_resume_checkpoint'->'companies') c
              where c->>'hiring' in ('verified_externally','verified_from_existing_evidence')
                and jsonb_typeof(c->'snapshot'->'hiring_assessment')<>'object'),0) as incoherent_hiring
  from public.tasks t
  where t.result ? 'capability_execution_state'
),
scored as (
  select *,
    (case when caps_list ? 'company_identity_resolution' and incoherent_identity > 0 then false
          when caps_list ? 'hiring_verification'         and incoherent_hiring   > 0 then false
          else true end) as coherent
  from gen
),
ranked as (
  select *,
    row_number() over (partition by lineage_root order by
      coherent desc, cited_rows desc, hiring_verified desc,
      identity_objects desc, companies desc, caps desc, created_at desc) as adv,
    min(created_at) over (partition by lineage_root) as lineage_started_at
  from scored
),
seed as (
  select *,
    -- RESUMABLE = coherent AND holds a working set. Both, or neither.
    (coherent and companies > 0) as resumable
  from ranked where adv = 1
)
insert into public.lead_lineages (
  lineage_id, workspace_id, mission_hash, state_version, current_state,
  lease_holder, lease_expires_at, generation, status, terminal_reason,
  last_progress_at, created_at, updated_at
)
select
  s.lineage_root,
  s.workspace_id,
  s.mission_hash,
  -- One write has happened: the seed. Null state has had none.
  case when s.companies > 0 then 1 else 0 end,
  case when s.companies > 0 then jsonb_build_object(
    'version', 'lineage-lease-v1',
    'backfilled', true,
    'seeded_from_task', s.id,
    'seeded_reason', 'most_advanced_coherent_generation',
    'written_at', now(),
    'terminal_status', s.term,
    'capability_execution_state', s.result->'capability_execution_state',
    'lead_resume_checkpoint', s.result->'lead_resume_checkpoint'
  ) else null end,
  null, null,                       -- no lease: no generation has ever held one
  0,                                -- no lease acquisition has happened yet
  case when s.term = 'continuation_required' and s.resumable then 'active' else 'terminal' end,
  case
    when s.term = 'continuation_required' and s.resumable then null
    -- Never dress an empty checkpoint up as a resumable one.
    when not s.resumable then 'backfill_no_resumable_state'
    else coalesce(s.term, 'backfill_unknown_terminal_state')
  end,
  -- Progress is evidence, not activity.
  case when s.cited_rows > 0 or s.hiring_verified > 0 then s.created_at else null end,
  s.lineage_started_at,             -- when the LINEAGE began, not when the seed ran
  now()
from seed s
on conflict (lineage_id) do nothing;

-- EVERY TASK NAMES ITS LINEAGE. `tasks_one_live_generation_per_lineage` is a
-- unique index over this column for the live statuses, so from here the database
-- itself refuses a second concurrent generation.
update public.tasks t
   set lineage_id = coalesce(t.result->>'lead_resume_lineage_root', t.id::text)::uuid
 where t.result ? 'capability_execution_state'
   and t.lineage_id is null
   and exists (
     select 1 from public.lead_lineages l
      where l.lineage_id = coalesce(t.result->>'lead_resume_lineage_root', t.id::text)::uuid
   );
