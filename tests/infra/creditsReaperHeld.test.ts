// The reaper fix is HELD: it is applied only to the disposable database-contract
// lane, never by a deploy path, it depends on the held re-arm fix, and its
// rollback restores the re-arm migration's reaper verbatim. The behaviour itself
// is proven against real Postgres + PostgREST in
// tests/db-contract/creditReaper.contract.test.ts.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ROOT = new URL("../../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, ROOT));
const NAME = "20261022120000_credits_reaper_charges_confirmed_purchase";
const REARM = "20261015130000_credits_rearm_settled_key";
const UP = read(`supabase/migrations-held/${NAME}.sql`);
const DOWN = read(`supabase/migrations-held/rollback/${NAME}.down.sql`);
const REARM_UP = read(`supabase/migrations-held/${REARM}.sql`);

/** A function's full definition from `create or replace function` to its closing `$$;`. */
function definition(sql: string, fn: string): string {
  const m = sql.match(new RegExp(`create or replace function public\\.${fn}\\(`, "i"));
  assert(m && m.index !== undefined, `${fn} is defined`);
  const end = sql.indexOf("$$;", sql.indexOf("as $$", m.index)) + 3;
  return sql.slice(m.index, end);
}

Deno.test("credit reaper: held — not in the production-synced directory, not in any deploy path", async () => {
  for await (const e of Deno.readDir(new URL("supabase/migrations/", ROOT))) {
    assert(!e.name.includes("credits_reaper"), "must not sit in supabase/migrations/");
  }
  assert(!read("scripts/local-supabase/rebuild-local-db.sh").includes(NAME));
  for await (const e of Deno.readDir(new URL(".github/workflows/", ROOT))) {
    assert(!read(`.github/workflows/${e.name}`).includes(NAME), `${e.name} must not name the held reaper fix`);
  }
  const bootstrap = read("tests/db-contract/bootstrap.sh");
  assert(bootstrap.includes(`${NAME}.sql`), "the disposable contract lane applies it");
  assert(bootstrap.indexOf(`${REARM}.sql`) < bootstrap.indexOf(`${NAME}.sql`), "after the re-arm fix it depends on");
});

Deno.test("credit reaper: only the reaper changes; reserve, finalize and grant are untouched", () => {
  assert(!/function public\.credits_(reserve|finalize|grant)\b/i.test(UP));
  assert(UP.includes("coalesce(rearmed_at, created_at) < now() - p_older_than"), "the window still runs from the re-arm");
  assert(UP.includes("for update skip locked"));
  assert(UP.includes("perform public.credits_finalize("), "every settlement goes through the idempotent finalize");
  assert(UP.includes("revoke execute on function public.credits_release_stale(interval) from public, anon, authenticated;"));
});

Deno.test("credit reaper: evidence is the execution ledger's run id, bound to workspace, task and logical call", () => {
  for (const guard of [
    "e.workspace_id = v_txn.workspace_id",
    "e.logical_call_key = v_txn.idempotency_key",
    "e.task_id is not distinct from v_txn.task_id",
    "e.record_kind = 'provider_call'",
    "length(btrim(coalesce(e.provider_run_id, ''))) > 0",
    "v_txn.kind in ('provider_call', 'monitoring_call')",
    "v_txn.reserved_credits, 'charged'",
  ]) assert(UP.includes(guard), guard);
});

Deno.test("credit reaper: the rollback restores the re-arm migration's reaper byte-identical", () => {
  assertEquals(definition(DOWN, "credits_release_stale"), definition(REARM_UP, "credits_release_stale"));
  assert(DOWN.includes("grant execute on function public.credits_release_stale(interval) to service_role;"));
});

Deno.test("credit reaper: a TEST build with the held billing fixes applies the reaper right after the re-arm, never alone", () => {
  const build = read("scripts/test-project/build-test-schema.sh");
  assert(build.includes(`reaper_fix="$held/${NAME}.sql"`));
  assert(build.includes('if [ $with_billing -eq 1 ]; then apply "$billing_fix"; apply "$reaper_fix"; fi'),
    "same opt-in flag, in dependency order");
});
