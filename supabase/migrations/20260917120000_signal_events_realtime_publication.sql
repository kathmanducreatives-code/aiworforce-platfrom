-- LIVE INTELLIGENCE: PUBLISH NEW SIGNALS TO THE DASHBOARD.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
--
-- The dashboard's Live Intelligence bar subscribes to INSERTs on
-- `public.signal_events`, filtered by `workspace_id`
-- (src/hooks/useSignalEventInserts.ts). Postgres publishes changes only for
-- tables in the `supabase_realtime` publication, and `signal_events` is not in
-- the baseline's name-by-name list — the same gap that kept the Pilot chat from
-- being live until 20260828090000_messages_realtime_publication.sql. Without
-- this, the channel reaches SUBSCRIBED and never delivers.
--
-- ── WHY INSERT ONLY, AND WHY REPLICA IDENTITY STAYS DEFAULT ─────────────────
--
-- Writers upsert with `ignoreDuplicates` on (workspace_id, dedupe_key), so an
-- INSERT is exactly "a genuinely new real-world event" and a re-detection writes
-- nothing. The bar listens for INSERT alone. As measured for `messages`, INSERT
-- events carry the full new row and are authorised by RLS under the default
-- replica identity; FULL is needed only for UPDATE/DELETE delivery, which
-- nothing subscribes to. Leaving the default avoids extra WAL on a table every
-- scan writes to.
--
-- ── ISOLATION ───────────────────────────────────────────────────────────────
--
-- Realtime evaluates the existing SELECT policy, "signal_events members read"
-- (has_workspace_access(auth.uid(), workspace_id)), per subscriber, so a member
-- receives only rows from workspaces they can already read. The client filter
-- and a client-side workspace check (acceptArrival) are additional layers, not
-- the boundary.
--
-- Idempotent: safe to run whether or not the table is already published.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'signal_events'
  ) then
    execute 'alter publication supabase_realtime add table public.signal_events';
  end if;
end $$;
