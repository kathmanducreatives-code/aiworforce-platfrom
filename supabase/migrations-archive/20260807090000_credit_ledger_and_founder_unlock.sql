-- THE FIRST LEDGER THAT MOVES MONEY. IT IS SERVER-ONLY BY CONSTRUCTION.
--
-- What existed before this: `src/lib/credits/ledger.ts`, which kept the
-- workspace balance in `company_brain.profile.credits` — a JSON blob that RLS
-- policy `company_brain_member_update` lets ANY workspace member write. That was
-- survivable only because nothing ever charged against it (`reserveCredits` and
-- `finalizeCharge` had zero call sites). The moment a server trusts that blob,
-- "give myself 10,000 credits" is one PATCH away.
--
-- So the balance moves here, behind tables with NO client write policy at all,
-- and every mutation goes through a SECURITY DEFINER function whose EXECUTE is
-- granted to service_role alone. Nothing in this file reads company_brain.
--
-- THE CONCURRENCY RULE. Reserve is ONE conditional UPDATE whose WHERE clause
-- carries the sufficiency test. It is never a SELECT of the balance followed by
-- an UPDATE of it — that is the read-then-write race the frontend ledger has,
-- where two unlocks both read 3 credits and both spend them.
--
-- THE REPLAY RULE. Finalize only acts on a transaction still in `reserved`.
-- A retried callback, a crash-recovery replay or a double-click therefore
-- refunds once and charges once.

