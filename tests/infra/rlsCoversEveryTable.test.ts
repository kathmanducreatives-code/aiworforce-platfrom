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
// HELD migrations (baseline, V2 queue) are not applied from the synced
// directory, but every table they create must still enable RLS.
const HELD = new URL("../../supabase/migrations-held/", import.meta.url);

async function migrationSql(): Promise<{ name: string; sql: string }[]> {
  const out: { name: string; sql: string }[] = [];
  for (const dir of [MIGRATIONS, HELD]) {
    for await (const e of Deno.readDir(dir)) {
      if (!e.name.endsWith(".sql")) continue;
      out.push({ name: e.name, sql: await Deno.readTextFile(new URL(e.name, dir)) });
    }
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


// ══════════ no policy may authorise everyone ══════════════════════════════
//
// ── THE SECOND HALF OF THE SAME HOLE ───────────────────────────────────────
//
// RLS being ON is necessary and not sufficient. 102 policies across 46 tables
// had `true` as their entire predicate, and 33 of those — on 18 tables — were
// granted to `anon` or PUBLIC. `linkedin_posts` allowed anonymous DELETE;
// `screening_templates` allowed PUBLIC DELETE; `screening_applications`
// allowed anonymous SELECT of every application ever submitted. A table with
// `USING (true)` is exactly as exposed as a table with no RLS at all, and the
// first version of this file would have passed every one of them.
//
// This computes the NET state rather than grepping: a policy created in the
// baseline and dropped by a later migration is gone, and must not be counted.

/** The text inside a `USING (...)` / `WITH CHECK (...)`, or null. */
function clause(tail: string, kw: "using" | "with check"): string | null {
  const re = new RegExp(kw.replace(" ", "\\s+") + "\\s*\\(", "i");
  const m = re.exec(tail);
  if (!m) return null;
  let depth = 0;
  const start = m.index + m[0].length - 1;
  for (let i = start; i < tail.length; i++) {
    if (tail[i] === "(") depth++;
    else if (tail[i] === ")") { depth--; if (depth === 0) return tail.slice(start + 1, i); }
  }
  return null;
}

/**
 * Does this predicate authorise EVERYONE?
 *
 * ── TWO SHAPES, ONE DEFECT ─────────────────────────────────────────────────
 *
 * `true` is the obvious one. The second is a predicate that names a secret and
 * never compares it:
 *
 *     USING (access_token IS NOT NULL)
 *
 * That asks whether the ROW has a token, not whether the CALLER produced one.
 * `access_token` is NOT NULL on every real row, so it is `true` with a
 * security-shaped name on it — and four of these guarded every screening
 * session and every candidate application against `anon`. They are worse than
 * a bare `true`, because the name tells a reviewer the opposite of what the
 * SQL does, which is exactly why they survived the sweep that removed 102
 * literal-`true` policies.
 *
 * The rule is narrow on purpose: a predicate built only from `IS NOT NULL`
 * tests and boolean connectives constrains no row. A genuine predicate
 * compares something — `auth.uid() = created_by`, a subquery on membership,
 * `is_active = true` — and none of those match here.
 */
function vacuous(pred: string | null): boolean {
  if (pred === null) return false;
  const p = pred.replace(/[()]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  if (p === "true") return true;
  if (!/is not null/.test(p)) return false;
  // Every remaining term must itself be an `x IS NOT NULL`.
  return p.split(/\s+(?:and|or)\s+/).every((t) => /^[\w.":]+ is not null$/.test(t.trim()));
}

interface Policy { name: string; table: string; }

/** `CREATE POLICY "name" ON public.table ... USING (true) / WITH CHECK (true)` */
function permissiveCreates(sql: string): Policy[] {
  const out: Policy[] = [];
  const re =
    /create\s+policy\s+"?([^"\n]+?)"?\s+on\s+(?:public\.)?"?([a-z0-9_]+)"?([^;]*);/gi;
  for (const m of sql.matchAll(re)) {
    const tail = m[3];
    const usingTrue = vacuous(clause(tail, "using"));
    const checkTrue = vacuous(clause(tail, "with check"));
    // A policy is permissive when every predicate it HAS is `true`. An INSERT
    // policy has only WITH CHECK; a SELECT policy has only USING. Requiring
    // both would miss every INSERT policy — which is the mistake the first
    // audit query made, counting every INSERT policy as permissive because
    // `polqual` is null for all of them.
    const hasUsing = /\busing\s*\(/i.test(tail);
    const hasCheck = /\bwith\s+check\s*\(/i.test(tail);
    const permissive =
      (hasUsing && hasCheck) ? (usingTrue && checkTrue)
        : hasUsing ? usingTrue
        : hasCheck ? checkTrue
        : false;
    if (permissive) out.push({ name: m[1].trim(), table: m[2].toLowerCase() });
  }
  return out;
}

/** `DROP POLICY [IF EXISTS] "name" ON public.table;` */
function drops(sql: string): Set<string> {
  const out = new Set<string>();
  const re =
    /drop\s+policy\s+(?:if\s+exists\s+)?"?([^"\n]+?)"?\s+on\s+(?:public\.)?"?([a-z0-9_]+)"?\s*;/gi;
  for (const m of sql.matchAll(re)) out.add(`${m[2].toLowerCase()}\u0000${m[1].trim()}`);
  return out;
}

const dropped = drops(ALL_SQL);
const stillPermissive = permissiveCreates(ALL_SQL)
  .filter((p) => !dropped.has(`${p.table}\u0000${p.name}`));

Deno.test("THE SECOND HALF: no policy survives with `true` as its whole predicate", () => {
  const listed = stillPermissive
    .map((p) => `${p.table}."${p.name}"`)
    .sort();
  assertEquals(
    listed,
    [],
    `policies authorising everyone: ${listed.join(", ")}. ` +
      `A predicate of \`true\` makes RLS decorative — the table is as open as ` +
      `one with RLS off. Scope it to the workspace, or drop it.`,
  );
});

Deno.test("the permissive-policy parser actually recognises one", () => {
  // The check above passes trivially if the regex matches nothing, and a
  // silently-broken parser is how this class of bug survives a green suite.
  const sample = [
    `CREATE POLICY "open read" ON public.widgets FOR SELECT TO anon USING (true);`,
    `CREATE POLICY "open write" ON public.widgets FOR INSERT TO anon WITH CHECK (true);`,
    `CREATE POLICY "scoped" ON public.widgets FOR SELECT TO authenticated `
      + `USING (workspace_id in (select workspace_id from workspace_members));`,
    // The disguised form: names a secret, compares it to nothing.
    `CREATE POLICY "by token" ON public.widgets FOR SELECT TO anon `
      + `USING ((access_token IS NOT NULL));`,
    // A real predicate that merely happens to mention null.
    `CREATE POLICY "mine" ON public.widgets FOR SELECT TO authenticated `
      + `USING (owner = auth.uid() AND deleted_at IS NULL);`,
  ].join("\n");
  const found = permissiveCreates(sample).map((p) => p.name).sort();
  assertEquals(found, ["by token", "open read", "open write"],
    "must catch USING, WITH CHECK, and the `IS NOT NULL` disguise");
  assertEquals(
    permissiveCreates(sample).filter((p) => p.name === "mine").length, 0,
    "and must not flag a real predicate that mentions null",
  );
  assertEquals(
    permissiveCreates(sample).filter((p) => p.name === "scoped").length, 0,
    "and must not flag a genuinely scoped policy",
  );
  // And a drop must retire it.
  const after = permissiveCreates(sample).filter((p) =>
    !drops(`drop policy if exists "open read" on public.widgets;`)
      .has(`${p.table}\u0000${p.name}`)
  );
  assertEquals(after.map((p) => p.name).sort(), ["by token", "open write"],
    "a dropped policy must not count, and the others must survive the drop");
});

// ══════════ tables that must not be world-readable, by name ══════════════
//
// The generic detector above catches predicates that constrain NOTHING. It
// cannot catch a policy that constrains rows correctly and still exposes them
// to the wrong audience — `USING (is_active = true)` granted to PUBLIC is a
// real predicate and a deliberate decision, and a rule broad enough to
// condemn it would also condemn a jobs board or a status page. Rather than
// invent that rule and maintain the allow-list it would need, the tables where
// the decision has been made are named here.

const NO_PUBLIC_READ: readonly string[] = [
  // The interview content a workspace authored — the situations it puts
  // candidates in, and by implication what it screens for. Its only reader is
  // `adaptive-screening-chat`, which holds the service role.
  "screening_scenarios",
];

Deno.test("named tables carry no policy granting anon or PUBLIC a read", () => {
  const dropped = drops(ALL_SQL);
  for (const table of NO_PUBLIC_READ) {
    // Every SELECT/ALL policy on the table that names anon or PUBLIC and has
    // not since been dropped.
    const re = new RegExp(
      String.raw`create\s+policy\s+"?([^"
]+?)"?\s+on\s+(?:public\.)?"?${table}"?([^;]*);`,
      "gi",
    );
    const exposed: string[] = [];
    for (const m of ALL_SQL.matchAll(re)) {
      const name = m[1].trim();
      const tail = m[2];
      const reads = /for\s+(select|all)/i.test(tail) || !/for\s+\w+/i.test(tail);
      const toEveryone = /to\s+(anon|public)/i.test(tail) || !/to\s+\w+/i.test(tail);
      if (reads && toEveryone && !dropped.has(`${table}\u0000${name}`)) exposed.push(name);
    }
    assertEquals(
      exposed,
      [],
      `${table} still grants an unauthenticated read via: ${exposed.join(", ")}. ` +
        `A policy with no TO clause defaults to PUBLIC, which is everyone.`,
    );
  }
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
