-- Rollback of 20261029120000_smoke_read_cap_seven.sql: the read cap back to 5.
-- Refuses (the constraint fails) while any authorization holds more than 5 reads;
-- stop and reconcile those missions first.
begin;
alter table public.discovery_smoke_authorizations alter column provider_polls set default 5;
alter table public.discovery_smoke_authorizations
  drop constraint discovery_smoke_authorizations_provider_polls_check;
alter table public.discovery_smoke_authorizations
  add constraint discovery_smoke_authorizations_provider_polls_check check (provider_polls between 0 and 5);

create or replace function public.authorize_discovery_smoke(
  p_queue uuid, p_pricing_version text, p_approved_quotes jsonb, p_actor_limits jsonb,
  p_window_seconds integer default 300
) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  q public.lead_mission_queue%rowtype;
  a public.discovery_smoke_authorizations%rowtype;
  v_now timestamptz := clock_timestamp();
  v_hash text; v_t jsonb; v_id text; v_obs timestamptz; v_k text; v_open bigint;
begin
  select * into q from public.lead_mission_queue where id = p_queue for update;
  if not found then raise exception 'authorize_discovery_smoke: no such queue row'; end if;
  v_hash := encode(sha256(convert_to(q.request::text, 'UTF8')), 'hex');

  select * into a from public.discovery_smoke_authorizations where queue_id = p_queue;
  if found then
    if a.criteria_hash is distinct from v_hash or a.pricing_version is distinct from p_pricing_version
       or a.approved_quotes is distinct from p_approved_quotes or a.actor_limits is distinct from p_actor_limits
       or a.deadline_at is distinct from q.created_at + make_interval(secs => p_window_seconds) then
      raise exception 'authorize_discovery_smoke: an authorization exists and cannot be replaced';
    end if;
    return a.id;
  end if;

  -- NO NEW SMOKE OVER UNRECONCILED LIABILITY. Any earlier provider purchase
  -- without a reconciliation may still be billed up to its maximum; another
  -- mission would spend on top of an unknown. One reconciled above its
  -- maximum is held open (the bound was wrong). Serialized with every paid
  -- admission and reconciliation by one transaction-scoped lock.
  perform pg_advisory_xact_lock(hashtext('agentory.discovery_smoke.liability'));
  select count(*) into v_open from public.discovery_smoke_operations o
   where o.kind = 'provider'
     and not exists (select 1 from public.discovery_smoke_reconciliations r
                      where r.authorization_id = o.authorization_id and r.operation_key = o.operation_key
                        and r.vendor_microusd <= o.committed_microusd);
  if v_open > 0 then
    raise exception 'authorize_discovery_smoke: % earlier provider purchase(s) are unreconciled; reconcile them first', v_open;
  end if;

  if q.status not in ('queued', 'running', 'resumable') then
    raise exception 'authorize_discovery_smoke: queue row is %', q.status;
  end if;
  if p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 300 then
    raise exception 'authorize_discovery_smoke: window must be 1-300 seconds';
  end if;
  if q.created_at + make_interval(secs => p_window_seconds) <= v_now then
    raise exception 'authorize_discovery_smoke: the queue row''s window has already passed';
  end if;
  if p_pricing_version is null or length(trim(p_pricing_version)) = 0 then
    raise exception 'authorize_discovery_smoke: pricing version required';
  end if;
  if p_actor_limits is null or jsonb_typeof(p_actor_limits) <> 'object' then
    raise exception 'authorize_discovery_smoke: actor limits must be an object';
  end if;
  for v_k in select jsonb_object_keys(p_actor_limits) loop
    if jsonb_typeof(p_actor_limits -> v_k) <> 'number' or (p_actor_limits ->> v_k) !~ '^[0-9]+$' then
      raise exception 'authorize_discovery_smoke: actor limit % must be a non-negative integer', v_k;
    end if;
  end loop;
  -- Every template is a reviewed MAXIMUM with its evidence. Unknown or
  -- unbounded prices have no template, and an operation without one is refused.
  if p_approved_quotes is null or jsonb_typeof(p_approved_quotes) <> 'object' or p_approved_quotes = '{}'::jsonb then
    raise exception 'authorize_discovery_smoke: approved quotes required';
  end if;
  for v_id, v_t in select key, value from jsonb_each(p_approved_quotes) loop
    -- NULL-SAFE (final offline hardening): every type check is `is distinct
    -- from`, so a missing key is malformed, never a NULL that slips through the
    -- OR chain.
    if jsonb_typeof(v_t) is distinct from 'object'
       or jsonb_typeof(v_t -> 'allowed_kinds') is distinct from 'array' or jsonb_array_length(v_t -> 'allowed_kinds') = 0
       or exists (select 1 from jsonb_array_elements(v_t -> 'allowed_kinds') k
                   where jsonb_typeof(k) <> 'string' or k #>> '{}' not in ('provider', 'model', 'poll'))
       or jsonb_typeof(v_t -> 'allowed_actors') is distinct from 'array' or jsonb_array_length(v_t -> 'allowed_actors') = 0
       or exists (select 1 from jsonb_array_elements(v_t -> 'allowed_actors') x
                   where jsonb_typeof(x) <> 'string' or length(trim(x #>> '{}')) = 0)
       or jsonb_typeof(v_t -> 'maximum_microusd') is distinct from 'number' or (v_t ->> 'maximum_microusd') !~ '^[0-9]+$'
       or (v_t ->> 'maximum_microusd')::numeric > 250000
       or coalesce(length(trim(v_t ->> 'source')), 0) = 0
       or coalesce(length(trim(v_t ->> 'liability_bound_ref')), 0) = 0
       or jsonb_typeof(v_t -> 'request_limits') is distinct from 'object'
       or ((v_t -> 'request_limits') ? 'max_reads_per_actor'
           and (jsonb_typeof(v_t -> 'request_limits' -> 'max_reads_per_actor') is distinct from 'object'
                or exists (select 1 from jsonb_each(v_t -> 'request_limits' -> 'max_reads_per_actor') r
                            where jsonb_typeof(r.value) <> 'number' or r.value::text !~ '^[0-9]+$')))
       or (v_t ? 'discovery_page' and jsonb_typeof(v_t -> 'discovery_page') is distinct from 'boolean') then
      raise exception 'authorize_discovery_smoke: template % is malformed', v_id;
    end if;
    -- READS ARE FREE. A poll is never a purchase, so it is never reconciled;
    -- a priced read would be spending outside the liability checks.
    if (v_t -> 'allowed_kinds') ? 'poll' and (v_t ->> 'maximum_microusd')::bigint <> 0 then
      raise exception 'authorize_discovery_smoke: template % prices a read; reads must be free', v_id;
    end if;
    -- A READ ALLOCATION IS COMPLETE AND FITS THE SHARED CAP: one share for
    -- every actor the reads template allows and for no other, on a reads-only
    -- template, summing to at most the five polls.
    if (v_t -> 'request_limits') ? 'max_reads_per_actor' and (
         v_t -> 'allowed_kinds' <> '["poll"]'::jsonb
         or (select array_agg(k order by k) from jsonb_object_keys(v_t -> 'request_limits' -> 'max_reads_per_actor') k)
            is distinct from (select array_agg(distinct x order by x) from jsonb_array_elements_text(v_t -> 'allowed_actors') x)
         or (select sum(r.value::text::bigint) from jsonb_each(v_t -> 'request_limits' -> 'max_reads_per_actor') r) > 5) then
      raise exception 'authorize_discovery_smoke: template % read allocation must cover exactly its actors and sum to at most 5', v_id;
    end if;
    begin v_obs := (v_t ->> 'observed_at')::timestamptz;
    exception when others then raise exception 'authorize_discovery_smoke: template % observed_at is not a time', v_id; end;
    if v_obs is null or not isfinite(v_obs) or v_obs > v_now or v_obs < v_now - interval '24 hours' then
      raise exception 'authorize_discovery_smoke: template % price observation is stale or in the future', v_id;
    end if;
  end loop;
  -- ONE TEMPLATE PER (kind, actor), as the transport gate requires: a worker
  -- naming a second template cannot escape the first one's price or limits.
  if exists (select 1 from jsonb_each(p_approved_quotes) t,
                    jsonb_array_elements_text(t.value -> 'allowed_kinds') k,
                    jsonb_array_elements_text(t.value -> 'allowed_actors') x
              group by k, x having count(distinct t.key) > 1) then
    raise exception 'authorize_discovery_smoke: two templates cover the same kind and actor';
  end if;

  insert into public.discovery_smoke_authorizations
    (queue_id, workspace_id, criteria_hash, pricing_version, approved_quotes, actor_limits, authorized_at, deadline_at)
  values (p_queue, q.workspace_id, v_hash, p_pricing_version, p_approved_quotes, p_actor_limits,
          v_now, q.created_at + make_interval(secs => p_window_seconds))
  returning * into a;
  return a.id;
end $$;
commit;
