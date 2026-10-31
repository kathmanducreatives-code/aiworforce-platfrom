import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sql, uuid, seedWorkspace, serviceClient } from "../db-contract/lib/harness.ts";
Deno.test({name:"PLAN-PARENT race: deleting and recreating a plan cannot race an authorized task INSERT",sanitizeOps:false,sanitizeResources:false,fn:async()=>{
 const a=await seedWorkspace(), b=await seedWorkspace(), user=uuid(), plan=uuid();
 await sql`insert into auth.users(id,email) values(${user},${user+'@synthetic.example'})`;
 await sql`insert into public.workspace_members(workspace_id,user_id,role) values(${a},${user},'owner')`;
 await sql`insert into public.task_plans(id,workspace_id,user_id,user_instruction,status) values(${plan},${a},${user},'synthetic','running')`;
 let locked!:()=>void, release!:()=>void;
 const ready=new Promise<void>(r=>locked=r), barrier=new Promise<void>(r=>release=r);
 const tx=sql.begin(async t=>{await t`select 1 from public.workspace_members where workspace_id=${a} and user_id=${user} for update`;locked();await barrier;});
 await ready;
 const svc=await serviceClient();
 let settled=false;
 const insert=svc.from('tasks').insert({workspace_id:a,user_id:user,plan_id:plan,agent_slug:'scribe',status:'running',payload:{}}).select('id').then(r=>{settled=true;return r});
 try {
  let waiting=false;
  for(let i=0;i<100;i++){const rows=await sql`select 1 from pg_stat_activity where wait_event_type='Lock' and query like '%tasks%' and pid <> pg_backend_pid()`;if(rows.length){waiting=true;break;}await new Promise(r=>setTimeout(r,20));}
  assert(waiting && !settled,'task insert reached native membership lock after validating the old parent');
  let deletionSettled=false;
  const deletion=svc.from('task_plans').delete().eq('id',plan).then(r=>{deletionSettled=true;return r});
  let deletingWaits=false;
  for(let i=0;i<100;i++){const rows=await sql`select 1 from pg_stat_activity where wait_event_type='Lock' and query like '%task_plans%' and pid <> pg_backend_pid()`;if(rows.length){deletingWaits=true;break;}await new Promise(r=>setTimeout(r,20));}
  assert(deletingWaits && !deletionSettled,'parent deletion serializes behind the task parent key-share lock');
  release();await tx;
  assertEquals((await insert).error,null,'authorized task commits first');
  assertEquals((await deletion).error,null,'parent deletion can finish after authorized insertion');
  const recreated=await svc.from('task_plans').insert({id:plan,workspace_id:b,user_id:user,user_instruction:'synthetic replacement',status:'running'});
  assertEquals(recreated.error?.code,'23503','cross-workspace recreation sees the committed task and is refused');
  console.log(JSON.stringify({scenario:'concurrent_parent_recreation',delete_waited:deletingWaits,recreate_error:recreated.error?.code}));
 } finally {release();await tx;}
 const result=await insert;
 const [r]=await sql`select count(*)::int n from public.tasks t join public.task_plans p on t.plan_id=p.id where t.workspace_id=${a} and t.workspace_id<>p.workspace_id`;
 console.log(JSON.stringify({task_error:result.error?.code??null,mismatched:r.n}));
 assertEquals(r.n,0,'committed task and plan must remain in the same workspace under concurrency');
}});