-- ── BALANCES ────────────────────────────────────────────────────────────────
create table if not exists public.workspace_credit_balances (
  workspace_id     uuid primary key
                     references public.workspaces(id) on delete cascade,
  balance_credits  integer not null default 0 check (balance_credits  >= 0),
  -- Held by an in-flight reservation: already removed from `balance_credits`,
  -- not yet charged. Kept visible so a leaked reservation is observable rather
  -- than merely missing.
  reserved_credits integer not null default 0 check (reserved_credits >= 0),
  plan_id          text    not null default 'free_trial',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ── THE LEDGER ──────────────────────────────────────────────────────────────
-- The audit trail, and the record a support question is answered from. The
-- balance row above is a maintained aggregate of this.
create table if not exists public.credit_transactions (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null
                      references public.workspaces(id) on delete cascade,
  -- SUPPLIED BY THE CALLER, SCOPED TO THE WORKSPACE. This is what makes a
  -- double-clicked Unlock button charge exactly once.
  idempotency_key   text not null,
  kind              text not null check (kind in (
                      'founder_unlock', 'contact_unlock', 'grant', 'adjustment')),
  status            text not null check (status in (
                      'reserved', 'charged', 'partial', 'not_charged',
                      'released', 'granted')),
  estimated_credits integer not null default 0 check (estimated_credits >= 0),
  reserved_credits  integer not null default 0 check (reserved_credits  >= 0),
  actual_credits    integer not null default 0 check (actual_credits    >= 0),
  refunded_credits  integer not null default 0 check (refunded_credits  >= 0),
  -- What was bought. Never a price or a balance supplied by a caller.
  task_id           uuid,
  company_key       text,
  reason            text,
  created_at        timestamptz not null default now(),
  finalized_at      timestamptz,
  constraint credit_transactions_idempotent unique (workspace_id, idempotency_key)
);

create index if not exists credit_transactions_workspace_created_idx
  on public.credit_transactions (workspace_id, created_at desc);
-- Drives the stale-reservation reaper.
create index if not exists credit_transactions_reserved_idx
  on public.credit_transactions (status, created_at)
  where status = 'reserved';

-- ── RLS: READ YOUR OWN, WRITE NOTHING ───────────────────────────────────────
-- There is deliberately NO insert/update/delete policy. A browser can render a
-- balance and a history; it has no statement that changes either.
alter table public.workspace_credit_balances enable row level security;
alter table public.credit_transactions       enable row level security;

drop policy if exists credit_balances_member_select on public.workspace_credit_balances;
create policy credit_balances_member_select
  on public.workspace_credit_balances for select
  using (exists (select 1 from public.workspace_members m
                  where m.workspace_id = workspace_credit_balances.workspace_id
                    and m.user_id = auth.uid()));

drop policy if exists credit_transactions_member_select on public.credit_transactions;
create policy credit_transactions_member_select
  on public.credit_transactions for select
  using (exists (select 1 from public.workspace_members m
                  where m.workspace_id = credit_transactions.workspace_id
                    and m.user_id = auth.uid()));

-- ── RESERVE ─────────────────────────────────────────────────────────────────
create or replace function public.credits_reserve(
  p_workspace       uuid,
  p_amount          integer,
  p_idempotency_key text,
  p_kind            text,
  p_task_id         uuid default null,
  p_company_key     text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.credit_transactions%rowtype;
  v_balance  integer;
  v_txn_id   uuid;
begin
  if p_amount is null or p_amount < 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'missing_idempotency_key');
  end if;

  -- ── IDEMPOTENCY BEFORE MONEY ──────────────────────────────────────────────
  select * into v_existing from public.credit_transactions
   where workspace_id = p_workspace and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'ok', true, 'replayed', true,
      'transaction_id', v_existing.id, 'status', v_existing.status,
      'reserved_credits', v_existing.reserved_credits);
  end if;

  -- ── THE CONDITIONAL UPDATE IS THE CONCURRENCY CONTROL ─────────────────────
  -- Two callers racing a balance that fits one of them: Postgres serialises the
  -- row, the second re-evaluates `balance_credits >= p_amount` against the
  -- ALREADY-DECREMENTED value, matches nothing, and is refused. There is no
  -- window in which both observe the same balance.
  if p_amount > 0 then
    update public.workspace_credit_balances
       set balance_credits  = balance_credits  - p_amount,
           reserved_credits = reserved_credits + p_amount,
           updated_at = now()
     where workspace_id = p_workspace
       and balance_credits >= p_amount
    returning balance_credits into v_balance;

    if not found then
      -- Absent row and insufficient row are the same answer: no funds. A
      -- balance is never created here — only an explicit grant does that.
      select balance_credits into v_balance
        from public.workspace_credit_balances where workspace_id = p_workspace;
      return jsonb_build_object('ok', false, 'error', 'insufficient_credits',
        'balance', coalesce(v_balance, 0), 'needed', p_amount);
    end if;
  else
    select balance_credits into v_balance
      from public.workspace_credit_balances where workspace_id = p_workspace;
  end if;

  begin
    insert into public.credit_transactions(
      workspace_id, idempotency_key, kind, status,
      estimated_credits, reserved_credits, task_id, company_key)
    values (p_workspace, p_idempotency_key, p_kind, 'reserved',
      p_amount, p_amount, p_task_id, p_company_key)
    returning id into v_txn_id;
  exception when unique_violation then
    -- TWO IDENTICAL KEYS RACED PAST THE SELECT. The unique index is the real
    -- guarantee; give the money back and return the winner.
    if p_amount > 0 then
      update public.workspace_credit_balances
         set balance_credits  = balance_credits  + p_amount,
             reserved_credits = reserved_credits - p_amount,
             updated_at = now()
       where workspace_id = p_workspace;
    end if;
    select * into v_existing from public.credit_transactions
     where workspace_id = p_workspace and idempotency_key = p_idempotency_key;
    return jsonb_build_object('ok', true, 'replayed', true,
      'transaction_id', v_existing.id, 'status', v_existing.status,
      'reserved_credits', v_existing.reserved_credits);
  end;

  return jsonb_build_object('ok', true, 'replayed', false,
    'transaction_id', v_txn_id, 'balance_after', coalesce(v_balance, 0));
end;
$$;

