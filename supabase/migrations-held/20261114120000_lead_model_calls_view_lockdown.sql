-- LOCK DOWN THE MODEL-SPEND VIEW — HELD. Not applied anywhere; needs approval.
--
-- public.lead_model_calls (20260822120000) is a VIEW over lead_execution_calls,
-- owned by postgres WITHOUT security_invoker, and granted to anon/authenticated
-- (Supabase default privileges). A view runs with its OWNER's rights, so it
-- bypassed the base table's RLS ("Members view lead_execution_calls"): anyone
-- with the publishable key could read every workspace's model-call rows and,
-- because the view is auto-updatable, UPDATE or DELETE them — erasing the
-- ledger the workspace spend ceiling (modelSpendCeiling) sums. Found read-only
-- on TEST 2026-11-11; production carries the same migration (not checked).
--
-- Fix: the view runs with the CALLER's rights (base-table RLS applies), and
-- browser roles lose all access to it. Every reader is server-side
-- (service_role: modelSpendCeiling, runOutcome, opsHealth, workforce-dashboard);
-- no frontend code reads it. No row is changed. Idempotent.
-- Rollback: rollback/20261114120000_lead_model_calls_view_lockdown.down.sql
alter view public.lead_model_calls set (security_invoker = true);
revoke all on public.lead_model_calls from anon, authenticated;
grant select on public.lead_model_calls to service_role;
