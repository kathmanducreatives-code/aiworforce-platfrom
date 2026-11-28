-- Signals recovery · REVIEWS OF CANONICAL SIGNALS. HELD (contract lane; Brain TEST via install-lisa.sh).
-- Additive and non-destructive: no row is changed, the legacy signal_id path keeps working.
-- Rollback: rollback/20261128150000_signals_canonical_reviews.down.sql
--
-- WHY: signal_reviews.signal_id references the LEGACY public.signals table only, so a review of a
-- canonical signal_events row failed with a foreign-key violation (23503) — every LISA signal, and
-- every dashboard review of one. A review may now name the canonical event instead.
alter table public.signal_reviews
  add column if not exists signal_event_id uuid references public.signal_events(id) on delete cascade;

alter table public.signal_reviews drop constraint if exists signal_reviews_target_present;
alter table public.signal_reviews add constraint signal_reviews_target_present
  check (signal_id is not null or lead_candidate_id is not null or signal_event_id is not null);

create unique index if not exists signal_reviews_user_event_uniq
  on public.signal_reviews (workspace_id, user_id, signal_event_id) where signal_event_id is not null;
create index if not exists signal_reviews_event_idx on public.signal_reviews (signal_event_id);

-- A review names an event of ITS OWN workspace (RLS already scopes the review row; this keeps the
-- foreign key from pointing across workspaces).
create or replace function public.signal_reviews_same_workspace_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.signal_event_id is not null and not exists (
    select 1 from public.signal_events e where e.id = new.signal_event_id and e.workspace_id = new.workspace_id
  ) then
    raise exception 'signal_reviews: signal_event_id belongs to another workspace' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.signal_reviews_same_workspace_event() from public, anon, authenticated;
drop trigger if exists signal_reviews_same_workspace_event on public.signal_reviews;
create trigger signal_reviews_same_workspace_event
  before insert or update of signal_event_id, workspace_id on public.signal_reviews
  for each row execute function public.signal_reviews_same_workspace_event();

comment on column public.signal_reviews.signal_event_id is
  'The canonical signal (signal_events) this review is about. signal_id remains for legacy public.signals rows.';
