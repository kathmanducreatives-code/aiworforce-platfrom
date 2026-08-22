-- THE RESERVE COULD NEVER HAVE SUCCEEDED.
--
-- ── WHAT THIS FIXES ─────────────────────────────────────────────────────────
--
-- `credit_transactions.kind` was CHECK-constrained to
--
--     ('founder_unlock', 'contact_unlock', 'grant', 'adjustment')
--
-- and `authorizeProviderCall` has always passed `provider_call`. Every reserve
-- it attempted therefore violated the constraint and threw.
--
-- ── WHY NOBODY NOTICED ──────────────────────────────────────────────────────
--
-- `LEAD_CREDIT_ENFORCEMENT` defaulted to `observe`, and in observe mode a
-- refusal — including an `rpc_error` refusal — still returns `allowed: true`
-- and lets the call proceed. So the throw was caught, recorded as a refusal
-- nobody read, and the run continued normally. The defect was invisible
-- BECAUSE enforcement was off, and would have surfaced the moment it was
-- turned on: `refuse("rpc_error", …)` under enforce blocks the call, so every
-- paid provider call in the product would have been refused at once.
--
-- It was found by running the reserve directly instead of trusting that a
-- path with no live exercise worked.
--
-- ── WHY WIDEN RATHER THAN RENAME ────────────────────────────────────────────
--
-- `provider_call` is a genuinely different kind from the two unlock kinds. The
-- allow-list predates the lead pipeline: `founder_unlock` and `contact_unlock`
-- are the `unlock-founders` function's vocabulary, and the lead path is a
-- third caller with a third meaning. Renaming it to `contact_unlock` would
-- file every Apify sourcing call under "contact unlock" and make the ledger
-- unreadable by kind, which is the one thing the column is for.
--
-- SAFE BY CONSTRUCTION: this WIDENS the CHECK. Every value that was legal
-- stays legal, no existing row can violate it, and no data moves.

alter table public.credit_transactions
  drop constraint if exists credit_transactions_kind_check;

alter table public.credit_transactions
  add constraint credit_transactions_kind_check
  check (kind in (
    'founder_unlock',
    'contact_unlock',
    'grant',
    'adjustment',
    -- One paid provider call made by the lead pipeline, reserved at the
    -- physical call boundary in `runTool`.
    'provider_call'
  ));

comment on column public.credit_transactions.kind is
  'What the credits were for. founder_unlock / contact_unlock: the unlock-founders function. grant: credits added to a workspace. adjustment: a manual correction. provider_call: one paid provider call from the lead pipeline, reserved before dispatch and settled on what actually happened.';
