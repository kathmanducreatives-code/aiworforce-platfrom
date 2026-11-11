-- ROLLBACK for 20261114120000_lead_model_calls_view_lockdown.sql. Restores the
-- previous (vulnerable) state: owner-rights view, browser roles granted. Use
-- only to undo a failed apply. Idempotent.
alter view public.lead_model_calls reset (security_invoker);
grant all on public.lead_model_calls to anon, authenticated;
