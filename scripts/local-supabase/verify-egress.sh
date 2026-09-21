#!/usr/bin/env bash
# MEASURE THE EGRESS FIX (f2d68270) AGAINST A REAL POSTGREST — LOCALLY.
#
# The incident was 27.39 GB of PostgREST egress on a 5 GB allowance, because
# three pollers selected `tasks.result` — the engine's resume state — to read a
# few short strings. This script creates a task row of a realistic size in the
# LOCAL database, asks PostgREST for it both ways, and prints the bytes on the
# wire. It writes only its own fixture row and deletes it afterwards.
#
#   bash scripts/local-supabase/verify-egress.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

json=$(supabase status -o json)
API=$(printf '%s' "$json" | python3 -c "import json,sys;print(json.load(sys.stdin).get('API_URL','http://127.0.0.1:54321'))")
KEY=$(printf '%s' "$json" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('SECRET_KEY') or d.get('SERVICE_ROLE_KEY'))")
case "$API" in http://127.0.0.1:*|http://localhost:*) ;; *) echo "refusing: $API is not local" >&2; exit 1;; esac

DB="${LOCAL_SUPABASE_DB_CONTAINER:-supabase_db_ohsdatpvfdjdemstoiuj}"
psql() { docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "$1"; }
WS='00000000-0000-4000-a000-000000000001'
USER_ID='00000000-0000-4000-b000-000000000001'
PLAN='00000000-0000-4000-c000-0000000000ee'
TASK='00000000-0000-4000-d000-0000000000ee'

bytes() { curl -s -H "apikey: $KEY" -H "Authorization: Bearer $KEY" "$1" | wc -c | tr -d ' '; }
kb() { python3 -c "print(f'{int($1)/1024:,.1f} kB')"; }

echo "== fixture: one task whose result carries a realistic checkpoint (local only)"
psql "
insert into public.task_plans (id, workspace_id, user_id, user_instruction, plan_summary, status)
values ('$PLAN','$WS','$USER_ID','egress fixture','egress fixture','complete')
on conflict (id) do nothing;
insert into public.tasks (id, plan_id, workspace_id, user_id, agent_slug, step_index, description, status, result)
values ('$TASK','$PLAN','$WS','$USER_ID','scout',0,'egress fixture','ready',
  jsonb_build_object(
    'terminal_status','continuation_required',
    'task_status','running',
    'company_first', jsonb_build_object('status','partial'),
    'company_first_state', jsonb_build_object('terminal_status','continuation_required'),
    'auto_continuation', jsonb_build_object('continuing', true),
    -- the engine's resume state: what every poller used to carry
    'lead_resume_checkpoint', jsonb_build_object('companies', (
       select jsonb_agg(jsonb_build_object('key','c'||i,'snapshot',jsonb_build_object(
         'company', jsonb_build_object('company_name','Company '||i,'canonical_domain','c'||i||'.test'),
         'notes', repeat('x', 900))))
       from generate_series(1,200) i)),
    'capability_execution_state', jsonb_build_object('pending_runs','[]'::jsonb,'provider_attempts','[]'::jsonb)
  ))
on conflict (id) do update set result = excluded.result, status='ready';
" > /dev/null
echo -n "   stored result size: "; kb "$(psql "select octet_length(result::text) from public.tasks where id='$TASK'")"

echo
echo "== 1. WORKER CANCELLED-MISSION SWEEP — the status check"
OLD=$(bytes "$API/rest/v1/tasks?id=eq.$TASK&select=status,result")
NEW=$(bytes "$API/rest/v1/tasks?id=eq.$TASK&select=status,r_terminal_status:result-%3Eterminal_status,r_task_status:result-%3Etask_status,r_cf_status:result-%3Ecompany_first-%3Estatus,r_cfs_terminal:result-%3Ecompany_first_state-%3Eterminal_status")
echo "   before (select status,result):      $(kb "$OLD")"
echo "   after  (projected keys):            $(kb "$NEW")"
python3 -c "print(f'   per-read reduction:                 {int($OLD)/max(int($NEW),1):,.0f}x')"
python3 -c "
old_day = (86400/5)  * int($OLD)      # every idle tick, one cancelled row
new_day = (86400/60) * int($NEW)      # once a minute
print(f'   one cancelled task over 24h:        {old_day/2**30:,.2f} GB  ->  {new_day/2**30:,.5f} GB')"

echo
echo "== 2. RESUME-STALLED-LEADS — the 3-minute scan (10 rows)"
OLD1=$(bytes "$API/rest/v1/tasks?id=eq.$TASK&select=id,workspace_id,user_id,plan_id,agent_slug,step_index,status,updated_at,created_at,continuation_claim_expires_at,result")
NEW1=$(bytes "$API/rest/v1/tasks?id=eq.$TASK&select=id,workspace_id,user_id,plan_id,agent_slug,step_index,status,updated_at,created_at,continuation_claim_expires_at,r_terminal_status:result-%3Eterminal_status,r_task_status:result-%3Etask_status,r_suppressed:result-%3Eauto_resume_suppressed")
echo "   before (row + result):              $(kb "$OLD1") per row"
echo "   after  (row + projected keys):      $(kb "$NEW1") per row"
python3 -c "
runs = 24*60/3
old_day = runs*10*int($OLD1)
new_skip = runs*10*int($NEW1)                       # every row skippable from the projection
new_some = runs*(10*int($NEW1) + 3*int($OLD1))      # three still candidates, read in full
print(f'   10 stalled tasks over 24h:          {old_day/2**30:,.3f} GB  ->  {new_skip/2**30:,.4f} GB (all skipped)')
print(f'                                       {old_day/2**30:,.3f} GB  ->  {new_some/2**30:,.4f} GB (3 read in full)')"

echo
echo "== 3. FRONTEND TASK LIST — one plan, one hour"
OLDF=$(bytes "$API/rest/v1/tasks?plan_id=eq.$PLAN&select=*")
NEWF=$(bytes "$API/rest/v1/tasks?plan_id=eq.$PLAN&select=id,plan_id,agent_id,agent_slug,workspace_id,user_id,step_index,description,status,input,output,payload,error_message,started_at,finished_at,completed_at,created_at,checkpoint_version,r_task_status:result-%3Etask_status,r_terminal_status:result-%3Eterminal_status,r_quota:result-%3Equota,r_company_first:result-%3Ecompany_first,r_workbench_progress:result-%3Eworkbench_progress,r_workbench_mission_view:result-%3Eworkbench_mission_view")
echo "   before (select=*, 4 loops):         $(kb "$OLDF") per read"
echo "   after  (projection, 1 loop):        $(kb "$NEWF") per read"
python3 -c "
reads = 3600/4
print(f'   one active plan for 1h (visible):   {4*reads*int($OLDF)/2**30:,.3f} GB  ->  {1*reads*int($NEWF)/2**30:,.3f} GB')
print(f'   the same hour with the tab hidden:  {4*reads*int($OLDF)/2**30:,.3f} GB  ->  0.000 GB (realtime only)')"

echo
echo "== cleanup"
psql "delete from public.tasks where id='$TASK'; delete from public.task_plans where id='$PLAN';" > /dev/null
echo "   fixture removed"
