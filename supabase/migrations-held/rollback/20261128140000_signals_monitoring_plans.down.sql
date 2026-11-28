-- Rollback of 20261128140000_signals_monitoring_plans.sql. Monitoring subjects created by
-- activation stay (they are ordinary rows); disable them first if they should stop.
drop function if exists public.monitoring_plan_decide(uuid, text);
drop table if exists public.monitoring_plans;
