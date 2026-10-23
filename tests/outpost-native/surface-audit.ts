// deno-lint-ignore no-import-prefix
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
// Evidence-only audit. Exits nonzero if a supported route exposes protected tasks.
// No hosted URL accepted by the harness; all mutations affect disposable fixtures.
import { closeHarness, sql } from "../db-contract/lib/harness.ts";
import { api, fixture, jwt } from "./fixture.ts";
const resources = [
  "tasks",
  "company_brain",
  "workspace_members",
  "accounts",
  "contacts",
  "saved_outputs",
  "outreach_drafts",
  "tool_calls",
  "messages",
  "conversations",
  "lead_candidates",
  "lead_evidence",
  "lead_lineages",
  "task_plans",
  "signals",
  "approvals",
  "agents",
];
try {
  const relations = await sql`select c.relname as name, c.relrowsecurity as rls,
    c.relforcerowsecurity as forced,
    array(select a.attname from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped order by a.attnum) as columns,
    array(select pg_get_constraintdef(k.oid) from pg_constraint k where k.conrelid=c.oid and k.contype in ('f','p','u') order by k.conname) as ownership_constraints
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ${
    sql(resources)
  } order by c.relname`;
  const policies =
    await sql`select tablename, policyname, permissive, roles, cmd, qual, with_check
    from pg_policies where schemaname='public' and tablename in ${
      sql(resources)
    } order by tablename,policyname`;
  const grants =
    await sql`select grantee,table_name,privilege_type from information_schema.role_table_grants
    where table_schema='public' and table_name in ${
      sql(resources)
    } and grantee in ('anon','authenticated','service_role')
    order by table_name,grantee,privilege_type`;
  const functions =
    await sql`select n.nspname as schema,p.proname as name,p.prosecdef as definer,
    has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') as user_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','outpost_private') and p.prokind='f'
    and p.prosrc ~* ${resources.join("|")}
    order by n.nspname,p.proname`;
  const views =
    await sql`select distinct v.relname as name, v.reloptions as options, t.relname as parent
    from pg_class v join pg_namespace n on n.oid=v.relnamespace
    join pg_rewrite r on r.ev_class=v.oid join pg_depend d on d.objid=r.oid
    join pg_class t on t.oid=d.refobjid
    where n.nspname='public' and v.relkind='v' and t.relname in ${
      sql(resources)
    } and v.oid<>t.oid
    order by v.relname,t.relname`;
  const x = await fixture(),
    viewer = await jwt(x.viewer, x.sv),
    owner = await jwt(x.ua, x.sa);
  const path = `tasks?id=eq.${x.ta}&select=id,payload`;
  const probes: Record<string, unknown>[] = [];
  for (
    const [role, token] of [["owner", owner.token], ["viewer", viewer.token], [
      "anon",
      null,
    ]] as const
  ) {
    const r = await api(token, path, "GET", undefined, "public");
    probes.push({
      role,
      route: "public.tasks SELECT",
      status: r.status,
      visible_rows: Array.isArray(r.body) ? r.body.length : null,
    });
  }
  const positive = probes.find((p) => p.role === "owner");
  assertEquals(positive?.status, 200);
  assertEquals(positive?.visible_rows, 1, "owner positive control must work");
  const update = await api(viewer.token, `tasks?id=eq.${x.ta}`, "PATCH", {
    payload: { unauthorized_viewer_mutation: true },
  }, "public");
  const changed =
    (await sql`select payload->>'unauthorized_viewer_mutation' as changed from public.tasks where id=${x.ta}`)[
      0
    ].changed === "true";
  probes.push({
    role: "viewer",
    route: "public.tasks PATCH",
    status: update.status,
    changed,
  });
  // Native cross-workspace escalation check: the caller was never invited to B.
  const foreignBefore = await api(
    viewer.token,
    `tasks?id=eq.${x.tb}&select=id`,
    "GET",
    undefined,
    "public",
  );
  const enroll = await api(viewer.token, "workspace_members", "POST", {
    workspace_id: x.b,
    user_id: x.viewer,
    role: "owner",
  }, "public");
  const foreignAfter = await api(
    viewer.token,
    `tasks?id=eq.${x.tb}&select=id`,
    "GET",
    undefined,
    "public",
  );
  probes.push({
    role: "viewer",
    route: "workspace_members self-insert foreign owner",
    status: enroll.status,
    foreign_rows_before: Array.isArray(foreignBefore.body)
      ? foreignBefore.body.length
      : null,
    foreign_rows_after: Array.isArray(foreignAfter.body)
      ? foreignAfter.body.length
      : null,
  });
  const brainWrite = await api(
    viewer.token,
    `company_brain?workspace_id=eq.${x.a}`,
    "PATCH",
    {
      profile: { company: { name: "Unauthorized synthetic viewer context" } },
    },
    "public",
  );
  const brainChanged =
    (await sql`select profile->'company'->>'name' as name from public.company_brain where workspace_id=${x.a}`)[
      0
    ].name === "Unauthorized synthetic viewer context";
  probes.push({
    role: "viewer",
    route: "public.company_brain PATCH",
    status: brainWrite.status,
    changed: brainChanged,
  });
  const leak = probes.some((p) =>
    p.role === "viewer" &&
    (p.visible_rows === 1 || p.changed === true || p.foreign_rows_after === 1)
  );
  console.log(
    JSON.stringify(
      {
        version: "outpost_phase1_surface_audit_v1",
        scope: "disposable_native_only",
        verdict: leak ? "FAIL" : "PASS",
        customer_pilot_ready: false,
        relations,
        policies,
        grants,
        functions,
        views,
        probes,
      },
      null,
      2,
    ),
  );
  if (leak) Deno.exitCode = 1;
} finally {
  await closeHarness();
}
