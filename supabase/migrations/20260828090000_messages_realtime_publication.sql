-- THE CHAT WAS NEVER PUBLISHED, SO THE CHAT WAS NEVER LIVE.
--
-- ── THE SYMPTOM, AND WHY IT LOOKED LIKE A FRONTEND BUG ──────────────────────
--
-- Send a message, the backend answers, the reply does not appear. Reload, or
-- switch conversations and back, and it is there. Every report of this reads as
-- a stale-cache problem in React, and every one of them was wrong.
--
-- `useChatConversation` subscribes to `postgres_changes` on `public.messages`,
-- filtered by `conversation_id`, and dedupes by row id. That code is correct and
-- always has been. The channel reaches SUBSCRIBED. The websocket is open. The
-- row is written. And no event ever arrives, because Postgres does not publish
-- changes for a table that is not in the publication.
--
-- Measured against production before writing this, with a control:
--
--   table       in publication   subscribed   row written   events received
--   messages    no               SUBSCRIBED   yes           0
--   tasks       yes              SUBSCRIBED   yes           1
--
-- Same client, same socket, same session, same method. Realtime works.
--
-- ── HOW IT WAS MISSED ───────────────────────────────────────────────────────
--
-- The baseline schema publishes nineteen tables by name, and the list contains
-- `collaboration_messages` — the room chat — but not `messages`, the Pilot chat.
-- So one chat surface in the product updates live and the other does not, which
-- is exactly the shape that makes a missing publication look like a React
-- problem: the same patterns visibly work elsewhere in the same app.
--
-- A name-by-name list is the mechanism. Nothing failed; a table was simply never
-- added when the Pilot chat was built.
--
-- ── REPLICA IDENTITY: THE FIRST ANSWER HERE WAS WRONG ───────────────────────
--
-- This originally argued for leaving the default, on the reasoning that INSERT
-- and UPDATE publish the complete new row and the only field read on DELETE is
-- the primary key. Measured after the publication landed, with a filtered and an
-- unfiltered channel side by side:
--
--   INSERT   delivered on both channels
--   UPDATE   delivered on NEITHER
--   DELETE   delivered on the unfiltered channel only, old = { id }
--
-- Two things the argument missed. Under RLS, Realtime must evaluate the policy
-- against the OLD row for UPDATE and DELETE, and the default identity gives it
-- only the primary key — so it cannot authorise the event and drops it. And the
-- subscription FILTER has the same problem: `conversation_id=eq.<id>` cannot
-- match an old record that does not carry `conversation_id`.
--
-- `messages` is overwhelmingly insert-only — an UPDATE happens when a
-- clarification is marked resolved, a DELETE when a conversation is removed — so
-- the WAL cost of `FULL` is small and paid rarely. Without it, any future flow
-- that patches a message in place goes stale in the UI: precisely the bug this
-- migration exists to fix, reintroduced one event type over.

-- The old row must carry enough for RLS and for the conversation filter.
alter table public.messages replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
end $$;
