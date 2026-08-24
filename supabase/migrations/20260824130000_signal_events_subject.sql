-- THE CANONICAL STORE MUST BE ABLE TO SAY WHAT THE EVIDENCE IS ABOUT.
--
-- ── THE PROBLEM ─────────────────────────────────────────────────────────────
--
-- `signal_events` required a lead entity: contact, account or lead_candidate.
-- That is a Leads-shaped assumption, and it makes the store unable to hold the
-- other half of what it is now shared by. A competitor's product release is
-- about a competitor. A public discussion of the problem the workspace solves
-- is about a market. Neither is a prospect, and neither should be filed under
-- one — attaching them to an arbitrary account would fabricate attribution and
-- put competitor news into prospect signal queries.
--
-- Proven, not assumed: an insert of a real Radar signal was rejected here by
-- `signal_events_entity_present` before any other constraint was reached.
--
-- ── THE SUBJECT MODEL ───────────────────────────────────────────────────────
--
-- `subject_type` + `subject_key` name what the evidence is ABOUT when it is not
-- a lead entity. The pair is all-or-nothing, and the key is canonical so the
-- same subject collapses across scans rather than accumulating spellings.
--
--     competitor : a named competitor company
--     company    : a named company that is not a lead entity in this workspace
--     market     : a category, topic or problem space
--
-- `company` is included because `origin = 'tracked_company'` is already a legal
-- value: without it that origin would have no expressible subject and would be
-- unusable the moment monitoring writes.
--
-- THIS IS NOT PHASE 3's MONITORING-SUBJECT STORE. An event subject is what a
-- piece of evidence is about. A monitoring subject is what a workspace has
-- asked Agentory to watch. A scan can produce evidence about a competitor
-- nobody asked to track, and a tracked company can produce no evidence at all.
--
-- ── TIME HONESTY ────────────────────────────────────────────────────────────
--
-- `occurred_at` was NOT NULL, and Radar does not know when the event behind a
-- web-search result happened. The available shortcut was to write the scan time
-- into it, which would state a source fact nobody observed and would make every
-- freshness band computed from it a fiction.
--
-- So `occurred_at` becomes nullable and `occurred_at_basis` records how it is
-- known. The CHECK makes the two inseparable: `source_reported` REQUIRES a
-- timestamp, `unknown` FORBIDS one. There is no way to record an invented time,
-- and no way to lose a real one.
--
-- Everything already stored has a source-reported time (the column was NOT
-- NULL), so the default backfills correctly. The table is in fact empty.

-- ── subject ─────────────────────────────────────────────────────────────────

alter table public.signal_events
  add column if not exists subject_type text,
  add column if not exists subject_key  text;

alter table public.signal_events
  drop constraint if exists signal_events_subject_type_valid;
alter table public.signal_events
  add constraint signal_events_subject_type_valid
  check (subject_type is null or subject_type in ('competitor', 'company', 'market'));

-- All-or-nothing: a type with no key names nothing, a key with no type is
-- ambiguous between a competitor and a market of the same name.
alter table public.signal_events
  drop constraint if exists signal_events_subject_pair_complete;
alter table public.signal_events
  add constraint signal_events_subject_pair_complete
  check ((subject_type is null) = (subject_key is null));

-- A canonical key, so the same subject collapses across scans.
alter table public.signal_events
  drop constraint if exists signal_events_subject_key_canonical;
alter table public.signal_events
  add constraint signal_events_subject_key_canonical
  check (subject_key is null or subject_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- ── attributable: a lead entity OR a subject ────────────────────────────────

alter table public.signal_events
  drop constraint if exists signal_events_entity_present;
alter table public.signal_events
  drop constraint if exists signal_events_attributable;
alter table public.signal_events
  add constraint signal_events_attributable
  check (
    contact_id is not null
    or account_id is not null
    or lead_candidate_id is not null
    or subject_type is not null
  );

-- ── time honesty ────────────────────────────────────────────────────────────

alter table public.signal_events
  add column if not exists occurred_at_basis text not null default 'source_reported';

alter table public.signal_events
  alter column occurred_at drop not null;

alter table public.signal_events
  drop constraint if exists signal_events_occurred_at_basis_valid;
alter table public.signal_events
  add constraint signal_events_occurred_at_basis_valid
  check (occurred_at_basis in ('source_reported', 'unknown'));

alter table public.signal_events
  drop constraint if exists signal_events_occurred_at_coherent;
alter table public.signal_events
  add constraint signal_events_occurred_at_coherent
  check (
    (occurred_at_basis = 'source_reported' and occurred_at is not null)
    or (occurred_at_basis = 'unknown' and occurred_at is null)
  );

-- ── vocabulary: the market category ─────────────────────────────────────────
--
-- Semantic types, not the UI's labels. Radar calls these rows `competitor` and
-- `linkedin_intent`; those name a filter chip, not a fact. What Radar actually
-- establishes is that a named competitor was publicly active, and that the
-- problem space is being discussed — it does not classify WHAT the competitor
-- did, so a type claiming `major_release` would assert more than was observed.
--
-- A separate `market` category, rather than filing these under `gtm`: a
-- competitor's motion must never answer a query meaning "this prospect is
-- changing how it sells".

alter table public.signal_events
  drop constraint if exists signal_events_category_valid;
alter table public.signal_events
  add constraint signal_events_category_valid
  check (signal_category in ('growth', 'gtm', 'product', 'founder_intent', 'risk', 'market'));

alter table public.signal_events
  drop constraint if exists signal_events_type_valid;
alter table public.signal_events
  add constraint signal_events_type_valid
  check (signal_type in (
    'recent_funding', 'employee_growth', 'market_expansion', 'geographic_expansion',
    'sales_hiring', 'revops_hiring', 'growth_hiring', 'new_revenue_leader',
    'outbound_initiative', 'positioning_change',
    'product_launch', 'major_release', 'new_integration', 'category_expansion',
    'founder_pipeline_post', 'founder_outbound_post', 'founder_customer_acquisition_post',
    'founder_hiring_post', 'founder_problem_statement',
    'person_left_company', 'company_outside_icp', 'role_changed', 'company_inactive',
    'signal_became_stale',
    'competitor_activity', 'market_problem_discussion'
  ));

comment on column public.signal_events.subject_type is
  'What the evidence is about when it is not a lead entity. NOT a monitoring subscription — see Phase 3.';
comment on column public.signal_events.subject_key is
  'Canonical, stable key for the subject. Lowercase slug; collapses spellings across scans.';
comment on column public.signal_events.occurred_at_basis is
  'How occurred_at is known. source_reported requires a timestamp; unknown forbids one.';
