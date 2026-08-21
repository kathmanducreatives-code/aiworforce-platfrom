-- COST PROVENANCE: a fourth grade, because three could not tell the two useful
-- cases apart.
--
-- `lead_execution_calls.cost_source` allowed 'provider_reported', 'estimated'
-- and 'unknown'. Every row this table has ever held says 'unknown', because
-- nothing read the provider's run document and nothing consulted the verified
-- per-actor price table in `hiringActorCatalog`.
--
-- Wiring that table up produces figures accurate to the cent that are still not
-- the provider's own number. Filing those under 'estimated' would put them
-- beside genuine guesses and make "what did this run cost?" unanswerable with a
-- grade attached. So they get their own name.
--
-- SAFE BY CONSTRUCTION. The change WIDENS a CHECK constraint: every value that
-- was legal stays legal, no existing row can violate it, and no data moves. The
-- `actual_cost_usd IS NULL OR cost_source = 'provider_reported'` invariant is
-- untouched — 'event_priced' populates `estimated_cost_usd` only.
--
-- ORDERING MATTERS. The ledger writer swallows failures by design, so shipping
-- the code that emits 'event_priced' before this constraint exists would make
-- every insert fail silently and empty the table again, exactly as the stray
-- `version` column did.

alter table public.lead_execution_calls
  drop constraint if exists lead_execution_calls_cost_source_check;

alter table public.lead_execution_calls
  add constraint lead_execution_calls_cost_source_check
  check (cost_source in ('provider_reported', 'event_priced', 'estimated', 'unknown'));

comment on column public.lead_execution_calls.cost_source is
  'How the cost figure was obtained. provider_reported: the provider stated a charge for this run (the only grade permitted to populate actual_cost_usd). event_priced: computed from the verified per-actor price table and this run''s own counts. estimated: a figure with no per-event basis. unknown: nothing is known — not zero.';
