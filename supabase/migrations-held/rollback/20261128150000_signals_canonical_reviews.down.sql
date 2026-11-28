-- Rollback of 20261128150000_signals_canonical_reviews.sql. Reviews of canonical events are removed
-- (they cannot exist under the old constraint); legacy reviews are untouched.
drop trigger if exists signal_reviews_same_workspace_event on public.signal_reviews;
drop function if exists public.signal_reviews_same_workspace_event();
delete from public.signal_reviews where signal_event_id is not null and signal_id is null and lead_candidate_id is null;
drop index if exists public.signal_reviews_user_event_uniq;
drop index if exists public.signal_reviews_event_idx;
alter table public.signal_reviews drop constraint if exists signal_reviews_target_present;
alter table public.signal_reviews add constraint signal_reviews_target_present
  check (signal_id is not null or lead_candidate_id is not null);
alter table public.signal_reviews drop column if exists signal_event_id;
