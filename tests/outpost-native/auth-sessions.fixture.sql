-- DISPOSABLE PLATFORM FIXTURE ONLY. Never install in a Supabase project.
-- Baseline contract shim has auth.users but no GoTrue sessions catalog.
-- These are the native columns used by the migration, not a simulated RLS engine.
create table auth.sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  not_after timestamptz
);
revoke all on auth.sessions from public, anon, authenticated, service_role;
