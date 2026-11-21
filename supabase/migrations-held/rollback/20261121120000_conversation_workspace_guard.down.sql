-- Rollback of 20261121120000_conversation_workspace_guard.sql. No data change.
drop trigger if exists conversations_workspace_guard on public.conversations;
drop function if exists public.conversations_workspace_guard();
