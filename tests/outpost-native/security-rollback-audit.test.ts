import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sql } from "../db-contract/lib/harness.ts";
const names = [
  "workspace_member_remove",
  "workspace_member_set_role",
  "workspace_member_change_check",
  "workspace_member_role_rank",
  "tasks_commit_boundary",
];
async function definitions(t: typeof sql) {
  return await t`select p.proname,pg_get_function_identity_arguments(p.oid) args,pg_get_functiondef(p.oid) def,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(${names}) order by p.proname`;
}
Deno.test({
  name:
    "native rollback: 179 and186 round-trip exact definitions/ACLs and preserve data/176 hooks",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const before = await definitions(sql);
    const membership =
      await sql`select row_to_json(m) value from public.workspace_members m order by m.id`;
    const grants =
      await sql`select row_to_json(g) value from public.client_access_grants g order by g.id`;
    await sql.begin(async (tx) => {
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
