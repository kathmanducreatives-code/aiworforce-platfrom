-- EVERY SIGNAL EVENT MUST SAY WHICH WORKFLOW PRODUCED IT.
--
-- ── WHAT THIS ADDS ──────────────────────────────────────────────────────────
--
-- `signal_events.origin`, one of:
--
--     lead_mission | scheduled_monitor | manual_scan
--     tracked_company | competitor_monitor
--
-- ── WHY IT IS NOT OPTIONAL ──────────────────────────────────────────────────
--
-- The canonical store is about to receive from two independent producers: Lead
-- missions, which find signals while sourcing, and Signals monitoring, which
-- goes looking for them. Without a stated origin the two are indistinguishable
-- once written, and the specific failure that matters becomes invisible: a
-- Signals feed consisting entirely of Lead by-products looks exactly like a
-- working one to any workspace that has run leads.
--
-- A nullable column would answer "unknown" for precisely the rows whose
-- provenance is in question, so the constraint is NOT NULL and the vocabulary
-- is a CHECK. `signalOrigin.ts` mirrors this list and is pinned to it by test.
--
-- ── WHY NOT NULL IS SAFE TO ADOPT NOW ───────────────────────────────────────
--
-- `signal_events` is EMPTY on the live project — SIGNALS_V2 has never been on,
-- so the dual-write has never fired and not one row exists. The backfill below
-- is therefore a no-op there, and is written anyway so this migration is
-- correct in any environment that does have rows: everything already stored
-- came from the Lead pipeline, which was the only writer.
--
-- This is the one moment NOT NULL is free. Once monitoring starts writing, an
-- unattributable row would have to be tolerated rather than rejected.

alter table public.signal_events
  add column if not exists origin text;

-- Anything already present predates monitoring and came from a Lead mission.
update public.signal_events
  set origin = 'lead_mission'
  where origin is null;

alter table public.signal_events
  alter column origin set not null;

alter table public.signal_events
  drop constraint if exists signal_events_origin_valid;

alter table public.signal_events
  add constraint signal_events_origin_valid
  check (origin in (
    'lead_mission', 'scheduled_monitor', 'manual_scan',
    'tracked_company', 'competitor_monitor'
  ));

comment on column public.signal_events.origin is
  'Which workflow produced this event. Mirrored by signalOrigin.ts; pinned by test.';
