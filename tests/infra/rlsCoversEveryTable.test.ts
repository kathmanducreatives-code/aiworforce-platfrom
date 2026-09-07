// EVERY TABLE THE MIGRATIONS CREATE MUST ENABLE ROW LEVEL SECURITY.
//
// ── THE LEAK THIS ENCODES ──────────────────────────────────────────────────
//
// `public.ops_stuck_run_archive` sat with `relrowsecurity = false` while the
// other 119 tables had it on. It holds `to_jsonb(t)` of a whole `tasks` row —
// workspace_id, user_id, input, output, result, payload — and one row was
// 160 kB of a complete lead mission. Supabase grants `anon` full DML on every
// table by default, and RLS is the whole of what holds that grant back. The
// anon key ships in the frontend bundle, so the archive was readable, and
// truncatable, by anyone who loaded the app.
//
// It survived because NOTHING CHECKED. There were no RLS tests of any kind.
// The convention was real and well kept — the baseline carries 111
// `CREATE TABLE` and exactly 111 `ENABLE ROW LEVEL SECURITY`, and every
// forward migration that adds a table adds its RLS in the same file — but a
// convention with no test is a habit, and this table was created outside the
// migrations entirely, where the habit could not reach it.
//
// ── WHY SOURCE-LEVEL ───────────────────────────────────────────────────────
//
// The same reason as `rlsMembershipSource.test.ts` and `baselineSchema.test.ts`:
// it runs in CI against no database, so it fails on the pull request that adds
// the table rather than in production three weeks later. Its blind spot is a
// table created by hand — which is precisely how this one arrived — so the fix
// migration also brings the table under migration control, where this test can
// see it. `LIVE_VERIFICATION` at the bottom records the query that closes the
// remaining gap.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

async function migrationSql(): Promise<{ name: string; sql: string }[]> {
  const out: { name: string; sql: string }[] = [];
  for await (const e of Deno.readDir(MIGRATIONS)) {
    if (!e.name.endsWith(".sql")) continue;
    out.push({ name: e.name, sql: await Deno.readTextFile(new URL(e.name, MIGRATIONS)) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const FILES = await migrationSql();
const ALL_SQL = FILES.map((f) => f.sql).join("\n");

/** `CREATE TABLE [IF NOT EXISTS] public.x` / `... ONLY public.x`, quoted or not. */
const CREATED = new RegExp(
  String.raw`create\s+table\s+(?:if\s+not\s+exists\s+)?(?:only\s+)?(?:public\.)?"?([a-z0-9_]+)"?`,
  "gi",
);
/** `ALTER TABLE [ONLY] public.x ENABLE ROW LEVEL SECURITY`. */
const RLS_ON = new RegExp(
  String.raw`alter\s+table\s+(?:only\s+)?(?:public\.)?"?([a-z0-9_]+)"?\s+enable\s+row\s+level\s+security`,
  "gi",
);

function names(re: RegExp, sql: string): Set<string> {
  const s = new Set<string>();
  for (const m of sql.matchAll(re)) s.add(m[1].toLowerCase());
  return s;
}

const created = names(CREATED, ALL_SQL);
const rlsEnabled = names(RLS_ON, ALL_SQL);

/**
 * Tables allowed to exist without RLS.
 *
 * EXPLICIT, so an exception is a decision someone wrote down and not a silent
 * skip. It is empty, and the intention is that it stays empty: a table in
 * `public` is reachable through PostgREST with the default `anon` grant, so
 * "no RLS" means "world-readable". If you are about to add a name here, the
 * question to answer first is why the table is in `public` at all.
 */
const ALLOW_LIST: ReadonlySet<string> = new Set([]);

Deno.test("THE LEAK: every migration-created table enables RLS", () => {
  assert(created.size > 100, `expected the baseline's tables, found ${created.size}`);

  const missing = [...created]
    .filter((t) => !rlsEnabled.has(t))
    .filter((t) => !ALLOW_LIST.has(t))
    .sort();

  assertEquals(
    missing,
    [],
    `tables created without ENABLE ROW LEVEL SECURITY: ${missing.join(", ")}. ` +
      `In public, no RLS means the default anon grant is live — the table is ` +
      `world-readable. Add RLS in the same migration that creates it, or ` +
      `justify it in ALLOW_LIST.`,
  );
});

Deno.test("the allow-list is empty, and every entry in it would be a real table", () => {
  // Not a style rule. An allow-list that drifts away from the schema stops
  // describing anything, and then a genuine exception hides among stale names.
  for (const t of ALLOW_LIST) {
    assert(created.has(t), `ALLOW_LIST names "${t}", which no migration creates`);
  }
  assertEquals([...ALLOW_LIST], [], "an exception here is world-readable data — keep it empty");
});

// ══════════ the specific table, asserted by name ══════════════════════════

const ARCHIVE = "ops_stuck_run_archive";

Deno.test(`${ARCHIVE} is created by a migration, not by hand`, () => {
  // The original defect. A table that exists only in the database is invisible
  // to every static check in this directory.
  assert(
    created.has(ARCHIVE),
    `${ARCHIVE} must be created in migrations/ — it previously existed only in ` +
      `the live database, which is why no test could see that it had no RLS`,
  );
});

Deno.test(`${ARCHIVE} enables RLS`, () => {
  assert(rlsEnabled.has(ARCHIVE), `${ARCHIVE} must ENABLE ROW LEVEL SECURITY`);
});

Deno.test(`${ARCHIVE} revokes anon and authenticated`, () => {
  // RLS filters SELECT/INSERT/UPDATE/DELETE. It does NOT filter TRUNCATE, which
  // is a table privilege — so the default grant would still let anon destroy
  // the archive with RLS fully on. The revokes are load-bearing.
  const revoke = (role: string) =>
    new RegExp(
      String.raw`revoke\s+all\s+on\s+(?:table\s+)?(?:public\.)?"?${ARCHIVE}"?\s+from\s+${role}`,
      "i",
    );
  assert(revoke("anon").test(ALL_SQL), `${ARCHIVE} must REVOKE ALL ... FROM anon`);
  assert(
    revoke("authenticated").test(ALL_SQL),
    `${ARCHIVE} must REVOKE ALL ... FROM authenticated`,
  );
});

Deno.test(`${ARCHIVE} grants no client policy`, () => {
  // RLS on with zero policies denies every non-owner role, which is the end
  // state this table wants: no client reads it, and its only writer is a
  // SECURITY DEFINER function owned by the table's owner. A policy added here
  // to make something pass would reopen the leak.
  const policy = new RegExp(
    String.raw`create\s+policy[\s\S]{0,200}?on\s+(?:public\.)?"?${ARCHIVE}"?`,
    "i",
  );
  assert(
    !policy.test(ALL_SQL),
    `${ARCHIVE} must have NO policy — it has no client reader and must not acquire one`,
  );
});

// ══════════ what source-level checking cannot reach ═══════════════════════

/**
 * The live half of this invariant, recorded so it can be re-run by hand.
 *
 * A static test cannot see a table created outside the migrations — the exact
 * shape of the original defect. Run this against the database after any schema
 * change; every row it returns is a table with no RLS, and therefore readable
 * by anyone holding the anon key.
 *
 *   select c.relname,
 *          c.relrowsecurity,
 *          has_table_privilege('anon', 'public.'||quote_ident(c.relname), 'SELECT')
 *     from pg_class c
 *     join pg_namespace n on n.oid = c.relnamespace
 *    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false;
 *
 * Expected: zero rows.
 */
export const LIVE_VERIFICATION = true;
