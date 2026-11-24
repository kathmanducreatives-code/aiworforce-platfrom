-- Role probe against the clone: one line per check. Every attempted change is
-- rolled back (RAISE at the end of the DO block; writes also carry WHERE false
-- or are inside sub-transactions).
do $p$
declare r text := ''; n bigint;
  procedure_dummy int;
begin
  -- anon
  begin set local role anon; select count(*) into n from public.lead_model_calls; r := r||'anon_read_view='||n||' '; exception when insufficient_privilege then r := r||'anon_read_view=denied '; end; reset role;
  begin set local role anon; delete from public.lead_model_calls where true; get diagnostics n = row_count; r := r||'anon_delete_view='||n||' '; exception when insufficient_privilege then r := r||'anon_delete_view=denied '; end; reset role;
  -- authenticated member of A
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a001","role":"authenticated"}', true);
  begin set local role authenticated; select count(*) into n from public.lead_model_calls; r := r||'member_read_view='||n||' '; exception when insufficient_privilege then r := r||'member_read_view=denied '; end; reset role;
  begin set local role authenticated; insert into public.signal_events (workspace_id, signal_type, signal_category, verification_status, dedupe_key, lifecycle_status, origin, occurred_at_basis) values ('00000000-0000-4000-8000-0000000000a1','x','g','u','k9','active','m','s'); r := r||'member_insert_signal=ALLOWED '; exception when insufficient_privilege then r := r||'member_insert_signal=denied '; when others then r := r||'member_insert_signal=ERR'||sqlstate||' '; end; reset role;
  begin set local role authenticated; update public.approvals set status='approved' where true; get diagnostics n = row_count; r := r||'member_update_approvals='||n||' '; exception when insufficient_privilege then r := r||'member_update_approvals=denied '; end; reset role;
  begin set local role authenticated; select count(*) into n from public.signal_events; r := r||'member_read_signals='||n||' '; exception when insufficient_privilege then r := r||'member_read_signals=denied '; end; reset role;
  begin set local role authenticated; select count(*) into n from public.approvals; r := r||'member_read_approvals='||n||' '; exception when insufficient_privilege then r := r||'member_read_approvals=denied '; end; reset role;
  begin set local role authenticated; select count(*) into n from public.lead_execution_calls; r := r||'member_read_ledger='||n||' '; exception when insufficient_privilege then r := r||'member_read_ledger=denied '; end; reset role;
  -- service role (backend)
  begin set local role service_role; select count(*) into n from public.lead_model_calls; r := r||'service_read_view='||n||' ';
    insert into public.signal_events (workspace_id, signal_type, signal_category, verification_status, dedupe_key, lifecycle_status, origin, occurred_at_basis) values ('00000000-0000-4000-8000-0000000000a1','x','g','u','k8','active','m','s');
    update public.approvals set status = status where true; r := r||'service_writes=ok ';
  exception when others then r := r||'service=ERR'||sqlstate||' '; end; reset role;
  raise exception 'PROBE %', r;
end $p$;