-- ── FINALIZE / RELEASE ──────────────────────────────────────────────────────
-- One function for both. Releasing is finalizing with `p_actual = 0`, so there
-- is no second path that could refund on different terms.
create or replace function public.credits_finalize(
  p_transaction_id uuid,
  p_actual         integer,
  p_status         text,
  p_reason         text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_txn    public.credit_transactions%rowtype;
  v_refund integer;
begin
  -- LOCKED, so two finalizes of one transaction serialise rather than both
  -- reading `reserved` and both refunding.
  select * into v_txn from public.credit_transactions
   where id = p_transaction_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unknown_transaction');
  end if;

  -- ── REPLAY IS A NO-OP, NOT A SECOND REFUND ────────────────────────────────
  if v_txn.status <> 'reserved' then
    return jsonb_build_object('ok', true, 'replayed', true,
      'status', v_txn.status, 'actual_credits', v_txn.actual_credits,
      'refunded_credits', v_txn.refunded_credits);
  end if;

  if p_actual is null or p_actual < 0 or p_actual > v_txn.reserved_credits then
    -- NEVER CHARGE MORE THAN WAS RESERVED. A caller that computed a larger
    -- figure is wrong, and the user is not billed for the disagreement.
    return jsonb_build_object('ok', false, 'error', 'actual_exceeds_reserved',
      'reserved', v_txn.reserved_credits, 'requested', p_actual);
  end if;

  v_refund := v_txn.reserved_credits - p_actual;

  update public.workspace_credit_balances
     set reserved_credits = reserved_credits - v_txn.reserved_credits,
         balance_credits  = balance_credits  + v_refund,
         updated_at = now()
   where workspace_id = v_txn.workspace_id;

  update public.credit_transactions
     set status = p_status, actual_credits = p_actual,
         refunded_credits = v_refund,
         reason = coalesce(p_reason, reason),
         finalized_at = now()
   where id = p_transaction_id;

  return jsonb_build_object('ok', true, 'replayed', false,
    'status', p_status, 'actual_credits', p_actual,
    'refunded_credits', v_refund);
end;
$$;

-- ── THE REAPER ──────────────────────────────────────────────────────────────
-- A run that dies between reserve and finalize leaves the user short with
-- nothing delivered. Without this the balance drains silently on every crash,
-- and the missing credits are invisible because they are "reserved" rather
-- than gone. Released, never charged: an unfinished unlock is not a sale.
create or replace function public.credits_release_stale(
  p_older_than interval default '30 minutes'
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_txn public.credit_transactions%rowtype;
  v_n   integer := 0;
begin
  for v_txn in
    select * from public.credit_transactions
     where status = 'reserved' and created_at < now() - p_older_than
     for update skip locked
  loop
    perform public.credits_finalize(
      v_txn.id, 0, 'released', 'stale reservation released by reaper');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ── GRANT ───────────────────────────────────────────────────────────────────
-- The ONLY way a balance row comes into existence or grows. Idempotent on the
-- same key so a retried monthly grant does not double-credit.
create or replace function public.credits_grant(
  p_workspace       uuid,
  p_amount          integer,
  p_idempotency_key text,
  p_reason          text default null,
  p_plan_id         text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.credit_transactions%rowtype;
  v_balance  integer;
begin
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  select * into v_existing from public.credit_transactions
   where workspace_id = p_workspace and idempotency_key = p_idempotency_key;
  if found then
    select balance_credits into v_balance
      from public.workspace_credit_balances where workspace_id = p_workspace;
    return jsonb_build_object('ok', true, 'replayed', true,
      'transaction_id', v_existing.id, 'balance_after', coalesce(v_balance, 0));
  end if;

  insert into public.workspace_credit_balances (workspace_id, balance_credits, plan_id)
  values (p_workspace, p_amount, coalesce(p_plan_id, 'free_trial'))
  on conflict (workspace_id) do update
    set balance_credits = public.workspace_credit_balances.balance_credits + p_amount,
        plan_id = coalesce(p_plan_id, public.workspace_credit_balances.plan_id),
        updated_at = now()
  returning balance_credits into v_balance;

  insert into public.credit_transactions(
    workspace_id, idempotency_key, kind, status,
    actual_credits, reason, finalized_at)
  values (p_workspace, p_idempotency_key, 'grant', 'granted',
    p_amount, p_reason, now());

  return jsonb_build_object('ok', true, 'replayed', false,
    'balance_after', coalesce(v_balance, 0));
end;
$$;

-- ── WHO MAY CALL THESE ──────────────────────────────────────────────────────
-- SECURITY DEFINER bypasses RLS, so EXECUTE is the whole access control. It
-- belongs to the service role alone: an authenticated browser must have no
-- statement, anywhere, that moves a balance.
revoke all on function public.credits_reserve(uuid, integer, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.credits_finalize(uuid, integer, text, text)            from public, anon, authenticated;
revoke all on function public.credits_release_stale(interval)                        from public, anon, authenticated;
revoke all on function public.credits_grant(uuid, integer, text, text, text)         from public, anon, authenticated;

grant execute on function public.credits_reserve(uuid, integer, text, text, uuid, text) to service_role;
grant execute on function public.credits_finalize(uuid, integer, text, text)            to service_role;
grant execute on function public.credits_release_stale(interval)                        to service_role;
grant execute on function public.credits_grant(uuid, integer, text, text, text)         to service_role;
