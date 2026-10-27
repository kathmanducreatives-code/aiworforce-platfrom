"""Wrap a reviewed kickoff.sql so the SQL Editor proves where and whether it committed.

  python3 -I wrap_kickoff.py <kickoff.sql> <out.sql>

The reviewed statements (plan row, queue row, authorize_discovery_smoke) are copied
byte for byte; the wrapper only adds checks around them, inside the same transaction:
  * BEFORE any write: this database must be the agency TEST project (the TEST
    workspace exists under its name, the test-only no-Company-Brain guard and the
    three security triggers exist), the session must be an administrator
    (authorize_discovery_smoke is not executable by app roles), and the queue id must
    be unused. Otherwise it raises and nothing is written.
  * AFTER the writes, before COMMIT: the queue row is `queued` in the TEST workspace
    and its authorization is active with zero starts for both actors and a <= 300 s
    window. Otherwise it raises and the whole transaction rolls back.
  * The compile's ledger row(s), when the kickoff records a real compile, must exist.
  * After COMMIT, a final SELECT (the only result the Supabase SQL Editor shows):
    one row, KICKOFF_COMMITTED, with the queue id, statuses and seconds left.
"""
import hashlib, re, sys

src, out = sys.argv[1], sys.argv[2]
s = open(src).read()
body = s.split("begin;\n", 1)[1].rsplit("commit;", 1)[0]
queue = re.search(r"authorize_discovery_smoke\('([0-9a-f-]{36})'", body).group(1)
ws = re.search(r"insert into public\.lead_mission_queue \(id, workspace_id, request, status\)\s+values \('[0-9a-f-]{36}', '([0-9a-f-]{36})'", body).group(1)
src_hash = hashlib.sha256(s.encode()).hexdigest()
compile_rows = body.count("insert into public.lead_execution_calls")
compile_check = (f"""
  if (select count(*) from public.lead_execution_calls where workspace_id = '{ws}' and record_kind = 'model_call'
        and logical_call_key like 'kickoff:{queue}:%') <> {compile_rows} then
    raise exception 'KICKOFF NOT VERIFIED: the compile ledger row is missing; rolled back, nothing written';
  end if;""" if compile_rows else "")

pre = f"""-- SELF-VERIFYING KICKOFF (wraps reviewed kickoff.sql sha256 {src_hash}).
-- Run the WHOLE file once in the SQL Editor of project tlvnfrxzjhsjgdofwehb, role postgres.
-- Expected result: ONE row, result = KICKOFF_COMMITTED, queue_id = {queue}.
-- Any error: nothing was written. Do not edit; do not run twice.
begin;
do $guard$
begin
  if not has_function_privilege(current_user, 'public.authorize_discovery_smoke(uuid,text,jsonb,jsonb,integer)', 'execute') then
    raise exception 'KICKOFF REFUSED: role % cannot authorize (choose role postgres in the SQL Editor); nothing written', current_user;
  end if;
  if not exists (select 1 from public.workspaces where id = '{ws}' and name = 'discovery-test') then
    raise exception 'KICKOFF REFUSED: not the agency TEST project (workspace {ws} "discovery-test" absent); nothing written';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'discovery_test_no_company_brain' and not tgisinternal) then
    raise exception 'KICKOFF REFUSED: the TEST-only no-Brain guard is absent (wrong project); nothing written';
  end if;
  if (select count(*) from pg_trigger where not tgisinternal and tgenabled <> 'D' and tgname in
      ('tasks_commit_boundary','task_plans_parent_identity','workspace_members_app_surface','workspace_members_app_surface_truncate')) <> 4 then
    raise exception 'KICKOFF REFUSED: TEST security triggers are not all installed; nothing written';
  end if;
  if exists (select 1 from public.lead_mission_queue where id = '{queue}') then
    raise exception 'KICKOFF REFUSED: queue {queue} already exists (this kickoff already ran); nothing written';
  end if;
  if exists (select 1 from public.lead_mission_queue where status in ('queued','running','resumable')) then
    raise exception 'KICKOFF REFUSED: another mission is claimable; nothing written';
  end if;
end
$guard$;
"""
post = f"""do $verify$
begin
  if not exists (
    select 1 from public.lead_mission_queue q
      join public.discovery_smoke_authorizations a on a.queue_id = q.id
     where q.id = '{queue}' and q.workspace_id = '{ws}' and q.status = 'queued'
       and a.status = 'active' and a.deadline_at <= now() + interval '300 seconds'
       and a.actor_limits = '{{"apify:harvestapi~linkedin-job-search":0,"apify:harvestapi~linkedin-company":0}}'::jsonb) then
    raise exception 'KICKOFF NOT VERIFIED: queue/authorization not as reviewed; rolled back, nothing written';
  end if;{compile_check}
end
$verify$;
commit;
select 'KICKOFF_COMMITTED' as result, q.id as queue_id, q.status as queue_status,
       a.id as authorization_id, a.status as authorization_status, a.actor_limits,
       a.deadline_at, greatest(0, extract(epoch from a.deadline_at - now()))::int as seconds_left,
       (select count(*) from public.lead_execution_calls e where e.workspace_id = q.workspace_id
          and e.logical_call_key like 'kickoff:' || q.id::text || ':%') as compile_ledger_rows
  from public.lead_mission_queue q join public.discovery_smoke_authorizations a on a.queue_id = q.id
 where q.id = '{queue}';
"""
open(out, "w").write(pre + body + post)
print("queue", queue, "workspace", ws, "source sha256", src_hash)
print("wrapped sha256", hashlib.sha256((pre + body + post).encode()).hexdigest())
