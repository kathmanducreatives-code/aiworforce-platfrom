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
-- ── WHY REPLICA IDENTITY IS LEFT ALONE ──────────────────────────────────────
--
-- Deliberately not `FULL`. An INSERT and an UPDATE both publish the complete new
-- row, which is everything the subscriber renders. The only payload the default
-- identity narrows is DELETE's `old`, and the one field read there is the
-- primary key, which the default already carries. `FULL` would add WAL volume on
-- every message write to widen a payload nothing reads.

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
