// RLS MUST AUTHORISE AGAINST MEMBERSHIP, NOT AGAINST `public.users`.
//
// ── THE BUG THIS ENCODES ────────────────────────────────────────────────────
//
// Completing Company Brain onboarding returned the user to step 1, repeatedly.
// The database was never wrong: `onboarding_completed` was true, the profile
// 8 kB. The cause was eight RLS policies — the entire orchestration surface —
// authorising against a table nobody populates:
//
//   workspace_id in (select users.workspace_id from users where users.id = auth.uid())
//
// `public.users` is empty. Membership lives in `workspace_members`, which is
// what `provision_workspace_for_user` writes, what `getWorkspaceId` reads, and
// what `has_workspace_access` has always checked.
//
// ── WHY IT WAS SO HARD TO SEE ───────────────────────────────────────────────
//
// A DENIED SELECT UNDER RLS IS NOT AN ERROR. It returns zero rows. So
// `maybeSingle()` yielded `null` with `error === null`, the hook's
// `!!row?.onboarding_completed` turned that into a confident `false`, and
// `OnboardingGate` redirected a user whose brain it was simply not permitted to
// read. Every layer behaved correctly on a false premise, and the first fix
// attempt — cache invalidation — was correct in itself and changed nothing,
// because the FRESH read was empty too.
//
// The old project has 20 rows in `workspace_members` and 2 in `users`, so this
// was broken there for 18 of 20 members. It only ever appeared to work for the
// two accounts that happened to have a `users` row.
//
// This test is source-level on purpose: it runs in CI with no database, and it
// fails the moment someone writes another `from users` policy.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ROOT = new URL("../../", import.meta.url);

/** Every migration that currently defines the schema. */
async function activeSchema(): Promise<string> {
  let sql = "";
  for await (const e of Deno.readDir(new URL("supabase/migrations/", ROOT))) {
    if (e.name.endsWith(".sql")) {
      sql += "\n" + await Deno.readTextFile(new URL(`supabase/migrations/${e.name}`, ROOT));
    }
  }
  return sql;
}

/** Policy bodies only — comments explaining the bug legitimately name `users`. */
function policyBodies(sql: string): string[] {
  const withoutComments = sql.replace(/^\s*--.*$/gm, "");
  return [...withoutComments.matchAll(
    /create\s+policy[\s\S]*?(?=;\s*(?:\n|$))/gi,
  )].map((m) => m[0]);
}

Deno.test("no active policy authorises against public.users", async () => {
  // The exact shape that caused the loop. `public.users` is not the membership
  // table and has never been reliably populated.
  const offenders = policyBodies(await activeSchema())
    .filter((p) => /\bfrom\s+(public\.)?users\b/i.test(p))
    .map((p) => p.split("\n")[0].trim().slice(0, 90));

  assertEquals(
    offenders, [],
    "these policies authorise against public.users, which is empty — they will " +
    "silently return zero rows to every signed-in user. Use " +
    "has_workspace_access(auth.uid(), <workspace column>) instead.",
  );
});

Deno.test("the membership helper is the single definition of access", async () => {
  const sql = await activeSchema();
  // It must exist, and it must check workspace_members — not be a second copy
  // of the broken logic under a reassuring name.
  assert(
    /function public\.has_workspace_access/i.test(sql),
    "has_workspace_access must be defined by a migration",
  );
  const body = sql.slice(sql.search(/function public\.has_workspace_access/i));
  assert(
    /workspace_members/i.test(body.slice(0, 600)),
    "has_workspace_access must check workspace_members",
  );
});

Deno.test("the repaired policies actually use the helper", async () => {
  // Pins the fix rather than merely the absence of the bug: a policy could
  // avoid `from users` and still be wrong.
  const sql = await activeSchema();
  for (const table of [
    "agents", "tasks", "task_plans", "approvals", "activity_feed", "handoffs",
    "workspaces", "agent_capabilities", "company_brain",
  ]) {
    const rx = new RegExp(
      `create policy[^;]*on public\\.${table}\\b[^;]*has_workspace_access`, "is",
    );
    assert(rx.test(sql), `${table} must have a membership-based policy`);
  }
});

Deno.test("every workspace gets its own agents", async () => {
  // The second half of the same failure: the policy fix alone left the user
  // seeing zero agents, because all five lived in a sentinel workspace created
  // only to satisfy their foreign key, and a real user is not a member of it.
  const sql = await activeSchema();
  assert(
    /function public\.seed_agents_for_workspace/i.test(sql),
    "workspace provisioning must seed agents",
  );
  assert(
    /seed_agents_for_workspace\(new_id\)/i.test(sql),
    "a newly provisioned workspace must be seeded",
  );
  assert(
    /seed_agents_for_workspace\(existing_id\)/i.test(sql),
    "and an existing workspace must be repaired, since provisioning is called on every load",
  );
});
