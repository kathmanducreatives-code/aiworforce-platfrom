-- Rollback of 20261111120000_lisa_signal_engine.sql (LISA V2 engine).
-- Removes only what the migration added. signal_events / signal_event_evidence rows that LISA
-- recorded are ordinary canonical rows and are KEPT (no data is deleted from existing tables);
-- the scan-run ledger, watch state and transition audit go with their tables.
-- Order: dependents first. Run AFTER rolling back 20261128150000 and 20261128140000.
drop function if exists public.lisa_finish_scan_run(uuid, int, text, jsonb, int, int, numeric, text, int);
drop function if exists public.lisa_claim_scan_run(uuid, text, text, text, int, int, boolean);
drop function if exists public.lisa_signal_transition(uuid, uuid, uuid, uuid, text, text);
drop function if exists public.lisa_record_signal(uuid, jsonb, jsonb);
drop function if exists public.lisa_verification_of(uuid, uuid, text);
drop table if exists public.lisa_watch_state;
drop table if exists public.lisa_scan_runs;
drop table if exists public.signal_event_transitions;
