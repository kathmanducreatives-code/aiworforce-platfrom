-- REMOVE THE FICTIONAL ORION PILOT FROM THE TEST PROJECT. NEEDS APPROVAL. NOT RUN.
--   psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f scripts/test-project/orion-pilot-cleanup.sql
-- Touches ONLY the two fixed pilot workspace ids. Conversations and messages the
-- pilot created are deleted first; accounts, leads and signals cascade with the workspace.
delete from public.messages where conversation_id in (select id from public.conversations
  where workspace_id in ('a71a0000-0000-4000-8000-0000000011a1','a71a0000-0000-4000-8000-0000000011a2'));
delete from public.conversations where workspace_id in ('a71a0000-0000-4000-8000-0000000011a1','a71a0000-0000-4000-8000-0000000011a2');
delete from public.lead_model_calls where workspace_id in ('a71a0000-0000-4000-8000-0000000011a1','a71a0000-0000-4000-8000-0000000011a2');
delete from public.workspace_members where workspace_id in ('a71a0000-0000-4000-8000-0000000011a1','a71a0000-0000-4000-8000-0000000011a2');
delete from public.workspaces where id in ('a71a0000-0000-4000-8000-0000000011a1','a71a0000-0000-4000-8000-0000000011a2');
select 'removed ORION pilot workspaces: ' || (2 - (select count(*) from public.workspaces
  where id in ('a71a0000-0000-4000-8000-0000000011a1','a71a0000-0000-4000-8000-0000000011a2')));
