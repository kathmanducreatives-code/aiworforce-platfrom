import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sql } from "../db-contract/lib/harness.ts";
const names = [
  "workspace_member_remove",
  "workspace_member_set_role",
  "workspace_member_change_check",
  "workspace_member_role_rank",
  "tasks_commit_boundary",
  "task_plans_parent_identity",
  "workspace_members_app_surface",
];
async function definitions(t: typeof sql) {
  return await t`select p.proname,pg_get_function_identity_arguments(p.oid) args,pg_get_functiondef(p.oid) def,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(${names}) order by p.proname`;
}
Deno.test({
  name:
    "native rollback: 179/186/189/190 round-trip exact definitions/ACLs and preserve data/176 hooks",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const before = await definitions(sql);
    const membership =
      await sql`select row_to_json(m) value from public.workspace_members m order by m.id`;
    const grants =
      await sql`select row_to_json(g) value from public.client_access_grants g order by g.id`;
    const acl = await sql`select relacl::text a from pg_class where oid='public.workspace_members'::regclass`;
    await sql.begin(async (tx) => {
      for (const f of ['20261025160000_workspace_members_app_surface', '20261025150000_task_plans_parent_identity']) {
        await tx.unsafe(await Deno.readTextFile(`supabase/migrations-held/rollback/${f}.down.sql`));
      }
      await tx.unsafe(
        await Deno.readTextFile(
          "supabase/migrations-held/rollback/20261025140000_workspace_member_writers.down.sql",
        ),
      );
      await tx.unsafe(
        await Deno.readTextFile(
          "supabase/migrations-held/rollback/20261025130000_tasks_commit_boundary.down.sql",
        ),
      );
      assertEquals((await definitions(tx as unknown as typeof sql)).length, 0);
      assertEquals(
        (await tx`select count(*)::int n from pg_trigger where tgname in ('workspace_members_revoke_client_grants','workspace_members_permission_revision') and not tgisinternal`)[
          0
        ].n,
        2,
      );
      await tx.unsafe(
        await Deno.readTextFile(
          "supabase/migrations-held/20261025130000_tasks_commit_boundary.sql",
        ),
      );
      await tx.unsafe(
        await Deno.readTextFile(
          "supabase/migrations-held/20261025140000_workspace_member_writers.sql",
        ),
      );
    });
    await sql.begin(async tx => {
      for (const f of ['20261025150000_task_plans_parent_identity','20261025160000_workspace_members_app_surface']) {
        await tx.unsafe(await Deno.readTextFile(`supabase/migrations-held/${f}.sql`));
      }
    });
    assertEquals(await sql`select relacl::text a from pg_class where oid='public.workspace_members'::regclass`, acl);
    assertEquals(await definitions(sql), before);
    assertEquals(
      await sql`select row_to_json(m) value from public.workspace_members m order by m.id`,
      membership,
    );
    assertEquals(
      await sql`select row_to_json(g) value from public.client_access_grants g order by g.id`,
      grants,
    );
  },
});
