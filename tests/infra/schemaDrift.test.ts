// EVERY TABLE THE CODE READS MUST EXIST IN THE BASELINE.
//
// ── WHY ─────────────────────────────────────────────────────────────────────
//
// Four objects the application requires were missing from every database this
// project has ever had: `company_brain_research_runs`, `workspace_sources`,
// `signal_feed` and `lead_results`, plus the `provision_workspace_for_user`
// RPC. Migrations for two of them were written, committed, and never applied.
//
// Each surfaced the same way — as a runtime 500 wearing someone else's name.
// The onboarding failure said "Founder analysis failed" when the LinkedIn
// scrape had succeeded and the audit INSERT after it was what threw. Nothing in
// the test suite, the typechecker or the migration history could see it,
// because a `.from("table_that_does_not_exist")` is a perfectly valid string
// until the moment it runs.
//
// This closes that gap statically. It is a drift check, not a schema test: it
// compares what the edge functions REFERENCE against what the baseline CREATES,
// and any name in the first set and not the second is a 500 waiting for a user
// to find.
//
// ── THE ALLOWLIST IS THE POINT ──────────────────────────────────────────────
//
// Known-missing tables are listed below with a reason rather than silently
// excluded. A table sitting in that list is a decision someone made — "this
// feature is unbuilt" — and removing it from the list is how the feature gets
// finished. Deleting the assertion instead would restore exactly the blindness
// this exists to remove.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ROOT = new URL("../../", import.meta.url);

const BASELINE = await Deno.readTextFile(
  new URL("supabase/migrations/20260816120000_baseline_schema.sql", ROOT),
);
// Migrations added after the baseline count too — the schema is their sum.
async function laterMigrations(): Promise<string> {
  let out = "";
  for await (const e of Deno.readDir(new URL("supabase/migrations/", ROOT))) {
    if (e.name.endsWith(".sql") && e.name !== "20260816120000_baseline_schema.sql") {
      out += await Deno.readTextFile(new URL(`supabase/migrations/${e.name}`, ROOT));
    }
  }
  return out;
}
const SCHEMA = BASELINE + await laterMigrations();

/** Table names any edge function reads or writes via `.from("…")`. */
async function referencedTables(): Promise<Set<string>> {
  const found = new Set<string>();
  const walk = async (dir: URL) => {
    for await (const e of Deno.readDir(dir)) {
      const child = new URL(`${e.name}${e.isDirectory ? "/" : ""}`, dir);
      if (e.isDirectory) { await walk(child); continue; }
      if (!e.name.endsWith(".ts")) continue;
      const src = await Deno.readTextFile(child);
      for (const m of src.matchAll(/\.from\(\s*["'`]([a-z_][a-z0-9_]*)["'`]/g)) {
        found.add(m[1]);
      }
    }
  };
  await walk(new URL("supabase/functions/", ROOT));
  return found;
}

/**
 * Tables the code references that the schema does not create, WITH the reason.
 *
 * Empty is the goal. An entry here is a feature that will 500 for whoever
 * reaches it, kept visible so that is a decision rather than a surprise.
 */
const KNOWN_MISSING: Readonly<Record<string, string>> = {
  signal_feed:
    "read only by the MCP server's list_signals tool. Its shape cannot be " +
    "recovered from the seven columns that tool selects, and inventing one " +
    "would be guessing dressed as a migration.",
  lead_results:
    "read only by the MCP server's list_leads tool, via select('*'), which " +
    "reveals nothing about the columns it expects.",
};

/** Storage and auth live in other schemas; this checks `public`. */
const OTHER_SCHEMAS = new Set(["objects", "buckets", "users"]);

Deno.test("every table the edge functions use is created by the schema", async () => {
  const referenced = await referencedTables();
  assert(referenced.size > 20, `expected many tables, found ${referenced.size}`);

  const missing: string[] = [];
  for (const t of [...referenced].sort()) {
    if (OTHER_SCHEMAS.has(t)) continue;
    const created = new RegExp(
      `create table (if not exists )?(public\\.)?"?${t}"?\\b`, "i",
    ).test(SCHEMA);
    if (!created && !(t in KNOWN_MISSING)) missing.push(t);
  }

  assertEquals(
    missing, [],
    "these tables are read by an edge function and created by no migration — " +
    "each is a runtime 500 waiting to happen. Add the migration, or add the " +
    "name to KNOWN_MISSING with the reason it is unbuilt.",
  );
});

Deno.test("the known-missing list stays honest", async () => {
  // A name that has since been created must LEAVE the list, or the list stops
  // describing reality and starts hiding it.
  const referenced = await referencedTables();
  for (const [t, reason] of Object.entries(KNOWN_MISSING)) {
    assert(reason.length > 30, `${t} needs a real reason, not a placeholder`);
    assert(
      referenced.has(t),
      `${t} is listed as known-missing but no edge function references it — ` +
      "remove it from the list",
    );
    assertEquals(
      new RegExp(`create table (if not exists )?(public\\.)?"?${t}"?\\b`, "i").test(SCHEMA),
      false,
      `${t} now EXISTS — remove it from KNOWN_MISSING`,
    );
  }
});

Deno.test("the RPCs the frontend calls are defined by the schema", async () => {
  // `provision_workspace_for_user` was called by orchestration.ts on every page
  // load and defined nowhere, so every signed-up user had a profile and no
  // workspace — and RLS correctly hid the entire product from them.
  const src = await Deno.readTextFile(new URL("src/lib/orchestration.ts", ROOT));
  const rpcs = [...src.matchAll(/\.rpc\(\s*['"`]([a-z_][a-z0-9_]*)['"`]/g)].map((m) => m[1]);
  assert(rpcs.length > 0, "expected at least one RPC call to check");

  for (const fn of rpcs) {
    assert(
      new RegExp(`create (or replace )?function (public\\.)?${fn}\\b`, "i").test(SCHEMA),
      `${fn}() is called by the frontend and created by no migration`,
    );
  }
});
