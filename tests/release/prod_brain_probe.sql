do $p$
declare r text := ''; n bigint; o text; ts timestamptz; cur timestamptz;
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a001","role":"authenticated"}', true);
  begin set local role authenticated; update public.company_brain set what_we_do='browser edit' where true; get diagnostics n=row_count; r := r||'browser_update='||n||' '; exception when insufficient_privilege then r := r||'browser_update=denied '; end; reset role;
  begin set local role authenticated; select count(*) into n from public.company_brain; r := r||'owner_reads_own='||n||' '; exception when insufficient_privilege then r := r||'owner_reads_own=denied '; end; reset role;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b001","role":"authenticated"}', true);
  begin set local role authenticated; select count(*) into n from public.company_brain; r := r||'outsider_reads_A='||n||' '; exception when insufficient_privilege then r := r||'outsider_reads_A=denied '; end; reset role;
  if to_regprocedure('public.company_brain_authorized_write(uuid,uuid,uuid,text,text,jsonb,timestamptz,boolean)') is not null then
    select updated_at into cur from public.company_brain where workspace_id='00000000-0000-4000-8000-0000000000a1';
    set local role service_role;
    select outcome, updated_at into o, ts from public.company_brain_authorized_write('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-00000000a001','10000000-0000-4000-8000-00000000a001','edit','cas','{"company":{"name":"Fictional Co"},"positioning":{"one_liner":"x"}}'::jsonb, cur, false);
    r := r||'owner_cas='||o||' ';
    select outcome into o from public.company_brain_authorized_write('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-00000000a001','10000000-0000-4000-8000-00000000a001','edit','cas','{}'::jsonb, cur, false);
    r := r||'owner_stale_cas='||o||' ';
    select outcome into o from public.company_brain_authorized_write('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-00000000a004','10000000-0000-4000-8000-00000000a004','edit','cas','{}'::jsonb, ts, false);
    r := r||'viewer_cas='||o||' ';
    select outcome into o from public.company_brain_authorized_write('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-00000000b001','10000000-0000-4000-8000-00000000b001','edit','cas','{}'::jsonb, ts, false);
    r := r||'outsider_cas='||o||' ';
    reset role;
  else r := r||'authorized_write=absent '; end if;
  if to_regclass('public.company_brain_memory') is not null then
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b001","role":"authenticated"}', true);
    begin set local role authenticated; execute 'select count(*) from public.company_brain_memory where workspace_id=''00000000-0000-4000-8000-0000000000a1''' into n; r := r||'outsider_reads_A_memory='||n||' '; exception when insufficient_privilege then r := r||'outsider_reads_A_memory=denied '; end; reset role;
    begin set local role authenticated; execute 'insert into public.company_brain_memory (workspace_id) values (''00000000-0000-4000-8000-0000000000b1'')'; r := r||'browser_memory_insert=ALLOWED '; exception when insufficient_privilege then r := r||'browser_memory_insert=denied '; when others then r := r||'browser_memory_insert=ERR'||sqlstate||' '; end; reset role;
    select count(*) into n from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relname like 'company_brain_%' and c.relkind='r' and c.relrowsecurity;
    r := r||'memory_tables_with_rls='||n||' ';
  else r := r||'memory=absent '; end if;
  raise exception 'PROBE %', r;
end $p$;
